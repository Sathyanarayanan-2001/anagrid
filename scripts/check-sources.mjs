// Requests every link in the source catalogue and reports the ones that no longer answer.
// The app itself cannot do this (a web page may not fetch other sites), so the check runs from
// GitHub's servers: monthly, and on demand from the Actions tab ("Check official sources").
//
// Result per link:
//   ok       the site answered with the page
//   refused  the site answered but turns automated requests away (401, 403, 405, 429): open it in a browser
//   dead     not found, server error or no answer after retries: the entry must be corrected
// Exit code 1 when any link is dead.
import { BODIES, DOCS } from '../src/sources/catalog.js';
import { withRetry } from '../src/core/util.js';

// Hosts that answer GitHub's servers with 404 or no answer while serving the same pages to an
// ordinary visitor. Checked by hand on 13/11/2026: every catalogue link on these hosts loaded
// through a second route. Their failures are reported as "refused" (warning), not "dead", so
// the monthly run keeps meaning "a link to fix". Remove a host when it starts answering.
const BLOCKS_DATACENTRES = new Map([
  ['cea.nic.in', 'answers 404 to GitHub runners; pages load for visitors'],
  ['egazette.gov.in', 'does not answer GitHub runners; pages load for visitors'],
]);

const links = new Map(); // url -> what it is for; a map so each URL is requested once
for (const b of BODIES) links.set(b.url, (links.get(b.url) || []).concat(b.name));
for (const d of DOCS) links.set(d.url, (links.get(d.url) || []).concat(d.ref));

async function probe(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; anagrid-source-check; +https://github.com/Sathyanarayanan-2001/anagrid)', accept: 'text/html,application/pdf,*/*' } });
    await res.body?.cancel();
    return res.status;
  } finally { clearTimeout(timer); }
}

const rows = [];
for (const [url, what] of links) {
  let status, error = '';
  // A timeout per request plus retries with backoff: one slow site must not stall or fail the run.
  try { status = await withRetry(async () => { const s = await probe(url); if (s >= 500) throw new Error('HTTP ' + s); return s; }, { tries: 3, timeoutMs: 30000, baseDelayMs: 2000 }); }
  catch (e) { status = 0; error = e && e.message ? e.message : String(e); }
  const host = new URL(url).hostname;
  let state = status >= 200 && status < 400 ? 'ok' : [401, 403, 405, 429].includes(status) ? 'refused' : 'dead';
  if (state === 'dead' && BLOCKS_DATACENTRES.has(host)) { state = 'refused'; error = (error ? error + '; ' : '') + BLOCKS_DATACENTRES.get(host); }
  rows.push({ state, status, url, what: [...new Set(what)].join(', '), error });
  console.log(state.padEnd(8) + String(status || '-').padEnd(5) + url + '  [' + rows.at(-1).what + ']' + (error ? '  ' + error : ''));
}

const of = (s) => rows.filter((r) => r.state === s);
const lines = (list) => list.map((r) => (r.status || 'no answer') + ' ' + r.url + ' [' + r.what + ']' + (r.error ? ' ' + r.error : '')).join('%0A');
// One annotation per group, so the outcome can be read from the run page and through the API.
if (process.env.GITHUB_ACTIONS) {
  if (of('ok').length) console.log('::notice title=Links that answered (' + of('ok').length + ')::' + lines(of('ok')));
  if (of('refused').length) console.log('::warning title=Sites that refuse automated requests (' + of('refused').length + ')::' + lines(of('refused')));
  if (of('dead').length) console.log('::error title=Dead links (' + of('dead').length + ')::' + lines(of('dead')));
}
console.log('\n' + rows.length + ' links: ' + of('ok').length + ' ok, ' + of('refused').length + ' refused, ' + of('dead').length + ' dead');
process.exit(of('dead').length ? 1 : 0);
