// In-memory record store with indexes. The UI reads from here; a persistence adapter
// (IndexedDB in the browser, a Map in tests) is written through on every change.
import { mergeRecord, isLive, tombstone } from './merge.js';
import { InputError } from './util.js';

export class Store {
  /**
   * @param {{loadAll:function():Promise<Array>, putMany:function(Array):Promise<void>}} [adapter]
   * @param {function():number} [now] injectable clock so tests are deterministic
   */
  constructor(adapter, now = () => Date.now()) {
    this.adapter = adapter;
    this.now = now;
    this.recs = new Map();   // id -> record (including tombstones). Lookup by id is O(1).
    this.byType = new Map(); // type -> Set of live ids, so listing one type never scans everything
    this.listeners = new Set();
    this.pending = Promise.resolve();
  }

  async load() {
    if (!this.adapter) return;
    const all = await this.adapter.loadAll();
    for (const r of all) if (r && typeof r.id === 'string') this._set(r);
  }

  _set(rec) {
    const prev = this.recs.get(rec.id);
    if (prev && isLive(prev)) this.byType.get(prev.t)?.delete(prev.id);
    this.recs.set(rec.id, rec);
    if (isLive(rec)) {
      if (!this.byType.has(rec.t)) this.byType.set(rec.t, new Set());
      this.byType.get(rec.t).add(rec.id);
    }
  }

  _persist(recs) {
    if (!this.adapter || !recs.length) return this.pending;
    // Writes are chained so they reach storage in the order they were made.
    this.pending = this.pending.then(() => this.adapter.putMany(recs)).catch((e) => { this.lastError = e; });
    return this.pending;
  }

  _emit(origin) { for (const fn of this.listeners) fn(origin); }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  get(id) { const r = this.recs.get(id); return isLive(r) ? r : undefined; }

  /** Live records of one type. O(k) for k records of that type. */
  all(type) {
    const ids = this.byType.get(type);
    if (!ids) return [];
    const out = [];
    for (const id of ids) out.push(this.recs.get(id));
    return out;
  }

  /** Every record including tombstones, for sync and backup. */
  dump() { return [...this.recs.values()]; }

  /** Update time that is always later than the stored version, even if the clock went backwards. */
  _stamp(id) { return Math.max(this.now(), (this.recs.get(id)?.u || 0) + 1); }

  put(rec) { return this.putMany([rec])[0]; }

  putMany(list) {
    const saved = [];
    for (const rec of list) {
      if (!rec || typeof rec.id !== 'string' || !rec.id || typeof rec.t !== 'string') {
        throw new InputError('Record needs an id and a type.', 'record');
      }
      const next = { ...rec, u: this._stamp(rec.id) };
      delete next.d;
      this._set(next);
      saved.push(next);
    }
    this._persist(saved);
    this._emit('local');
    return saved;
  }

  remove(id) { this.removeMany([id]); }

  removeMany(ids) {
    const stones = [];
    for (const id of ids) {
      const prev = this.recs.get(id);
      if (!prev || !isLive(prev)) continue;
      const st = tombstone(prev, this._stamp(id));
      this._set(st);
      stones.push(st);
    }
    if (stones.length) { this._persist(stones); this._emit('local'); }
  }

  /**
   * Merge records that came from another device or a backup. Returns how many changed.
   * Uses the same mergeRecord as sync, so import, restore and sync all settle identically.
   */
  mergeIn(list, origin = 'remote') {
    const changed = [];
    for (const r of list) {
      if (!r || typeof r.id !== 'string' || typeof r.u !== 'number') continue; // malformed records are skipped, never trusted
      const cur = this.recs.get(r.id);
      const win = mergeRecord(cur, r);
      if (win !== cur) { this._set(win); changed.push(win); }
    }
    if (changed.length) { this._persist(changed); this._emit(origin); }
    return changed.length;
  }
}

/** Adapter for tests and for browsers without IndexedDB: everything lives in a Map. */
export class MemoryAdapter {
  constructor() { this.map = new Map(); }
  async loadAll() { return [...this.map.values()].map((r) => structuredClone(r)); }
  async putMany(recs) { for (const r of recs) this.map.set(r.id, structuredClone(r)); }
}
