import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, toCSV, findHeader, protectText, unprotectText } from '../src/core/csv.js';
import { mergeRecord, mergeMaps } from '../src/core/merge.js';
import { canon, stableSort, cmpNatural, esc, withRetry } from '../src/core/util.js';

test('CSV round trip keeps commas, quotes, line breaks and non-ASCII text', () => {
  const rows = [['Code', 'Requirement'], ['EXA-0001', 'Remain connected, "at least" 30 min\nfor 47.5–48.5 Hz'], ['EXA-0002', ' leading space']];
  const text = toCSV(rows);
  assert.equal(text.charCodeAt(0), 0xfeff); // byte order mark
  assert.ok(text.includes('"Remain connected, ""at least"" 30 min\nfor 47.5–48.5 Hz"'));
  assert.ok(text.includes('EXA-0001,')); // plain fields are not quoted
  assert.deepEqual(parseCSV(text), rows);
});

test('reference-like text survives a spreadsheet', () => {
  assert.equal(protectText('5.10'), '="5.10"'); // would become 5.1
  assert.equal(protectText('10/2024'), '="10/2024"'); // would become a date
  assert.equal(protectText('627000000123'), '="627000000123"'); // would become 6.27E+11
  assert.equal(protectText('Article 5.10'), 'Article 5.10');
  for (const v of ['5.10', '10/2024', '627000000123', 'Article 5.10', '']) assert.equal(unprotectText(protectText(v)), v);
  const back = parseCSV(toCSV([['Clause'], [protectText('5.10')]]));
  assert.equal(unprotectText(back[1][0]), '5.10');
});

test('header row is found after preamble lines and matched by alias', () => {
  const rows = parseCSV('Exported from somewhere\nDate;13/11/2026\n\nSource;Article;Text\nExamplia Grid Code;12;The unit shall stay connected');
  const { headerIndex, columns } = findHeader(rows, { document: ['source'], clause: ['article'], requirement: ['text'] }, ['requirement']);
  assert.equal(headerIndex, 3);
  assert.deepEqual(columns, { document: 0, clause: 1, requirement: 2 });
  assert.throws(() => findHeader(parseCSV('a,b\n1,2'), { requirement: ['text'] }, ['requirement']), /No header row found/);
  assert.throws(() => parseCSV('a,"b'), /missing closing quote/);
});

test('canonical JSON ignores key order', () => {
  assert.equal(canon({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), canon({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
  assert.equal(canon({ a: 1, b: undefined }), '{"a":1}');
});

test('merge: newer update wins; exact tie settles by canonical text', () => {
  const a = { id: 'x', u: 5, v: 'old' }, b = { id: 'x', u: 6, v: 'new' };
  assert.equal(mergeRecord(a, b), b);
  assert.equal(mergeRecord(b, a), b);
  const t1 = { id: 'x', u: 7, v: 'apple' }, t2 = { v: 'banana', u: 7, id: 'x' }; // same u, different key order
  assert.equal(mergeRecord(t1, t2).v, 'banana'); // '{"id":"x","u":7,"v":"banana"}' > '...apple"}'
  assert.equal(mergeRecord(t2, t1).v, 'banana');
  const dead = { id: 'x', d: 1, u: 8 };
  assert.equal(mergeRecord(b, dead), dead); // a later deletion beats an earlier edit
  assert.equal(mergeRecord(dead, { id: 'x', u: 9, v: 'revived' }).v, 'revived'); // a later edit beats the tombstone
});

// Small seeded generator so the randomised test is repeatable.
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }
function randomMap(r, n) {
  const m = new Map();
  for (let i = 0; i < n; i++) {
    const id = 'r' + Math.floor(r() * 40);
    const u = 1 + Math.floor(r() * 6); // few distinct times, so ties are common
    m.set(id, r() < 0.2 ? { id, d: 1, u } : { id, u, v: Math.floor(r() * 3), w: r() < 0.5 ? 'p' : 'q' });
  }
  return m;
}
const same = (x, y) => canon([...x.entries()].sort()) === canon([...y.entries()].sort());

test('merge is commutative, associative and idempotent on randomised data', () => {
  const r = rng(20261113);
  for (let k = 0; k < 300; k++) {
    const a = randomMap(r, 30), b = randomMap(r, 30), c = randomMap(r, 30);
    assert.ok(same(mergeMaps(a, b), mergeMaps(b, a)), 'commutative');
    assert.ok(same(mergeMaps(mergeMaps(a, b), c), mergeMaps(a, mergeMaps(b, c))), 'associative');
    assert.ok(same(mergeMaps(a, a), a), 'idempotent');
    assert.ok(same(mergeMaps(mergeMaps(a, b), b), mergeMaps(a, b)), 'idempotent on repeat');
  }
});

test('stable sort breaks ties by the next key, then by original order', () => {
  const rows = [{ n: 'b', d: 2 }, { n: 'a', d: 2 }, { n: 'c', d: 1 }, { n: 'a', d: 2, tag: 'second' }];
  const out = stableSort(rows, (x, y) => x.d - y.d, (x, y) => cmpNatural(x.n, y.n));
  assert.deepEqual(out.map((x) => x.n + (x.tag || '')), ['c', 'a', 'asecond', 'b']);
  assert.ok(cmpNatural('Article 9', 'Article 10') < 0);
  assert.ok(cmpNatural('CRO-0002', 'CRO-0010') < 0);
});

test('HTML escaping blocks injection', () => {
  assert.equal(esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(esc("a'b&c"), 'a&#39;b&amp;c');
  assert.equal(esc(null), '');
});

test('a failing call is retried with backoff and never hangs', async () => {
  let calls = 0; const waits = [];
  const v = await withRetry(async () => { calls++; if (calls < 3) throw new Error('down'); return 'ok'; }, { sleep: async (ms) => { waits.push(ms); } });
  assert.equal(v, 'ok'); assert.equal(calls, 3); assert.deepEqual(waits, [400, 800]);
  await assert.rejects(withRetry(() => new Promise(() => {}), { tries: 2, timeoutMs: 20, sleep: async () => {} }), /Timed out/);
});
