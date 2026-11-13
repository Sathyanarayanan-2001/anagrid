// Calendar logic on plain {y, m, d} triples.
// Why not Date objects: Date mixes in the machine's timezone, and a requirement due on 31/03 must
// stay in FY 2025-26 no matter where the laptop clock thinks it is.
import { InputError } from './util.js';

const IST_OFFSET_MIN = 330; // Asia/Calcutta is UTC+05:30 all year (no daylight saving).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

export function isValidDate(y, m, d) {
  return Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) &&
    y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** Days since 1970-01-01 (proleptic Gregorian). O(1). */
export function daysFromCivil(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** ISO weekday: Monday = 1 ... Sunday = 7. */
export function isoDow(y, m, d) {
  const n = ((daysFromCivil(y, m, d) % 7) + 7 + 3) % 7; // 1970-01-01 was a Thursday -> n = 3
  return n + 1;
}

/**
 * ISO 8601 week. The week belongs to the year that holds its Thursday, which is why
 * 01/01/2027 (a Friday) is CW53 of 2026 and 31/12/2024 (a Tuesday) is CW01 of 2025.
 */
export function isoWeek({ y, m, d }) {
  const days = daysFromCivil(y, m, d);
  const thursday = civilFromDays(days - isoDow(y, m, d) + 4);
  const ordinal = daysFromCivil(thursday.y, thursday.m, thursday.d) - daysFromCivil(thursday.y, 1, 1);
  return { year: thursday.y, week: Math.floor(ordinal / 7) + 1 };
}

export const weekLabel = (date) => 'CW' + String(isoWeek(date).week).padStart(2, '0');

/** Indian financial year, 1 April to 31 March: 31/03/2027 -> FY 2026-27, 01/04/2027 -> FY 2027-28. */
export function finYear({ y, m }) {
  const start = m >= 4 ? y : y - 1;
  return 'FY ' + start + '-' + String((start + 1) % 100).padStart(2, '0');
}

export const monthLabel = ({ y, m }) => MONTHS[m - 1] + ' ' + y;

export const toISO = ({ y, m, d }) =>
  String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

export function fromISO(s) {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!mt) return null;
  const date = { y: +mt[1], m: +mt[2], d: +mt[3] };
  return isValidDate(date.y, date.m, date.d) ? date : null;
}

/** Day-first display: 28/10/2026. */
export const fmtDayFirst = ({ y, m, d }) =>
  String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0') + '/' + y;

/**
 * Parse a typed date. Day comes first (28/10, 28/10/26, 28.10.2026, 28-10-2026); ISO 2026-10-28
 * is also accepted because exports use it. A missing year means the reference year.
 * Throws InputError with a message that says how to fix the input.
 */
export function parseDayFirst(input, refYear) {
  const s = String(input ?? '').trim();
  if (!s) throw new InputError('Date is empty. Type it day first, for example 28/10/2026.', 'date');
  const iso = fromISO(s);
  if (iso) return iso;
  const mt = /^(\d{1,2})[\/.\-\s](\d{1,2})(?:[\/.\-\s](\d{2}|\d{4}))?$/.exec(s);
  if (!mt) throw new InputError('"' + s + '" is not a date. Type it day first, for example 28/10/2026.', 'date');
  const d = +mt[1], m = +mt[2];
  let y = mt[3] === undefined ? refYear : +mt[3];
  if (mt[3] && mt[3].length === 2) y += 2000;
  if (!Number.isInteger(y)) throw new InputError('Add the year, for example 28/10/2026.', 'date');
  if (!isValidDate(y, m, d)) {
    throw new InputError('"' + s + '" does not exist in the calendar (day ' + d + ', month ' + m + ', year ' + y +
      '). Check the day and month; the day is typed first.', 'date');
  }
  return { y, m, d };
}

/** Wall-clock parts in Asia/Calcutta for an epoch-millisecond instant. */
export function partsIST(ms) {
  const shifted = ms + IST_OFFSET_MIN * 60000; // minutes to milliseconds: multiply by 60,000
  const dayMs = 86400000;
  const days = Math.floor(shifted / dayMs);
  const rem = shifted - days * dayMs;
  const date = civilFromDays(days);
  return { ...date, hh: Math.floor(rem / 3600000), mm: Math.floor((rem % 3600000) / 60000) };
}

export const todayIST = (ms) => { const p = partsIST(ms); return { y: p.y, m: p.m, d: p.d }; };

/** 24-hour stamp, day first: 13/11/2026 07:23. */
export function fmtStamp(ms) {
  const p = partsIST(ms);
  return fmtDayFirst(p) + ' ' + String(p.hh).padStart(2, '0') + ':' + String(p.mm).padStart(2, '0');
}

/** Everything the UI shows about a date is derived here, never typed in. */
export function periodLabels(date) {
  return { month: monthLabel(date), week: weekLabel(date), fy: finYear(date) };
}
