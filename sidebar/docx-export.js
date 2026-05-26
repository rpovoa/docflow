'use strict';

// ── CRC-32 ────────────────────────────────────────────────────────────────────
const _crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function _crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = _crcTable[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── ZIP writer (stored, no compression) ──────────────────────────────────────
function _buildZip(files) {
  const enc      = new TextEncoder();
  const locals   = [];
  const centrals = [];
  let   offset   = 0;

  for (const { path, data } of files) {
    const name = enc.encode(path);
    const crc  = _crc32(data);
    const sz   = data.length;

    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32( 0, 0x04034b50, true);
    lv.setUint16( 4, 20, true);
    lv.setUint16( 6, 0,  true);
    lv.setUint16( 8, 0,  true); // stored
    lv.setUint16(10, 0,  true);
    lv.setUint16(12, 0,  true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, sz,  true);
    lv.setUint32(22, sz,  true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0,  true);
    lh.set(name, 30);
    locals.push(lh, data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32( 0, 0x02014b50, true);
    cv.setUint16( 4, 20, true);
    cv.setUint16( 6, 20, true);
    cv.setUint16( 8, 0,  true);
    cv.setUint16(10, 0,  true);
    cv.setUint16(12, 0,  true);
    cv.setUint16(14, 0,  true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, sz,  true);
    cv.setUint32(24, sz,  true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    centrals.push(cd);

    offset += lh.length + data.length;
  }

  const cdBuf = _concat(centrals);
  const eocd  = new Uint8Array(22);
  const ev    = new DataView(eocd.buffer);
  ev.setUint32( 0, 0x06054b50,   true);
  ev.setUint16( 4, 0,            true);
  ev.setUint16( 6, 0,            true);
  ev.setUint16( 8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdBuf.length, true);
  ev.setUint32(16, offset,       true);
  ev.setUint16(20, 0,            true);

  return _concat([...locals, cdBuf, eocd]);
}

function _concat(arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out   = new Uint8Array(total);
  let   off   = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ── XML escape ────────────────────────────────────────────────────────────────
function _xe(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Inline Markdown → DOCX runs ──────────────────────────────────────────────
function _runs(text, extraRpr) {
  const base = extraRpr || '';
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.filter(Boolean).map(p => {
    const t = `<w:t xml:space="preserve">${_xe(p.slice(p.startsWith('**') ? 2 : p.startsWith('*') || p.startsWith('`') ? 1 : 0, p.endsWith('**') ? -2 : p.endsWith('*') || p.endsWith('`') ? -1 : undefined))}</w:t>`;
    if (p.startsWith('**') && p.endsWith('**'))
      return `<w:r><w:rPr>${base}<w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">${_xe(p.slice(2,-2))}</w:t></w:r>`;
    if (p.startsWith('*') && p.endsWith('*'))
      return `<w:r><w:rPr>${base}<w:i/><w:iCs/></w:rPr><w:t xml:space="preserve">${_xe(p.slice(1,-1))}</w:t></w:r>`;
    if (p.startsWith('`') && p.endsWith('`'))
      return `<w:r><w:rPr>${base}<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t xml:space="preserve">${_xe(p.slice(1,-1))}</w:t></w:r>`;
    if (base) return `<w:r><w:rPr>${base}</w:rPr><w:t xml:space="preserve">${_xe(p)}</w:t></w:r>`;
    return `<w:r><w:t xml:space="preserve">${_xe(p)}</w:t></w:r>`;
  }).join('');
}

function _para(styleId, text) {
  return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>${_runs(text)}</w:p>`;
}

// ── Markdown → DOCX body XML ──────────────────────────────────────────────────
function _mdToBody(md) {
  const lines   = md.split('\n');
  const out     = [];
  let   inTable = false;
  let   tblRows = [];

  const HDR_RPR = '<w:b/><w:bCs/><w:color w:val="FFFFFF"/><w:sz w:val="20"/><w:szCs w:val="20"/>';

  function flushTable() {
    if (!tblRows.length) { inTable = false; return; }
    const parseRow = l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const headers  = parseRow(tblRows[0]);
    const dataRows = tblRows.slice(2).map(parseRow);

    let xml = '<w:tbl>' +
      '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>';

    xml += '<w:tr><w:trPr><w:tblHeader/></w:trPr>';
    for (const h of headers) {
      xml += '<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="2B5797"/></w:tcPr>' +
             `<w:p><w:pPr><w:pStyle w:val="TableHeading"/></w:pPr>${_runs(h, HDR_RPR)}</w:p></w:tc>`;
    }
    xml += '</w:tr>';

    dataRows.forEach((row, ri) => {
      const shade = ri % 2 === 1 ? '<w:shd w:val="clear" w:color="auto" w:fill="EBF3FB"/>' : '';
      xml += '<w:tr>';
      for (const cell of row) {
        xml += `<w:tc><w:tcPr>${shade}</w:tcPr>` +
               `<w:p><w:pPr><w:pStyle w:val="TableContents"/></w:pPr>${_runs(cell)}</w:p></w:tc>`;
      }
      xml += '</w:tr>';
    });

    xml += '</w:tbl><w:p/>';
    out.push(xml);
    tblRows = [];
    inTable = false;
  }

  for (const line of lines) {
    const t = line.trim();

    if (t.startsWith('|')) {
      inTable = true;
      tblRows.push(t);
      continue;
    }
    if (inTable) flushTable();
    if (!t) continue;

    if      (t.startsWith('### ')) out.push(_para('Heading3',   t.slice(4)));
    else if (t.startsWith('## '))  out.push(_para('Heading2',   t.slice(3)));
    else if (t.startsWith('# '))   out.push(_para('Heading1',   t.slice(2)));
    else if (/^\d+\.\s/.test(t))   out.push(_para('ListNumber', t.replace(/^\d+\.\s+/, '')));
    else if (/^[-*]\s/.test(t))    out.push(_para('ListBullet', t.slice(2)));
    else                            out.push(_para('BodyText',   t));
  }
  if (inTable) flushTable();
  if (!out.length) out.push('<w:p/>');
  return out.join('\n');
}

// ── Extract styles.xml from a template DOCX ───────────────────────────────────
async function _extractTemplateStyles(buffer) {
  try {
    const data = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 65558); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) return null;
    const cdCount  = view.getUint16(eocd + 8,  true);
    const cdOffset = view.getUint32(eocd + 16, true);
    let pos = cdOffset;
    for (let i = 0; i < cdCount; i++) {
      if (view.getUint32(pos, true) !== 0x02014b50) break;
      const method   = view.getUint16(pos + 10, true);
      const compSize = view.getUint32(pos + 20, true);
      const nameLen  = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const comLen   = view.getUint16(pos + 32, true);
      const localOff = view.getUint32(pos + 42, true);
      const name     = new TextDecoder().decode(data.slice(pos + 46, pos + 46 + nameLen));
      if (name === 'word/styles.xml') {
        const lnl = view.getUint16(localOff + 26, true);
        const lel = view.getUint16(localOff + 28, true);
        const ds  = localOff + 30 + lnl + lel;
        let   raw = data.slice(ds, ds + compSize);
        if (method === 8) {
          const decomp = new DecompressionStream('deflate-raw');
          const w = decomp.writable.getWriter(); const r = decomp.readable.getReader();
          w.write(raw); w.close();
          const chunks = [];
          for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
          const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let off = 0; for (const c of chunks) { merged.set(c, off); off += c.length; }
          raw = merged;
        }
        return new TextDecoder().decode(raw);
      }
      pos += 46 + nameLen + extraLen + comLen;
    }
    return null;
  } catch (_) { return null; }
}

// ── Static DOCX XML parts ─────────────────────────────────────────────────────
const _CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/word/document.xml"  ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml"    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const _RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const _DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"    Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

function _documentXml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${body}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

const _DEFAULT_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:sz w:val="22"/><w:szCs w:val="22"/>
      <w:lang w:val="pt-PT"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr>
      <w:spacing w:after="160" w:line="276" w:lineRule="auto"/>
    </w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="BodyText">
    <w:name w:val="Body Text"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="160"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/>
    <w:pPr>
      <w:keepNext/><w:spacing w:before="480" w:after="160"/>
      <w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="2B5797"/></w:pBdr>
    </w:pPr>
    <w:rPr><w:b/><w:bCs/><w:color w:val="1F3864"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/>
    <w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:bCs/><w:color w:val="2B5797"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/>
    <w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:bCs/><w:color w:val="404040"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet">
    <w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>
      <w:spacing w:before="0" w:after="80"/>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListNumber">
    <w:name w:val="List Number"/><w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>
      <w:spacing w:before="0" w:after="80"/>
    </w:pPr>
  </w:style>
  <w:style w:type="table" w:default="1" w:styleId="TableNormal">
    <w:name w:val="Normal Table"/>
    <w:tblPr><w:tblCellMar>
      <w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>
      <w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/>
    </w:tblCellMar></w:tblPr>
  </w:style>
  <w:style w:type="table" w:styleId="TableGrid">
    <w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/>
    <w:tblPr><w:tblBorders>
      <w:top    w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:left   w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:right  w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    </w:tblBorders></w:tblPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="TableHeading">
    <w:name w:val="Table Heading"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="80" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:bCs/><w:color w:val="FFFFFF"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="TableContents">
    <w:name w:val="Table Contents"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>
    <w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
  </w:style>
</w:styles>`;

const _NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/><w:numFmt w:val="bullet"/>
      <w:lvlText w:val="&#x2022;"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

// ── Main export entry point ───────────────────────────────────────────────────
async function exportToDocx(markdownContent, title) {
  const btn  = document.getElementById('btn-download-docx');
  const prev = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ A gerar...'; }

  try {
    const enc = new TextEncoder();

    // Try to load styles from docs/reference/template.docx
    let stylesXml = _DEFAULT_STYLES;
    try {
      const war          = chrome.runtime.getManifest().web_accessible_resources || [];
      const templatePath = war
        .flatMap(e => Array.isArray(e.resources) ? e.resources : [])
        .find(r => r === 'docs/reference/template.docx');
      if (templatePath) {
        const res = await fetch(chrome.runtime.getURL(templatePath));
        if (res.ok) {
          const extracted = await _extractTemplateStyles(await res.arrayBuffer());
          if (extracted) stylesXml = extracted;
        }
      }
    } catch (_) {}

    const bodyXml = _mdToBody(markdownContent);
    const files   = [
      { path: '[Content_Types].xml',          data: enc.encode(_CONTENT_TYPES) },
      { path: '_rels/.rels',                  data: enc.encode(_RELS) },
      { path: 'word/_rels/document.xml.rels', data: enc.encode(_DOC_RELS) },
      { path: 'word/document.xml',            data: enc.encode(_documentXml(bodyXml)) },
      { path: 'word/styles.xml',              data: enc.encode(stylesXml) },
      { path: 'word/numbering.xml',           data: enc.encode(_NUMBERING) },
    ];

    const zip  = _buildZip(files);
    const blob = new Blob([zip], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = (typeof sanitizeFilename === 'function' ? sanitizeFilename(title) : title) + '.docx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (btn) {
      btn.innerHTML = '✓ Descarregado!';
      setTimeout(() => { btn.innerHTML = prev; btn.disabled = false; }, 2500);
    }
  } catch (err) {
    console.error('[DocFlow] DOCX export failed:', err);
    if (btn) { btn.innerHTML = prev; btn.disabled = false; }
  }
}
