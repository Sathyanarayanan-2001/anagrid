// Record shapes and input validation. Every value that enters the store passes through here,
// so bad input is rejected with a message that says what to fix.
import { InputError, uid, squash, hash32 } from './util.js';
import { DOC_KIND_BY_ID, DOC_STATUS, CATEGORY_BY_ID, STATUS_BY_ID } from './catalog.js';
import { parseDayFirst, toISO, fromISO } from './dates.js';
import { parseRupees } from './money.js';
import { normUnit } from './units.js';
import { validateCheck } from './evaluate.js';

const MAX_TEXT = 12 * 1024 * 1024; // characters; a grid code is well under 1 MB of text

function str(v, field, { required = false, max = 300 } = {}) {
  const s = squash(v);
  if (required && !s) throw new InputError(field + ' is required.', field);
  if (s.length > max) throw new InputError(field + ' is too long (' + s.length + ' characters, limit ' + max + ').', field);
  return s;
}

/** Only http and https links are stored; anything else (javascript:, data:) is refused. */
export function cleanUrl(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { throw new InputError('"' + s + '" is not a web address. Start it with https://', 'url'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new InputError('Only http and https links can be stored.', 'url');
  return u.href;
}

/** Optional typed date -> ISO text, or ''. */
export function cleanDate(v, refYear) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return toISO(parseDayFirst(s, refYear));
}

export function makeDoc(input, { refYear, prev } = {}) {
  const kind = input.kind || 'other';
  if (!DOC_KIND_BY_ID.has(kind)) throw new InputError('Choose a document type from the list.', 'kind');
  const status = input.status || 'in_force';
  if (!DOC_STATUS.some((s) => s.id === status)) throw new InputError('Choose a status from the list.', 'status');
  const text = String(input.text ?? prev?.text ?? '');
  const orig = String(input.orig ?? prev?.orig ?? '');
  if (text.length > MAX_TEXT || orig.length > MAX_TEXT) throw new InputError('The document text is too large (limit 12 million characters).', 'text');
  return {
    id: prev?.id || uid('doc'),
    t: 'doc',
    country: str(input.country, 'Country', { required: true, max: 60 }),
    title: str(input.title, 'Title', { required: true, max: 300 }),
    kind,
    issuer: str(input.issuer, 'Issuer', { max: 200 }),
    lang: str(input.lang, 'Language', { max: 40 }),
    ref: str(input.ref, 'Reference', { max: 120 }), // kept as text: "10/2024" must never become a date or a number
    version: str(input.version, 'Version', { max: 80 }),
    published: cleanDate(input.published, refYear),
    url: cleanUrl(input.url),
    status,
    notes: String(input.notes ?? '').trim().slice(0, 4000),
    text,
    orig,
    added: prev?.added || input.added || '',
  };
}

const REL = new Set(['ppm', 'gen', 'sync', 'conn', 'other']);

/** Short country prefix for requirement codes: "Croatia" -> "CRO". */
export function countryPrefix(country) {
  const letters = squash(country).toUpperCase().replace(/[^A-Z]/g, '');
  return (letters.slice(0, 3) || 'REQ');
}

/** Next free code for a country, e.g. CRO-0042. O(n) over that country's requirements. */
export function nextCode(country, reqs) {
  const prefix = countryPrefix(country);
  let max = 0;
  for (const r of reqs) {
    const m = new RegExp('^' + prefix + '-(\\d+)$').exec(r.code || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return (n) => prefix + '-' + String(max + n).padStart(4, '0');
}

/** Requirement record from an extraction candidate. */
export function reqFromItem(doc, item, code) {
  return {
    id: uid('req'),
    t: 'req',
    code,
    docId: doc.id,
    country: doc.country,
    cite: { ...item.cite },
    text: item.text,
    ctx: item.ctx || '',
    modality: item.modality,
    cat: item.cat,
    rel: item.rel,
    thresholds: item.thresholds,
    flags: item.flags,
    checks: [],
    seq: item.seq,
    key: item.key,
  };
}

/** Validate user edits to a requirement and return the updated record. */
export function editReq(prev, input, { refYear } = {}) {
  const next = { ...prev };
  if ('text' in input) {
    next.text = String(input.text ?? '').trim();
    if (!next.text) throw new InputError('Requirement text is required.', 'text');
    if (next.text.length > 20000) throw new InputError('Requirement text is too long (limit 20,000 characters).', 'text');
  }
  if ('cat' in input) {
    if (!CATEGORY_BY_ID.has(input.cat)) throw new InputError('Choose a category from the list.', 'cat');
    next.cat = input.cat;
  }
  if ('rel' in input) {
    if (!REL.has(input.rel)) throw new InputError('Choose an applicability from the list.', 'rel');
    next.rel = input.rel;
  }
  if ('clause' in input || 'para' in input) {
    next.cite = { ...prev.cite, clause: str(input.clause ?? prev.cite?.clause, 'Clause', { max: 80 }), para: str(input.para ?? prev.cite?.para, 'Paragraph', { max: 40 }) };
  }
  if ('status' in input || 'evidence' in input) {
    const status = input.status ?? prev.manual?.status ?? '';
    const evidence = String(input.evidence ?? prev.manual?.evidence ?? '').trim().slice(0, 4000);
    if (status && !STATUS_BY_ID.has(status)) throw new InputError('Choose a determination from the list.', 'status');
    if ((status === 'COMPLIANT' || status === 'PARTIAL') && !evidence) {
      throw new InputError('A ' + STATUS_BY_ID.get(status).label.toLowerCase() + ' determination needs evidence. Name the test report, certificate or data sheet and its section.', 'evidence');
    }
    next.manual = status ? { status, evidence } : (evidence ? { status: '', evidence } : undefined);
    if (!next.manual) delete next.manual;
  }
  if ('checks' in input) {
    const checks = (input.checks || []).map((c) => ({ cap: squash(c.cap), cmp: c.cmp, value: typeof c.value === 'number' ? c.value : parseDecimal(c.value, 'Limit'), unit: normUnit(c.unit) ?? c.unit }));
    checks.forEach(validateCheck);
    next.checks = checks;
  }
  if ('cost' in input) {
    const s = String(input.cost ?? '').trim();
    if (s) next.cost = parseRupees(s); else delete next.cost;
  }
  if ('due' in input) {
    const d = cleanDate(input.due, refYear);
    if (d) next.due = d; else delete next.due;
  }
  if ('action' in input) next.action = String(input.action ?? '').trim().slice(0, 2000);
  return next;
}

/** Parse a typed decimal number; accepts a decimal comma. */
export function parseDecimal(v, field = 'Value') {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.').replace('−', '-');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) throw new InputError(field + ' must be a number, for example 47.5.', field);
  return Number(s);
}

export function makeCap(input, prev) {
  const key = str(input.key, 'Parameter', { required: true, max: 120 });
  const unit = normUnit(input.unit ?? '');
  if (unit === null) throw new InputError('Unit "' + input.unit + '" is not known. Use Hz, mHz, Hz/s, s, ms, min, h, V, kV, A, kA, kW, MW, kvar, Mvar, kVA, MVA, pu, %, or leave it empty for a plain number.', 'unit');
  const raw = String(input.value ?? '').trim();
  let value;
  if (unit === 'bool') {
    if (!/^(yes|no|1|0|true|false)$/i.test(raw)) throw new InputError('For a yes/no capability type yes or no.', 'Value');
    value = /^(yes|1|true)$/i.test(raw) ? 1 : 0;
  } else {
    value = parseDecimal(raw, 'Value');
  }
  return {
    id: prev?.id || uid('cap'),
    t: 'cap',
    key,
    value,
    unit,
    evidence: String(input.evidence ?? '').trim().slice(0, 1000),
  };
}

/** Key used to spot a requirement that was already saved from the same place in the same document. */
export const reqDupKey = (r) => r.docId + '|' + (r.key || hash32(squash(r.text)));

export { fromISO };
