// Made-up data shared by tests. Nothing here is a real document, project or amount.
import { Store, MemoryAdapter } from '../src/core/store.js';
import { makeDoc, reqFromItem, nextCode, makeCap } from '../src/core/model.js';
import { analyse } from '../src/core/extract.js';
import { GOLDEN_DOC } from './golden.mjs';

export function clock(start = 1_800_000_000_000) { let t = start; const fn = () => t; fn.tick = (ms = 1000) => { t += ms; return t; }; fn.set = (v) => { t = v; }; return fn; }

/** A store holding one made-up document and its six extracted requirements. */
export function seeded(now = clock()) {
  const adapter = new MemoryAdapter();
  const store = new Store(adapter, now);
  const doc = store.put(makeDoc({ country: 'Examplia', title: 'Examplia Grid Code', kind: 'tso', lang: 'English', ref: '10/2024', published: '28/10/2024', text: GOLDEN_DOC }));
  const gen = nextCode(doc.country, []);
  const reqs = store.putMany(analyse(GOLDEN_DOC).items.map((it, i) => reqFromItem(doc, it, gen(i + 1))));
  return { store, adapter, doc, reqs, now };
}

export const cap = (key, value, unit, evidence = 'Made-up test report TR-001, section 4') => makeCap({ key, value: String(value), unit, evidence });
