// Each test states its input and the expected result worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDayFirst, isoWeek, weekLabel, finYear, fmtStamp, fmtDayFirst, toISO, isLeap, periodLabels, daysFromCivil, civilFromDays } from '../src/core/dates.js';
import { parseRupees, fmtRupees, sumPaise, groupLakh } from '../src/core/money.js';
import { convert, normUnit } from '../src/core/units.js';
import { InputError } from '../src/core/util.js';

test('typed dates are day first', () => {
  // 28/10 with reference year 2026 -> 28 October 2026
  assert.deepEqual(parseDayFirst('28/10', 2026), { y: 2026, m: 10, d: 28 });
  assert.deepEqual(parseDayFirst('03/04/2027'), { y: 2027, m: 4, d: 3 }); // 3 April, not 4 March
  assert.deepEqual(parseDayFirst('28.10.26'), { y: 2026, m: 10, d: 28 });
  assert.deepEqual(parseDayFirst('2026-10-28'), { y: 2026, m: 10, d: 28 });
  assert.equal(fmtDayFirst({ y: 2026, m: 3, d: 5 }), '05/03/2026');
});

test('impossible dates are rejected with a fixable message', () => {
  assert.throws(() => parseDayFirst('31/04/2026'), InputError); // April has 30 days
  assert.throws(() => parseDayFirst('29/02/2026'), /does not exist/); // 2026 is not a leap year
  assert.throws(() => parseDayFirst('10/28/2026'), /day is typed first/); // month 28
  assert.throws(() => parseDayFirst('tomorrow'), /Type it day first/);
  assert.throws(() => parseDayFirst(''), /empty/);
});

test('leap years: 29 February', () => {
  assert.deepEqual(parseDayFirst('29/02/2024'), { y: 2024, m: 2, d: 29 }); // divisible by 4
  assert.deepEqual(parseDayFirst('29/02/2028'), { y: 2028, m: 2, d: 29 });
  assert.equal(isLeap(1900), false); // century not divisible by 400
  assert.equal(isLeap(2000), true);
  // day after 28/02/2028 is 29/02, day after that is 01/03
  const n = daysFromCivil(2028, 2, 28);
  assert.deepEqual(civilFromDays(n + 1), { y: 2028, m: 2, d: 29 });
  assert.deepEqual(civilFromDays(n + 2), { y: 2028, m: 3, d: 1 });
});

test('ISO weeks, Monday to Sunday', () => {
  // 13/11/2026 is a Friday. 1 Jan 2026 is a Thursday, so CW01 starts Mon 29/12/2025.
  // Thursday of the week is 12/11 = day 316 of the year -> floor(315 / 7) + 1 = 46.
  assert.equal(weekLabel({ y: 2026, m: 11, d: 13 }), 'CW46');
  assert.equal(weekLabel({ y: 2026, m: 11, d: 9 }), 'CW46'); // Monday of the same week
  assert.equal(weekLabel({ y: 2026, m: 11, d: 15 }), 'CW46'); // Sunday of the same week
  assert.equal(weekLabel({ y: 2026, m: 11, d: 16 }), 'CW47'); // next Monday
});

test('ISO week 53 and the year boundary', () => {
  // 2026 starts on a Thursday, so it has 53 weeks.
  assert.deepEqual(isoWeek({ y: 2026, m: 12, d: 31 }), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek({ y: 2027, m: 1, d: 1 }), { year: 2026, week: 53 }); // Friday still in CW53 of 2026
  assert.deepEqual(isoWeek({ y: 2027, m: 1, d: 3 }), { year: 2026, week: 53 }); // Sunday
  assert.deepEqual(isoWeek({ y: 2027, m: 1, d: 4 }), { year: 2027, week: 1 }); // Monday
  assert.deepEqual(isoWeek({ y: 2020, m: 12, d: 31 }), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek({ y: 2024, m: 12, d: 30 }), { year: 2025, week: 1 }); // Monday 30/12/2024 belongs to 2025
  assert.deepEqual(isoWeek({ y: 2025, m: 12, d: 28 }), { year: 2025, week: 52 });
});

test('financial year runs 1 April to 31 March', () => {
  assert.equal(finYear({ y: 2027, m: 3, d: 31 }), 'FY 2026-27');
  assert.equal(finYear({ y: 2027, m: 4, d: 1 }), 'FY 2027-28');
  assert.equal(finYear({ y: 2026, m: 11, d: 13 }), 'FY 2026-27');
  assert.equal(finYear({ y: 2000, m: 1, d: 15 }), 'FY 1999-00');
  assert.deepEqual(periodLabels({ y: 2027, m: 3, d: 31 }), { month: 'Mar 2027', week: 'CW13', fy: 'FY 2026-27' });
});

test('24-hour stamps in Asia/Calcutta: midnight, month end and leap day crossings', () => {
  // IST = UTC + 5:30, so 18:29 UTC is 23:59 IST and 18:30 UTC is 00:00 next day.
  assert.equal(fmtStamp(Date.UTC(2026, 10, 12, 18, 29)), '12/11/2026 23:59');
  assert.equal(fmtStamp(Date.UTC(2026, 10, 12, 18, 30)), '13/11/2026 00:00');
  assert.equal(fmtStamp(Date.UTC(2026, 0, 31, 18, 30)), '01/02/2026 00:00'); // month end
  assert.equal(fmtStamp(Date.UTC(2028, 1, 28, 18, 30)), '29/02/2028 00:00'); // leap day
  assert.equal(fmtStamp(Date.UTC(2026, 11, 31, 18, 30)), '01/01/2027 00:00'); // year end
  assert.equal(fmtStamp(Date.UTC(2026, 10, 13, 1, 53)), '13/11/2026 07:23'); // 24-hour, no am/pm
  assert.equal(toISO({ y: 2026, m: 1, d: 5 }), '2026-01-05');
});

test('money is whole paise and shows lakh grouping', () => {
  assert.equal(parseRupees('1,23,456.78'), 12345678);
  assert.equal(parseRupees('₹ 1250'), 125000);
  assert.equal(parseRupees('1250.5'), 125050); // one decimal means 50 paise
  assert.equal(fmtRupees(12345678), '1,23,456.78');
  assert.equal(fmtRupees(100000000), '10,00,000.00'); // ten lakh
  assert.equal(fmtRupees(1234567890123), '12,34,56,78,901.23');
  assert.equal(fmtRupees(5), '0.05');
  assert.equal(groupLakh('999'), '999');
  assert.equal(groupLakh('1000'), '1,000');
  assert.throws(() => parseRupees('12.345'), /at most two decimals/);
  assert.throws(() => parseRupees('-5'), InputError);
  assert.throws(() => parseRupees('abc'), InputError);
});

test('totals match a hand calculation to the paisa', () => {
  // 1,23,456.78 + 0.10 + 0.20 + 99,999.99 = 2,23,457.07
  const items = ['1,23,456.78', '0.10', '0.20', '99,999.99'].map(parseRupees);
  assert.equal(sumPaise(items), 22345707);
  assert.equal(fmtRupees(sumPaise(items)), '2,23,457.07');
  // The float version of 0.10 + 0.20 is not 0.30; the paise version is exactly 30.
  assert.notEqual(0.1 + 0.2, 0.3);
  assert.equal(sumPaise([parseRupees('0.10'), parseRupees('0.20')]), 30);
  assert.equal(sumPaise([10, undefined, 20]), 30); // requirements without a cost are skipped
  assert.throws(() => sumPaise([1.5]), InputError);
});

test('unit conversions are explicit', () => {
  assert.equal(convert(150, 'ms', 's'), 0.15); // divide by 1,000
  assert.equal(convert(2500, 'kWh', 'MWh'), 2.5); // divide by 1,000
  assert.equal(convert(30, 'min', 's'), 1800); // multiply by 60
  assert.equal(convert(110, 'kV', 'V'), 110000);
  assert.equal(convert(200, 'mHz', 'Hz'), 0.2);
  assert.equal(convert(5, '%', 'pu'), 0.05);
  assert.equal(convert(4.2, 'MW', 'kW'), 4200);
  assert.equal(normUnit('MVAr'), 'Mvar');
  assert.equal(normUnit('p.u.'), 'pu');
  assert.equal(normUnit('furlong'), null);
  assert.throws(() => convert(1, 'kV', 'Hz'), /Cannot convert/);
  assert.throws(() => convert(1, 'furlong', 'Hz'), /not known/);
});
