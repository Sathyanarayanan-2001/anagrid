// Compliance determination. A requirement is judged only from recorded turbine capability
// values and their evidence. Missing data never counts as compliance.
import { convert } from './units.js';
import { InputError } from './util.js';

export const CMPS = ['>=', '<=', '>', '<', '='];

// Relative tolerance so that 0.15 s and 150 ms compare equal after unit conversion.
const EPS = 1e-9;
const eq = (a, b) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

export function compare(actual, cmp, limit) {
  switch (cmp) {
    case '>=': return actual > limit || eq(actual, limit);
    case '<=': return actual < limit || eq(actual, limit);
    case '>': return actual > limit && !eq(actual, limit);
    case '<': return actual < limit && !eq(actual, limit);
    case '=': return eq(actual, limit);
    default: throw new InputError('Comparison "' + cmp + '" is not supported. Use one of ' + CMPS.join(' ') + '.', 'cmp');
  }
}

/** Validate one check of a requirement: {cap, cmp, value, unit}. */
export function validateCheck(c) {
  if (!c || typeof c.cap !== 'string' || !c.cap.trim()) throw new InputError('Choose the turbine capability this check reads.', 'cap');
  if (!CMPS.includes(c.cmp)) throw new InputError('Choose a comparison: ' + CMPS.join(' ') + '.', 'cmp');
  if (typeof c.value !== 'number' || !Number.isFinite(c.value)) throw new InputError('The limit must be a number, for example 47.5.', 'value');
  convert(1, c.unit, c.unit); // throws when the unit is unknown
  return true;
}

/**
 * Judge one requirement.
 * @param {object} req requirement record with optional checks[] and manual {status, evidence}
 * @param {Map<string,object>} caps capability key (lower case) -> capability record {value, unit, evidence}
 * @returns {{status:string, basis:string, details:Array, notes:string[]}}
 *
 * Rules, in order:
 *  1. Checks exist: every check is compared with the recorded capability.
 *     all pass -> COMPLIANT; pass and fail mixed -> PARTIAL; only fails -> NON_COMPLIANT;
 *     any check without data and no failure -> INSUFFICIENT (compliance is never assumed).
 *  2. No checks: the manual determination applies, but COMPLIANT and PARTIAL need written evidence.
 *  3. Otherwise INSUFFICIENT.
 * O(c) for c checks; capability lookup is a map read.
 */
export function evaluate(req, caps) {
  const notes = [];
  const checks = Array.isArray(req.checks) ? req.checks : [];
  const manual = req.manual && req.manual.status ? req.manual : null;
  const details = [];
  let pass = 0, fail = 0, nodata = 0;
  for (const c of checks) {
    const cap = caps.get(String(c.cap || '').trim().toLowerCase());
    if (!cap || typeof cap.value !== 'number' || !Number.isFinite(cap.value)) {
      nodata++;
      details.push({ check: c, result: 'nodata', note: 'No capability value recorded for "' + c.cap + '".' });
      continue;
    }
    let actual;
    try {
      actual = convert(cap.value, cap.unit, c.unit);
    } catch (e) {
      nodata++;
      details.push({ check: c, result: 'nodata', note: 'Units do not match: capability is in ' + (cap.unit || 'plain number') + ', the limit is in ' + (c.unit || 'plain number') + '.' });
      notes.push('Unit mismatch on "' + c.cap + '". Correct the capability unit or the check unit.');
      continue;
    }
    const ok = compare(actual, c.cmp, c.value);
    if (ok) pass++; else fail++;
    details.push({ check: c, result: ok ? 'pass' : 'fail', actual, capUnit: cap.unit, capValue: cap.value });
    if (ok && c.cmp !== '=' && eq(actual, c.value)) notes.push('"' + c.cap + '" sits exactly on the limit (' + c.value + ' ' + c.unit + '): no margin for measurement tolerance.');
    if (!String(cap.evidence || '').trim()) notes.push('Capability "' + c.cap + '" has no evidence reference (test report, certificate or data sheet).');
  }

  let status, basis;
  if (checks.length) {
    basis = 'checks';
    if (fail && pass) status = 'PARTIAL';
    else if (fail) status = 'NON_COMPLIANT';
    else if (nodata) status = 'INSUFFICIENT';
    else status = 'COMPLIANT';
    if (fail && nodata) notes.push(nodata + ' check' + (nodata > 1 ? 's have' : ' has') + ' no data; the result may get worse when data arrives.');
    if (manual && manual.status !== status) notes.push('Manual determination (' + manual.status + ') differs from the computed result (' + status + '). The computed result is shown.');
  } else if (manual) {
    basis = 'manual';
    const hasEvidence = !!String(manual.evidence || '').trim();
    if ((manual.status === 'COMPLIANT' || manual.status === 'PARTIAL') && !hasEvidence) {
      status = 'INSUFFICIENT';
      notes.push('Marked ' + manual.status + ' without evidence. Add the test report or certificate reference to keep that determination.');
    } else {
      status = manual.status;
    }
  } else {
    basis = 'none';
    status = 'INSUFFICIENT';
  }
  return { status, basis, details, notes };
}

/** Index capability records by lower-cased key. O(n). */
export function capIndex(caps) {
  const m = new Map();
  for (const c of caps) m.set(String(c.key || '').trim().toLowerCase(), c);
  return m;
}

/**
 * Cross-document discrepancies: two requirements of one country from different documents that
 * quote the same band (for example 48.5-49.0 Hz) but attach different other values to it.
 * Grouping uses a map keyed by country and band, so the scan is O(n) plus the pairs reported.
 */
export function findConflicts(reqs) {
  const groups = new Map();
  for (const r of reqs) {
    for (const t of r.thresholds || []) {
      if (t.cmp !== 'range') continue;
      const key = (r.country || '') + '|' + t.lo + '|' + t.hi + '|' + t.unit;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
  }
  const out = [];
  const seen = new Set();
  const sig = (r, band) => (r.thresholds || [])
    .filter((t) => !(t.cmp === 'range' && t.lo + '|' + t.hi + '|' + t.unit === band))
    .map((t) => t.cmp + ' ' + t.lo + (t.hi !== undefined ? '..' + t.hi : '') + ' ' + t.unit).sort().join('; ');
  for (const [key, list] of groups) {
    const band = key.split('|').slice(1).join('|');
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.docId === b.docId || a.id === b.id) continue;
        const sa = sig(a, band), sb = sig(b, band);
        if (sa === sb || !sa || !sb) continue;
        const pair = [a.id, b.id].sort().join('|') + '|' + band;
        if (seen.has(pair)) continue;
        seen.add(pair);
        const [lo, hi, unit] = band.split('|');
        out.push({ a: a.id, b: b.id, band: lo + '-' + hi + ' ' + unit, va: sa, vb: sb });
      }
    }
  }
  return out;
}
