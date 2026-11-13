// Documents: register, reader with line numbers, add/edit, translate and extract.
import { h, $, openDialog, confirmDialog, toast, options, errText } from './ui.js';
import { app, data, scoped, refYear, dateText, periodText } from './ctx.js';
import { emptyStart } from './views-a.js';
import { DOC_KINDS, DOC_KIND_BY_ID, DOC_STATUS, COUNTRY_CHECKLIST, CATEGORY_BY_ID } from '../core/catalog.js';
import { makeDoc, reqFromItem, nextCode, reqDupKey } from '../core/model.js';
import { analyse, citeLabel, guessLanguage, LANG_NAMES } from '../core/extract.js';
import { stableSort, cmpNatural, InputError } from '../core/util.js';
import { toISO, todayIST } from '../core/dates.js';
import { readDocFile } from './files.js';
import { translatorAvailable, translateText, SOURCE_LANGS } from './translate.js';
import { REL_LABEL } from '../core/report.js';

const kindLabel = (k) => DOC_KIND_BY_ID.get(k)?.label || k;
const statusLabel = (s) => DOC_STATUS.find((x) => x.id === s)?.label || s;
const lineCount = (t) => (t ? t.split('\n').length : 0);
const WINDOW = 400; // lines rendered at a time, so a 5,000-line code opens instantly

export function viewDocs() {
  const d = data();
  if (app.state.docId && d.docById.has(app.state.docId)) return viewDoc(d.docById.get(app.state.docId));
  const docs = stableSort(scoped(d.docs), (a, b) => cmpNatural(a.country, b.country), (a, b) => (DOC_KIND_BY_ID.get(a.kind)?.order ?? 9) - (DOC_KIND_BY_ID.get(b.kind)?.order ?? 9), (a, b) => (a.published || '').localeCompare(b.published || ''), (a, b) => cmpNatural(a.title, b.title));
  const perDoc = new Map();
  for (const r of d.reqs) perDoc.set(r.docId, (perDoc.get(r.docId) || 0) + 1);
  return h`<section class="view">
    <div class="head"><h1>Documents</h1>
      <button type="button" class="btn" data-act="src-find">Find official documents</button>
      <button type="button" class="btn" data-act="checklist">What to collect</button>
      <button type="button" class="btn primary" data-act="doc-add">Add a document</button></div>
    ${!d.docs.length ? emptyStart('No documents yet') : !docs.length ? h`<div class="empty"><p>No documents for ${app.state.country}. Add one, or pick another country at the top.</p></div>` : h`
    <div class="table-wrap"><table class="resp"><thead><tr><th>Title</th><th>Country</th><th>Type</th><th>Reference</th><th>Published</th><th>Language</th><th>Status</th><th class="num">Lines</th><th class="num">Requirements</th></tr></thead>
    <tbody>${docs.map((x) => h`<tr>
      <td data-l="Title"><button type="button" class="linkish" data-act="doc-open" data-id="${x.id}">${x.title}</button></td>
      <td data-l="Country">${x.country}</td><td data-l="Type">${kindLabel(x.kind)}</td><td data-l="Reference">${x.ref}</td>
      <td data-l="Published" class="nowrap">${dateText(x.published)}</td><td data-l="Language">${x.lang}</td><td data-l="Status">${statusLabel(x.status)}</td>
      <td data-l="Lines" class="num">${x.text ? lineCount(x.text) : 'no text'}</td><td data-l="Requirements" class="num">${perDoc.get(x.id) || 0}</td></tr>`)}</tbody></table></div>`}
  </section>`;
}

function viewDoc(doc) {
  const d = data();
  const nReq = d.reqs.filter((r) => r.docId === doc.id).length;
  // After a translation both versions are kept line for line, so either can be read at the same line numbers.
  const showOrig = !!(app.state.docOrig && doc.orig);
  const body = showOrig ? doc.orig : doc.text;
  const lines = body ? body.replace(/\f/g, '').split('\n') : [];
  const from = Math.max(1, Math.min(app.state.docFrom, Math.max(1, lines.length - WINDOW + 1)));
  const to = Math.min(lines.length, from + WINDOW - 1);
  const hit = app.state.docLine, hitEnd = app.state.docLineEnd || hit;
  const lang = doc.text ? guessLanguage(doc.text) : { lang: '' };
  return h`<section class="view">
    <div class="head"><h1>${doc.title}</h1><button type="button" class="btn" data-act="doc-close">All documents</button></div>
    <div class="card"><dl class="meta">
      <dt>Country</dt><dd>${doc.country}</dd><dt>Type</dt><dd>${kindLabel(doc.kind)}</dd>
      ${doc.issuer ? h`<dt>Issuer</dt><dd>${doc.issuer}</dd>` : ''}${doc.ref ? h`<dt>Reference</dt><dd>${doc.ref}</dd>` : ''}
      ${doc.published ? h`<dt>Published</dt><dd>${dateText(doc.published)} <span class="muted">${periodText(doc.published)}</span></dd>` : ''}
      ${doc.version ? h`<dt>Version</dt><dd>${doc.version}</dd>` : ''}${doc.lang ? h`<dt>Language</dt><dd>${doc.lang}</dd>` : ''}
      <dt>Status</dt><dd>${statusLabel(doc.status)}</dd>
      ${doc.url ? h`<dt>Source link</dt><dd><a href="${doc.url}" target="_blank" rel="noopener noreferrer">${doc.url}</a></dd>` : ''}
      <dt>Requirements saved</dt><dd>${nReq}</dd>${doc.notes ? h`<dt>Notes</dt><dd>${doc.notes}</dd>` : ''}</dl>
      <div class="row"><button type="button" class="btn primary" data-act="doc-extract" data-id="${doc.id}" ${doc.text ? '' : h`disabled`}>Extract requirements</button>
        <button type="button" class="btn" data-act="doc-translate" data-id="${doc.id}" ${doc.text ? '' : h`disabled`}>Translate to English</button>
        <button type="button" class="btn" data-act="doc-edit" data-id="${doc.id}">Edit</button>
        <button type="button" class="btn" data-act="doc-delete" data-id="${doc.id}">Delete</button></div>
      ${lang.lang && lang.lang !== 'en' ? h`<p class="note warn">This text looks like ${LANG_NAMES[lang.lang]}. Translate it to English before extracting; the rules read English wording best.</p>` : ''}
    </div>
    ${!lines.length ? h`<div class="empty"><p>This document has no text yet. Choose Edit, then pick the file or paste the text.</p></div>` : h`
    <div class="row"><h2>Text</h2><span class="muted small">Lines ${from} to ${to} of ${lines.length}${doc.orig ? (showOrig ? ' (original text)' : ' (English translation)') : ''}</span>
      <span class="row no-print">${doc.orig ? h`<button type="button" class="btn sm" data-act="doc-orig">${showOrig ? 'Show English' : 'Show original'}</button>` : ''}<button type="button" class="btn sm" data-act="doc-page" data-from="${Math.max(1, from - WINDOW)}" ${from > 1 ? '' : h`disabled`}>Earlier lines</button>
      <button type="button" class="btn sm" data-act="doc-page" data-from="${from + WINDOW}" ${to < lines.length ? '' : h`disabled`}>Later lines</button>
      <label class="row"><span class="sr">Go to line</span><input type="text" inputmode="numeric" id="goto-line" placeholder="Go to line" size="9" aria-label="Go to line"></label></span></div>
    <div class="doctext" id="doctext" tabindex="0" aria-label="Document text with line numbers">${lines.slice(from - 1, to).map((ln, i) => {
      const n = from + i;
      return h`<div class="ln${hit && n >= hit && n <= hitEnd ? ' hit' : ''}" id="L${n}"><span>${n}</span><span>${ln}</span></div>`;
    })}</div>`}
  </section>`;
}

export function openDocAt(docId, line, lineEnd) {
  Object.assign(app.state, { tab: 'docs', docId, docLine: line || 0, docLineEnd: lineEnd || line || 0, docFrom: Math.max(1, (line || 1) - 20) });
  location.hash = '#docs';
  app.render();
  if (line) requestAnimationFrame(() => { const el = document.getElementById('L' + line); if (el) el.scrollIntoView({ block: 'center' }); });
}

function docForm(doc, countries) {
  const v = doc || { country: app.state.country || '', kind: 'tso', status: 'in_force' };
  return h`
    <div class="grid2">
      <label class="field"><span>Country</span><input type="text" name="Country" value="${v.country || ''}" list="dl-countries" autocomplete="off" required><datalist id="dl-countries">${countries.map((c) => h`<option value="${c}">`)}</datalist></label>
      <label class="field"><span>Document type</span><select name="kind">${options(DOC_KINDS, v.kind)}</select></label>
      <label class="field span2"><span>Title</span><input type="text" name="Title" value="${v.title || ''}" autocomplete="off" required></label>
      <label class="field"><span>Issuer <span class="hint">operator, regulator or body</span></span><input type="text" name="Issuer" value="${v.issuer || ''}" autocomplete="off"></label>
      <label class="field"><span>Official reference <span class="hint">kept as text, for example NN 10/2024</span></span><input type="text" name="Reference" value="${v.ref || ''}" autocomplete="off"></label>
      <label class="field"><span>Published <span class="hint">day first, 28/10/2024</span></span><input type="text" name="date" inputmode="numeric" value="${dateText(v.published)}" autocomplete="off" placeholder="dd/mm/yyyy"></label>
      <label class="field"><span>Version</span><input type="text" name="Version" value="${v.version || ''}" autocomplete="off"></label>
      <label class="field"><span>Language</span><input type="text" name="Language" value="${v.lang || ''}" autocomplete="off" placeholder="English"></label>
      <label class="field"><span>Status</span><select name="status">${options(DOC_STATUS, v.status)}</select></label>
      <label class="field span2"><span>Source link <span class="hint">optional, https://…</span></span><input type="url" name="url" inputmode="url" value="${v.url || ''}" autocomplete="off"></label>
    </div>
    <label class="field"><span>File <span class="hint">.docx, .pdf or .txt; read on this device, never uploaded</span></span><input type="file" name="file" accept=".docx,.pdf,.txt,.md,.html,.htm"></label>
    <p class="small muted" id="file-info" aria-live="polite"></p>
    <label class="field"><span>Text <span class="hint">filled from the file, or paste here</span></span><textarea name="text" rows="7" spellcheck="false">${v.text || ''}</textarea></label>
    <label class="field"><span>Notes</span><textarea name="notes" rows="2">${v.notes || ''}</textarea></label>`;
}

export function docDialog(doc) {
  const d = data();
  let origFromFile = null;
  openDialog({
    title: doc ? 'Edit document' : 'Add a document', wide: true, submit: doc ? 'Save changes' : 'Save document',
    body: docForm(doc, d.countries),
    onOpen: (dlg) => {
      const file = $('input[type="file"]', dlg);
      file.addEventListener('change', async () => {
        const f = file.files[0];
        const info = $('#file-info', dlg);
        if (!f) return;
        info.textContent = 'Reading ' + f.name + '…';
        try {
          const r = await readDocFile(f);
          dlg.querySelector('textarea[name="text"]').value = r.text;
          origFromFile = r;
          const title = dlg.querySelector('input[name="Title"]');
          if (!title.value) title.value = r.name;
          const lang = dlg.querySelector('input[name="Language"]');
          if (!lang.value && r.lang) lang.value = LANG_NAMES[r.lang];
          info.textContent = r.info + (r.warn ? '. ' + r.warn : '');
          info.className = 'small ' + (r.warn ? 'note warn' : 'muted');
        } catch (e) {
          file.value = '';
          info.textContent = '';
          dlg.fail(e instanceof InputError ? e : new InputError('The file could not be read: ' + (e.message || e) + '. Try the .docx or .txt version, or paste the text.', 'file'));
        }
      });
      if (!doc) file.focus();
    },
    onSubmit: (fd) => {
      const text = String(fd.get('text') || '').replace(/\r\n?/g, '\n');
      const rec = makeDoc({
        country: fd.get('Country'), title: fd.get('Title'), kind: fd.get('kind'), issuer: fd.get('Issuer'), ref: fd.get('Reference'),
        published: fd.get('date'), version: fd.get('Version'), lang: fd.get('Language'), status: fd.get('status'), url: fd.get('url'), notes: fd.get('notes'),
        text, orig: doc && text === doc.text ? doc.orig : '', added: doc?.added || toISO(todayIST(app.now())),
      }, { refYear: refYear(), prev: doc });
      const saved = app.store.put(rec);
      toast(doc ? 'Document saved' : 'Document added');
      if (!doc) { app.state.docId = saved.id; app.state.docFrom = 1; app.state.docLine = 0; app.state.tab = 'docs'; if (location.hash !== '#docs') location.hash = '#docs'; }
      app.render();
    },
  });
}

export function checklistDialog() {
  const d = data();
  const country = app.state.country;
  const have = new Set(scoped(d.docs).map((x) => x.kind));
  openDialog({
    title: 'What to collect' + (country ? ' for ' + country : ''), cancel: 'Close',
    body: h`<p>These are the kinds of document that together define the grid connection requirements of a country. The app works offline and cannot search the web, so find them at the transmission operator, the regulator and the official gazette, then add them here.</p>
      ${country ? '' : h`<p class="note">Pick a country at the top to see which kinds are already stored for it.</p>`}
      <ul class="list">${COUNTRY_CHECKLIST.map((c) => h`<li><span class="chip${country && !have.has(c.kind) ? ' warn' : ''}">${country ? (have.has(c.kind) ? 'Stored' : 'Missing') : kindLabel(c.kind)}</span><span><b>${kindLabel(c.kind)}.</b> ${c.what}</span></li>`)}</ul>`,
  });
}

export async function deleteDoc(id) {
  const d = data();
  const doc = d.docById.get(id);
  if (!doc) return;
  const reqs = d.reqs.filter((r) => r.docId === id);
  const ok = await confirmDialog({ title: 'Delete this document?', danger: true, confirm: 'Delete', text: '"' + doc.title + '" and its ' + reqs.length + ' saved requirements will be removed from this device and, through sync, from your other devices. This cannot be undone except from a backup.' });
  if (!ok) return;
  app.store.removeMany([id, ...reqs.map((r) => r.id)]);
  app.state.docId = '';
  toast('Document deleted');
  app.render();
}

const MOD_LABEL = { mandatory: 'Mandatory', recommended: 'Recommended', permitted: 'Permitted', info: 'Informative' };

export function extractDialog(id) {
  const d = data();
  const doc = d.docById.get(id);
  if (!doc || !doc.text) return;
  const t0 = performance.now();
  const res = analyse(doc.text);
  const ms = Math.round(performance.now() - t0);
  const existing = new Set(d.reqs.map(reqDupKey));
  const isDup = (it) => existing.has(doc.id + '|' + it.key);
  const view = { reqOnly: true, relOnly: true, limit: 300 };
  // The selection lives in a Set, not in the DOM, so only the first rows need to be drawn.
  // Before this, a 20,000-line document drew 4,200 rows at once (see docs/VERIFICATION.md).
  const picked = new Set(res.items.filter((it) => !isDup(it)).map((it) => it.seq));
  const visible = () => res.items.filter((it) => (!view.reqOnly || it.isReq) && (!view.relOnly || it.rel !== 'other'));
  const row = (it) => h`<label class="cand"><input type="checkbox" name="pick" value="${it.seq}" ${isDup(it) ? h`disabled` : picked.has(it.seq) ? h`checked` : ''} aria-label="Select ${citeLabel(it.cite)}">
    <span><span class="meta-line"><b>${citeLabel(it.cite)}</b>${it.cite.heading ? h`<span>${it.cite.heading}</span>` : ''}
      <span class="chip">${CATEGORY_BY_ID.get(it.cat).label}</span><span class="chip">${MOD_LABEL[it.modality]}</span><span class="chip">${REL_LABEL[it.rel]}</span>
      ${it.flags.length ? h`<span class="chip warn">${it.flags.length} finding${it.flags.length > 1 ? 's' : ''}</span>` : ''}${isDup(it) ? h`<span class="chip">Already saved</span>` : ''}</span>
      <span class="clamp">${it.text}</span>
      ${it.thresholds.length ? h`<span class="meta-line">${it.thresholds.slice(0, 8).map((t) => h`<span class="chip">${t.raw}</span>`)}</span>` : ''}</span></label>`;
  const chosen = () => visible().filter((it) => picked.has(it.seq) && !isDup(it));
  const countText = () => { const v = visible(); return v.length + ' of ' + res.items.length + ' clauses listed; ' + chosen().length + ' selected to save.'; };
  const list = () => {
    const v = visible();
    return h`<p class="small muted" id="cand-count">${countText()}</p><div class="scroll" id="cand-list">${v.length ? v.slice(0, view.limit).map(row) : h`<p class="empty">Nothing matches. Untick the filters above to see every clause.</p>`}</div>
      ${v.length > view.limit ? h`<div class="row"><button type="button" class="btn sm" id="cand-more">Show 300 more (${v.length - view.limit} not shown, still selected)</button></div>` : ''}`;
  };
  openDialog({
    title: 'Extract requirements', wide: true, submit: 'Save selected requirements',
    body: h`<p>${res.lineCount} lines read in ${ms} ms. Found ${res.items.length} clauses and table rows, ${res.items.filter((i) => i.isReq).length} of them obligations or numeric limits. Review, untick what you do not need, then save. Nothing is saved until you press the button.</p>
      ${res.mode === 'plain' ? h`<p class="note warn">No article or section numbering was recognised, so citations give line numbers only. If the document has numbered clauses, check that the text was read correctly.</p>` : ''}
      <div class="row"><label class="check"><input type="checkbox" id="f-req" checked> Obligations and numeric limits only</label>
        <label class="check"><input type="checkbox" id="f-rel" checked> Relevant to generating plants only</label>
        <button type="button" class="btn sm" id="pick-all">Select all</button><button type="button" class="btn sm" id="pick-none">Select none</button></div>
      <div id="cand-wrap">${list()}</div>`,
    onOpen: (dlg) => {
      const wrap = $('#cand-wrap', dlg);
      const redraw = () => { view.reqOnly = $('#f-req', dlg).checked; view.relOnly = $('#f-rel', dlg).checked; wrap.innerHTML = list().s; };
      $('#f-req', dlg).addEventListener('change', redraw);
      $('#f-rel', dlg).addEventListener('change', redraw);
      $('#pick-all', dlg).addEventListener('click', () => { for (const it of visible()) if (!isDup(it)) picked.add(it.seq); redraw(); });
      $('#pick-none', dlg).addEventListener('click', () => { for (const it of visible()) picked.delete(it.seq); redraw(); });
      wrap.addEventListener('change', (e) => {
        if (e.target.name !== 'pick') return;
        const seq = Number(e.target.value);
        if (e.target.checked) picked.add(seq); else picked.delete(seq);
        $('#cand-count', dlg).textContent = countText();
      });
      wrap.addEventListener('click', (e) => { if (e.target.id === 'cand-more') { view.limit += 300; redraw(); } });
    },
    onSubmit: () => {
      const items = chosen();
      if (!items.length) throw new InputError('No requirement is selected. Tick at least one row, or press Cancel.', 'pick');
      const gen = nextCode(doc.country, d.reqs);
      app.store.putMany(items.map((it, i) => reqFromItem(doc, it, gen(i + 1))));
      toast(items.length + ' requirement' + (items.length > 1 ? 's' : '') + ' saved');
      // The hash change is the single place where the tab switches, so leaving Documents
      // always closes the open document in the same way.
      app.state.f = { ...app.state.f, doc: doc.id, cat: '', status: '', rel: '', q: '' };
      location.hash = '#reqs';
    },
  });
}

export function translateDialog(id) {
  const doc = data().docById.get(id);
  if (!doc || !doc.text) return;
  const guess = guessLanguage(doc.text).lang;
  const token = { cancelled: false };
  if (!translatorAvailable()) {
    openDialog({ title: 'Translate to English', cancel: 'Close', body: h`<p>This browser has no on-device translator. Translation inside the page needs Chrome 138 or later on a desktop computer; it does not work on phones.</p>
      <p>Two ways forward:</p><ul><li>Open AnaGrid in desktop Chrome and translate there. With folder sync the English text reaches your other devices.</li>
      <li>Translate the document with the tool you normally use, then choose Edit and pick the English file or paste the English text.</li></ul>` });
    return;
  }
  openDialog({
    title: 'Translate to English', submit: 'Translate',
    body: h`<p>The text is translated on this device by the browser, line by line, so line numbers stay the same. The original is kept with the document. The first use of a language downloads its model once.</p>
      <label class="field"><span>Source language</span><select name="lang">${options(SOURCE_LANGS.map(([id, label]) => ({ id, label })), guess || 'hr')}</select></label>
      <p class="note warn">Machine translation can change technical meaning. Check numbers, units and negations against the original before relying on a requirement.</p>
      <progress id="tr-prog" max="1" value="0" hidden></progress><p class="small muted" id="tr-msg" aria-live="polite"></p>`,
    onClose: () => { token.cancelled = true; },
    onSubmit: async (fd, dlg) => {
      const prog = $('#tr-prog', dlg), msg = $('#tr-msg', dlg);
      prog.hidden = false;
      const english = await translateText(doc.orig || doc.text, String(fd.get('lang')), (p) => {
        prog.value = p.total ? p.done / p.total : 0;
        msg.textContent = p.phase === 'download' ? 'Downloading the language model: ' + Math.round(p.done * 100) + ' %' : 'Translated ' + p.done + ' of ' + p.total + ' lines';
      }, token);
      app.store.put({ ...doc, orig: doc.orig || doc.text, text: english, lang: (doc.lang || 'Original') + '; English machine translation' });
      toast('Translation saved. The original text is kept.');
      app.render();
    },
  });
}

export { errText };
