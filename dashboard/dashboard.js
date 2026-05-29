'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let allSessions  = [];
let allDocuments = [];
let activeSession  = null;
let activeDoc      = null;
let selectedIds    = new Set();   // checkboxed sessions for combine
let activeTab      = 'steps';
let editMode       = false;
let editOriginal   = '';          // for cancel
let activeView     = 'sessions'; // 'sessions' | 'settings'
let settingsData   = null;       // cached settings from SW
let settingsProvider = 'anthropic';

// Skills state
let skillsList      = [];        // current skills array (builtin + custom)
let editingSkillId  = null;      // null = adding new, string = editing existing

// Step inline editing state
let editingStepId      = null;
let stepEditScreenshot = {}; // stepId → dataURL | null (remove) | undefined (unchanged)

// ── Document viewer state ──────────────────────────────────────────────────────
let markdownContent = '';
const screenshotEls = new Map();   // stepId → <figure> in screenshots grid

// Chat assistant state
let chatHistory       = [];
let chatSelectedRange = null;
let chatSelectedText  = '';

// Section regen state
let _regenPopover    = null;
let _regenCloseClick = null;

// Flag to avoid double-binding global doc features
let _docFeaturesSetUp = false;

// Document-centric view mode (clicking a doc in the sidebar, or viewing a combined result)
let activeDocMode = false;

const $ = id => document.getElementById(id);

// ── Boot ──────────────────────────────────────────────────────────────────────
(async function init() {
  await refreshData();
  renderSidebar();
  setupListeners();
  setupSettingsListeners();

  if (navigator.platform.includes('Mac')) {
    $('shortcut-hint').textContent = '⌘⇧D';
  } else {
    $('shortcut-hint').textContent = 'Ctrl+Shift+D';
  }

  // Check for pending generation triggered from popup
  const stored = await chrome.storage.local.get(['pendingStreamConfig', 'pendingSession']);
  if (stored.pendingStreamConfig && stored.pendingSession) {
    const cfg      = stored.pendingStreamConfig;
    const pendSess = stored.pendingSession;
    await chrome.storage.local.remove('pendingStreamConfig');

    const matched = allSessions.find(s => s.id === pendSess.id) || pendSess;
    activeSession = matched;
    activeDoc     = findDocForSession(activeSession.id);
    activeTab     = 'document';

    document.querySelectorAll('.session-card').forEach(c =>
      c.classList.toggle('active', c.dataset.id === activeSession.id)
    );
    $('main-empty').classList.add('hidden');
    $('session-detail').classList.remove('hidden');
    renderDetail();
    setTab('document');
    await startStreaming(cfg);
  } else {
    // ?manage= param: show that session in steps mode (no auto-redirect to doc view)
    const manageId = new URLSearchParams(window.location.search).get('manage');
    if (manageId) {
      const session = allSessions.find(s => s.id === manageId);
      if (session) selectSession(session, false);
    }
  }

  // Refresh when tab becomes visible again (user may have been recording)
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      await refreshData();
      renderSidebar();
      if (activeSession) {
        const updated = allSessions.find(s => s.id === activeSession.id);
        if (updated) {
          activeSession = updated;
          activeDoc     = findDocForSession(activeSession.id);
          renderDetail();
        }
      }
    }
  });
})();

async function refreshData() {
  const data = await chrome.storage.local.get(['sessionHistory', 'documentHistory']);
  allSessions  = data.sessionHistory  || [];
  allDocuments = data.documentHistory || [];
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function renderSidebar() {
  $('sidebar-count').textContent = allSessions.length;
  const list = $('session-list');
  list.innerHTML = '';

  if (!allSessions.length) {
    $('sidebar-empty').classList.remove('hidden');
  } else {
    $('sidebar-empty').classList.add('hidden');
    allSessions.forEach(session => {
      const card = buildCard(session);
      list.appendChild(card);
    });
  }

  renderDocList();
}

function buildCard(session) {
  const hasDoc    = !!findDocForSession(session.id);
  const isActive  = !session.stoppedAt;
  const steps     = session.steps?.length || 0;
  const shots     = session.steps?.filter(s => s.screenshot).length || 0;
  const dateStr   = fmtDate(session.startedAt);

  const card = document.createElement('div');
  card.className = 'session-card' +
    (activeSession?.id === session.id ? ' active' : '') +
    (selectedIds.has(session.id) ? ' checked' : '');
  card.dataset.id = session.id;

  card.innerHTML =
    `<input class="card-checkbox" type="checkbox" ${selectedIds.has(session.id) ? 'checked' : ''} title="Selecionar para combinar">` +
    `<div class="card-body">` +
      `<div class="card-name" title="${escAttr(session.title)}">${escHtml(session.title)}</div>` +
      `<div class="card-meta">${dateStr}</div>` +
      `<div class="card-badges">` +
        `<span class="card-badge card-badge-steps">${steps} passo${steps !== 1 ? 's' : ''}${shots ? ` · ${shots} 📷` : ''}</span>` +
        (isActive ? `<span class="card-badge card-badge-recording"><span class="card-rec-dot"></span>A gravar</span>` : '') +
        (hasDoc && !isActive ? `<span class="card-badge card-badge-doc">📄 Doc</span>` : '') +
      `</div>` +
    `</div>` +
    `<button class="card-delete" title="Apagar sessão" data-id="${escAttr(session.id)}">×</button>`;

  const checkbox = card.querySelector('.card-checkbox');
  checkbox.addEventListener('change', e => {
    e.stopPropagation();
    if (checkbox.checked) selectedIds.add(session.id);
    else                  selectedIds.delete(session.id);
    card.classList.toggle('checked', checkbox.checked);
    updateCombineBar();
  });

  card.querySelector('.card-delete').addEventListener('click', async e => {
    e.stopPropagation();
    await deleteSession(session.id);
  });

  card.addEventListener('click', e => {
    if (e.target === checkbox || e.target.classList.contains('card-delete')) return;
    selectSession(session);
  });

  return card;
}

function updateCombineBar() {
  const bar = $('combine-bar');
  const n   = selectedIds.size;
  if (n >= 2) {
    bar.style.display = 'flex';
    $('combine-label').textContent = `${n} sessões selecionadas`;
    $('btn-combine-generate').disabled = false;
  } else {
    bar.style.display = 'none';
  }
}

// ── Session detail ─────────────────────────────────────────────────────────────

function selectSession(session, autoDoc = true) {
  activeDocMode = false;
  activeView    = 'sessions';
  $('settings-panel').classList.add('hidden');
  $('btn-nav-settings').classList.remove('active');

  activeSession = session;
  activeDoc     = findDocForSession(session.id);
  // Auto-open doc tab when session has a document (unless explicitly told not to)
  activeTab     = (activeDoc && autoDoc) ? 'document' : 'steps';
  editMode      = false;

  document.querySelectorAll('.session-card').forEach(c => {
    c.classList.toggle('active', c.dataset.id === session.id);
  });

  renderDetail();
}

function findDocForSession(sessionId) {
  // Prefer exact single-session match, fall back to any doc that includes this session
  return allDocuments.find(d => d.sessionIds.length === 1 && d.sessionIds[0] === sessionId)
      || allDocuments.find(d => d.sessionIds.includes(sessionId))
      || null;
}

function getActiveSteps() {
  if (activeDocMode && activeDoc) {
    const steps = [];
    for (const sid of activeDoc.sessionIds) {
      const sess = allSessions.find(s => s.id === sid);
      if (sess?.steps) steps.push(...sess.steps);
    }
    return steps;
  }
  return activeSession?.steps || [];
}

function getActiveTitle() {
  return activeDoc?.title || activeSession?.title || 'DocFlow';
}

function renderDetail() {
  if (!activeSession) return;

  $('main-empty').classList.add('hidden');
  $('session-detail').classList.remove('hidden');

  $('detail-title').textContent = activeSession.title;

  const isRecording = !activeSession.stoppedAt;
  const steps  = activeSession.steps?.filter(s => s.type !== 'screenshot').length || 0;
  const shots  = activeSession.steps?.filter(s => s.screenshot).length || 0;
  const dateStr = fmtDate(activeSession.startedAt);
  $('detail-meta').textContent =
    `${dateStr} · ${steps} passo${steps !== 1 ? 's' : ''}` +
    (shots ? ` · ${shots} screenshot${shots !== 1 ? 's' : ''}` : '');

  // Recording banner
  $('recording-banner').classList.toggle('hidden', !isRecording);
  // Hide resume toast when re-rendering
  $('resume-toast').classList.add('hidden');

  // Tabs
  $('detail-tabs').classList.toggle('hidden', !activeDoc);

  // Button visibility
  $('btn-chat').classList.toggle('hidden', !activeDoc);
  $('btn-complement').classList.toggle('hidden', !activeDoc);
  $('btn-validate').classList.toggle('hidden', !activeDoc);
  $('btn-copy-md').classList.toggle('hidden', !activeDoc);
  $('btn-download-html').classList.toggle('hidden', !activeDoc);
  $('btn-download-docx').classList.toggle('hidden', !activeDoc);
  $('btn-edit-doc').classList.toggle('hidden', !activeDoc || editMode);
  // "Continuar" only for stopped sessions
  $('btn-resume-session').classList.toggle('hidden', isRecording);
  $('btn-generate-doc').textContent = activeDoc ? '↺ Regenerar' : '✨ Gerar com IA';

  $('gen-error').classList.add('hidden');

  setTab(activeTab);
}

function setTab(tab) {
  activeTab = tab;

  // Update tab buttons
  $('dtab-steps').classList.toggle('active', tab === 'steps');
  $('dtab-document').classList.toggle('active', tab === 'document');

  // Show pane
  $('pane-steps').classList.toggle('hidden', tab !== 'steps');
  $('pane-document').classList.toggle('hidden', tab !== 'document');

  if (tab === 'steps') {
    renderSteps();
  } else {
    renderDocumentView();
  }
}

// ── Steps rendering ────────────────────────────────────────────────────────────

function renderSteps() {
  const list = $('steps-list');
  list.innerHTML = '';

  const steps = activeSession.steps || [];
  const isRecording = !activeSession.stoppedAt;

  if (!steps.length) {
    list.innerHTML = `<p style="color:var(--text-muted);font-size:13px">Nenhum passo capturado.</p>`;
    return;
  }

  steps.forEach(step => {
    const excluded = !!step.excluded;
    const row = document.createElement('div');
    const icon = stepIcon(step.type);

    // ── Edit mode ──────────────────────────────────────────────────────────────
    if (editingStepId === step.id) {
      row.className = 'step-row step-editing';
      const currentText = getStepEditText(step);
      const placeholder = getStepEditPlaceholder(step);
      const canEditText = step.type !== 'screenshot';
      const imgSrc = stepEditScreenshot.hasOwnProperty(step.id)
        ? stepEditScreenshot[step.id]
        : step.screenshot;

      const textSection = canEditText
        ? `<div>` +
          `<div class="step-edit-section-label">Texto</div>` +
          `<textarea class="step-edit-input" id="edit-text-${escAttr(step.id)}" rows="2" ` +
            `placeholder="${escAttr(placeholder)}">${escHtml(currentText)}</textarea>` +
          `</div>`
        : '';

      const imgSection =
        `<div class="step-edit-img-section">` +
          (imgSrc
            ? `<img class="step-edit-img-preview" src="${escAttr(imgSrc)}" alt="Screenshot">`
            : `<div class="step-edit-img-placeholder">📷</div>`) +
          `<div class="step-edit-img-info">` +
            `<div class="step-edit-img-section-label step-edit-section-label">Screenshot</div>` +
            `<div class="step-edit-img-status">${imgSrc ? 'Screenshot atual' : 'Sem screenshot'}</div>` +
            `<div class="step-edit-img-btns">` +
              `<label class="btn btn-outline btn-sm step-edit-file-label" for="edit-img-input-${escAttr(step.id)}" style="cursor:pointer">` +
                (imgSrc ? '↺ Substituir' : '+ Adicionar') +
              `</label>` +
              `<input type="file" id="edit-img-input-${escAttr(step.id)}" ` +
                `class="step-edit-file-input hidden" accept="image/*" data-step-id="${escAttr(step.id)}">` +
              (imgSrc ? `<button class="btn btn-ghost btn-sm" data-remove-img="${escAttr(step.id)}">Remover</button>` : '') +
            `</div>` +
          `</div>` +
        `</div>`;

      row.innerHTML =
        `<span class="step-row-num">${step.index}</span>` +
        `<span class="step-row-icon">${icon}</span>` +
        `<div class="step-edit-form">` +
          textSection + imgSection +
          `<div class="step-edit-actions">` +
            `<button class="btn btn-primary btn-sm" data-save-edit="${escAttr(step.id)}">Guardar</button>` +
            `<button class="btn btn-ghost btn-sm" data-cancel-edit="${escAttr(step.id)}">Cancelar</button>` +
          `</div>` +
        `</div>`;

      list.appendChild(row);
      return; // skip normal render for this step
    }

    // ── Normal render ──────────────────────────────────────────────────────────
    row.className = 'step-row' +
      (step.screenshot && !excluded ? ' has-shot' : '') +
      (excluded ? ' step-excluded' : '');

    const label = buildStepLabel(step);

    const thumbHtml = step.screenshot && !excluded
      ? `<div class="thumb-wrap">` +
        `<img class="step-thumb" src="${step.screenshot}" alt="Screenshot passo ${step.index}" title="Clica para ampliar">` +
        buildAnnotationSVG(step.annotation) +
        `</div>`
      : '';

    const toggleHtml = !isRecording
      ? `<button class="step-exclude-btn${excluded ? ' is-excluded' : ''}" ` +
        `data-id="${escAttr(step.id)}" ` +
        `title="${excluded ? 'Reincluir no documento' : 'Excluir do documento'}">` +
        (excluded ? '↩' : '⊘') +
        `</button>`
      : '';

    const editBtnHtml = !isRecording
      ? `<button class="step-edit-btn" data-edit-step="${escAttr(step.id)}" title="Editar passo">✏</button>`
      : '';

    row.innerHTML =
      `<span class="step-row-num">${step.index}</span>` +
      `<span class="step-row-icon">${icon}</span>` +
      `<div class="step-row-body">` +
        `<div class="step-row-label">${label}</div>` +
        (step.pageTitle ? `<div class="step-row-page">${escHtml(step.pageTitle)}</div>` : '') +
      `</div>` +
      (excluded ? `<span class="step-excluded-badge">Excluído</span>` : '') +
      thumbHtml +
      toggleHtml + editBtnHtml;

    if (step.screenshot && !excluded) {
      row.querySelector('.thumb-wrap').addEventListener('click', () =>
        openLightbox(step.screenshot, annotationLabel(step), step.annotation)
      );
    }

    if (!isRecording) {
      row.querySelector('.step-exclude-btn').addEventListener('click', () =>
        toggleStepExclude(step.id)
      );
      row.querySelector('.step-edit-btn').addEventListener('click', () =>
        openStepEdit(step.id)
      );
    }

    list.appendChild(row);
  });

  // Attach file-input listeners for any open edit form
  attachStepEditFileListeners();

  // Update generate button label to reflect excluded count
  const excludedCount = steps.filter(s => s.excluded).length;
  const genBtn = $('btn-generate-doc');
  if (excludedCount > 0) {
    genBtn.textContent = `✨ Gerar (${excludedCount} passo${excludedCount !== 1 ? 's' : ''} excluído${excludedCount !== 1 ? 's' : ''})`;
  } else {
    genBtn.textContent = activeDoc ? '↺ Regenerar' : '✨ Gerar com IA';
  }
}

async function toggleStepExclude(stepId) {
  const step = activeSession.steps.find(s => s.id === stepId);
  if (!step) return;
  step.excluded = !step.excluded;

  // Persist to sessionHistory
  const data = await chrome.storage.local.get(['sessionHistory']);
  const history = (data.sessionHistory || []).map(s =>
    s.id === activeSession.id ? activeSession : s
  );
  await chrome.storage.local.set({ sessionHistory: history });
  allSessions = history;

  renderSteps();
  renderSidebar();
}

// ── Step inline editing ────────────────────────────────────────────────────────

function getStepEditText(step) {
  if (step.type === 'manual' || step.type === 'narration') return step.note || '';
  if (step.type === 'navigation') return step.pageTitle || '';
  return step.element?.label || '';
}

function getStepEditPlaceholder(step) {
  if (step.type === 'manual' || step.type === 'narration') return 'Texto da nota...';
  if (step.type === 'navigation') return 'Título da página...';
  if (step.type === 'screenshot') return '—';
  return 'Rótulo do elemento...';
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openStepEdit(stepId) {
  editingStepId = stepId;
  renderSteps();
  setTimeout(() => {
    const ta = document.querySelector('.step-edit-input');
    if (ta) { ta.focus(); ta.select(); }
  }, 0);
}

function closeStepEdit() {
  if (editingStepId) delete stepEditScreenshot[editingStepId];
  editingStepId = null;
  renderSteps();
}

async function saveStepEdit(stepId) {
  const step = activeSession.steps.find(s => s.id === stepId);
  if (!step) return;

  const ta = document.getElementById(`edit-text-${stepId}`);
  const newText = ta?.value.trim() ?? '';

  // Write back into the right field
  if (step.type === 'manual' || step.type === 'narration') {
    step.note = newText;
  } else if (step.type === 'navigation') {
    step.pageTitle = newText;
  } else if (step.type !== 'screenshot') {
    if (!step.element) step.element = {};
    step.element.label = newText;
  }

  // Apply screenshot change if any
  if (Object.prototype.hasOwnProperty.call(stepEditScreenshot, stepId)) {
    step.screenshot = stepEditScreenshot[stepId]; // null removes it
    delete stepEditScreenshot[stepId];
  }

  // Persist to sessionHistory
  const data = await chrome.storage.local.get(['sessionHistory']);
  const history = (data.sessionHistory || []).map(s =>
    s.id === activeSession.id ? activeSession : s
  );
  await chrome.storage.local.set({ sessionHistory: history });
  allSessions = history;

  editingStepId = null;
  renderSteps();
  renderSidebar();
}

function attachStepEditFileListeners() {
  document.querySelectorAll('.step-edit-file-input').forEach(input => {
    input.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const stepId = input.dataset.stepId;
      try {
        const dataUrl = await fileToDataUrl(file);
        stepEditScreenshot[stepId] = dataUrl;
        updateStepEditImgPreview(stepId, dataUrl);
      } catch (_) {}
      input.value = '';
    });
  });
}

function updateStepEditImgPreview(stepId, src) {
  const section = document.querySelector('.step-edit-img-section');
  if (!section) return;

  const statusEl = section.querySelector('.step-edit-img-status');
  const btnsEl   = section.querySelector('.step-edit-img-btns');

  if (src) {
    // Update or create image
    let img = section.querySelector('.step-edit-img-preview');
    if (img) {
      img.src = src;
    } else {
      const ph = section.querySelector('.step-edit-img-placeholder');
      img = document.createElement('img');
      img.className = 'step-edit-img-preview';
      img.alt = 'Screenshot';
      img.src = src;
      if (ph) ph.replaceWith(img); else section.prepend(img);
    }
    if (statusEl) statusEl.textContent = 'Screenshot selecionada';
    // Add remove btn if missing
    if (btnsEl && !btnsEl.querySelector('[data-remove-img]')) {
      const rm = document.createElement('button');
      rm.className = 'btn btn-ghost btn-sm';
      rm.dataset.removeImg = stepId;
      rm.textContent = 'Remover';
      btnsEl.appendChild(rm);
    }
    const lbl = btnsEl?.querySelector('.step-edit-file-label');
    if (lbl) lbl.textContent = '↺ Substituir';
  } else {
    // Show placeholder
    let img = section.querySelector('.step-edit-img-preview');
    if (img) {
      const ph = document.createElement('div');
      ph.className = 'step-edit-img-placeholder';
      ph.textContent = '📷';
      img.replaceWith(ph);
    }
    if (statusEl) statusEl.textContent = 'Sem screenshot';
    const removeBtn = btnsEl?.querySelector('[data-remove-img]');
    if (removeBtn) removeBtn.remove();
    const lbl = btnsEl?.querySelector('.step-edit-file-label');
    if (lbl) lbl.textContent = '+ Adicionar';
  }
}

function buildStepLabel(step) {
  if (step.type === 'navigation') {
    return `<strong>Navegação</strong> → ${escHtml(step.pageTitle || step.url || '—')}`;
  }
  if (step.type === 'manual') {
    return `<strong>Nota</strong>: ${escHtml(step.note || '—')}`;
  }
  if (step.type === 'screenshot') {
    return `<strong>Screenshot</strong> manual`;
  }
  if (step.type === 'narration') {
    return `<strong>Narração</strong>: <em>${escHtml(step.note || '—')}</em>`;
  }

  const typeLabels = { click: 'Clique', input: 'Preenchimento', select: 'Seleção', submit: 'Envio' };
  const typeStr = typeLabels[step.type] || step.type;
  const elementStr = step.element?.label ? ` em <strong>${escHtml(step.element.label)}</strong>` : '';
  const valueStr   = step.value && step.value !== '••••••'
    ? ` <span class="step-value">→ "${escHtml(step.value)}"</span>`
    : step.value === '••••••'
    ? ` <span class="step-value">→ ••••••</span>`
    : '';
  return `<strong>${escHtml(typeStr)}</strong>${elementStr}${valueStr}`;
}

function buildStepLabelPlain(step) {
  if (step.type === 'navigation') return step.pageTitle || step.url || 'Navegação';
  if (step.type === 'manual')     return step.note || 'Nota';
  if (step.type === 'screenshot') return 'Screenshot';
  if (step.type === 'narration')  return `Narração: ${step.note || ''}`;
  return step.element?.label || step.type;
}

// ── Document rendering ─────────────────────────────────────────────────────────

function renderDocumentView() {
  if (!activeDoc) return;
  markdownContent = activeDoc.markdown;
  const usedStepIds = renderDocumentContent();
  renderScreenshots(usedStepIds);
  setupRefBadge(activeDoc?.refFiles || activeSession?.refFiles, activeDoc?.refExcerpts || activeSession?.refExcerpts);
  setupSectionRegen();
  setupLightboxOnDocument();
  setupDocFeaturesOnce();
  $('doc-view').classList.remove('hidden');
  $('doc-edit').classList.add('hidden');
}

function renderDocumentContent() {
  const byIndex = new Map(
    getActiveSteps()
      .filter(s => s.screenshot)
      .map(s => [s.index, s])
  );

  let html = markdownToHtml(markdownContent);
  const usedStepIds = new Set();

  html = html.replace(/\{\{screenshot:(\d+)\}\}/g, (_, n) => {
    const step = byIndex.get(parseInt(n, 10));
    if (!step) return '';
    usedStepIds.add(step.id);
    const caption = annotationLabel(step);
    return `<figure class="inline-screenshot" data-step-id="${escAttr(step.id)}">` +
           `<div class="shot-wrap">` +
           `<img src="${step.screenshot}" alt="${escAttr(caption)}" loading="lazy">` +
           buildAnnotationSVG(step.annotation) +
           `</div>` +
           `<figcaption>${escHtml(caption)}</figcaption>` +
           `</figure>`;
  });

  $('document-content').innerHTML = html;
  return usedStepIds;
}

function renderScreenshots(usedStepIds = new Set()) {
  const stepsWithShot = getActiveSteps().filter(
    s => s.screenshot && !usedStepIds.has(s.id)
  );
  const section = $('screenshots-section');

  if (!stepsWithShot.length) {
    section?.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  $('screenshot-count').textContent = stepsWithShot.length;
  const grid = $('screenshots-grid');
  grid.innerHTML = '';
  screenshotEls.clear();

  stepsWithShot.forEach(step => {
    const fig      = document.createElement('figure');
    fig.className  = 'screenshot-item';
    fig.dataset.stepId = step.id;

    const wrap = document.createElement('div');
    wrap.className = 'shot-wrap';

    const img   = document.createElement('img');
    img.src     = step.screenshot;
    img.alt     = `Passo ${step.index}: ${buildStepLabelPlain(step)}`;
    img.loading = 'lazy';
    wrap.appendChild(img);

    const svgHtml = buildAnnotationSVG(step.annotation, 'slice');
    if (svgHtml) wrap.insertAdjacentHTML('beforeend', svgHtml);

    fig.appendChild(wrap);
    fig.addEventListener('click', () => openLightbox(step.screenshot, annotationLabel(step), step.annotation));

    const caption = document.createElement('figcaption');
    caption.textContent = `${step.index}. ${annotationLabel(step)}`;
    fig.appendChild(caption);

    grid.appendChild(fig);
    screenshotEls.set(step.id, fig);
  });
}

function setupLightboxOnDocument() {
  const el = $('document-content');
  if (!el || el.dataset.lightboxBound) return;
  el.dataset.lightboxBound = '1';
  el.addEventListener('click', e => {
    const fig = e.target.closest('.inline-screenshot');
    if (!fig) return;
    const step = getActiveSteps().find(s => s.id === fig.dataset.stepId);
    if (step) openLightbox(step.screenshot, annotationLabel(step), step.annotation);
  });
}

function setupDocFeaturesOnce() {
  if (_docFeaturesSetUp) return;
  _docFeaturesSetUp = true;
  setupChat();
}

// ── Generate ──────────────────────────────────────────────────────────────────

async function generateFor(sessionIds) {
  showGenOverlay(true);
  $('gen-error').classList.add('hidden');

  let result;
  try {
    result = await chrome.runtime.sendMessage({ type: 'GENERATE_DOCUMENT', sessionIds });
  } catch (err) {
    showGenOverlay(false);
    showGenError(`Erro de comunicação: ${err.message}`);
    return;
  }

  if (result?.error) {
    showGenOverlay(false);
    showGenError(result.error);
    return;
  }

  showGenOverlay(false);

  if (result?.streaming) {
    const cfg = await chrome.storage.local.get(['pendingStreamConfig']);
    if (!cfg.pendingStreamConfig) { showGenError('Erro ao iniciar streaming.'); return; }
    await chrome.storage.local.remove('pendingStreamConfig');
    setTab('document');
    await startStreaming(cfg.pendingStreamConfig);
  }
}

function showGenOverlay(show) {
  $('gen-overlay').classList.toggle('hidden', !show);
}

function showGenError(msg) {
  const el = $('gen-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── Delete session ─────────────────────────────────────────────────────────────

async function deleteSession(id) {
  if (!confirm('Apagar esta sessão? Esta ação não pode ser desfeita.')) return;

  const data = await chrome.storage.local.get(['sessionHistory', 'documentHistory']);
  const sessions  = (data.sessionHistory  || []).filter(s => s.id !== id);
  const documents = (data.documentHistory || []).filter(d => !d.sessionIds.includes(id));
  await chrome.storage.local.set({ sessionHistory: sessions, documentHistory: documents });

  selectedIds.delete(id);
  allSessions  = sessions;
  allDocuments = documents;

  const wasViewingDeleted = activeSession?.id === id ||
    (activeDocMode && activeDoc?.sessionIds.includes(id));
  if (wasViewingDeleted) {
    activeSession = null;
    activeDoc     = null;
    activeDocMode = false;
    $('session-detail').classList.add('hidden');
    $('main-empty').classList.remove('hidden');
  }

  renderSidebar();
  updateCombineBar();
}

// ── Document list (sidebar) ───────────────────────────────────────────────────

function renderDocList() {
  const list    = $('doc-list');
  const countEl = $('docs-count');
  const emptyEl = $('docs-empty');
  if (!list) return;

  list.innerHTML = '';
  countEl.textContent = allDocuments.length;

  if (!allDocuments.length) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  [...allDocuments]
    .sort((a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0))
    .forEach(doc => list.appendChild(buildDocCard(doc)));
}

function buildDocCard(doc) {
  const isActive  = activeDocMode && activeDoc?.id === doc.id;
  const dateStr   = doc.generatedAt ? fmtDate(doc.generatedAt) : '';
  const multiInfo = doc.sessionIds.length > 1 ? ` · ${doc.sessionIds.length} sessões` : '';

  const card = document.createElement('div');
  card.className = 'doc-card' + (isActive ? ' active' : '');
  card.dataset.id = doc.id;

  card.innerHTML =
    `<div class="card-body">` +
      `<div class="card-name" title="${escAttr(doc.title)}">${escHtml(doc.title)}</div>` +
      `<div class="card-meta">${dateStr}${multiInfo}</div>` +
    `</div>` +
    `<button class="card-delete" title="Apagar documento" data-doc-id="${escAttr(doc.id)}">×</button>`;

  card.querySelector('.card-delete').addEventListener('click', async e => {
    e.stopPropagation();
    await deleteDocument(e.currentTarget.dataset.docId);
  });

  card.addEventListener('click', e => {
    if (e.target.classList.contains('card-delete')) return;
    selectDocument(doc);
  });

  return card;
}

function selectDocument(doc) {
  activeDocMode   = true;
  activeDoc       = doc;
  activeTab       = 'document';
  editMode        = false;
  markdownContent = doc.markdown || '';

  // Deselect session cards; highlight doc card
  document.querySelectorAll('.session-card').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.doc-card').forEach(c =>
    c.classList.toggle('active', c.dataset.id === doc.id)
  );

  $('main-empty').classList.add('hidden');
  $('session-detail').classList.remove('hidden');

  renderDocumentDetail();
  setupDocFeaturesOnce();
}

function renderDocumentDetail() {
  $('detail-title').textContent = activeDoc?.title || 'Documento';
  $('detail-meta').textContent  = activeDoc?.generatedAt
    ? `${fmtDate(activeDoc.generatedAt)} · Documento gerado`
    : 'Documento gerado';

  $('recording-banner').classList.add('hidden');
  $('resume-toast').classList.add('hidden');
  $('detail-tabs').classList.add('hidden');

  // Buttons available in document-only view
  $('btn-chat').classList.remove('hidden');
  $('btn-complement').classList.add('hidden');
  $('btn-validate').classList.add('hidden');
  $('btn-copy-md').classList.remove('hidden');
  $('btn-download-html').classList.remove('hidden');
  $('btn-download-docx').classList.remove('hidden');
  $('btn-edit-doc').classList.toggle('hidden', editMode);
  $('btn-resume-session').classList.add('hidden');
  $('btn-generate-doc').classList.add('hidden');
  $('btn-delete-session').classList.add('hidden');

  $('gen-error').classList.add('hidden');

  $('pane-steps').classList.add('hidden');
  $('pane-document').classList.remove('hidden');
  $('doc-view').classList.remove('hidden');
  $('doc-edit').classList.add('hidden');

  renderDocumentView();
}

async function deleteDocument(docId) {
  if (!confirm('Apagar este documento? Esta ação não pode ser desfeita.')) return;

  const data = await chrome.storage.local.get(['documentHistory']);
  const docs  = (data.documentHistory || []).filter(d => d.id !== docId);
  await chrome.storage.local.set({ documentHistory: docs });
  allDocuments = docs;

  if (activeDoc?.id === docId) {
    activeDoc     = null;
    activeDocMode = false;
    $('session-detail').classList.add('hidden');
    $('main-empty').classList.remove('hidden');
  }

  renderDocList();
}

// ── Document editing ──────────────────────────────────────────────────────────

function enterEditMode() {
  if (!activeDoc) return;
  editMode     = true;
  editOriginal = activeDoc.markdown;

  $('doc-view').classList.add('hidden');
  $('doc-edit').classList.remove('hidden');
  ['btn-chat','btn-complement','btn-validate','btn-edit-doc',
   'btn-copy-md','btn-download-html','btn-download-docx','btn-generate-doc']
    .forEach(id => $(id)?.classList.add('hidden'));

  const ta = $('editor-textarea');
  ta.value = activeDoc.markdown;
  ta.focus();
  updateEditorPreview();
}

function exitEditMode(discard = false) {
  editMode = false;
  if (discard) activeDoc.markdown = editOriginal;
  if (!discard) markdownContent = activeDoc.markdown;

  $('doc-view').classList.remove('hidden');
  $('doc-edit').classList.add('hidden');

  if (activeDocMode) {
    renderDocumentDetail();
  } else {
    renderDetail(); // restores correct buttons and calls renderDocumentView via setTab
  }
}

function updateEditorPreview() {
  const md = $('editor-textarea').value;
  $('editor-preview').innerHTML = markdownToHtml(md);
}

async function saveEdit() {
  const md = $('editor-textarea').value;
  activeDoc.markdown = md;
  markdownContent    = md;

  const data = await chrome.storage.local.get(['documentHistory']);
  const docs = data.documentHistory || [];
  const idx  = docs.findIndex(d => d.id === activeDoc.id);
  if (idx !== -1) docs[idx].markdown = md;
  await chrome.storage.local.set({ documentHistory: docs });
  allDocuments = docs;

  exitEditMode(false);
}

// ── Export ────────────────────────────────────────────────────────────────────

async function copyMarkdown() {
  if (!markdownContent) return;
  await navigator.clipboard.writeText(markdownContent);
  const btn = $('btn-copy-md');
  btn.classList.add('copied');
  const prev = btn.innerHTML;
  btn.innerHTML = '✓ Copiado!';
  setTimeout(() => { btn.innerHTML = prev; btn.classList.remove('copied'); }, 2200);
}

function downloadHtml() {
  if (!markdownContent) return;
  const title = getActiveTitle();
  const html  = buildHtmlExport(markdownContent, { title, steps: getActiveSteps() });
  const blob  = new Blob([html], { type: 'text/html; charset=utf-8' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = sanitizeFilename(title) + '.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadDocx() {
  if (!markdownContent) return;
  exportToDocx(markdownContent, getActiveTitle());
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function openLightbox(src, caption, annotation) {
  const wrap = $('lightbox-img-wrap');
  $('lightbox-img').src = src;
  $('lightbox-caption').textContent = caption || '';

  const existingSvg = wrap.querySelector('.annotation-svg');
  if (existingSvg) existingSvg.remove();
  const svgHtml = buildAnnotationSVG(annotation, 'meet');
  if (svgHtml) wrap.insertAdjacentHTML('beforeend', svgHtml);

  $('lightbox').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  $('lightbox').classList.add('hidden');
  $('lightbox-img').src = '';
  const wrap = $('lightbox-img-wrap');
  const svg = wrap?.querySelector('.annotation-svg');
  if (svg) svg.remove();
  document.body.style.overflow = '';
}

// ── Event listeners ───────────────────────────────────────────────────────────

function setupListeners() {
  // Tab switching
  $('dtab-steps').addEventListener('click', () => setTab('steps'));
  $('dtab-document').addEventListener('click', () => setTab('document'));

  // Generate / Regenerate
  $('btn-generate-doc').addEventListener('click', async () => {
    if (!activeSession) return;
    const s        = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    const provider = s?.provider || 'anthropic';
    const hasKey   = provider === 'openai' ? s?.openaiUnlocked : s?.anthropicUnlocked;

    if (!hasKey) {
      showGenError('Chave API não configurada. Abre o Dashboard → Configurações.');
      return;
    }
    await generateFor([activeSession.id]);
  });

  // Combine + generate
  $('btn-combine-generate').addEventListener('click', async () => {
    const ids = Array.from(selectedIds);
    if (ids.length < 2) return;

    const s        = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    const provider = s?.provider || 'anthropic';
    const hasKey   = provider === 'openai' ? s?.openaiUnlocked : s?.anthropicUnlocked;

    if (!hasKey) {
      alert('Chave API não configurada. Abre o Dashboard → Configurações.');
      return;
    }

    await generateFor(ids);
  });

  $('btn-combine-clear').addEventListener('click', () => {
    selectedIds.clear();
    renderSidebar();
    updateCombineBar();
  });

  // Resume session
  $('btn-resume-session').addEventListener('click', async () => {
    if (!activeSession) return;
    const btn = $('btn-resume-session');
    btn.disabled = true;

    const result = await chrome.runtime.sendMessage({
      type:      'RESUME_SESSION',
      sessionId: activeSession.id,
    });

    btn.disabled = false;

    if (result?.error) {
      showGenError(result.error);
      return;
    }

    // Update local state and UI
    activeSession = result.session;
    const idx = allSessions.findIndex(s => s.id === activeSession.id);
    if (idx !== -1) allSessions[idx] = activeSession;

    $('recording-banner').classList.remove('hidden');
    $('btn-resume-session').classList.add('hidden');
    $('resume-toast').classList.remove('hidden');
    renderSidebar();

    // Re-select to keep the active card highlighted
    document.querySelectorAll('.session-card').forEach(c => {
      c.classList.toggle('active', c.dataset.id === activeSession.id);
    });
  });

  // Step inline editing — event delegation on steps-list
  $('steps-list').addEventListener('click', async e => {
    // Save
    const saveBtn = e.target.closest('[data-save-edit]');
    if (saveBtn) { await saveStepEdit(saveBtn.dataset.saveEdit); return; }

    // Cancel
    const cancelBtn = e.target.closest('[data-cancel-edit]');
    if (cancelBtn) {
      delete stepEditScreenshot[cancelBtn.dataset.cancelEdit];
      editingStepId = null;
      renderSteps();
      return;
    }

    // Remove image
    const removeBtn = e.target.closest('[data-remove-img]');
    if (removeBtn) {
      const stepId = removeBtn.dataset.removeImg;
      stepEditScreenshot[stepId] = null;
      updateStepEditImgPreview(stepId, null);
      return;
    }
  });

  // Chat assistant toggle
  $('btn-chat').addEventListener('click', toggleChat);

  // Validate
  $('btn-validate').addEventListener('click', runValidation);

  // Complement
  $('btn-complement').addEventListener('click', startComplement);

  // DOCX download
  $('btn-download-docx').addEventListener('click', downloadDocx);

  // Edit
  $('btn-edit-doc').addEventListener('click', enterEditMode);
  $('btn-save-edit').addEventListener('click', saveEdit);
  $('btn-cancel-edit').addEventListener('click', () => exitEditMode(true));

  // Editor live preview
  $('editor-textarea').addEventListener('input', updateEditorPreview);

  // Export
  $('btn-copy-md').addEventListener('click', copyMarkdown);
  $('btn-download-html').addEventListener('click', downloadHtml);

  // Delete
  $('btn-delete-session').addEventListener('click', () => {
    if (activeSession) deleteSession(activeSession.id);
  });

  // Lightbox
  $('lightbox-close').addEventListener('click', closeLightbox);
  $('lightbox').addEventListener('click', e => { if (e.target === $('lightbox')) closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('chat-panel').classList.contains('hidden')) { closeChat(); return; }
      if (!$('lightbox').classList.contains('hidden')) { closeLightbox(); return; }
      if (editingStepId) { delete stepEditScreenshot[editingStepId]; editingStepId = null; renderSteps(); return; }
      if (editMode) exitEditMode(true);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && editMode) {
      e.preventDefault();
      saveEdit();
    }
  });
}

// ── Screenshot annotation overlay ─────────────────────────────────────────────
// Coordinates are absolute CSS pixels from the original viewport (vw × vh).
// SVG viewBox + preserveAspectRatio mirrors the image's object-fit behaviour:
//   'slice' (xMidYMin) = object-fit:cover; object-position:top  (inline/thumb)
//   'meet'  (xMidYMid) = object-fit:contain; object-position:center (lightbox)

function buildAnnotationSVG(annotation, mode) {
  if (!annotation?.vw) return '';
  const { vw, vh, x, y, rect } = annotation;
  const isClick = x !== undefined && y !== undefined;
  const ar  = (mode === 'meet') ? 'xMidYMid meet' : 'xMidYMin slice';
  const sw  = Math.max(1, vw * 0.0018);

  const parts = [];

  if (rect && rect.w > 0 && rect.h > 0) {
    const color = isClick ? '#3b82f6' : '#f59e0b';
    const fill  = isClick ? 'rgba(59,130,246,0.07)' : 'rgba(245,158,11,0.1)';
    const rx    = Math.max(2, vw * 0.003);
    parts.push(
      `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" ` +
      `fill="${fill}" stroke="${color}" stroke-width="${sw * 1.5}" rx="${rx}"/>`
    );
  }

  if (isClick) {
    const r1 = vw * 0.016, r2 = vw * 0.009, r3 = vw * 0.004;
    parts.push(
      `<circle cx="${x}" cy="${y}" r="${r1}" fill="rgba(59,130,246,0.15)"/>`,
      `<circle cx="${x}" cy="${y}" r="${r2}" fill="rgba(59,130,246,0.45)" stroke="#3b82f6" stroke-width="${sw}"/>`,
      `<circle cx="${x}" cy="${y}" r="${r3}" fill="#3b82f6"/>`
    );
  }

  if (!parts.length) return '';
  return (
    `<svg class="annotation-svg" xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="${ar}" aria-hidden="true">` +
    parts.join('') + `</svg>`
  );
}

function annotationLabel(step) {
  if (!step.annotation) return `Passo ${step.index}`;
  if (step.annotation.x !== undefined) return `Passo ${step.index} · clique`;
  if (step.type === 'input')  return `Passo ${step.index} · preenchimento`;
  if (step.type === 'select') return `Passo ${step.index} · seleção`;
  return `Passo ${step.index}`;
}

// ── Crypto (AES-256-GCM + PBKDF2) ────────────────────────────────────────────

async function pbkdf2DeriveKey(pin, salt) {
  const enc = new TextEncoder();
  const mat = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    mat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptApiKey(plaintext, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await pbkdf2DeriveKey(pin, salt);
  const enc  = new TextEncoder();
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return {
    salt: Array.from(salt),
    iv:   Array.from(iv),
    data: Array.from(new Uint8Array(cipher)),
  };
}

async function decryptApiKey(encrypted, pin) {
  const salt = new Uint8Array(encrypted.salt);
  const iv   = new Uint8Array(encrypted.iv);
  const data = new Uint8Array(encrypted.data);
  const key  = await pbkdf2DeriveKey(pin, salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(plain);
}

// ── Settings ──────────────────────────────────────────────────────────────────

const PROVIDERS_CFG = {
  anthropic: {
    models: [
      { id: 'claude-opus-4-5',          label: 'Claude Opus 4.5 — mais capaz' },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 — equilíbrio' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — mais rápido' },
    ],
  },
  openai: {
    models: [
      { id: 'gpt-4o',      label: 'GPT-4o — mais capaz' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini — mais rápido' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    ],
  },
};

async function selectSettings() {
  // Hide session detail
  $('session-detail').classList.add('hidden');
  $('main-empty').classList.add('hidden');
  $('settings-panel').classList.remove('hidden');

  // Mark sidebar button active
  $('btn-nav-settings').classList.add('active');
  document.querySelectorAll('.session-card').forEach(c => c.classList.remove('active'));

  activeView = 'settings';
  activeSession = null;

  settingsData = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  renderSettings(settingsData);
}

function renderSettings(s) {
  if (!s) return;
  settingsProvider = s.provider || 'anthropic';

  // Provider tabs
  $('s-provider-tabs').querySelectorAll('.provider-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.provider === settingsProvider);
  });

  // Model select
  populateModelSelect(settingsProvider, s[settingsProvider === 'openai' ? 'openaiModel' : 'anthropicModel']);

  // Key sections visibility
  $('s-key-section-anthropic').classList.toggle('hidden', settingsProvider !== 'anthropic');
  $('s-key-section-openai').classList.toggle('hidden', settingsProvider !== 'openai');

  // Render key state for current provider
  renderKeyState('anthropic', s);
  renderKeyState('openai', s);

  // Screenshots toggle
  $('s-capture-screenshots').checked = s.captureScreenshots !== false;

  // Template
  $('s-template-toggle').checked = !!s.templateEnabled;
  $('s-template-area').classList.toggle('hidden', !s.templateEnabled);
  if (s.templateText) {
    $('s-template-text').value = s.templateText;
    updateTemplateChars();
  }

  // Skills
  skillsList = s.skills || [];
  renderSkills();
}

function populateModelSelect(provider, savedModel) {
  const sel = $('s-model-select');
  sel.innerHTML = '';
  PROVIDERS_CFG[provider].models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    sel.appendChild(opt);
  });
  if (savedModel) sel.value = savedModel;
}

function renderKeyState(provider, s) {
  const prefix = provider === 'openai' ? 's-oai' : 's-anth';
  const configured = provider === 'openai' ? s.openaiConfigured : s.anthropicConfigured;
  const unlocked   = provider === 'openai' ? s.openaiUnlocked   : s.anthropicUnlocked;
  const hint       = provider === 'openai' ? s.openaiKeyHint     : s.anthropicKeyHint;

  const stateSetup    = $(`${prefix}-state-setup`);
  const stateLocked   = $(`${prefix}-state-locked`);
  const stateUnlocked = $(`${prefix}-state-unlocked`);

  stateSetup.classList.add('hidden');
  stateLocked.classList.add('hidden');
  stateUnlocked.classList.add('hidden');

  if (!configured) {
    stateSetup.classList.remove('hidden');
  } else if (!unlocked) {
    stateLocked.classList.remove('hidden');
  } else {
    stateUnlocked.classList.remove('hidden');
    const hintEl = $(`${prefix}-hint`);
    if (hintEl) hintEl.textContent = hint || '';
  }
}

function showKeyMsg(id, text, type) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `key-msg ${type}`;
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 3000);
}

async function saveKey(provider) {
  const prefix  = provider === 'openai' ? 's-oai' : 's-anth';
  const msgId   = `${prefix}-msg`;
  const keyEl   = $(`${prefix}-key`);
  const pinEl   = $(`${prefix}-pin`);
  const pin2El  = $(`${prefix}-pin2`);

  const rawKey = keyEl.value.trim();
  const pin    = pinEl.value;
  const pin2   = pin2El.value;

  if (!rawKey) return showKeyMsg(msgId, 'Introduz a chave API.', 'error');
  if (pin.length < 4) return showKeyMsg(msgId, 'O PIN deve ter pelo menos 4 caracteres.', 'error');
  if (pin !== pin2)   return showKeyMsg(msgId, 'Os PINs não coincidem.', 'error');

  const btn = $(`${prefix}-save-btn`);
  btn.disabled = true;
  btn.textContent = 'A encriptar...';

  try {
    const encrypted = await encryptApiKey(rawKey, pin);
    const settingKey = provider === 'openai' ? 'openaiKeyEncrypted' : 'anthropicKeyEncrypted';

    // Save encrypted key to local storage settings
    const cur = await chrome.storage.local.get(['settings']);
    const cfg = cur.settings || {};
    cfg[settingKey] = encrypted;
    await chrome.storage.local.set({ settings: cfg });

    // Unlock for this session
    const sess = await chrome.storage.session.get(['unlockedKeys']).catch(() => ({}));
    const uk   = (sess.unlockedKeys) || {};
    uk[provider === 'openai' ? 'openaiKey' : 'anthropicKey'] = rawKey;
    await chrome.storage.session.set({ unlockedKeys: uk });

    // Clear inputs for security
    keyEl.value = '';
    pinEl.value = '';
    pin2El.value = '';

    // Refresh settings
    settingsData = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    renderKeyState(provider, settingsData);
    const hintEl = $(`${prefix}-hint`);
    if (hintEl) hintEl.textContent = settingsData[provider === 'openai' ? 'openaiKeyHint' : 'anthropicKeyHint'] || '';

    showKeyMsg(msgId, '✓ Chave guardada e encriptada!', 'success');
  } catch (err) {
    showKeyMsg(msgId, `Erro ao encriptar: ${err.message}`, 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Guardar e Encriptar';
}

async function unlockKey(provider) {
  const prefix = provider === 'openai' ? 's-oai' : 's-anth';
  const msgId  = `${prefix}-unlock-msg`;
  const pinEl  = $(`${prefix}-unlock-pin`);
  const pin    = pinEl.value;

  if (!pin) return showKeyMsg(msgId, 'Introduz o PIN.', 'error');

  const btn = $(`${prefix}-unlock-btn`);
  btn.disabled = true;
  btn.textContent = 'A desbloquear...';

  try {
    const cur = await chrome.storage.local.get(['settings']);
    const cfg = cur.settings || {};
    const encKey = provider === 'openai' ? cfg.openaiKeyEncrypted : cfg.anthropicKeyEncrypted;
    if (!encKey) throw new Error('Chave não encontrada.');

    const plainKey = await decryptApiKey(encKey, pin);

    // Store in session
    const sess = await chrome.storage.session.get(['unlockedKeys']).catch(() => ({}));
    const uk   = (sess.unlockedKeys) || {};
    uk[provider === 'openai' ? 'openaiKey' : 'anthropicKey'] = plainKey;
    await chrome.storage.session.set({ unlockedKeys: uk });

    pinEl.value = '';

    settingsData = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    renderKeyState(provider, settingsData);
    showKeyMsg(`${prefix}-unlock-msg`, '✓ Desbloqueada!', 'success');
  } catch (err) {
    const isWrongPin = err.name === 'OperationError' || err.message.includes('decrypt');
    showKeyMsg(msgId, isWrongPin ? 'PIN incorreto.' : `Erro: ${err.message}`, 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Desbloquear';
}

async function lockKey(provider) {
  const sess = await chrome.storage.session.get(['unlockedKeys']).catch(() => ({}));
  const uk   = (sess.unlockedKeys) || {};
  if (provider === 'openai') delete uk.openaiKey;
  else delete uk.anthropicKey;
  await chrome.storage.session.set({ unlockedKeys: uk });
  settingsData = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  renderKeyState(provider, settingsData);
}

async function resetKey(provider) {
  if (!confirm('Tens a certeza? A chave encriptada será eliminada e terás de configurá-la novamente.')) return;
  await chrome.runtime.sendMessage({ type: 'REMOVE_KEY', provider });
  settingsData = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  renderKeyState(provider, settingsData);
}

function updateTemplateChars() {
  const len = $('s-template-text').value.length;
  const el  = $('s-template-chars');
  el.textContent = len.toLocaleString('pt-PT') + ' caracteres';
  el.className = 'template-chars' + (len > 50000 ? ' over' : len > 30000 ? ' warn' : '');
}

// ── Skills ────────────────────────────────────────────────────────────────────

function renderSkills() {
  const list = $('skill-list');
  if (!list) return;

  if (!skillsList.length) {
    list.innerHTML = '<p class="skill-empty">Nenhuma skill configurada.</p>';
    return;
  }

  list.innerHTML = skillsList.map(skill => {
    const disabledClass = skill.enabled ? '' : ' skill-disabled';
    return `
      <div class="skill-card${disabledClass}" data-skill-id="${escHtml(skill.id)}">
        <div class="skill-card-header">
          <label class="toggle" title="${skill.enabled ? 'Desativar' : 'Ativar'} skill">
            <input type="checkbox" class="skill-toggle-cb" data-skill-id="${escHtml(skill.id)}"
              ${skill.enabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
          <div class="skill-card-info">
            <span class="skill-name">${escHtml(skill.name)}</span>
            ${skill.builtin ? '<span class="skill-badge-builtin">pré-definida</span>' : ''}
          </div>
          <div class="skill-card-actions">
            <button class="btn-icon-sm" data-action="edit" data-skill-id="${escHtml(skill.id)}" title="Editar">✏</button>
            <button class="btn-icon-sm danger" data-action="delete" data-skill-id="${escHtml(skill.id)}" title="Eliminar">×</button>
          </div>
        </div>
        <p class="skill-instruction">${escHtml(skill.instruction)}</p>
      </div>`;
  }).join('');

  // Wire toggle checkboxes
  list.querySelectorAll('.skill-toggle-cb').forEach(cb => {
    cb.addEventListener('change', () => toggleSkill(cb.dataset.skillId));
  });

  // Wire edit/delete buttons via delegation
  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { action, skillId } = btn.dataset;
      if (action === 'edit')   openSkillForm(skillId);
      if (action === 'delete') deleteSkill(skillId);
    });
  });
}

function openSkillForm(skillId = null) {
  editingSkillId = skillId;
  const skill = skillId ? skillsList.find(s => s.id === skillId) : null;
  $('sf-name').value        = skill ? skill.name        : '';
  $('sf-instruction').value = skill ? skill.instruction : '';
  $('skill-form').classList.remove('hidden');
  $('sf-name').focus();
}

function closeSkillForm() {
  editingSkillId = null;
  $('skill-form').classList.add('hidden');
  $('sf-name').value        = '';
  $('sf-instruction').value = '';
}

function saveSkillForm() {
  const name        = $('sf-name').value.trim();
  const instruction = $('sf-instruction').value.trim();
  if (!name)        { $('sf-name').focus();        return; }
  if (!instruction) { $('sf-instruction').focus(); return; }

  if (editingSkillId) {
    // Update existing
    skillsList = skillsList.map(s =>
      s.id === editingSkillId ? { ...s, name, instruction } : s
    );
  } else {
    // Add new custom skill
    skillsList = [...skillsList, {
      id:          'custom-' + Date.now(),
      name,
      instruction,
      enabled:     true,
      builtin:     false,
    }];
  }

  closeSkillForm();
  renderSkills();
  persistSkills();
}

function toggleSkill(skillId) {
  skillsList = skillsList.map(s =>
    s.id === skillId ? { ...s, enabled: !s.enabled } : s
  );
  renderSkills();
  persistSkills();
}

function deleteSkill(skillId) {
  skillsList = skillsList.filter(s => s.id !== skillId);
  renderSkills();
  persistSkills();
}

async function persistSkills() {
  await chrome.runtime.sendMessage({ type: 'SAVE_SKILLS', skills: skillsList });
}

function setupSettingsListeners() {
  $('btn-nav-settings').addEventListener('click', selectSettings);

  // Provider tabs
  $('s-provider-tabs').addEventListener('click', async e => {
    const tab = e.target.closest('.provider-tab');
    if (!tab || tab.dataset.provider === settingsProvider) return;
    settingsProvider = tab.dataset.provider;
    $('s-provider-tabs').querySelectorAll('.provider-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.provider === settingsProvider);
    });
    const modelKey = settingsProvider === 'openai' ? 'openaiModel' : 'anthropicModel';
    populateModelSelect(settingsProvider, settingsData?.[modelKey]);
    $('s-key-section-anthropic').classList.toggle('hidden', settingsProvider !== 'anthropic');
    $('s-key-section-openai').classList.toggle('hidden', settingsProvider !== 'openai');
  });

  // Key actions — Anthropic
  $('s-anth-save-btn').addEventListener('click',   () => saveKey('anthropic'));
  $('s-anth-unlock-btn').addEventListener('click', () => unlockKey('anthropic'));
  $('s-anth-lock-btn').addEventListener('click',   () => lockKey('anthropic'));
  $('s-anth-reset-btn').addEventListener('click',  () => resetKey('anthropic'));
  $('s-anth-change-btn').addEventListener('click', async () => {
    await lockKey('anthropic');
    await resetKey('anthropic');
  });

  // Key actions — OpenAI
  $('s-oai-save-btn').addEventListener('click',   () => saveKey('openai'));
  $('s-oai-unlock-btn').addEventListener('click', () => unlockKey('openai'));
  $('s-oai-lock-btn').addEventListener('click',   () => lockKey('openai'));
  $('s-oai-reset-btn').addEventListener('click',  () => resetKey('openai'));
  $('s-oai-change-btn').addEventListener('click', async () => {
    await lockKey('openai');
    await resetKey('openai');
  });

  // Template toggle
  $('s-template-toggle').addEventListener('change', () => {
    $('s-template-area').classList.toggle('hidden', !$('s-template-toggle').checked);
  });
  $('s-template-text').addEventListener('input', updateTemplateChars);

  $('s-template-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    $('s-template-text').value = await file.text();
    updateTemplateChars();
    $('s-template-file').value = '';
  });
  $('s-clear-template').addEventListener('click', () => {
    $('s-template-text').value = '';
    updateTemplateChars();
  });

  $('s-extract-style').addEventListener('click', async () => {
    const docText = $('s-template-text').value.trim();
    const msgEl   = $('s-extract-msg');
    if (!docText) { showKeyMsg('s-extract-msg', 'Cola o documento primeiro.', 'error'); return; }
    const btn = $('s-extract-style');
    const prev = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳ A extrair...';
    msgEl.classList.add('hidden');
    const result = await chrome.runtime.sendMessage({ type: 'EXTRACT_STYLE', documentText: docText });
    if (result?.error) {
      showKeyMsg('s-extract-msg', result.error, 'error');
    } else {
      $('s-template-text').value = result.styleGuide;
      updateTemplateChars();
      showKeyMsg('s-extract-msg', '✓ Guia de estilo extraído!', 'success');
    }
    btn.disabled = false; btn.textContent = prev;
  });

  // Skills
  $('btn-add-skill').addEventListener('click', () => openSkillForm(null));
  $('sf-cancel').addEventListener('click', closeSkillForm);
  $('sf-save').addEventListener('click', saveSkillForm);
  $('sf-instruction').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveSkillForm();
  });

  // Save preferences (non-key settings)
  $('s-save-prefs').addEventListener('click', async () => {
    const provider = settingsProvider;
    const modelKey = provider === 'openai' ? 'openaiModel' : 'anthropicModel';
    await chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      settings: {
        provider,
        [modelKey]:         $('s-model-select').value,
        captureScreenshots: $('s-capture-screenshots').checked,
        templateEnabled:    $('s-template-toggle').checked,
        templateText:       $('s-template-text').value.trim(),
      },
    });
    showKeyMsg('s-prefs-msg', '✓ Guardado!', 'success');
  });
}

// ── Markdown → HTML (with table support) ─────────────────────────────────────

function markdownToHtml(md) {
  const lines = md.split('\n');
  let html = '';
  let inOl = false, inUl = false, inP = false, inTable = false;
  let tableLines = [];

  function inline(raw) {
    return escHtml(raw)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      .replace(/`(.+?)`/g,       '<code>$1</code>');
  }
  function closeLists() {
    if (inOl) { html += '</ol>\n'; inOl = false; }
    if (inUl) { html += '</ul>\n'; inUl = false; }
  }
  function closeP() { if (inP) { html += '</p>\n'; inP = false; } }
  function flushTable() {
    if (!inTable) return;
    inTable = false;
    if (tableLines.length < 2) { tableLines = []; return; }
    const parseCells = line =>
      line.replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
    const headers = parseCells(tableLines[0]);
    const rows    = tableLines.slice(2).map(parseCells);
    tableLines = [];
    html += '<table>\n<thead>\n<tr>\n';
    headers.forEach(h => { html += `<th>${h}</th>\n`; });
    html += '</tr>\n</thead>\n';
    if (rows.length) {
      html += '<tbody>\n';
      rows.forEach(row => {
        html += '<tr>\n';
        row.forEach(cell => { html += `<td>${cell}</td>\n`; });
        html += '</tr>\n';
      });
      html += '</tbody>\n';
    }
    html += '</table>\n';
  }

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('|')) {
      closeP(); closeLists();
      inTable = true;
      tableLines.push(t);
      continue;
    } else if (inTable) {
      flushTable();
    }

    if (!t) { closeP(); closeLists(); continue; }

    if (t.startsWith('### ')) {
      closeP(); closeLists();
      html += `<h3>${inline(t.slice(4))}</h3>\n`;
    } else if (t.startsWith('## ')) {
      closeP(); closeLists();
      html += `<h2>${inline(t.slice(3))}</h2>\n`;
    } else if (t.startsWith('# ')) {
      closeP(); closeLists();
      html += `<h1>${inline(t.slice(2))}</h1>\n`;
    } else if (/^\d+\.\s/.test(t)) {
      closeP();
      if (inUl) { html += '</ul>\n'; inUl = false; }
      if (!inOl) { html += '<ol>\n'; inOl = true; }
      html += `<li>${inline(t.replace(/^\d+\.\s+/, ''))}</li>\n`;
    } else if (/^[-*]\s/.test(t)) {
      closeP();
      if (inOl) { html += '</ol>\n'; inOl = false; }
      if (!inUl) { html += '<ul>\n'; inUl = true; }
      html += `<li>${inline(t.slice(2))}</li>\n`;
    } else {
      closeLists();
      if (!inP) { html += '<p>'; inP = true; } else html += ' ';
      html += inline(t);
    }
  }
  closeP(); closeLists(); flushTable();
  return html;
}

// ── HTML export ───────────────────────────────────────────────────────────────

function buildHtmlExport(markdown, session) {
  const rendered = markdownToHtml(markdown);
  const dateStr  = new Date().toLocaleDateString('pt-PT', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const screenshots = (session.steps || [])
    .filter(s => s.screenshot)
    .map(s =>
      `<figure>
        <img src="${s.screenshot}" alt="Passo ${s.index}">
        <figcaption>Passo ${s.index}: ${escHtml(buildStepLabelPlain(s))}</figcaption>
      </figure>`
    ).join('\n');

  return `<!DOCTYPE html>
<html lang="pt-PT">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(session.title)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{max-width:800px;margin:0 auto;padding:48px 24px 80px;font-family:Georgia,serif;color:#1a1a1a;line-height:1.75}
    h1{font-size:2em;border-bottom:2px solid #1a1a1a;padding-bottom:.35em;margin-bottom:.6em;line-height:1.25}
    h2{font-size:1.35em;font-weight:600;margin-top:2.2em;margin-bottom:.5em;padding-bottom:.2em;border-bottom:1px solid #eee}
    h3{font-size:1.1em;font-weight:600;margin-top:1.5em;margin-bottom:.3em}
    p{margin:.8em 0}
    ol,ul{padding-left:1.5em;margin:.8em 0}
    li{margin:.4em 0}
    strong{font-weight:700}
    code{background:#f4f4f4;border:1px solid #e0e0e0;border-radius:3px;padding:1px 5px;font-size:.88em;font-family:monospace}
    .screenshots{margin-top:3em;padding-top:2em;border-top:1px solid #eee}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-top:1em}
    figure{margin:0}
    figure img{width:100%;border:1px solid #ddd;border-radius:4px;display:block}
    figcaption{font-size:11px;color:#888;margin-top:4px;text-align:center}
    footer{margin-top:3em;padding-top:1em;border-top:1px solid #eee;font-size:12px;color:#aaa;text-align:center}
  </style>
</head>
<body>
  <article>${rendered}</article>
  ${screenshots ? `<section class="screenshots"><h2>Screenshots</h2><div class="grid">${screenshots}</div></section>` : ''}
  <footer>Gerado com <strong>DocFlow</strong> em ${dateStr}</footer>
</body>
</html>`;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function stepIcon(type) {
  const icons = {
    click: '👆', input: '⌨️', select: '▾', navigation: '→',
    submit: '↵', manual: '📝', screenshot: '📷',
  };
  return icons[type] || '•';
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('pt-PT', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) { return escHtml(s).replace(/'/g, '&#39;'); }

function sanitizeFilename(name) {
  return (name || 'docflow')
    .replace(/[<>:"/\\|?*]/g, '').trim()
    .replace(/\s+/g, '_').slice(0, 80) || 'docflow';
}

// ── Streaming document generation ─────────────────────────────────────────────

async function startStreaming(config) {
  const contentEl = $('document-content');

  // Show which reference files were loaded before the API call begins
  const refFiles = config.refFiles || [];
  const refsHtml = refFiles.length
    ? `<div class="stream-refs">` +
      `<svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor" style="flex-shrink:0;opacity:.6">` +
      `<path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.396 0 2.7.35 3.834.992A7.967 7.967 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"/>` +
      `</svg>` +
      `<span><strong>${refFiles.length} ficheiro${refFiles.length > 1 ? 's' : ''} de referência lido${refFiles.length > 1 ? 's' : ''}:</strong> ` +
      refFiles.map(f => `<span class="stream-refs-file">${escHtml(f)}</span>`).join('') +
      `</span></div>`
    : '';

  contentEl.innerHTML =
    '<div class="stream-init"><div class="stream-cursor-block"></div>' +
    '<span>A gerar documentação…</span></div>' +
    refsHtml;

  let apiKey;
  try {
    const [sess, local] = await Promise.all([
      chrome.storage.session.get(['unlockedKeys']).catch(() => ({})),
      chrome.storage.local.get(['anthropicKey', 'openaiKey', 'apiKey']),
    ]);
    const uk = sess.unlockedKeys || {};
    apiKey = config.provider === 'openai'
      ? (uk.openaiKey  || local.openaiKey)
      : (uk.anthropicKey || local.anthropicKey || local.apiKey);
  } catch (err) {
    contentEl.innerHTML = `<div class="stream-error">Erro ao obter chave de API: ${escHtml(err.message)}</div>`;
    return;
  }

  if (!apiKey) {
    contentEl.innerHTML =
      '<div class="stream-error">Chave de API não configurada. ' +
      'Abre o Dashboard → Configurações.</div>';
    return;
  }

  let accum = '';
  let lastRender = 0;
  const RENDER_MS = 120;

  function onChunk(text) {
    accum += text;
    const now = Date.now();
    if (now - lastRender > RENDER_MS) {
      contentEl.innerHTML =
        markdownToHtml(accum) +
        '<span class="stream-cursor-inline" aria-hidden="true"></span>';
      lastRender = now;
    }
  }

  try {
    if (config.provider === 'openai') {
      await streamOpenAI(config, apiKey, onChunk);
    } else {
      await streamAnthropic(config, apiKey, onChunk);
    }
  } catch (err) {
    if (!accum) {
      contentEl.innerHTML = `<div class="stream-error">${escHtml(err.message)}</div>`;
      return;
    }
  }

  markdownContent = accum;

  await chrome.runtime.sendMessage({
    type:        'SAVE_GENERATED_DOC',
    sessionIds:  config.sessionIds,
    title:       config.title,
    markdown:    markdownContent,
    refFiles:    config.refFiles    || [],
    refExcerpts: config.refExcerpts || {},
  }).catch(() => {});

  // Refresh local documents
  const fresh = await chrome.storage.local.get(['documentHistory']);
  allDocuments = fresh.documentHistory || [];

  // Find the newly saved doc (match by sessionIds set)
  const newDoc = allDocuments.find(d =>
    d.sessionIds.length === config.sessionIds.length &&
    config.sessionIds.every(id => d.sessionIds.includes(id))
  ) || allDocuments[allDocuments.length - 1] || null;
  activeDoc = newDoc;

  const isCombined = config.sessionIds.length > 1;
  if (isCombined) {
    activeDocMode = true;
    selectedIds.clear();
    $('combine-bar').style.display = 'none';
    document.querySelectorAll('.session-card').forEach(c => c.classList.remove('checked'));
    document.querySelectorAll('.card-checkbox').forEach(c => { c.checked = false; });
  } else {
    activeDocMode = false;
  }

  const usedStepIds = renderDocumentContent();
  renderScreenshots(usedStepIds);
  setupRefBadge(activeDoc?.refFiles || activeSession?.refFiles, activeDoc?.refExcerpts || config.refExcerpts);
  setupSectionRegen();
  setupLightboxOnDocument();
  setupDocFeaturesOnce();

  if (isCombined) {
    renderDocumentDetail();
  } else {
    renderDetail();
  }
  renderSidebar(); // also calls renderDocList
}

async function streamAnthropic(config, apiKey, onChunk) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      config.model,
      max_tokens: 8192,
      stream:     true,
      system:     [{ type: 'text', text: config.effectiveSystemPrompt, cache_control: { type: 'ephemeral' } }],
      messages:   [{ role: 'user', content: config.userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erro Anthropic: ${response.status}`);
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let   buf     = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') return;
      try {
        const ev = JSON.parse(raw);
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          onChunk(ev.delta.text);
        }
      } catch (_) {}
    }
  }
}

async function streamOpenAI(config, apiKey, onChunk) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:      config.model,
      max_tokens: 8192,
      stream:     true,
      messages:   [
        { role: 'system', content: config.effectiveSystemPrompt },
        { role: 'user',   content: config.userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erro OpenAI: ${response.status}`);
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let   buf     = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') return;
      try {
        const ev      = JSON.parse(raw);
        const content = ev.choices?.[0]?.delta?.content;
        if (content) onChunk(content);
      } catch (_) {}
    }
  }
}

// ── Reference badge ───────────────────────────────────────────────────────────

function setupRefBadge(refFiles, refExcerpts) {
  const badge   = $('ref-badge');
  const popover = $('ref-popover');
  const list    = $('ref-popover-list');
  if (!badge) return;

  if (!refFiles?.length) {
    badge.classList.add('hidden');
    return;
  }

  const excerpts = refExcerpts || {};
  const n = refFiles.length;
  badge.textContent = `📚 ${n} referência${n > 1 ? 's' : ''}`;
  badge.classList.remove('hidden');

  list.innerHTML = refFiles.map(f => {
    const excerpt = excerpts[f];
    const hasExcerpt = excerpt && excerpt.trim().length > 0;
    return (
      `<li class="ref-popover-item" data-file="${escAttr(f)}">` +
      `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" class="ref-file-icon">` +
      `<path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/>` +
      `</svg>` +
      `<span class="ref-item-name">${escHtml(f)}</span>` +
      (hasExcerpt
        ? `<button class="ref-excerpt-toggle" data-file="${escAttr(f)}" title="Ver conteúdo extraído">Ver conteúdo</button>`
        : '') +
      `</li>` +
      (hasExcerpt
        ? `<li class="ref-excerpt-body hidden" data-excerpt-for="${escAttr(f)}"><pre>${escHtml(excerpt)}${excerpt.length >= 600 ? '\n…' : ''}</pre></li>`
        : '')
    );
  }).join('');

  // Excerpt toggle clicks
  list.querySelectorAll('.ref-excerpt-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const file    = btn.dataset.file;
      const body    = list.querySelector(`[data-excerpt-for="${CSS.escape(file)}"]`);
      if (!body) return;
      const open = !body.classList.contains('hidden');
      body.classList.toggle('hidden', open);
      btn.textContent = open ? 'Ver conteúdo' : 'Ocultar';
    });
  });

  if (badge.dataset.popoverBound) return;
  badge.dataset.popoverBound = '1';

  badge.addEventListener('click', e => {
    e.stopPropagation();
    if (!popover.classList.contains('hidden')) { popover.classList.add('hidden'); return; }
    const r = badge.getBoundingClientRect();
    popover.style.top  = `${r.bottom + 6}px`;
    popover.style.left = `${r.left}px`;
    popover.classList.remove('hidden');
  });
  document.addEventListener('click', e => {
    if (!popover.contains(e.target) && e.target !== badge) popover.classList.add('hidden');
  });
}

// ── Complement ────────────────────────────────────────────────────────────────

async function startComplement() {
  const btn   = $('btn-complement');
  const toast = $('complement-toast');
  if (!btn || btn.disabled) return;
  btn.disabled = true;

  try {
    await chrome.runtime.sendMessage({
      type: 'START_SESSION',
      title: activeSession.title,
      complementOf: {
        sessionId: activeSession.id,
        title:     activeSession.title,
        markdown:  markdownContent,
      },
    });
    btn.innerHTML = '✓ Gravação iniciada';
    btn.classList.add('complement-active');
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 8000);
  } catch (err) {
    btn.disabled = false;
    console.error('[DocFlow] Failed to start complement session:', err);
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

async function runValidation() {
  const btn   = $('btn-validate');
  const panel = $('validation-panel');
  if (!panel || !btn) return;

  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML =
    '<svg class="spin-icon" width="13" height="13" viewBox="0 0 20 20" fill="currentColor">' +
    '<path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/>' +
    '</svg> A validar…';

  panel.classList.remove('hidden');
  panel.innerHTML = '<div class="validation-loading"><div class="spinner-sm"></div> A analisar o documento…</div>';

  try {
    const result = await chrome.runtime.sendMessage({
      type:     'VALIDATE_DOCUMENT',
      markdown: markdownContent,
      steps:    activeSession.steps,
    });

    btn.disabled  = false;
    btn.innerHTML = originalHtml;

    if (result?.error) {
      panel.innerHTML = `<div class="validation-error">${escHtml(result.error)}</div>`;
      return;
    }
    renderValidationResult(result.result);
  } catch (err) {
    btn.disabled  = false;
    btn.innerHTML = originalHtml;
    panel.innerHTML = `<div class="validation-error">${escHtml(err.message)}</div>`;
  }
}

function renderValidationResult(data) {
  const panel = $('validation-panel');
  const score = Math.round(data.score ?? 0);
  const scoreColor = score >= 80 ? 'var(--green)' : score >= 55 ? '#f59e0b' : '#ef4444';

  let html =
    `<div class="validation-header">` +
      `<div class="validation-score" style="color:${scoreColor}">${score}<span>%</span></div>` +
      `<div class="validation-summary">${escHtml(data.summary || '')}</div>` +
      `<button class="validation-close" id="validation-close">✕</button>` +
    `</div>`;

  if (data.issues?.length) {
    html += `<div class="validation-section"><div class="validation-section-title">Pontos a melhorar</div>`;
    data.issues.forEach(issue => {
      html +=
        `<div class="validation-item validation-issue">` +
        `<span class="vi-icon">${issue.type === 'missing' ? '⚠' : '⚡'}</span>` +
        `<span>${escHtml(issue.description)}</span></div>`;
    });
    html += '</div>';
  }
  if (data.ok?.length) {
    html += `<div class="validation-section"><div class="validation-section-title">Pontos positivos</div>`;
    data.ok.forEach(item => {
      html +=
        `<div class="validation-item validation-ok">` +
        `<span class="vi-icon">✓</span><span>${escHtml(item)}</span></div>`;
    });
    html += '</div>';
  }

  panel.innerHTML = html;
  $('validation-close').addEventListener('click', () => panel.classList.add('hidden'));
}

// ── Section regeneration ──────────────────────────────────────────────────────

function setupSectionRegen() {
  const contentEl = $('document-content');
  if (!contentEl) return;
  contentEl.querySelectorAll('h2, h3').forEach(h => {
    if (h.querySelector('.section-regen-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'section-regen-btn';
    btn.title     = 'Regenerar esta secção com IA';
    btn.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor">' +
      '<path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/>' +
      '</svg>';
    h.appendChild(btn);
    btn.addEventListener('click', e => { e.stopPropagation(); openRegenPopover(h, btn); });
  });
}

function openRegenPopover(heading, triggerBtn) {
  closeRegenPopover();
  const popover = document.createElement('div');
  popover.className = 'regen-popover';
  popover.id        = 'regen-popover';

  const headingText = heading.childNodes[0]?.textContent?.trim() || heading.textContent.trim();
  popover.innerHTML =
    `<div class="regen-popover-title">Regenerar secção</div>` +
    `<div class="regen-popover-heading">${escHtml(headingText)}</div>` +
    `<textarea class="regen-popover-input" rows="2" ` +
      `placeholder="Instrução… ex: simplifica, adiciona mais detalhe, torna mais formal"></textarea>` +
    `<div class="regen-popover-actions">` +
      `<button class="regen-cancel">Cancelar</button>` +
      `<button class="regen-submit">Regenerar</button>` +
    `</div>` +
    `<div class="regen-status hidden"></div>`;

  document.body.appendChild(popover);
  _regenPopover = popover;

  const rect = triggerBtn.getBoundingClientRect();
  const popW = 300;
  popover.style.position = 'fixed';
  popover.style.top      = `${rect.bottom + 6}px`;
  popover.style.left     = `${Math.max(8, Math.min(rect.left, window.innerWidth - popW - 8))}px`;
  popover.style.width    = `${popW}px`;
  popover.style.zIndex   = '500';

  popover.querySelector('.regen-popover-input').focus();
  popover.querySelector('.regen-cancel').addEventListener('click', closeRegenPopover);

  async function submit() {
    const instruction = popover.querySelector('.regen-popover-input').value.trim();
    if (!instruction) return;
    await doSectionRegen(heading, instruction, popover);
  }
  popover.querySelector('.regen-submit').addEventListener('click', submit);
  popover.querySelector('.regen-popover-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') closeRegenPopover();
  });

  _regenCloseClick = e => {
    if (_regenPopover && !_regenPopover.contains(e.target)) closeRegenPopover();
  };
  setTimeout(() => document.addEventListener('mousedown', _regenCloseClick), 0);
}

function closeRegenPopover() {
  if (_regenCloseClick) document.removeEventListener('mousedown', _regenCloseClick);
  _regenCloseClick = null;
  _regenPopover?.remove();
  _regenPopover = null;
}

function extractSectionMarkdown(headingText, headingLevel) {
  const lines  = markdownContent.split('\n');
  const prefix = '#'.repeat(headingLevel) + ' ';
  const stripMd = t => t.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').trim();

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(prefix)) continue;
    if (stripMd(lines[i].slice(prefix.length)) === stripMd(headingText)) { start = i; break; }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6}) /);
    if (m && m[1].length <= headingLevel) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

async function doSectionRegen(heading, instruction, popover) {
  const submitBtn = popover.querySelector('.regen-submit');
  const statusEl  = popover.querySelector('.regen-status');
  submitBtn.disabled    = true;
  submitBtn.textContent = 'A regenerar…';
  statusEl.classList.remove('hidden');
  statusEl.textContent  = 'A contactar a IA…';

  const level       = parseInt(heading.tagName[1], 10);
  const headingText = heading.childNodes[0]?.textContent?.trim() || heading.textContent.trim();
  const sectionMd   = extractSectionMarkdown(headingText, level);

  if (!sectionMd) {
    statusEl.textContent = 'Não foi possível localizar a secção no Markdown.';
    submitBtn.disabled = false; submitBtn.textContent = 'Regenerar';
    return;
  }

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'REGENERATE_SECTION', sectionMarkdown: sectionMd, instruction,
    });

    if (result?.error) {
      statusEl.textContent = `Erro: ${result.error}`;
      submitBtn.disabled = false; submitBtn.textContent = 'Regenerar';
      return;
    }

    markdownContent = markdownContent.replace(sectionMd, result.markdown);
    closeRegenPopover();
    renderDocumentContent();
    setupSectionRegen();

    const allH = $('document-content').querySelectorAll('h2, h3');
    for (const h of allH) {
      const ht = h.childNodes[0]?.textContent?.trim() || h.textContent.trim();
      if (ht === headingText) {
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        h.classList.add('regen-highlight');
        setTimeout(() => h.classList.remove('regen-highlight'), 2000);
        break;
      }
    }
  } catch (err) {
    statusEl.textContent = `Erro: ${err.message}`;
    submitBtn.disabled = false; submitBtn.textContent = 'Regenerar';
  }
}

// ── Chat assistant ────────────────────────────────────────────────────────────

function setupChat() {
  const floatBtn  = $('btn-chat-select');
  const panel     = $('chat-panel');
  const closeBtn  = $('chat-close');
  const clearBtn  = $('chat-clear');
  const sendBtn   = $('chat-send');
  const inputEl   = $('chat-input');
  const ctxRemove = $('chat-ctx-remove');

  $('document-content').addEventListener('mouseup', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { floatBtn.classList.add('hidden'); return; }
    const text = sel.toString().trim();
    if (text.length < 10) { floatBtn.classList.add('hidden'); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    floatBtn.style.top  = `${rect.bottom + 8}px`;
    floatBtn.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - 160))}px`;
    floatBtn.classList.remove('hidden');
  });

  document.addEventListener('mousedown', e => {
    if (e.target === floatBtn) return;
    if (!e.target.closest('#document-content')) floatBtn.classList.add('hidden');
  });

  floatBtn.addEventListener('click', () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    chatSelectedRange = sel.getRangeAt(0).cloneRange();
    chatSelectedText  = sel.toString().trim();
    sel.removeAllRanges();
    floatBtn.classList.add('hidden');
    setContextBar(chatSelectedText);
    openChat();
    inputEl.focus();
  });

  closeBtn.addEventListener('click', closeChat);

  clearBtn.addEventListener('click', () => {
    chatHistory = [];
    chatSelectedRange = null;
    chatSelectedText  = '';
    $('chat-messages').innerHTML =
      `<div class="chat-empty" id="chat-empty">
        <div class="chat-empty-icon">💬</div>
        <p>Seleciona texto no documento e clica em <strong>Enviar para chat</strong> para melhorá-lo com instruções.</p>
        <p style="margin-top:8px;font-size:12px">Ou escreve diretamente uma pergunta ou instrução.</p>
      </div>`;
    $('chat-ctx-bar').classList.add('hidden');
  });

  ctxRemove.addEventListener('click', () => {
    chatSelectedRange = null;
    chatSelectedText  = '';
    $('chat-ctx-bar').classList.add('hidden');
  });

  sendBtn.addEventListener('click', sendChatMessage);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendChatMessage(); }
  });
}

function openChat() {
  $('chat-panel').classList.remove('hidden');
  $('btn-chat').classList.add('btn-chat-active');
}

function closeChat() {
  $('chat-panel').classList.add('hidden');
  $('btn-chat').classList.remove('btn-chat-active');
}

function toggleChat() {
  if ($('chat-panel').classList.contains('hidden')) {
    openChat();
    $('chat-input').focus();
  } else {
    closeChat();
  }
}

function setContextBar(text) {
  $('chat-ctx-text').textContent = text.length > 80 ? text.slice(0, 80) + '…' : text;
  $('chat-ctx-bar').classList.remove('hidden');
}

async function sendChatMessage() {
  const inputEl     = $('chat-input');
  const instruction = inputEl.value.trim();
  if (!instruction) return;

  const savedRange = chatSelectedRange;
  const savedText  = chatSelectedText;
  let userContent  = instruction;
  if (savedText) userContent = `[TEXTO SELECIONADO]\n${savedText}\n[/TEXTO SELECIONADO]\n\n${instruction}`;

  appendUserMessage(instruction, savedText);
  chatHistory.push({ role: 'user', content: userContent });

  inputEl.value     = '';
  chatSelectedRange = null;
  chatSelectedText  = '';
  $('chat-ctx-bar').classList.add('hidden');

  const messagesEl = $('chat-messages');
  const typingEl   = document.createElement('div');
  typingEl.className = 'chat-msg chat-msg-ai';
  typingEl.innerHTML = '<div class="chat-typing"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(typingEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const result = await chrome.runtime.sendMessage({ type: 'CHAT_IMPROVE', history: chatHistory });
    typingEl.remove();
    if (result?.error) throw new Error(result.error);

    const raw           = result?.response || '';
    const improvedMatch = raw.match(/\[MELHORIA\]([\s\S]*?)\[\/MELHORIA\]/);
    const improved      = improvedMatch ? improvedMatch[1].trim() : null;
    const explanation   = raw.replace(/\[MELHORIA\][\s\S]*?\[\/MELHORIA\]/, '').trim();

    chatHistory.push({ role: 'assistant', content: raw });
    appendAssistantMessage(explanation, improved, savedRange, savedText);
  } catch (err) {
    typingEl.remove();
    const errorEl = document.createElement('div');
    errorEl.className = 'chat-msg chat-msg-ai';
    errorEl.innerHTML = `<div class="chat-error">${escHtml(err.message || 'Erro ao contactar o assistente.')}</div>`;
    messagesEl.appendChild(errorEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    chatHistory.pop();
  }
}

function appendUserMessage(instruction, selectedText) {
  const messagesEl = $('chat-messages');
  $('chat-empty')?.remove();

  const msg = document.createElement('div');
  msg.className = 'chat-msg chat-msg-user';
  let inner = '';
  if (selectedText) {
    const preview = selectedText.length > 60 ? selectedText.slice(0, 60) + '…' : selectedText;
    inner += `<div class="chat-msg-ctx-pill">"${escHtml(preview)}"</div>`;
  }
  inner += `<div class="chat-bubble">${escHtml(instruction)}</div>`;
  msg.innerHTML = inner;
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendAssistantMessage(explanation, improved, savedRange, savedText) {
  const messagesEl = $('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'chat-msg chat-msg-ai';

  let inner = '';
  if (explanation) inner += `<div class="chat-bubble">${escHtml(explanation)}</div>`;

  if (improved) {
    const impId = 'imp-' + Date.now();
    inner +=
      `<div class="chat-improved" id="${impId}">` +
        `<div class="chat-improved-label">Sugestão de melhoria</div>` +
        `<div class="chat-improved-text">${escHtml(improved)}</div>` +
        `<div class="chat-improved-actions">` +
          `<button class="chat-btn-accept">Aplicar no documento</button>` +
          `<button class="chat-btn-copy">Copiar</button>` +
        `</div>` +
      `</div>`;
  }

  msg.innerHTML = inner;

  if (improved) {
    msg.querySelector('.chat-btn-accept').addEventListener('click', function() {
      applyImprovement(improved, savedText, savedRange, this);
    });
    msg.querySelector('.chat-btn-copy').addEventListener('click', async function() {
      await navigator.clipboard.writeText(improved);
      const prev = this.textContent;
      this.textContent = 'Copiado!';
      setTimeout(() => { this.textContent = prev; }, 2000);
    });
  }

  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function applyImprovement(improved, originalText, range, acceptBtn) {
  if (!range) {
    if (acceptBtn) { acceptBtn.textContent = 'Sem selecção activa'; acceptBtn.disabled = true; }
    return;
  }
  try {
    range.deleteContents();
    const node = document.createTextNode(improved);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
  } catch (e) {}

  if (originalText && markdownContent.includes(originalText)) {
    markdownContent = markdownContent.replace(originalText, improved);
  }
  if (acceptBtn) { acceptBtn.textContent = 'Aplicado ✓'; acceptBtn.disabled = true; }
}
