import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, capIndex, compare, findConflicts, validateCheck } from '../src/core/evaluate.js';
import { dashboard } from '../src/core/stats.js';
import { editReq } from '../src/core/model.js';
import { seeded, cap } from './helpers.mjs';

const req = (checks, manual) => ({ id: 'q', checks, manual });

test('determination from checks: every outcome', () => {
  const caps = capIndex([cap('RoCoF withstand', 2.5, 'Hz/s'), cap('Operating time at 47.5-48.5 Hz', 20, 'min'), cap('FSM initial delay', 150, 'ms')]);
  const ok = { cap: 'RoCoF withstand', cmp: '>=', value: 2, unit: 'Hz/s' }; // 2.5 >= 2 -> met
  const bad = { cap: 'Operating time at 47.5-48.5 Hz', cmp: '>=', value: 30, unit: 'min' }; // 20 >= 30 -> not met
  const none = { cap: 'LFSM-O droop minimum setting', cmp: '<=', value: 2, unit: '%' }; // no value recorded
  assert.equal(evaluate(req([ok]), caps).status, 'COMPLIANT');
  assert.equal(evaluate(req([bad]), caps).status, 'NON_COMPLIANT');
  assert.equal(evaluate(req([ok, bad]), caps).status, 'PARTIAL');
  assert.equal(evaluate(req([ok, none]), caps).status, 'INSUFFICIENT'); // one pass does not prove the rest
  assert.equal(evaluate(req([bad, none]), caps).status, 'NON_COMPLIANT');
  assert.equal(evaluate(req([ok, bad, none]), caps).status, 'PARTIAL');
  assert.equal(evaluate(req([]), caps).status, 'INSUFFICIENT'); // nothing recorded: never assumed compliant
  // Units are converted explicitly: 150 ms against a limit of 0.5 s -> 0.15 s <= 0.5 s.
  const r = evaluate(req([{ cap: 'FSM initial delay', cmp: '<=', value: 0.5, unit: 's' }]), caps);
  assert.equal(r.status, 'COMPLIANT'); assert.equal(r.details[0].actual, 0.15);
});

test('edge cases are reported: unit mismatch, no margin, missing evidence, manual conflict', () => {
  const caps = capIndex([cap('RoCoF withstand', 2, 'Hz/s', ''), cap('Minimum continuous voltage', 0.9, 'pu')]);
  const edge = evaluate(req([{ cap: 'RoCoF withstand', cmp: '>=', value: 2, unit: 'Hz/s' }]), caps);
  assert.equal(edge.status, 'COMPLIANT');
  assert.ok(edge.notes.some((n) => /exactly on the limit/.test(n)));
  assert.ok(edge.notes.some((n) => /no evidence reference/.test(n)));
  const mism = evaluate(req([{ cap: 'Minimum continuous voltage', cmp: '<=', value: 99, unit: 'kV' }]), caps);
  assert.equal(mism.status, 'INSUFFICIENT'); // pu cannot be compared with kV: no data, not a pass
  assert.ok(mism.notes.some((n) => /Unit mismatch/.test(n)));
  const conflict = evaluate(req([{ cap: 'RoCoF withstand', cmp: '>=', value: 3, unit: 'Hz/s' }], { status: 'COMPLIANT', evidence: 'x' }), caps);
  assert.equal(conflict.status, 'NON_COMPLIANT');
  assert.ok(conflict.notes.some((n) => /differs from the computed result/.test(n)));
});

test('manual determinations need evidence', () => {
  const none = new Map();
  assert.equal(evaluate(req([], { status: 'COMPLIANT', evidence: 'Made-up certificate C-9, clause 3' }), none).status, 'COMPLIANT');
  assert.equal(evaluate(req([], { status: 'COMPLIANT', evidence: '  ' }), none).status, 'INSUFFICIENT');
  assert.equal(evaluate(req([], { status: 'NON_COMPLIANT', evidence: '' }), none).status, 'NON_COMPLIANT');
  const { reqs } = seeded();
  assert.throws(() => editReq(reqs[0], { status: 'COMPLIANT', evidence: '' }), /needs evidence/);
  assert.throws(() => editReq(reqs[0], { status: 'MAYBE' }), /Choose a determination/);
  assert.throws(() => editReq(reqs[0], { checks: [{ cap: 'x', cmp: '>=', value: 'abc', unit: 'Hz' }] }), /must be a number/);
  assert.throws(() => editReq(reqs[0], { checks: [{ cap: 'x', cmp: '>=', value: '1', unit: 'parsec' }] }), /not known/);
  assert.throws(() => validateCheck({ cap: '', cmp: '>=', value: 1, unit: 'Hz' }), /Choose the turbine capability/);
  assert.equal(compare(0.1 + 0.2, '=', 0.3), true); // tolerance absorbs float noise
  assert.equal(compare(2, '>', 2), false);
});

test('cross-document discrepancy: same band, different values', () => {
  const t = (lo, hi, unit) => ({ cmp: 'range', lo, hi, unit, raw: '' });
  const a = { id: 'a', docId: 'd1', country: 'Examplia', thresholds: [t(48.5, 49, 'Hz'), { cmp: '>=', lo: 30, unit: 'min', raw: '' }] };
  const b = { id: 'b', docId: 'd2', country: 'Examplia', thresholds: [t(48.5, 49, 'Hz'), { cmp: '>=', lo: 60, unit: 'min', raw: '' }] };
  const c = { id: 'c', docId: 'd2', country: 'Examplia', thresholds: [t(47.5, 48.5, 'Hz'), { cmp: '>=', lo: 30, unit: 'min', raw: '' }] };
  const same = { id: 'e', docId: 'd3', country: 'Examplia', thresholds: [t(48.5, 49, 'Hz'), { cmp: '>=', lo: 30, unit: 'min', raw: '' }] };
  const out = findConflicts([a, b, c, same]);
  assert.deepEqual(out.map((x) => [x.a, x.b, x.band]), [['a', 'b', '48.5-49 Hz'], ['b', 'e', '48.5-49 Hz']]);
  assert.equal(out[0].va, '>= 30 min'); assert.equal(out[0].vb, '>= 60 min');
});

test('every dashboard figure equals a number computed separately', () => {
  const { store, doc, reqs } = seeded();
  // Second made-up document in another country, plus capabilities, determinations and costs.
  store.put({ id: 'doc_b', t: 'doc', country: 'Samplestan', title: 'Sample DSO code', kind: 'dso', text: '' });
  store.put({ ...reqs[0], id: 'req_other', docId: 'doc_b', country: 'Samplestan', code: 'SAM-0001', cost: 5000 });
  store.put(cap('RoCoF withstand', 2.5, 'Hz/s'));
  store.put(editReq(reqs[2], { checks: [{ cap: 'RoCoF withstand', cmp: '>=', value: '2', unit: 'Hz/s' }], cost: '1,23,456.78' })); // COMPLIANT
  store.put(editReq(reqs[0], { status: 'NON_COMPLIANT', evidence: '', cost: '0.22' }));
  store.put(editReq(reqs[5], { status: 'PARTIAL', evidence: 'Made-up model report M-2' }));
  const data = { docs: store.all('doc'), reqs: store.all('req'), caps: store.all('cap') };
  const d = dashboard(data);

  // Independent computation: plain loops, no shared helpers.
  let nReq = 0, nThr = 0, nFlag = 0, cost = 0;
  const cat = {}, st = { COMPLIANT: 0, PARTIAL: 0, NON_COMPLIANT: 0, INSUFFICIENT: 0 };
  for (const r of data.reqs) {
    nReq++; if (r.thresholds.length) nThr++; if (r.flags.length) nFlag++; cost += r.cost || 0;
    cat[r.cat] = (cat[r.cat] || 0) + 1;
    let s = 'INSUFFICIENT';
    if (r.checks.length) s = 'COMPLIANT'; // the only checked requirement passes: 2.5 >= 2
    else if (r.manual && r.manual.status) s = r.manual.status;
    st[s]++;
  }
  assert.equal(d.docs, 2); assert.equal(d.countries, 2);
  assert.equal(d.reqs, nReq); assert.equal(nReq, 7);
  assert.equal(d.withThresholds, nThr); assert.equal(d.flagged, nFlag);
  assert.equal(d.costPaise, cost); assert.equal(cost, 12345678 + 22 + 5000);
  assert.deepEqual(Object.fromEntries(d.byStatus.map((s) => [s.id, s.n])), st);
  assert.deepEqual(st, { COMPLIANT: 1, PARTIAL: 1, NON_COMPLIANT: 1, INSUFFICIENT: 4 });
  assert.equal(d.determined, 3); assert.equal(d.determinedShare, 3 / 7);
  assert.deepEqual(Object.fromEntries(d.byCategory.map((c) => [c.id, c.n])), cat);
  assert.equal(d.byCategory.reduce((a, c) => a + c.n, 0), nReq);
  assert.deepEqual(d.byKind.map((k) => [k.id, k.n]), [['tso', 1], ['dso', 1]]);
  assert.deepEqual(d.byDoc.map((x) => x.n).sort(), [1, 6]);
  // Country filter
  const e = dashboard(data, { country: 'Examplia' });
  assert.equal(e.docs, 1); assert.equal(e.reqs, 6); assert.equal(e.costPaise, 12345678 + 22);
  assert.equal(doc.country, 'Examplia');
});
