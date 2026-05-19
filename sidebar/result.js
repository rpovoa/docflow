'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let markdownContent = '';
let sessionData     = null;

// Maps step.id → <figure> element (for sidebar → screenshot scroll)
const screenshotEls = new Map();

// ── Boot ──────────────────────────────────────────────────────────────────────
(async function init() {
  const { pendingDocument, pendingSession } =
    await chrome.storage.local.get(['pendingDocument', 'pendingSession']);

  if (!pendingDocument || !pendingSession) {
    document.getElementById('loading').remove();
    document.getElementById('no-doc').classList.remove('hidden');
    return;
  }

  markdownContent = pendingDocument;
  sessionData     = pendingSession;

  document.title = `${sessionData.title} — DocFlow`;
  document.getElementById('header-title').textContent = sessionData.title;

  const usedStepIds = renderDocument();
  renderSidebar();
  renderScreenshots(usedStepIds);
  setupExports();
  setupLightbox();

  document.getElementById('loading').remove();
  document.getElementById('app').classList.remove('hidden');
})();

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
           buildAnnotationSVG(step.annotation) +
           `</div>` +
           `<figcaption>${annotationLabel(step)}</figcaption>` +
           `</figure>`;
  });

  const contentEl = document.getElementById('document-content');
  contentEl.innerHTML = html;

  // Open lightbox when an inline screenshot is clicked
  contentEl.addEventListener('click', e => {
    const fig = e.target.closest('.inline-screenshot');
    if (!fig) return;
    const step = sessionData.steps.find(s => s.id === fig.dataset.stepId);
    if (step) openLightbox(step);
  });

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
    document.getElementById('screenshots-section').remove();
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
    wrap.insertAdjacentHTML('beforeend', buildAnnotationSVG(step.annotation));
    fig.appendChild(wrap);
    fig.addEventListener('click', () => openLightbox(step));

    const caption    = document.createElement('figcaption');
    caption.textContent = `${step.index}. ${annotationLabel(step)}`;

    fig.appendChild(caption);
    grid.appendChild(fig);

    screenshotEls.set(step.id, fig);
  });
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function setupLightbox() {
  const lb = document.getElementById('lightbox');
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
}

function openLightbox(step) {
  const lb   = document.getElementById('lightbox');
  const wrap = document.getElementById('lightbox-img-wrap');
  document.getElementById('lightbox-img').src = step.screenshot;
  document.getElementById('lightbox-caption').textContent =
    `Passo ${step.index} — ${stepLabel(step)}`;

  const existingSvg = wrap.querySelector('.annotation-svg');
  if (existingSvg) existingSvg.remove();
  const svgHtml = buildAnnotationSVG(step.annotation, 'meet');
  if (svgHtml) wrap.insertAdjacentHTML('beforeend', svgHtml);

  lb.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  const lb   = document.getElementById('lightbox');
  const wrap = document.getElementById('lightbox-img-wrap');
  lb.classList.add('hidden');
  document.getElementById('lightbox-img').src = '';
  const svg = wrap?.querySelector('.annotation-svg');
  if (svg) svg.remove();
  document.body.style.overflow = '';
}

// ── Export (US-12) ────────────────────────────────────────────────────────────

function setupExports() {
  document.getElementById('btn-copy-md').addEventListener('click', copyMarkdown);
  document.getElementById('btn-download-html').addEventListener('click', downloadHtml);
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

// ── Markdown → HTML renderer ──────────────────────────────────────────────────
// Handles: # h1, ## h2, ### h3, 1. ol, - ul, **bold**, *italic*, `code`, paragraphs

function markdownToHtml(md) {
  const lines = md.split('\n');
  let   html  = '';
  let   inOl = false, inUl = false, inP = false;

  function closeLists() {
    if (inOl) { html += '</ol>\n'; inOl = false; }
    if (inUl) { html += '</ul>\n'; inUl = false; }
  }
  function closeP() {
    if (inP) { html += '</p>\n'; inP = false; }
  }

  // Apply inline formatting after HTML-escaping the text
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
