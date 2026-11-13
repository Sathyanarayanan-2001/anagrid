// Report tab and Data tab (sync, backup, CSV import and export, worked example, erase).
import { h, $, openDialog, confirmDialog, toast, download, raw, options } from './ui.js';
import { app, data, VERSION, refYear } from './ctx.js';
import { emptyStart } from './views-a.js';
import { buildReport, reportToMarkdown, reportToHTML, reportBody } from '../core/report.js';
import { planReqImport, planCapImport, reqsToCSV, capsToCSV, makeBackup, readBackup } from '../core/transfer.js';
import { fmtStamp, toISO, todayIST } from '../core/dates.js';
import { InputError } from '../core/util.js';
import { buildSample, isSample, SAMPLE_SIZE } from './sample.js';
import { canPickFolder } from './fsdir.js';

const stamp = () => toISO(todayIST(app.now()));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all';

function currentReport() {
  const d = data();
  const country = app.state.country || d.countries[0];
  return buildReport({ docs: d.docs, reqs: d.reqs, caps: d.caps, country, now: app.now(), version: VERSION });
}

export function viewReport() {
  const d = data();
  if (!d.docs.length) return h`<section class="view"><div class="head"><h1>Report</h1></div>${emptyStart('No report yet')}</section>`;
  const rep = currentReport();
  return h`<section class="view">
    <div class="head no-print"><h1>Requirements document</h1>
      <button type="button" class="btn primary" data-act="rep-html">Download HTML</button><button type="button" class="btn" data-act="rep-md">Download Markdown</button>
      <button type="button" class="btn" data-act="rep-csv">Download CSV</button><button type="button" class="btn" data-act="print">Print</button></div>
    ${app.state.country ? '' : h`<p class="note no-print">Showing ${rep.country}. Pick a country at the top to change it; one report covers one country.</p>`}
    ${rep.rows.length ? '' : h`<p class="note warn no-print">No requirements are saved for ${rep.country} yet. Open its documents and choose Extract requirements.</p>`}
    <article class="report">${raw(reportBody(rep))}</article>
  </section>`;
}

export const reportActions = {
  'rep-html': () => { const r = currentReport(); download('anagrid-requirements-' + slug(r.country) + '-' + stamp() + '.html', reportToHTML(r), 'text/html;charset=utf-8'); },
  'rep-md': () => { const r = currentReport(); download('anagrid-requirements-' + slug(r.country) + '-' + stamp() + '.md', reportToMarkdown(r), 'text/markdown;charset=utf-8'); },
  'rep-csv': () => {
    const d = data(); const c = app.state.country || d.countries[0];
    download('anagrid-requirements-' + slug(c) + '-' + stamp() + '.csv', reqsToCSV(d.reqs.filter((r) => r.country === c), d.docs, d.caps), 'text/csv;charset=utf-8');
  },
  print: () => window.print(),
};

const SYNC_HELP = {
  saved: 'Everything is saved.', saving: 'Writing the save file now.', waiting: 'Changes will be written in about 3 seconds.',
  access: 'The browser needs your permission to use the sync folder again. Press Reconnect folder.',
  problem: 'The last sync attempt failed. Your data is safe on this device. Check that the folder still exists and that OneDrive is running, then press Sync now.',
};

export function viewData() {
  const d = data();
  const s = app.sync;
  const hasSample = d.docs.some(isSample);
  const plan = app.state.plan;
  return h`<section class="view">
    <div class="head"><h1>Data</h1></div>
    <div class="card"><h2>Sync between devices</h2>
      <p><b>${s.detail}</b>. ${s.dir ? SYNC_HELP[s.state] || '' : 'Data is stored in this browser only. Choose a folder inside OneDrive to keep your devices in step.'}</p>
      ${canPickFolder() ? h`<div class="row">
        ${s.state === 'access' ? h`<button type="button" class="btn primary" data-act="sync-reconnect">Reconnect folder</button>` : ''}
        <button type="button" class="btn${s.dir || s.state === 'access' ? '' : ' primary'}" data-act="sync-pick">${s.dir || s.state === 'access' ? 'Change folder' : 'Choose sync folder'}</button>
        ${s.dir ? h`<button type="button" class="btn" data-act="sync-now">Sync now</button><button type="button" class="btn" data-act="sync-off">Stop syncing</button>` : ''}</div>
        ${app.state.folderName ? h`<p class="small muted">Folder: ${app.state.folderName}. Each session writes one file named anagrid-save-….json.gz and keeps its newest three.</p>` : ''}`
        : h`<p class="note">Folder sync needs Chrome or Edge on a computer. On this browser, move data with Export backup and Import backup below.</p>`}
    </div>
    <div class="card"><h2>Backup</h2><p>A backup holds every document, requirement and capability, including deletions. Importing merges record by record; the newer version of each record wins.</p>
      <div class="row"><button type="button" class="btn" data-act="backup-export">Export backup</button>
        <label class="btn">Import backup<input type="file" class="sr" accept=".json,application/json" data-file="backup"></label></div></div>
    <div class="card"><h2>CSV</h2><p>Requirements and capability values can be exchanged with a spreadsheet. On import the header row is found below any title lines, columns are matched by name, and each row is checked. Nothing is saved until you press Import.</p>
      <div class="row"><label class="btn">Import requirements<input type="file" class="sr" accept=".csv,text/csv" data-file="req-csv"></label>
        <label class="btn">Import capabilities<input type="file" class="sr" accept=".csv,text/csv" data-file="cap-csv"></label>
        <button type="button" class="btn" data-act="csv-reqs" ${d.reqs.length ? '' : h`disabled`}>Export requirements</button>
        <button type="button" class="btn" data-act="csv-caps" ${d.caps.length ? '' : h`disabled`}>Export capabilities</button></div>
      <p class="small muted">Requirement columns: document, clause, paragraph, heading, page, line, category, requirement, status, evidence, cost, due, action. Capability columns: parameter, value, unit, evidence.</p>
      ${plan ? planPreview(plan) : ''}</div>
    <div class="card"><h2>Worked example</h2><p>Croatia, transmission-connected wind power plant: ${SAMPLE_SIZE.docs} documents and ${SAMPLE_SIZE.reqs} condensed requirements with article and table-row citations, plus ${SAMPLE_SIZE.caps} invented turbine values that demonstrate each determination.</p>
      <div class="row">${hasSample ? h`<button type="button" class="btn" data-act="sample-remove">Remove worked example</button>` : h`<button type="button" class="btn" data-act="sample-load">Load worked example</button>`}</div></div>
    <div class="card"><h2>Erase</h2><p>Removes every document, requirement and capability. With a sync folder connected, the deletion also reaches your other devices at their next sync. Backups you exported are not touched.</p>
      <div class="row"><button type="button" class="btn danger" data-act="erase">Erase all data on this device</button></div></div>
  </section>`;
}

function planPreview(plan) {
  const bad = plan.rows.filter((r) => r.status === 'error').length, dup = plan.rows.filter((r) => r.status === 'duplicate').length;
  const label = { ok: 'Ready', error: 'Problem', duplicate: 'Skipped' };
  return h`<div id="plan"><h3>Preview: ${plan.name}</h3>
    <p>Header found on line ${plan.headerIndex + 1}. ${plan.okCount} row${plan.okCount === 1 ? '' : 's'} ready, ${bad} with problems, ${dup} skipped. Rows with problems are not imported; fix them in the file and choose it again.</p>
    <div class="table-wrap scroll"><table class="resp"><thead><tr><th>Line</th><th>Status</th><th>${plan.kind === 'req' ? 'Document' : 'Parameter'}</th><th>${plan.kind === 'req' ? 'Clause' : 'Value'}</th><th>${plan.kind === 'req' ? 'Requirement' : 'Unit'}</th><th>Note</th></tr></thead>
      <tbody>${plan.rows.slice(0, 300).map((r) => h`<tr><td data-l="Line" class="num">${r.n}</td><td data-l="Status"><span class="chip${r.status === 'ok' ? '' : ' warn'}">${label[r.status]}</span></td>
        <td data-l="${plan.kind === 'req' ? 'Document' : 'Parameter'}">${plan.kind === 'req' ? r.cells.document : r.cells.parameter}</td><td data-l="${plan.kind === 'req' ? 'Clause' : 'Value'}">${plan.kind === 'req' ? r.cells.clause : r.cells.value}</td>
        <td data-l="${plan.kind === 'req' ? 'Requirement' : 'Unit'}"><span class="clamp">${plan.kind === 'req' ? r.cells.requirement : r.cells.unit}</span></td><td data-l="Note">${r.msg}</td></tr>`)}</tbody></table></div>
    ${plan.rows.length > 300 ? h`<p class="small muted">First 300 rows shown.</p>` : ''}
    <div class="row"><button type="button" class="btn primary" data-act="plan-commit" ${plan.okCount ? '' : h`disabled`}>Import ${plan.okCount} row${plan.okCount === 1 ? '' : 's'}</button><button type="button" class="btn" data-act="plan-cancel">Discard preview</button></div></div>`;
}

async function readText(file) {
  if (file.size > 60 * 1024 * 1024) throw new InputError('The file is larger than 60 MB. Choose a smaller file.', 'file');
  return new TextDecoder('utf-8').decode(await file.arrayBuffer());
}

/** File inputs on the Data tab. Errors are reported in plain words and nothing is changed. */
export async function handleDataFile(kind, file) {
  const d = data();
  if (kind === 'backup') {
    const recs = readBackup(await readText(file));
    const n = app.store.mergeIn(recs, 'local');
    toast(n ? n + ' record' + (n === 1 ? '' : 's') + ' merged from the backup' : 'The backup holds nothing newer than this device');
    return;
  }
  const text = await readText(file);
  const plan = kind === 'req-csv' ? planReqImport(text, { docs: d.docs, reqs: d.reqs, refYear: refYear() }) : planCapImport(text, { caps: d.caps });
  if (!plan.rows.length) throw new InputError('The file has a header row but no data rows below it.', 'file');
  app.state.plan = { ...plan, kind: kind === 'req-csv' ? 'req' : 'cap', name: file.name };
  app.render();
  requestAnimationFrame(() => $('#plan')?.scrollIntoView({ block: 'start' }));
}

export const dataActions = {
  'backup-export': () => { download('anagrid-backup-' + stamp() + '.json', makeBackup(app.store.dump(), app.now()), 'application/json'); toast('Backup exported. Keep it outside the repository.'); },
  'csv-reqs': () => { const d = data(); download('anagrid-requirements-' + stamp() + '.csv', reqsToCSV(d.reqs, d.docs, d.caps), 'text/csv;charset=utf-8'); },
  'csv-caps': () => download('anagrid-capabilities-' + stamp() + '.csv', capsToCSV(data().caps), 'text/csv;charset=utf-8'),
  'plan-commit': () => {
    const plan = app.state.plan;
    if (!plan) return;
    const recs = plan.rows.filter((r) => r.status === 'ok').map((r) => r.rec);
    app.state.plan = null;
    app.store.putMany(recs);
    toast(recs.length + ' row' + (recs.length === 1 ? '' : 's') + ' imported');
    app.render();
  },
  'plan-cancel': () => { app.state.plan = null; app.render(); },
  'sample-load': () => {
    app.store.putMany(buildSample());
    app.state.country = 'Croatia';
    toast('Worked example loaded: Croatia');
    if (app.state.tab === 'home' || app.state.tab === 'data') location.hash = '#reqs';
    app.render();
  },
  'sample-remove': async () => {
    if (!await confirmDialog({ title: 'Remove the worked example?', confirm: 'Remove', text: 'The Croatia example documents, requirements and invented turbine values are removed. Your own entries are not touched.' })) return;
    app.store.removeMany(app.store.dump().filter((r) => isSample(r) && !r.d).map((r) => r.id));
    if (app.state.country === 'Croatia' && !data().countries.includes('Croatia')) app.state.country = '';
    toast('Worked example removed');
    app.render();
  },
  erase: async () => {
    const d = data();
    if (!await confirmDialog({ title: 'Erase all data on this device?', danger: true, confirm: 'Erase', typed: 'ERASE', text: d.docs.length + ' documents, ' + d.reqs.length + ' requirements and ' + d.caps.length + ' capability values will be deleted here and, if a sync folder is connected, on your other devices at their next sync. This cannot be undone. Export a backup first if you may need the data.' })) return;
    app.store.removeMany(app.store.dump().filter((r) => !r.d).map((r) => r.id));
    Object.assign(app.state, { country: '', docId: '', plan: null });
    toast('All data erased from this device');
    app.render();
  },
};
export { fmtStamp, options, openDialog };
