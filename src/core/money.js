// Money is held as whole paise (integers). 1 rupee = 100 paise.
// Why: 0.1 + 0.2 !== 0.3 in floating point, so rupee floats drift; integer paise add exactly.
import { InputError } from './util.js';

/**
 * Parse typed rupees ("1,23,456.78", "₹ 1250", "1250.5") to integer paise using string
 * arithmetic only, so no float ever touches the amount.
 */
export function parseRupees(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new InputError('Amount is empty. Type rupees such as 1,23,456.78.', 'amount');
  const s = raw.replace(/[₹\s]|rs\.?|inr/gi, '').replace(/,/g, '');
  const mt = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!mt) {
    throw new InputError('"' + raw + '" is not an amount. Use digits with at most two decimals, such as 1,23,456.78 (no minus sign).', 'amount');
  }
  const paise = Number(mt[1]) * 100 + Number((mt[2] || '').padEnd(2, '0') || 0); // rupees to paise: multiply by 100
  if (!Number.isSafeInteger(paise)) throw new InputError('Amount is too large to store exactly.', 'amount');
  return paise;
}

/** Indian digit grouping: last three digits, then groups of two (12,34,567). */
export function groupLakh(digits) {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  return head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + digits.slice(-3);
}

/** Integer paise -> "1,23,456.78". */
export function fmtRupees(paise) {
  if (!Number.isSafeInteger(paise)) throw new InputError('Amount is not a whole number of paise.', 'amount');
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100); // paise to rupees: divide by 100
  return (neg ? '-' : '') + groupLakh(String(rupees)) + '.' + String(abs % 100).padStart(2, '0');
}

/** Exact integer total. Throws instead of silently losing precision. O(n). */
export function sumPaise(list) {
  let t = 0;
  for (const p of list) {
    if (p === undefined || p === null) continue;
    if (!Number.isSafeInteger(p)) throw new InputError('A stored amount is not a whole number of paise.', 'amount');
    t += p;
    if (!Number.isSafeInteger(t)) throw new InputError('Total is too large to hold exactly.', 'amount');
  }
  return t;
}
