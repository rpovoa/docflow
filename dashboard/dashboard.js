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
    return;
  }
  $('sidebar-empty').classList.add('hidden');

  allSessions.forEach(session => {
    const card = buildCard(session);
    list.appendChild(card);
  });
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

function selectSession(session) {
  activeView = 'sessions';
  $('settings-panel').classList.add('hidden');
  $('btn-nav-settings').classList.remove('active');

  activeSession = session;
  activeDoc     = findDocForSession(session.id);
  activeTab     = activeDoc ? 'document' : 'steps';
  editMode      = false;

  // Update sidebar active state
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
  $('btn-copy-md').classList.toggle('hidden', !activeDoc);
  $('btn-download-html').classList.toggle('hidden', !activeDoc);
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
    row.className = 'step-row' +
      (step.screenshot && !excluded ? ' has-shot' : '') +
      (excluded ? ' step-excluded' : '');

    const icon  = stepIcon(step.type);
    const label = buildStepLabel(step);

    const thumbHtml = step.screenshot && !excluded
      ? `<div class="thumb-wrap">` +
        `<img class="step-thumb" src="${step.screenshot}" alt="Screenshot passo ${step.index}" title="Clica para ampliar">` +
        buildAnnotationSVG(step.annotation) +
        `</div>`
      : '';

    // Exclude toggle only for stopped sessions
    const toggleHtml = !isRecording
      ? `<button class="step-exclude-btn${excluded ? ' is-excluded' : ''}" ` +
        `data-id="${escAttr(step.id)}" ` +
        `title="${excluded ? 'Reincluir no documento' : 'Excluir do documento'}">` +
        (excluded ? '↩' : '⊘') +
        `</button>`
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
      toggleHtml;

    if (step.screenshot && !excluded) {
      row.querySelector('.thumb-wrap').addEventListener('click', () =>
        openLightbox(step.screenshot, annotationLabel(step), step.annotation)
      );
    }

    if (!isRecording) {
      row.querySelector('.step-exclude-btn').addEventListener('click', () =>
        toggleStepExclude(step.id)
      );
    }

    list.appendChild(row);
  });

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
  return step.element?.label || step.type;
}

// ── Document rendering ─────────────────────────────────────────────────────────

function renderDocumentView() {
  if (!activeDoc) return;

  // Build step index for screenshot markers
  const byIndex = new Map(
    (activeSession.steps || [])
      .filter(s => s.screenshot)
      .map(s => [s.index, s])
  );

  let html = markdownToHtml(activeDoc.markdown);

  // Replace {{screenshot:N}} markers
  html = html.replace(/\{\{screenshot:(\d+)\}\}/g, (_, n) => {
    const step = byIndex.get(parseInt(n, 10));
    if (!step) return '';
    const caption = annotationLabel(step);
    return `<figure class="inline-screenshot" data-src="${escAttr(step.screenshot)}" data-caption="${escAttr(caption)}" data-step-id="${escAttr(step.id)}">` +
           `<div class="shot-wrap">` +
           `<img src="${step.screenshot}" alt="${escAttr(caption)}" loading="lazy">` +
           buildAnnotationSVG(step.annotation) +
           `</div>` +
           `<figcaption>${escHtml(caption)}</figcaption>` +
           `</figure>`;
  });

  $('doc-rendered').innerHTML = html;
  $('doc-view').classList.remove('hidden');
  $('doc-edit').classList.add('hidden');

  // Click on inline screenshots → lightbox
  $('doc-rendered').addEventListener('click', e => {
    const fig = e.target.closest('.inline-screenshot');
    if (!fig) return;
    const step = (activeSession.steps || []).find(s => s.id === fig.dataset.stepId);
    openLightbox(fig.dataset.src, fig.dataset.caption, step?.annotation);
  }, { once: false });
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
  await refreshData();

  // Find the newly stored document
  if (Array.isArray(sessionIds) && sessionIds.length === 1) {
    activeSession = allSessions.find(s => s.id === sessionIds[0]) || activeSession;
    activeDoc     = findDocForSession(sessionIds[0]);
    renderDetail();
    setTab('document');
  } else {
    // Combined: find the most recent doc that contains all selected sessions
    const combined = allDocuments.find(d =>
      sessionIds.every(id => d.sessionIds.includes(id))
    );
    if (combined) {
      chrome.tabs.create({ url: chrome.runtime.getURL('sidebar/result.html') });
    }
  }

  renderSidebar();
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

  if (activeSession?.id === id) {
    activeSession = null;
    activeDoc     = null;
    $('session-detail').classList.add('hidden');
    $('main-empty').classList.remove('hidden');
  }

  renderSidebar();
  updateCombineBar();
}

// ── Document editing ──────────────────────────────────────────────────────────

function enterEditMode() {
  if (!activeDoc) return;
  editMode    = true;
  editOriginal = activeDoc.markdown;

  $('doc-view').classList.add('hidden');
  $('doc-edit').classList.remove('hidden');
  $('btn-edit-doc').classList.add('hidden');
  $('btn-copy-md').classList.add('hidden');
  $('btn-download-html').classList.add('hidden');
  $('btn-generate-doc').classList.add('hidden');

  const ta = $('editor-textarea');
  ta.value = activeDoc.markdown;
  ta.focus();
  updateEditorPreview();
}

function exitEditMode(discard = false) {
  editMode = false;
  if (discard) activeDoc.markdown = editOriginal;

  $('doc-view').classList.remove('hidden');
  $('doc-edit').classList.add('hidden');
  $('btn-edit-doc').classList.remove('hidden');
  $('btn-copy-md').classList.remove('hidden');
  $('btn-download-html').classList.remove('hidden');
  $('btn-generate-doc').classList.remove('hidden');

  if (!discard) renderDocumentView();
}

function updateEditorPreview() {
  const md = $('editor-textarea').value;
  $('editor-preview').innerHTML = markdownToHtml(md);
}

async function saveEdit() {
  const md = $('editor-textarea').value;
  activeDoc.markdown = md;

  // Persist to documentHistory
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
  if (!activeDoc) return;
  await navigator.clipboard.writeText(activeDoc.markdown);
  const btn = $('btn-copy-md');
  btn.classList.add('copied');
  const prev = btn.innerHTML;
  btn.innerHTML = '✓ Copiado!';
  setTimeout(() => { btn.innerHTML = prev; btn.classList.remove('copied'); }, 2200);
}

function downloadHtml() {
  if (!activeDoc || !activeSession) return;
  const html = buildHtmlExport(activeDoc.markdown, activeSession);
  const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = sanitizeFilename(activeSession.title) + '.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
      if (!$('lightbox').classList.contains('hidden')) closeLightbox();
      else if (editMode) exitEditMode(true);
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

// ── Markdown → HTML ───────────────────────────────────────────────────────────

function markdownToHtml(md) {
  const lines = md.split('\n');
  let html = '';
  let inOl = false, inUl = false, inP = false;

  function closeLists() {
    if (inOl) { html += '</ol>\n'; inOl = false; }
    if (inUl) { html += '</ul>\n'; inUl = false; }
  }
  function closeP() {
    if (inP) { html += '</p>\n'; inP = false; }
  }
  function inline(raw) {
    return escHtml(raw)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      .replace(/`(.+?)`/g,       '<code>$1</code>');
  }

  for (const line of lines) {
    const t = line.trim();
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
  closeP(); closeLists();
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
