'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let markdownContent = '';
let sessionData     = null;

// Maps step.id → <figure> element (for sidebar → screenshot scroll)
const screenshotEls = new Map();

// ── Boot ──────────────────────────────────────────────────────────────────────
(async function init() {
  const stored = await chrome.storage.local.get([
    'pendingStreamConfig', 'pendingDocument', 'pendingSession',
  ]);

  if (stored.pendingStreamConfig && stored.pendingSession) {
    // ── Streaming mode ────────────────────────────────────────────────────────
    const streamConfig = stored.pendingStreamConfig;
    sessionData = stored.pendingSession;

    // Consume the config so re-opening the page falls back to saved document
    await chrome.storage.local.remove('pendingStreamConfig');

    document.title = `${sessionData.title} — DocFlow`;
    document.getElementById('header-title').textContent = sessionData.title;

    if (sessionData.refFiles?.length) setupRefBadge(sessionData.refFiles);

    setupExports();
    setupLightbox();
    setupChat();
    setupComplement();
    setupValidation();

    document.getElementById('loading').remove();
    document.getElementById('app').classList.remove('hidden');

    // Stream into document area; when done, render sidebar/screenshots/regen
    await startStreaming(streamConfig);

  } else if (stored.pendingDocument && stored.pendingSession) {
    // ── Normal (pre-saved) mode ───────────────────────────────────────────────
    markdownContent = stored.pendingDocument;
    sessionData     = stored.pendingSession;

    document.title = `${sessionData.title} — DocFlow`;
    document.getElementById('header-title').textContent = sessionData.title;

    if (sessionData.refFiles?.length) setupRefBadge(sessionData.refFiles);

    const usedStepIds = renderDocument();
    renderSidebar();
    renderScreenshots(usedStepIds);
    setupExports();
    setupLightbox();
    setupChat();
    setupComplement();
    setupValidation();
    setupSectionRegen();

    document.getElementById('loading').remove();
    document.getElementById('app').classList.remove('hidden');

  } else {
    document.getElementById('loading').remove();
    document.getElementById('no-doc').classList.remove('hidden');
  }
})();

// ── Streaming generation ──────────────────────────────────────────────────────

async function startStreaming(config) {
  const contentEl = document.getElementById('document-content');
  contentEl.innerHTML =
    '<div class="stream-init"><div class="stream-cursor-block"></div>' +
    '<span>A gerar documentação…</span></div>';

  // Get API key directly from extension storage
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
      contentEl.innerHTML =
        `<div class="stream-error">${escHtml(err.message)}</div>`;
      return;
    }
    // Partial result — still render what arrived
  }

  markdownContent = accum;

  // Persist to history so refresh/revisit shows the document
  chrome.runtime.sendMessage({
    type: 'SAVE_GENERATED_DOC',
    sessionIds: config.sessionIds,
    title:      config.title,
    markdown:   markdownContent,
  }).catch(() => {});

  // Full render now that markdown is complete
  const usedStepIds = renderDocument();
  renderSidebar();
  renderScreenshots(usedStepIds);
  setupSectionRegen();
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

// ── Document rendering with inline screenshots (US-10, US-11) ────────────────

function renderDocument() {
  // Index screenshots by step index for O(1) lookup
  const byIndex = new Map(
    sessionData.steps
      .filter(s => s.screenshot)
      .map(s => [s.index, s])
  );

  let html = markdownToHtml(markdownContent);
  const usedStepIds = new Set();

  // Replace {{screenshot:N}} markers emitted by the AI
  html = html.replace(/\{\{screenshot:(\d+)\}\}/g, (_, n) => {
    const step = byIndex.get(parseInt(n, 10));
    if (!step) return '';
    usedStepIds.add(step.id);
    return `<figure class="inline-screenshot" data-step-id="${escAttr(step.id)}">` +
           `<div class="shot-wrap">` +
           `<img src="${step.screenshot}" alt="Passo ${step.index}" loading="lazy">` +
           `</div>` +
           `<figcaption>${annotationLabel(step)}</figcaption>` +
           `</figure>`;
  });

  const contentEl = document.getElementById('document-content');
  contentEl.innerHTML = html;

  // Attach click handler only once (event delegation — survives innerHTML replacements)
  if (!contentEl.dataset.clickBound) {
    contentEl.dataset.clickBound = '1';
    contentEl.addEventListener('click', e => {
      const fig = e.target.closest('.inline-screenshot');
      if (!fig) return;
      const step = sessionData.steps.find(s => s.id === fig.dataset.stepId);
      if (step) openLightbox(step);
    });
  }

  return usedStepIds;
}

// ── Sidebar (captured steps) ───────────────────────────────────────────────────

function renderSidebar() {
  const { steps } = sessionData;
  document.getElementById('step-count-badge').textContent = steps.length;

  const list = document.getElementById('step-list');

  steps.forEach(step => {
    const item  = document.createElement('div');
    item.className = 'step-item' + (step.screenshot ? ' has-screenshot' : '');
    item.dataset.stepId = step.id;

    const label   = stepLabel(step);
    const icon    = stepIcon(step.type);
    const pageStr = step.pageTitle || '';

    item.innerHTML =
      `<span class="step-num">${step.index}</span>` +
      `<span class="step-icon">${icon}</span>` +
      `<span class="step-body">` +
        `<span class="step-label" title="${escAttr(label)}">${escHtml(label)}</span>` +
        (pageStr ? `<span class="step-page">${escHtml(pageStr)}</span>` : '') +
      `</span>` +
      (step.screenshot ? '<span class="step-cam" title="Tem screenshot">📷</span>' : '');

    if (step.screenshot) {
      item.addEventListener('click', () => scrollToScreenshot(step.id, item));
    }

    list.appendChild(item);
  });
}

function scrollToScreenshot(stepId, sidebarItem) {
  const fig = screenshotEls.get(stepId);
  if (!fig) return;

  fig.scrollIntoView({ behavior: 'smooth', block: 'center' });
  fig.classList.add('highlight');
  setTimeout(() => fig.classList.remove('highlight'), 1800);

  // Highlight sidebar item briefly
  document.querySelectorAll('.step-item.active').forEach(el => el.classList.remove('active'));
  sidebarItem.classList.add('active');
  setTimeout(() => sidebarItem.classList.remove('active'), 1800);
}

// ── Screenshot grid — fallback for screenshots not shown inline (US-11) ───────

function renderScreenshots(usedStepIds = new Set()) {
  // Only show screenshots that the AI did not reference inline
  const stepsWithScreenshot = sessionData.steps.filter(
    s => s.screenshot && !usedStepIds.has(s.id)
  );

  if (!stepsWithScreenshot.length) {
    document.getElementById('screenshots-section')?.remove();
    return;
  }

  document.getElementById('screenshot-count').textContent = stepsWithScreenshot.length;
  const grid = document.getElementById('screenshots-grid');

  stepsWithScreenshot.forEach(step => {
    const fig      = document.createElement('figure');
    fig.className  = 'screenshot-item';
    fig.dataset.stepId = step.id;

    const wrap = document.createElement('div');
    wrap.className = 'shot-wrap';

    const img        = document.createElement('img');
    img.src          = step.screenshot;
    img.alt          = `Passo ${step.index}: ${stepLabel(step)}`;
    img.loading      = 'lazy';

    wrap.appendChild(img);
    fig.appendChild(wrap);
    fig.addEventListener('click', () => openLightbox(step));

    const caption    = document.createElement('figcaption');
    caption.textContent = `${step.index}. ${annotationLabel(step)}`;

    fig.appendChild(caption);
    grid.appendChild(fig);

    screenshotEls.set(step.id, fig);
  });
}

// ── Reference badge popover ───────────────────────────────────────────────────

function setupRefBadge(refFiles) {
  const badge   = document.getElementById('ref-badge');
  const popover = document.getElementById('ref-popover');
  const list    = document.getElementById('ref-popover-list');
  const n       = refFiles.length;

  badge.textContent = `📚 ${n} referência${n > 1 ? 's' : ''}`;
  badge.classList.remove('hidden');

  list.innerHTML = refFiles.map(f =>
    `<li class="ref-popover-item">` +
    `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" class="ref-file-icon">` +
    `<path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/>` +
    `</svg>` +
    `<span>${escHtml(f)}</span>` +
    `</li>`
  ).join('');

  badge.addEventListener('click', e => {
    e.stopPropagation();
    const open = !popover.classList.contains('hidden');
    if (open) {
      popover.classList.add('hidden');
      return;
    }
    // Position below the badge
    const r = badge.getBoundingClientRect();
    popover.style.top  = `${r.bottom + 6}px`;
    popover.style.left = `${r.left}px`;
    popover.classList.remove('hidden');
  });

  document.addEventListener('click', e => {
    if (!popover.contains(e.target) && e.target !== badge) {
      popover.classList.add('hidden');
    }
  });
}

// ── Complement ────────────────────────────────────────────────────────────────

function setupComplement() {
  const btn   = document.getElementById('btn-complement');
  const toast = document.getElementById('complement-toast');

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;

    try {
      await chrome.runtime.sendMessage({
        type: 'START_SESSION',
        title: sessionData.title,
        complementOf: {
          sessionId: sessionData.id,
          title:     sessionData.title,
          markdown:  markdownContent,
        },
      });

      btn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">' +
        '<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>' +
        '</svg> Gravação iniciada';
      btn.classList.add('complement-active');

      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 8000);
    } catch (err) {
      btn.disabled = false;
      console.error('[DocFlow] Failed to start complement session:', err);
    }
  });
}

// ── Validation ────────────────────────────────────────────────────────────────

function setupValidation() {
  const btn = document.getElementById('btn-validate');
  if (!btn) return;
  btn.addEventListener('click', runValidation);
}

async function runValidation() {
  const btn   = document.getElementById('btn-validate');
  const panel = document.getElementById('validation-panel');
  if (!panel) return;

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
      steps:    sessionData.steps,
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
  const panel = document.getElementById('validation-panel');
  const score = Math.round(data.score ?? 0);
  const scoreColor = score >= 80 ? 'var(--green)' : score >= 55 ? '#f59e0b' : '#ef4444';

  let html =
    `<div class="validation-header">` +
      `<div class="validation-score" style="color:${scoreColor}">${score}<span>%</span></div>` +
      `<div class="validation-summary">${escHtml(data.summary || '')}</div>` +
      `<button class="validation-close" id="validation-close" title="Fechar">✕</button>` +
    `</div>`;

  if (data.issues?.length) {
    html += `<div class="validation-section"><div class="validation-section-title">Pontos a melhorar</div>`;
    data.issues.forEach(issue => {
      const icon = issue.type === 'missing' ? '⚠' : '⚡';
      html +=
        `<div class="validation-item validation-issue">` +
        `<span class="vi-icon">${icon}</span>` +
        `<span>${escHtml(issue.description)}</span></div>`;
    });
    html += '</div>';
  }

  if (data.ok?.length) {
    html += `<div class="validation-section"><div class="validation-section-title">Pontos positivos</div>`;
    data.ok.forEach(item => {
      html +=
        `<div class="validation-item validation-ok">` +
        `<span class="vi-icon">✓</span>` +
        `<span>${escHtml(item)}</span></div>`;
    });
    html += '</div>';
  }

  panel.innerHTML = html;
  document.getElementById('validation-close').addEventListener('click', () => {
    panel.classList.add('hidden');
  });
}

// ── Section regeneration ──────────────────────────────────────────────────────

let _regenPopover    = null;
let _regenCloseClick = null;

function setupSectionRegen() {
  const contentEl = document.getElementById('document-content');
  contentEl.querySelectorAll('h2, h3').forEach(h => {
    // Avoid adding duplicate buttons if called multiple times
    if (h.querySelector('.section-regen-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'section-regen-btn';
    btn.title     = 'Regenerar esta secção com IA';
    btn.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor">' +
      '<path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/>' +
      '</svg>';
    h.appendChild(btn);
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openRegenPopover(h, btn);
    });
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

  // Position near the heading
  const rect = triggerBtn.getBoundingClientRect();
  const popW = 300;
  popover.style.position = 'absolute';
  popover.style.top      = `${rect.bottom + window.scrollY + 6}px`;
  popover.style.left     = `${Math.max(8, Math.min(rect.left, window.innerWidth - popW - 8))}px`;
  popover.style.width    = `${popW}px`;

  popover.querySelector('.regen-popover-input').focus();

  popover.querySelector('.regen-cancel').addEventListener('click', closeRegenPopover);

  async function submit() {
    const input       = popover.querySelector('.regen-popover-input');
    const instruction = input.value.trim();
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

  // Strip markdown inline formatting for comparison (** * `)
  const stripMd = t => t.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').trim();

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(prefix)) continue;
    const lineText = stripMd(lines[i].slice(prefix.length));
    if (lineText === stripMd(headingText)) { start = i; break; }
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
    statusEl.textContent  = 'Não foi possível localizar a secção no Markdown.';
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Regenerar';
    return;
  }

  try {
    const result = await chrome.runtime.sendMessage({
      type:            'REGENERATE_SECTION',
      sectionMarkdown: sectionMd,
      instruction,
    });

    if (result?.error) {
      statusEl.textContent  = `Erro: ${result.error}`;
      submitBtn.disabled    = false;
      submitBtn.textContent = 'Regenerar';
      return;
    }

    // Update markdown and close popover before re-render
    markdownContent = markdownContent.replace(sectionMd, result.markdown);
    closeRegenPopover();

    // Re-render document (screenshots section remains untouched)
    renderDocument();
    setupSectionRegen();

    // Scroll to the regenerated heading
    const allHeadings = document.getElementById('document-content').querySelectorAll('h2, h3');
    for (const h of allHeadings) {
      const ht = h.childNodes[0]?.textContent?.trim() || h.textContent.trim();
      if (ht === headingText) {
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        h.classList.add('regen-highlight');
        setTimeout(() => h.classList.remove('regen-highlight'), 2000);
        break;
      }
    }

  } catch (err) {
    statusEl.textContent  = `Erro: ${err.message}`;
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Regenerar';
  }
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function setupLightbox() {
  const lb = document.getElementById('lightbox');
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('chat-panel').classList.contains('hidden')) return;
    closeLightbox();
  });
}

function openLightbox(step) {
  const lb   = document.getElementById('lightbox');
  const wrap = document.getElementById('lightbox-img-wrap');
  document.getElementById('lightbox-img').src = step.screenshot;
  document.getElementById('lightbox-caption').textContent =
    `Passo ${step.index} — ${stepLabel(step)}`;

  lb.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
  document.getElementById('lightbox-img').src = '';
  document.body.style.overflow = '';
}

// ── Export (US-12) ────────────────────────────────────────────────────────────

function setupExports() {
  // Back to Dashboard — passes session ID so dashboard shows steps without auto-redirecting
  document.getElementById('btn-back-dashboard').addEventListener('click', () => {
    const sessionId = sessionData?.id || '';
    window.location.href =
      chrome.runtime.getURL('dashboard/dashboard.html') +
      (sessionId ? `?manage=${encodeURIComponent(sessionId)}` : '');
  });

  document.getElementById('btn-copy-md').addEventListener('click', copyMarkdown);
  document.getElementById('btn-download-html').addEventListener('click', downloadHtml);
  document.getElementById('btn-download-docx').addEventListener('click', () => {
    exportToDocx(markdownContent, sessionData.title);
  });
}

async function copyMarkdown() {
  await navigator.clipboard.writeText(markdownContent);
  const btn = document.getElementById('btn-copy-md');
  btn.classList.add('copied');
  const prev = btn.innerHTML;
  btn.innerHTML = '✓ Copiado!';
  setTimeout(() => { btn.innerHTML = prev; btn.classList.remove('copied'); }, 2200);
}

function downloadHtml() {
  const html = buildHtmlExport();
  const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = sanitizeFilename(sessionData.title) + '.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildHtmlExport() {
  const rendered  = markdownToHtml(markdownContent);
  const dateStr   = new Date().toLocaleDateString('pt-PT', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const screenshots = sessionData.steps
    .filter(s => s.screenshot)
    .map(s =>
      `<figure>
        <img src="${s.screenshot}" alt="Passo ${s.index}">
        <figcaption>Passo ${s.index}: ${escHtml(stepLabel(s))}</figcaption>
      </figure>`
    ).join('\n');

  return `<!DOCTYPE html>
<html lang="pt-PT">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(sessionData.title)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{max-width:800px;margin:0 auto;padding:48px 24px 80px;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;line-height:1.75}
    h1{font-size:2em;border-bottom:2px solid #1a1a1a;padding-bottom:.35em;margin-bottom:.6em;line-height:1.25}
    h2{font-size:1.35em;font-weight:600;color:#2a2a2a;margin-top:2.2em;margin-bottom:.5em;padding-bottom:.2em;border-bottom:1px solid #eee}
    h3{font-size:1.1em;font-weight:600;margin-top:1.5em;margin-bottom:.3em}
    p{margin:.8em 0}
    ol,ul{padding-left:1.5em;margin:.8em 0}
    li{margin:.4em 0}
    strong{font-weight:700}
    em{font-style:italic}
    code{background:#f4f4f4;border:1px solid #e0e0e0;border-radius:3px;padding:1px 5px;font-size:.88em;font-family:monospace}
    .screenshots{margin-top:3em;padding-top:2em;border-top:1px solid #eee}
    .screenshots h2{border-bottom:none;color:#555}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-top:1em}
    figure{margin:0}
    figure img{width:100%;border:1px solid #ddd;border-radius:4px;display:block}
    figcaption{font-size:11px;color:#888;margin-top:4px;text-align:center;font-family:-apple-system,sans-serif}
    table{width:100%;border-collapse:collapse;margin:1.1em 0 1.4em;font-size:.9em;font-family:-apple-system,sans-serif}
    th,td{text-align:left;padding:8px 14px;border:1px solid #ddd;vertical-align:top;line-height:1.55}
    thead th{background:#f5f5f5;font-weight:600;font-size:.82em;text-transform:uppercase;letter-spacing:.05em;color:#333}
    tbody td{color:#444}
    tbody tr:nth-child(even) td{background:#fafafa}
    footer{margin-top:3em;padding-top:1em;border-top:1px solid #eee;font-size:12px;color:#aaa;text-align:center;font-family:-apple-system,sans-serif}
  </style>
</head>
<body>
  <article>${rendered}</article>
  ${screenshots ? `<section class="screenshots"><h2>Screenshots</h2><div class="grid">${screenshots}</div></section>` : ''}
  <footer>Gerado com <strong>DocFlow</strong> em ${dateStr}</footer>
</body>
</html>`;
}

// ── Chat assistant feature ────────────────────────────────────────────────────

let chatHistory       = [];
let chatSelectedRange = null;
let chatSelectedText  = '';

function setupChat() {
  const docContent  = document.getElementById('document-content');
  const floatBtn    = document.getElementById('btn-chat-select');
  const panel       = document.getElementById('chat-panel');
  const toggleBtn   = document.getElementById('btn-chat');
  const closeBtn    = document.getElementById('chat-close');
  const clearBtn    = document.getElementById('chat-clear');
  const sendBtn     = document.getElementById('chat-send');
  const inputEl     = document.getElementById('chat-input');
  const ctxRemove   = document.getElementById('chat-ctx-remove');

  // Show floating "send to chat" button on text selection within document
  docContent.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      floatBtn.classList.add('hidden');
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 10) { floatBtn.classList.add('hidden'); return; }

    const rect = sel.getRangeAt(0).getBoundingClientRect();
    floatBtn.style.top  = `${rect.bottom + 8}px`;
    floatBtn.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - 160))}px`;
    floatBtn.classList.remove('hidden');
  });

  // Hide float button on mousedown outside doc/button
  document.addEventListener('mousedown', e => {
    if (e.target === floatBtn) return;
    if (!e.target.closest('#document-content')) floatBtn.classList.add('hidden');
  });

  // Float button clicked → save selection, open chat with context
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

  toggleBtn.addEventListener('click', toggleChat);
  closeBtn.addEventListener('click', closeChat);

  clearBtn.addEventListener('click', () => {
    chatHistory = [];
    chatSelectedRange = null;
    chatSelectedText  = '';
    document.getElementById('chat-messages').innerHTML =
      `<div class="chat-empty" id="chat-empty">
        <div class="chat-empty-icon">💬</div>
        <p>Seleciona texto no documento e clica em <strong>Enviar para chat</strong> para melhorá-lo com instruções.</p>
        <p style="margin-top:8px;font-size:12px">Ou escreve diretamente uma pergunta ou instrução.</p>
      </div>`;
    document.getElementById('chat-ctx-bar').classList.add('hidden');
  });

  ctxRemove.addEventListener('click', () => {
    chatSelectedRange = null;
    chatSelectedText  = '';
    document.getElementById('chat-ctx-bar').classList.add('hidden');
  });

  sendBtn.addEventListener('click', sendChatMessage);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // Escape closes chat if open
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.classList.contains('hidden')) {
      closeChat();
      e.stopImmediatePropagation();
    }
  });
}

function openChat() {
  document.getElementById('chat-panel').classList.remove('hidden');
  document.getElementById('btn-chat').classList.add('btn-chat-active');
}

function closeChat() {
  document.getElementById('chat-panel').classList.add('hidden');
  document.getElementById('btn-chat').classList.remove('btn-chat-active');
}

function toggleChat() {
  const panel = document.getElementById('chat-panel');
  if (panel.classList.contains('hidden')) {
    openChat();
    document.getElementById('chat-input').focus();
  } else {
    closeChat();
  }
}

function setContextBar(text) {
  const bar     = document.getElementById('chat-ctx-bar');
  const ctxText = document.getElementById('chat-ctx-text');
  ctxText.textContent = text.length > 80 ? text.slice(0, 80) + '…' : text;
  bar.classList.remove('hidden');
}

async function sendChatMessage() {
  const inputEl = document.getElementById('chat-input');
  const instruction = inputEl.value.trim();
  if (!instruction) return;

  const savedRange = chatSelectedRange;
  const savedText  = chatSelectedText;

  // Build content for this user turn
  let userContent = instruction;
  if (savedText) {
    userContent =
      `[TEXTO SELECIONADO]\n${savedText}\n[/TEXTO SELECIONADO]\n\n${instruction}`;
  }

  // Append user bubble and add to history
  appendUserMessage(instruction, savedText);
  chatHistory.push({ role: 'user', content: userContent });

  // Clear input and context
  inputEl.value = '';
  chatSelectedRange = null;
  chatSelectedText  = '';
  document.getElementById('chat-ctx-bar').classList.add('hidden');

  // Typing indicator
  const typingId = 'typing-' + Date.now();
  const messagesEl = document.getElementById('chat-messages');
  const typingEl = document.createElement('div');
  typingEl.id = typingId;
  typingEl.className = 'chat-msg chat-msg-ai';
  typingEl.innerHTML = '<div class="chat-typing"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(typingEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'CHAT_IMPROVE',
      history: chatHistory,
    });

    typingEl.remove();

    if (result?.error) throw new Error(result.error);

    const raw = result?.response || '';

    // Parse [MELHORIA]...[/MELHORIA] block
    const improvedMatch = raw.match(/\[MELHORIA\]([\s\S]*?)\[\/MELHORIA\]/);
    const improved     = improvedMatch ? improvedMatch[1].trim() : null;
    const explanation  = raw.replace(/\[MELHORIA\][\s\S]*?\[\/MELHORIA\]/, '').trim();

    chatHistory.push({ role: 'assistant', content: raw });

    appendAssistantMessage(explanation, improved, savedRange, savedText);
  } catch (err) {
    typingEl.remove();
    const errorEl = document.createElement('div');
    errorEl.className = 'chat-msg chat-msg-ai';
    errorEl.innerHTML =
      `<div class="chat-error">${escHtml(err.message || 'Erro ao contactar o assistente.')}</div>`;
    messagesEl.appendChild(errorEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    // Remove failed turn from history so user can retry cleanly
    chatHistory.pop();
  }
}

function appendUserMessage(instruction, selectedText) {
  const messagesEl = document.getElementById('chat-messages');
  document.getElementById('chat-empty')?.remove();

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
  const messagesEl = document.getElementById('chat-messages');

  const msg = document.createElement('div');
  msg.className = 'chat-msg chat-msg-ai';

  let inner = '';
  if (explanation) {
    inner += `<div class="chat-bubble">${escHtml(explanation)}</div>`;
  }

  if (improved) {
    const improvedId = 'imp-' + Date.now();
    inner +=
      `<div class="chat-improved" id="${improvedId}">` +
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
    const block = msg.querySelector('.chat-improved');
    const acceptBtn = block.querySelector('.chat-btn-accept');
    const copyBtn   = block.querySelector('.chat-btn-copy');

    acceptBtn.addEventListener('click', () => {
      applyImprovement(improved, savedText, savedRange, acceptBtn);
    });

    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(improved);
      const prev = copyBtn.textContent;
      copyBtn.textContent = 'Copiado!';
      setTimeout(() => { copyBtn.textContent = prev; }, 2000);
    });
  }

  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function applyImprovement(improved, originalText, range, acceptBtn) {
  if (!range) {
    if (acceptBtn) {
      acceptBtn.textContent = 'Sem selecção activa';
      acceptBtn.disabled = true;
    }
    return;
  }

  try {
    range.deleteContents();
    const node = document.createTextNode(improved);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
  } catch (e) {
    console.warn('[DocFlow] DOM replacement failed:', e);
  }

  if (originalText && markdownContent.includes(originalText)) {
    markdownContent = markdownContent.replace(originalText, improved);
  }

  if (acceptBtn) {
    acceptBtn.textContent = 'Aplicado ✓';
    acceptBtn.disabled = true;
  }
}

// ── Markdown → HTML renderer ──────────────────────────────────────────────────
// Handles: # h1, ## h2, ### h3, 1. ol, - ul, **bold**, *italic*, `code`, tables, paragraphs

function markdownToHtml(md) {
  const lines = md.split('\n');
  let   html  = '';
  let   inOl = false, inUl = false, inP = false, inTable = false;
  let   tableLines = [];

  // Apply inline formatting after HTML-escaping the text
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
  function closeP() {
    if (inP) { html += '</p>\n'; inP = false; }
  }
  function flushTable() {
    if (!inTable) return;
    inTable = false;
    if (tableLines.length < 2) { tableLines = []; return; }
    const parseCells = line =>
      line.replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
    const headers = parseCells(tableLines[0]);
    // tableLines[1] is the separator row (|---|---|) — skip it
    const rows = tableLines.slice(2).map(parseCells);
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

    // Table rows start with |
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

// ── Screenshot annotation overlay ─────────────────────────────────────────────
// Coordinates in `annotation` are absolute CSS pixels of the original viewport.
// Using SVG viewBox + preserveAspectRatio to match the image's object-fit behaviour:
//   'slice' (xMidYMin) = object-fit:cover; object-position:top  → inline screenshots
//   'meet'  (xMidYMid) = object-fit:contain; object-position:center → lightbox

function buildAnnotationSVG(annotation, mode) {
  if (!annotation?.vw) return '';          // ignore old sessions without absolute coords
  const { vw, vh, x, y, rect } = annotation;
  const isClick = x !== undefined && y !== undefined;
  const ar = (mode === 'meet') ? 'xMidYMid meet' : 'xMidYMin slice';
  const sw  = Math.max(1, vw * 0.0018);   // stroke-width scales with viewport

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
  const base = `Passo ${step.index}`;
  if (!step.annotation) return base;
  if (step.annotation.x !== undefined) return `${base} · clique`;
  if (step.type === 'input')  return `${base} · preenchimento`;
  if (step.type === 'select') return `${base} · seleção`;
  return base;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepIcon(type) {
  const icons = {
    click: '👆', input: '⌨️', select: '▾', navigation: '→',
    submit: '↵', manual: '📝', screenshot: '📷',
  };
  return icons[type] || '•';
}

function stepLabel(step) {
  if (step.type === 'navigation') return step.pageTitle || step.url || 'Navegação';
  if (step.type === 'manual')     return step.note || 'Nota manual';
  if (step.type === 'screenshot') return 'Screenshot manual';
  return step.element?.label || step.pageTitle || step.type;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return escHtml(s).replace(/'/g, '&#39;');
}

function sanitizeFilename(name) {
  return (name || 'docflow')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'docflow';
}
