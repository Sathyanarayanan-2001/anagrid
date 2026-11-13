import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, segment, findThresholds, parseNumber, citeLabel, modality, categorise, relevance, findFlags, guessLanguage } from '../src/core/extract.js';
import { GOLDEN_DOC, GOLDEN } from './golden.mjs';

const pick = (t) => { const o = { cmp: t.cmp, lo: t.lo, unit: t.unit }; if (t.hi !== undefined) o.hi = t.hi; if (t.qty) o.qty = t.qty; return o; };
const norm = (list) => list.map(pick).map((o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort())));

/** Rubric: one point each for correct, complete, format followed. */
export function score(item, g) {
  const correct = item.cite.clause === g.clause && item.cite.para === g.para && item.modality === g.modality && item.cat === g.cat && item.rel === g.rel;
  const complete = JSON.stringify(norm(item.thresholds)) === JSON.stringify(norm(g.thresholds)) &&
    JSON.stringify(item.flags.map((f) => f.code)) === JSON.stringify(g.flags) && item.cite.heading === g.heading;
  const format = /^Article \d+(, para \(\d+\))?, lines? \d+(-\d+)?$/.test(citeLabel(item.cite)) && item.cite.line === g.line && item.isReq === true;
  return { correct, complete, format, points: correct + complete + format };
}

test('golden examples: 5 examples, 3 rubric points each, 15 of 15', () => {
  const { items, mode } = analyse(GOLDEN_DOC);
  assert.equal(mode, 'article');
  let total = 0;
  for (const g of GOLDEN) {
    const item = items.find((i) => i.cite.clause === g.clause && i.cite.para === g.para);
    assert.ok(item, g.name + ': clause found');
    const s = score(item, g);
    assert.deepEqual({ correct: s.correct, complete: s.complete, format: s.format }, { correct: true, complete: true, format: true }, g.name + ' -> ' + JSON.stringify({ item, s }));
    total += s.points;
  }
  assert.equal(total, 15);
  assert.equal(items.length, 6); // six paragraphs in the sample; the title line is not a clause
});

test('thresholds: comparators, ranges, decimal comma and thousands comma', () => {
  const t = (s) => findThresholds(s).map(pick);
  assert.deepEqual(t('shall not exceed 10% of rated power'), [{ cmp: '<=', lo: 10, unit: '%' }]);
  assert.deepEqual(t('adjustable between 2% and 12%'), [{ cmp: 'range', lo: 2, unit: '%', hi: 12 }]);
  assert.deepEqual(t('dead band 20 - 200 mHz'), [{ cmp: 'range', lo: 20, unit: 'mHz', hi: 200 }]);
  assert.deepEqual(t('threshold 50,2 Hz'), [{ cmp: '=', lo: 50.2, unit: 'Hz' }]); // decimal comma
  assert.deepEqual(t('for a maximum of 15,000 minutes per year'), [{ cmp: '<=', lo: 15000, unit: 'min' }]); // thousands comma
  assert.deepEqual(t('accuracy within ±0.5% of Un'), [{ cmp: '±', lo: 0.5, unit: '%' }]);
  assert.deepEqual(t('cleared within 150 ms at 110 kV and 220 kV'), [{ cmp: '<=', lo: 150, unit: 'ms' }, { cmp: '=', lo: 110, unit: 'kV' }, { cmp: '=', lo: 220, unit: 'kV' }]);
  assert.deepEqual(t('cos φ ≥ 0.95 (inductive or capacitive)'), [{ cmp: '>=', lo: 0.95, unit: '', qty: 'cos φ' }]);
  assert.deepEqual(t('t >30 min'), [{ cmp: '>', lo: 30, unit: 'min' }]);
  assert.deepEqual(t('see Article 25, type A, 2024'), []); // numbers without units are not thresholds
  assert.deepEqual(parseNumber('0,950', 'pu'), { value: 0.95, ambiguous: false });
  assert.deepEqual(parseNumber('49,950', 'Hz'), { value: 49.95, ambiguous: false }); // 49950 Hz is implausible
  assert.equal(parseNumber('15,000', 'min').ambiguous, true); // both readings possible: flagged for confirmation
});

test('segmentation: heading glued to marker, heading after marker, reference inside a sentence', () => {
  const text = [
    '1.  Frequency Control Process (FCP) Article 124.', '', 'Each module must take part in frequency control.', '',
    'Article 125', '', 'General requirements for type A modules', '', '1. Modules shall comply with points (a) and (b) as required in accordance with Article', '',
    '13.1 of this Regulation and with Article 25.', '', '    -   first item,', '', '    -   second item.', '',
    'Article 126.', '', 'The synchro-', '', 'nization device shall be automatic.',
  ].join('\n');
  const { units, mode } = segment(text);
  assert.equal(mode, 'article');
  assert.deepEqual(units.map((u) => u.clause), ['Article 124', 'Article 125', 'Article 126']);
  assert.equal(units[0].heading, 'Frequency Control Process (FCP)');
  assert.equal(units[1].heading, 'General requirements for type A modules');
  assert.equal(units[1].para, '1.');
  assert.ok(units[1].text.includes('Article 25.') && units[1].text.includes('-   second item.')); // "Article 25." did not start a new clause
  assert.equal(units[1].line, 9); assert.equal(units[1].lineEnd, 15);
  assert.equal(units[2].text, 'The synchronization device shall be automatic.'); // hyphenated line break re-joined
});

test('numbered heading glued to a marker is a clause start even with commas or a reference word', () => {
  const text = ['1.1.4.3 Evaluation, Replacement, and Verification of Measured Data Article 205.', '', 'Data shall be verified.', '',
    '1.1.5.1 Data of the billing metering point Article 209.', '', 'Data must be stored.', '', 'Operators shall act in accordance with Article 205.', '', 'Article 210.', '', 'Codes shall be unique.'].join('\n');
  const { units } = segment(text);
  assert.deepEqual(units.map((u) => [u.clause, u.heading]), [['Article 205', 'Evaluation, Replacement, and Verification of Measured Data'], ['Article 209', 'Data of the billing metering point'], ['Article 210', '']]);
  assert.ok(units[1].text.endsWith('in accordance with Article 205.')); // the reference stayed inside Article 209
});

test('table rows become separate citable rows with their column header', () => {
  const text = 'Annex II Requirements of general application\n\nAspect | Article | Value\nFrequency ranges | 13.1.a | 47.5Hz - 48.5Hz, ≥ 30 min\nLFSM-O | 13.2.a | Threshold: 50,2 Hz; droop adjustable 2 % - 12 %\n';
  const { items } = analyse(text);
  assert.equal(items.length, 2);
  assert.equal(items[0].cite.clause, 'Annex II');
  assert.equal(items[0].cite.para, 'row 1');
  assert.equal(items[0].ctx, 'Aspect | Article | Value');
  assert.equal(citeLabel(items[1].cite), 'Annex II, row 2, line 5');
  assert.deepEqual(items[1].thresholds.map(pick), [{ cmp: '=', lo: 50.2, unit: 'Hz' }, { cmp: 'range', lo: 2, unit: '%', hi: 12 }]);
  assert.equal(items[1].cat, 'lfsm');
});

test('page numbers come from form feeds; numbered headings work without article markers', () => {
  const text = '4.1 Voltage ranges\nThe plant shall operate between 0.90 pu and 1.10 pu.\n\f4.2 Protection\nRelay settings must be agreed with the operator.\n4.3 Models\nA model shall be delivered.\n';
  const { items, mode, hasPages } = analyse(text);
  assert.equal(mode, 'heading'); assert.equal(hasPages, true);
  assert.deepEqual(items.map((i) => [i.cite.clause, i.cite.page, i.cite.line]), [['4.1', 1, 2], ['4.2', 2, 4], ['4.3', 2, 6]]);
  assert.equal(citeLabel(items[1].cite), '4.2, p. 2, line 4');
  assert.equal(items[0].cat, 'v_range');
});

test('classification helpers', () => {
  assert.equal(modality('The unit may disconnect.'), 'permitted');
  assert.equal(modality('The nominal frequency is 50 Hz.'), 'info');
  assert.equal(modality('Proizvodni modul mora ostati priključen.'), 'mandatory'); // Croatian, before translation
  assert.equal(categorise('Fault ride-through capability shall follow the limit curve'), 'frt');
  assert.equal(categorise('nothing special here'), 'general');
  assert.equal(relevance('excitation system of the synchronous generator'), 'sync');
  assert.equal(relevance('billing meters shall be class 0.2'), 'other');
  const codes = (s) => findFlags(s, findThresholds(s)).map((f) => f.code);
  assert.deepEqual(codes('Limits follow IEC/TR 61000-3-6 and Article 25(2).'), ['STANDARD', 'XREF']);
  assert.deepEqual(codes('The value is not yet defined.'), ['PENDING']);
  assert.deepEqual(codes('The response shall be delivered without delay.'), ['VAGUE']);
  assert.deepEqual(codes('See the curve [] below.'), ['IMAGE']);
  assert.equal(guessLanguage('Proizvodni modul mora ostati priključen na mrežu i mora raditi u skladu sa zahtjevima operatora prijenosnog sustava za sve tipove modula ili jedinica na mreži od 110 kV i više.').lang, 'hr');
  assert.equal(guessLanguage('The module shall remain connected to the network and must operate in accordance with the requirements of the operator for all types of modules.').lang, 'en');
});

test('analysis is deterministic and linear enough: 20,000 lines under 2 seconds', () => {
  const block = GOLDEN_DOC.split('\n');
  const big = [];
  for (let i = 0; i < 700; i++) big.push(...block.map((l) => l.replace(/Article (\d+)/, (_, n) => 'Article ' + (Number(n) + i * 10))));
  const text = big.join('\n');
  const t0 = performance.now();
  const a = analyse(text);
  const ms = performance.now() - t0;
  assert.ok(a.lineCount > 20000);
  assert.ok(ms < 2000, 'took ' + ms.toFixed(0) + ' ms');
  assert.deepEqual(analyse(text).items.length, a.items.length);
});
