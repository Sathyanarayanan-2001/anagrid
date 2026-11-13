// Finding the official documents for a place as of a chosen year.
// Pure functions over the catalogue, so the rules are tested without a browser.
import { InputError, squash, stableSort, cmpNatural } from './util.js';
import { DOC_KIND_BY_ID } from './catalog.js';
import { fmtDayFirst } from './dates.js';

/**
 * Turn the typed year into a cut-off date.
 *  - a past year: 31 December of that year (documents in and before that year);
 *  - the current year, or nothing typed: today;
 *  - a future year: today, with a note, because nothing can be published after today.
 * @param {string|number} input @param {{y:number,m:number,d:number}} today
 */
export function resolveYear(input, today) {
  const s = String(input ?? '').trim();
  if (!s) return { year: today.y, cutoff: today, note: '' };
  if (!/^\d{4}$/.test(s)) throw new InputError('"' + s + '" is not a year. Type four digits, for example 2017.', 'year');
  const year = Number(s);
  if (year < 1900) throw new InputError('Year ' + year + ' is too early. Type a year from 1900 onwards.', 'year');
  if (year > today.y) return { year: today.y, cutoff: today, note: year + ' is in the future, so documents up to today (' + fmtDayFirst(today) + ') are shown.' };
  if (year === today.y) return { year, cutoff: today, note: '' };
  return { year, cutoff: { y: year, m: 12, d: 31 }, note: '' };
}

const key = (s) => squash(s).toLowerCase();

/** Index of names -> place, built once per catalogue. O(n). */
function nameIndex(cat) {
  const idx = new Map();
  for (const [code, name, aliases] of cat.COUNTRIES) for (const n of [name, code, ...aliases]) idx.set(key(n), { type: 'country', code, name });
  // Regions are added last so "EU" and "Europe" resolve to the region.
  for (const r of cat.REGIONS) for (const n of [r.name, r.code, ...r.aliases]) idx.set(key(n), { type: 'region', code: r.code, name: r.name });
  return idx;
}

/**
 * Match a typed country or region name.
 * @returns {{type:string, code:string, name:string, scopes:string[]}|null}
 * scopes lists the place itself first, then every region it belongs to.
 */
export function resolvePlace(input, cat) {
  const hit = nameIndex(cat).get(key(input));
  if (!hit) return null;
  const scopes = [hit.code];
  if (hit.type === 'country') for (const r of cat.REGIONS) if (r.members.includes(hit.code)) scopes.push(r.code);
  return { ...hit, scopes };
}

/** Names offered while typing. */
export function placeNames(cat) {
  return [...cat.COUNTRIES.map((c) => c[1]), ...cat.REGIONS.map((r) => r.name)].sort(cmpNatural);
}

/** A catalogue date is a full date or a year alone. Returns comparable parts. */
export function dateParts(date) {
  const m = /^(\d{4})(?:-(\d{2})-(\d{2}))?$/.exec(String(date));
  if (!m) throw new InputError('Catalogue date "' + date + '" is not YYYY or YYYY-MM-DD.', 'date');
  return m[2] ? { y: +m[1], m: +m[2], d: +m[3], yearOnly: false } : { y: +m[1], m: 12, d: 31, yearOnly: true };
}
const num = (p) => p.y * 10000 + p.m * 100 + p.d;

/** True when the document was published on or before the cut-off. A year-only date counts by its year. */
export function onOrBefore(date, cutoff) {
  const p = dateParts(date);
  return p.yearOnly ? p.y <= cutoff.y : num(p) <= num(cutoff);
}

export const dateLabel = (date) => { const p = dateParts(date); return p.yearOnly ? String(p.y) : fmtDayFirst(p); };

/**
 * Documents and official bodies for a place as of the cut-off.
 * Each document gets a state at the cut-off:
 *   current     latest base version of its series
 *   amends      amendment issued on or after the current base version
 *   superseded  older base version, or an amendment to one
 * O(n log n) for the sort; grouping by series uses a map.
 */
export function findSources(place, cutoff, cat) {
  const scopeOrder = new Map(place.scopes.map((s, i) => [s, i]));
  const all = cat.DOCS.filter((d) => scopeOrder.has(d.scope));
  const shown = all.filter((d) => onOrBefore(d.date, cutoff));
  const latestBase = new Map();
  for (const d of shown) {
    if (d.role !== 'base') continue;
    const cur = latestBase.get(d.series);
    if (!cur || num(dateParts(d.date)) > num(dateParts(cur.date))) latestBase.set(d.series, d);
  }
  const docs = shown.map((d) => {
    const base = latestBase.get(d.series);
    let state = 'current', by = '';
    if (d.role === 'base') { if (base !== d) { state = 'superseded'; by = base.ref; } }
    else if (!base || num(dateParts(d.date)) >= num(dateParts(base.date))) state = 'amends';
    else { state = 'superseded'; by = base.ref; }
    return { ...d, state, by };
  });
  const sorted = stableSort(docs,
    (a, b) => scopeOrder.get(a.scope) - scopeOrder.get(b.scope),
    (a, b) => (DOC_KIND_BY_ID.get(a.kind)?.order ?? 99) - (DOC_KIND_BY_ID.get(b.kind)?.order ?? 99),
    (a, b) => num(dateParts(b.date)) - num(dateParts(a.date)),
    (a, b) => cmpNatural(a.title, b.title));
  return {
    docs: sorted,
    later: all.length - shown.length,
    bodies: stableSort(cat.BODIES.filter((b) => scopeOrder.has(b.scope)), (a, b) => scopeOrder.get(a.scope) - scopeOrder.get(b.scope)),
    hasOwnDocs: all.some((d) => d.scope === place.code),
  };
}

export const STATE_LABEL = { current: 'Current', amends: 'Amendment in force', superseded: 'Superseded' };

/** Register entry (input for makeDoc) from a catalogue document. */
export function toRegisterInput(d, place, cutoff) {
  const p = dateParts(d.date);
  return {
    country: place.name, title: d.title, kind: d.kind, issuer: d.issuer, ref: d.ref,
    published: p.yearOnly ? '' : fmtDayFirst(p), version: p.yearOnly ? String(p.y) : '', lang: d.lang,
    status: d.state === 'superseded' ? 'superseded' : 'in_force', url: d.url,
    notes: 'Found through the source catalogue with cut-off ' + fmtDayFirst(cutoff) + ': ' + STATE_LABEL[d.state].toLowerCase() + ' at that date' + (d.by ? ' (by ' + d.by + ')' : '') + '.' +
      (d.dateKind ? ' Date is the day it was ' + d.dateKind + '.' : '') + (p.yearOnly ? ' Only the year of issue is recorded.' : '') + (d.note ? ' ' + d.note : '') +
      (d.direct === false ? ' The link opens the publisher\'s site; find the document there.' : '') + ' No text yet: open the link, save the file, then choose it with Edit.',
  };
}
