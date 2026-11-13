// Per-record merge used by sync. Records look like {id, u, ...fields} or a tombstone {id, d:1, u}.
import { canon } from './util.js';

/**
 * Choose between two versions of one record.
 * The newer update time u wins. On an exact tie the larger canonical JSON text wins, so every
 * device picks the same survivor regardless of the order in which it saw the two versions.
 * (u, canonical text) is a total order, which makes this commutative, associative and idempotent.
 */
export function mergeRecord(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ua = a.u || 0, ub = b.u || 0;
  if (ua !== ub) return ua > ub ? a : b;
  const ca = canon(a), cb = canon(b);
  if (ca === cb) return a;
  return ca > cb ? a : b;
}

/**
 * Merge two id -> record maps into a new map. O(n) with hash-map lookups.
 * Tombstones are ordinary records here, so a deletion travels to other devices like any edit.
 */
export function mergeMaps(a, b) {
  const out = new Map(a);
  for (const [id, rec] of b) out.set(id, mergeRecord(out.get(id), rec));
  return out;
}

export const isLive = (r) => r && !r.d;

/** A deletion keeps only what merge needs: id, type, the tombstone flag and its time. */
export const tombstone = (rec, u) => ({ id: rec.id, t: rec.t, d: 1, u });
