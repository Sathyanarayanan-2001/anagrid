// "Find official documents": a dialog that lists the catalogued documents of a country or region
// published on or before the end of a chosen year, with links to the official publisher, and
// adds them to the register. The app cannot download from other sites; the user opens the link.
import { h, $, $$, openDialog, toast } from './ui.js';
import { app, data, refYear } from './ctx.js';
import { CATALOG, CATALOG_REVIEWED } from '../sources/catalog.js';
import { resolveYear, resolvePlace, findSources, placeNames, dateLabel, toRegisterInput, STATE_LABEL } from '../core/sourcing.js';
import { DOC_KIND_BY_ID } from '../core/catalog.js';
import { makeDoc } from '../core/model.js';
import { InputError } from '../core/util.js';
import { fmtDayFirst, todayIST, toISO } from '../core/dates.js';

const kindLabel = (k) => DOC_KIND_BY_ID.get(k)?.label || k;
const regKey = (country, ref, title) => (country + '|' + ref + '|' + title).toLowerCase();

/** Set of (country, reference, title) keys already in the register, so nothing is added twice. */
function registered() {
  return new Set(data().docs.map((d) => regKey(d.country, d.ref, d.title)));
}

function resultsHtml(found) {
  const { place, cutoff, year, result } = found;
  const have = registered();
  const left = result.docs.filter((d) => !have.has(regKey(place.name, d.ref, d.title))).length;
  const stateCell = (d) => d.state === 'superseded'
    ? h`<span class="st INSUFFICIENT">Superseded</span><div class="small muted">by ${d.by}</div>`
    : h`<span class="st ${d.state === 'current' ? 'COMPLIANT' : 'PARTIAL'}">${STATE_LABEL[d.state]}</span>`;
  return h`
    ${year.note ? h`<p class="note warn">${year.note}</p>` : ''}
    <h3>${place.name}: documents published up to ${fmtDayFirst(cutoff)}</h3>
    ${!result.hasOwnDocs ? h`<p class="note">No document entries for ${place.name} yet. The official sites below are where its grid code is published; <i>What to collect</i> on the Documents tab lists the document types to look for.${result.docs.length ? ' Regional documents that apply are listed.' : ''}</p>` : ''}
    ${result.docs.length ? h`
      <div class="row"><span class="small muted">${result.docs.length} document${result.docs.length === 1 ? '' : 's'}${result.later ? '; ' + result.later + ' later document' + (result.later === 1 ? ' is' : 's are') + ' hidden by the cut-off' : ''}.</span>
        <button type="button" class="btn sm" id="src-add-all" ${left ? '' : h`disabled`}>Add all${left && left < result.docs.length ? ' (' + left + ' left)' : ''}</button></div>
      <div class="table-wrap"><table class="resp"><thead><tr><th>Document</th><th>Reference</th><th>Type</th><th>Published</th><th>State at cut-off</th><th>Language</th><th></th></tr></thead>
      <tbody>${result.docs.map((d, i) => h`<tr>
        <td data-l="Document"><a href="${d.url}" target="_blank" rel="noopener noreferrer">${d.title}</a>${d.scope !== place.code ? h` <span class="chip">${d.scope === 'EU' ? 'EU' : 'Regional'}</span>` : ''}${d.note ? h`<div class="small muted">${d.note}</div>` : ''}${d.direct === false ? h`<div class="small muted">Link opens the publisher's site; find the document there.</div>` : ''}</td>
        <td data-l="Reference">${d.ref}</td><td data-l="Type">${kindLabel(d.kind)}</td>
        <td data-l="Published">${dateLabel(d.date)}${d.dateKind ? h`<div class="small muted">${d.dateKind}</div>` : ''}</td>
        <td data-l="State at cut-off">${stateCell(d)}</td><td data-l="Language">${d.lang}</td>
        <td>${have.has(regKey(place.name, d.ref, d.title)) ? h`<span class="chip">In the register</span>` : h`<button type="button" class="btn sm" data-src-add="${i}">Add</button>`}</td></tr>`)}</tbody></table></div>`
      : h`<div class="empty"><p>No catalogued document for ${place.name} was published on or before ${fmtDayFirst(cutoff)}. Try a later year, or look at the official sites below.</p></div>`}
    <h3>Official sites</h3>
    <ul class="list">${result.bodies.map((b) => h`<li><span class="chip">${b.role}</span><span><b>${b.name}.</b> <a href="${b.url}" target="_blank" rel="noopener noreferrer">${b.url}</a></span></li>`)}</ul>
    <p class="small muted">Catalogue last reviewed against the official sites on ${fmtDayFirst({ y: +CATALOG_REVIEWED.slice(0, 4), m: +CATALOG_REVIEWED.slice(5, 7), d: +CATALOG_REVIEWED.slice(8, 10) })}. A publisher may move a file; the official site is then the place to look.</p>`;
}

function addOne(found, d) {
  const { place, cutoff } = found;
  if (registered().has(regKey(place.name, d.ref, d.title))) return false;
  app.store.put(makeDoc({ ...toRegisterInput(d, place, cutoff), added: toISO(todayIST(app.now())) }, { refYear: refYear() }));
  return true;
}

export function sourceDialog() {
  let found = null;
  const today = todayIST(app.now());
  openDialog({
    title: 'Find official documents', wide: true, submit: 'Find', cancel: 'Close',
    body: h`<p>Type a country or region and the year of the study. The catalogue lists the official documents published on or before the end of that year, with their state at that date and a link to the publisher. The current year runs to today; a future year is treated as today.</p>
      <div class="grid2">
        <label class="field"><span>Country or region</span><input type="text" name="place" value="${app.state.country || ''}" list="dl-places" autocomplete="off" placeholder="Croatia"><datalist id="dl-places">${placeNames(CATALOG).map((n) => h`<option value="${n}">`)}</datalist></label>
        <label class="field"><span>Year <span class="hint">four digits</span></span><input type="text" name="year" inputmode="numeric" value="${today.y}" autocomplete="off" placeholder="${today.y}"></label>
      </div>
      <div id="src-results"></div>`,
    onOpen: (dlg) => {
      dlg.querySelector('input[name="place"]').focus();
      $('#src-results', dlg).addEventListener('click', (e) => {
        const add = e.target.closest('[data-src-add]');
        const all = e.target.closest('#src-add-all');
        if (!found || (!add && !all)) return;
        let n = 0;
        if (add) { if (addOne(found, found.result.docs[Number(add.dataset.srcAdd)])) n = 1; }
        else for (const d of found.result.docs) if (addOne(found, d)) n++;
        // The register now shows this country, so the user lands on its documents when the dialog closes.
        app.state.country = found.place.name;
        toast(n ? n + ' document' + (n === 1 ? '' : 's') + ' added to the register without text. Open the link, save the file, then choose it with Edit.' : 'Already in the register');
        app.render(); // refreshes the register behind the dialog and the cached record lists
        $('#src-results', dlg).innerHTML = resultsHtml(found).s;
      });
    },
    onSubmit: (fd, dlg) => {
      const placeText = String(fd.get('place') || '').trim();
      if (!placeText) throw new InputError('Type a country or region, for example Croatia or EU.', 'place');
      const place = resolvePlace(placeText, CATALOG);
      if (!place) throw new InputError('"' + placeText + '" is not in the source catalogue yet. Covered: ' + placeNames(CATALOG).join(', ') + '. For another country, add its documents by hand on the Documents tab; What to collect lists the document types.', 'place');
      const year = resolveYear(fd.get('year'), today);
      found = { place, year, cutoff: year.cutoff, result: findSources(place, year.cutoff, CATALOG) };
      $('.form-error', dlg).textContent = '';
      $$('[aria-invalid]', dlg).forEach((el) => el.removeAttribute('aria-invalid'));
      $('#src-results', dlg).innerHTML = resultsHtml(found).s;
      return false; // stay open so documents can be added
    },
  });
}
