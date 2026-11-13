// Requirements list and editor, and the Compliance tab (turbine capabilities, risks).
import { h, $, $$, openDialog, confirmDialog, toast, options } from './ui.js';
import { app, data, scoped, refYear, dateText, periodText } from './ctx.js';
import { emptyStart } from './views-a.js';
import { CATEGORIES, CATEGORY_BY_ID, STATUSES, STATUS_BY_ID, CAPABILITY_HINTS } from '../core/catalog.js';
import { editReq, makeCap, nextCode, parseDecimal } from '../core/model.js';
import { citeLabel, findThresholds, findFlags, modality, categorise, relevance } from '../core/extract.js';
import { CMPS, findConflicts } from '../core/evaluate.js';
import { stableSort, cmpNatural, InputError, uid, hash32, squash } from '../core/util.js';
import { UNITS } from '../core/units.js';
import { fmtRupees } from '../core/money.js';
import { parseDayFirst, periodLabels } from '../core/dates.js';
import { sortReqs } from '../core/transfer.js';
import { REL_LABEL } from '../core/report.js';
import { openDocAt } from './views-docs.js';

const REL_OPTS = Object.entries(REL_LABEL).map(([id, label]) => ({ id, label }));
const SORTS = [{ id: 'doc', label: 'Document order' }, { id: 'cat', label: 'Category' }, { id: 'status', label: 'Determination' }, { id: 'due', label: 'Due date' }];
export const stPill = (status) => h`<span class="st ${status}">${STATUS_BY_ID.get(status).label}</span>`;
const unitLabel = (u) => (u === 'bool' ? 'yes/no' : u || 'number');
const UNIT_OPTS = Object.keys(UNITS).map((u) => ({ id: u, label: unitLabel(u) }));
const capValue = (c) => (c.unit === 'bool' ? (c.value ? 'yes' : 'no') : String(c.value));

/** Requirements after the current filters, in the chosen order. O(n log n). */
export function filteredReqs() {
  const d = data();
  const f = app.state.f;
  // A filter that points at a document deleted since (here or on another device) would hide
  // everything without an obvious reason, so it is dropped.
  if (f.doc && !d.docById.has(f.doc)) f.doc = '';
  const q = f.q.trim().toLowerCase();
  let list = scoped(d.reqs).filter((r) =>
    (!f.doc || r.docId === f.doc) && (!f.cat || r.cat === f.cat) && (!f.rel || r.rel === f.rel) &&
    (!f.status || d.results.get(r.id).status === f.status) &&
    (!q || (r.text + ' ' + r.code + ' ' + (r.cite?.clause || '') + ' ' + (r.cite?.heading || '')).toLowerCase().includes(q)));
  list = sortReqs(list, d.docById);
  // Ties fall back to document order (already applied), then due date, then code.
  if (f.sort === 'cat') list = stableSort(list, (a, b) => CATEGORY_BY_ID.get(a.cat).order - CATEGORY_BY_ID.get(b.cat).order);
  if (f.sort === 'status') list = stableSort(list, (a, b) => STATUS_BY_ID.get(d.results.get(a.id).status).order - STATUS_BY_ID.get(d.results.get(b.id).status).order, (a, b) => (a.due || '9999').localeCompare(b.due || '9999'), (a, b) => cmpNatural(a.code, b.code));
  if (f.sort === 'due') list = stableSort(list, (a, b) => (a.due || '9999').localeCompare(b.due || '9999'), (a, b) => cmpNatural(a.code, b.code));
  return list;
}

export function reqListPart() {
  const d = data();
  const list = filteredReqs();
  const shown = list.slice(0, app.state.limit);
  if (!list.length) return h`<div class="empty"><p>No requirement matches these filters. Clear a filter, or open a document and choose Extract requirements.</p><button type="button" class="btn" data-act="req-clear">Clear filters</button></div>`;
  return h`<p class="small muted">${list.length} requirement${list.length === 1 ? '' : 's'}${shown.length < list.length ? ', first ' + shown.length + ' shown' : ''}</p>
    <div class="table-wrap"><table class="resp"><thead><tr><th>Code</th><th>Source</th><th>Category</th><th>Requirement</th><th>Thresholds</th><th>Determination</th><th>Findings</th></tr></thead>
    <tbody>${shown.map((r) => {
      const ev = d.results.get(r.id);
      const nFind = (r.flags || []).length + ev.notes.length;
      return h`<tr><td data-l="Code" class="nowrap"><button type="button" class="linkish" data-act="req-open" data-id="${r.id}">${r.code}</button></td>
        <td data-l="Source">${citeLabel(r.cite)}<div class="small muted">${d.docById.get(r.docId)?.ref || d.docById.get(r.docId)?.title || ''}</div></td>
        <td data-l="Category">${CATEGORY_BY_ID.get(r.cat)?.label}</td>
        <td data-l="Requirement"><span class="clamp">${r.text}</span></td>
        <td data-l="Thresholds">${(r.thresholds || []).slice(0, 4).map((t) => h`<span class="chip">${t.raw}</span> `)}</td>
        <td data-l="Determination">${stPill(ev.status)}</td>
        <td data-l="Findings">${nFind ? h`<span class="chip warn">${nFind}</span>` : ''}</td></tr>`;
    })}</tbody></table></div>
    ${shown.length < list.length ? h`<div class="row"><button type="button" class="btn" data-act="req-more">Show 150 more</button></div>` : ''}`;
}

export function viewReqs() {
  const d = data();
  const f = app.state.f;
  if (f.doc && !d.docById.has(f.doc)) f.doc = '';
  if (!d.reqs.length) {
    return h`<section class="view"><div class="head"><h1>Requirements</h1></div>
      ${d.docs.length ? h`<div class="empty"><h2>No requirements yet</h2><p>Open a document and choose Extract requirements. Each clause is listed with its article, paragraph and line for you to review before saving.</p><a class="btn primary" href="#docs">Open documents</a></div>` : emptyStart('No requirements yet')}</section>`;
  }
  const docs = scoped(d.docs).map((x) => ({ id: x.id, label: x.title }));
  return h`<section class="view">
    <div class="head"><h1>Requirements</h1><button type="button" class="btn" data-act="req-add">Add by hand</button></div>
    <div class="filters">
      <label class="field"><span>Search</span><input type="search" id="req-q" value="${f.q}" placeholder="Text, code or article" autocomplete="off"></label>
      <label class="field"><span>Document</span><select data-filter="doc">${options(docs, f.doc, 'All documents')}</select></label>
      <label class="field"><span>Category</span><select data-filter="cat">${options(CATEGORIES, f.cat, 'All categories')}</select></label>
      <label class="field"><span>Determination</span><select data-filter="status">${options(STATUSES, f.status, 'All determinations')}</select></label>
      <label class="field"><span>Applies to</span><select data-filter="rel">${options(REL_OPTS, f.rel, 'Everything')}</select></label>
      <label class="field"><span>Order</span><select data-filter="sort">${options(SORTS, f.sort)}</select></label>
    </div>
    <div id="req-list">${reqListPart()}</div>
  </section>`;
}

const checkRow = (c = {}) => h`<div class="checks" data-check>
  <input type="text" data-k="cap" value="${c.cap || ''}" list="dl-caps" placeholder="Turbine capability" aria-label="Turbine capability" autocomplete="off">
  <select data-k="cmp" aria-label="Comparison">${CMPS.map((x) => h`<option ${x === (c.cmp || '>=') ? h`selected` : ''}>${x}</option>`)}</select>
  <input type="text" data-k="value" inputmode="decimal" value="${c.value ?? ''}" placeholder="Limit" aria-label="Limit" autocomplete="off">
  <select data-k="unit" aria-label="Unit">${options(UNIT_OPTS, c.unit ?? 'Hz')}</select>
  <button type="button" class="btn sm" data-rm-check aria-label="Remove this check">Remove</button></div>`;

export function reqDialog(id) {
  const d = data();
  const r = app.store.get(id);
  if (!r) return;
  const doc = d.docById.get(r.docId);
  const ev = d.results.get(r.id);
  const capNames = [...new Set([...d.caps.map((c) => c.key), ...CAPABILITY_HINTS.map((x) => x[0])])];
  const detail = (dt) => {
    const c = dt.check;
    const lim = c.cap + ' ' + c.cmp + ' ' + c.value + ' ' + (c.unit === 'bool' ? '' : c.unit);
    return dt.result === 'nodata' ? h`<li><span class="chip warn">No data</span> <span>${lim}. ${dt.note}</span></li>`
      : h`<li><span class="chip${dt.result === 'fail' ? ' warn' : ''}">${dt.result === 'pass' ? 'Met' : 'Not met'}</span> <span>${lim}; recorded ${dt.capValue} ${dt.capUnit === 'bool' ? '' : dt.capUnit}</span></li>`;
  };
  const due = r.due ? dateText(r.due) : '';
  openDialog({
    title: r.code + ' · ' + citeLabel(r.cite), wide: true, submit: 'Save',
    extra: h`<button type="button" class="btn" id="req-del">Delete</button>`,
    body: h`
      <dl class="meta"><dt>Document</dt><dd>${doc ? h`${doc.ref ? doc.ref + ', ' : ''}${doc.title}` : 'Document removed'}</dd>
        ${r.cite.heading ? h`<dt>Section header</dt><dd>${r.cite.heading}</dd>` : ''}
        <dt>Obligation</dt><dd>${r.modality}</dd>${r.ctx ? h`<dt>Table columns</dt><dd>${r.ctx}</dd>` : ''}
        <dt>Determination</dt><dd>${stPill(ev.status)} <span class="muted small">${ev.basis === 'checks' ? 'computed from checks' : ev.basis === 'manual' ? 'set by hand' : 'no data recorded'}</span></dd></dl>
      ${doc && doc.text && r.cite.line ? h`<div class="row"><button type="button" class="btn sm" id="req-src">Open in source at line ${r.cite.line}</button></div>` : ''}
      <label class="field"><span>Requirement text <span class="hint">as in the source</span></span><textarea name="text" rows="5">${r.text}</textarea></label>
      <div class="grid2"><label class="field"><span>Category</span><select name="cat">${options(CATEGORIES, r.cat)}</select></label>
        <label class="field"><span>Applies to</span><select name="rel">${options(REL_OPTS, r.rel)}</select></label></div>
      ${(r.thresholds || []).length ? h`<div><h3>Numerical thresholds found</h3><p class="row">${r.thresholds.map((t) => h`<span class="chip">${t.raw}</span>`)}</p></div>` : ''}
      ${(r.flags || []).length || ev.notes.length ? h`<div class="note warn"><h3>Findings</h3><ul>${(r.flags || []).map((f) => h`<li>${f.msg}</li>`)}${ev.notes.map((n) => h`<li>${n}</li>`)}</ul></div>` : ''}
      <div><h3>Checks against turbine capability</h3><p class="small muted">Each check compares one recorded capability with a limit from this requirement. Record capability values on the Compliance tab.</p>
        ${ev.details.length ? h`<ul class="list">${ev.details.map(detail)}</ul>` : ''}
        <div id="checks">${(r.checks || []).map(checkRow)}</div>
        <datalist id="dl-caps">${capNames.map((n) => h`<option value="${n}">`)}</datalist>
        <div class="row"><button type="button" class="btn sm" id="add-check">Add a check</button></div></div>
      <div class="grid2"><label class="field"><span>Determination by hand <span class="hint">used only when there are no checks</span></span><select name="status">${options(STATUSES, r.manual?.status || '', 'Not set (insufficient data)')}</select></label>
        <label class="field"><span>Evidence <span class="hint">test report, certificate, data sheet and section</span></span><textarea name="evidence" rows="2">${r.manual?.evidence || ''}</textarea></label></div>
      <div class="grid3"><label class="field"><span>Gap action</span><input type="text" name="action" value="${r.action || ''}" autocomplete="off"></label>
        <label class="field"><span>Due <span class="hint" id="due-hint">${r.due ? periodText(r.due) : 'day first, 28/10/2026'}</span></span><input type="text" name="date" inputmode="numeric" value="${due}" placeholder="dd/mm/yyyy" autocomplete="off"></label>
        <label class="field"><span>Cost to close <span class="hint">rupees</span></span><input type="text" name="amount" inputmode="decimal" value="${r.cost !== undefined ? fmtRupees(r.cost) : ''}" placeholder="1,23,456.78" autocomplete="off"></label></div>`,
    onOpen: (dlg) => {
      $('#add-check', dlg).addEventListener('click', () => { $('#checks', dlg).insertAdjacentHTML('beforeend', checkRow().s); $('#checks [data-check]:last-child input', dlg).focus(); });
      $('#checks', dlg).addEventListener('click', (e) => { const b = e.target.closest('[data-rm-check]'); if (b) b.closest('[data-check]').remove(); });
      // Week and financial year are derived from the typed date and shown at once.
      dlg.querySelector('input[name="date"]').addEventListener('input', (e) => {
        const hint = $('#due-hint', dlg);
        try { const dt = parseDayFirst(e.target.value, refYear()); const p = periodLabels(dt); hint.textContent = p.week + ' · ' + p.fy; } catch { hint.textContent = 'day first, 28/10/2026'; }
      });
      const src = $('#req-src', dlg);
      if (src) src.addEventListener('click', () => { dlg.close(); openDocAt(doc.id, r.cite.line, r.cite.lineEnd); });
      $('#req-del', dlg).addEventListener('click', async () => {
        if (await confirmDialog({ title: 'Delete requirement ' + r.code + '?', danger: true, confirm: 'Delete', text: 'The requirement is removed from the register and from the report. You can extract it again from the document.' })) {
          app.store.remove(r.id); dlg.close(); toast('Requirement deleted'); app.render();
        }
      });
    },
    onSubmit: (fd, dlg) => {
      const checks = $$('[data-check]', dlg).map((row) => {
        const g = (k) => $('[data-k="' + k + '"]', row).value;
        return { cap: g('cap'), cmp: g('cmp'), value: g('value'), unit: g('unit'), row };
      }).filter((c) => c.cap.trim() || c.value.trim());
      for (const c of checks) {
        // Validate here so the faulty row can be focused.
        try { if (!c.cap.trim()) throw new InputError('Name the turbine capability this check reads, or remove the row.', 'cap'); c.value = parseDecimal(c.value, 'Limit'); } catch (e) { $('[data-k="' + (e.field === 'cap' ? 'cap' : 'value') + '"]', c.row).focus(); throw new InputError(e.message); }
      }
      const next = editReq(r, {
        text: fd.get('text'), cat: fd.get('cat'), rel: fd.get('rel'), status: fd.get('status'), evidence: fd.get('evidence'),
        checks: checks.map(({ row, ...c }) => c), cost: fd.get('amount'), due: fd.get('date'), action: fd.get('action'),
      }, { refYear: refYear() });
      if (next.text !== r.text) { next.thresholds = findThresholds(next.text); next.flags = [...(r.flags || []).filter((f) => f.code === 'DISCREPANCY'), ...findFlags(next.text, next.thresholds)]; next.modality = modality(next.text); }
      app.store.put(next);
      toast('Requirement saved');
      app.render();
    },
  });
}

export function reqAddDialog() {
  const d = data();
  const docs = scoped(d.docs);
  if (!docs.length) { toast('Add a document first: every requirement must cite its source.', true); return; }
  openDialog({
    title: 'Add a requirement by hand', submit: 'Save requirement',
    body: h`<label class="field"><span>Source document</span><select name="doc">${options(docs.map((x) => ({ id: x.id, label: x.country + ': ' + x.title })), app.state.f.doc || docs[0].id)}</select></label>
      <div class="grid2"><label class="field"><span>Article or clause <span class="hint">kept as text, for example 5.10</span></span><input type="text" name="Clause" autocomplete="off"></label>
        <label class="field"><span>Paragraph</span><input type="text" name="Paragraph" autocomplete="off"></label></div>
      <label class="field"><span>Requirement text <span class="hint">copy it exactly from the source</span></span><textarea name="text" rows="5"></textarea></label>`,
    onSubmit: (fd) => {
      const doc = d.docById.get(String(fd.get('doc')));
      const text = String(fd.get('text') || '').trim();
      if (!text) throw new InputError('Requirement text is required. Copy the clause from the source document.', 'text');
      const thresholds = findThresholds(text);
      const base = { id: uid('req'), t: 'req', code: nextCode(doc.country, d.reqs)(1), docId: doc.id, country: doc.country, cite: { clause: '', para: '', heading: '', section: '', page: null, line: 0, lineEnd: 0 }, text, ctx: '', modality: modality(text), cat: categorise(text), rel: relevance(text), thresholds, flags: findFlags(text, thresholds), checks: [], seq: 0 };
      const rec = editReq(base, { clause: fd.get('Clause'), para: fd.get('Paragraph') });
      rec.key = hash32(squash(text) + '|' + rec.cite.clause + '|' + rec.cite.para);
      app.store.put(rec);
      toast('Requirement ' + rec.code + ' saved');
      app.render();
    },
  });
}

// ---------- Compliance ----------

export function capDialog(id) {
  const d = data();
  const c = id ? app.store.get(id) : null;
  openDialog({
    title: c ? 'Edit capability' : 'Add a turbine capability', submit: 'Save',
    extra: c ? h`<button type="button" class="btn" id="cap-del">Delete</button>` : undefined,
    body: h`<label class="field"><span>Parameter</span><input type="text" name="Parameter" value="${c?.key || ''}" list="dl-hints" autocomplete="off"><datalist id="dl-hints">${CAPABILITY_HINTS.map(([k]) => h`<option value="${k}">`)}</datalist></label>
      <div class="grid2"><label class="field"><span>Value <span class="hint">for yes/no type yes or no</span></span><input type="text" name="Value" inputmode="decimal" value="${c ? capValue(c) : ''}" autocomplete="off"></label>
        <label class="field"><span>Unit</span><select name="unit">${options(UNIT_OPTS, c ? c.unit : 'Hz')}</select></label></div>
      <label class="field"><span>Evidence <span class="hint">test report, certificate or data sheet, with section</span></span><textarea name="evidence" rows="2">${c?.evidence || ''}</textarea></label>
      <p class="small muted">Record only what is proven. A capability without evidence is flagged on every requirement that uses it.</p>`,
    onOpen: (dlg) => {
      const key = dlg.querySelector('input[name="Parameter"]'), unit = dlg.querySelector('select[name="unit"]');
      key.addEventListener('change', () => { const hint = CAPABILITY_HINTS.find(([k]) => k === key.value); if (hint && !c) unit.value = hint[1]; });
      const del = $('#cap-del', dlg);
      if (del) del.addEventListener('click', async () => {
        if (await confirmDialog({ title: 'Delete this capability?', danger: true, confirm: 'Delete', text: 'Checks that read "' + c.key + '" will show no data until a value is recorded again.' })) { app.store.remove(c.id); dlg.close(); toast('Capability deleted'); app.render(); }
      });
    },
    onSubmit: (fd) => {
      const rec = makeCap({ key: fd.get('Parameter'), value: fd.get('Value'), unit: fd.get('unit'), evidence: fd.get('evidence') }, c);
      const clash = d.caps.find((x) => x.id !== rec.id && x.key.toLowerCase() === rec.key.toLowerCase());
      if (clash) throw new InputError('"' + rec.key + '" is already recorded. Edit that entry instead of adding a second one.', 'Parameter');
      app.store.put(rec);
      toast('Capability saved');
      app.render();
    },
  });
}

export function viewCompliance() {
  const d = data();
  const reqs = scoped(d.reqs);
  const used = new Map();
  for (const r of d.reqs) for (const c of r.checks || []) { const k = c.cap.toLowerCase(); used.set(k, (used.get(k) || 0) + 1); }
  const caps = stableSort(d.caps, (a, b) => cmpNatural(a.key, b.key));
  const counts = new Map(STATUSES.map((s) => [s.id, 0]));
  for (const r of reqs) counts.set(d.results.get(r.id).status, counts.get(d.results.get(r.id).status) + 1);
  const conflicts = findConflicts(reqs);
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const link = (r) => h`<button type="button" class="linkish" data-act="req-open" data-id="${r.id}">${r.code}</button>`;
  const blockers = sortReqs(reqs.filter((r) => { const ev = d.results.get(r.id); return ev.status === 'NON_COMPLIANT' || ev.status === 'PARTIAL'; }), d.docById);
  const flagged = sortReqs(reqs.filter((r) => (r.flags || []).some((f) => ['FIGURE', 'SITE', 'PENDING', 'VAGUE', 'DISCREPANCY', 'NUMBER', 'IMAGE'].includes(f.code))), d.docById);
  const ready = reqs.filter((r) => (r.thresholds || []).length && !(r.checks || []).length && !r.manual?.status);
  return h`<section class="view">
    <div class="head"><h1>Compliance</h1><span class="muted">${app.state.country || 'All countries'}</span></div>
    <p class="lead">A determination is made only from the capability values and evidence recorded here. Where data is missing the result is insufficient data; compliance is never assumed.</p>
    <div class="tiles">${STATUSES.map((s) => h`<div class="tile"><div class="k">${s.label}</div><div class="v">${counts.get(s.id)}</div></div>`)}</div>
    <div class="head"><h2>Turbine capability</h2><button type="button" class="btn primary" data-act="cap-add">Add a capability</button></div>
    ${!caps.length ? h`<div class="empty"><p>No capability values yet. Add what the turbine is proven to do, for example <i>RoCoF withstand 2.5 Hz/s</i> with the test report as evidence, or import a CSV on the Data tab.</p></div>` : h`
    <div class="table-wrap"><table class="resp"><thead><tr><th>Parameter</th><th class="num">Value</th><th>Unit</th><th>Evidence</th><th class="num">Used by checks</th></tr></thead>
      <tbody>${caps.map((c) => h`<tr><td data-l="Parameter"><button type="button" class="linkish" data-act="cap-open" data-id="${c.id}">${c.key}</button></td>
        <td data-l="Value" class="num">${capValue(c)}</td><td data-l="Unit">${unitLabel(c.unit)}</td>
        <td data-l="Evidence">${c.evidence || h`<span class="chip warn">No evidence</span>`}</td><td data-l="Used by checks" class="num">${used.get(c.key.toLowerCase()) || 0}</td></tr>`)}</tbody></table></div>`}
    <h2>Not met or partly met</h2>
    ${blockers.length ? h`<div class="table-wrap"><table class="resp"><thead><tr><th>Code</th><th>Source</th><th>Determination</th><th>Reason</th></tr></thead><tbody>${blockers.map((r) => { const ev = d.results.get(r.id); return h`<tr><td data-l="Code">${link(r)}</td><td data-l="Source">${citeLabel(r.cite)}</td><td data-l="Determination">${stPill(ev.status)}</td>
      <td data-l="Reason">${ev.details.filter((x) => x.result !== 'pass').map((x) => x.check.cap + ' ' + x.check.cmp + ' ' + x.check.value + ' ' + (x.check.unit === 'bool' ? '' : x.check.unit) + (x.result === 'fail' ? ' (recorded ' + x.capValue + ' ' + (x.capUnit === 'bool' ? '' : x.capUnit) + ')' : ' (no data)')).join('; ') || r.manual?.evidence || ''}</td></tr>`; })}</tbody></table></div>`
      : h`<p class="muted">None on the recorded data.</p>`}
    <h2>Discrepancies between documents</h2>
    ${conflicts.length ? h`<ul class="list">${conflicts.map((c) => h`<li><span class="chip warn">${c.band}</span><span>${link(byId.get(c.a))} states ${c.va}; ${link(byId.get(c.b))} states ${c.vb}.</span></li>`)}</ul>` : h`<p class="muted">No band is quoted with different values in two stored documents.</p>`}
    <h2>Open findings that can block approval</h2>
    ${flagged.length ? h`<div class="table-wrap"><table class="resp"><thead><tr><th>Code</th><th>Source</th><th>Finding</th></tr></thead><tbody>${flagged.slice(0, 200).map((r) => h`<tr><td data-l="Code">${link(r)}</td><td data-l="Source">${citeLabel(r.cite)}</td><td data-l="Finding">${r.flags.map((f) => f.msg).join(' ')}</td></tr>`)}</tbody></table></div>${flagged.length > 200 ? h`<p class="small muted">${flagged.length - 200} more in the report.</p>` : ''}`
      : h`<p class="muted">No open findings.</p>`}
    ${ready.length ? h`<p class="note">${ready.length} requirement${ready.length === 1 ? ' has' : 's have'} numeric thresholds but no check yet. Open them on the Requirements tab and add checks to get a computed determination.</p>` : ''}
  </section>`;
}
