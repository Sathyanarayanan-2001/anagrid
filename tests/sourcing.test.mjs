import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveYear, resolvePlace, findSources, onOrBefore, dateLabel, toRegisterInput, placeNames } from '../src/core/sourcing.js';
import { CATALOG, DOCS, BODIES, COUNTRIES, REGIONS } from '../src/sources/catalog.js';
import { DOC_KIND_BY_ID } from '../src/core/catalog.js';
import { makeDoc } from '../src/core/model.js';
import { InputError } from '../src/core/util.js';

const TODAY = { y: 2026, m: 11, d: 13 };
// Made-up catalogue so the rules are tested apart from the real entries.
const CAT = {
  COUNTRIES: [['EX', 'Examplia', ['exampleland']], ['SA', 'Samplestan', []], ['NO', 'Nodocia', []]],
  REGIONS: [{ code: 'UN', name: 'Example Union', aliases: ['union'], members: ['EX', 'NO'] }],
  BODIES: [{ scope: 'EX', name: 'Examplia operator', role: 'Operator', url: 'https://example.org/op' }, { scope: 'UN', name: 'Union journal', role: 'Journal', url: 'https://example.org/j' }],
  DOCS: [
    { scope: 'EX', kind: 'tso', series: 'code', role: 'base', title: 'Code 2012', issuer: 'Op', ref: 'G 1/2012', date: '2012-03-01', lang: 'English', url: 'https://example.org/2012' },
    { scope: 'EX', kind: 'tso', series: 'code', role: 'amendment', title: 'Amendment 2015', issuer: 'Op', ref: 'G 9/2015', date: '2015-06-30', lang: 'English', url: 'https://example.org/2015' },
    { scope: 'EX', kind: 'tso', series: 'code', role: 'base', title: 'Code 2017', issuer: 'Op', ref: 'G 4/2017', date: '2017-12-31', lang: 'English', url: 'https://example.org/2017' },
    { scope: 'EX', kind: 'tso', series: 'code', role: 'amendment', title: 'Amendment 2018', issuer: 'Op', ref: 'G 2/2018', date: '2018-01-01', lang: 'English', url: 'https://example.org/2018' },
    { scope: 'EX', kind: 'dso', series: 'dcode', role: 'base', title: 'Distribution code', issuer: 'Op', ref: 'D 2026', date: '2026', lang: 'English', url: 'https://example.org/d', direct: false },
    { scope: 'EX', kind: 'other', series: 'late', role: 'base', title: 'Issued after today', issuer: 'Op', ref: 'L', date: '2026-11-14', lang: 'English', url: 'https://example.org/l' },
    { scope: 'UN', kind: 'eu', series: 'reg', role: 'base', title: 'Union regulation', issuer: 'Union', ref: 'UJ 5', date: '2016-04-27', lang: 'English', url: 'https://example.org/u' },
  ],
};

test('year cut-off: past year, current year, future year, empty and invalid input', () => {
  assert.deepEqual(resolveYear('2017', TODAY), { year: 2017, cutoff: { y: 2017, m: 12, d: 31 }, note: '' }); // in and before 2017
  assert.deepEqual(resolveYear('2026', TODAY).cutoff, TODAY); // current year: until today
  assert.deepEqual(resolveYear('', TODAY).cutoff, TODAY);
  const future = resolveYear('2031', TODAY); // typed by mistake
  assert.deepEqual(future.cutoff, TODAY);
  assert.match(future.note, /2031 is in the future.*13\/11\/2026/);
  assert.throws(() => resolveYear('20x7', TODAY), InputError);
  assert.throws(() => resolveYear('17', TODAY), /four digits/);
  assert.throws(() => resolveYear('1850', TODAY), /too early/);
});

test('dates: full dates compare by day, year-only dates by year', () => {
  assert.equal(onOrBefore('2017-12-31', { y: 2017, m: 12, d: 31 }), true);
  assert.equal(onOrBefore('2018-01-01', { y: 2017, m: 12, d: 31 }), false);
  assert.equal(onOrBefore('2026-11-13', TODAY), true);
  assert.equal(onOrBefore('2026-11-14', TODAY), false); // tomorrow is not yet published
  assert.equal(onOrBefore('2026', TODAY), true); // year only: counted by its year
  assert.equal(onOrBefore('2027', TODAY), false);
  assert.equal(dateLabel('2024-01-26'), '26/01/2024'); assert.equal(dateLabel('2013'), '2013');
});

test('place names: country, other spelling, code, region, unknown', () => {
  assert.deepEqual(resolvePlace(' examplia ', CAT), { type: 'country', code: 'EX', name: 'Examplia', scopes: ['EX', 'UN'] });
  assert.equal(resolvePlace('Exampleland', CAT).code, 'EX');
  assert.equal(resolvePlace('ex', CAT).code, 'EX');
  assert.deepEqual(resolvePlace('Union', CAT), { type: 'region', code: 'UN', name: 'Example Union', scopes: ['UN'] });
  assert.deepEqual(resolvePlace('Samplestan', CAT).scopes, ['SA']); // not in any region
  assert.equal(resolvePlace('Atlantis', CAT), null);
  assert.deepEqual(placeNames(CAT), ['Example Union', 'Examplia', 'Nodocia', 'Samplestan']);
});

test('documents as of a year, with their state at the cut-off', () => {
  const at = (year) => { const y = resolveYear(year, TODAY); return findSources(resolvePlace('Examplia', CAT), y.cutoff, CAT); };
  const view = (r) => r.docs.map((d) => d.ref + ':' + d.state + (d.by ? '>' + d.by : ''));
  assert.deepEqual(view(at('2011')), []); assert.equal(at('2011').later, 7);
  assert.deepEqual(view(at('2016')), ['G 9/2015:amends', 'G 1/2012:current', 'UJ 5:current']); // country first, newest first, then the region
  // 31/12/2017 is still "in 2017"; 01/01/2018 is not.
  assert.deepEqual(view(at('2017')), ['G 4/2017:current', 'G 9/2015:superseded>G 4/2017', 'G 1/2012:superseded>G 4/2017', 'UJ 5:current']);
  assert.deepEqual(view(at('2018')).slice(0, 2), ['G 2/2018:amends', 'G 4/2017:current']);
  // Current year and a future year both stop at today: the document dated tomorrow stays hidden.
  for (const y of ['2026', '2031', '']) { const r = at(y); assert.equal(r.docs.length, 6); assert.equal(r.later, 1); assert.ok(!r.docs.some((d) => d.ref === 'L')); }
  assert.deepEqual(at('2026').bodies.map((b) => b.name), ['Examplia operator', 'Union journal']);
  const noDocs = findSources(resolvePlace('Nodocia', CAT), TODAY, CAT);
  assert.equal(noDocs.hasOwnDocs, false); assert.deepEqual(noDocs.docs.map((d) => d.ref), ['UJ 5']); // region documents still apply
});

test('a found document becomes a valid register entry', () => {
  const place = resolvePlace('Examplia', CAT), cutoff = { y: 2017, m: 12, d: 31 };
  const r = findSources(place, cutoff, CAT);
  const old = makeDoc(toRegisterInput(r.docs.find((d) => d.ref === 'G 1/2012'), place, cutoff));
  assert.deepEqual([old.country, old.ref, old.published, old.status, old.url, old.text], ['Examplia', 'G 1/2012', '2012-03-01', 'superseded', 'https://example.org/2012', '']);
  assert.match(old.notes, /cut-off 31\/12\/2017: superseded at that date \(by G 4\/2017\)/);
  const yearOnly = makeDoc(toRegisterInput(findSources(place, TODAY, CAT).docs.find((d) => d.ref === 'D 2026'), place, TODAY));
  assert.deepEqual([yearOnly.published, yearOnly.version, yearOnly.status], ['', '2026', 'in_force']);
  assert.match(yearOnly.notes, /Only the year of issue is recorded.*publisher's site/);
});

test('the shipped catalogue is well formed and points only at official publishers', () => {
  const OFFICIAL = new Set(['eur-lex.europa.eu', 'www.entsoe.eu', 'www.hops.hr', 'www.hera.hr', 'narodne-novine.nn.hr', 'cea.nic.in', 'www.cercind.gov.in', 'ctuil.in', 'egazette.gov.in',
    'www.aemc.gov.au', 'aemo.com.au', 'www.vde.com', 'www.ree.es', 'api.esios.ree.es', 'www.boe.es', 'www.cre.fr', 'www.legifrance.gouv.fr', 'www.terna.it', 'www.arera.it', 'www.pse.pl', 'bip.ure.gov.pl', 'www.acm.nl', 'wetten.overheid.nl']);
  const codes = new Set([...COUNTRIES.map((c) => c[0]), ...REGIONS.map((r) => r.code)]);
  assert.equal(new Set(COUNTRIES.map((c) => c[0])).size, COUNTRIES.length, 'country codes are unique');
  for (const r of REGIONS) for (const m of r.members) assert.ok(COUNTRIES.some((c) => c[0] === m), r.code + ' member ' + m + ' has a name');
  assert.equal(REGIONS.find((r) => r.code === 'EU').members.length, 27);
  assert.equal(REGIONS.find((r) => r.code === 'ENTSOE').members.length, 36);
  const seen = new Set();
  for (const d of DOCS) {
    assert.ok(codes.has(d.scope), d.ref + ' scope'); assert.ok(DOC_KIND_BY_ID.has(d.kind), d.ref + ' kind');
    assert.ok(['base', 'amendment'].includes(d.role) && d.series && d.title && d.issuer && d.ref && d.lang, d.ref + ' fields');
    assert.match(d.date, /^\d{4}(-\d{2}-\d{2})?$/, d.ref + ' date');
    assert.ok(onOrBefore(d.date, { y: 2026, m: 11, d: 13 }), d.ref + ' is not dated after the review day');
    const u = new URL(d.url);
    assert.equal(u.protocol, 'https:'); assert.ok(OFFICIAL.has(u.hostname), d.ref + ' host ' + u.hostname);
    assert.ok(!seen.has(d.scope + d.title), 'duplicate ' + d.title); seen.add(d.scope + d.title);
    assert.doesNotThrow(() => makeDoc(toRegisterInput({ ...d, state: 'current', by: '' }, { name: 'X' }, { y: 2026, m: 11, d: 13 })), d.ref + ' passes register validation');
  }
  for (const b of BODIES) { const u = new URL(b.url); assert.equal(u.protocol, 'https:'); assert.ok(OFFICIAL.has(u.hostname), b.name); assert.ok(codes.has(b.scope)); }
});

test('worked case from the request: Croatia in 2017, in 2020 and today', () => {
  const at = (year) => findSources(resolvePlace('Hrvatska', CATALOG), resolveYear(year, TODAY).cutoff, CATALOG);
  const refs = (r) => r.docs.map((d) => d.ref + ':' + d.state);
  // By hand: NN 67/2017 (4 July 2017) and the five EU regulations (latest 28 November 2017) are in or before 2017;
  // HOPS 12/2018, NN 52/2020, NN 128/2020, 14.7.2023, NN 10/2024 and Rev. 4 are later.
  assert.deepEqual(refs(at('2017')), ['NN 67/2017:current', 'OJ L 312, 28.11.2017:current', 'OJ L 220, 25.8.2017:current', 'OJ L 241, 8.9.2016:current', 'OJ L 223, 18.8.2016:current', 'OJ L 112, 27.4.2016:current']);
  assert.equal(at('2017').later, 7); // HOPS 12/2018, NN 74/2018, NN 52/2020, NN 128/2020, 14.7.2023, NN 10/2024, Rev. 4
  assert.deepEqual(refs(at('2016')), ['OJ L 241, 8.9.2016:current', 'OJ L 223, 18.8.2016:current', 'OJ L 112, 27.4.2016:current']);
  assert.deepEqual(refs(at('2020')).slice(0, 5), ['NN 128/2020:amends', 'NN 67/2017:current', 'NN 52/2020:amends', 'NN 74/2018:current', 'HOPS 12/2018:current']);
  const now = refs(at('2031'));
  assert.equal(now.length, 13);
  assert.deepEqual(now.slice(0, 3), ['NN 10/2024:current', 'NN 128/2020:superseded', 'NN 67/2017:superseded']);
  assert.deepEqual(findSources(resolvePlace('Austria', CATALOG), TODAY, CATALOG).bodies.map((b) => b.name), ['EUR-Lex', 'ENTSO-E member companies']);
  // Germany: 2018 editions of 4120 and 4130 only; 2023 edition of 4110 supersedes 2018; 4120/A1 is an amendment in force today.
  const de = (y) => findSources(resolvePlace('Deutschland', CATALOG), resolveYear(y, TODAY).cutoff, CATALOG).docs.filter((d) => d.scope === 'DE').map((d) => d.ref + ':' + d.state);
  // A year-only date counts as 31 December, so the 2018 edition of 4110 sorts first.
  assert.deepEqual(de('2018'), ['VDE-AR-N 4110:2018-11:current', 'VDE-AR-N 4120:2018-11:current', 'VDE-AR-N 4130:2018-11:current']);
  assert.deepEqual(de('2031'), ['VDE-AR-N 4130/A1:amends', 'VDE-AR-N 4120/A1:amends', 'VDE-AR-N 4110:2023-09:current', 'VDE-AR-N 4110:2018-11:superseded', 'VDE-AR-N 4120:2018-11:current', 'VDE-AR-N 4130:2018-11:current']);
  // Netherlands: the Netcode is current until the Systeemcode 2026 replaces it.
  const nl = (y) => findSources(resolvePlace('Nederland', CATALOG), resolveYear(y, TODAY).cutoff, CATALOG).docs.filter((d) => d.scope === 'NL').map((d) => d.ref + ':' + d.state);
  assert.deepEqual(nl('2025'), ['BWBR0037940:current']);
  assert.deepEqual(nl(''), ['Systeemcode elektriciteit 2026:current', 'BWBR0037940:superseded']);
  // Australia: not in any region; the GTPS rule of 2018 is hidden for a 2017 study.
  assert.deepEqual(findSources(resolvePlace('NEM', CATALOG), resolveYear('2017', TODAY).cutoff, CATALOG).docs, []);
  assert.deepEqual(findSources(resolvePlace('Australia', CATALOG), TODAY, CATALOG).docs.map((d) => d.ref), ['NER current version', 'ERC0222', 'AEMC template 2026', 'NER 5.2.6A review', 'AEMO guide 2.0']);
  // India: the 2010 grid code is superseded by 2023, which the 2024 amendment amends.
  assert.deepEqual(findSources(resolvePlace('India', CATALOG), TODAY, CATALOG).docs.filter((d) => d.series === 'in-iegc').map((d) => d.ref + ':' + d.state), ['First Amendment 2024:amends', 'No. L-1/265/2022/CERC:current', 'IEGC 2010:superseded']);
  assert.equal(resolvePlace('Brazil', CATALOG), null);
});
