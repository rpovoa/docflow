'use strict';

(function docflowTracker() {
  if (window.__docflowTracker) return;
  window.__docflowTracker = true;

  let isRecording = false;
  let isPaused    = false;
  let stepCount   = 0;
  let sidebarHost  = null;
  let sidebarRoot  = null;
  let isNarrating  = false;
  let recognition  = null;

  const inputTimers = new Map();

  // Deduplication: track last click to drop accidental double-clicks
  let lastClickKey  = null;
  let lastClickTime = 0;
  const CLICK_DEDUP_MS = 600;

  // Local step log for the mini-feed (no IDs needed)
  let recentSteps = [];

  // ── Element metadata ──────────────────────────────────────────────────────

  function extractLabel(el) {
    // aria-label is the most explicit and reliable
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    // Associated <label> element
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return (lbl.innerText || lbl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    }

    // Placeholder for inputs
    if (el.placeholder) return el.placeholder.trim().slice(0, 80);

    // Visible rendered text — innerText respects CSS visibility and excludes hidden nodes
    const inner = (el.innerText || '').trim().replace(/\s+/g, ' ');
    if (inner) return inner.slice(0, 80);

    // Fallback attributes
    if (el.getAttribute('alt'))   return el.getAttribute('alt').trim();
    if (el.getAttribute('title')) return el.getAttribute('title').trim();

    // For input[type=submit] / input[type=button]
    if (el.value) return String(el.value).trim().slice(0, 80);

    return el.tagName.toLowerCase();
  }

  function extractElementInfo(el) {
    return {
      tag:   el.tagName.toLowerCase(),
      label: extractLabel(el),
      id:    el.id || null,
      type:  el.getAttribute('type') || null,
      href:  el.getAttribute('href') || null,
      name:  el.getAttribute('name') || null,
    };
  }

  // ── Messaging ─────────────────────────────────────────────────────────────

  function trackEvent(stepData) {
    safeSend({
      type: 'TRACK_EVENT',
      step: { ...stepData, url: window.location.href, pageTitle: document.title },
    }).then(resp => {
      if (resp?.stepCount != null) updateStepCount(resp.stepCount);
      recentSteps.push({
        type:  stepData.type,
        label: stepData.element?.label || stepData.note || document.title || stepData.type,
      });
      if (recentSteps.length > 10) recentSteps.shift();
      updateMiniFeed();
    });
  }

  // ── Semantic DOM extraction ───────────────────────────────────────────────

  function extractSemanticDOM() {
    const MAX_CHARS = 3000;
    const sidebarEl = document.getElementById('docflow-sidebar-host');

    function isVisible(el) {
      try {
        if (sidebarEl && sidebarEl.contains(el)) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0;
      } catch (_) { return false; }
    }

    function fieldLabel(el) {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.trim().slice(0, 60);
      const lbId = el.getAttribute('aria-labelledby');
      if (lbId) {
        const lbEl = document.getElementById(lbId);
        if (lbEl) return (lbEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      }
      if (el.id) {
        const lbEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbEl) return (lbEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      }
      const closest = el.closest('label');
      if (closest) return (closest.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (el.placeholder) return el.placeholder.trim().slice(0, 60);
      if (el.name) return el.name.slice(0, 60);
      return null;
    }

    const parts = [];

    // Headings
    const heads = [...document.querySelectorAll('h1,h2,h3,h4')]
      .filter(isVisible)
      .map(h => (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80))
      .filter(Boolean);
    if (heads.length) parts.push('Títulos: ' + heads.join(' › '));

    // Form fields
    const fieldEls = [...document.querySelectorAll(
      'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]),' +
      'select,textarea'
    )].filter(isVisible);

    const fieldLines = fieldEls.map(el => {
      const lbl  = fieldLabel(el) || '—';
      const type = el.tagName === 'SELECT' ? 'select' : (el.getAttribute('type') || 'text');
      if (el.tagName === 'SELECT') {
        const opts = [...el.options].slice(0, 6).map(o => o.text.trim()).filter(Boolean);
        return `${lbl} [select${opts.length ? ': ' + opts.join(', ') : ''}]`;
      }
      return `${lbl} [${type}]`;
    });
    if (fieldLines.length) parts.push('Campos:\n' + fieldLines.map(l => '  • ' + l).join('\n'));

    // Buttons
    const btnEls = [...document.querySelectorAll('button,input[type=submit],input[type=button],[role=button]')]
      .filter(el => isVisible(el) && !(sidebarEl && sidebarEl.contains(el)));
    const btnTexts = [...new Set(
      btnEls
        .map(el => (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50))
        .filter(Boolean)
    )].slice(0, 15);
    if (btnTexts.length) parts.push('Botões: ' + btnTexts.join(' | '));

    if (!parts.length) return null;
    const result = parts.join('\n');
    return result.length > MAX_CHARS ? result.slice(0, MAX_CHARS) + '…' : result;
  }

  // ── Visual feedback ───────────────────────────────────────────────────────

  function flashElement(el) {
    if (el.closest && el.closest('#docflow-sidebar-host')) return;
    el.classList.add('docflow-flash');
    setTimeout(() => el.classList.remove('docflow-flash'), 600);
  }

  function elementAnnotation(el) {
    const r  = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      vw, vh,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
    };
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  function handleClick(e) {
    if (!isRecording || isPaused) return;
    const el = e.target;
    if (el.closest && el.closest('#docflow-sidebar-host')) return;

    // Drop accidental double-clicks / rapid re-clicks on the same element
    const now = Date.now();
    const key = el.id || el.getAttribute('name') || el.getAttribute('aria-label')
              || el.textContent?.trim().slice(0, 60) || el.tagName;
    if (key && key === lastClickKey && now - lastClickTime < CLICK_DEDUP_MS) return;
    lastClickKey  = key;
    lastClickTime = now;

    flashElement(el);
    const ann = elementAnnotation(el);
    ann.x = e.clientX;
    ann.y = e.clientY;
    trackEvent({ type: 'click', element: extractElementInfo(el), annotation: ann });
  }

  function handleInput(e) {
    if (!isRecording || isPaused) return;
    const el = e.target;
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
    const key = el.name || el.id || el;
    clearTimeout(inputTimers.get(key));
    inputTimers.set(key, setTimeout(() => {
      inputTimers.delete(key);
      const isPassword = el.type === 'password';
      trackEvent({
        type:       el.tagName === 'SELECT' ? 'select' : 'input',
        element:    extractElementInfo(el),
        value:      isPassword ? '••••••' : el.value,
        annotation: elementAnnotation(el),
      });
    }, 800));
  }

  function handleSubmit(e) {
    if (!isRecording || isPaused) return;
    trackEvent({ type: 'submit', element: extractElementInfo(e.target) });
  }

  // ── SPA navigation ────────────────────────────────────────────────────────

  let lastUrl    = location.href;
  let _navTimer  = null;

  function checkNavigation() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isRecording && !isPaused) {
        // Debounce: SPAs sometimes fire multiple URL changes in quick succession.
        // Wait 600ms for the new view to render before capturing DOM + sending step.
        clearTimeout(_navTimer);
        const capturedUrl = location.href;
        _navTimer = setTimeout(() => {
          if (!isRecording || isPaused) return;
          const domSnapshot = extractSemanticDOM();
          trackEvent({ type: 'navigation', domSnapshot: domSnapshot || undefined });
        }, 600);
      }
    }
  }

  const navObserver = new MutationObserver(checkNavigation);
  try {
    const _pushState    = history.pushState.bind(history);
    const _replaceState = history.replaceState.bind(history);
    history.pushState    = (...args) => { _pushState(...args);    checkNavigation(); };
    history.replaceState = (...args) => { _replaceState(...args); checkNavigation(); };
  } catch (_) {}
  window.addEventListener('popstate', checkNavigation);

  // ── Sidebar ───────────────────────────────────────────────────────────────

  const SIDEBAR_CSS = `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

    .sidebar{
      display:flex;
      flex-direction:row;
      align-items:stretch;
      pointer-events:auto;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      font-size:13px;
      color:#e5e7eb;
    }

    .rec-dot{
      display:inline-block;
      width:8px;height:8px;
      border-radius:50%;
      background:#ef4444;
      flex-shrink:0;
      animation:df-pulse 1.1s ease-in-out infinite;
    }

    @keyframes df-pulse{
      0%,100%{opacity:1;transform:scale(1)}
      50%{opacity:.4;transform:scale(.75)}
    }

    .hidden{display:none!important}

    /* ── Minimized tab ── */
    .tab{
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      gap:8px;
      padding:18px 10px;
      background:rgba(10,10,14,.92);
      border:1px solid rgba(255,255,255,.12);
      border-right:none;
      border-radius:12px 0 0 12px;
      cursor:pointer;
      user-select:none;
      color:#d1d5db;
      font-size:10px;
      font-weight:700;
      letter-spacing:.1em;
      writing-mode:vertical-lr;
      transition:background .15s;
      box-shadow:-4px 0 20px rgba(0,0,0,.4);
    }
    .tab:hover{background:rgba(24,24,30,.96)}

    /* ── Panel ── */
    .panel{
      width:204px;
      display:flex;
      flex-direction:column;
      gap:8px;
      background:rgba(12,12,18,.96);
      border:1px solid rgba(255,255,255,.1);
      border-right:none;
      border-radius:14px 0 0 14px;
      padding:14px 12px 12px;
      backdrop-filter:blur(18px);
      -webkit-backdrop-filter:blur(18px);
      box-shadow:-6px 0 32px rgba(0,0,0,.5);
    }

    /* Header / drag handle */
    .panel-header{
      display:flex;
      align-items:center;
      gap:7px;
      cursor:move;
      user-select:none;
      padding-bottom:10px;
      border-bottom:1px solid rgba(255,255,255,.07);
    }
    .session-title{
      flex:1;
      font-size:11.5px;
      font-weight:600;
      color:#e5e7eb;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .btn-icon{
      background:none;
      border:none;
      color:#6b7280;
      font-size:16px;
      line-height:1;
      cursor:pointer;
      padding:1px 3px;
      border-radius:4px;
      flex-shrink:0;
      transition:color .12s,background .12s;
    }
    .btn-icon:hover{color:#d1d5db;background:rgba(255,255,255,.08)}

    /* Step counter */
    .step-counter{
      font-size:11px;
      color:#9ca3af;
      text-align:center;
      padding:4px 0 2px;
    }
    .step-num{
      font-size:24px;
      font-weight:700;
      color:#e5e7eb;
      line-height:1;
      display:block;
      margin-bottom:3px;
    }

    /* Divider */
    .divider{height:1px;background:rgba(255,255,255,.07);margin:0 -2px}

    /* ── Buttons ── */
    .btn{
      border:none;
      cursor:pointer;
      border-radius:8px;
      font-size:12px;
      font-weight:500;
      padding:8px 10px;
      width:100%;
      text-align:center;
      transition:background .14s,transform .08s;
      line-height:1.35;
    }
    .btn:active:not(:disabled){transform:scale(.97)}
    .btn:disabled{opacity:.45;cursor:not-allowed;transform:none}

    .btn-pause{
      background:rgba(59,130,246,.2);
      border:1px solid rgba(59,130,246,.38);
      color:#93c5fd;
    }
    .btn-pause:hover:not(:disabled){background:rgba(59,130,246,.32)}

    .btn-resume{
      background:rgba(34,197,94,.18);
      border:1px solid rgba(34,197,94,.38);
      color:#86efac;
    }
    .btn-resume:hover:not(:disabled){background:rgba(34,197,94,.3)}

    .btn-row{
      display:flex;
      gap:6px;
    }
    .btn-row .btn{
      flex:1;
      padding:8px 4px;
      font-size:14px;
    }

    .btn-secondary{
      background:rgba(255,255,255,.07);
      border:1px solid rgba(255,255,255,.1);
      color:#d1d5db;
    }
    .btn-secondary:hover:not(:disabled){background:rgba(255,255,255,.13)}

    .btn-stop{
      background:rgba(239,68,68,.12);
      border:1px solid rgba(239,68,68,.24);
      color:#fca5a5;
    }
    .btn-stop:hover:not(:disabled){background:rgba(239,68,68,.22)}

    .btn-danger{
      background:rgba(239,68,68,.24);
      border:1px solid rgba(239,68,68,.44);
      color:#fca5a5;
    }
    .btn-danger:hover:not(:disabled){background:rgba(239,68,68,.38)}

    .btn-ghost{
      background:none;
      border:1px solid rgba(255,255,255,.08);
      color:#6b7280;
    }
    .btn-ghost:hover:not(:disabled){background:rgba(255,255,255,.06);color:#9ca3af}

    /* ── Note area ── */
    .note-area{
      display:flex;
      flex-direction:column;
      gap:6px;
    }
    .note-input{
      background:rgba(255,255,255,.07);
      border:1px solid rgba(255,255,255,.11);
      border-radius:6px;
      color:#e5e7eb;
      font-size:12px;
      font-family:inherit;
      padding:7px 8px;
      resize:none;
      width:100%;
      outline:none;
      transition:border-color .14s;
    }
    .note-input:focus{border-color:rgba(59,130,246,.5)}
    .note-input::placeholder{color:#4b5563}

    /* ── Stop confirmation ── */
    .stop-confirm{
      display:flex;
      flex-direction:column;
      gap:8px;
      font-size:12px;
      color:#d1d5db;
      text-align:center;
      background:rgba(239,68,68,.07);
      border:1px solid rgba(239,68,68,.18);
      border-radius:8px;
      padding:10px 8px;
    }
    .stop-confirm-btns{display:flex;gap:6px}

    /* ── Paused state ── */
    .paused .rec-dot{
      background:#f59e0b;
      animation:none;
    }
    .paused .tab .rec-dot{
      background:#f59e0b;
      animation:none;
    }

    /* ── Narration / mic ── */
    .btn-mic{
      background:rgba(168,85,247,.14);
      border:1px solid rgba(168,85,247,.28);
      color:#d8b4fe;
    }
    .btn-mic:hover:not(:disabled){background:rgba(168,85,247,.24)}

    .btn-mic-active{
      background:rgba(239,68,68,.16);
      border:1px solid rgba(239,68,68,.55);
      color:#fca5a5;
      animation:df-mic-border 1.6s ease-in-out infinite;
    }
    .btn-mic-active:hover:not(:disabled){background:rgba(239,68,68,.26)}

    @keyframes df-mic-border{
      0%,100%{border-color:rgba(239,68,68,.55)}
      50%{border-color:rgba(239,68,68,1)}
    }

    .narration-status{
      display:flex;
      align-items:flex-start;
      gap:6px;
      background:rgba(239,68,68,.05);
      border:1px solid rgba(239,68,68,.14);
      border-radius:7px;
      padding:7px 8px;
      font-size:11px;
    }
    .mic-live-dot{
      width:6px;height:6px;
      border-radius:50%;
      background:#ef4444;
      flex-shrink:0;
      margin-top:2px;
      animation:df-pulse 1.1s ease-in-out infinite;
    }
    .narration-text{
      flex:1;
      font-style:italic;
      color:#d1d5db;
      word-break:break-word;
      line-height:1.4;
      min-height:14px;
    }

    /* ── Stop & Generate ── */
    .btn-stop-gen{
      background:rgba(99,102,241,.18);
      border:1px solid rgba(99,102,241,.38);
      color:#c4b5fd;
    }
    .btn-stop-gen:hover:not(:disabled){background:rgba(99,102,241,.3)}

    /* ── Mini feed ── */
    .mini-feed{
      display:flex;
      flex-direction:column;
      gap:1px;
      padding:2px 0;
    }
    .feed-item{
      font-size:10.5px;
      color:#6b7280;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      line-height:1.45;
    }
    .feed-latest{color:#9ca3af}

    /* ── Steps expand ── */
    .steps-toggle{
      font-size:10px;
      color:#4b5563;
      cursor:pointer;
      user-select:none;
      text-align:center;
      padding:2px 0;
      display:block;
      transition:color .12s;
    }
    .steps-toggle:hover{color:#9ca3af}

    .steps-full{
      display:flex;
      flex-direction:column;
      gap:1px;
      max-height:112px;
      overflow-y:auto;
      padding:2px 0;
      scrollbar-width:thin;
      scrollbar-color:rgba(255,255,255,.08) transparent;
    }
    .step-item{
      display:flex;
      align-items:center;
      gap:4px;
      padding:2px 2px;
      border-radius:4px;
      min-width:0;
    }
    .step-item:hover{background:rgba(255,255,255,.06)}
    .step-item-num{
      font-size:9px;
      color:#374151;
      width:14px;
      text-align:right;
      flex-shrink:0;
    }
    .step-item-label{
      flex:1;
      font-size:10.5px;
      color:#6b7280;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    .step-del-btn{
      flex-shrink:0;
      background:none;
      border:none;
      cursor:pointer;
      color:transparent;
      font-size:12px;
      padding:0 2px;
      line-height:1;
      border-radius:3px;
      transition:color .12s;
    }
    .step-item:hover .step-del-btn{color:#4b5563}
    .step-del-btn:hover{color:#f87171!important}

    /* ── Stop-gen error ── */
    .stop-gen-error{
      font-size:11px;
      color:#fca5a5;
      background:rgba(239,68,68,.08);
      border:1px solid rgba(239,68,68,.2);
      border-radius:6px;
      padding:6px 8px;
      text-align:center;
    }
  `;

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Wraps chrome.runtime.sendMessage to handle both synchronous throws
  // (e.g. "Extension context invalidated" after a reload) and rejected promises.
  function safeSend(msg) {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function buildSidebarHTML(session) {
    const title = session?.title || 'Sessão';
    return `
      <div class="sidebar" id="df-sidebar">
        <div class="tab hidden" id="df-tab">
          <span class="rec-dot"></span>
          <span>REC</span>
        </div>
        <div class="panel" id="df-panel">
          <div class="panel-header" id="df-drag">
            <span class="rec-dot" id="df-rec-dot"></span>
            <span class="session-title" title="${escHtml(title)}">${escHtml(title)}</span>
            <button class="btn-icon" id="df-minimize" title="Minimizar">−</button>
          </div>
          <div class="step-counter">
            <span class="step-num" id="df-count">0</span>
            passos gravados
          </div>
          <div class="mini-feed hidden" id="df-feed"></div>
          <span class="steps-toggle hidden" id="df-steps-toggle">Ver passos ▾</span>
          <div class="steps-full hidden" id="df-steps-full"></div>
          <div class="divider"></div>
          <button class="btn btn-pause" id="df-pause">⏸ Pausar gravação</button>
          <div class="btn-row">
            <button class="btn btn-secondary" id="df-screenshot" title="Capturar screenshot">📸</button>
            <button class="btn btn-secondary" id="df-note-btn" title="Adicionar nota">📝</button>
            <button class="btn btn-secondary" id="df-undo" title="Desfazer último passo">↩</button>
          </div>
          <div class="note-area hidden" id="df-note-area">
            <textarea class="note-input" id="df-note-input" rows="3"
              placeholder="Escreve uma nota..."></textarea>
            <div class="btn-row">
              <button class="btn btn-ghost" id="df-note-cancel">Cancelar</button>
              <button class="btn btn-pause" id="df-note-ok">Adicionar</button>
            </div>
          </div>
          <button class="btn btn-mic" id="df-mic">🎙 Narrar</button>
          <div class="narration-status hidden" id="df-narration-status">
            <span class="mic-live-dot"></span>
            <span class="narration-text" id="df-narration-text">A ouvir...</span>
          </div>
          <div class="divider"></div>
          <button class="btn btn-stop-gen" id="df-stop-gen">✨ Parar e Gerar</button>
          <button class="btn btn-stop" id="df-stop">⏹ Parar Sessão</button>
          <div class="stop-confirm hidden" id="df-stop-confirm">
            <span>Encerrar a sessão?</span>
            <div class="stop-confirm-btns">
              <button class="btn btn-ghost" id="df-stop-cancel">Cancelar</button>
              <button class="btn btn-danger" id="df-stop-do">Encerrar</button>
            </div>
          </div>
          <div class="stop-gen-error hidden" id="df-stop-gen-error"></div>
        </div>
      </div>
    `;
  }

  function dfEl(id) {
    return sidebarRoot ? sidebarRoot.getElementById(id) : null;
  }

  function updateStepCount(count) {
    stepCount = count;
    const el = dfEl('df-count');
    if (el) el.textContent = count;
    if (count > 0) dfEl('df-steps-toggle')?.classList.remove('hidden');
  }

  function stepIcon(type) {
    return { click: '→', input: '✎', select: '⇩', navigation: '⤻', manual: '📝', screenshot: '📸', narration: '🎙' }[type] || '·';
  }

  function updateMiniFeed() {
    const feed = dfEl('df-feed');
    if (!feed) return;
    const items = recentSteps.slice(-3);
    if (!items.length) { feed.classList.add('hidden'); return; }
    feed.classList.remove('hidden');
    feed.innerHTML = items.map((s, i) => {
      const isLatest = i === items.length - 1;
      const label = s.label || s.type;
      return `<div class="feed-item${isLatest ? ' feed-latest' : ''}">${escHtml(stepIcon(s.type) + ' ' + label)}</div>`;
    }).join('');
  }

  async function loadAndRenderSteps() {
    const list = dfEl('df-steps-full');
    if (!list) return;
    list.innerHTML = '<div class="step-item-label" style="padding:3px 2px;font-size:10px;color:#4b5563">A carregar...</div>';
    const resp  = await safeSend({ type: 'GET_SESSION' });
    const steps = resp?.session?.steps || [];
    list.innerHTML = '';
    if (!steps.length) {
      list.innerHTML = '<div class="step-item-label" style="padding:3px 2px;font-size:10px;color:#4b5563">Nenhum passo gravado</div>';
      return;
    }
    steps.forEach(step => {
      const label = step.element?.label || step.note || step.pageTitle || step.type;
      const item  = document.createElement('div');
      item.className = 'step-item';
      item.dataset.stepId = step.id;
      item.innerHTML =
        `<span class="step-item-num">${step.index}</span>` +
        `<span class="step-item-label" title="${escHtml(label)}">${escHtml(stepIcon(step.type) + ' ' + label)}</span>` +
        `<button class="step-del-btn" data-step-id="${escHtml(step.id)}" title="Remover passo">×</button>`;
      list.appendChild(item);
    });
  }

  function updatePauseUI() {
    const sidebar  = dfEl('df-sidebar');
    const pauseBtn = dfEl('df-pause');
    const recDot   = dfEl('df-rec-dot');
    if (!pauseBtn) return;

    if (isPaused) {
      pauseBtn.textContent = '▶ Retomar gravação';
      pauseBtn.className   = 'btn btn-resume';
      sidebar?.classList.add('paused');
    } else {
      pauseBtn.textContent = '⏸ Pausar gravação';
      pauseBtn.className   = 'btn btn-pause';
      sidebar?.classList.remove('paused');
    }
  }

  function startNarration() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      updateNarrationText('Não suportado neste browser.');
      dfEl('df-narration-status')?.classList.remove('hidden');
      return;
    }

    recognition = new SR();
    recognition.lang = navigator.language || 'pt-PT';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          const text = t.trim();
          if (text) {
            safeSend({
              type:      'ADD_NARRATION',
              text,
              url:       window.location.href,
              pageTitle: document.title,
            }).then(resp => {
              if (resp?.stepCount != null) updateStepCount(resp.stepCount);
              updateNarrationText('');
            });
          }
        } else {
          interim += t;
        }
      }
      if (interim) updateNarrationText(interim);
    };

    recognition.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      stopNarration();
    };

    // Auto-restart on unexpected end (silence timeout, network hiccup)
    recognition.onend = () => {
      if (isNarrating) {
        try { recognition.start(); } catch (_) {}
      }
    };

    try {
      recognition.start();
      isNarrating = true;
      updateMicUI();
    } catch (_) {
      recognition = null;
    }
  }

  function stopNarration() {
    if (!isNarrating) return;
    isNarrating = false;
    if (recognition) {
      recognition.abort();
      recognition = null;
    }
    updateMicUI();
  }

  function updateMicUI() {
    const btn    = dfEl('df-mic');
    const status = dfEl('df-narration-status');
    if (!btn) return;
    if (isNarrating) {
      btn.textContent = '🎙 A narrar...';
      btn.className   = 'btn btn-mic-active';
      status?.classList.remove('hidden');
    } else {
      btn.textContent = '🎙 Narrar';
      btn.className   = 'btn btn-mic';
      status?.classList.add('hidden');
      updateNarrationText('');
    }
  }

  function updateNarrationText(text) {
    const el = dfEl('df-narration-text');
    if (el) el.textContent = text || 'A ouvir...';
  }

  function createSidebar(session) {
    if (sidebarHost) return;
    if (!document.body) return;

    try {
      sidebarHost = document.createElement('div');
      sidebarHost.id = 'docflow-sidebar-host';
      sidebarHost.style.cssText =
        'position:fixed;right:0;top:50%;transform:translateY(-50%);' +
        'z-index:2147483647;pointer-events:none;';

      sidebarRoot = sidebarHost.attachShadow({ mode: 'open' });
      sidebarRoot.innerHTML = `<style>${SIDEBAR_CSS}</style>${buildSidebarHTML(session)}`;
    } catch (err) {
      sidebarHost = null;
      sidebarRoot = null;
      return;
    }

    document.body.appendChild(sidebarHost);

    // Restore saved vertical position
    const savedTop = sessionStorage.getItem('__df_sidebar_top__');
    if (savedTop) {
      sidebarHost.style.top = savedTop;
      sidebarHost.style.transform = 'none';
    }

    // Restore minimized state
    if (sessionStorage.getItem('__df_sidebar_min__') === '1') {
      dfEl('df-panel').classList.add('hidden');
      dfEl('df-tab').classList.remove('hidden');
    }

    updateStepCount(session?.steps?.length || 0);
    updatePauseUI();

    // Seed mini-feed from existing steps when resuming a session
    if (session?.steps?.length) {
      recentSteps = session.steps.slice(-10).map(s => ({
        type: s.type, label: s.element?.label || s.note || s.pageTitle || s.type,
      }));
      updateMiniFeed();
    }

    setupSidebarListeners();
    setupDrag();
  }

  function removeSidebar() {
    if (!sidebarHost) return;
    sidebarHost.remove();
    sidebarHost = null;
    sidebarRoot = null;
  }

  function setupSidebarListeners() {
    // Minimize → tab
    dfEl('df-minimize').addEventListener('click', () => {
      dfEl('df-panel').classList.add('hidden');
      dfEl('df-tab').classList.remove('hidden');
      sessionStorage.setItem('__df_sidebar_min__', '1');
    });

    // Tab → panel
    dfEl('df-tab').addEventListener('click', () => {
      dfEl('df-panel').classList.remove('hidden');
      dfEl('df-tab').classList.add('hidden');
      sessionStorage.removeItem('__df_sidebar_min__');
    });

    // Pause / Resume
    dfEl('df-pause').addEventListener('click', async () => {
      const btn = dfEl('df-pause');
      btn.disabled = true;
      await safeSend({ type: 'TOGGLE_PAUSE' });
      btn.disabled = false;
    });

    // Screenshot — sidebar is hidden by captureScreenshot in the service worker
    dfEl('df-screenshot').addEventListener('click', async () => {
      const btn = dfEl('df-screenshot');
      btn.disabled = true;
      const resp = await safeSend({ type: 'TAKE_SCREENSHOT' });
      if (resp?.stepCount != null) updateStepCount(resp.stepCount);
      btn.disabled = false;
    });

    // Note
    dfEl('df-note-btn').addEventListener('click', () => {
      dfEl('df-note-area').classList.remove('hidden');
      dfEl('df-note-input').focus();
    });

    dfEl('df-note-cancel').addEventListener('click', () => {
      dfEl('df-note-area').classList.add('hidden');
      dfEl('df-note-input').value = '';
    });

    dfEl('df-note-ok').addEventListener('click', async () => {
      const input = dfEl('df-note-input');
      const note  = input.value.trim();
      if (!note) return;
      const btn = dfEl('df-note-ok');
      btn.disabled = true;
      const resp = await safeSend({
        type: 'ADD_NOTE',
        note,
        url:       window.location.href,
        pageTitle: document.title,
      });
      if (resp?.stepCount != null) updateStepCount(resp.stepCount);
      input.value = '';
      dfEl('df-note-area').classList.add('hidden');
      btn.disabled = false;
    });

    dfEl('df-note-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) dfEl('df-note-ok').click();
      if (e.key === 'Escape') dfEl('df-note-cancel').click();
    });

    // Undo
    dfEl('df-undo').addEventListener('click', async () => {
      const btn = dfEl('df-undo');
      btn.disabled = true;
      const resp = await safeSend({ type: 'UNDO_LAST_STEP' });
      if (resp?.session?.steps != null) updateStepCount(resp.session.steps.length);
      btn.disabled = false;
    });

    // Narration
    dfEl('df-mic').addEventListener('click', () => {
      if (isNarrating) stopNarration();
      else startNarration();
    });

    // Stop & Generate — one-click flow via service worker
    dfEl('df-stop-gen').addEventListener('click', async () => {
      const btn    = dfEl('df-stop-gen');
      const errEl  = dfEl('df-stop-gen-error');
      btn.disabled = true;
      btn.textContent = '⏳ A gerar...';
      if (errEl) errEl.classList.add('hidden');

      const result = await safeSend({ type: 'STOP_AND_GENERATE' }) ?? { error: 'Erro de comunicação' };

      // Sidebar may have been removed already — use alert for errors
      if (result?.error) {
        if (errEl && sidebarRoot) {
          errEl.textContent = result.error;
          errEl.classList.remove('hidden');
          if (btn && sidebarRoot) { btn.disabled = false; btn.textContent = '✨ Parar e Gerar'; }
        } else {
          window.alert('DocFlow: ' + result.error);
        }
      }
    });

    // Steps toggle
    dfEl('df-steps-toggle').addEventListener('click', async () => {
      const toggle = dfEl('df-steps-toggle');
      const list   = dfEl('df-steps-full');
      if (!list.classList.contains('hidden')) {
        list.classList.add('hidden');
        toggle.textContent = 'Ver passos ▾';
      } else {
        await loadAndRenderSteps();
        list.classList.remove('hidden');
        toggle.textContent = 'Ocultar ▴';
      }
    });

    // Step delete (event delegation)
    dfEl('df-steps-full').addEventListener('click', async e => {
      const btn = e.target.closest('.step-del-btn');
      if (!btn) return;
      const stepId = btn.dataset.stepId;
      if (!stepId) return;
      btn.disabled = true;
      const resp = await safeSend({ type: 'DELETE_STEP', stepId });
      if (resp?.session != null) {
        updateStepCount(resp.session.steps.length);
        const item = dfEl('df-steps-full')?.querySelector(`[data-step-id="${stepId}"]`);
        if (item) {
          item.remove();
          dfEl('df-steps-full')?.querySelectorAll('.step-item').forEach((el, i) => {
            el.querySelector('.step-item-num').textContent = i + 1;
          });
        }
        recentSteps = resp.session.steps.slice(-10).map(s => ({
          type: s.type, label: s.element?.label || s.note || s.pageTitle || s.type,
        }));
        updateMiniFeed();
      } else {
        btn.disabled = false;
      }
    });

    // Stop — show inline confirmation
    dfEl('df-stop').addEventListener('click', () => {
      dfEl('df-stop').classList.add('hidden');
      dfEl('df-stop-confirm').classList.remove('hidden');
    });

    dfEl('df-stop-cancel').addEventListener('click', () => {
      dfEl('df-stop-confirm').classList.add('hidden');
      dfEl('df-stop').classList.remove('hidden');
    });

    dfEl('df-stop-do').addEventListener('click', async () => {
      dfEl('df-stop-do').disabled = true;
      await safeSend({ type: 'STOP_SESSION' });
    });
  }

  function setupDrag() {
    const handle = dfEl('df-drag');
    if (!handle) return;

    handle.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();

      const hostRect = sidebarHost.getBoundingClientRect();
      const startY   = e.clientY;
      const startTop = hostRect.top;

      const move = mv => {
        mv.preventDefault();
        const newTop  = startTop + (mv.clientY - startY);
        const clamped = Math.max(0, Math.min(window.innerHeight - sidebarHost.offsetHeight, newTop));
        sidebarHost.style.top       = clamped + 'px';
        sidebarHost.style.transform = 'none';
      };

      const up = () => {
        sessionStorage.setItem('__df_sidebar_top__', sidebarHost.style.top);
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup',   up,   true);
      };

      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup',   up,   true);
    });
  }

  // ── Activate / Deactivate ─────────────────────────────────────────────────

  function attachListeners() {
    document.addEventListener('click',  handleClick,  true);
    document.addEventListener('input',  handleInput,  true);
    document.addEventListener('change', handleInput,  true);
    document.addEventListener('submit', handleSubmit, true);
    navObserver.observe(document.body, { childList: true, subtree: true });
  }

  function detachListeners() {
    document.removeEventListener('click',  handleClick,  true);
    document.removeEventListener('input',  handleInput,  true);
    document.removeEventListener('change', handleInput,  true);
    document.removeEventListener('submit', handleSubmit, true);
    navObserver.disconnect();
    inputTimers.forEach(clearTimeout);
    inputTimers.clear();
  }

  function activate(session) {
    if (isRecording) return;
    isPaused    = !!(session?.paused);
    stepCount   = session?.steps?.length || 0;
    isRecording = true;
    if (!isPaused) attachListeners();
    createSidebar(session);
  }

  function deactivate() {
    if (!isRecording) return;
    stopNarration();
    isRecording = false;
    isPaused    = false;
    detachListeners();
    removeSidebar();
  }

  function applyPauseState(newPaused) {
    if (isPaused === newPaused) return;
    isPaused = newPaused;
    if (isPaused) {
      stopNarration();
      detachListeners();
    } else {
      attachListeners();
    }
    updatePauseUI();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  chrome.runtime.sendMessage({ type: 'GET_SESSION' }, response => {
    if (chrome.runtime.lastError) return;
    const session = response?.session;
    if (session && !session.stoppedAt) activate(session);
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'SIDEBAR_VISIBILITY') {
      if (sidebarHost) sidebarHost.style.visibility = message.visible ? '' : 'hidden';
      return;
    }
    if (message.type !== 'SESSION_UPDATED') return;
    const session = message.session;
    if (session && !session.stoppedAt) {
      if (!isRecording) {
        activate(session);
      } else {
        applyPauseState(!!session.paused);
        updateStepCount(session.steps?.length ?? stepCount);
      }
    } else {
      deactivate();
    }
  });
})();
