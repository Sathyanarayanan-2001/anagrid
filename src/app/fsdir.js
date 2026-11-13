// Directory adapter over the File System Access API (showDirectoryPicker), used for the
// OneDrive sync folder. Every call has a timeout and a retry with backoff, because a cloud
// folder can stall while files are still being delivered; a stalled call must never freeze the app.
import { withRetry } from '../core/util.js';

const guard = (fn) => withRetry(fn, { tries: 2, timeoutMs: 10000, baseDelayMs: 500 });

export class FsDir {
  constructor(handle) { this.handle = handle; }
  async list() {
    return guard(async () => {
      const out = [];
      for await (const [name, entry] of this.handle.entries()) {
        if (entry.kind !== 'file') continue;
        try {
          const f = await entry.getFile();
          out.push({ name, size: f.size, modified: f.lastModified });
        } catch {
          out.push({ name, size: -1, modified: -1 }); // listed but not delivered yet: read will fail and be retried later
        }
      }
      return out;
    });
  }
  async read(name) {
    return guard(async () => new Uint8Array(await (await (await this.handle.getFileHandle(name)).getFile()).arrayBuffer()));
  }
  async write(name, bytes) {
    return guard(async () => {
      const fh = await this.handle.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
    });
  }
  async remove(name) { return guard(() => this.handle.removeEntry(name)); }
}

export const canPickFolder = () => typeof self.showDirectoryPicker === 'function';

/** 'granted', 'prompt' or 'denied'. Asking (ask = true) needs a click from the user. */
export async function permission(handle, ask) {
  const opts = { mode: 'readwrite' };
  let p = await handle.queryPermission(opts);
  if (p !== 'granted' && ask) p = await handle.requestPermission(opts);
  return p;
}
