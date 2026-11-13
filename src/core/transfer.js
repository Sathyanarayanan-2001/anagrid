// Import and export: CSV for requirements and capabilities, JSON for full backups.
// An import is always planned first (preview with a status per row) and committed separately.
import { parseCSV, toCSV, findHeader, protectText, unprotectText } from './csv.js';
import { InputError, squash, uid, hash32, stableSort, cmpNatural } from './util.js';
import { CATEGORIES, CATEGORY_BY_ID, STATUSES, STATUS_BY_ID } from './catalog.js';
import { categorise, findThresholds, findFlags, modality, relevance, citeLabel } from './extract.js';
import { evaluate, capIndex } from './evaluate.js';
import { parseRupees, fmtRupees } from './money.js';
import { cleanDate, makeCap, nextCode, reqDupKey } from './model.js';
import { fromISO, fmtDayFirst } from './dates.js';

export const REQ_ALIASES = {
  country: ['nation', 'market'],
  document: ['source document', 'source', 'doc', 'document title', 'grid code'],
  clause: ['article', 'section', 'clause no', 'article no', 'reference', 'ref'],
  paragraph: ['para', 'item', 'sub clause', 'subclause'],
  heading: ['title', 'topic', 'subject'],
  page: ['page no', 'pg'],
  line: ['line no', 'lines'],
  category: ['aspect', 'group', 'type'],
  requirement: ['requirement text', 'text', 'description', 'requirement description', 'clause text'],
  status: ['determination', 'compliance', 'compliance status', 'assessment'],
  evidence: ['evidence reference', 'proof', 'comment', 'comments', 'remarks'],
  cost: ['cost to close', 'estimated cost', 'cost inr', 'cost (inr)', 'amount'],
  due: ['due date', 'target date', 'deadline'],
  action: ['gap action', 'next step'],
  code: ['id', 'req id', 'requirement id'],
};
export const CAP_ALIASES = {
  parameter: ['capability', 'key', 'name', 'quantity'],
  value: ['capability value', 'turbine value', 'actual'],
  unit: ['units', 'uom'],
  evidence: ['evidence reference', 'source', 'proof', 'reference'],
};

const STATUS_WORDS = new Map([
  ['compliant', 'COMPLIANT'], ['partially compliant', 'PARTIAL'], ['partial', 'PARTIAL'],
  ['non-compliant', 'NON_COMPLIANT'], ['non compliant', 'NON_COMPLIANT'], ['noncompliant', 'NON_COMPLIANT'],
  ['insufficient data', 'INSUFFICIENT'], ['insufficient', 'INSUFFICIENT'], ['', ''],
]);
const CAT_BY_LABEL = new Map(CATEGORIES.flatMap((c) => [[c.label.toLowerCase(), c.id], [c.id, c.id]]));

/**
 * Plan a requirements import. Nothing is saved here.
 * @returns {{headerIndex:number, rows:Array<{n:number,status:string,msg:string,rec?:object,cells:object}>, okCount:number}}
 * O(n) rows; document and duplicate lookups use maps.
 */
export function planReqImport(text, { docs, reqs, refYear }) {
  const rows = parseCSV(text);
  const { headerIndex, columns } = findHeader(rows, REQ_ALIASES, ['requirement']);
  const docByKey = new Map(docs.map((d) => [(d.country + '|' + d.title).toLowerCase(), d]));
  const docsByTitle = new Map();
  for (const d of docs) { const k = d.title.toLowerCase(); docsByTitle.set(k, (docsByTitle.get(k) || []).concat(d)); }
  const dup = new Set(reqs.map(reqDupKey));
  const counters = new Map();
  const out = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const cell = (f) => (f in columns ? unprotectText(rows[i][columns[f]] ?? '').trim() : '');
    if (rows[i].every((c) => !String(c).trim())) continue;
    const cells = { document: cell('document'), clause: cell('clause'), requirement: cell('requirement') };
    const fail = (msg) => out.push({ n: i + 1, status: 'error', msg, cells });
    try {
      const text = cell('requirement');
      if (!text) { fail('Requirement text is empty. Fill the requirement column or delete the row.'); continue; }
      const title = cell('document');
      let doc = docByKey.get((cell('country') + '|' + title).toLowerCase());
      if (!doc) {
        const sameTitle = docsByTitle.get(title.toLowerCase()) || [];
        if (sameTitle.length === 1) doc = sameTitle[0];
      }
      if (!doc) { fail(title ? 'Document "' + title + '" is not in the register. Add it on the Documents tab first, with the same title.' : 'Document column is empty. Name the source document of this requirement.'); continue; }
      const catRaw = cell('category').toLowerCase();
      const cat = catRaw ? CAT_BY_LABEL.get(catRaw) : categorise(text, cell('heading'));
      if (!cat) { fail('Category "' + cell('category') + '" is not known. Leave it empty to classify automatically.'); continue; }
      const stRaw = cell('status').toLowerCase().replace(/_/g, ' ');
      if (!STATUS_WORDS.has(stRaw)) { fail('Status "' + cell('status') + '" is not known. Use Compliant, Partially compliant, Non-compliant or Insufficient data.'); continue; }
      const status = STATUS_WORDS.get(stRaw);
      const evidence = cell('evidence');
      if ((status === 'COMPLIANT' || status === 'PARTIAL') && !evidence) { fail('Status ' + cell('status') + ' needs an evidence reference in the evidence column.'); continue; }
      const page = cell('page'), line = cell('line');
      if (page && !/^\d+$/.test(page)) { fail('Page "' + page + '" is not a whole number.'); continue; }
      const lineM = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(line);
      if (line && !lineM) { fail('Line "' + line + '" must be a number or a range such as 120-124.'); continue; }
      const thresholds = findThresholds(text);
      const rec = {
        id: uid('req'), t: 'req', docId: doc.id, country: doc.country,
        cite: { clause: cell('clause'), para: cell('paragraph'), heading: cell('heading'), section: '', page: page ? Number(page) : null, line: lineM ? Number(lineM[1]) : 0, lineEnd: lineM ? Number(lineM[2] || lineM[1]) : 0 },
        text, ctx: '', modality: modality(text), cat, rel: relevance(text, cell('heading')),
        thresholds, flags: findFlags(text, thresholds), checks: [], seq: i,
      };
      rec.key = hash32(squash(text) + '|' + rec.cite.clause + '|' + rec.cite.para);
      if (status || evidence) rec.manual = { status, evidence };
      if (cell('cost')) rec.cost = parseRupees(cell('cost'));
      if (cell('due')) rec.due = cleanDate(cell('due'), refYear);
      if (cell('action')) rec.action = cell('action');
      const k = reqDupKey(rec);
      if (dup.has(k)) { out.push({ n: i + 1, status: 'duplicate', msg: 'Already in the register (same document, clause and text). It will be skipped.', cells }); continue; }
      dup.add(k);
      if (!counters.has(doc.country)) counters.set(doc.country, { gen: nextCode(doc.country, reqs), n: 0 });
      const ctr = counters.get(doc.country);
      rec.code = ctr.gen(++ctr.n);
      out.push({ n: i + 1, status: 'ok', msg: 'Ready', rec, cells });
    } catch (e) {
      if (!(e instanceof InputError)) throw e;
      fail(e.message);
    }
  }
  return { headerIndex, rows: out, okCount: out.filter((r) => r.status === 'ok').length };
}

export function planCapImport(text, { caps }) {
  const rows = parseCSV(text);
  const { headerIndex, columns } = findHeader(rows, CAP_ALIASES, ['parameter', 'value']);
  const existing = new Map(caps.map((c) => [c.key.toLowerCase(), c]));
  const seen = new Set();
  const out = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const cell = (f) => (f in columns ? unprotectText(rows[i][columns[f]] ?? '').trim() : '');
    if (rows[i].every((c) => !String(c).trim())) continue;
    const cells = { parameter: cell('parameter'), value: cell('value'), unit: cell('unit') };
    try {
      const k = cell('parameter').toLowerCase();
      if (seen.has(k)) { out.push({ n: i + 1, status: 'duplicate', msg: 'This parameter appears earlier in the file. The first row is used.', cells }); continue; }
      const prev = existing.get(k);
      const rec = makeCap({ key: cell('parameter'), value: cell('value'), unit: cell('unit'), evidence: cell('evidence') }, prev);
      seen.add(k);
      out.push({ n: i + 1, status: 'ok', msg: prev ? 'Will update the existing value' : 'Ready', rec, cells });
    } catch (e) {
      if (!(e instanceof InputError)) throw e;
      out.push({ n: i + 1, status: 'error', msg: e.message, cells });
    }
  }
  return { headerIndex, rows: out, okCount: out.filter((r) => r.status === 'ok').length };
}

/** Requirements ordered for people: by document, then position in the document, then code. */
export function sortReqs(reqs, docById) {
  return stableSort(reqs,
    (a, b) => cmpNatural(docById.get(a.docId)?.title || '', docById.get(b.docId)?.title || ''),
    (a, b) => (a.cite?.line || 0) - (b.cite?.line || 0) || (a.seq || 0) - (b.seq || 0),
    (a, b) => cmpNatural(a.code, b.code));
}

export function reqsToCSV(reqs, docs, caps) {
  const docById = new Map(docs.map((d) => [d.id, d]));
  const idx = capIndex(caps);
  const head = ['Code', 'Country', 'Document', 'Clause', 'Paragraph', 'Heading', 'Page', 'Line', 'Category', 'Requirement', 'Thresholds', 'Status', 'Basis', 'Evidence', 'Findings', 'Cost', 'Due', 'Action'];
  const body = sortReqs(reqs, docById).map((r) => {
    const ev = evaluate(r, idx);
    const due = r.due ? fmtDayFirst(fromISO(r.due)) : '';
    return [
      r.code, r.country, docById.get(r.docId)?.title || '', protectText(r.cite?.clause || ''), protectText(r.cite?.para || ''), r.cite?.heading || '',
      r.cite?.page ?? '', r.cite?.line ? (r.cite.lineEnd && r.cite.lineEnd !== r.cite.line ? r.cite.line + '-' + r.cite.lineEnd : String(r.cite.line)) : '',
      CATEGORY_BY_ID.get(r.cat)?.label || r.cat, r.text,
      (r.thresholds || []).map((t) => t.raw).join('; '),
      STATUS_BY_ID.get(ev.status).label, ev.basis, r.manual?.evidence || '',
      [...(r.flags || []).map((f) => f.msg), ...ev.notes].join(' | '),
      r.cost !== undefined ? fmtRupees(r.cost) : '', due, r.action || '',
    ];
  });
  return toCSV([head, ...body]);
}

export function capsToCSV(caps) {
  const rows = stableSort(caps, (a, b) => cmpNatural(a.key, b.key)).map((c) => [c.key, c.unit === 'bool' ? (c.value ? 'yes' : 'no') : String(c.value), c.unit, c.evidence || '']);
  return toCSV([['Parameter', 'Value', 'Unit', 'Evidence'], ...rows]);
}

// ---------- JSON backup ----------

export const BACKUP_APP = 'anagrid';

export function makeBackup(recs, now) {
  return JSON.stringify({ app: BACKUP_APP, v: 1, exported: now, recs });
}

/** Validate a backup or sync payload and return its records. Throws InputError on a wrong file. */
export function readBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new InputError('This file is not valid JSON. Choose a backup made by AnaGrid (anagrid-backup-….json).', 'file'); }
  if (!data || data.app !== BACKUP_APP || !Array.isArray(data.recs)) throw new InputError('This JSON file is not an AnaGrid backup. Choose a file exported from the Data tab.', 'file');
  if (data.v !== 1) throw new InputError('This backup was made by a newer AnaGrid (format ' + data.v + '). Update the app, then import again.', 'file');
  const TYPES = new Set(['doc', 'req', 'cap', 'set']);
  return data.recs.filter((r) => r && typeof r.id === 'string' && typeof r.u === 'number' && TYPES.has(r.t));
}

export { STATUSES, citeLabel };
