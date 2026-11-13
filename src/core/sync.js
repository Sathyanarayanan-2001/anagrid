// Folder sync. Each session writes one gzip JSON save file into a folder that a sync app
// (OneDrive) carries between devices, and merges the save files of all other sessions.
// The directory is injected, so the same code runs against a real folder and a fake one in tests.
import { makeBackup, readBackup } from './transfer.js';

const FILE_RE = /^anagrid-save-([a-z0-9]+)-(\d+)\.json\.gz$/;
export const saveName = (device, session) => 'anagrid-save-' + device + '-' + session + '.json.gz';

export async function gzip(text) {
  const cs = new CompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(cs)).arrayBuffer());
}
export async function gunzip(bytes) {
  const ds = new DecompressionStream('gzip');
  return new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
}

/**
 * States shown to the user at all times:
 *  saved, saving, waiting (changes waiting), access (folder access needed), problem (sync problem).
 */
export class SyncEngine {
  /**
   * @param {Store} store
   * @param {{device:string, session:number, now?:function, delayMs?:number, setTimer?:function, clearTimer?:function, onState?:function}} opt
   */
  constructor(store, opt) {
    this.store = store;
    this.device = opt.device;
    this.session = opt.session;
    this.now = opt.now || (() => Date.now());
    this.delayMs = opt.delayMs ?? 3000;
    this.setTimer = opt.setTimer || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opt.clearTimer || ((t) => clearTimeout(t));
    this.onState = opt.onState || (() => {});
    this.dir = null;
    this.state = 'saved';
    this.detail = 'Saved on this device';
    this.dirty = false;
    this.timer = null;
    this.chain = Promise.resolve(); // one operation at a time: a pull must wait for a running write
    this.seen = new Map(); // file name -> signature of the version already merged
    this.pendingFiles = 0;
    store.onChange((origin) => { if (origin === 'local') this.touch(); });
  }

  _set(state, detail) {
    this.state = state; this.detail = detail;
    this.onState(state, detail);
  }

  /** Attach a directory adapter {list, read, write, remove}. */
  setDir(dir) { this.dir = dir; this.seen.clear(); }

  needAccess(msg = 'Folder access needed') { this._set('access', msg); }

  /** A local change happened: write about 3 seconds later, so a burst of edits makes one file write. */
  touch() {
    this.dirty = true;
    if (!this.dir) { this._set('saved', 'Saved on this device'); return; }
    if (this.state !== 'access') this._set('waiting', 'Changes waiting');
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => this.flush(), this.delayMs);
  }

  _queue(fn) {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  /** Write now (also called when the page is hidden; tab close is never relied on). */
  flush() {
    this.clearTimer(this.timer);
    return this._queue(async () => {
      if (!this.dir || !this.dirty) return false;
      this._set('saving', 'Saving');
      try {
        this.dirty = false;
        const bytes = await gzip(makeBackup(this.store.dump(), this.now()));
        await this.dir.write(saveName(this.device, this.session), bytes);
        await this._prune();
        this._set(this.dirty ? 'waiting' : 'saved', this.dirty ? 'Changes waiting' : this._savedText());
        return true;
      } catch (e) {
        this.dirty = true;
        this._fail(e);
        return false;
      }
    });
  }

  _savedText() { return this.pendingFiles ? 'Saved; ' + this.pendingFiles + ' file' + (this.pendingFiles > 1 ? 's' : '') + ' still arriving' : 'Saved'; }

  _fail(e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) this._set('access', 'Folder access needed');
    else this._set('problem', 'Sync problem: ' + (e && e.message ? e.message : 'unknown error'));
  }

  /** Keep the newest 3 save files of this device; older sessions are already merged into them. */
  async _prune() {
    const mine = [];
    for (const f of await this.dir.list()) {
      const m = FILE_RE.exec(f.name);
      if (m && m[1] === this.device) mine.push({ name: f.name, session: Number(m[2]) });
    }
    mine.sort((a, b) => b.session - a.session);
    for (const f of mine.slice(3)) { try { await this.dir.remove(f.name); } catch { /* a locked file is pruned next time */ } }
  }

  /**
   * Read every other session's save file and merge per record.
   * A file that cannot be read yet (sync apps deliver files late or half-written) is skipped
   * and retried on the next pull; it never stops the rest of the sync.
   */
  pull() {
    return this._queue(async () => {
      if (!this.dir) return 0;
      let files;
      try { files = await this.dir.list(); } catch (e) { this._fail(e); return 0; }
      let merged = 0, pending = 0;
      const own = saveName(this.device, this.session);
      for (const f of files) {
        if (!FILE_RE.test(f.name) || f.name === own) continue;
        const sig = f.modified + ':' + f.size;
        if (this.seen.get(f.name) === sig) continue;
        try {
          const recs = readBackup(await gunzip(await this.dir.read(f.name)));
          merged += this.store.mergeIn(recs, 'remote');
          this.seen.set(f.name, sig);
        } catch {
          pending++;
        }
      }
      this.pendingFiles = pending;
      // Records that only arrived from elsewhere must reach this session's own file too,
      // otherwise pruning old files on the other device could lose them.
      if (merged) { this.dirty = true; }
      if (this.state !== 'access') {
        if (this.dirty) this._set('waiting', 'Changes waiting');
        else this._set('saved', this._savedText());
      }
      return merged;
    }).then((n) => { if (this.dirty && this.dir) { this.clearTimer(this.timer); this.timer = this.setTimer(() => this.flush(), this.delayMs); } return n; });
  }
}

/** In-memory directory for tests. Files can be marked unreadable to imitate a late delivery. */
export class MemoryDir {
  constructor() { this.files = new Map(); this.unreadable = new Set(); this.clock = 0; }
  async list() { return [...this.files.entries()].map(([name, f]) => ({ name, size: f.bytes.length, modified: f.modified })); }
  async read(name) {
    if (this.unreadable.has(name)) throw new Error('File is not available yet');
    const f = this.files.get(name);
    if (!f) throw new Error('No such file');
    return f.bytes;
  }
  async write(name, bytes) { this.files.set(name, { bytes, modified: ++this.clock }); }
  async remove(name) { this.files.delete(name); }
}
