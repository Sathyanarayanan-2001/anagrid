import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, MemoryAdapter } from '../src/core/store.js';
import { SyncEngine, MemoryDir, saveName, gzip, gunzip } from '../src/core/sync.js';
import { clock, seeded } from './helpers.mjs';

const timers = () => { const list = []; return { set: (fn, ms) => { const t = { fn, ms }; list.push(t); return t; }, clear: (t) => { const i = list.indexOf(t); if (i >= 0) list.splice(i, 1); }, list, runAll: async () => { while (list.length) await list.shift().fn(); } }; };

function device(name, dir, now, session = 1) {
  const store = new Store(new MemoryAdapter(), now);
  const tm = timers();
  const states = [];
  const sync = new SyncEngine(store, { device: name, session, now, setTimer: tm.set, clearTimer: tm.clear, onState: (s) => states.push(s) });
  sync.setDir(dir);
  return { store, sync, tm, states };
}
const ids = (s, t = 'doc') => s.all(t).map((r) => r.id).sort();

test('store: update times always move forward, indexes follow, data survives a reload', async () => {
  const now = clock(1000);
  const adapter = new MemoryAdapter();
  const s = new Store(adapter, now);
  const a = s.put({ id: 'a', t: 'doc', title: 'one' });
  assert.equal(a.u, 1000);
  now.set(500); // clock jumps backwards
  assert.equal(s.put({ id: 'a', t: 'doc', title: 'two' }).u, 1001);
  s.put({ id: 'b', t: 'req' });
  assert.deepEqual(ids(s), ['a']); assert.deepEqual(ids(s, 'req'), ['b']);
  s.remove('a');
  assert.equal(s.get('a'), undefined); assert.deepEqual(ids(s), []);
  assert.deepEqual(s.dump().find((r) => r.id === 'a'), { id: 'a', t: 'doc', d: 1, u: 1002 });
  assert.throws(() => s.put({ t: 'doc' }), /needs an id/);
  await s.pending;
  const again = new Store(adapter, now); // "reload"
  await again.load();
  assert.deepEqual(ids(again, 'req'), ['b']); assert.equal(again.get('a'), undefined);
  assert.equal(again.mergeIn([{ id: 'zz' }, null, { id: 'ok', t: 'doc', u: 5 }]), 1); // malformed records are ignored
});

test('two devices add entries at the same time: both end with both; a deletion reaches the other', async () => {
  const dir = new MemoryDir(), now = clock();
  const A = device('aaa', dir, now), B = device('bbb', dir, now);
  A.store.put({ id: 'doc_a', t: 'doc', title: 'Made-up code A' });
  B.store.put({ id: 'doc_b', t: 'doc', title: 'Made-up code B' }); // same instant, other device
  assert.equal(A.sync.state, 'waiting');
  await A.tm.runAll(); await B.tm.runAll(); // the 3-second timers fire
  assert.equal(A.sync.state, 'saved');
  assert.ok(A.states.includes('saving'));
  await A.sync.pull(); await B.sync.pull();
  assert.deepEqual(ids(A.store), ['doc_a', 'doc_b']);
  assert.deepEqual(ids(B.store), ['doc_a', 'doc_b']);
  await A.tm.runAll(); await B.tm.runAll();
  now.tick();
  A.store.remove('doc_b'); // deletion on A
  await A.sync.flush();
  await B.sync.pull();
  assert.deepEqual(ids(B.store), ['doc_a']);
  assert.equal(B.store.dump().find((r) => r.id === 'doc_b').d, 1); // tombstone travelled
});

test('exact tie in update time settles the same way on both devices', async () => {
  const dir = new MemoryDir(), now = clock(5000);
  const A = device('aaa', dir, now), B = device('bbb', dir, now);
  A.store.put({ id: 'x', t: 'doc', title: 'apple' });
  B.store.put({ id: 'x', t: 'doc', title: 'banana' }); // same id, same millisecond
  await A.sync.flush(); await B.sync.flush();
  await A.sync.pull(); await B.sync.pull();
  assert.equal(A.store.get('x').title, 'banana'); assert.equal(B.store.get('x').title, 'banana');
});

test('a save file that cannot be read yet is skipped and picked up next time', async () => {
  const dir = new MemoryDir(), now = clock();
  const A = device('aaa', dir, now), B = device('bbb', dir, now), C = device('ccc', dir, now);
  A.store.put({ id: 'from_a', t: 'doc' }); C.store.put({ id: 'from_c', t: 'doc' });
  await A.sync.flush(); await C.sync.flush();
  dir.unreadable.add(saveName('aaa', 1)); // OneDrive has listed the file but not delivered it
  await dir.write('notes.txt', new Uint8Array([1, 2, 3])); // unrelated file in the folder
  await dir.write('anagrid-save-zzz-9.json.gz', new Uint8Array([9, 9, 9])); // corrupt save file
  await B.sync.pull();
  assert.deepEqual(ids(B.store), ['from_c']); // the readable file still merged
  assert.equal(B.sync.state, 'waiting'); // merged records still have to reach this device's own save file
  await B.tm.runAll();
  assert.equal(B.sync.state, 'saved'); assert.match(B.sync.detail, /2 files still arriving/);
  dir.unreadable.clear();
  await B.sync.pull();
  assert.deepEqual(ids(B.store), ['from_a', 'from_c']);
});

test('only the newest 3 save files of a device are kept; other devices are untouched', async () => {
  const dir = new MemoryDir(), now = clock();
  let last;
  for (let s = 1; s <= 5; s++) {
    last = device('aaa', dir, now, s);
    await last.sync.pull(); // a new session first merges what earlier sessions saved
    last.store.put({ id: 'doc_' + s, t: 'doc' });
    await last.sync.flush();
  }
  const B = device('bbb', dir, now, 1); B.store.put({ id: 'b', t: 'doc' }); await B.sync.flush();
  const names = [...dir.files.keys()].sort();
  assert.deepEqual(names, ['anagrid-save-aaa-3.json.gz', 'anagrid-save-aaa-4.json.gz', 'anagrid-save-aaa-5.json.gz', 'anagrid-save-bbb-1.json.gz']);
  assert.deepEqual(ids(last.store), ['doc_1', 'doc_2', 'doc_3', 'doc_4', 'doc_5']); // nothing lost by pruning
});

test('a pull waits for a write that is still running', async () => {
  const dir = new MemoryDir(), now = clock();
  const log = [];
  const slowWrite = dir.write.bind(dir), list = dir.list.bind(dir);
  dir.write = async (n, b) => { log.push('write-start'); await new Promise((r) => setTimeout(r, 30)); await slowWrite(n, b); log.push('write-end'); };
  dir.list = async () => { log.push('list'); return list(); };
  const A = device('aaa', dir, now);
  A.store.put({ id: 'a', t: 'doc' });
  const w = A.sync.flush();
  const p = A.sync.pull(); // requested while the write is in flight
  await Promise.all([w, p]);
  assert.ok(log.indexOf('write-end') < log.lastIndexOf('list'), log.join(','));
  assert.equal(log.filter((x) => x === 'write-start').length, 1);
});

test('folder permission loss shows "folder access needed"; other errors show "sync problem"', async () => {
  const dir = new MemoryDir(), now = clock();
  const A = device('aaa', dir, now);
  dir.write = async () => { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; };
  A.store.put({ id: 'a', t: 'doc' });
  await A.sync.flush();
  assert.equal(A.sync.state, 'access');
  dir.write = async () => { throw new Error('disk full'); };
  await A.sync.flush();
  assert.equal(A.sync.state, 'problem'); assert.match(A.sync.detail, /disk full/);
  const solo = new Store(new MemoryAdapter(), now);
  const off = new SyncEngine(solo, { device: 'x', session: 1 });
  solo.put({ id: 'a', t: 'doc' });
  assert.equal(off.state, 'saved'); assert.equal(off.detail, 'Saved on this device'); // no folder chosen
});

test('save files are gzip JSON and round trip', async () => {
  const { store } = seeded();
  const bytes = await gzip(JSON.stringify({ n: store.dump().length }));
  assert.equal(bytes[0], 0x1f); assert.equal(bytes[1], 0x8b); // gzip magic
  assert.deepEqual(JSON.parse(await gunzip(bytes)), { n: 7 });
});
