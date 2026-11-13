// Entry point: storage, sync, navigation and event wiring.
import { h, $, $$, toast, openDialog, errText } from './ui.js';
import { app, data, TABS, LS } from './ctx.js';
import { Store, MemoryAdapter } from '../core/store.js';
import { SyncEngine } from '../core/sync.js';
import { IdbAdapter } from './idb.js';
import { FsDir, canPickFolder, permission } from './fsdir.js';
import { viewHome, viewDashboard, viewGuide } from './views-a.js';
import { viewDocs, docDialog, checklistDialog, deleteDoc, extractDialog, translateDialog } from './views-docs.js';
import { viewReqs, reqListPart, reqDialog, reqAddDialog, viewCompliance, capDialog } from './views-reqs.js';
import { viewReport, viewData, reportActions, dataActions, handleDataFile } from './views-data.js';
import { applyBars } from './charts.js';
import { sourceDialog } from './views-sources.js';
import { SAMPLE_SIZE } from './sample.js';

const VIEWS = { home: viewHome, dashboard: viewDashboard, docs: viewDocs, reqs: viewReqs, compliance: viewCompliance, report: viewReport, data: viewData, guide: viewGuide };
const PHONE_TABS = ['home', 'docs', 'reqs', 'dashboard'];
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: the setting lasts for this visit only */ } } };

// ---------- theme: system first, then the user's choice ----------
const THEMES = ['system', 'light', 'dark'];
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  $('#theme-text').textContent = t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'Auto';
  $('#theme-btn').setAttribute('aria-label', 'Colour theme: ' + (t === 'system' ? 'follows the system' : t) + '. Press to change.');
}

// ---------- navigation ----------
function renderNav() {
  const cur = app.state.tab;
  $('#side').innerHTML = h`${TABS.map((t) => h`<a href="#${t.id}" ${t.id === cur ? h`aria-current="page"` : ''}>${t.label}</a>`)}`.s;
  const moreActive = !PHONE_TABS.includes(cur);
  $('#tabs').innerHTML = h`${TABS.filter((t) => PHONE_TABS.includes(t.id)).map((t) => h`<a href="#${t.id}" ${t.id === cur ? h`aria-current="page"` : ''}>${t.label === 'Requirements' ? 'Reqs' : t.label === 'Documents' ? 'Docs' : t.label}</a>`)}<button type="button" data-act="more" ${moreActive ? h`aria-current="page"` : ''}>More</button>`.s;
  const d = data();
  const sel = $('#country');
  if (app.state.country && !d.countries.includes(app.state.country)) app.state.country = '';
  sel.innerHTML = h`<option value="">All countries</option>${d.countries.map((c) => h`<option value="${c}" ${c === app.state.country ? h`selected` : ''}>${c}</option>`)}`.s;
}

function render() {
  app.cache = null;
  renderNav();
  const main = $('#main');
  try {
    main.innerHTML = VIEWS[app.state.tab]().s;
  } catch (e) {
    main.innerHTML = h`<section class="view"><h1>This page could not be shown</h1><p class="note bad">${errText(e)}</p></section>`.s;
  }
  applyBars(main);
  document.title = (TABS.find((t) => t.id === app.state.tab)?.label || 'AnaGrid') + ' · AnaGrid';
}
app.render = render;

function route() {
  const id = location.hash.replace(/^#/, '') || 'home';
  // Own keys only: an address such as #__proto__ must not resolve to anything inherited.
  const tab = Object.hasOwn(VIEWS, id) ? id : 'home';
  if (tab !== app.state.tab) { app.state.tab = tab; app.state.limit = 150; if (tab !== 'docs') app.state.docId = ''; }
  render();
  window.scrollTo(0, 0);
}

function quickStart() {
  openDialog({
    title: 'Quick start', cancel: 'Close',
    body: h`<p>AnaGrid turns grid code documents into one requirement sheet with a citation on every line. Four steps:</p>
      <ol class="steps"><li><div><b>Add a document.</b> Pick the country, then a .docx, .pdf or .txt file, or paste the text.</div></li>
        <li><div><b>Extract requirements.</b> Review the clauses found, each with article, paragraph and line, and save the ones you need.</div></li>
        <li><div><b>Record turbine capabilities</b> with their evidence and add checks to requirements. Missing data always reads as insufficient data.</div></li>
        <li><div><b>Open the report</b> and download the requirements document.</div></li></ol>
      <p class="small muted">Everything stays in this browser. The worked example loads ${SAMPLE_SIZE.reqs} Croatian requirements so you can see a finished sheet first.</p>`,
    extra: h`<button type="button" class="btn" data-qs="sample">Load worked example</button><button type="button" class="btn primary" data-qs="add">Add my first document</button>`,
    onOpen: (dlg) => dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-qs]');
      if (!b) return;
      dlg.close();
      if (b.dataset.qs === 'sample') dataActions['sample-load'](); else docDialog(null);
    }),
    onClose: () => ls.set(LS.seen, '1'),
  });
}

// ---------- sync folder ----------
function showSync(state, detail) {
  const pill = $('#sync-pill');
  pill.dataset.state = state;
  $('#sync-text').textContent = detail;
  pill.title = 'Sync state: ' + detail + '. Press to open the Data tab.';
  if (app.state.tab === 'data' && !document.querySelector('dialog[open]')) render();
}
async function connect(handle, ask) {
  const p = await permission(handle, ask);
  app.state.folderName = handle.name;
  if (p !== 'granted') { app.sync.needAccess(); return false; }
  app.sync.setDir(new FsDir(handle));
  app.sync.dirty = true; // this session must write its own file once
  await app.sync.pull();
  await app.sync.flush();
  return true;
}
const syncActions = {
  'sync-pick': async () => {
    let handle;
    try { handle = await self.showDirectoryPicker({ id: 'anagrid-sync', mode: 'readwrite' }); } catch (e) { if (e.name !== 'AbortError') toast(errText(e), true); return; }
    // If the browser cannot store the folder handle, sync still works until the page is closed.
    try { if (app.adapter.kvSet) await app.adapter.kvSet('sync-dir', handle); } catch { /* handle not storable */ }
    app.handle = handle;
    await connect(handle, true);
    toast('Sync folder connected: ' + handle.name);
    render();
  },
  'sync-reconnect': async () => { if (app.handle && await connect(app.handle, true)) toast('Folder access restored'); render(); },
  'sync-now': async () => { const n = await app.sync.pull(); await app.sync.flush(); toast(app.sync.state === 'saved' ? 'Synced' + (n ? ': ' + n + ' records updated from other devices' : '') : app.sync.detail, app.sync.state !== 'saved'); render(); },
  'sync-off': async () => {
    if (app.adapter.kvDelete) await app.adapter.kvDelete('sync-dir');
    app.handle = null; app.state.folderName = '';
    app.sync.setDir(null); app.sync._set('saved', 'Saved on this device');
    toast('Sync stopped. Data stays on this device.');
    render();
  },
};

// ---------- actions ----------
const actions = {
  go: (el) => { location.hash = '#' + el.dataset.tab; },
  theme: () => { const cur = ls.get(LS.theme) || 'system'; const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]; ls.set(LS.theme, next); applyTheme(next); },
  more: () => openDialog({ title: 'More', cancel: 'Close', body: h`<div class="cards">${TABS.filter((t) => !PHONE_TABS.includes(t.id)).map((t) => h`<a class="card" href="#${t.id}" data-close><h3>${t.label}</h3><p class="small">${t.blurb}</p></a>`)}</div>` }),
  quickstart: quickStart,
  'chart-mode': (el) => { app.state.chart[el.dataset.chart] = el.dataset.mode; render(); document.querySelector('#chart-' + el.dataset.chart + ' [data-mode="' + el.dataset.mode + '"]')?.focus(); },
  'doc-add': () => docDialog(null),
  'doc-open': (el) => { Object.assign(app.state, { docId: el.dataset.id, docFrom: 1, docLine: 0, docOrig: false }); render(); window.scrollTo(0, 0); },
  'doc-close': () => { app.state.docId = ''; render(); },
  'doc-edit': (el) => docDialog(app.store.get(el.dataset.id)),
  'doc-delete': (el) => deleteDoc(el.dataset.id),
  'doc-extract': (el) => extractDialog(el.dataset.id),
  'doc-translate': (el) => translateDialog(el.dataset.id),
  'doc-page': (el) => { app.state.docFrom = Number(el.dataset.from); app.state.docLine = 0; render(); $('#doctext')?.scrollIntoView({ block: 'start' }); },
  'doc-orig': () => { app.state.docOrig = !app.state.docOrig; render(); },
  checklist: checklistDialog,
  'src-find': sourceDialog,
  'req-open': (el) => reqDialog(el.dataset.id),
  'req-add': reqAddDialog,
  'req-more': () => { app.state.limit += 150; $('#req-list').innerHTML = reqListPart().s; },
  'req-clear': () => { app.state.f = { doc: '', cat: '', status: '', rel: '', q: '', sort: 'doc' }; render(); },
  'cap-add': () => capDialog(null),
  'cap-open': (el) => capDialog(el.dataset.id),
  ...reportActions, ...dataActions, ...syncActions,
};

function wire() {
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    try { await actions[el.dataset.act]?.(el, ev); } catch (e) { toast(errText(e), true); }
  });
  document.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.id === 'country') { app.state.country = t.value; app.state.f.doc = ''; app.state.limit = 150; render(); return; }
    if (t.dataset.filter) { app.state.f[t.dataset.filter] = t.value; app.state.limit = 150; $('#req-list').innerHTML = reqListPart().s; return; }
    if (t.dataset.file && t.files && t.files[0]) {
      const file = t.files[0];
      try { await handleDataFile(t.dataset.file, file); } catch (e) { toast(errText(e), true); }
      t.value = '';
    }
  });
  // Search re-renders only the list, so the field keeps focus and the on-screen keyboard stays open.
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'req-q') { app.state.f.q = ev.target.value; app.state.limit = 150; $('#req-list').innerHTML = reqListPart().s; }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.target.id === 'goto-line' && ev.key === 'Enter') {
      const n = Number(ev.target.value);
      if (!Number.isInteger(n) || n < 1) { toast('Type a line number, for example 120.', true); return; }
      Object.assign(app.state, { docFrom: Math.max(1, n - 20), docLine: n, docLineEnd: n });
      render();
      document.getElementById('L' + n)?.scrollIntoView({ block: 'center' });
    }
  });
  // Tooltips for chart marks; position is set through the CSS object model (CSP-safe).
  const tip = $('#tip');
  document.addEventListener('pointermove', (ev) => {
    const m = ev.target.closest?.('[data-tip]');
    if (!m) { tip.hidden = true; return; }
    tip.textContent = m.dataset.tip;
    tip.hidden = false;
    tip.style.left = Math.min(ev.clientX + 12, window.innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = Math.max(8, ev.clientY - tip.offsetHeight - 10) + 'px';
  });
  window.addEventListener('hashchange', route);
  // Write when the page is hidden; closing the tab is never relied on. Pull when it comes back.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') app.sync.flush(); else app.sync.pull(); });
  setInterval(() => { if (document.visibilityState === 'visible') app.sync.pull(); }, 60000);
}

async function start() {
  applyTheme(ls.get(LS.theme) || 'system');
  let adapter;
  try { adapter = new IdbAdapter(); await adapter.open(); } catch { adapter = new MemoryAdapter(); app.volatile = true; }
  app.adapter = adapter;
  app.store = new Store(adapter);
  try { await app.store.load(); } catch (e) { toast(errText(e), true); }
  let device = ls.get(LS.device);
  if (!device) { device = Math.random().toString(36).slice(2, 10).padEnd(8, '0'); ls.set(LS.device, device); }
  app.sync = new SyncEngine(app.store, { device, session: Date.now(), onState: showSync });
  app.store.onChange((origin) => { if (origin === 'remote' && !document.querySelector('dialog[open]')) render(); });
  wire();
  route();
  if (!ls.get(LS.seen) && !app.store.all('doc').length) quickStart();
  if (canPickFolder() && adapter.kvGet) {
    try {
      const handle = await adapter.kvGet('sync-dir');
      if (handle) { app.handle = handle; await connect(handle, false); render(); }
    } catch { app.sync.needAccess(); }
  }
  // The service worker gives offline use; it only works on http and https pages.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
}
start();
