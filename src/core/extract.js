// Requirement extraction: turn the text of a grid code into citable requirement candidates.
//
// The engine is deterministic and rule based on purpose. A compliance sheet must be traceable:
// the same document always yields the same candidates, every candidate carries the clause,
// paragraph, page and line it came from, and nothing is invented that is not in the text.
//
// Complexity: segment() and analyse() are single passes over the lines, O(n) in text length,
// with O(1) map lookups for de-duplication. Memory is O(n).
import { squash, hash32 } from './util.js';
import { CATEGORIES } from './catalog.js';
import { normUnit } from './units.js';

const CLAUSE_WORDS = 'Article|Članak|Clanak|Artikel|Art\\.|Artículo|Articulo|Articolo|Artigo|Clause|Section|Regulation|Rule|Madde|Paragraf|§{1,2}';
const ARTICLE_WORDS = 'Article|Članak|Clanak|Artikel|Artículo|Articulo|Articolo|Artigo';
const MODAL_RE = /\b(shall|must|is required to|are required to|required to|is obligated to|is obliged to|are obliged to|has to|have to|is to be|are to be|needs? to|may not|not permitted|is prohibited|is responsible for|mora|moraju|dužan|dužni|obvezan|muss|müssen|deberán?|deben?|doit|doivent|deve|devono|devem|musi|muszą|moet|moeten)\b/i;
const SHOULD_RE = /\b(should|as a rule|is recommended|are recommended|treba|sollte|sollten|debería|devrait)\b/i;
const MAY_RE = /\b(may|is permitted|are permitted|is allowed|are allowed|can|može|mogu|darf|dürfen|puede|peut)\b/i;

// A line that starts a clause: "Article 91.", "Članak 12.", "§ 5 Frequency", "Section 4.2 Voltage".
const CLAUSE_START = new RegExp('^\\s*(' + CLAUSE_WORDS + ')\\s*(\\d+[a-z]?(?:\\.\\d+)*)\\s*[.:]?\\s*(.*)$', 'i');
// Machine translation sometimes glues the marker to the end of a heading:
// "1. Frequency Control Process (FCP) Article 124."
const CLAUSE_END = new RegExp('^(.*?)(?:^|[\\s.)])(' + ARTICLE_WORDS + ')\\s*(\\d+[a-z]?)\\.?\\s*$', 'i');
const ANNEX_RE = /^\s*(Annex|Appendix|Prilog|Anhang|Anexo|Annexe|Allegato|Schedule)\s+([IVXLC]+|\d+|[A-Z])\b[.:]?\s*(.*)$/i;
const NUM_HEADING = /^\s*(\d+(?:\.\d+){1,5})\.?\s+(\p{Lu}[^\n]{2,110})$/u;
// Words that show "Article 25." at the end of a line is a reference inside a sentence, not a marker.
const REF_WORDS = new Set(['in', 'of', 'to', 'under', 'with', 'from', 'by', 'and', 'or', 'per', 'see', 'this', 'that', 'the', 'pursuant', 'accordance', 'within', 'at', 'on', 'as', 'than', 'for']);

const isTableRow = (t) => t.startsWith('| ') || (t.match(/ \| /g) || []).length >= 2;
const isTableBorder = (t) => /^[+|][-=+:| ]+[+|]$/.test(t);
const isListItem = (t) => /^([-–—•·*]|[a-z][.)]|[ivx]+\))\s+/.test(t);

function looksLikeHeading(t) {
  return t.length >= 3 && t.length <= 120 && /^[\p{Lu}\d(]/u.test(t) && !/[.;:,\-]$/.test(t) &&
    !MODAL_RE.test(t) && !isTableRow(t) && !/^[-–—•·*]\s/.test(t) && !/^\(\d+[a-z]?\)/.test(t);
}

const stripHeadingNumber = (t) => t.replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, '').trim();

/**
 * Split text into citable units (a numbered paragraph with its list items, or a table row).
 * @param {string} text
 * @returns {{mode:string, hasPages:boolean, lineCount:number, units:Array}}
 */
export function segment(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const n = lines.length;
  const hasPages = text.includes('\f');
  const page = new Array(n);
  let p = 1;
  for (let i = 0; i < n; i++) {
    // pdftotext puts a form feed at the start of the first line of each new page.
    const ff = (lines[i].match(/\f/g) || []).length;
    if (ff && lines[i].trimStart().startsWith('\f')) { p += ff; page[i] = p; } else { page[i] = p; p += ff; }
    if (ff) lines[i] = lines[i].replace(/\f/g, '');
  }

  // Pass 1: find clause markers and headings.
  const marker = new Array(n).fill(null); // {label, heading}
  const headingLine = new Array(n).fill(false);
  let articleCount = 0, numHeadingCount = 0;
  for (let i = 0; i < n; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    let m = CLAUSE_START.exec(t);
    if (m) {
      const rest = m[3].trim();
      const restOk = rest === '' || (looksLikeHeading(rest) && !/^(of|to|and|or|in|applies|shall|is|are)\b/i.test(rest));
      if (restOk) {
        marker[i] = { label: cap(m[1]) + ' ' + m[2], heading: rest, kind: 'clause' };
        articleCount++;
        continue;
      }
    }
    m = CLAUSE_END.exec(t);
    if (m) {
      const prefix = m[1].trim();
      const lastWord = (prefix.match(/([\p{L}]+)[^\p{L}]*$/u) || [])[1];
      // A prefix that starts with a heading number ("1.1.4.3 Evaluation, Replacement ... Article 205.")
      // is a heading whatever words it ends with; otherwise it must not read like a sentence.
      const numbered = /^\d+(\.\d+)*[.)]?\s+[\p{Lu}\[]/u.test(prefix);
      const prefixOk = prefix.length > 0 && prefix.length <= 110 && !MODAL_RE.test(prefix) &&
        !(lastWord && REF_WORDS.has(lastWord.toLowerCase())) && (numbered || !/[.;:]\s+\p{Lu}/u.test(prefix));
      if (prefixOk) {
        marker[i] = { label: cap(m[2]) + ' ' + m[3], heading: stripHeadingNumber(prefix), kind: 'clause' };
        articleCount++;
        continue;
      }
    }
    m = ANNEX_RE.exec(t);
    if (m && (m[3] === '' || looksLikeHeading(m[3]) || m[3].length < 140)) {
      marker[i] = { label: cap(m[1]) + ' ' + m[2], heading: m[3].trim(), kind: 'annex' };
      continue;
    }
    m = NUM_HEADING.exec(lines[i]);
    if (m && looksLikeHeading(m[2].trim())) {
      marker[i] = { label: m[1], heading: m[2].trim(), kind: 'numbered' };
      numHeadingCount++;
    }
  }
  const mode = articleCount >= 3 ? 'article' : numHeadingCount >= 3 ? 'heading' : 'plain';

  // In article mode a numbered heading is section context, not a clause boundary.
  // A heading may sit on the line before the marker (Croatian style) or after it (EU style).
  const prevText = (i) => { for (let k = i - 1; k >= 0 && k >= i - 4; k--) if (lines[k].trim()) return k; return -1; };
  const nextText = (i) => { for (let k = i + 1; k < n && k <= i + 4; k++) if (lines[k].trim()) return k; return -1; };
  for (let i = 0; i < n; i++) {
    const mk = marker[i];
    if (!mk || mk.kind === 'numbered') continue;
    if (!mk.heading) {
      const k = prevText(i);
      if (k >= 0 && !headingLine[k] && (!marker[k] || marker[k].kind === 'numbered') && looksLikeHeading(lines[k].trim())) {
        mk.heading = stripHeadingNumber(lines[k].trim());
        headingLine[k] = true;
        if (mode === 'article') marker[k] = null;
        // A group title can sit one more line up ("Voltage quality" above "Article 93").
        const k2 = prevText(k);
        if (k2 >= 0 && !marker[k2] && !headingLine[k2] && looksLikeHeading(lines[k2].trim()) && lines[k2].trim().length < 90 && !/^\s*\d/.test(lines[k2])) headingLine[k2] = true;
      } else {
        const j = nextText(i);
        if (j >= 0 && !marker[j] && looksLikeHeading(lines[j].trim()) && !/^\d+\.\s/.test(lines[j].trim())) {
          mk.heading = lines[j].trim();
          headingLine[j] = true;
        }
      }
    }
  }

  // Pass 2: build units.
  const units = [];
  let clause = { label: '', heading: '' };
  let section = '';
  let cur = null;
  let paraCount = 0;
  let lastBlank = true;
  let tableRow = 0, tableHeader = '';

  const push = () => { if (cur && squash(cur.text)) { cur.text = cur.text.trim(); units.push(cur); } cur = null; };
  const start = (i, para, first) => {
    push();
    paraCount++;
    cur = { clause: clause.label, heading: clause.heading, section, para, page: hasPages ? page[i] : null, line: i + 1, lineEnd: i + 1, text: first };
  };
  const append = (i, t, sep) => {
    // Re-join words that a line break split with a hyphen ("synchro-" + "nization").
    if (/\p{Ll}-$/u.test(cur.text) && /^\p{Ll}/u.test(t)) cur.text = cur.text.slice(0, -1) + t;
    else cur.text += sep + t;
    cur.lineEnd = i + 1;
  };

  for (let i = 0; i < n; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) { lastBlank = true; tableRow = 0; continue; }
    if (headingLine[i]) { lastBlank = true; continue; }
    const mk = marker[i];
    if (mk && (mk.kind !== 'numbered' || mode !== 'article')) {
      push();
      clause = { label: mk.label, heading: mk.heading };
      paraCount = 0; lastBlank = true; tableRow = 0;
      continue;
    }
    if (mk && mk.kind === 'numbered') { section = mk.label + ' ' + mk.heading; lastBlank = true; continue; }
    if (isTableBorder(t)) continue;

    if (isTableRow(t)) {
      tableRow++;
      const cells = t.replace(/^\|\s*/, '').replace(/\s*\|$/, '');
      if (tableRow === 1) { tableHeader = cells; start(i, 'table header', cells); cur.isHeader = true; }
      else { start(i, 'row ' + (tableRow - 1), cells); cur.ctx = tableHeader; }
      lastBlank = false;
      continue;
    }
    tableRow = 0;

    const indent = raw.length - raw.trimStart().length;
    let m = /^\((\d+[a-z]?)\)\s*(.*)$/.exec(t);
    if (m) { start(i, '(' + m[1] + ')', m[2]); lastBlank = false; continue; }
    m = /^(\d+)\.\s+(\S.*)$/.exec(t);
    if (m && indent <= 2 && !(cur && cur.para.startsWith('('))) { start(i, m[1] + '.', m[2]); lastBlank = false; continue; }

    if (!cur) { start(i, '', t); lastBlank = false; continue; }
    if (isListItem(t) || m) {
      // A list item after a table belongs to the running text, not to the last table row.
      if (cur.para.startsWith('row')) start(i, '', t); else append(i, t, '\n');
      lastBlank = false; continue;
    }
    // Plain continuation. A long unnumbered block is split at blank lines so citations stay tight.
    if (lastBlank && cur.para === '' && cur.text.length > 900) start(i, '', t);
    else if (lastBlank && cur.para.startsWith('row')) start(i, '', t);
    else append(i, t, lastBlank && cur.text.includes('\n') ? '\n' : ' ');
    lastBlank = false;
  }
  push();
  return { mode, hasPages, lineCount: n, units: units.filter((u) => !u.isHeader) };
}

const cap = (w) => (w.startsWith('§') ? w : w[0].toUpperCase() + w.slice(1).toLowerCase());

// ---------- numeric thresholds ----------

const NUM = '[±+\\-−]?\\s?(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)';
const UNIT = 'Hz\\/s|mHz|Hz|kV|MVAr|Mvar|MVAR|MVA|MWh|MW|kWh|kW|GW|kVAr|kvar|kVA|kA|ms|minutes?|mins?|seconds?|sec|hours?|p\\.u\\.|pu|%|s|h|V|A';
const RANGE_RE = new RegExp('(' + NUM + ')\\s?(' + UNIT + ')?\\s*(?:P\\s?n|P\\s?max|Un)?\\s*(to|–|—|-|and)\\s*(' + NUM + ')\\s?(' + UNIT + ')(?![\\p{L}\\d])', 'gu');
const SINGLE_RE = new RegExp('(' + NUM + ')\\s?(' + UNIT + ')(?![\\p{L}\\d])', 'gu');
const NAMED_RE = new RegExp('(cos\\s?(?:φ|ϕ|phi)|power factor|Q\\s?\\/\\s?P\\s?max|Plt|Pst|damping (?:factor|ratio))\\s*(?:of|is|=|≥|≤|<|>|at least|greater than|less than|not less than)?\\s*(' + NUM + ')(?![.,]?\\d)(?!\\s?(?:%|pu\\b|p\\.u\\.))', 'giu');

const CMP_PHRASES = [
  ['>=', ['≥', '>=', 'at least', 'minimum of', 'not less than', 'no less than', 'equal to or greater than', 'greater than or equal to', 'not be less than']],
  ['<=', ['≤', '<=', 'up to', 'at most', 'maximum of', 'a maximum of', 'not exceed', 'no more than', 'not more than', 'no later than', 'within', 'equal to or less than', 'less than or equal to', 'maximum', 'not be greater than']],
  ['<', ['<', 'less than', 'below', 'lower than']],
  ['>', ['>', 'greater than', 'more than', 'above', 'higher than', 'exceeding', 'exceeds', 'exceed']],
];

/** Read "15,000" as fifteen thousand and "50,2" as 50.2; report when the text allows both readings. */
export function parseNumber(rawNum, unit) {
  let s = rawNum.replace(/[±+\s]/g, '').replace('−', '-');
  let ambiguous = false;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    const asThousands = Number(s.replace(/,/g, ''));
    const single = /^-?\d{1,3},\d{3}$/.test(s);
    // Plausibility limits per unit decide whether a lone "49,950" is thousands or a decimal comma.
    const cap = { Hz: 1000, mHz: 100000, 'Hz/s': 100, kV: 2000, pu: 100, '%': 1000 }[unit];
    if (single && (s.replace('-', '').startsWith('0,') || (cap !== undefined && Math.abs(asThousands) > cap))) {
      s = s.replace(',', '.');
    } else {
      if (single) ambiguous = true;
      s = s.replace(/,/g, '');
    }
  } else {
    s = s.replace(',', '.');
  }
  return { value: Number(s), ambiguous };
}

function comparatorBefore(text, idx) {
  const win = text.slice(Math.max(0, idx - 30), idx).toLowerCase();
  let best = null;
  for (const [cmp, phrases] of CMP_PHRASES) {
    for (const ph of phrases) {
      const at = win.lastIndexOf(ph);
      if (at < 0) continue;
      const end = at + ph.length;
      // Only a few filler characters may sit between the phrase and the number.
      if (win.length - end > 12) continue;
      // A phrase that already belongs to an earlier number ("within 150 ms at 110 kV") does not apply.
      if (/\d/.test(win.slice(end))) continue;
      if (!best || end > best.end || (end === best.end && ph.length > best.len)) best = { cmp, end, len: ph.length };
    }
  }
  return best ? best.cmp : null;
}

/**
 * Find numeric thresholds with units in a requirement text.
 * @returns {Array<{raw:string, cmp:string, lo:number, hi?:number, unit:string, qty?:string, ambiguous?:boolean}>}
 */
export function findThresholds(text) {
  const out = [];
  const taken = []; // character spans already claimed by a range
  const s = String(text ?? '');
  let m;
  RANGE_RE.lastIndex = 0;
  while ((m = RANGE_RE.exec(s))) {
    const sep = m[3];
    // "and" joins a range only after "between"; otherwise "10 kV and 20 kV" are two separate values.
    if (sep === 'and' && !/between\s*$/i.test(s.slice(Math.max(0, m.index - 12), m.index))) { RANGE_RE.lastIndex = m.index + m[1].length; continue; }
    // "−5 %" after a dash is a negative number, not the end of a range, when the first number has no digits before the dash.
    const unit = normUnit(m[5]);
    const unit1 = m[2] ? normUnit(m[2]) : unit;
    if (unit === null || unit1 !== unit) { RANGE_RE.lastIndex = m.index + m[1].length; continue; }
    const a = parseNumber(m[1], unit), b = parseNumber(m[4].replace(/^[-−]\s?/, sep === '-' || sep === '–' ? '' : '-'), unit);
    if (!Number.isFinite(a.value) || !Number.isFinite(b.value)) continue;
    out.push({ at: m.index, raw: squash(m[0]), cmp: 'range', lo: Math.min(a.value, b.value), hi: Math.max(a.value, b.value), unit, ...(a.ambiguous || b.ambiguous ? { ambiguous: true } : {}) });
    taken.push([m.index, m.index + m[0].length]);
  }
  const inTaken = (i) => taken.some(([a, b]) => i >= a && i < b);
  SINGLE_RE.lastIndex = 0;
  while ((m = SINGLE_RE.exec(s))) {
    if (inTaken(m.index)) continue;
    const unit = normUnit(m[2]);
    if (unit === null) continue;
    const num = parseNumber(m[1], unit);
    if (!Number.isFinite(num.value)) continue;
    let cmp = /±/.test(m[1]) ? '±' : comparatorBefore(s, m.index) || '=';
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 14).toLowerCase();
    if (cmp === '=' && /^\s*or (more|greater|higher|above)/.test(after)) cmp = '>=';
    if (cmp === '=' && /^\s*or (less|lower|below)/.test(after)) cmp = '<=';
    out.push({ at: m.index, raw: squash(m[0]), cmp, lo: num.value, unit, ...(num.ambiguous ? { ambiguous: true } : {}) });
  }
  NAMED_RE.lastIndex = 0;
  while ((m = NAMED_RE.exec(s))) {
    const num = parseNumber(m[2], '');
    if (!Number.isFinite(num.value)) continue;
    const between = m[0].slice(m[1].length, m[0].length - m[2].length).toLowerCase();
    const cmp = /≥|at least|not less/.test(between) ? '>=' : /≤/.test(between) ? '<=' : /<|less than/.test(between) ? '<' : />|greater than/.test(between) ? '>' : '=';
    out.push({ at: m.index, raw: squash(m[0]), cmp, lo: num.value, unit: '', qty: squash(m[1]) });
  }
  out.sort((a, b) => a.at - b.at);
  return out.map(({ at, ...r }) => r);
}

// ---------- classification ----------

export function modality(text) {
  if (MODAL_RE.test(text)) return 'mandatory';
  if (SHOULD_RE.test(text)) return 'recommended';
  if (MAY_RE.test(text)) return 'permitted';
  return 'info';
}

/** Category by weighted phrase votes; heading text counts double. O(k) for k catalogue phrases. */
export function categorise(text, heading = '') {
  const body = ' ' + String(text).toLowerCase() + ' ';
  const head = ' ' + String(heading).toLowerCase() + ' ';
  let best = 'general', bestScore = 0;
  for (const c of CATEGORIES) {
    let score = 0;
    for (const [ph, w] of c.kw) {
      let hits = 0, from = 0;
      while (hits < 3) {
        const at = body.indexOf(ph, from);
        if (at < 0) break;
        // The phrase must start a word: "fsm" must not match inside "lfsm", nor "meter" inside "parameter".
        if (!/\p{L}/u.test(body[at - 1])) hits++;
        from = at + ph.length;
      }
      const hAt = head.indexOf(ph);
      score += hits * w + (hAt >= 0 && !/\p{L}/u.test(head[hAt - 1]) ? 2 * w : 0);
    }
    if (score > bestScore) { best = c.id; bestScore = score; } // ties keep the earlier catalogue entry
  }
  return best;
}

const PPM_RE = /power[- ]park module|power plant (park )?module|power plant park|\bppm\b|wind (farm|power|turbine|park|generat)|high wind|non-synchronous|inverter/i;
const SYNC_RE = /synchronous (power-)?(generat\w*|production) (module|unit)s?|synchronous generator|thermal|hydro|pumped|excitation|\bpss\b|prime mover|rotor|stator|steam/i;
const GEN_RE = /generat(ing|ion|or)|production (module|unit)|power-generating|\bproducer\b|\btype[- ][abcd]\b/i;
const CONN_RE = /connection point|point of connection|network user|grid user|connection to the (transmission|distribution)/i;

/**
 * How directly a clause concerns a wind power plant:
 * ppm (power park modules), gen (all generating modules), sync (synchronous machines only),
 * conn (any connected user), other.
 */
export function relevance(text, heading = '') {
  const s = text + ' ' + heading;
  if (PPM_RE.test(s)) return 'ppm';
  if (SYNC_RE.test(s)) return 'sync';
  if (GEN_RE.test(s)) return 'gen';
  if (CONN_RE.test(s)) return 'conn';
  return 'other';
}

const SITE_RE = /(determined|specified|defined|set|agreed|approved|required|requested|established|regulated)\s+(by|with|upon|between|in)\s+(the\s+)?(transmission system operator|relevant system operator|system operator|operator|tso|connection agreement|interconnection agreement)|in each specific case|for each specific case|project[- ]specific|case[- ]by[- ]case|to be agreed|separately agreed|upon (the )?(operator'?s? )?request|at the request of|in accordance with the transmission system operator'?s requirement/i;
const PENDING_RE = /not yet (considered|defined|determined|specified)|to be defined|\btbd\b|under consideration/i;
const VAGUE_RE = /\b(a few|several|appropriate|adequate|sufficient|as a rule|generally|without delay|if necessary|where applicable)\b/i;
const FIG_RE = /\b(Figure|Fig\.|Slika|Abbildung|Diagram)\s*(\d+[a-z]?)/gi;
const XREF_RE = /\b(Articles?|Chapters?|Sections?|Annex|Clauses?)\s+(\d+[\d.]*(?:\(\d+\))?|[IVX]+)\b/g;
const STD_RE = /\b(IEC(?:\/TR|\/TS)?|EN|IEEE|HRN EN|HRN|ISO|VDE|FGW)\s?(\d{3,6}(?:[-:.]\d+)*)/g;

/** Risks that could block interconnection approval if they are not resolved. */
export function findFlags(text, thresholds = []) {
  const flags = [];
  const figs = [...new Set([...text.matchAll(FIG_RE)].map((m) => m[2]))];
  if (figs.length) flags.push({ code: 'FIGURE', msg: 'Refers to Figure ' + figs.join(', ') + '. Curve values are not in the extracted text: read them from the source figure and record them as checks.' });
  if (/\[\s*\]/.test(text)) flags.push({ code: 'IMAGE', msg: 'An image, figure or formula was not captured as text at this point. Compare with the source document.' });
  if (SITE_RE.test(text)) flags.push({ code: 'SITE', msg: 'Value is set per project by the operator or the connection agreement. Obtain it in writing before the compliance study.' });
  if (PENDING_RE.test(text)) flags.push({ code: 'PENDING', msg: 'The source says this parameter is not yet defined. Approval risk until the operator fixes it.' });
  if (!thresholds.length && VAGUE_RE.test(text) && MODAL_RE.test(text)) flags.push({ code: 'VAGUE', msg: 'Obligation worded without a number. Ask the operator for the acceptance criterion or test parameter.' });
  if (thresholds.some((t) => t.ambiguous)) flags.push({ code: 'NUMBER', msg: 'A number can be read with a decimal comma or a thousands comma. Confirm the value against the source.' });
  const stds = [...new Set([...text.matchAll(STD_RE)].map((m) => m[1] + ' ' + m[2]))];
  if (stds.length) flags.push({ code: 'STANDARD', msg: 'Limits come from ' + stds.join(', ') + ', which is not part of this document. Add that standard to complete the requirement.' });
  const refs = [...new Set([...text.matchAll(XREF_RE)].map((m) => m[1] + ' ' + m[2]))];
  if (refs.length) flags.push({ code: 'XREF', msg: 'Depends on ' + refs.slice(0, 6).join(', ') + (refs.length > 6 ? ' and others' : '') + '. Read together with those provisions.' });
  return flags;
}

/** Human citation, e.g. "Article 120, para 2., p. 14, lines 1832-1834". */
export function citeLabel(c) {
  const parts = [];
  if (c.clause) parts.push(c.clause);
  if (c.para) parts.push(/^row|^table/.test(c.para) ? c.para : 'para ' + c.para);
  if (c.page) parts.push('p. ' + c.page);
  // Entries typed or imported without the source text have no line number.
  if (c.line > 0) parts.push(c.lineEnd && c.lineEnd !== c.line ? 'lines ' + c.line + '-' + c.lineEnd : 'line ' + c.line);
  return parts.join(', ');
}

/**
 * Full analysis of one document text.
 * @returns {{mode:string, hasPages:boolean, lineCount:number, items:Array}} items in document order
 */
export function analyse(text) {
  const seg = segment(text);
  const seen = new Map(); // text hash -> first item, so a repeated clause is reported once
  const items = [];
  for (const u of seg.units) {
    const body = u.ctx ? u.text : u.text;
    const key = hash32(squash(body) + '|' + u.clause + '|' + u.para);
    if (seen.has(key)) continue;
    const thresholds = findThresholds(body);
    const mod = modality(body);
    const item = {
      seq: items.length + 1,
      cite: { clause: u.clause, para: u.para, heading: u.heading, section: u.section, page: u.page, line: u.line, lineEnd: u.lineEnd },
      text: body,
      ctx: u.ctx || '',
      modality: mod,
      thresholds,
      cat: categorise(body + ' ' + (u.ctx || ''), u.heading + ' ' + u.section),
      rel: relevance(body, u.heading),
      flags: findFlags(body, thresholds),
      // A unit is a requirement when it obliges, permits or quantifies something.
      isReq: mod !== 'info' || thresholds.length > 0,
      key,
    };
    seen.set(key, item);
    items.push(item);
  }
  // A paragraph that does not name its subject ("The setpoint shall be reached within 1 minute")
  // takes the applicability of its clause, so it is not lost when filtering for wind plants.
  const clauseRel = new Map();
  const rank = { ppm: 3, gen: 2, sync: 1 };
  for (const it of items) {
    const k = it.cite.clause;
    if (k && rank[it.rel] && (rank[it.rel] > (rank[clauseRel.get(k)] || 0))) clauseRel.set(k, it.rel);
  }
  for (const it of items) {
    if ((it.rel === 'other' || it.rel === 'conn') && clauseRel.has(it.cite.clause)) it.rel = clauseRel.get(it.cite.clause);
  }
  return { mode: seg.mode, hasPages: seg.hasPages, lineCount: seg.lineCount, items };
}

// ---------- language guess ----------

const STOPWORDS = {
  en: ['the', 'and', 'of', 'shall', 'to', 'in', 'for', 'with', 'must', 'be'],
  hr: ['i', 'je', 'se', 'na', 'za', 'od', 'ili', 'mora', 'članak', 'sustava', 'mreže'],
  de: ['der', 'die', 'das', 'und', 'ist', 'für', 'mit', 'von', 'muss', 'werden', 'nicht'],
  es: ['el', 'la', 'los', 'las', 'de', 'y', 'en', 'para', 'deberá', 'con', 'del'],
  fr: ['le', 'la', 'les', 'des', 'et', 'en', 'pour', 'doit', 'avec', 'du', 'est'],
  it: ['il', 'la', 'di', 'e', 'per', 'con', 'deve', 'del', 'della', 'che', 'sono'],
  pt: ['o', 'a', 'os', 'de', 'e', 'para', 'com', 'deve', 'não', 'uma', 'são'],
  pl: ['i', 'w', 'na', 'z', 'do', 'się', 'jest', 'oraz', 'nie', 'przez', 'musi'],
  nl: ['de', 'het', 'een', 'en', 'van', 'voor', 'met', 'moet', 'niet', 'zijn', 'wordt'],
  tr: ['ve', 'bir', 'bu', 'için', 'ile', 'olarak', 'olan', 'veya', 'göre', 'tarafından'],
};
export const LANG_NAMES = { en: 'English', hr: 'Croatian', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese', pl: 'Polish', nl: 'Dutch', tr: 'Turkish' };

/** Rough language guess from function words in the first part of the text. Unknown -> ''. */
export function guessLanguage(text) {
  const words = String(text ?? '').slice(0, 20000).toLowerCase().match(/[\p{L}]+/gu) || [];
  if (words.length < 20) return { lang: '', share: 0 };
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  let best = '', bestN = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    let nHits = 0;
    for (const w of list) nHits += freq.get(w) || 0;
    if (nHits > bestN) { best = lang; bestN = nHits; }
  }
  const share = bestN / words.length;
  return share >= 0.04 ? { lang: best, share } : { lang: '', share };
}
