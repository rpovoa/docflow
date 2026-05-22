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
  IMPROVE_TEXT:      'IMPROVE_TEXT',
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

async function startSession(title, complementOf = null) {
  currentSession = {
    id: String(Date.now()),
    title: title || 'Sessão sem título',
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    steps: [],
    config: { captureScreenshots: true },
    complementOf: complementOf || null,
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

  // Server-side deduplication: drop consecutive identical click/input on same element
  if (['click', 'input', 'select'].includes(stepData.type)) {
    const last = currentSession.steps[currentSession.steps.length - 1];
    if (last &&
        last.type  === stepData.type &&
        last.url   === stepData.url &&
        last.element?.label === stepData.element?.label) {
      return last;
    }
  }

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

const SYSTEM_PROMPT = `És um especialista em documentação funcional de software em português europeu (PT-PT).

Recebes metadados de uma sessão de utilização — cliques, preenchimentos, navegação e narrações de voz — e crias um documento de referência funcional: não um tutorial passo a passo, mas uma DESCRIÇÃO DO QUE EXISTE E COMO FUNCIONA, como se fosse a documentação oficial da funcionalidade.

━━━ FORMATO OBRIGATÓRIO ━━━
Responde APENAS com Markdown válido, sem texto antes ou depois.

# [Título da funcionalidade]
(o QUÊ foi feito, em linguagem de utilizador — ex: "Criação de Entidade Bancária", "Registo de Novo Fornecedor")

[Parágrafo de 2-3 frases: para que serve esta funcionalidade, quando é usada e qual o resultado esperado.]

## [Nome do Ecrã ou Área — ex: "Dados Gerais", "Informações de Contacto"]

[Descreve o que o utilizador encontra neste ecrã ou área: o layout geral, quantos campos/secções existem, o propósito desta área dentro do processo.]

{{screenshot:N}}

**Campos disponíveis:**
| Campo | Descrição |
|---|---|
| **[Nome do campo]** | [O que representa, para que serve, se é obrigatório] |
| **[Nome do campo]** | [O que representa, para que serve, se é obrigatório] |

[1-2 frases sobre como concluir esta área — ex: "Após preencher os campos obrigatórios, clique em **Guardar** para avançar."]

## [Próxima Área ou Ecrã]
...

━━━ REGRAS DE CONTEÚDO ━━━

FILOSOFIA — O documento é uma REFERÊNCIA FUNCIONAL:
- Descreve o que existe no ecrã e o que cada elemento faz — não enumeres os cliques do utilizador
- O leitor deve entender a funcionalidade sem nunca ter visto o ecrã, só com o documento
- Usa os dados da sessão para INFERIR o que cada ecrã/área contém, com base nos campos preenchidos e na navegação
- Linguagem clara e direta, sem jargão técnico, sem URLs, IDs ou nomes de variáveis

CAMPOS E FORMULÁRIOS:
- Para cada campo preenchido, descreve o que representa e por que é necessário
- Usa os valores preenchidos como exemplo apenas se forem informativos (não expões dados sensíveis)
- Se vários campos pertencem à mesma área/card, agrupa-os numa tabela de campos
- Indica quais são obrigatórios se for possível inferir pelos dados

ESTRUTURA:
- Organiza o documento por ECRÃS ou ÁREAS FUNCIONAIS, não por ordem de cliques
- Identifica o ecrã/área a partir do pageTitle e do contexto das ações
- 2 a 5 secções, dependendo da complexidade do processo
- Cada secção = um ecrã ou uma área lógica do processo

NARRAÇÃO DE VOZ:
- Passos marcados com [Narração] são comentários de contexto gravados pelo utilizador
- Integra o conteúdo narrado na descrição da área/ecrã correspondente para enriquecer a explicação funcional
- Nunca cries uma secção separada para narrações

DUPLICADOS E RUÍDO:
- Ignora cliques de foco em campos (o clique para ativar antes de escrever é implícito)
- Duas ações consecutivas idênticas → considera apenas uma
- Ignora navegação interna sem impacto visível

━━━ REGRAS DE SCREENSHOTS ━━━

- Cada {{screenshot:N}} é uma captura do ecrã no momento exato da ação N
- PREFERE screenshots de cliques em botões de navegação ou de início de preenchimento de formulários — são os que melhor mostram o ecrã completo
- Coloca o {{screenshot:N}} IMEDIATAMENTE APÓS a frase que descreve o ecrã que ele mostra, antes da tabela de campos
- Usa NO MÁXIMO 1 screenshot por secção, o mais representativo desse ecrã
- OMITE o screenshot se nenhuma captura desse ecrã existe ou se a captura é de um detalhe pouco representativo
- NUNCA uses um screenshot de ação A para ilustrar uma descrição de área B
- Formato: linha separada, sozinho — {{screenshot:N}}`;


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

function groupStepsByScreen(steps) {
  // Group consecutive steps by pageTitle to help the AI identify screens
  const groups = [];
  let current = null;
  for (const step of steps) {
    const screen = step.pageTitle || '—';
    if (!current || current.screen !== screen) {
      current = { screen, steps: [] };
      groups.push(current);
    }
    current.steps.push(step);
  }
  return groups;
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
  const narrationCount   = actionableSteps.filter(s => s.type === 'narration').length;
  const interactionCount = actionableSteps.length - narrationCount;

  // Group by screen so the AI understands the screen structure
  const screenGroups = groupStepsByScreen(actionableSteps);
  const stepsText = screenGroups.map(group => {
    const header = group.screen !== '—' ? `--- Ecrã: ${group.screen} ---` : '--- (ecrã desconhecido) ---';
    return header + '\n' + group.steps.map(formatStep).join('\n');
  }).join('\n\n');

  const narrationNote = narrationCount > 0
    ? `\nNarrações de voz: ${narrationCount} (marcadas com [Narração] — integra-as na descrição funcional da área correspondente)`
    : '';

  return `Cria a documentação funcional para a seguinte sessão gravada.

Título da sessão: "${session.title}"
Data: ${date}
Aplicação: ${domain}
Interações registadas: ${interactionCount}${narrationNote}

Ações por ecrã (usa os separadores "--- Ecrã ---" para identificar as secções do documento):
${stepsText}

Gera o documento completo em Markdown seguindo o formato e as regras do sistema.`;
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

// Load the bundled style guide from docs/reference/style-guide.md (if present)
async function loadDefaultStyleGuide() {
  try {
    const res = await fetch(chrome.runtime.getURL('docs/reference/style-guide.md'));
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() || null;
  } catch (_) {
    return null;
  }
}

// ── ZIP parser & document extractors ─────────────────────────────────────────

async function parseZip(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // Find End of Central Directory (EOCD) — scan from end, allowing up to 65535 byte comment
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Not a valid ZIP');

  const cdCount  = view.getUint16(eocd + 8,  true);
  const cdOffset = view.getUint32(eocd + 16, true);

  // Index all central directory entries by filename
  const index = new Map();
  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (pos + 46 > data.length || view.getUint32(pos, true) !== 0x02014b50) break;
    const method     = view.getUint16(pos + 10, true);
    const compSize   = view.getUint32(pos + 20, true);
    const nameLen    = view.getUint16(pos + 28, true);
    const extraLen   = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOff   = view.getUint32(pos + 42, true);
    const name       = new TextDecoder().decode(data.slice(pos + 46, pos + 46 + nameLen));
    index.set(name, { localOff, method, compSize });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return {
    list: () => [...index.keys()],
    async getFile(name) {
      const entry = index.get(name);
      if (!entry) return null;
      // Local file header: extra field length may differ from central directory
      const localNameLen  = view.getUint16(entry.localOff + 26, true);
      const localExtraLen = view.getUint16(entry.localOff + 28, true);
      const dataStart     = entry.localOff + 30 + localNameLen + localExtraLen;
      const compressed    = data.slice(dataStart, dataStart + entry.compSize);
      if (entry.method === 0) return compressed; // stored
      if (entry.method === 8) {                  // deflate
        const ds = new DecompressionStream('deflate-raw');
        const w = ds.writable.getWriter();
        const r = ds.readable.getReader();
        w.write(compressed); w.close();
        const chunks = [];
        for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
        const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        return out;
      }
      return null;
    },
  };
}

async function extractDocxText(arrayBuffer) {
  try {
    const zip = await parseZip(arrayBuffer);
    const buf = await zip.getFile('word/document.xml');
    if (!buf) return null;
    return new TextDecoder().decode(buf)
      .replace(/<w:br[^/]*/>/g,  '\n')
      .replace(/<w:tab[^/]*/>/g, '\t')
      .replace(/<\/w:p>/g,  '\n')
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<[^>]+>/g,  '')
      .replace(/\t\n/g,     '\n')
      .replace(/\n{3,}/g,   '\n\n')
      .trim() || null;
  } catch (_) { return null; }
}

async function extractXlsxText(arrayBuffer) {
  try {
    const zip = await parseZip(arrayBuffer);

    // Load shared strings (string cells reference these by index)
    const ssBuf = await zip.getFile('xl/sharedStrings.xml');
    const sharedStrings = [];
    if (ssBuf) {
      const xml = new TextDecoder().decode(ssBuf);
      const re = /<si>([\s\S]*?)<\/si>/g;
      let m;
      while ((m = re.exec(xml)) !== null)
        sharedStrings.push(m[1].replace(/<[^>]+>/g, '').trim());
    }

    // Read sheets sequentially (sheet1.xml, sheet2.xml, …)
    const rows = [];
    for (let i = 1; i <= 20; i++) {
      const buf = await zip.getFile(`xl/worksheets/sheet${i}.xml`);
      if (!buf) break;
      const xml = new TextDecoder().decode(buf);
      const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
      let rowM;
      while ((rowM = rowRe.exec(xml)) !== null) {
        const cells = [];
        const cellRe = /<c([^>]*)>([\s\S]*?)<\/c>/g;
        let cM;
        while ((cM = cellRe.exec(rowM[1])) !== null) {
          const isStr = /t="s"/.test(cM[1]);
          const v = /<v>([^<]*)<\/v>/.exec(cM[2]);
          cells.push(v ? (isStr ? (sharedStrings[+v[1]] ?? v[1]) : v[1]) : '');
        }
        if (cells.some(c => c)) rows.push(cells.join('\t'));
      }
    }
    return rows.join('\n') || null;
  } catch (_) { return null; }
}

async function loadReferenceKnowledge() {
  try {
    const res = await fetch(chrome.runtime.getURL('docs/reference/index.json'));
    if (!res.ok) return null;
    const { files } = await res.json();
    if (!Array.isArray(files) || !files.length) return null;

    const MAX = 30_000;
    const parts = [];
    let total = 0;

    for (const entry of files) {
      if (total >= MAX) break;
      try {
        const fileRes = await fetch(chrome.runtime.getURL(`docs/reference/${entry.name}`));
        if (!fileRes.ok) continue;
        const ext = entry.name.split('.').pop().toLowerCase();
        let text = null;
        if      (ext === 'docx')                    text = await extractDocxText(await fileRes.arrayBuffer());
        else if (ext === 'xlsx')                    text = await extractXlsxText(await fileRes.arrayBuffer());
        else if (['txt', 'md', 'csv'].includes(ext)) text = await fileRes.text();
        if (!text?.trim()) continue;
        const label = entry.label || entry.name;
        const chunk = `### ${label}\n${text.trim()}`;
        const remaining = MAX - total;
        parts.push(chunk.length > remaining ? chunk.slice(0, remaining) + '...' : chunk);
        total += Math.min(chunk.length, remaining);
      } catch (e) {
        console.warn(`[DocFlow] Erro ao carregar referência "${entry.name}":`, e.message);
      }
    }
    return parts.length ? parts.join('\n\n') : null;
  } catch (_) { return null; }
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

    const screenGroups = groupStepsByScreen(reindexed);
    const stepsText = screenGroups.map(group => {
      const header = group.screen !== '—' ? `--- Ecrã: ${group.screen} ---` : '--- (ecrã desconhecido) ---';
      return header + '\n' + group.steps.map(formatStep).join('\n');
    }).join('\n\n');

    return `PROCESSO ${sIdx + 1}: "${session.title}" (${date})\n${stepsText}`;
  }).join('\n\n');

  const totalTitle = sessions.map(s => s.title).join(' + ');

  const totalNarrations   = allSteps.filter(s => s.type === 'narration').length;
  const totalInteractions = allSteps.length - totalNarrations;
  const narrationNote = totalNarrations > 0
    ? `\nNarrações de voz: ${totalNarrations} (marcadas com [Narração] — integra-as na descrição funcional da área correspondente)`
    : '';

  return `Cria a documentação funcional para os seguintes processos gravados em fases. Organiza o documento integrando todos os processos de forma coerente.

Processos gravados: ${sessions.length}
Interações registadas: ${totalInteractions}${narrationNote}
Título sugerido: "${totalTitle}"

${sessionBlocks}

Gera o documento completo em Markdown seguindo o formato e as regras do sistema.`;
}

function buildComplementPrompt(session, existingMarkdown) {
  const newStepsText = buildSessionText(session);
  const MAX = 40_000;
  const existing = existingMarkdown.length > MAX
    ? existingMarkdown.slice(0, MAX) + '\n[... documento truncado ...]'
    : existingMarkdown;

  return `DOCUMENTO EXISTENTE (gerado anteriormente — mantém a sua estrutura, secções, tom e idioma):
---
${existing}
---

NOVOS PASSOS GRAVADOS A INCORPORAR:
${newStepsText}

Atualiza o documento existente incorporando os novos passos. Expande ou modifica as secções já existentes quando relevante; adiciona novas secções para funcionalidades ainda não documentadas. Responde APENAS com o documento Markdown completo e atualizado.`;
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
  // If no custom template configured, fall back to the bundled reference style guide
  const template = templateEnabled && templateText
    ? templateText
    : await loadDefaultStyleGuide();

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
    // Strip the large markdown from pendingSession (not needed for result page rendering)
    const { complementOf, ...sessionForResult } = filtered;
    pendingSession = complementOf
      ? { ...sessionForResult, complementOf: { sessionId: complementOf.sessionId, title: complementOf.title } }
      : filtered;
  }

  let userMessage;
  if (sessions.length === 1 && sessions[0].complementOf?.markdown) {
    userMessage = buildComplementPrompt(sessions[0], sessions[0].complementOf.markdown);
  } else if (sessions.length > 1) {
    userMessage = buildPrompt({ steps: [], title: '' }, template, buildMultiSessionText(sessions));
  } else {
    userMessage = buildPrompt(sessions[0], template);
  }

  // Prepend reference knowledge if available
  const referenceKnowledge = await loadReferenceKnowledge();
  if (referenceKnowledge) {
    userMessage =
      'CONHECIMENTO DE REFERÊNCIA DA ORGANIZAÇÃO ' +
      '(terminologia, definições de campos, regras de negócio — ' +
      'usa este conteúdo para enriquecer a documentação com detalhes precisos do sistema):\n' +
      '---\n' + referenceKnowledge + '\n---\n\n' +
      userMessage;
  }

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
async function improveText(text) {
  const data = await chrome.storage.local.get([
    'settings', 'provider', 'anthropicKey', 'anthropicModel', 'openaiKey', 'openaiModel', 'apiKey',
  ]);
  const cfg      = data.settings || {};
  const provider = cfg.provider || data.provider || 'anthropic';
  const apiKey   = await getApiKey(provider, data);
  if (!apiKey) throw new Error('Chave de API não configurada. Vai às definições e adiciona a tua chave.');

  const model = provider === 'openai'
    ? (cfg.openaiModel    || data.openaiModel    || 'gpt-4o')
    : (cfg.anthropicModel || data.anthropicModel || 'claude-opus-4-5');

  const systemPrompt =
    'És um especialista em redação técnica em Português Europeu (PT-PT).\n' +
    'Melhora o trecho de documentação que o utilizador enviar, mantendo:\n' +
    '- O mesmo idioma (Português Europeu, PT-PT)\n' +
    '- O mesmo tom formal e técnico\n' +
    '- O mesmo comprimento aproximado\n' +
    '- O mesmo significado e toda a informação original\n' +
    'Responde APENAS com o texto melhorado, sem explicações nem formatação adicional.';

  const userMessage = `Melhora este trecho de documentação técnica:\n\n${text}`;

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, max_tokens: 1024,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Erro OpenAI: ${res.status}`); }
    const d = await res.json();
    return d.choices[0].message.content.trim();
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model, max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Erro Anthropic: ${res.status}`); }
  const d = await res.json();
  return d.content[0].text.trim();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? null;

  switch (message.type) {
    case MSG.GET_SESSION:
      sendResponse({ session: currentSession });
      return false;

    case MSG.START_SESSION:
      (async () => {
        const session = await startSession(message.title, message.complementOf || null);
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
      _readyPromise.then(() => addStep(
        { type: 'narration', note: message.text, url: message.url, pageTitle: message.pageTitle },
        null // narrations don't trigger screenshot capture
      )).then(step =>
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

    case MSG.IMPROVE_TEXT:
      improveText(message.text)
        .then(improved => sendResponse({ improved }))
        .catch(err    => sendResponse({ error: err.message }));
      return true;
  }
});
