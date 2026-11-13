// Reads the text of a .docx file with no library: a .docx is a ZIP of XML parts.
// Works in the browser and in Node (both have DecompressionStream).
import { InputError } from './util.js';

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const MAX_PART = 120 * 1024 * 1024; // guard against decompression bombs

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** List the entries of a ZIP archive from its central directory. */
export function zipEntries(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new InputError('This file is not a valid .docx (no ZIP directory found). Save it again from Word as .docx and retry.', 'file');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const entries = new Map();
  const td = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new InputError('The .docx file is damaged (bad ZIP directory entry). Open it in Word and save a fresh copy.', 'file');
    const method = u16(bytes, p + 10), csize = u32(bytes, p + 20), usize = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28), extraLen = u16(bytes, p + 30), commentLen = u16(bytes, p + 32);
    const offset = u32(bytes, p + 42);
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, csize, usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export async function zipRead(bytes, entry) {
  if (entry.usize > MAX_PART) throw new InputError('The document is too large to read safely (over 120 MB of text).', 'file');
  const o = entry.offset;
  if (u32(bytes, o) !== 0x04034b50) throw new InputError('The .docx file is damaged (bad local header).', 'file');
  const start = o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28);
  const data = bytes.subarray(start, start + entry.csize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new InputError('The .docx uses a compression method this tool cannot read. Save it again from Word.', 'file');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e] ?? m;
});
const attr = (attrs, name) => { const m = new RegExp(name + '="([^"]*)"').exec(attrs); return m ? m[1] : null; };

function roman(n) {
  const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
}
function fmtNum(n, fmt) {
  if (fmt === 'lowerLetter') return String.fromCharCode(96 + ((n - 1) % 26) + 1);
  if (fmt === 'upperLetter') return String.fromCharCode(64 + ((n - 1) % 26) + 1);
  if (fmt === 'lowerRoman') return roman(n);
  if (fmt === 'upperRoman') return roman(n).toUpperCase();
  return String(n);
}

/** Read list definitions so automatic numbers ("1.", "(a)") appear in the text as Word shows them. */
function parseNumbering(xml) {
  const abstract = new Map(), nums = new Map();
  if (!xml) return { abstract, nums };
  for (const m of xml.matchAll(/<w:abstractNum\b([^>]*)>([\s\S]*?)<\/w:abstractNum>/g)) {
    const levels = new Map();
    for (const l of m[2].matchAll(/<w:lvl\b([^>]*)>([\s\S]*?)<\/w:lvl>/g)) {
      const fmt = (/<w:numFmt\b[^>]*w:val="([^"]*)"/.exec(l[2]) || [])[1] || 'decimal';
      const text = (/<w:lvlText\b[^>]*w:val="([^"]*)"/.exec(l[2]) || [])[1] ?? '%1.';
      const startAt = Number((/<w:start\b[^>]*w:val="([^"]*)"/.exec(l[2]) || [])[1] || 1);
      levels.set(Number(attr(l[1], 'w:ilvl') || 0), { fmt, text: decodeXml(text), start: startAt });
    }
    abstract.set(attr(m[1], 'w:abstractNumId'), levels);
  }
  for (const m of xml.matchAll(/<w:num\b([^>]*)>([\s\S]*?)<\/w:num>/g)) {
    const a = (/<w:abstractNumId\b[^>]*w:val="([^"]*)"/.exec(m[2]) || [])[1];
    nums.set(attr(m[1], 'w:numId'), a);
  }
  return { abstract, nums };
}

/**
 * Convert document.xml to plain text: one paragraph per block separated by a blank line,
 * table rows as "cell | cell",
 * images as "[]" so the analysis can warn that a figure was not captured.
 * Single pass over the XML tokens, O(n).
 */
export function docXmlToText(xml, numberingXml) {
  const { abstract, nums } = parseNumbering(numberingXml);
  const counters = new Map();
  const out = [];
  const TOKEN = /<(\/?)([\w:]+)((?:\s[^<>]*?)?)(\/?)>|([^<]+)/g;
  let para = null, inText = false, skip = 0, numId = null, ilvl = 0;
  let tblDepth = 0, row = null, cell = null;
  let m;

  const listPrefix = () => {
    if (numId === null || numId === '0') return '';
    const levels = abstract.get(nums.get(numId));
    const lv = levels && levels.get(ilvl);
    if (!lv) return '';
    const key = numId;
    if (!counters.has(key)) counters.set(key, []);
    const c = counters.get(key);
    c[ilvl] = (c[ilvl] === undefined ? lv.start - 1 : c[ilvl]) + 1;
    c.length = ilvl + 1; // deeper levels restart
    const pad = '    '.repeat(ilvl);
    if (lv.fmt === 'bullet') return pad + '- ';
    if (lv.fmt === 'none') return pad;
    const label = lv.text.replace(/%(\d)/g, (_, k) => {
      const li = Number(k) - 1;
      const f = (levels.get(li) || lv).fmt;
      return fmtNum(c[li] ?? 1, f);
    });
    return pad + label + ' ';
  };

  const endPara = () => {
    const text = para.replace(/[ \t]+/g, ' ').trim();
    const full = text ? listPrefix() + text : '';
    para = null; numId = null; ilvl = 0;
    if (cell !== null) { if (full) cell.push(full); return; }
    if (full) out.push(full, '');
  };

  while ((m = TOKEN.exec(xml))) {
    if (m[5] !== undefined) { if (inText && !skip && para !== null) para += decodeXml(m[5]); continue; }
    const close = m[1] === '/', tag = m[2], attrs = m[3], selfClose = m[4] === '/';
    if (tag === 'w:del' || tag === 'mc:Fallback' || tag === 'w:instrText') { if (!selfClose) skip += close ? -1 : 1; continue; }
    if (skip) continue;
    switch (tag) {
      case 'w:p':
        if (close) { if (para !== null) endPara(); }
        else if (!selfClose) { if (para === null) para = ''; else para += ' '; } // a text box paragraph inside a paragraph joins its parent
        break;
      case 'w:t': inText = !close && !selfClose; break;
      case 'w:tab': if (para !== null) para += ' '; break;
      // Page breaks are not turned into page numbers: a .docx reflows, so its "pages" differ
      // from the official publication and a page citation would mislead. Clause and line are cited instead.
      case 'w:br': if (para !== null) para += ' '; break;
      case 'w:numId': if (para !== null && numId === null) numId = attr(attrs, 'w:val'); break;
      case 'w:ilvl': if (para !== null) ilvl = Number(attr(attrs, 'w:val') || 0); break;
      case 'w:drawing': case 'w:pict': case 'w:object': if (!close && para !== null) para += ' [] '; break;
      case 'w:tbl': tblDepth += close ? -1 : selfClose ? 0 : 1; if (close && tblDepth === 0) out.push(''); break;
      case 'w:tr':
        if (tblDepth === 1) {
          if (!close) row = [];
          else if (row) { if (row.some((c) => c)) out.push(row.join(' | ')); row = null; }
        }
        break;
      case 'w:tc':
        if (tblDepth === 1) {
          if (!close && !selfClose) cell = [];
          else if (close && cell !== null) { if (row) row.push(cell.join(' ').replace(/\s*\|\s*/g, ' / ')); cell = null; }
        }
        break;
      default:
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** .docx bytes -> plain text. */
export async function docxToText(bytes) {
  const entries = zipEntries(bytes);
  const main = entries.get('word/document.xml');
  if (!main) throw new InputError('This ZIP file is not a Word document (word/document.xml is missing). Choose a .docx file.', 'file');
  const td = new TextDecoder();
  const xml = td.decode(await zipRead(bytes, main));
  const numEntry = entries.get('word/numbering.xml');
  const numXml = numEntry ? td.decode(await zipRead(bytes, numEntry)) : '';
  return docXmlToText(xml, numXml);
}
