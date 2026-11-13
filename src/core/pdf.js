// Basic PDF text extraction with no library. It reads text-based PDFs (the usual case for
// published grid codes): Flate-compressed content, object streams, ToUnicode maps, simple and
// composite fonts, two-column pages. It does not do OCR, so a scanned PDF yields no text and
// the caller is told so through the quality figures.
//
// Complexity: O(n) over the file bytes plus O(c log c) per page to order c text chunks.
import { InputError } from './util.js';

const latin1 = new TextDecoder('latin1');
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = '()<>[]{}/%';
const MAX_STREAM = 64 * 1024 * 1024;

class Ref { constructor(n) { this.n = n; } }
class Name { constructor(v) { this.v = v; } }
class Str { constructor(s) { this.s = s; } }
class Op { constructor(v) { this.v = v; } }

/** Recursive-descent reader for PDF syntax over a latin-1 string. */
class Reader {
  constructor(s, pos = 0, content = false) { this.s = s; this.p = pos; this.content = content; }
  skip() {
    const s = this.s;
    for (;;) {
      const c = s.charCodeAt(this.p);
      if (WS.has(c)) this.p++;
      else if (c === 37) { while (this.p < s.length && s[this.p] !== '\n' && s[this.p] !== '\r') this.p++; }
      else break;
    }
  }
  value() {
    this.skip();
    const s = this.s;
    if (this.p >= s.length) return undefined;
    const c = s[this.p];
    if (c === '/') {
      let e = ++this.p;
      while (e < s.length && !WS.has(s.charCodeAt(e)) && !DELIM.includes(s[e])) e++;
      const raw = s.slice(this.p, e); this.p = e;
      return new Name(raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
    }
    if (c === '(') return this.literal();
    if (c === '<') {
      if (s[this.p + 1] === '<') return this.dict();
      const e = s.indexOf('>', this.p);
      let hex = s.slice(this.p + 1, e < 0 ? s.length : e).replace(/[^0-9a-fA-F]/g, '');
      this.p = e < 0 ? s.length : e + 1;
      if (hex.length % 2) hex += '0';
      let out = '';
      for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      return new Str(out);
    }
    if (c === '[') {
      this.p++;
      const arr = [];
      for (;;) {
        this.skip();
        if (this.p >= s.length) break;
        if (s[this.p] === ']') { this.p++; break; }
        const v = this.value();
        if (v === undefined) break;
        arr.push(v);
      }
      return arr;
    }
    if (c === ']' || c === '>' || c === ')' || c === '{' || c === '}') { this.p++; return new Op(c); }
    // number, reference or keyword
    let e = this.p;
    while (e < s.length && !WS.has(s.charCodeAt(e)) && !DELIM.includes(s[e])) e++;
    if (e === this.p) { this.p++; return new Op(c); }
    const tok = s.slice(this.p, e);
    this.p = e;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      if (!this.content && /^\d+$/.test(tok)) {
        // "12 0 R" is a reference; look ahead without consuming on failure.
        const m = /^\s+(\d+)\s+R(?![A-Za-z0-9])/.exec(s.slice(e, e + 24));
        if (m) { this.p = e + m[0].length; return new Ref(Number(tok)); }
      }
      return Number(tok);
    }
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (tok === 'null') return null;
    return new Op(tok);
  }
  literal() {
    const s = this.s;
    let depth = 1, out = '';
    this.p++;
    while (this.p < s.length && depth > 0) {
      const c = s[this.p++];
      if (c === '\\') {
        const n = s[this.p++];
        if (n === 'n') out += '\n'; else if (n === 'r') out += '\r'; else if (n === 't') out += '\t';
        else if (n === 'b') out += '\b'; else if (n === 'f') out += '\f';
        else if (n >= '0' && n <= '7') {
          let oct = n;
          while (oct.length < 3 && s[this.p] >= '0' && s[this.p] <= '7') oct += s[this.p++];
          out += String.fromCharCode(parseInt(oct, 8) & 255);
        } else if (n === '\r') { if (s[this.p] === '\n') this.p++; } else if (n === '\n') { /* line continuation */ } else out += n;
      } else if (c === '(') { depth++; out += c; } else if (c === ')') { depth--; if (depth) out += c; } else out += c;
    }
    return new Str(out);
  }
  dict() {
    this.p += 2;
    const d = new Map();
    for (;;) {
      this.skip();
      if (this.p >= this.s.length) break;
      if (this.s.startsWith('>>', this.p)) { this.p += 2; break; }
      const k = this.value();
      if (!(k instanceof Name)) { if (k === undefined) break; continue; }
      d.set(k.v, this.value());
    }
    return d;
  }
}

async function inflate(bytes) {
  try {
    const ds = new DecompressionStream('deflate');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    if (buf.byteLength > MAX_STREAM) return new Uint8Array(0);
    return new Uint8Array(buf);
  } catch { return new Uint8Array(0); } // a damaged stream loses its own text only
}

function unpredict(data, parms) {
  const pred = parms.get('Predictor') || 1;
  if (pred < 10) return data;
  const cols = parms.get('Columns') || 1, colors = parms.get('Colors') || 1, bpc = parms.get('BitsPerComponent') || 8;
  const bpp = Math.max(1, (colors * bpc) >> 3), rowLen = (cols * colors * bpc + 7) >> 3;
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (rowLen + 1)], src = r * (rowLen + 1) + 1, dst = r * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0, b = r ? out[dst - rowLen + i] : 0, c = r && i >= bpp ? out[dst - rowLen + i - bpp] : 0;
      let v = data[src + i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + i] = v & 255;
    }
  }
  return out;
}

function ascii85(bytes) {
  const s = latin1.decode(bytes).replace(/\s/g, '').replace(/~>.*$/s, '');
  const out = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === 'z') { out.push(0, 0, 0, 0); i++; continue; }
    const chunk = s.slice(i, i + 5); i += 5;
    let v = 0;
    for (let k = 0; k < 5; k++) v = v * 85 + ((k < chunk.length ? chunk.charCodeAt(k) : 117) - 33);
    const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...b.slice(0, chunk.length - 1));
  }
  return Uint8Array.from(out);
}

function asciiHex(bytes) {
  const hex = latin1.decode(bytes).replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const GLYPHS = { space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '−', period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', underscore: '_', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~', quoteleft: '‘', quoteright: '’', quotedblleft: '“', quotedblright: '”', endash: '–', emdash: '—', bullet: '•', degree: '°', plusminus: '±', mu: 'µ', multiply: '×', section: '§', paragraph: '¶', ellipsis: '…', lessequal: '≤', greaterequal: '≥', fi: 'fi', fl: 'fl', ccaron: 'č', Ccaron: 'Č', cacute: 'ć', Cacute: 'Ć', scaron: 'š', Scaron: 'Š', zcaron: 'ž', Zcaron: 'Ž', dcroat: 'đ', Dcroat: 'Đ', adieresis: 'ä', odieresis: 'ö', udieresis: 'ü', Adieresis: 'Ä', Odieresis: 'Ö', Udieresis: 'Ü', germandbls: 'ß', eacute: 'é', egrave: 'è', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', ccedilla: 'ç', agrave: 'à', ecircumflex: 'ê', atilde: 'ã', otilde: 'õ', phi: 'φ', Delta: 'Δ', Omega: 'Ω', nbspace: ' ' };
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
const winAnsi = (c) => (c >= 0x80 && c <= 0x9f ? CP1252[c - 0x80] : String.fromCharCode(c));

function parseCMap(text) {
  const map = new Map();
  let codeLen = 0;
  const hexStr = (h) => { let o = ''; for (let i = 0; i + 3 < h.length + 1; i += 4) o += String.fromCharCode(parseInt(h.substr(i, 4).padEnd(4, '0'), 16)); return o; };
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text);
  if (cs) codeLen = cs[1].length >> 1;
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F\s]*)>/g)) {
      if (!codeLen) codeLen = m[1].length >> 1;
      map.set(parseInt(m[1], 16), hexStr(m[2].replace(/\s/g, '')));
    }
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F\s]*)>|\[([^\]]*)\])/g)) {
      if (!codeLen) codeLen = m[1].length >> 1;
      const lo = parseInt(m[1], 16), hi = Math.min(parseInt(m[2], 16), lo + 65535);
      if (m[3] !== undefined) {
        const base = hexStr(m[3].replace(/\s/g, ''));
        const head = base.slice(0, -1), last = base.charCodeAt(base.length - 1);
        for (let c = lo; c <= hi; c++) map.set(c, head + String.fromCharCode(last + c - lo));
      } else {
        const items = [...m[4].matchAll(/<([0-9a-fA-F\s]*)>/g)].map((x) => hexStr(x[1].replace(/\s/g, '')));
        for (let c = lo; c <= hi && c - lo < items.length; c++) map.set(c, items[c - lo]);
      }
    }
  }
  return { map, codeLen: codeLen || 1 };
}

const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const IDENT = [1, 0, 0, 1, 0, 0];

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<{text:string, pages:number, chars:number, unmapped:number}>}
 * Pages are separated by form feeds so citations can carry the page number.
 */
export async function pdfToText(bytes) {
  const s = latin1.decode(bytes);
  if (!s.startsWith('%PDF-', s.indexOf('%PDF-') < 1024 ? s.indexOf('%PDF-') : 0) || s.indexOf('%PDF-') < 0) {
    throw new InputError('This file is not a PDF (the %PDF header is missing). Choose a .pdf, .docx or .txt file.', 'file');
  }
  if (/\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(s.slice(Math.max(0, s.length - 4096))) || /\/Encrypt\s+\d+\s+\d+\s+R/.test(s)) {
    throw new InputError('This PDF is password-protected or encrypted, so its text cannot be read. Open it in a PDF reader, save an unprotected copy or the text, and import that.', 'file');
  }

  // 1. Collect indirect objects by scanning, which also works for PDFs with damaged xref tables.
  const objs = new Map();
  const streams = new Map();
  const objRe = /(?:^|[\s>])(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = objRe.exec(s))) {
    const num = Number(m[1]);
    const rd = new Reader(s, objRe.lastIndex);
    let val;
    try { val = rd.value(); } catch { continue; }
    objs.set(num, val);
    rd.skip();
    if (val instanceof Map && s.startsWith('stream', rd.p)) {
      let start = rd.p + 6;
      if (s[start] === '\r') start++;
      if (s[start] === '\n') start++;
      const len = val.get('Length');
      let end = -1;
      if (typeof len === 'number' && /^\s*endstream/.test(s.slice(start + len, start + len + 16))) end = start + len;
      if (end < 0) { end = s.indexOf('endstream', start); if (end < 0) end = s.length; }
      streams.set(num, [start, end]);
      objRe.lastIndex = end;
    }
  }
  const deref = (v, depth = 0) => (v instanceof Ref && depth < 20 ? deref(objs.get(v.n), depth + 1) : v);

  const decodeCache = new Map();
  async function streamBytes(num) {
    if (decodeCache.has(num)) return decodeCache.get(num);
    const dict = objs.get(num), span = streams.get(num);
    if (!span || !(dict instanceof Map)) return new Uint8Array(0);
    let data = bytes.subarray(span[0], span[1]);
    let filters = deref(dict.get('Filter')) ?? [];
    if (!Array.isArray(filters)) filters = [filters];
    let parms = deref(dict.get('DecodeParms')) ?? [];
    if (!Array.isArray(parms)) parms = [parms];
    for (let i = 0; i < filters.length; i++) {
      const f = deref(filters[i]);
      const name = f instanceof Name ? f.v : '';
      if (name === 'FlateDecode' || name === 'Fl') {
        data = await inflate(data);
        const pm = deref(parms[i]);
        if (pm instanceof Map) data = unpredict(data, pm);
      } else if (name === 'ASCII85Decode' || name === 'A85') data = ascii85(data);
      else if (name === 'ASCIIHexDecode' || name === 'AHx') data = asciiHex(data);
      else { data = new Uint8Array(0); break; } // image or unsupported filter: no text inside
    }
    decodeCache.set(num, data);
    return data;
  }

  // 2. Objects stored inside object streams (PDF 1.5+).
  for (const [num, dict] of [...objs]) {
    if (!(dict instanceof Map) || !(dict.get('Type') instanceof Name) || dict.get('Type').v !== 'ObjStm') continue;
    const text = latin1.decode(await streamBytes(num));
    const n = dict.get('N') || 0, first = dict.get('First') || 0;
    const head = new Reader(text, 0);
    const index = [];
    for (let i = 0; i < n; i++) { const a = head.value(), b = head.value(); if (typeof a !== 'number' || typeof b !== 'number') break; index.push([a, b]); }
    for (const [onum, off] of index) {
      if (objs.has(onum) && streams.has(onum)) continue;
      try { objs.set(onum, new Reader(text, first + off).value()); } catch { /* skip a damaged entry */ }
    }
    decodeCache.delete(num);
  }

  // 3. Page list in reading order.
  const pages = [];
  const seen = new Set();
  function walk(ref, inherited, depth) {
    const node = deref(ref);
    if (!(node instanceof Map) || depth > 40) return;
    const key = ref instanceof Ref ? ref.n : node;
    if (seen.has(key)) return;
    seen.add(key);
    const res = node.has('Resources') ? node.get('Resources') : inherited;
    const kids = deref(node.get('Kids'));
    if (Array.isArray(kids)) { for (const k of kids) walk(k, res, depth + 1); return; }
    pages.push({ node, res });
  }
  let catalog = null;
  for (const v of objs.values()) if (v instanceof Map && v.get('Type') instanceof Name && v.get('Type').v === 'Catalog' && v.has('Pages')) catalog = v;
  if (catalog) walk(catalog.get('Pages'), undefined, 0);
  if (!pages.length) {
    for (const [num, v] of objs) if (v instanceof Map && v.get('Type') instanceof Name && v.get('Type').v === 'Page') pages.push({ node: v, res: v.get('Resources'), num });
  }
  if (!pages.length) throw new InputError('No pages were found in this PDF. The file may be damaged; open it in a PDF reader and save it again.', 'file');

  // 4. Fonts.
  const fontCache = new Map();
  async function loadFont(ref) {
    const key = ref instanceof Ref ? ref.n : ref;
    if (fontCache.has(key)) return fontCache.get(key);
    const f = deref(ref);
    const font = { cmap: null, codeLen: 1, enc: null, widths: null, first: 0, dw: 500, cidW: null, type0: false };
    fontCache.set(key, font);
    if (!(f instanceof Map)) return font;
    const sub = f.get('Subtype') instanceof Name ? f.get('Subtype').v : '';
    font.type0 = sub === 'Type0';
    if (font.type0) font.codeLen = 2;
    const tu = f.get('ToUnicode');
    if (tu instanceof Ref && streams.has(tu.n)) {
      const cm = parseCMap(latin1.decode(await streamBytes(tu.n)));
      if (cm.map.size) { font.cmap = cm.map; font.codeLen = font.type0 ? Math.max(cm.codeLen, 1) : 1; }
    }
    if (font.type0) {
      const desc = deref((deref(f.get('DescendantFonts')) || [])[0]);
      if (desc instanceof Map) {
        if (typeof desc.get('DW') === 'number') font.dw = desc.get('DW'); else font.dw = 1000;
        const w = deref(desc.get('W'));
        if (Array.isArray(w)) {
          font.cidW = new Map();
          for (let i = 0; i < w.length;) {
            const c = w[i], nx = deref(w[i + 1]);
            if (Array.isArray(nx)) { nx.forEach((x, k) => font.cidW.set(c + k, x)); i += 2; }
            else { for (let k = c; k <= nx && k - c < 70000; k++) font.cidW.set(k, w[i + 2]); i += 3; }
          }
        }
      }
    } else {
      const widths = deref(f.get('Widths'));
      if (Array.isArray(widths)) { font.widths = widths.map((x) => deref(x)); font.first = f.get('FirstChar') || 0; }
      const enc = deref(f.get('Encoding'));
      if (enc instanceof Map) {
        const diff = deref(enc.get('Differences'));
        if (Array.isArray(diff)) {
          font.enc = new Map();
          let code = 0;
          for (const d of diff) {
            if (typeof d === 'number') code = d;
            else if (d instanceof Name) {
              const g = d.v;
              const u = /^uni([0-9A-Fa-f]{4})$/.exec(g);
              const ch = u ? String.fromCharCode(parseInt(u[1], 16)) : g.length === 1 ? g : GLYPHS[g];
              if (ch !== undefined) font.enc.set(code, ch);
              code++;
            }
          }
        }
      }
    }
    return font;
  }

  let unmapped = 0, chars = 0;
  function decode(font, str) {
    let out = '', width = 0, spaces = 0;
    const n = font.codeLen;
    for (let i = 0; i + n <= str.length; i += n) {
      let code = 0;
      for (let k = 0; k < n; k++) code = (code << 8) | str.charCodeAt(i + k);
      let ch;
      if (font.cmap && font.cmap.has(code)) ch = font.cmap.get(code);
      else if (font.type0) { ch = font.cmap ? '' : '�'; if (!font.cmap) unmapped++; }
      else ch = font.enc && font.enc.has(code) ? font.enc.get(code) : winAnsi(code);
      out += ch;
      const w = font.type0 ? (font.cidW && font.cidW.has(code) ? font.cidW.get(code) : font.dw) : (font.widths && font.widths[code - font.first] !== undefined ? font.widths[code - font.first] : 500);
      width += typeof w === 'number' ? w : 500;
      if (n === 1 && code === 32) spaces++;
    }
    chars += out.length;
    return { out, width, spaces };
  }

  // 5. Content streams -> positioned chunks.
  async function contentOf(node) {
    let c = node.get('Contents');
    c = c instanceof Ref && !streams.has(c.n) ? deref(c) : c;
    const list = Array.isArray(c) ? c : c ? [c] : [];
    const parts = [];
    for (const r of list) if (r instanceof Ref) parts.push(latin1.decode(await streamBytes(r.n)));
    return parts.join('\n');
  }

  async function run(content, resRef, ctm0, chunks, depth) {
    const res = deref(resRef);
    const fontDict = res instanceof Map ? deref(res.get('Font')) : null;
    const xobj = res instanceof Map ? deref(res.get('XObject')) : null;
    const rd = new Reader(content, 0, true);
    const stack = [];
    const gs = [];
    let ctm = ctm0, tm = IDENT, tlm = IDENT, font = null, size = 0, tl = 0, tc = 0, tw = 0, th = 1;
    const show = (str) => {
      if (!font || !(str instanceof Str)) return;
      const d = decode(font, str.s);
      const m0 = mul(tm, ctm);
      const adv = ((d.width / 1000) * size + tc * (d.out.length || 1) + tw * d.spaces) * th;
      const m1 = mul([1, 0, 0, 1, adv, 0], m0);
      const scale = Math.hypot(m0[0], m0[1]) || 1;
      if (d.out) chunks.push({ x: m0[4], y: m0[5], x2: m1[4], h: Math.abs(size * scale) || 1, t: d.out });
      tm = mul([1, 0, 0, 1, adv, 0], tm);
    };
    for (;;) {
      const v = rd.value();
      if (v === undefined) break;
      if (!(v instanceof Op)) { stack.push(v); if (stack.length > 400) stack.shift(); continue; }
      const a = stack;
      switch (v.v) {
        case 'q': gs.push([ctm, font, size, tl, tc, tw, th]); break;
        case 'Q': if (gs.length) [ctm, font, size, tl, tc, tw, th] = gs.pop(); break;
        case 'cm': if (a.length >= 6) ctm = mul(a.slice(-6), ctm); break;
        case 'BT': tm = IDENT; tlm = IDENT; break;
        case 'Tf': {
          size = typeof a[a.length - 1] === 'number' ? a[a.length - 1] : size;
          const nm = a[a.length - 2];
          font = nm instanceof Name && fontDict instanceof Map && fontDict.has(nm.v) ? await loadFont(fontDict.get(nm.v)) : await loadFont(null);
          break;
        }
        case 'TL': tl = a[a.length - 1] || 0; break;
        case 'Tc': tc = a[a.length - 1] || 0; break;
        case 'Tw': tw = a[a.length - 1] || 0; break;
        case 'Tz': th = (a[a.length - 1] || 100) / 100; break;
        case 'Td': tlm = mul([1, 0, 0, 1, a[a.length - 2] || 0, a[a.length - 1] || 0], tlm); tm = tlm; break;
        case 'TD': tl = -(a[a.length - 1] || 0); tlm = mul([1, 0, 0, 1, a[a.length - 2] || 0, a[a.length - 1] || 0], tlm); tm = tlm; break;
        case 'Tm': if (a.length >= 6) { tlm = a.slice(-6).map((x) => (typeof x === 'number' ? x : 0)); tm = tlm; } break;
        case 'T*': tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; break;
        case 'Tj': show(a[a.length - 1]); break;
        case "'": tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; show(a[a.length - 1]); break;
        case '"': tw = a[a.length - 3] || 0; tc = a[a.length - 2] || 0; tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; show(a[a.length - 1]); break;
        case 'TJ': {
          const arr = a[a.length - 1];
          if (Array.isArray(arr)) for (const it of arr) {
            if (it instanceof Str) show(it);
            else if (typeof it === 'number') tm = mul([1, 0, 0, 1, (-it / 1000) * size * th, 0], tm);
          }
          break;
        }
        case 'Do': {
          const nm = a[a.length - 1];
          const ref = nm instanceof Name && xobj instanceof Map ? xobj.get(nm.v) : null;
          const form = deref(ref);
          if (ref instanceof Ref && form instanceof Map && form.get('Subtype') instanceof Name && form.get('Subtype').v === 'Form' && depth < 4) {
            const mt = deref(form.get('Matrix'));
            const fctm = Array.isArray(mt) && mt.length === 6 ? mul(mt, ctm) : ctm;
            await run(latin1.decode(await streamBytes(ref.n)), form.has('Resources') ? form.get('Resources') : resRef, fctm, chunks, depth + 1);
          }
          break;
        }
        case 'BI': { // inline image: skip its binary data
          const e = content.indexOf('EI', rd.p);
          rd.p = e < 0 ? content.length : e + 2;
          break;
        }
        default:
      }
      stack.length = 0;
    }
  }

  // 6. Chunks -> lines in reading order.
  function layout(chunks) {
    if (!chunks.length) return '';
    let minX = Infinity, maxX = -Infinity;
    for (const c of chunks) { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x2, c.x); }
    const width = maxX - minX || 1;
    // Two-column detection: a vertical line near the middle that almost no text crosses,
    // with a real share of the text on each side.
    let split = null;
    if (chunks.length > 40) {
      // Rough lines first, so a gutter can be told apart from ordinary word spaces.
      const sorted = [...chunks].sort((p, q) => q.y - p.y);
      const rows = [];
      let row = null;
      for (const c of sorted) {
        if (row && Math.abs(row.y - c.y) <= Math.max(row.h, c.h) * 0.45) row.items.push(c);
        else { row = { y: c.y, h: c.h, items: [c] }; rows.push(row); }
      }
      let best = null;
      for (let f = 0.38; f <= 0.62; f += 0.01) {
        const x = minX + width * f;
        let cross = 0, both = 0, wide = 0;
        for (const r of rows) {
          let leftEnd = -Infinity, rightStart = Infinity, crossing = false;
          for (const c of r.items) {
            if (c.x < x && c.x2 > x) crossing = true;
            else if (c.x2 <= x) leftEnd = Math.max(leftEnd, c.x2);
            else rightStart = Math.min(rightStart, c.x);
          }
          if (crossing) { cross++; continue; }
          if (leftEnd > -Infinity && rightStart < Infinity) { both++; if (rightStart - leftEnd >= r.h * 1.2) wide++; }
        }
        // Two columns: most lines have text on both sides of x, separated by a clear gap.
        if (both >= rows.length * 0.3 && wide >= both * 0.85 && cross <= rows.length * 0.06 && (!best || cross < best.cross)) best = { x, cross };
      }
      if (best) split = best.x;
    }
    const render = (list) => {
      list.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      let cur = null;
      for (const c of list) {
        if (cur && Math.abs(cur.y - c.y) <= Math.max(cur.h, c.h) * 0.45) cur.items.push(c);
        else { cur = { y: c.y, h: c.h, items: [c] }; lines.push(cur); }
      }
      const out = [];
      let prevY = null, prevH = null;
      for (const ln of lines) {
        ln.items.sort((a, b) => a.x - b.x);
        let text = '', end = null;
        for (const c of ln.items) {
          if (end !== null && c.x - end > c.h * 0.18 && !text.endsWith(' ') && !c.t.startsWith(' ')) text += ' ';
          text += c.t;
          end = Math.max(end ?? -Infinity, c.x2);
        }
        text = text.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (prevY !== null && prevY - ln.y > Math.max(prevH, ln.h) * 1.9) out.push('');
        out.push(text);
        prevY = ln.y; prevH = ln.h;
      }
      return out.join('\n');
    };
    if (split === null) return render(chunks);
    // Text that spans the gutter (titles) is kept with the left column at its own height.
    const left = chunks.filter((c) => c.x < split), right = chunks.filter((c) => c.x >= split);
    return render(left) + '\n\n' + render(right);
  }

  const out = [];
  for (const pg of pages) {
    const chunks = [];
    try { await run(await contentOf(pg.node), pg.res, IDENT, chunks, 0); } catch { /* a damaged page is left empty; the others still load */ }
    out.push(layout(chunks));
  }
  const text = out.join('\n\f').replace(/[\u0000-\u0008\u000b\u000e-\u001f]/g, '');
  return { text: text + '\n', pages: pages.length, chars, unmapped };
}
