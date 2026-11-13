// Shared application context: the store, the current filters and a few derived lookups.
import { evaluate, capIndex } from '../core/evaluate.js';
import { stableSort, cmpNatural } from '../core/util.js';
import { fromISO, fmtDayFirst, periodLabels, todayIST } from '../core/dates.js';

export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const BUILD_DATE = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';
// Every key carries the project prefix: all projects on one github.io account share localStorage.
export const LS = { theme: 'anagrid:v1:theme', seen: 'anagrid:v1:quickstart-seen', device: 'anagrid:v1:device' };

export const TABS = [
  { id: 'home', label: 'Home', blurb: 'Start here: what the tool does and the quickest way in.' },
  { id: 'dashboard', label: 'Dashboard', blurb: 'Counts and charts for documents, categories and determinations.' },
  { id: 'docs', label: 'Documents', blurb: 'Register grid code documents per country, read them by line, translate and extract.' },
  { id: 'reqs', label: 'Requirements', blurb: 'Every extracted requirement with its clause, thresholds and determination.' },
  { id: 'compliance', label: 'Compliance', blurb: 'Turbine capability data, discrepancies and risks that can block approval.' },
  { id: 'report', label: 'Report', blurb: 'The requirements document, ready to download or print.' },
  { id: 'data', label: 'Data', blurb: 'Sync folder, backup, CSV import and export.' },
  { id: 'guide', label: 'Guide', blurb: 'How to use each feature, limits and revision history.' },
];

export const app = {
  store: null, sync: null, adapter: null, volatile: false,
  state: {
    tab: 'home', country: '', docId: '', docLine: 0, docFrom: 1,
    f: { doc: '', cat: '', status: '', rel: '', q: '', sort: 'doc' }, limit: 150,
    chart: {}, plan: null, more: false,
  },
  cache: null,
  now: () => Date.now(),
};

/** Derived data, rebuilt once per store change and reused by every view. O(n). */
export function data() {
  if (app.cache) return app.cache;
  const docs = app.store.all('doc'), reqs = app.store.all('req'), caps = app.store.all('cap');
  const docById = new Map(docs.map((d) => [d.id, d]));
  const idx = capIndex(caps);
  const results = new Map();
  for (const r of reqs) results.set(r.id, evaluate(r, idx));
  const countries = stableSort([...new Set(docs.map((d) => d.country))], cmpNatural);
  app.cache = { docs, reqs, caps, docById, idx, results, countries };
  return app.cache;
}
export const scoped = (list) => (app.state.country ? list.filter((x) => x.country === app.state.country) : list);
export const refYear = () => todayIST(app.now()).y;
export const dateText = (iso) => { const d = fromISO(iso); return d ? fmtDayFirst(d) : ''; };
export const periodText = (iso) => { const d = fromISO(iso); if (!d) return ''; const p = periodLabels(d); return p.week + ' · ' + p.fy; };
