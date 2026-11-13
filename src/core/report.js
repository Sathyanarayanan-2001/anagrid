// Requirements document. Built as plain data first, then rendered to Markdown and to a
// standalone HTML file, so both outputs always say the same thing.
import { esc, stableSort, cmpNatural } from './util.js';
import { CATEGORIES, STATUSES, STATUS_BY_ID, DOC_KIND_BY_ID, DOC_STATUS } from './catalog.js';
import { evaluate, capIndex, findConflicts } from './evaluate.js';
import { citeLabel } from './extract.js';
import { fmtStamp, fmtDayFirst, fromISO, periodLabels } from './dates.js';
import { fmtRupees, sumPaise } from './money.js';
import { sortReqs } from './transfer.js';

const REL_LABEL = { ppm: 'Power park modules', gen: 'All generating modules', sync: 'Synchronous modules only', conn: 'All connected users', other: 'General' };
export { REL_LABEL };

/**
 * @param {{docs:Array, reqs:Array, caps:Array, country:string, now:number, version:string}} input
 * O(n log n) for the sort; everything else is linear.
 */
export function buildReport({ docs, reqs, caps, country, now, version }) {
  const d = stableSort(docs.filter((x) => x.country === country), (a, b) => (DOC_KIND_BY_ID.get(a.kind)?.order ?? 99) - (DOC_KIND_BY_ID.get(b.kind)?.order ?? 99), (a, b) => (a.published || '').localeCompare(b.published || ''), (a, b) => cmpNatural(a.title, b.title));
  const docById = new Map(d.map((x) => [x.id, x]));
  const r = sortReqs(reqs.filter((x) => x.country === country && docById.has(x.docId)), docById);
  const idx = capIndex(caps);
  const rows = r.map((q) => {
    const ev = evaluate(q, idx);
    const doc = docById.get(q.docId);
    return {
      req: q, ev, doc,
      source: (doc.ref ? doc.ref + ', ' : '') + doc.title + ' — ' + citeLabel(q.cite),
      findings: [...(q.flags || []).map((f) => f.msg), ...ev.notes],
    };
  });
  const counts = new Map(STATUSES.map((s) => [s.id, 0]));
  for (const x of rows) counts.set(x.ev.status, counts.get(x.ev.status) + 1);
  const byCat = CATEGORIES.map((c) => ({ cat: c, rows: rows.filter((x) => x.req.cat === c.id) })).filter((g) => g.rows.length);
  const reqById = new Map(r.map((q) => [q.id, q]));
  const conflicts = findConflicts(r).map((c) => ({ ...c, ra: reqById.get(c.a), rb: reqById.get(c.b) }));
  return {
    country, version, generated: fmtStamp(now), docs: d, rows, byCat, counts, conflicts,
    blockers: rows.filter((x) => x.ev.status !== 'COMPLIANT' || x.findings.length),
    costPaise: sumPaise(r.map((q) => q.cost)),
  };
}

const kindLabel = (k) => DOC_KIND_BY_ID.get(k)?.label || k;
const statusLabel = (s) => STATUS_BY_ID.get(s).label.toUpperCase();
const docStatus = (s) => DOC_STATUS.find((x) => x.id === s)?.label || s;
const dateText = (iso) => (iso && fromISO(iso) ? fmtDayFirst(fromISO(iso)) : '');

function basisText(x) {
  if (x.ev.basis === 'checks') {
    return x.ev.details.map((dt) => {
      const c = dt.check;
      const lim = c.cap + ' ' + c.cmp + ' ' + c.value + (c.unit && c.unit !== 'bool' ? ' ' + c.unit : '');
      if (dt.result === 'nodata') return lim + ': no data. ' + dt.note;
      return lim + ': recorded ' + dt.capValue + (dt.capUnit && dt.capUnit !== 'bool' ? ' ' + dt.capUnit : '') + ' -> ' + (dt.result === 'pass' ? 'met' : 'not met');
    }).join('; ');
  }
  if (x.ev.basis === 'manual') return 'Manual determination. Evidence: ' + (x.req.manual?.evidence || 'none recorded');
  return 'No capability data or evidence recorded for this requirement.';
}

export function reportToMarkdown(rep) {
  const L = [];
  L.push('# Grid connection requirements: ' + rep.country, '');
  L.push('Wind turbine manufacturer requirement sheet. Generated ' + rep.generated + ' (Asia/Calcutta) by AnaGrid ' + rep.version + '.', '');
  L.push('## 1. Source documents', '');
  L.push('| Reference | Title | Type | Version | Published | Language | Status |', '|---|---|---|---|---|---|---|');
  for (const d of rep.docs) L.push('| ' + [d.ref, d.title, kindLabel(d.kind), d.version, dateText(d.published), d.lang, docStatus(d.status)].map(mdCell).join(' | ') + ' |');
  L.push('', '## 2. Determination summary', '');
  L.push('| Determination | Requirements |', '|---|---:|');
  for (const s of STATUSES) L.push('| ' + s.label.toUpperCase() + ' | ' + rep.counts.get(s.id) + ' |');
  L.push('| Total | ' + rep.rows.length + ' |', '');
  L.push('Determinations rest only on the recorded turbine capability values and evidence. A requirement without data is INSUFFICIENT DATA; compliance is never assumed.', '');
  L.push('## 3. Requirements', '');
  for (const g of rep.byCat) {
    L.push('### ' + g.cat.label, '');
    for (const x of g.rows) {
      L.push('#### ' + x.req.code + ' — ' + statusLabel(x.ev.status), '');
      L.push('- Source: ' + x.source);
      if (x.req.cite.heading) L.push('- Section header: ' + x.req.cite.heading);
      L.push('- Applies to: ' + (REL_LABEL[x.req.rel] || x.req.rel) + '; obligation: ' + x.req.modality);
      if (x.req.ctx) L.push('- Table columns: ' + x.req.ctx);
      L.push('', ...x.req.text.split('\n').map((ln) => '> ' + ln), '');
      if ((x.req.thresholds || []).length) L.push('- Numerical thresholds: ' + x.req.thresholds.map((t) => t.raw).join('; '));
      L.push('- Basis: ' + basisText(x));
      for (const f of x.findings) L.push('- Finding: ' + f);
      if (x.req.action) L.push('- Action: ' + x.req.action);
      if (x.req.due) { const dt = fromISO(x.req.due); const p = periodLabels(dt); L.push('- Due: ' + fmtDayFirst(dt) + ' (' + p.week + ', ' + p.fy + ')'); }
      if (x.req.cost !== undefined) L.push('- Estimated cost to close: INR ' + fmtRupees(x.req.cost));
      L.push('');
    }
  }
  L.push('## 4. Cross-document discrepancies', '');
  if (!rep.conflicts.length) L.push('None detected between the stored documents.', '');
  for (const c of rep.conflicts) L.push('- Band ' + c.band + ': ' + c.ra.code + ' (' + citeLabel(c.ra.cite) + ') states ' + c.va + '; ' + c.rb.code + ' (' + citeLabel(c.rb.cite) + ') states ' + c.vb + '.');
  L.push('', '## 5. Items that can block interconnection approval', '');
  if (!rep.blockers.length) L.push('None.', '');
  for (const x of rep.blockers) L.push('- ' + x.req.code + ' (' + citeLabel(x.req.cite) + '): ' + statusLabel(x.ev.status) + (x.findings.length ? '. ' + x.findings.join(' ') : '.'));
  L.push('', 'Estimated cost to close all gaps: INR ' + fmtRupees(rep.costPaise), '');
  return L.join('\n');
}

const mdCell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

const REPORT_CSS = 'body{font:14px/1.5 "IBM Plex Sans","Segoe UI",system-ui,sans-serif;color:#0f172a;max-width:60rem;margin:2rem auto;padding:0 1rem}h1{font-size:1.6rem}h2{font-size:1.2rem;margin-top:2rem;border-bottom:1px solid #cbd5e1;padding-bottom:.25rem}h3{font-size:1.05rem;margin-top:1.5rem}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{border:1px solid #cbd5e1;padding:.35rem .5rem;text-align:left;vertical-align:top}th{background:#f1f5f9}.req{border:1px solid #cbd5e1;border-radius:6px;padding:.75rem 1rem;margin:.75rem 0;break-inside:avoid}.req h4{margin:0 0 .25rem;font-size:1rem}blockquote{margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid #059669;background:#f8fafc;white-space:pre-wrap}.st{font-weight:600;padding:.1rem .4rem;border-radius:4px;border:1px solid}.COMPLIANT{color:#065f46;border-color:#065f46}.PARTIAL{color:#92400e;border-color:#92400e}.NON_COMPLIANT{color:#991b1b;border-color:#991b1b}.INSUFFICIENT{color:#334155;border-color:#334155}.meta{color:#475569;margin:.15rem 0}.find{color:#92400e}.num{text-align:right}.nowrap{white-space:nowrap}@media print{body{margin:0;max-width:none}}';

/** Standalone HTML file (downloaded and opened from disk). Every value is escaped. */
export function reportToHTML(rep) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    esc('Grid connection requirements: ' + rep.country) + '</title><style>' + REPORT_CSS + '</style></head><body>\n' + reportBody(rep) + '\n</body></html>';
}

/** The report as an HTML fragment; the app shows it in place and the download wraps it. */
export function reportBody(rep) {
  const h = [];
  h.push('<h1>' + esc('Grid connection requirements: ' + rep.country) + '</h1>');
  h.push('<p class="meta">' + esc('Wind turbine manufacturer requirement sheet. Generated ' + rep.generated + ' (Asia/Calcutta) by AnaGrid ' + rep.version + '.') + '</p>');
  h.push('<h2>1. Source documents</h2><table><thead><tr><th>Reference</th><th>Title</th><th>Type</th><th>Version</th><th>Published</th><th>Language</th><th>Status</th></tr></thead><tbody>');
  for (const d of rep.docs) h.push('<tr>' + [d.ref, d.title, kindLabel(d.kind), d.version, dateText(d.published), d.lang, docStatus(d.status)].map((v, i) => '<td' + (i === 4 ? ' class="nowrap"' : '') + '>' + esc(v) + '</td>').join('') + '</tr>');
  h.push('</tbody></table><h2>2. Determination summary</h2><table><thead><tr><th>Determination</th><th class="num">Requirements</th></tr></thead><tbody>');
  for (const s of STATUSES) h.push('<tr><td>' + esc(s.label.toUpperCase()) + '</td><td class="num">' + rep.counts.get(s.id) + '</td></tr>');
  h.push('<tr><th>Total</th><th class="num">' + rep.rows.length + '</th></tr></tbody></table>');
  h.push('<p>Determinations rest only on the recorded turbine capability values and evidence. A requirement without data is INSUFFICIENT DATA; compliance is never assumed.</p>');
  h.push('<h2>3. Requirements</h2>');
  for (const g of rep.byCat) {
    h.push('<h3>' + esc(g.cat.label) + '</h3>');
    for (const x of g.rows) {
      h.push('<div class="req"><h4>' + esc(x.req.code) + ' <span class="st ' + x.ev.status + '">' + esc(statusLabel(x.ev.status)) + '</span></h4>');
      h.push('<p class="meta"><b>Source:</b> ' + esc(x.source) + '</p>');
      if (x.req.cite.heading) h.push('<p class="meta"><b>Section header:</b> ' + esc(x.req.cite.heading) + '</p>');
      h.push('<p class="meta"><b>Applies to:</b> ' + esc(REL_LABEL[x.req.rel] || x.req.rel) + '; <b>obligation:</b> ' + esc(x.req.modality) + '</p>');
      if (x.req.ctx) h.push('<p class="meta"><b>Table columns:</b> ' + esc(x.req.ctx) + '</p>');
      h.push('<blockquote>' + esc(x.req.text) + '</blockquote>');
      if ((x.req.thresholds || []).length) h.push('<p class="meta"><b>Numerical thresholds:</b> ' + esc(x.req.thresholds.map((t) => t.raw).join('; ')) + '</p>');
      h.push('<p class="meta"><b>Basis:</b> ' + esc(basisText(x)) + '</p>');
      for (const f of x.findings) h.push('<p class="meta find"><b>Finding:</b> ' + esc(f) + '</p>');
      if (x.req.action) h.push('<p class="meta"><b>Action:</b> ' + esc(x.req.action) + '</p>');
      if (x.req.due) { const dt = fromISO(x.req.due); const p = periodLabels(dt); h.push('<p class="meta"><b>Due:</b> ' + esc(fmtDayFirst(dt) + ' (' + p.week + ', ' + p.fy + ')') + '</p>'); }
      if (x.req.cost !== undefined) h.push('<p class="meta"><b>Estimated cost to close:</b> INR ' + esc(fmtRupees(x.req.cost)) + '</p>');
      h.push('</div>');
    }
  }
  h.push('<h2>4. Cross-document discrepancies</h2>');
  if (!rep.conflicts.length) h.push('<p>None detected between the stored documents.</p>');
  else h.push('<ul>' + rep.conflicts.map((c) => '<li>' + esc('Band ' + c.band + ': ' + c.ra.code + ' (' + citeLabel(c.ra.cite) + ') states ' + c.va + '; ' + c.rb.code + ' (' + citeLabel(c.rb.cite) + ') states ' + c.vb + '.') + '</li>').join('') + '</ul>');
  h.push('<h2>5. Items that can block interconnection approval</h2>');
  if (!rep.blockers.length) h.push('<p>None.</p>');
  else h.push('<ul>' + rep.blockers.map((x) => '<li>' + esc(x.req.code + ' (' + citeLabel(x.req.cite) + '): ' + statusLabel(x.ev.status) + (x.findings.length ? '. ' + x.findings.join(' ') : '.')) + '</li>').join('') + '</ul>');
  h.push('<p><b>Estimated cost to close all gaps:</b> INR ' + esc(fmtRupees(rep.costPaise)) + '</p>');
  return h.join('\n');
}
