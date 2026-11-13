import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { Store, MemoryAdapter } from '../src/core/store.js';
import { planReqImport, planCapImport, reqsToCSV, capsToCSV, makeBackup, readBackup } from '../src/core/transfer.js';
import { buildReport, reportToMarkdown, reportToHTML } from '../src/core/report.js';
import { docxToText, docXmlToText } from '../src/core/docx.js';
import { makeDoc, editReq, makeCap, cleanUrl } from '../src/core/model.js';
import { sumPaise } from '../src/core/money.js';
import { seeded, cap, clock } from './helpers.mjs';

const CSV_IN = [
  'Requirement sheet prepared for a made-up project',
  'Printed;13/11/2026',
  '',
  'Source;Article;Para;Text;Assessment;Remarks;Cost to close;Due date',
  'Examplia Grid Code;="5.10";(1);The plant shall withstand 2 Hz/s.;Compliant;Made-up report TR-7 section 2;1,23,456.78;28/10',
  'Examplia Grid Code;Article 6;;The plant shall ride through faults.;Compliant;;;',
  'Unknown Code;Article 1;;The plant shall exist.;;;;',
  'Examplia Grid Code;Article 7;;;;;;',
  'Examplia Grid Code;Article 8;;The plant should be nice.;Perhaps;;;',
  'Examplia Grid Code;Article 9;;Ramp rate must not exceed 10% per minute.;Non-compliant;;12.345;',
  'Examplia Grid Code;="5.10";(1);The plant shall withstand 2 Hz/s.;;;;',
  'Examplia Grid Code;Article 10;;Voltage control must be available.;;;;31/02/2027',
].join('\n');

test('import plan: header after preamble, aliases, a status per row, nothing saved until commit', () => {
  const { store } = seeded();
  const before = store.dump().length;
  const plan = planReqImport(CSV_IN, { docs: store.all('doc'), reqs: store.all('req'), refYear: 2026 });
  assert.equal(plan.headerIndex, 3);
  assert.deepEqual(plan.rows.map((r) => [r.n, r.status]), [[5, 'ok'], [6, 'error'], [7, 'error'], [8, 'error'], [9, 'error'], [10, 'error'], [11, 'duplicate'], [12, 'error']]);
  assert.match(plan.rows[1].msg, /needs an evidence reference/);
  assert.match(plan.rows[2].msg, /not in the register/);
  assert.match(plan.rows[3].msg, /Requirement text is empty/);
  assert.match(plan.rows[4].msg, /Status "Perhaps" is not known/);
  assert.match(plan.rows[5].msg, /at most two decimals/);
  assert.match(plan.rows[7].msg, /does not exist in the calendar/);
  assert.equal(store.dump().length, before); // planning saved nothing
  const rec = plan.rows[0].rec;
  assert.equal(rec.cite.clause, '5.10'); // text kept, not turned into 5.1
  assert.equal(rec.cost, 12345678); assert.equal(rec.due, '2026-10-28'); assert.equal(rec.code, 'EXA-0007');
  assert.deepEqual(rec.manual, { status: 'COMPLIANT', evidence: 'Made-up report TR-7 section 2' });
  assert.equal(rec.cat, 'rocof');
  store.putMany(plan.rows.filter((r) => r.status === 'ok').map((r) => r.rec)); // commit
  assert.equal(store.all('req').length, 7);
});

test('capability import validates numbers and units', () => {
  const plan = planCapImport('Capability,Actual,UoM,Proof\nRoCoF withstand,"2,5",Hz/s,Made-up TR-1\nFRT duration,fast,ms,\nModel available,yes,yes/no,\nRoCoF withstand,3,Hz/s,\nOdd,1,parsec,', { caps: [] });
  assert.deepEqual(plan.rows.map((r) => r.status), ['ok', 'error', 'ok', 'duplicate', 'error']);
  assert.equal(plan.rows[0].rec.value, 2.5); assert.equal(plan.rows[2].rec.value, 1); assert.equal(plan.rows[2].rec.unit, 'bool');
  assert.match(plan.rows[1].msg, /must be a number/); assert.match(plan.rows[4].msg, /not known/);
});

test('round trip: export everything, import into an empty copy, counts and totals match', async () => {
  const { store, reqs } = seeded();
  store.put(cap('RoCoF withstand', 2.5, 'Hz/s'));
  store.put(editReq(reqs[0], { cost: '1,23,456.78', status: 'NON_COMPLIANT', evidence: '' }));
  store.put(editReq(reqs[1], { cost: '0.10', due: '31/03/2027' }));
  store.put(editReq(reqs[2], { cost: '99,999.99' }));
  store.remove(reqs[5].id);
  const count = (s) => ({ doc: s.all('doc').length, req: s.all('req').length, cap: s.all('cap').length, all: s.dump().length, cost: sumPaise(s.all('req').map((r) => r.cost)) });
  // JSON backup
  const copy = new Store(new MemoryAdapter(), clock());
  copy.mergeIn(readBackup(makeBackup(store.dump(), 1)));
  assert.deepEqual(count(copy), count(store));
  assert.deepEqual(count(copy), { doc: 1, req: 5, cap: 1, all: 8, cost: 12345678 + 10 + 9999999 }); // 2,23,456.87 by hand
  assert.equal(copy.get(reqs[5].id), undefined); // the deletion travelled as a tombstone
  // CSV: requirements and capabilities into a copy that holds only the document
  const csvCopy = new Store(new MemoryAdapter(), clock());
  csvCopy.put(store.all('doc')[0]);
  const csv = reqsToCSV(store.all('req'), store.all('doc'), store.all('cap'));
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const plan = planReqImport(csv, { docs: csvCopy.all('doc'), reqs: [], refYear: 2026 });
  assert.equal(plan.okCount, 5); assert.equal(plan.rows.length, 5);
  csvCopy.putMany(plan.rows.map((r) => r.rec));
  const capPlan = planCapImport(capsToCSV(store.all('cap')), { caps: [] });
  csvCopy.putMany(capPlan.rows.map((r) => r.rec));
  assert.deepEqual({ ...count(csvCopy), all: 0 }, { ...count(store), all: 0 });
  const texts = (s) => s.all('req').map((r) => r.text).sort();
  assert.deepEqual(texts(csvCopy), texts(store));
  assert.equal(csvCopy.all('req').find((r) => r.due).due, '2027-03-31');
});

test('backup reader rejects wrong files with a clear message', () => {
  assert.throws(() => readBackup('not json'), /not valid JSON/);
  assert.throws(() => readBackup('{"app":"other","recs":[]}'), /not an AnaGrid backup/);
  assert.throws(() => readBackup('{"app":"anagrid","v":2,"recs":[]}'), /newer AnaGrid/);
  assert.equal(readBackup('{"app":"anagrid","v":1,"recs":[{"id":"a","t":"doc","u":1},{"id":"b","t":"evil","u":1},{"id":5}]}').length, 1);
});

test('input validation: documents and capabilities', () => {
  assert.throws(() => makeDoc({ country: '', title: 'x' }), /Country is required/);
  assert.throws(() => makeDoc({ country: 'Examplia', title: 'x', kind: 'novel' }), /document type/);
  assert.throws(() => makeDoc({ country: 'Examplia', title: 'x', url: 'javascript:alert(1)' }), /Only http and https/);
  assert.throws(() => makeDoc({ country: 'Examplia', title: 'x', published: '31/04/2026' }), /does not exist/);
  assert.equal(cleanUrl('https://example.org/code.pdf'), 'https://example.org/code.pdf');
  assert.equal(makeDoc({ country: ' Examplia ', title: 'Code', ref: '10/2024', published: '28/10/2024' }).published, '2024-10-28');
  assert.throws(() => makeCap({ key: '', value: '1', unit: 'Hz' }), /Parameter is required/);
  assert.equal(makeCap({ key: 'X', value: '47,5', unit: 'hz' }).value, 47.5);
});

test('requirements document: citations, determinations, findings; all values escaped', () => {
  const { store, reqs } = seeded();
  store.put(cap('RoCoF withstand', 2.5, 'Hz/s'));
  store.put(editReq(reqs[2], { checks: [{ cap: 'RoCoF withstand', cmp: '>=', value: '2', unit: 'Hz/s' }] }));
  store.put(editReq(reqs[4], { text: 'Setpoint <script>alert(1)</script> shall be reached within 1 minute.' }));
  const rep = buildReport({ docs: store.all('doc'), reqs: store.all('req'), caps: store.all('cap'), country: 'Examplia', now: Date.UTC(2026, 10, 13, 1, 53), version: '1.0.0' });
  assert.equal(rep.rows.length, 6);
  assert.deepEqual(Object.fromEntries(rep.counts), { COMPLIANT: 1, PARTIAL: 0, NON_COMPLIANT: 0, INSUFFICIENT: 5 });
  const md = reportToMarkdown(rep);
  assert.ok(md.includes('Generated 13/11/2026 07:23'));
  assert.ok(md.includes('#### EXA-0003 — COMPLIANT'));
  assert.ok(md.includes('- Source: 10/2024, Examplia Grid Code — Article 13, line 15'));
  assert.ok(md.includes('RoCoF withstand >= 2 Hz/s: recorded 2.5 Hz/s -> met'));
  assert.ok(md.includes('#### EXA-0001 — INSUFFICIENT DATA'));
  assert.ok(md.includes('Refers to Figure 4'));
  assert.ok(md.includes('| 10/2024 | Examplia Grid Code | Transmission grid code |  | 28/10/2024 | English | In force |'));
  const html = reportToHTML(rep);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.equal(rep.blockers.length, 5); // everything not proven compliant is listed as a possible blocker
});

// Minimal ZIP writer so the .docx reader is tested without any fixture file.
function zip(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
  const u16 = (n) => [n & 255, n >> 8], u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, text, method] of files) {
    const raw = enc.encode(text), data = method === 8 ? deflateRawSync(raw) : raw, nm = enc.encode(name);
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(nm.length), ...u16(0), ...nm];
    parts.push(Uint8Array.from(local), data);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nm]));
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end]; const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0)); let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const P = (t, extra = '') => '<w:p>' + extra + '<w:r><w:t xml:space="preserve">' + t + '</w:t></w:r></w:p>';
const DOC = '<?xml version="1.0"?><w:document ' + W + '><w:body>' +
  P('Article 1.') + P('The unit shall stay connected at 47.5 Hz &amp; above.', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>') +
  P('Second point.', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>') +
  '<w:p><w:r><w:t>See curve</w:t></w:r><w:r><w:drawing><wp:inline/></w:drawing></w:r><w:del><w:r><w:t>deleted words</w:t></w:r></w:del></w:p>' +
  '<w:tbl><w:tr><w:tc>' + P('Range') + '</w:tc><w:tc>' + P('Time') + '</w:tc></w:tr><w:tr><w:tc>' + P('47.5 Hz – 48.5 Hz') + '</w:tc><w:tc>' + P('30 min') + P('minimum') + '</w:tc></w:tr></w:tbl>' +
  '</w:body></w:document>';
const NUMBERING = '<w:numbering ' + W + '><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="(%1)"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

test('.docx reader: paragraphs, automatic numbering, tables, images, tracked deletions', async () => {
  const expected = 'Article 1.\n\n(1) The unit shall stay connected at 47.5 Hz & above.\n\n(2) Second point.\n\nSee curve []\n\nRange | Time\n47.5 Hz – 48.5 Hz | 30 min minimum\n';
  assert.equal(docXmlToText(DOC, NUMBERING), expected);
  for (const method of [0, 8]) { // stored and deflated archives
    const bytes = zip([['[Content_Types].xml', '<Types/>', method], ['word/document.xml', DOC, method], ['word/numbering.xml', NUMBERING, method]]);
    assert.equal(await docxToText(bytes), expected);
  }
  await assert.rejects(docxToText(new Uint8Array([1, 2, 3, 4])), /not a valid \.docx/);
  await assert.rejects(docxToText(zip([['other.txt', 'x', 0]])), /not a Word document/);
});
