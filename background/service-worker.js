'use strict';

// ── Message type constants ────────────────────────────────────────────────────
const MSG = {
  GET_SESSION:       'GET_SESSION',
  START_SESSION:     'START_SESSION',
  STOP_SESSION:      'STOP_SESSION',
  RESUME_SESSION:    'RESUME_SESSION',
  UNDO_LAST_STEP:    'UNDO_LAST_STEP',
  TOGGLE_PAUSE:      'TOGGLE_PAUSE',
  TRACK_EVENT:       'TRACK_EVENT',
  ADD_NOTE:          'ADD_NOTE',
  TAKE_SCREENSHOT:   'TAKE_SCREENSHOT',
  SESSION_UPDATED:   'SESSION_UPDATED',
  GENERATE_DOCUMENT: 'GENERATE_DOCUMENT',
  EXTRACT_STYLE:     'EXTRACT_STYLE',
  GET_HISTORY:       'GET_HISTORY',
  DELETE_SESSION:    'DELETE_SESSION',
  GET_SETTINGS:      'GET_SETTINGS',
  SAVE_SETTINGS:     'SAVE_SETTINGS',
  LOCK_SESSION:      'LOCK_SESSION',
  REMOVE_KEY:        'REMOVE_KEY',
  ADD_NARRATION:     'ADD_NARRATION',
};

const MAX_HISTORY = 15;

// ── In-memory session (mirrored to chrome.storage.local) ──────────────────────
let currentSession = null;

// Resolved once the boot restore completes so message handlers don't race it
let _resolveReady;
const _readyPromise = new Promise(r => { _resolveReady = r; });

// ── Helpers ───────────────────────────────────────────────────────────────────

function keyHint(key) {
  if (!key || key.length < 4) return null;
  return '••••' + key.slice(-4);
}

// Read from session (decrypted) first, fall back to legacy plaintext in local
async function getApiKey(provider, localData) {
  try {
    const sess = await chrome.storage.session.get(['unlockedKeys']);
    const uk = sess.unlockedKeys || {};
    if (provider === 'openai' && uk.openaiKey)    return uk.openaiKey;
    if (provider !== 'openai' && uk.anthropicKey) return uk.anthropicKey;
  } catch (_) {}
  if (provider === 'openai') return localData.openaiKey || null;
  return localData.anthropicKey || localData.apiKey || null;
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function persistSession() {
  await chrome.storage.local.set({ currentSession });
}

// Notify all tabs that have the content script loaded
async function broadcastToTabs(message) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {
      // Tab may not have content script (e.g. chrome:// pages) — ignore
    });
  }
}

async function captureScreenshot(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 80,
    });
  } catch (err) {
    console.warn('[DocFlow] Screenshot failed:', err.message);
    return null;
  }
}

// ── Session operations ─────────────────────────────────────────────────────────

async function startSession(title) {
  currentSession = {
    id: String(Date.now()),
    title: title || 'Sessão sem título',
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    steps: [],
    config: { captureScreenshots: true },
  };
  await persistSession();
  await broadcastToTabs({ type: MSG.SESSION_UPDATED, session: currentSession });
  return currentSession;
}

async function saveToHistory(session) {
  const data = await chrome.storage.local.get(['sessionHistory']);
  const history = Array.isArray(data.sessionHistory) ? data.sessionHistory : [];
  // Remove any existing entry with the same id before prepending
  const filtered = history.filter(s => s.id !== session.id);
  filtered.unshift(session);
  await chrome.storage.local.set({ sessionHistory: filtered.slice(0, MAX_HISTORY) });
}

async function stopSession() {
  if (!currentSession) return null;
  currentSession.stoppedAt = new Date().toISOString();
  await persistSession();
  await saveToHistory(currentSession);
  await broadcastToTabs({ type: MSG.SESSION_UPDATED, session: currentSession });
  return currentSession;
}

async function undoLastStep() {
  if (!currentSession?.steps.length) return { session: currentSession };
  currentSession.steps.pop();
  currentSession.steps.forEach((s, i) => { s.index = i + 1; });
  await persistSession();
  // Keep history in sync
  const data = await chrome.storage.local.get(['sessionHistory']);
  const history = (data.sessionHistory || []).map(s =>
    s.id === currentSession.id ? currentSession : s
  );
  await chrome.storage.local.set({ sessionHistory: history });
  return { session: currentSession };
}

async function resumeSession(sessionId) {
  // Stop any in-progress session first
  if (currentSession && !currentSession.stoppedAt) {
    await stopSession();
  }

  const data    = await chrome.storage.local.get(['sessionHistory']);
  const history = data.sessionHistory || [];
  const session = history.find(s => s.id === sessionId);

  if (!session) return { error: 'Sessão não encontrada.' };

  session.stoppedAt = null;
  currentSession = session;

  // Update in history and set as current
  const updated = history.map(s => s.id === sessionId ? session : s);
  await chrome.storage.local.set({ sessionHistory: updated, currentSession: session });
  await broadcastToTabs({ type: MSG.SESSION_UPDATED, session: currentSession });
  return { session: currentSession };
}

async function togglePause() {
  if (!currentSession || currentSession.stoppedAt) return { session: currentSession };
  currentSession.paused = !currentSession.paused;
  await persistSession();
  await broadcastToTabs({ type: MSG.SESSION_UPDATED, session: currentSession });
  return { session: currentSession };
}

async function addStep(stepData, tabId) {
  if (!currentSession || currentSession.stoppedAt) return null;

  const sd = await chrome.storage.local.get(['settings', 'captureScreenshots']);
  const _s = sd.settings || {};
  const shouldCapture =
    (_s.captureScreenshots !== undefined ? _s.captureScreenshots : sd.captureScreenshots !== false) &&
    currentSession.config.captureScreenshots &&
    tabId != null &&
    ['click', 'input', 'select', 'screenshot'].includes(stepData.type);

  const screenshot = shouldCapture ? await captureScreenshot(tabId) : null;

  const step = {
    id:         generateId('step'),
    index:      currentSession.steps.length + 1,
    timestamp:  new Date().toISOString(),
    type:       stepData.type,
    element:    stepData.element    || null,
    value:      stepData.value      ?? null,
    url:        stepData.url        || '',
    pageTitle:  stepData.pageTitle  || '',
    note:       stepData.note       || '',
    annotation: stepData.annotation || null,
    screenshot,
  };

  currentSession.steps.push(step);
  await persistSession();
  return step;
}

// ── Document generation (US-09) ───────────────────────────────────────────────

const SYSTEM_PROMPT = `És um assistente especializado na criação de manuais de utilizador profissionais em português europeu (PT-PT).

Recebes metadados de ações realizadas por um utilizador numa aplicação web (cliques, preenchimento de campos, navegação, notas) e crias um manual de utilizador completo, claro e bem estruturado.

FORMATO OBRIGATÓRIO — responde APENAS com Markdown, sem texto antes ou depois:

# Título do manual
(título descritivo do processo, não técnico)

Introdução de 2-3 frases a explicar o objetivo e para quem é este processo.

## Nome da Secção 1
1. Primeiro passo — descreve a ação e o resultado esperado
2. Segundo passo — ...

## Nome da Secção 2
1. ...

REGRAS OBRIGATÓRIAS:
- Escreve sempre em português europeu (PT-PT): "clique", "ecrã", "formulário", "guardar", "visualizar", "premir"
- Linguagem clara e acessível para utilizadores sem conhecimento técnico
- Cada passo numerado: descreve o que o utilizador faz + o que acontece a seguir
- Não incluas URLs, IDs internos, nomes de campos técnicos nem termos de programação
- Agrupa logicamente: preparação → ação principal → confirmação/resultado
- Cria 2-5 secções lógicas dependendo da complexidade
- Tom profissional mas direto e acessível
- Para valores introduzidos em campos, menciona o tipo de informação (ex: "Introduz o nome do cliente")
- Se houver notas manuais, integra-as no contexto do passo relevante
- Passos marcados com [Narração] são transcrições de voz do utilizador gravadas durante a sessão, descrevendo o que estava a fazer ou o contexto de negócio da ação. Usa estas narrações para enriquecer e contextualizar os passos próximos — integra a informação narrada na descrição dos passos correspondentes, revelando o propósito e o raciocínio por trás das ações. Não apresentes as narrações como passos separados no manual
- SCREENSHOTS: As ações marcadas com [📷] têm um screenshot capturado. Para cada passo do manual que corresponda a uma dessas ações, coloca o marcador {{screenshot:N}} imediatamente a seguir ao texto do passo (ainda dentro do item de lista), onde N é o número da ação original. Este marcador será substituído pela imagem no documento final. Usa SEMPRE o marcador quando a ação tem [📷]. Exemplo: "1. Clique em **Guardar** para confirmar os dados. {{screenshot:3}}"
- Não uses {{screenshot:N}} em passos que não correspondam a ações com [📷]`;

function formatStep(step) {
  const labels = {
    click: 'Clique', input: 'Preenchimento', select: 'Seleção',
    navigation: 'Navegação', submit: 'Envio', manual: 'Nota',
    screenshot: 'Screenshot', narration: 'Narração',
  };
  const type = labels[step.type] || step.type;

  let parts = [`${step.index}. [${type}]`];

  // Narration steps: just the spoken text, nothing else
  if (step.type === 'narration') {
    parts.push(`"${step.note}"`);
    return parts.join(' ');
  }

  if (step.element?.label && step.type !== 'navigation' && step.type !== 'manual') {
    parts.push(`"${step.element.label}"`);
  }
  if (step.value && step.value !== '••••••') {
    parts.push(`→ "${step.value}"`);
  }
  if (step.note) {
    parts.push(`Nota: ${step.note}`);
  }
  if (step.type === 'navigation') {
    parts.push(step.pageTitle || step.url || '(nova página)');
  } else if (step.pageTitle) {
    parts.push(`(${step.pageTitle})`);
  }

  if (step.screenshot) parts.push('[📷]');

  return parts.join(' ');
}

function buildSessionText(session) {
  const date = new Date(session.startedAt).toLocaleDateString('pt-PT', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  let domain = 'aplicação web';
  try {
    const firstUrl = session.steps.find(s => s.url)?.url;
    if (firstUrl) domain = new URL(firstUrl).hostname;
  } catch {}

  const actionableSteps = session.steps.filter(s => s.type !== 'screenshot');
  const stepsText = actionableSteps.map(formatStep).join('\n');

  return `Cria um manual de utilizador para a seguinte sessão gravada.

Título da sessão: "${session.title}"
Data: ${date}
Aplicação: ${domain}
Total de ações registadas: ${actionableSteps.length}

Sequência de ações:
${stepsText}

Gera o manual completo em Markdown seguindo o formato e as regras do sistema.`;
}

function buildPrompt(session, templateText, overrideSessionText) {
  const sessionText = overrideSessionText || buildSessionText(session);

  if (!templateText?.trim()) return sessionText;

  // Truncate very long templates to avoid token limits
  const MAX_CHARS = 50_000;
  const template  = templateText.length > MAX_CHARS
    ? templateText.slice(0, MAX_CHARS) + '\n[... documento truncado ...]'
    : templateText;

  return `Tens acesso a um documento de referência que representa o estilo, estrutura e tom desejados para os manuais desta organização. Analisa-o com atenção e replica o mesmo padrão no novo manual que vais criar.

REGRAS DE ADAPTAÇÃO:
- Segue a mesma estrutura de secções e nível de detalhe
- Mantém o mesmo tom e registo de linguagem (formal/informal, tecnicidade)
- Usa o mesmo tipo de frases e vocabulário da área
- NÃO copies conteúdo do documento de referência — cria conteúdo novo para a sessão gravada

--- DOCUMENTO DE REFERÊNCIA ---
${template}
--- FIM DO DOCUMENTO DE REFERÊNCIA ---

${sessionText}`;
}

async function callAnthropicAPI(apiKey, model, userMessage) {
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
      model,
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erro Anthropic: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function callOpenAIAPI(apiKey, model, userMessage) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erro OpenAI: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function extractStyle(documentText) {
  const data     = await chrome.storage.local.get(['settings', 'provider', 'anthropicKey', 'anthropicModel', 'openaiKey', 'openaiModel', 'apiKey']);
  const _cfg     = data.settings || {};
  const provider = _cfg.provider || data.provider || 'anthropic';

  // Analyse up to 50K chars — enough for ~30 pages
  const ANALYSIS_LIMIT = 50_000;
  const excerpt  = documentText.length > ANALYSIS_LIMIT
    ? documentText.slice(0, ANALYSIS_LIMIT) + '\n\n[... documento truncado para análise ...]'
    : documentText;

  const prompt = `Analisa o seguinte documento e extrai um guia de estilo compacto (máximo 700 palavras) para ser usado como referência ao gerar novos manuais de utilizador no mesmo estilo.

O guia deve cobrir:
1. TOM E REGISTO — formal/informal, nível técnico, pessoa gramatical (utilizador/tu/você)
2. ESTRUTURA TÍPICA — como o documento está organizado (título, introdução, secções, passos, notas, conclusão)
3. PADRÕES DE ESCRITA — tipo de frases, vocabulário recorrente, expressões características
4. FORMATAÇÃO DE PASSOS — como são apresentadas as instruções (numeradas, com verbos no imperativo, com resultados esperados, etc.)
5. EXEMPLOS REPRESENTATIVOS — 3 a 5 excertos curtos do documento original que melhor ilustram o estilo

Documento a analisar:
${excerpt}

Responde APENAS com o guia de estilo em português europeu. Sem introdução, sem conclusão, começa directamente com o guia.`;

  try {
    let styleGuide;
    if (provider === 'openai') {
      const apiKey = await getApiKey('openai', data);
      const model  = _cfg.openaiModel || data.openaiModel || 'gpt-4o';
      if (!apiKey) return { error: 'Chave API OpenAI não configurada. Abre o Dashboard → Configurações.' };
      styleGuide = await callOpenAIAPI(apiKey, model, prompt);
    } else {
      const apiKey = await getApiKey('anthropic', data);
      const model  = _cfg.anthropicModel || data.anthropicModel || 'claude-opus-4-5';
      if (!apiKey) return { error: 'Chave API Anthropic não configurada. Abre o Dashboard → Configurações.' };
      styleGuide = await callAnthropicAPI(apiKey, model, prompt);
    }
    return { styleGuide };
  } catch (err) {
    console.error('[DocFlow] Style extraction failed:', err);
    return { error: err.message };
  }
}

// Returns a copy of the session with excluded steps removed and indices reset
function withoutExcluded(session) {
  const steps = session.steps
    .filter(s => !s.excluded)
    .map((s, i) => ({ ...s, index: i + 1 }));
  return { ...session, steps };
}

function buildMultiSessionText(sessions) {
  // Re-index all steps globally across sessions (excluded already filtered out)
  let stepOffset = 0;
  const allSteps = [];

  const sessionBlocks = sessions.map((session, sIdx) => {
    const date = new Date(session.startedAt).toLocaleDateString('pt-PT', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const actionableSteps = session.steps.filter(s => s.type !== 'screenshot');
    const reindexed = actionableSteps.map((step, i) => ({
      ...step,
      index: stepOffset + i + 1,
    }));
    stepOffset += actionableSteps.length;
    allSteps.push(...reindexed);

    const stepsText = reindexed.map(formatStep).join('\n');
    return `PROCESSO ${sIdx + 1}: "${session.title}" (${date})\n${stepsText}`;
  }).join('\n\n');

  const totalTitle = sessions.map(s => s.title).join(' + ');

  return `Cria um manual de utilizador que documenta os seguintes processos gravados em fases. Organiza o documento integrando todos os processos de forma coerente, como um único manual.

Processos gravados: ${sessions.length}
Total de ações: ${allSteps.length}
Título sugerido: "${totalTitle}"

${sessionBlocks}

Gera o manual completo em Markdown seguindo o formato e as regras do sistema.`;
}

async function generateDocument(sessionIds) {
  const data = await chrome.storage.local.get([
    'currentSession', 'sessionHistory',
    'settings',
    'provider', 'anthropicKey', 'anthropicModel',
    'openaiKey', 'openaiModel', 'apiKey',
    'templateEnabled', 'templateText',
  ]);
  const _cfg = data.settings || {};
  const provider = _cfg.provider || data.provider || 'anthropic';
  const templateEnabled = _cfg.templateEnabled !== undefined ? _cfg.templateEnabled : !!data.templateEnabled;
  const templateText    = _cfg.templateText    || data.templateText || '';
  const template = templateEnabled ? templateText : null;

  let sessions;
  let pendingSession;

  if (Array.isArray(sessionIds) && sessionIds.length > 0) {
    // Multi-session: load selected sessions from history, filter excluded steps
    const history = Array.isArray(data.sessionHistory) ? data.sessionHistory : [];
    sessions = sessionIds
      .map(id => history.find(s => s.id === id))
      .filter(Boolean)
      .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
      .map(withoutExcluded);

    if (!sessions.length) return { error: 'Sessões selecionadas não encontradas.' };

    // Build a merged session for result page (globally re-indexed steps)
    let stepOffset = 0;
    const mergedSteps = [];
    sessions.forEach(session => {
      session.steps.forEach(step => {
        if (step.type === 'screenshot') return;
        mergedSteps.push({ ...step, index: ++stepOffset });
      });
    });
    // Also include raw screenshot steps with re-indexed positions
    stepOffset = 0;
    const allMergedSteps = [];
    sessions.forEach(session => {
      session.steps.forEach(step => {
        allMergedSteps.push({ ...step, index: ++stepOffset });
      });
    });

    pendingSession = {
      id: 'multi_' + Date.now(),
      title: sessions.map(s => s.title).join(' + '),
      startedAt: sessions[0].startedAt,
      stoppedAt: sessions[sessions.length - 1].stoppedAt,
      steps: allMergedSteps,
    };
  } else {
    // Single current session — filter excluded steps
    const session = currentSession || data.currentSession;
    if (!session) return { error: 'Nenhuma sessão encontrada.' };
    if (!session.steps?.length) return { error: 'A sessão não tem passos. Grava pelo menos uma ação antes de gerar o documento.' };
    const filtered = withoutExcluded(session);
    if (!filtered.steps.length) return { error: 'Todos os passos estão excluídos. Inclui pelo menos um passo antes de gerar.' };
    sessions = [filtered];
    pendingSession = filtered;
  }

  const userMessage = sessions.length > 1
    ? buildPrompt({ steps: [], title: '' }, template, buildMultiSessionText(sessions))
    : buildPrompt(sessions[0], template);

  try {
    let markdown;

    if (provider === 'openai') {
      const apiKey = await getApiKey('openai', data);
      const model  = _cfg.openaiModel || data.openaiModel || 'gpt-4o';
      if (!apiKey) return { error: 'Chave API OpenAI não configurada. Abre o Dashboard → Configurações.' };
      markdown = await callOpenAIAPI(apiKey, model, userMessage);
    } else {
      const apiKey = await getApiKey('anthropic', data);
      const model  = _cfg.anthropicModel || data.anthropicModel || 'claude-opus-4-5';
      if (!apiKey) return { error: 'Chave API Anthropic não configurada. Abre o Dashboard → Configurações.' };
      markdown = await callAnthropicAPI(apiKey, model, userMessage);
    }

    const sessionIds = sessions.map(s => s.id);
    await saveDocumentToHistory(sessionIds, pendingSession.title, markdown);
    await chrome.storage.local.set({ pendingDocument: markdown, pendingSession });
    return { markdown };
  } catch (err) {
    console.error('[DocFlow] Generation failed:', err);
    return { error: err.message };
  }
}

async function saveDocumentToHistory(sessionIds, title, markdown) {
  const data = await chrome.storage.local.get(['documentHistory']);
  const history = Array.isArray(data.documentHistory) ? data.documentHistory : [];
  const doc = {
    id:          generateId('doc'),
    sessionIds,
    title,
    markdown,
    generatedAt: new Date().toISOString(),
  };
  // Replace any existing doc for the exact same session set
  const key      = sessionIds.slice().sort().join(',');
  const filtered = history.filter(d => d.sessionIds.slice().sort().join(',') !== key);
  filtered.unshift(doc);
  await chrome.storage.local.set({ documentHistory: filtered.slice(0, 50) });
  return doc;
}

// ── Boot: restore session from storage ────────────────────────────────────────
(async () => {
  const data = await chrome.storage.local.get(['currentSession']);
  if (data.currentSession && !data.currentSession.stoppedAt) {
    currentSession = data.currentSession;
  }
  _resolveReady();
})();

// ── Keyboard shortcut ─────────────────────────────────────────────────────────
chrome.commands.onCommand.addListener(command => {
  if (command === 'open-dashboard') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  }
});

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? null;

  switch (message.type) {
    case MSG.GET_SESSION:
      sendResponse({ session: currentSession });
      return false;

    case MSG.START_SESSION:
      (async () => {
        const session = await startSession(message.title);
        // Inject tracker into the active tab in case the tab predates the extension
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (activeTab?.id) {
            await chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ['content/tracker.js'],
            });
          }
        } catch (_) {}
        sendResponse({ session });
      })();
      return true;

    case MSG.STOP_SESSION:
      stopSession().then(session => sendResponse({ session }));
      return true;

    case MSG.TRACK_EVENT:
      _readyPromise.then(() => addStep(message.step, tabId)).then(step =>
        sendResponse({ step, stepCount: currentSession?.steps.length ?? 0 })
      );
      return true;

    case MSG.ADD_NOTE:
      addStep(
        { type: 'manual', note: message.note, url: message.url, pageTitle: message.pageTitle },
        tabId
      ).then(step =>
        sendResponse({ step, stepCount: currentSession?.steps.length ?? 0 })
      );
      return true;

    case MSG.ADD_NARRATION:
      addStep(
        { type: 'narration', note: message.text, url: message.url, pageTitle: message.pageTitle },
        null // narrations don't trigger screenshot capture
      ).then(step =>
        sendResponse({ step, stepCount: currentSession?.steps.length ?? 0 })
      );
      return true;

    case MSG.TAKE_SCREENSHOT:
      (async () => {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) { sendResponse({ error: 'No active tab' }); return; }
        const step = await addStep(
          { type: 'screenshot', url: activeTab.url, pageTitle: activeTab.title },
          activeTab.id
        );
        sendResponse({ step, stepCount: currentSession?.steps.length ?? 0 });
      })();
      return true;

    case MSG.GENERATE_DOCUMENT:
      generateDocument(message.sessionIds).then(result => sendResponse(result));
      return true;

    case MSG.EXTRACT_STYLE:
      extractStyle(message.documentText).then(result => sendResponse(result));
      return true;

    case MSG.RESUME_SESSION:
      resumeSession(message.sessionId).then(result => sendResponse(result));
      return true;

    case MSG.UNDO_LAST_STEP:
      undoLastStep().then(result => sendResponse(result));
      return true;

    case MSG.TOGGLE_PAUSE:
      togglePause().then(result => sendResponse(result));
      return true;

    case MSG.GET_HISTORY:
      chrome.storage.local.get(['sessionHistory']).then(data => {
        sendResponse({ history: data.sessionHistory || [] });
      });
      return true;

    case MSG.DELETE_SESSION:
      chrome.storage.local.get(['sessionHistory']).then(async data => {
        const history = (data.sessionHistory || []).filter(s => s.id !== message.sessionId);
        await chrome.storage.local.set({ sessionHistory: history });
        sendResponse({ history });
      });
      return true;

    case MSG.GET_SETTINGS:
      (async () => {
        const [local, sess] = await Promise.all([
          chrome.storage.local.get([
            'settings', 'provider', 'anthropicModel', 'openaiModel',
            'anthropicKey', 'openaiKey', 'apiKey',
            'captureScreenshots', 'templateEnabled', 'templateText',
          ]),
          chrome.storage.session.get(['unlockedKeys']).catch(() => ({})),
        ]);
        const cfg = local.settings || {};
        const uk  = (sess.unlockedKeys) || {};

        const anthLegacy = !!(local.anthropicKey || local.apiKey);
        const oaiLegacy  = !!local.openaiKey;

        sendResponse({
          provider:           cfg.provider  || local.provider  || 'anthropic',
          anthropicModel:     cfg.anthropicModel || local.anthropicModel || 'claude-opus-4-5',
          openaiModel:        cfg.openaiModel    || local.openaiModel    || 'gpt-4o',
          captureScreenshots: cfg.captureScreenshots !== undefined ? cfg.captureScreenshots : local.captureScreenshots !== false,
          templateEnabled:    cfg.templateEnabled !== undefined ? cfg.templateEnabled : !!local.templateEnabled,
          templateText:       cfg.templateText || local.templateText || '',

          anthropicConfigured: !!(cfg.anthropicKeyEncrypted || anthLegacy),
          anthropicEncrypted:  !!cfg.anthropicKeyEncrypted,
          anthropicUnlocked:   !!(uk.anthropicKey) || anthLegacy,
          anthropicKeyHint:    keyHint(uk.anthropicKey || local.anthropicKey || local.apiKey),

          openaiConfigured: !!(cfg.openaiKeyEncrypted || oaiLegacy),
          openaiEncrypted:  !!cfg.openaiKeyEncrypted,
          openaiUnlocked:   !!(uk.openaiKey) || oaiLegacy,
          openaiKeyHint:    keyHint(uk.openaiKey || local.openaiKey),
        });
      })();
      return true;

    case MSG.SAVE_SETTINGS:
      (async () => {
        const cur = await chrome.storage.local.get(['settings']);
        const upd = { ...(cur.settings || {}), ...message.settings };
        await chrome.storage.local.set({ settings: upd });
        sendResponse({ ok: true });
      })();
      return true;

    case MSG.LOCK_SESSION:
      chrome.storage.session.set({ unlockedKeys: {} })
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: true }));
      return true;

    case MSG.REMOVE_KEY:
      (async () => {
        const { provider } = message;
        const cur = await chrome.storage.local.get(['settings']);
        const cfg = cur.settings || {};
        if (provider === 'openai') delete cfg.openaiKeyEncrypted;
        else delete cfg.anthropicKeyEncrypted;
        await chrome.storage.local.set({ settings: cfg });

        const sess = await chrome.storage.session.get(['unlockedKeys']).catch(() => ({}));
        const uk   = sess.unlockedKeys || {};
        if (provider === 'openai') delete uk.openaiKey;
        else delete uk.anthropicKey;
        await chrome.storage.session.set({ unlockedKeys: uk });
        sendResponse({ ok: true });
      })();
      return true;
  }
});
