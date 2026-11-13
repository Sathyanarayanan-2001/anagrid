// Shared helpers. Everything here is pure so it runs unchanged in Node tests and in the browser.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a value for HTML text or attribute context. Every value that reaches innerHTML goes through this. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/**
 * Canonical JSON: object keys sorted recursively.
 * Why: two devices can serialise the same record with different key order, so raw JSON text
 * cannot be compared or used as a tie-break. O(n log k) for n values with k keys per object.
 */
export function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

/**
 * Stable multi-key sort. Array.prototype.sort is stable in modern engines, but the original
 * index is still used as the last key so the order never depends on the engine. O(n log n).
 * @param {Array} arr @param {...function(a,b):number} cmps comparators applied in order
 */
export function stableSort(arr, ...cmps) {
  return arr
    .map((v, i) => [v, i])
    .sort((a, b) => {
      for (const c of cmps) {
        const r = c(a[0], b[0]);
        if (r) return r;
      }
      return a[1] - b[1];
    })
    .map((p) => p[0]);
}

/** Text comparison that treats digit runs as numbers, so "Article 9" sorts before "Article 10". */
export function cmpNatural(a, b) {
  const ax = String(a ?? '').match(/\d+|\D+/g) || [];
  const bx = String(b ?? '').match(/\d+|\D+/g) || [];
  const n = Math.min(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const x = ax[i], y = bx[i];
    const dx = /^\d/.test(x), dy = /^\d/.test(y);
    if (dx && dy) {
      const d = Number(x) - Number(y);
      if (d) return d;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return ax.length - bx.length;
}

/** Random id. crypto is used (not Math.random) so ids from two devices cannot realistically collide. */
export function uid(prefix = 'r') {
  const b = new Uint8Array(9);
  globalThis.crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += x.toString(36).padStart(2, '0');
  return prefix + '_' + s.slice(0, 14);
}

/** Small non-cryptographic hash (FNV-1a, 32 bit) used only for duplicate detection keys. O(n). */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Collapse whitespace; used before comparing or hashing text so layout differences do not matter. */
export function squash(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Validation error whose message is safe and useful to show to the user. */
export class InputError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'InputError';
    this.field = field;
  }
}

/**
 * Run an async call with a timeout and exponential backoff.
 * Why: a hung network or file call must never freeze the tool; it fails, waits and retries.
 */
export async function withRetry(fn, { tries = 3, timeoutMs = 8000, baseDelayMs = 400, sleep } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastErr;
  for (let i = 0; i < tries; i++) {
    let timer;
    try {
      return await Promise.race([
        fn(i),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Timed out after ' + timeoutMs + ' ms')), timeoutMs); }),
      ]);
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await wait(baseDelayMs * 2 ** i);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
