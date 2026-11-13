// Explicit unit conversion. Each unit lists its dimension and the factor to the base unit,
// so every conversion is written down once and is easy to audit.
import { InputError } from './util.js';

// factor = how many base units one of this unit is.
export const UNITS = {
  // frequency, base Hz
  Hz: ['frequency', 1], mHz: ['frequency', 0.001], // mHz to Hz: divide by 1,000
  // rate of change of frequency, base Hz/s
  'Hz/s': ['rocof', 1],
  // time, base s
  s: ['time', 1], ms: ['time', 0.001], // ms to s: divide by 1,000
  min: ['time', 60], // min to s: multiply by 60
  h: ['time', 3600], // h to s: multiply by 3,600
  // voltage, base V
  V: ['voltage', 1], kV: ['voltage', 1000], // kV to V: multiply by 1,000
  // current, base A
  A: ['current', 1], kA: ['current', 1000],
  // active power, base W
  W: ['power', 1], kW: ['power', 1e3], MW: ['power', 1e6], GW: ['power', 1e9], // kW to MW: divide by 1,000
  // reactive power, base var
  var: ['reactive', 1], kvar: ['reactive', 1e3], Mvar: ['reactive', 1e6],
  // apparent power, base VA
  VA: ['apparent', 1], kVA: ['apparent', 1e3], MVA: ['apparent', 1e6],
  // energy, base Wh
  Wh: ['energy', 1], kWh: ['energy', 1e3], MWh: ['energy', 1e6], // kWh to MWh: divide by 1,000
  // ratio, base fraction (1.0)
  pu: ['ratio', 1], '%': ['ratio', 0.01], // percent to per-unit: divide by 100
  '': ['ratio', 1],
  // yes/no capability, 1 = yes
  bool: ['bool', 1],
};

const ALIAS = {
  hz: 'Hz', mhz: 'mHz', 'hz/s': 'Hz/s', 'hz/sec': 'Hz/s',
  sec: 's', secs: 's', second: 's', seconds: 's', s: 's',
  msec: 'ms', millisecond: 'ms', milliseconds: 'ms', ms: 'ms',
  minute: 'min', minutes: 'min', mins: 'min', min: 'min',
  hour: 'h', hours: 'h', hr: 'h', hrs: 'h', h: 'h',
  v: 'V', kv: 'kV', a: 'A', ka: 'kA',
  w: 'W', kw: 'kW', mw: 'MW', gw: 'GW',
  var: 'var', kvar: 'kvar', mvar: 'Mvar',
  va: 'VA', kva: 'kVA', mva: 'MVA',
  wh: 'Wh', kwh: 'kWh', mwh: 'MWh',
  pu: 'pu', 'p.u.': 'pu', 'p.u': 'pu', '%': '%', percent: '%',
  '': '', '-': '', bool: 'bool', 'yes/no': 'bool',
};

/** Canonical spelling of a unit ("MVAr" -> "Mvar", "p.u." -> "pu"), or null when unknown. */
export function normUnit(u) {
  const k = String(u ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIAS, k) ? ALIAS[k] : null;
}

export function dimensionOf(u) {
  const n = normUnit(u);
  return n === null ? null : UNITS[n][0];
}

/** Convert between two units of the same dimension. Throws a clear error otherwise. */
export function convert(value, from, to) {
  const f = normUnit(from), t = normUnit(to);
  if (f === null) throw new InputError('Unit "' + from + '" is not known. Use one of: ' + Object.keys(UNITS).filter(Boolean).join(', ') + '.', 'unit');
  if (t === null) throw new InputError('Unit "' + to + '" is not known.', 'unit');
  if (UNITS[f][0] !== UNITS[t][0]) {
    throw new InputError('Cannot convert ' + (f || 'a plain number') + ' to ' + (t || 'a plain number') + ': one is ' + UNITS[f][0] + ', the other is ' + UNITS[t][0] + '.', 'unit');
  }
  if (f === t) return value;
  // Rounded to 12 significant digits so 150 ms -> 0.15 s exactly, not 0.15000000000000002.
  return Number((value * UNITS[f][1] / UNITS[t][1]).toPrecision(12));
}
