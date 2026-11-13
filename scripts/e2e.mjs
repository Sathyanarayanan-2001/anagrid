// Browser tests against the built app (dist/), driven through headless Chrome.
// Run: npm run build && npm run test:e2e        Options: --shots <dir> saves screenshots.
// Every check states what is done and what is expected. All data is made up.
import puppeteer from 'puppeteer-core';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from './serve.mjs';
import { GOLDEN_DOC } from '../tests/golden.mjs';
import { makeDocx, makePdf, DOCX_TEXT } from '../tests/fixtures.mjs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => existsSync(p));
if (!CHROME) { console.error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium executable.'); process.exit(2); }
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const results = [];
const perf = {};
let current = '';
let activePage = null;
async function t(group, name, fn) {
  current = name;
  const t0 = Date.now();
  try { await fn(); results.push({ group, name, ok: true }); console.log('  ok   ' + name + ' (' + (Date.now() - t0) + ' ms)'); }
  catch (e) {
    // Close what the failed test left open, so one failure cannot cause the next ones.
    if (activePage) await activePage.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close())).catch(() => {});
    results.push({ group, name, ok: false, err: e }); console.log('  FAIL ' + name + '\n       ' + String(e && e.message ? e.message : e).split('\n').join('\n       '));
  }
}
const eq = (actual, expected, what) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(what + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)); };
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const D = '#dialogs > dialog:last-child';

const { server, url } = await serve(0);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const tmp = mkdtempSync(join(tmpdir(), 'anagrid-e2e-'));
const problems = []; // console errors and CSP violations anywhere fail the run

async function newPage(ctx, { width = 1280, height = 900, init } = {}) {
  const page = await ctx.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, hasTouch: width < 600, isMobile: width < 600 });
  page.on('console', (m) => { if (m.type() === 'error') problems.push('[' + current + '] console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('[' + current + '] page error: ' + e.message));
  if (init) await page.evaluateOnNewDocument(init);
  const cdp = await browser.target().createCDPSession();
  const dl = mkdtempSync(join(tmp, 'dl-'));
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, browserContextId: ctx.id });
  page.dl = dl;
  activePage = page;
  return page;
}
const helpers = (page) => ({
  go: async (hash) => { await page.evaluate((x) => { location.hash = x; }, hash); await sleep(60); },
  txt: (sel) => page.$eval(sel, (el) => el.textContent.trim()),
  has: async (sel) => (await page.$(sel)) !== null,
  count: (sel) => page.$$eval(sel, (els) => els.length),
  click: async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel); await sleep(40); },
  set: (sel, value) => page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, value),
  submit: async () => { await page.click(D + ' button[type="submit"]'); await sleep(80); },
  noDialog: () => page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 5000 }),
  recs: () => page.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('anagrid-v1'); r.onsuccess = () => { const q = r.result.transaction('rec').objectStore('rec').getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; q.onerror = () => rej(q.error); }; r.onerror = () => rej(r.error); })),
  tiles: () => page.$$eval('.tile', (els) => Object.fromEntries(els.map((e) => [e.querySelector('.k').textContent.trim(), e.querySelector('.v').textContent.trim()]))),
  download: async (trigger, pattern) => {
    const before = new Set(readdirSync(page.dl));
    await trigger();
    for (let i = 0; i < 100; i++) {
      const fresh = readdirSync(page.dl).filter((f) => !before.has(f) && !f.endsWith('.crdownload') && pattern.test(f));
      if (fresh.length) return join(page.dl, fresh[0]);
      await sleep(50);
    }
    throw new Error('No download matching ' + pattern + ' appeared');
  },
  toast: () => page.$eval('#toast', (el) => el.textContent),
});
const live = (recs, type) => recs.filter((r) => r.t === type && !r.d);

// =====================================================================================
console.log('\nGroup 1: first-time walk-through on a cold profile (function)');
{
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx);
  const h = helpers(page);
  const loadT0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  perf.firstLoadMs = Date.now() - loadT0;

  await t('function', 'first visit shows the quick start once', async () => {
    await page.waitForSelector(D, { visible: true });
    eq(await h.txt(D + ' h2'), 'Quick start', 'dialog title');
    eq(await h.count(D + ' .steps li'), 4, 'steps');
    await page.click(D + ' [data-close]'); await h.noDialog();
    await page.reload({ waitUntil: 'load' }); await sleep(150);
    ok(!(await h.has('dialog[open]')), 'quick start must not reopen after it was closed');
  });

  await t('function', 'home links to every other tab and each tab renders', async () => {
    const links = await page.$$eval('main a.card', (els) => els.map((e) => e.getAttribute('href')));
    eq(links, ['#dashboard', '#docs', '#reqs', '#compliance', '#report', '#data', '#guide'], 'home cards');
    for (const tab of ['dashboard', 'docs', 'reqs', 'compliance', 'report', 'data', 'guide', 'home']) {
      await h.go('#' + tab);
      ok((await h.txt('main h1')).length > 3, tab + ' has a heading');
      eq(await page.$eval('#side a[aria-current="page"]', (e) => e.getAttribute('href')), '#' + tab, 'current nav item');
    }
  });

  await t('function', 'an unknown or hostile address falls back to Home', async () => {
    for (const bad of ['#nope', '#<script>alert(1)</script>', '#docs/../../x', '#__proto__']) {
      await h.go(bad);
      eq(await h.txt('main h1'), 'Grid code requirements for wind turbines', 'route ' + bad);
    }
    eq(await page.evaluate(() => document.querySelectorAll('main script').length), 0, 'nothing injected from the address');
  });

  await t('function', 'empty states say what to do next', async () => {
    await h.go('#dashboard');
    ok((await h.txt('main .empty')).includes('Add a grid code document to begin'), 'dashboard empty text');
    ok(await h.has('main .empty [data-act="doc-add"]'), 'dashboard empty state offers the action');
    await h.go('#reqs'); ok(await h.has('main .empty [data-act="doc-add"]'), 'requirements empty state offers the action');
    await h.go('#report'); ok(await h.has('main .empty [data-act="sample-load"]'), 'report empty state offers the example');
  });

  await t('function', 'primary action in two taps: Home, Add a document, file chooser focused', async () => {
    await h.go('#home');
    await h.click('main [data-act="doc-add"]'); // tap 1
    await page.waitForSelector(D + ' input[type="file"]', { visible: true });
    eq(await page.evaluate(() => document.activeElement.type), 'file', 'file input has focus, so tap 2 or Enter picks the file');
  });

  await t('function', 'bad input is rejected with a clear message and nothing is lost', async () => {
    await h.set(D + ' input[name="Title"]', 'Examplia Grid Code');
    await h.set(D + ' textarea[name="text"]', GOLDEN_DOC);
    await h.submit();
    ok((await h.txt(D + ' .form-error')).includes('Country is required'), 'missing country message');
    eq(await page.evaluate(() => document.activeElement.name), 'Country', 'focus moves to the faulty field');
    await h.set(D + ' input[name="Country"]', 'Examplia');
    await h.set(D + ' input[name="date"]', '31/04/2024'); // April has 30 days
    await h.submit();
    ok((await h.txt(D + ' .form-error')).includes('does not exist in the calendar'), 'date message');
    await h.set(D + ' input[name="url"]', 'javascript:alert(1)');
    await h.set(D + ' input[name="date"]', '28/10/2024');
    await h.submit();
    ok((await h.txt(D + ' .form-error')).includes('Only http and https'), 'url message');
    eq(await page.$eval(D + ' input[name="Title"]', (e) => e.value), 'Examplia Grid Code', 'typed values are kept');
    eq(live(await h.recs(), 'doc').length, 0, 'nothing saved while invalid');
  });

  await t('function', 'document is saved and shown with line numbers; reference stays text', async () => {
    await h.set(D + ' input[name="url"]', '');
    await h.set(D + ' input[name="Reference"]', '10/2024');
    await h.submit(); await h.noDialog();
    eq(await h.txt('main h1'), 'Examplia Grid Code', 'document view');
    eq(await h.txt('#L7 span:last-child'), GOLDEN_DOC.split('\n')[6], 'line 7 text');
    const doc = live(await h.recs(), 'doc')[0];
    eq([doc.country, doc.ref, doc.published, doc.kind], ['Examplia', '10/2024', '2024-10-28', 'tso'], 'stored fields');
    ok((await h.txt('main dl.meta')).includes('28/10/2024') && (await h.txt('main dl.meta')).includes('CW44 · FY 2024-25'), 'date shown day first with derived week and financial year');
  });

  await t('function', 'extraction previews 6 clauses, saves nothing until Save, then saves 6', async () => {
    await h.click('[data-act="doc-extract"]');
    await page.waitForSelector(D + ' .cand');
    eq(await h.count(D + ' .cand'), 6, 'candidates');
    ok((await h.txt(D + ' .cand')).includes('Article 12, para (1), line 7'), 'first citation');
    eq(live(await h.recs(), 'req').length, 0, 'nothing saved during preview');
    await h.submit(); await h.noDialog();
    const reqs = live(await h.recs(), 'req');
    eq(reqs.length, 6, 'saved requirements');
    eq(reqs.map((r) => r.code).sort(), ['EXA-0001', 'EXA-0002', 'EXA-0003', 'EXA-0004', 'EXA-0005', 'EXA-0006'], 'codes');
    eq(await h.count('#req-list tbody tr'), 6, 'rows listed');
  });

  await t('function', 'unticked clauses are not saved; filters and selection work together', async () => {
    await h.go('#docs'); await h.click('[data-act="doc-add"]');
    await h.set(D + ' input[name="Country"]', 'Examplia'); await h.set(D + ' input[name="Title"]', 'Second made-up code');
    await h.set(D + ' textarea[name="text"]', 'Article 1.\n\nThe generating unit shall remain connected at 47.5 Hz.\n\nArticle 2.\n\nThe generating unit must trip above 52 Hz.\n\nArticle 3.\n\nBilling meters are class 0.2.\n');
    await h.submit(); await h.noDialog();
    await h.click('[data-act="doc-extract"]'); await page.waitForSelector(D + ' .cand');
    eq(await h.count(D + ' .cand'), 2, 'the metering clause is hidden by the relevance filter');
    await h.click(D + ' #f-rel'); await h.click(D + ' #f-req');
    eq(await h.count(D + ' .cand'), 3, 'all clauses listed without filters');
    await h.click(D + ' #pick-none'); await h.click(D + ' .cand:nth-child(2) input');
    ok((await h.txt(D + ' #cand-count')).includes('1 selected'), 'selection count');
    await h.submit(); await h.noDialog();
    const mine = live(await h.recs(), 'req').filter((r) => r.text.includes('52 Hz'));
    eq([live(await h.recs(), 'req').length, mine.length, mine[0].cite.clause, mine[0].code], [7, 1, 'Article 2', 'EXA-0007'], 'only the ticked clause was saved');
    await h.go('#docs'); const id = live(await h.recs(), 'doc').find((d) => d.title === 'Second made-up code').id;
    await page.evaluate((x) => document.querySelector('[data-act="doc-open"][data-id="' + x + '"]').click(), id); await sleep(60);
    await h.click('[data-act="doc-delete"]'); await h.submit(); await h.noDialog();
    eq([live(await h.recs(), 'doc').length, live(await h.recs(), 'req').length], [1, 6], 'document and its requirement removed again');
  });

  await t('function', 'extracting the same document again offers nothing twice', async () => {
    await h.go('#docs'); await h.click('[data-act="doc-open"]'); await h.click('[data-act="doc-extract"]');
    await page.waitForSelector(D + ' .cand');
    eq(await h.count(D + ' .cand input:disabled'), 6, 'all six are marked already saved');
    await h.submit();
    ok((await h.txt(D + ' .form-error')).includes('No requirement is selected'), 'clear message');
    await page.click(D + ' [data-close]'); await h.noDialog();
    eq(live(await h.recs(), 'req').length, 6, 'still six');
  });

  await t('function', 'a check without capability data is INSUFFICIENT; with data it becomes COMPLIANT', async () => {
    await h.go('#reqs');
    await page.$$eval('[data-act="req-open"]', (els) => els.find((e) => e.textContent === 'EXA-0003').click());
    await page.waitForSelector(D + ' #add-check');
    await h.click(D + ' #add-check');
    await h.set(D + ' [data-check] [data-k="cap"]', 'RoCoF withstand');
    await h.set(D + ' [data-check] [data-k="value"]', 'two');
    await page.select(D + ' [data-check] [data-k="unit"]', 'Hz/s');
    await h.submit();
    ok((await h.txt(D + ' .form-error')).includes('must be a number'), 'limit validation');
    await h.set(D + ' [data-check] [data-k="value"]', '2');
    await h.submit(); await h.noDialog();
    const row = () => page.$$eval('#req-list tbody tr', (els) => els.find((e) => e.textContent.includes('EXA-0003')).querySelector('.st').textContent);
    eq(await row(), 'Insufficient data', 'no capability recorded yet');
    await h.go('#compliance');
    await h.click('[data-act="cap-add"]');
    await h.set(D + ' input[name="Parameter"]', 'RoCoF withstand');
    await h.set(D + ' input[name="Value"]', '2,5'); // decimal comma accepted
    await page.select(D + ' select[name="unit"]', 'Hz/s');
    await h.set(D + ' textarea[name="evidence"]', 'Made-up test report TR-001, section 4');
    await h.submit(); await h.noDialog();
    await h.go('#reqs');
    eq(await row(), 'Compliant', '2.5 Hz/s >= 2 Hz/s');
  });

  await t('function', 'manual COMPLIANT needs evidence; cost and due date derive week and financial year', async () => {
    await page.$$eval('[data-act="req-open"]', (els) => els.find((e) => e.textContent === 'EXA-0006').click());
    await page.waitForSelector(D + ' select[name="status"]');
    await page.select(D + ' select[name="status"]', 'COMPLIANT');
    await h.submit();
    ok((await h.txt(D + ' .form-error')).includes('needs evidence'), 'evidence required');
    await h.set(D + ' textarea[name="evidence"]', 'Made-up model validation report MV-2, chapter 3');
    await h.set(D + ' input[name="amount"]', '1,23,456.789');
    await h.submit();
    ok((await h.txt(D + ' .form-error')).includes('at most two decimals'), 'amount validation');
    await h.set(D + ' input[name="amount"]', '1,23,456.78');
    await h.set(D + ' input[name="date"]', '31/03/2027');
    eq(await h.txt(D + ' #due-hint'), 'CW13 · FY 2026-27', '31 March is the last day of FY 2026-27');
    await h.set(D + ' input[name="date"]', '01/04/2027');
    eq(await h.txt(D + ' #due-hint'), 'CW13 · FY 2027-28', '1 April starts FY 2027-28 in the same ISO week');
    await h.submit(); await h.noDialog();
    const r = live(await h.recs(), 'req').find((x) => x.code === 'EXA-0006');
    eq([r.cost, r.due, r.manual.status], [12345678, '2027-04-01', 'COMPLIANT'], 'stored as whole paise and ISO date');
  });

  await t('function', 'every dashboard figure matches a separate count of the stored records', async () => {
    await h.go('#dashboard');
    const recs = await h.recs();
    const reqs = live(recs, 'req');
    const tiles = await h.tiles();
    eq(tiles.Documents, String(live(recs, 'doc').length), 'documents'); eq(tiles.Countries, '1', 'countries'); eq(tiles.Requirements, String(reqs.length), 'requirements');
    eq(tiles['With numeric thresholds'], String(reqs.filter((r) => r.thresholds.length).length), 'thresholds');
    eq(tiles['With open findings'], String(reqs.filter((r) => r.flags.length).length), 'findings');
    eq(tiles['Determinations made'], '2 of 6', 'EXA-0003 by check, EXA-0006 by hand');
    eq(tiles['Cost to close gaps'], '₹ 1,23,456.78', 'lakh grouping, exact');
    const legend = await page.$$eval('#chart-status .legend li', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    eq(legend, ['Compliant233.3 %', 'Partially compliant00.0 %', 'Non-compliant00.0 %', 'Insufficient data466.7 %'], 'status legend');
    const cats = {}; for (const r of reqs) cats[r.cat] = (cats[r.cat] || 0) + 1;
    const bars = await page.$$eval('#chart-cat .bars .val', (els) => els.map((e) => Number(e.textContent)));
    eq(bars.reduce((a, b) => a + b, 0), 6, 'category bars add up to the requirement count');
    eq(bars.slice().sort(), Object.values(cats).sort(), 'category counts');
    const widths = await page.$$eval('#chart-cat .bar', (els) => els.map((e) => e.style.width));
    ok(widths.every((w) => /%$/.test(w)) && widths.includes('100%'), 'bar widths applied (largest bar is 100 %)');
    const px = await page.$$eval('#chart-cat .bars .track', (els) => els.map((e) => [e.querySelector('.bar').getBoundingClientRect().width, e.getBoundingClientRect().width, e.querySelector('.bar').getBoundingClientRect().height]));
    ok(px.every(([b, tr, hgt]) => b > 0 && b <= tr + 0.5 && hgt >= 8), 'bars are really drawn: ' + JSON.stringify(px));
    const top = px.reduce((a, x) => Math.max(a, x[0] / x[1]), 0);
    ok(top > 0.98, 'the largest bar fills its track');
    const seg = await page.$$eval('#chart-status .stack span', (els) => els.map((e) => e.getBoundingClientRect().width));
    ok(seg.length === 2 && seg.every((w) => w > 0), 'status segments drawn: ' + seg);
  });

  await t('function', 'every chart has a Chart and Table toggle with the same numbers', async () => {
    eq(await h.count('figure.chart'), 4, 'charts'); eq(await h.count('figure.chart .seg'), 4, 'toggles');
    const before = await page.$$eval('#chart-cat .bars .val', (els) => els.map((e) => e.textContent));
    await h.click('#chart-cat [data-mode="table"]');
    const after = await page.$$eval('#chart-cat table tbody td.num', (els) => els.map((e) => e.textContent));
    eq(after, before, 'table numbers equal chart numbers');
    eq(await page.$eval('#chart-cat [data-mode="table"]', (e) => e.getAttribute('aria-pressed')), 'true', 'pressed state');
    await h.click('#chart-status [data-mode="table"]');
    eq(await page.$$eval('#chart-status table tbody tr', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim())), ['Compliant233.3 %', 'Partially compliant00.0 %', 'Non-compliant00.0 %', 'Insufficient data466.7 %'], 'status table');
    await h.click('#chart-cat [data-mode="chart"]'); await h.click('#chart-status [data-mode="chart"]');
  });

  await t('function', 'search filters the list and keeps focus in the field', async () => {
    await h.go('#reqs');
    await page.focus('#req-q');
    await page.keyboard.type('simulation');
    eq(await h.count('#req-list tbody tr'), 1, 'one requirement mentions simulation');
    eq(await page.evaluate(() => document.activeElement.id), 'req-q', 'focus stays in the search field while typing');
    await h.set('#req-q', 'zzzz');
    ok((await h.txt('#req-list .empty')).includes('No requirement matches'), 'empty result explains itself');
    await h.click('[data-act="req-clear"]');
    eq(await h.count('#req-list tbody tr'), 6, 'filters cleared');
    await page.select('[data-filter="status"]', 'COMPLIANT');
    eq(await h.count('#req-list tbody tr'), 2, 'determination filter');
    await page.select('[data-filter="status"]', '');
  });

  await t('function', 'report cites clause and line, and downloads as HTML, Markdown and CSV', async () => {
    await h.go('#report');
    const body = await h.txt('article.report');
    ok(body.includes('EXA-0003') && body.includes('COMPLIANT') && body.includes('Article 13, line 15'), 'report content');
    ok(body.includes('RoCoF withstand >= 2 Hz/s: recorded 2.5 Hz/s -> met'), 'basis of determination');
    const html = readFileSync(await h.download(() => page.click('[data-act="rep-html"]'), /\.html$/), 'utf8');
    ok(html.startsWith('<!doctype html>') && html.includes('Article 12, para (1), line 7'), 'HTML file');
    const md = readFileSync(await h.download(() => page.click('[data-act="rep-md"]'), /\.md$/), 'utf8');
    ok(md.includes('#### EXA-0001 — INSUFFICIENT DATA') && md.includes('INR 1,23,456.78'), 'Markdown file');
    const csv = readFileSync(await h.download(() => page.click('[data-act="rep-csv"]'), /\.csv$/));
    eq([csv[0], csv[1], csv[2]], [0xef, 0xbb, 0xbf], 'CSV starts with the UTF-8 byte order mark');
    writeFileSync(join(tmp, 'export.csv'), csv);
  });

  await t('function', 'CSV import: preview with a status per row; nothing saved until Import', async () => {
    const csvIn = ['Made-up requirement sheet', 'Printed;13/11/2026', '', 'Source;Article;Text;Assessment;Remarks;Cost to close',
      'Examplia Grid Code;="5.10";The plant shall withstand 3 Hz/s.;Non-compliant;;0.22', 'Examplia Grid Code;Article 6;The plant shall ride through faults.;Compliant;;',
      'Unknown Code;Article 1;The plant shall exist.;;;', 'Examplia Grid Code;Article 15;The owner should provide a dynamic simulation model of the wind farm.;;;'].join('\n');
    const f = join(tmp, 'in.csv'); writeFileSync(f, csvIn);
    await h.go('#data');
    await (await page.$('[data-file="req-csv"]')).uploadFile(f);
    await page.waitForSelector('#plan tbody tr');
    eq(await page.$$eval('#plan tbody tr', (els) => els.map((e) => e.querySelector('.chip').textContent)), ['Ready', 'Problem', 'Problem', 'Skipped'], 'row statuses: the Article 15 clause is already in the register');
    ok((await h.txt('#plan')).includes('Header found on line 4') && (await h.txt('#plan')).includes('needs an evidence reference'), 'preview explains');
    eq(live(await h.recs(), 'req').length, 6, 'nothing saved during preview');
    await h.click('[data-act="plan-commit"]');
    const reqs = live(await h.recs(), 'req');
    eq(reqs.length, 7, 'one row imported');
    eq(reqs.find((r) => r.code === 'EXA-0007').cite.clause, '5.10', 'clause kept as text, not turned into 5.1');
    await h.go('#dashboard');
    eq((await h.tiles())['Cost to close gaps'], '₹ 1,23,457.00', '1,23,456.78 + 0.22 by hand');
  });

  await t('function', 'backup round trip: export, erase (typed confirmation), import; counts and totals match', async () => {
    await h.go('#data');
    const before = await h.recs();
    const sum = (rs) => live(rs, 'req').reduce((a, r) => a + (r.cost || 0), 0);
    const file = await h.download(() => page.click('[data-act="backup-export"]'), /^anagrid-backup-.*\.json$/);
    await h.click('[data-act="erase"]');
    await h.set(D + ' input[name="typed"]', 'no');
    await h.submit();
    ok((await h.txt(D + ' .form-error')).includes('Type ERASE exactly'), 'typed confirmation enforced');
    await h.set(D + ' input[name="typed"]', 'ERASE');
    await h.submit(); await h.noDialog();
    eq([live(await h.recs(), 'doc').length, live(await h.recs(), 'req').length], [0, 0], 'erased');
    // An erase is newer than the backup, so a plain import would rightly lose to the deletions.
    // An empty copy is the real round-trip target: clear the browser storage, then import.
    await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('anagrid-v1'); r.onsuccess = () => { const tx = r.result.transaction('rec', 'readwrite'); tx.objectStore('rec').clear(); tx.oncomplete = () => { r.result.close(); res(); }; }; }));
    await page.reload({ waitUntil: 'load' }); await h.go('#data');
    await (await page.$('[data-file="backup"]')).uploadFile(file);
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('merged'), { timeout: 5000 });
    const after = await h.recs();
    eq([live(after, 'doc').length, live(after, 'req').length, live(after, 'cap').length, sum(after)], [live(before, 'doc').length, live(before, 'req').length, live(before, 'cap').length, sum(before)], 'counts and cost total');
    eq(sum(after), 12345700, 'total in paise');
  });

  await t('function', 'wrong files are refused in plain words', async () => {
    const bad = join(tmp, 'bad.json'); writeFileSync(bad, '{"hello":1}');
    await (await page.$('[data-file="backup"]')).uploadFile(bad);
    await sleep(150);
    ok((await h.toast()).includes('not an AnaGrid backup'), 'backup message');
    const badCsv = join(tmp, 'bad.csv'); writeFileSync(badCsv, 'a,b\n1,2\n');
    await (await page.$('[data-file="req-csv"]')).uploadFile(badCsv);
    await sleep(150);
    ok((await h.toast()).includes('No header row found'), 'csv message');
  });

  await t('function', '.docx and .pdf files are read on the device', async () => {
    const docx = join(tmp, 'made-up.docx'), pdf = join(tmp, 'made-up.pdf');
    writeFileSync(docx, makeDocx(8)); writeFileSync(pdf, makePdf());
    await h.go('#docs'); await h.click('[data-act="doc-add"]');
    await (await page.$(D + ' input[type="file"]')).uploadFile(docx);
    await page.waitForFunction((d) => document.querySelector(d + ' textarea[name="text"]').value.length > 10, {}, D);
    eq(await page.$eval(D + ' textarea[name="text"]', (e) => e.value), DOCX_TEXT, '.docx text');
    eq(await page.$eval(D + ' input[name="Title"]', (e) => e.value), 'made-up', 'title from file name');
    await (await page.$(D + ' input[type="file"]')).uploadFile(pdf);
    await page.waitForFunction((d) => document.querySelector(d + ' textarea[name="text"]').value.includes('Članak 2'), {}, D);
    ok((await h.txt(D + ' #file-info')).includes('2 pages'), 'page count reported');
    const txtFile = join(tmp, 'x.xyz'); writeFileSync(txtFile, 'x');
    await (await page.$(D + ' input[type="file"]')).uploadFile(txtFile);
    await sleep(150);
    ok((await h.txt(D + ' .form-error')).includes('not supported'), 'unsupported type message');
    await page.click(D + ' [data-close]'); await h.noDialog();
  });

  await t('function', 'injection attempt is shown as text and never runs', async () => {
    await h.click('[data-act="doc-add"]');
    const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
    await h.set(D + ' input[name="Country"]', 'Examplia');
    await h.set(D + ' input[name="Title"]', evil);
    await h.set(D + ' textarea[name="text"]', 'Article 1.\n\nThe generating unit shall ' + evil + ' remain connected.\n\nArticle 2.\n\nx shall y.\n\nArticle 3.\n\nz shall w.');
    await h.submit(); await h.noDialog();
    eq(await h.txt('main h1'), evil, 'title rendered as text');
    await h.click('[data-act="doc-extract"]'); await page.waitForSelector(D + ' .cand'); await h.submit(); await h.noDialog();
    await h.go('#report'); await h.go('#dashboard'); await h.go('#compliance'); await h.go('#docs');
    eq(await page.evaluate(() => [window.__xss, document.querySelectorAll('main img, main script').length]), [null, 0], 'no script ran, no element injected');
    const id = (live(await h.recs(), 'doc').find((d) => d.title === evil)).id;
    await page.evaluate((x) => document.querySelector('[data-act="doc-open"][data-id="' + x + '"]')?.click(), id); await sleep(60);
    await h.click('[data-act="doc-delete"]'); await h.submit(); await h.noDialog();
    eq(live(await h.recs(), 'doc').length, 1, 'evil document and its requirements deleted');
    eq(live(await h.recs(), 'req').length, 7, 'own requirements untouched');
  });

  await t('function', 'theme: follows the system first, then the choice, and the choice survives a reload', async () => {
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    eq(await bg(), 'rgb(15, 23, 42)', 'system dark is followed with no choice made');
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    eq(await bg(), 'rgb(248, 250, 252)', 'system light');
    await h.click('#theme-btn'); eq(await h.txt('#theme-text'), 'Light', 'first press');
    await h.click('#theme-btn'); eq(await h.txt('#theme-text'), 'Dark', 'second press');
    eq(await bg(), 'rgb(15, 23, 42)', 'dark chosen over a light system');
    await page.reload({ waitUntil: 'load' });
    eq(await bg(), 'rgb(15, 23, 42)', 'choice kept after reload');
    await h.click('#theme-btn'); eq(await h.txt('#theme-text'), 'Auto', 'back to system');
  });

  await t('function', 'reload, then offline: the data remains and the page still opens', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null || true);
    await page.reload({ waitUntil: 'load' }); // now controlled by the service worker
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 8000 });
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'load' });
    await h.go('#reqs');
    eq(await h.count('#req-list tbody tr'), 7, 'requirements still listed offline');
    eq(await page.evaluate(() => document.fonts.check('14px "IBM Plex Sans"')), true, 'embedded font available offline');
    await page.setOfflineMode(false);
    const keys = await page.evaluate(() => caches.keys());
    ok(keys.length === 1 && keys[0].startsWith('anagrid-v'), 'cache name carries the project prefix: ' + keys);
    const lsKeys = await page.evaluate(() => Object.keys(localStorage));
    ok(lsKeys.length > 0 && lsKeys.every((k) => k.startsWith('anagrid:')), 'localStorage keys carry the project prefix: ' + lsKeys);
  });

  await t('function', 'midnight, month end and leap day reach the screen correctly', async () => {
    await h.go('#reqs');
    await page.$$eval('[data-act="req-open"]', (els) => els[0].click());
    await page.waitForSelector(D + ' input[name="date"]');
    const hint = async (v) => { await h.set(D + ' input[name="date"]', v); return h.txt(D + ' #due-hint'); };
    eq(await hint('29/02/2028'), 'CW09 · FY 2027-28', 'leap day accepted');
    eq(await hint('29/02/2027'), 'day first, 28/10/2026', 'no 29 February in 2027: no period shown');
    eq(await hint('31/12/2026'), 'CW53 · FY 2026-27', 'ISO week 53');
    eq(await hint('01/01/2027'), 'CW53 · FY 2026-27', '1 January 2027 still belongs to week 53 of 2026');
    eq(await hint('04/01/2027'), 'CW01 · FY 2026-27', 'first Monday of 2027');
    await h.set(D + ' input[name="date"]', '29/02/2027');
    await h.submit();
    ok((await h.txt(D + ' .form-error')).includes('does not exist in the calendar'), 'impossible date refused on save');
    await page.click(D + ' [data-close]'); await h.noDialog();
  });

  await ctx.close();
}

// =====================================================================================
console.log('\nGroup 2: worked example, appearance and phone layout');
{
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx);
  const h = helpers(page);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector(D);

  await t('function', 'worked example loads from the quick start: 4 documents, 61 requirements, every determination', async () => {
    await h.click(D + ' [data-qs="sample"]'); await h.noDialog();
    const recs = await h.recs();
    eq([live(recs, 'doc').length, live(recs, 'req').length, live(recs, 'cap').length], [4, 61, 9], 'record counts');
    await h.go('#compliance');
    eq(await h.tiles(), { Compliant: '2', 'Partially compliant': '2', 'Non-compliant': '1', 'Insufficient data': '56' }, 'determinations');
    await h.go('#data'); await h.click('[data-act="sample-remove"]'); await h.submit(); await h.noDialog();
    eq(live(await h.recs(), 'doc').length, 0, 'example removed');
    await h.click('[data-act="sample-load"]'); await sleep(100);
    eq(live(await h.recs(), 'req').length, 61, 'loaded again; ids are fixed so nothing doubles');
  });

  await t('appearance', 'IBM Plex Sans is embedded and used; numbers are tabular', async () => {
    eq(await page.evaluate(() => document.fonts.check('14px "IBM Plex Sans"') && document.fonts.check('600 14px "IBM Plex Sans"')), true, 'font faces loaded');
    ok((await page.evaluate(() => getComputedStyle(document.body).fontFamily)).startsWith('"IBM Plex Sans"'), 'font family');
    eq(await page.evaluate(() => getComputedStyle(document.body).fontVariantNumeric), 'tabular-nums', 'tabular numbers');
    eq(await page.evaluate(() => getComputedStyle(document.body).fontSize), '14px', 'base size 14 px');
    eq(await page.evaluate(() => getComputedStyle(document.querySelector('main h1')).fontSize), '24px', 'h1 24 px');
  });

  await t('appearance', 'desktop: side navigation shown, bottom tabs hidden, dense tables', async () => {
    await h.go('#reqs');
    eq(await page.evaluate(() => [getComputedStyle(document.querySelector('#side')).display, getComputedStyle(document.querySelector('#tabs')).display]), ['block', 'none'], 'navigation');
    eq(await page.evaluate(() => getComputedStyle(document.querySelector('table.resp td')).display), 'table-cell', 'table layout');
    eq(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll at 1280');
  });

  await t('appearance', 'keyboard focus is visible', async () => {
    await h.go('#home');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const o = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, s.outlineWidth]; });
    eq(o, ['solid', '2px'], 'focus ring');
  });

  await t('appearance', 'reduced motion is respected', async () => {
    const dur = () => page.evaluate(() => getComputedStyle(document.querySelector('#toast')).transitionDuration);
    eq(await dur(), '0.15s', 'normal');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    eq(await page.evaluate(() => getComputedStyle(document.querySelector('#toast')).transitionProperty), 'none', 'transitions off');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  });

  await t('appearance', 'number, date and link fields open the right keyboard (inputmode)', async () => {
    await h.go('#docs'); await h.click('[data-act="doc-add"]');
    eq(await page.$eval(D + ' input[name="date"]', (e) => e.inputMode), 'numeric', 'date');
    eq(await page.$eval(D + ' input[name="url"]', (e) => e.inputMode), 'url', 'link');
    await page.click(D + ' [data-close]'); await h.noDialog();
    await h.go('#reqs'); await h.click('[data-act="req-open"]'); await page.waitForSelector(D + ' input[name="amount"]');
    eq(await page.$eval(D + ' input[name="amount"]', (e) => e.inputMode), 'decimal', 'amount');
    await h.click(D + ' #add-check');
    eq(await page.$eval(D + ' [data-k="value"]', (e) => e.inputMode), 'decimal', 'limit');
    await page.click(D + ' [data-close]'); await h.noDialog();
    await h.go('#compliance'); await h.click('[data-act="cap-add"]');
    eq(await page.$eval(D + ' input[name="Value"]', (e) => e.inputMode), 'decimal', 'capability value');
    await page.click(D + ' [data-close]'); await h.noDialog();
  });

  if (shotsDir) { for (const tab of ['home', 'dashboard', 'docs', 'reqs', 'compliance', 'report', 'data', 'guide']) { await h.go('#' + tab); await page.screenshot({ path: join(shotsDir, 'desktop-light-' + tab + '.png') }); } }

  for (const width of [320, 360, 390]) {
    await t('appearance', 'phone ' + width + ' px: no sideways scroll, 44 px targets, bottom tabs, tables as cards', async () => {
      await page.setViewport({ width, height: 720, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
      await sleep(80);
      for (const tab of ['home', 'dashboard', 'docs', 'reqs', 'compliance', 'report', 'data', 'guide']) {
        await h.go('#' + tab);
        const m = await page.evaluate(() => {
          const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('.sr'); };
          const small = [...document.querySelectorAll('button, a.btn, label.btn, .tabs a, main a.card, select, input:not([type="checkbox"]):not(.sr), textarea, .linkish')].filter(vis)
            .map((e) => { const r = e.getBoundingClientRect(); return { tag: e.tagName + '.' + e.className + ':' + e.textContent.trim().slice(0, 20), h: Math.round(r.height * 10) / 10, w: Math.round(r.width) }; }).filter((x) => x.h < 44 || x.w < 44);
          const wide = [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5 && !e.closest('.doctext, .scroll')).slice(0, 3).map((e) => e.tagName + '.' + e.className);
          return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, small, wide };
        });
        ok(m.sw <= m.iw, tab + ': page is ' + m.sw + ' px wide in a ' + m.iw + ' px viewport; overflowing: ' + m.wide.join(', '));
        eq(m.small, [], tab + ': touch targets under 44 px');
      }
      eq(await page.evaluate(() => [getComputedStyle(document.querySelector('#side')).display, getComputedStyle(document.querySelector('#tabs')).display]), ['none', 'grid'], 'bottom tab bar replaces the side navigation');
      eq(await h.count('#tabs a, #tabs button'), 5, 'five bottom tabs');
      await h.go('#reqs');
      eq(await page.evaluate(() => getComputedStyle(document.querySelector('table.resp td')).display), 'block', 'table rows become cards');
      ok((await page.evaluate(() => getComputedStyle(document.querySelector('table.resp td[data-l]'), '::before').content)).includes('Code'), 'card cells carry their column label');
      // Dialogs on a phone
      await h.click('[data-act="req-open"]'); await page.waitForSelector(D + ' textarea[name="text"]');
      const dlg = await page.evaluate((d) => { const el = document.querySelector(d); const r = el.getBoundingClientRect(); const body = el.querySelector('.dlg-body'); return { w: r.width, right: r.right, vw: window.innerWidth, overflow: body.scrollWidth - body.clientWidth }; }, D);
      ok(dlg.right <= dlg.vw && dlg.overflow <= 0, 'dialog fits the screen: ' + JSON.stringify(dlg));
      await page.click(D + ' [data-close]'); await h.noDialog();
      await h.click('#tabs [data-act="more"]'); await page.waitForSelector(D + ' a.card');
      eq(await h.count(D + ' a.card'), 4, 'More lists the other four sections');
      await page.click(D + ' a.card[href="#guide"]'); await h.noDialog();
      await page.waitForFunction(() => location.hash === '#guide', { timeout: 3000 }); await sleep(60); // hashchange is delivered asynchronously
      eq(await h.txt('main h1'), 'Guide', 'More navigates');
      if (shotsDir && width === 360) { for (const tab of ['home', 'dashboard', 'reqs', 'compliance']) { await h.go('#' + tab); await page.screenshot({ path: join(shotsDir, 'phone-360-' + tab + '.png') }); } }
    });
  }

  await t('appearance', 'on-screen keyboard: the field stays focused, visible, and the dialog stays open on resize', async () => {
    await page.setViewport({ width: 360, height: 720, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await h.go('#reqs'); await h.click('[data-act="req-open"]'); await page.waitForSelector(D + ' input[name="amount"]');
    await page.focus(D + ' input[name="amount"]');
    await page.keyboard.type('12');
    await page.setViewport({ width: 360, height: 380, deviceScaleFactor: 1, hasTouch: true, isMobile: true }); // keyboard takes 340 px
    await sleep(400);
    const s = await page.evaluate((d) => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { name: a.name, value: a.value, open: document.querySelector(d).open, top: r.top, bottom: r.bottom, vh: window.innerHeight }; }, D);
    eq([s.name, s.value, s.open], ['amount', '12', true], 'focus, typed value and dialog survive the resize');
    ok(s.top >= 0 && s.bottom <= s.vh, 'focused field is inside the visible area: ' + JSON.stringify(s));
    await page.keyboard.type('3');
    eq(await page.$eval(D + ' input[name="amount"]', (e) => e.value), '123', 'typing continues');
    await page.setViewport({ width: 360, height: 720, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await page.click(D + ' [data-close]'); await h.noDialog();
  });

  await t('appearance', 'dark theme on a phone renders with dark surfaces and readable status pills', async () => {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await h.go('#compliance');
    eq(await page.evaluate(() => getComputedStyle(document.querySelector('.tile')).backgroundColor), 'rgb(30, 41, 59)', 'tile surface');
    if (shotsDir) { await page.screenshot({ path: join(shotsDir, 'phone-360-dark-compliance.png') }); await page.setViewport({ width: 1280, height: 900 }); for (const tab of ['dashboard', 'reqs']) { await h.go('#' + tab); await page.screenshot({ path: join(shotsDir, 'desktop-dark-' + tab + '.png') }); } }
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  });

  await t('appearance', 'install: manifest and 192, 512 and maskable icons are served; CSP allows only own files', async () => {
    const man = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
    eq(man.icons.map((i) => i.sizes + ' ' + i.purpose), ['192x192 any', '512x512 any', '512x512 maskable'], 'manifest icons');
    for (const ic of man.icons) {
      const dim = await page.evaluate(async (src) => { const b = new DataView(await (await fetch(src)).arrayBuffer()); return [b.getUint32(16), b.getUint32(20)]; }, ic.src);
      eq(dim.join('x'), ic.sizes, ic.src + ' pixel size');
    }
    const csp = await page.$eval('meta[http-equiv="Content-Security-Policy"]', (e) => e.content);
    ok(csp.includes("default-src 'none'") && /script-src 'sha256-[^']+'(;|$)/.test(csp) && !csp.includes('unsafe-inline') && !csp.includes('http'), 'strict policy: ' + csp);
    const blocked = await page.evaluate(() => fetch('https://example.com/').then(() => 'allowed', () => 'blocked'));
    eq(blocked, 'blocked', 'a request to another site is refused by the policy');
    problems.splice(0, problems.length, ...problems.filter((p) => !p.includes('example.com') && !p.includes('Content Security Policy')));
  });

  await ctx.close();
}

// =====================================================================================
console.log('\nGroup 3: translation (browser translator replaced by a stand-in)');
{
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx, { init: () => {
    window.Translator = { availability: async () => 'available', create: async () => ({ translate: async (s) => 'EN ' + s.toUpperCase(), destroy() {} }) };
  } });
  const h = helpers(page);
  await page.goto(url, { waitUntil: 'load' }); await page.waitForSelector(D); await page.click(D + ' [data-close]'); await h.noDialog();
  await t('function', 'translation keeps line numbers, keeps the original, and warns about a non-English text', async () => {
    const hr = 'Članak 1.\n\nProizvodni modul mora ostati priključen na mrežu i mora raditi u skladu sa zahtjevima operatora prijenosnog sustava za sve tipove modula ili jedinica na mreži od 110 kV i više.\n\n47,5 Hz';
    await h.click('[data-act="doc-add"]');
    await h.set(D + ' input[name="Country"]', 'Examplia'); await h.set(D + ' input[name="Title"]', 'Made-up Croatian text'); await h.set(D + ' textarea[name="text"]', hr);
    await h.submit(); await h.noDialog();
    ok((await h.txt('main .note.warn')).includes('looks like Croatian'), 'language warning');
    await h.click('[data-act="doc-translate"]'); await page.waitForSelector(D + ' select[name="lang"]');
    eq(await page.$eval(D + ' select[name="lang"]', (e) => e.value), 'hr', 'source language guessed');
    await h.submit(); await h.noDialog();
    const doc = live(await h.recs(), 'doc')[0];
    eq(doc.orig, hr, 'original kept');
    eq(doc.text.split('\n').length, hr.split('\n').length, 'same number of lines');
    eq(doc.text.split('\n')[0], 'EN ČLANAK 1.', 'line 1 translated');
    eq(doc.text.split('\n')[1], '', 'blank line kept');
    eq(doc.text.split('\n')[4], 'EN 47,5 HZ', 'line 5 translated');
    eq(await h.txt('#L5 span:last-child'), 'EN 47,5 HZ', 'English shown by default');
    await h.click('[data-act="doc-orig"]');
    eq(await h.txt('#L5 span:last-child'), '47,5 Hz', 'original shown at the same line number');
    await h.click('[data-act="doc-orig"]');
    eq(await h.txt('#L1 span:last-child'), 'EN ČLANAK 1.', 'back to English');
  });
  await ctx.close();

  const ctx2 = await browser.createBrowserContext();
  const page2 = await newPage(ctx2);
  const h2 = helpers(page2);
  await page2.goto(url, { waitUntil: 'load' }); await page2.waitForSelector(D); await page2.click(D + ' [data-close]'); await h2.noDialog();
  await t('function', 'without a browser translator the app says so and offers a way forward', async () => {
    await h2.click('[data-act="doc-add"]');
    await h2.set(D + ' input[name="Country"]', 'Examplia'); await h2.set(D + ' input[name="Title"]', 'Any'); await h2.set(D + ' textarea[name="text"]', 'Article 1.\n\nText.');
    await h2.submit(); await h2.noDialog();
    const has = await page2.evaluate(() => 'Translator' in self);
    await h2.click('[data-act="doc-translate"]'); await page2.waitForSelector(D);
    if (!has) ok((await h2.txt(D)).includes('no on-device translator') && (await h2.txt(D)).includes('Chrome 138'), 'explanation shown');
    await page2.click(D + ' [data-close]');
  });
  await ctx2.close();
}

// =====================================================================================
console.log('\nGroup 4: folder sync between two simulated devices (folder picker replaced by a stand-in)');
{
  const fakeFolder = () => {
    const store = { files: new Map(), name: 'OneDrive-AnaGrid', unreadable: new Set() };
    window.__folder = store;
    const fileHandle = (name) => ({ kind: 'file', name,
      async getFile() { if (store.unreadable.has(name)) throw new DOMException('not delivered', 'NotReadableError'); const f = store.files.get(name); if (!f) throw new DOMException('nf', 'NotFoundError'); return new File([f.bytes], name, { lastModified: f.modified }); },
      async createWritable() { const chunks = []; return { async write(d) { chunks.push(d); }, async close() { store.files.set(name, { bytes: new Uint8Array(await new Blob(chunks).arrayBuffer()), modified: Date.now() }); } }; } });
    const dir = { kind: 'directory', name: store.name,
      async* entries() { for (const name of [...store.files.keys()]) yield [name, fileHandle(name)]; },
      async getFileHandle(name, opt) { if (!store.files.has(name) && !(opt && opt.create)) throw new DOMException('nf', 'NotFoundError'); return fileHandle(name); },
      async removeEntry(name) { store.files.delete(name); }, async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; } };
    window.showDirectoryPicker = async () => dir;
  };
  const exportFiles = (page) => page.evaluate(() => [...window.__folder.files.entries()].map(([n, f]) => [n, btoa(String.fromCharCode(...f.bytes)), f.modified]));
  const importFiles = (page, files) => page.evaluate((fs) => { for (const [n, b64, m] of fs) window.__folder.files.set(n, { bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), modified: m }); }, files);
  const mk = async () => { const ctx = await browser.createBrowserContext(); const page = await newPage(ctx, { init: fakeFolder }); await page.goto(url, { waitUntil: 'load' }); const h = helpers(page); await page.waitForSelector(D); await page.click(D + ' [data-close]'); await h.noDialog(); return { ctx, page, h }; };
  const A = await mk(), B = await mk();
  const addDoc = async (dev, title) => { await dev.h.go('#docs'); await dev.h.click('[data-act="doc-add"]'); await dev.h.set(D + ' input[name="Country"]', 'Examplia'); await dev.h.set(D + ' input[name="Title"]', title); await dev.h.submit(); await dev.h.noDialog(); await dev.h.go('#docs'); await dev.page.evaluate(() => document.querySelector('[data-act="doc-close"]')?.click()); };
  const pill = (dev) => dev.h.txt('#sync-text');
  const titles = async (dev) => live(await dev.h.recs(), 'doc').map((d) => d.title).sort();

  await t('function', 'sync state is always visible: saved on this device, changes waiting, saving, saved', async () => {
    eq(await pill(A), 'Saved on this device', 'before a folder is chosen');
    await A.h.go('#data'); await A.h.click('[data-act="sync-pick"]'); await sleep(300);
    eq(await pill(A), 'Saved', 'after choosing the folder');
    const names = (await exportFiles(A.page)).map((f) => f[0]);
    ok(names.length === 1 && /^anagrid-save-[a-z0-9]+-\d+\.json\.gz$/.test(names[0]), 'one gzip save file for this session: ' + names);
    await addDoc(A, 'Made-up code from device A');
    eq(await pill(A), 'Changes waiting', 'right after a change');
    await sleep(3600);
    eq(await pill(A), 'Saved', 'about 3 seconds later');
    const bytes = (await exportFiles(A.page))[0][1];
    ok(atob(bytes).charCodeAt(0) === 0x1f && atob(bytes).charCodeAt(1) === 0x8b, 'file is gzip');
  });

  await t('function', 'two devices add at the same time: both end with both entries', async () => {
    await B.h.go('#data'); await B.h.click('[data-act="sync-pick"]'); await sleep(300);
    await addDoc(B, 'Made-up code from device B');
    await addDoc(A, 'Second made-up code from device A');
    await A.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // no-op while visible
    await sleep(3600);
    // OneDrive carries each device's files to the other.
    const fa = await exportFiles(A.page), fb = await exportFiles(B.page);
    await importFiles(B.page, fa); await importFiles(A.page, fb);
    await A.h.go('#data'); await A.h.click('[data-act="sync-now"]'); await sleep(300);
    await B.h.go('#data'); await B.h.click('[data-act="sync-now"]'); await sleep(300);
    const want = ['Made-up code from device A', 'Made-up code from device B', 'Second made-up code from device A'];
    eq(await titles(A), want, 'device A'); eq(await titles(B), want, 'device B');
  });

  await t('function', 'a deletion on one device reaches the other', async () => {
    const id = live(await A.h.recs(), 'doc').find((d) => d.title === 'Made-up code from device B').id;
    await A.h.go('#docs'); await A.page.evaluate((x) => document.querySelector('[data-act="doc-open"][data-id="' + x + '"]').click(), id); await sleep(60);
    await A.h.click('[data-act="doc-delete"]'); await A.h.submit(); await A.h.noDialog();
    await A.h.go('#data'); await A.h.click('[data-act="sync-now"]'); await sleep(300);
    await importFiles(B.page, await exportFiles(A.page));
    await B.h.click('[data-act="sync-now"]'); await sleep(300);
    eq(await titles(B), ['Made-up code from device A', 'Second made-up code from device A'], 'device B after sync');
    ok((await B.h.recs()).some((r) => r.id === id && r.d === 1), 'tombstone stored on device B');
  });

  await t('function', 'a file that is not delivered yet is skipped, reported, and merged on the next sync', async () => {
    await addDoc(A, 'Late file from device A'); await A.h.go('#data'); await A.h.click('[data-act="sync-now"]'); await sleep(300);
    const fa = await exportFiles(A.page);
    await importFiles(B.page, fa);
    await B.page.evaluate((n) => window.__folder.unreadable.add(n), fa[0][0]);
    await B.h.click('[data-act="sync-now"]'); await sleep(1500); // the read is retried once with backoff before the file counts as late
    ok((await pill(B)).includes('still arriving'), 'state says a file is still arriving: ' + await pill(B));
    ok(!(await titles(B)).includes('Late file from device A'), 'not merged yet');
    await B.page.evaluate(() => window.__folder.unreadable.clear());
    await B.h.click('[data-act="sync-now"]'); await sleep(300);
    ok((await titles(B)).includes('Late file from device A'), 'merged on the next sync');
  });

  await t('function', 'writing when the page is hidden does not wait for the 3-second timer', async () => {
    await addDoc(A, 'Hidden-page write');
    eq(await pill(A), 'Changes waiting', 'pending');
    await A.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(400);
    eq(await pill(A), 'Saved', 'written at once when hidden');
    await A.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });
  });

  await t('function', 'lost folder permission shows "folder access needed"', async () => {
    await A.page.evaluate(() => { const orig = window.__folder; window.__deny = true; const d = window.showDirectoryPicker; window.showDirectoryPicker = async () => { const h = await d(); return { ...h, entries: h.entries, getFileHandle: async () => { const e = new DOMException('denied', 'NotAllowedError'); throw e; } }; }; });
    await A.h.go('#data'); await A.h.click('[data-act="sync-pick"]'); await sleep(500);
    await addDoc(A, 'After permission loss'); await A.h.go('#data'); await A.h.click('[data-act="sync-now"]'); await sleep(2500);
    eq(await pill(A), 'Folder access needed', 'state');
    ok(await A.h.has('[data-act="sync-reconnect"]'), 'Reconnect button offered');
    ok((await titles(A)).includes('After permission loss'), 'the entry is still saved on the device');
  });
  await A.ctx.close(); await B.ctx.close();
}

// =====================================================================================
console.log('\nGroup 6: find official documents by country and year');
{
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx);
  const h = helpers(page);
  const outside = [];
  page.on('request', (r) => { if (!r.url().startsWith(url) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url()); });
  await page.goto(url, { waitUntil: 'load' }); await page.waitForSelector(D); await page.click(D + ' [data-close]'); await h.noDialog();
  const ist = new Date(Date.now() + 330 * 60000);
  const today = String(ist.getUTCDate()).padStart(2, '0') + '/' + String(ist.getUTCMonth() + 1).padStart(2, '0') + '/' + ist.getUTCFullYear();
  const find = async (place, year) => { await h.set(D + ' input[name="place"]', place); await h.set(D + ' input[name="year"]', year); await h.submit(); };
  const rows = () => page.$$eval(D + ' #src-results tbody tr', (els) => els.map((e) => e.children[1].textContent.trim()));

  await t('function', 'unknown place and bad year are refused with a way forward', async () => {
    await h.click('main [data-act="src-find"]');
    eq(await page.$eval(D + ' input[name="year"]', (e) => [e.value, e.inputMode]), [String(ist.getUTCFullYear()), 'numeric'], 'year defaults to the current year, numeric keyboard');
    await find('Atlantis', '2017');
    ok((await h.txt(D + ' .form-error')).includes('"Atlantis" is not in the source catalogue yet') && (await h.txt(D + ' .form-error')).includes('What to collect'), 'unknown place');
    eq(await page.evaluate(() => document.activeElement.name), 'place', 'focus on the field to fix');
    await find('Croatia', '20x7');
    ok((await h.txt(D + ' .form-error')).includes('is not a year'), 'bad year');
    await find('', '2017');
    ok((await h.txt(D + ' .form-error')).includes('Type a country or region'), 'empty place');
  });

  await t('function', 'year 2017 lists only documents in and before 2017', async () => {
    await find('Croatia', '2017');
    ok((await h.txt(D + ' #src-results h3')).includes('Croatia: documents published up to 31/12/2017'), 'cut-off shown');
    eq(await rows(), ['NN 67/2017', 'OJ L 312, 28.11.2017', 'OJ L 220, 25.8.2017', 'OJ L 241, 8.9.2016', 'OJ L 223, 18.8.2016', 'OJ L 112, 27.4.2016'], 'six documents');
    ok((await h.txt(D + ' #src-results')).includes('7 later documents are hidden by the cut-off'), 'later documents counted');
    eq(await h.txt(D + ' .form-error'), '', 'earlier error cleared');
  });

  await t('function', 'current year runs to today; a future year is treated as today and says so', async () => {
    await find('hrvatska', String(ist.getUTCFullYear()));
    ok((await h.txt(D + ' #src-results h3')).includes('up to ' + today), 'current year: until today');
    const now = await rows();
    eq(now.length, 13, 'all thirteen entries');
    eq(now.slice(0, 3), ['NN 10/2024', 'NN 128/2020', 'NN 67/2017'], 'newest transmission code first');
    ok(!(await h.has(D + ' #src-results .note.warn')), 'no note for the current year');
    await find('Croatia', '2031');
    ok((await h.txt(D + ' #src-results .note.warn')).includes('2031 is in the future') && (await h.txt(D + ' #src-results h3')).includes('up to ' + today), 'future year note');
    eq(await rows(), now, 'same list as today');
    const states = await page.$$eval(D + ' #src-results tbody tr', (els) => els.slice(0, 3).map((e) => e.children[4].textContent.trim()));
    eq(states, ['Current', 'Supersededby NN 10/2024', 'Supersededby NN 10/2024'], 'state at the cut-off');
  });

  await t('function', 'links go to official publishers in a new tab; the page itself contacts no other site', async () => {
    const links = await page.$$eval(D + ' #src-results a[href]', (els) => els.map((e) => [new URL(e.href).protocol, new URL(e.href).hostname, e.target, e.rel]));
    ok(links.length === 18 && links.every(([proto, , target, rel]) => proto === 'https:' && target === '_blank' && rel === 'noopener noreferrer'), 'link attributes: ' + JSON.stringify(links.slice(0, 2)));
    eq([...new Set(links.map((l) => l[1]))].sort(), ['eur-lex.europa.eu', 'narodne-novine.nn.hr', 'www.entsoe.eu', 'www.hera.hr', 'www.hops.hr'], 'official hosts only');
    eq(outside, [], 'requests to other sites made by the page');
  });

  await t('function', 'found documents are added to the register once, with metadata and cut-off note', async () => {
    await h.click(D + ' [data-src-add="0"]');
    let docs = live(await h.recs(), 'doc');
    eq(docs.map((d) => [d.country, d.ref, d.published, d.status, d.kind, d.text]), [['Croatia', 'NN 10/2024', '2024-01-26', 'in_force', 'tso', '']], 'one entry');
    ok(docs[0].url.startsWith('https://narodne-novine.nn.hr/') && docs[0].notes.includes('cut-off ' + today), 'link and note stored');
    eq(await page.$eval(D + ' #src-results tbody tr', (e) => e.children[6].textContent.trim()), 'In the register', 'row marked');
    await h.click(D + ' #src-add-all');
    docs = live(await h.recs(), 'doc');
    eq(docs.length, 13, 'the other twelve added, none twice');
    eq(docs.filter((d) => d.status === 'superseded').map((d) => d.ref).sort(), ['NN 128/2020', 'NN 67/2017'], 'superseded entries marked');
    eq(await page.$eval(D + ' #src-add-all', (e) => e.disabled), true, 'nothing left to add');
    await page.click(D + ' [data-close]'); await h.noDialog();
    await h.go('#docs');
    eq(await h.count('main table.resp tbody tr'), 13, 'register lists them');
    eq(await page.$eval('#country', (e) => e.value), 'Croatia', 'country filter set');
  });

  await t('function', 'a region and a country without own entries still give official sites', async () => {
    await h.click('main [data-act="src-find"]');
    await find('EU', '2016');
    eq(await rows(), ['OJ L 241, 8.9.2016', 'OJ L 223, 18.8.2016', 'OJ L 112, 27.4.2016'], 'EU documents up to 2016');
    await find('Austria', '');
    ok((await h.txt(D + ' #src-results')).includes('No document entries for Austria yet'), 'explains the gap');
    eq(await page.$$eval(D + ' #src-results .list li b', (els) => els.map((e) => e.textContent)), ['EUR-Lex.', 'ENTSO-E member companies.'], 'official sites offered');
    eq((await rows()).length, 5, 'EU regulations apply');
    await find('India', '2018');
    eq(await rows(), ['IEGC 2010', 'Regulations 2013', 'Amendment 2013', 'Grid Standards 2010', 'No. 12/X/STD(CONN)/GM/CEA'], 'India up to 2018: grid code, distributed generation, then standards newest first; 2019 and later hidden');
    await find('Croatia', '1999');
    ok((await h.txt(D + ' #src-results .empty')).includes('No catalogued document for Croatia was published on or before 31/12/1999'), 'empty result explains itself');
  });

  await t('appearance', 'find dialog on a 320 px phone: fits, rows as cards, 44 px targets', async () => {
    await page.setViewport({ width: 320, height: 720, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await sleep(200); // switching to phone emulation reloads the page, so the dialog is opened again
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await h.go('#home'); await h.click('main [data-act="src-find"]');
    await find('Croatia', '2020'); await sleep(80);
    const m = await page.evaluate((d) => {
      const dlg = document.querySelector(d), body = dlg.querySelector('.dlg-body'), r = dlg.getBoundingClientRect();
      const small = [...dlg.querySelectorAll('button, a.btn, input')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => [e.textContent.trim().slice(0, 18) || e.name, Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)]).filter((x) => x[1] < 44 || x[2] < 44);
      return { right: r.right, vw: innerWidth, overflow: body.scrollWidth - body.clientWidth, small, td: getComputedStyle(dlg.querySelector('table.resp td')).display };
    }, D);
    ok(m.right <= m.vw && m.overflow <= 0, 'dialog fits: ' + JSON.stringify(m));
    eq(m.small, [], 'touch targets under 44 px');
    eq(m.td, 'block', 'rows as cards');
    if (shotsDir) await page.screenshot({ path: join(shotsDir, 'phone-320-find.png') });
    await page.click(D + ' [data-close]'); await h.noDialog();
    await page.setViewport({ width: 1280, height: 900 }); await sleep(200);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close())); await h.go('#docs'); await h.click('main [data-act="src-find"]'); await find('Croatia', '2020'); await sleep(80);
    const desk = await page.evaluate((d) => { const dlg = document.querySelector(d), body = dlg.querySelector('.dlg-body'), p = dlg.querySelector('.dlg-body > p'); return { bodyOverflow: body.scrollWidth - body.clientWidth, pRight: p.getBoundingClientRect().right, bodyRight: body.getBoundingClientRect().right }; }, D);
    ok(desk.bodyOverflow <= 0 && desk.pRight <= desk.bodyRight, 'desktop dialog: the text is not clipped and the body does not scroll sideways: ' + JSON.stringify(desk));
    if (shotsDir) await page.screenshot({ path: join(shotsDir, 'desktop-find.png') });
    await page.click(D + ' [data-close]'); await h.noDialog();
  });
  await ctx.close();
}

// =====================================================================================
console.log('\nGroup 5: speed of the slowest actions');
{
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx);
  const h = helpers(page);
  await page.goto(url, { waitUntil: 'load' }); await page.waitForSelector(D); await page.click(D + ' [data-close]'); await h.noDialog();
  await t('function', 'large document: 20,000 lines extract and 4,200 requirements list within budget', async () => {
    const block = GOLDEN_DOC.split('\n'); const big = [];
    for (let i = 0; i < 700; i++) big.push(...block.map((l) => l.replace(/Article (\d+)/, (_, n) => 'Article ' + (Number(n) + i * 10))));
    await h.click('[data-act="doc-add"]');
    await h.set(D + ' input[name="Country"]', 'Examplia'); await h.set(D + ' input[name="Title"]', 'Large made-up code');
    await page.$eval(D + ' textarea[name="text"]', (e, v) => { e.value = v; }, big.join('\n'));
    await h.submit(); await h.noDialog();
    let t0 = Date.now();
    await page.click('[data-act="doc-extract"]'); await page.waitForSelector(D + ' .cand');
    perf.extractDialogMs = Date.now() - t0;
    eq(await h.count(D + ' .cand'), 300, 'first 300 candidates drawn');
    ok((await h.txt(D + ' #cand-count')).includes('4200 of 4200 clauses listed; 4200 selected'), 'all 4,200 are selected');
    t0 = Date.now();
    await page.click(D + ' button[type="submit"]'); await h.noDialog(); await page.waitForSelector('#req-list tbody tr');
    perf.saveAndListMs = Date.now() - t0;
    eq(await h.count('#req-list tbody tr'), 150, 'first 150 rows rendered, the rest on demand');
    ok((await h.txt('#req-list p')).startsWith('4200 requirements'), 'all 4,200 saved: ' + await h.txt('#req-list p'));
    t0 = Date.now();
    await page.focus('#req-q'); await page.keyboard.type('5');
    await page.waitForFunction(() => document.querySelector('#req-list p').textContent.includes('requirement'));
    perf.searchKeystrokeMs = Date.now() - t0;
    t0 = Date.now(); await h.go('#dashboard'); await page.waitForSelector('.tile'); perf.dashboardMs = Date.now() - t0;
    t0 = Date.now(); await h.go('#report'); await page.waitForSelector('article.report .req'); perf.reportMs = Date.now() - t0;
    ok(perf.extractDialogMs < 4000 && perf.saveAndListMs < 4000 && perf.searchKeystrokeMs < 1000 && perf.dashboardMs < 2000 && perf.reportMs < 5000, 'timings: ' + JSON.stringify(perf));
  });
  await ctx.close();
}

await t('function', 'no console errors or policy violations during the whole run', async () => { eq(problems, [], 'problems'); });

await browser.close();
server.close();
const by = (g) => results.filter((r) => r.group === g);
const line = (g) => g + ' ' + by(g).filter((r) => r.ok).length + '/' + by(g).length;
console.log('\nTimings (ms): ' + JSON.stringify(perf));
console.log('RESULT ' + line('function') + ', ' + line('appearance') + (results.every((r) => r.ok) ? '  ALL PASS' : '  FAILURES'));
process.exit(results.every((r) => r.ok) ? 0 : 1);
