'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const stateIdle      = $('state-idle');
const stateRecording = $('state-recording');
const stateDone      = $('state-done');
const stateHistory   = $('state-history');

const sessionTitleInput = $('session-title');

const recordingTitle    = $('recording-title');
const stepCountEl       = $('step-count');
const screenshotCountEl = $('screenshot-count');
const doneSummary       = $('done-summary');
const noteArea          = $('note-area');
const noteInput         = $('note-input');
const generatingState   = $('generating-state');
const genErrorEl        = $('gen-error');

const btnStart          = $('btn-start');
const btnStop           = $('btn-stop');
const btnToggleNote     = $('btn-toggle-note');
const btnAddNoteConfirm = $('btn-add-note-confirm');
const btnScreenshot     = $('btn-screenshot');
const btnGenerate       = $('btn-generate');
const btnNewSession     = $('btn-new-session');

// ── Render ────────────────────────────────────────────────────────────────────

function showOnly(...elements) {
  [stateIdle, stateRecording, stateDone, stateHistory].forEach(el => el.classList.add('hidden'));
  elements.forEach(el => el.classList.remove('hidden'));
}

function updateCounters(session) {
  if (!session) return;
  stepCountEl.textContent       = session.steps.length;
  screenshotCountEl.textContent = session.steps.filter(s => s.screenshot).length;
}

function render(session) {
  if (!session) {
    showOnly(stateIdle);
    return;
  }

  if (session.stoppedAt) {
    showOnly(stateDone);
    const screenshots = session.steps.filter(s => s.screenshot).length;
    doneSummary.textContent =
      `${session.steps.length} passo${session.steps.length !== 1 ? 's' : ''} · ` +
      `${screenshots} screenshot${screenshots !== 1 ? 's' : ''} capturado${screenshots !== 1 ? 's' : ''}`;
    return;
  }

  // Active session
  showOnly(stateRecording);
  recordingTitle.textContent = session.title;
  updateCounters(session);
}

// ── UI state persistence ──────────────────────────────────────────────────────

async function saveUIState() {
  await chrome.storage.local.set({
    popupUI: {
      noteOpen:      !noteArea.classList.contains('hidden'),
      panel:         currentPanel(),
      sessionTitle:  sessionTitleInput.value,
    },
  });
}

function currentPanel() {
  if (!stateHistory.classList.contains('hidden'))   return 'history';
  if (!stateDone.classList.contains('hidden'))      return 'done';
  if (!stateRecording.classList.contains('hidden')) return 'recording';
  return 'idle';
}

async function restoreUIState(session) {
  const data = await chrome.storage.local.get(['popupUI']);
  const ui   = data.popupUI;
  if (!ui) return;

  if (!session && ui.sessionTitle) {
    sessionTitleInput.value = ui.sessionTitle;
  }
  if (session && !session.stoppedAt && ui.noteOpen) {
    noteArea.classList.remove('hidden');
  }
  if (ui.panel === 'history' && (!session || session.stoppedAt)) {
    await openHistory();
  }
}

// Debounced title save
let _titleTimer;
sessionTitleInput.addEventListener('input', () => {
  clearTimeout(_titleTimer);
  _titleTimer = setTimeout(saveUIState, 400);
});

// ── Idle → Recording (US-01) ──────────────────────────────────────────────────

btnStart.addEventListener('click', async () => {
  btnStart.disabled = true;
  const title = sessionTitleInput.value.trim() || 'Sessão sem título';
  const { session } = await chrome.runtime.sendMessage({ type: 'START_SESSION', title });
  render(session);
  saveUIState();
  btnStart.disabled = false;
});

sessionTitleInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnStart.click();
});

// ── Recording → Done ──────────────────────────────────────────────────────────

btnStop.addEventListener('click', async () => {
  btnStop.disabled = true;
  noteArea.classList.add('hidden');
  const { session } = await chrome.runtime.sendMessage({ type: 'STOP_SESSION' });
  render(session);
  await refreshHistoryBadge();
  btnStop.disabled = false;
});

// ── Manual note (US-05) ───────────────────────────────────────────────────────

btnToggleNote.addEventListener('click', () => {
  const isHidden = noteArea.classList.toggle('hidden');
  if (!isHidden) noteInput.focus();
  saveUIState();
});

btnAddNoteConfirm.addEventListener('click', async () => {
  const note = noteInput.value.trim();
  if (!note) return;

  btnAddNoteConfirm.disabled = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const { stepCount } = await chrome.runtime.sendMessage({
    type:      'ADD_NOTE',
    note,
    url:       tab?.url       || '',
    pageTitle: tab?.title     || '',
  });

  stepCountEl.textContent = stepCount;
  noteInput.value = '';
  noteArea.classList.add('hidden');
  btnAddNoteConfirm.disabled = false;
});

noteInput.addEventListener('keydown', e => {
  // Ctrl+Enter / Cmd+Enter to submit note
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) btnAddNoteConfirm.click();
});

// ── Undo last step ────────────────────────────────────────────────────────────

$('btn-undo-step').addEventListener('click', async () => {
  const btn = $('btn-undo-step');
  btn.disabled = true;
  const { session } = await chrome.runtime.sendMessage({ type: 'UNDO_LAST_STEP' });
  if (session) updateCounters(session);
  btn.disabled = false;
});

// ── Manual screenshot (US-06) ─────────────────────────────────────────────────

btnScreenshot.addEventListener('click', async () => {
  btnScreenshot.disabled = true;
  const { stepCount: _sc } =
    await chrome.runtime.sendMessage({ type: 'TAKE_SCREENSHOT' });

  // Refresh full state to keep both counters accurate
  const { session } = await chrome.runtime.sendMessage({ type: 'GET_SESSION' });
  updateCounters(session);
  btnScreenshot.disabled = false;
});

// ── Done → Go to Dashboard ────────────────────────────────────────────────────

btnGenerate.addEventListener('click', async () => {
  const { session } = await chrome.runtime.sendMessage({ type: 'GET_SESSION' });
  const base = chrome.runtime.getURL('dashboard/dashboard.html');
  const url  = session ? `${base}?manage=${encodeURIComponent(session.id)}` : base;
  chrome.tabs.create({ url });
});

$('btn-go-settings').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// ── Done → Resume session ─────────────────────────────────────────────────────

$('btn-resume-session').addEventListener('click', async () => {
  const btn = $('btn-resume-session');
  btn.disabled = true;
  const { session } = await chrome.runtime.sendMessage({ type: 'GET_SESSION' });
  if (!session) { btn.disabled = false; return; }
  const result = await chrome.runtime.sendMessage({
    type: 'RESUME_SESSION',
    sessionId: session.id,
  });
  render(result.session || session);
  btn.disabled = false;
});

// ── Done → New session ────────────────────────────────────────────────────────

btnNewSession.addEventListener('click', async () => {
  await chrome.storage.local.remove(['currentSession']);
  sessionTitleInput.value = '';
  render(null);
  await refreshHistoryBadge();
  saveUIState();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) { return escHtml(s).replace(/'/g, '&#39;'); }

// ── Session history ───────────────────────────────────────────────────────────

let selectedSessionIds = new Set();

function formatSessionDate(iso) {
  return new Date(iso).toLocaleDateString('pt-PT', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

async function openHistory(preSelectId) {
  showOnly(stateHistory);
  selectedSessionIds = new Set();
  if (preSelectId) selectedSessionIds.add(preSelectId);
  await loadHistory();
}

async function loadHistory() {
  const { history } = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
  renderHistoryList(history || []);
}

function renderHistoryList(history) {
  const list       = $('session-list');
  const emptyMsg   = $('history-empty');
  const btnGenMulti = $('btn-generate-multi');

  list.innerHTML = '';

  if (!history.length) {
    emptyMsg.classList.remove('hidden');
    btnGenMulti.classList.add('hidden');
    return;
  }

  emptyMsg.classList.add('hidden');
  btnGenMulti.classList.remove('hidden');

  history.forEach(session => {
    const steps      = session.steps?.length || 0;
    const screenshots = session.steps?.filter(s => s.screenshot).length || 0;
    const dateStr    = formatSessionDate(session.startedAt);

    const item = document.createElement('div');
    item.className = 'session-item' + (selectedSessionIds.has(session.id) ? ' selected' : '');
    item.dataset.id = session.id;

    item.innerHTML =
      `<input type="checkbox" ${selectedSessionIds.has(session.id) ? 'checked' : ''}>` +
      `<div class="session-info">` +
        `<div class="session-name" title="${escAttr(session.title)}">${escHtml(session.title)}</div>` +
        `<div class="session-meta">${dateStr} · ${steps} passo${steps !== 1 ? 's' : ''}` +
        (screenshots ? ` · ${screenshots} 📷` : '') +
        `</div>` +
      `</div>` +
      `<button class="session-delete" title="Apagar sessão" data-id="${escAttr(session.id)}">×</button>`;

    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedSessionIds.add(session.id);
        item.classList.add('selected');
      } else {
        selectedSessionIds.delete(session.id);
        item.classList.remove('selected');
      }
      updateGenerateMultiBtn();
    });

    item.querySelector('.session-delete').addEventListener('click', async e => {
      e.stopPropagation();
      const id = e.currentTarget.dataset.id;
      const { history: updated } = await chrome.runtime.sendMessage({
        type: 'DELETE_SESSION', sessionId: id,
      });
      selectedSessionIds.delete(id);
      renderHistoryList(updated || []);
      updateHistoryBadge(updated || []);
    });

    // Clicking the row (not delete) toggles checkbox
    item.addEventListener('click', e => {
      if (e.target.classList.contains('session-delete') || e.target.type === 'checkbox') return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    });

    list.appendChild(item);
  });

  updateGenerateMultiBtn();
}

function updateGenerateMultiBtn() {
  const btn = $('btn-generate-multi');
  const n   = selectedSessionIds.size;
  btn.disabled = n === 0;
  btn.textContent = n > 0
    ? `✨ Gerar documento (${n} sess${n !== 1 ? 'ões' : 'ão'})`
    : '✨ Gerar documento';
}

function updateHistoryBadge(history) {
  const btn   = $('btn-open-history-idle');
  const badge = $('history-badge');
  const count = (history || []).length;
  if (count > 0) {
    btn.classList.remove('hidden');
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

async function refreshHistoryBadge() {
  const { history } = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
  updateHistoryBadge(history || []);
}

function showGenMultiError(msg) {
  const errEl = $('gen-error-multi');
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
  $('generating-state-multi').classList.add('hidden');
  $('btn-generate-multi').classList.remove('hidden');
}

$('btn-open-history-idle').addEventListener('click', () => { openHistory(); saveUIState(); });
$('btn-open-history-done').addEventListener('click', async () => {
  const { session } = await chrome.runtime.sendMessage({ type: 'GET_SESSION' });
  openHistory(session?.id);
  saveUIState();
});
$('btn-back-from-history').addEventListener('click', async () => {
  const { session } = await chrome.runtime.sendMessage({ type: 'GET_SESSION' });
  render(session);
  saveUIState();
});

$('btn-generate-multi').addEventListener('click', async () => {
  const ids = Array.from(selectedSessionIds);
  if (!ids.length) return;

  const s        = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  const provider = s?.provider || 'anthropic';
  const hasKey   = provider === 'openai' ? s?.openaiUnlocked : s?.anthropicUnlocked;

  if (!hasKey) {
    $('no-key-msg').classList.remove('hidden');
    showOnly(stateDone);
    return;
  }

  $('gen-error-multi').classList.add('hidden');
  $('btn-generate-multi').classList.add('hidden');
  $('generating-state-multi').classList.remove('hidden');

  let result;
  try {
    result = await chrome.runtime.sendMessage({ type: 'GENERATE_DOCUMENT', sessionIds: ids });
  } catch (err) {
    showGenMultiError(`Erro de comunicação: ${err.message}`);
    return;
  }

  if (result?.error) {
    showGenMultiError(result.error);
    return;
  }

  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  $('generating-state-multi').classList.add('hidden');
  $('btn-generate-multi').classList.remove('hidden');
});

// ── Dashboard shortcuts ───────────────────────────────────────────────────────

$('btn-open-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

$('btn-open-dashboard-header').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
  const { session } = await chrome.runtime.sendMessage({ type: 'GET_SESSION' });
  render(session);
  await restoreUIState(session);
  await refreshHistoryBadge();

  // Auto-fill title from the active tab when idle and the input is empty
  if (!session && !sessionTitleInput.value.trim()) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const skip = ['New Tab', chrome.runtime.getManifest().name];
    if (tab?.title && !skip.includes(tab.title)) {
      sessionTitleInput.value = tab.title.slice(0, 60);
    }
  }
})();
