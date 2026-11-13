// Dashboard figures. Each figure is computed in one pass with map counters, O(n).
import { CATEGORIES, DOC_KINDS, STATUSES } from './catalog.js';
import { evaluate, capIndex } from './evaluate.js';
import { sumPaise } from './money.js';

/**
 * @param {{docs:Array, reqs:Array, caps:Array}} data live records
 * @param {{country?:string}} [filter]
 */
export function dashboard({ docs, reqs, caps }, filter = {}) {
  const inScope = (r) => !filter.country || r.country === filter.country;
  const d = docs.filter(inScope);
  const r = reqs.filter(inScope);
  const idx = capIndex(caps);

  const countBy = (list, keyOf, order) => {
    const m = new Map(order.map((o) => [o.id, 0]));
    for (const x of list) { const k = keyOf(x); m.set(k, (m.get(k) || 0) + 1); }
    return order.map((o) => ({ id: o.id, label: o.label, n: m.get(o.id) || 0 }));
  };

  const results = new Map();
  for (const q of r) results.set(q.id, evaluate(q, idx));

  const byStatus = countBy(r, (q) => results.get(q.id).status, STATUSES);
  const determined = r.length - byStatus.find((s) => s.id === 'INSUFFICIENT').n;
  const countries = new Set(d.map((x) => x.country).filter(Boolean));
  const perDoc = new Map();
  for (const q of r) perDoc.set(q.docId, (perDoc.get(q.docId) || 0) + 1);

  return {
    docs: d.length,
    countries: countries.size,
    reqs: r.length,
    withThresholds: r.filter((q) => (q.thresholds || []).length > 0).length,
    flagged: r.filter((q) => (q.flags || []).length > 0).length,
    determined,
    determinedShare: r.length ? determined / r.length : 0,
    costPaise: sumPaise(r.map((q) => q.cost)),
    byCategory: countBy(r, (q) => q.cat, CATEGORIES).filter((c) => c.n > 0),
    byStatus,
    byKind: countBy(d, (x) => x.kind, DOC_KINDS).filter((k) => k.n > 0),
    byDoc: d.map((x) => ({ id: x.id, label: x.title, n: perDoc.get(x.id) || 0 })),
    results,
  };
}
