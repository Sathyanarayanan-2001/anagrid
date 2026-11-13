// IndexedDB persistence. One object store for records, one for small values (the sync folder
// handle). The database name carries a project prefix because every project on one github.io
// account shares the same browser origin.
const DB_NAME = 'anagrid-v1';

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class IdbAdapter {
  async open() {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('rec', { keyPath: 'id' });
      r.result.createObjectStore('kv');
    };
    this.db = await req(r);
  }
  async loadAll() { return req(this.db.transaction('rec').objectStore('rec').getAll()); }
  putMany(recs) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction('rec', 'readwrite');
      const st = tx.objectStore('rec');
      for (const r of recs) st.put(r);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Storage write was aborted (the device may be out of space)'));
    });
  }
  async kvGet(key) { return req(this.db.transaction('kv').objectStore('kv').get(key)); }
  async kvSet(key, value) { return req(this.db.transaction('kv', 'readwrite').objectStore('kv').put(value, key)); }
  async kvDelete(key) { return req(this.db.transaction('kv', 'readwrite').objectStore('kv').delete(key)); }
  /** Erase every record on this device (the sync folder link is kept separately). */
  async clear() { return req(this.db.transaction('rec', 'readwrite').objectStore('rec').clear()); }
}
