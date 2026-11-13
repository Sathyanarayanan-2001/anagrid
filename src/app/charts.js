// Charts are plain HTML so the numbers scale with the text and stay readable on a phone.
// Rules followed: one axis per chart, the grid is recessive, a category keeps its colour and
// position whatever its count, status colours always come with a text label, and every chart
// has a Table view with the same numbers.
import { h, raw } from './ui.js';

const toggle = (id, mode) => h`<div class="seg" role="group" aria-label="View">
  <button type="button" data-act="chart-mode" data-chart="${id}" data-mode="chart" aria-pressed="${mode === 'chart'}">Chart</button>
  <button type="button" data-act="chart-mode" data-chart="${id}" data-mode="table" aria-pressed="${mode === 'table'}">Table</button></div>`;

const table = (cols, rows, total) => h`<div class="table-wrap"><table><thead><tr><th>${cols[0]}</th><th class="num">${cols[1]}</th>${cols[2] ? h`<th class="num">${cols[2]}</th>` : ''}</tr></thead>
  <tbody>${rows.map((r) => h`<tr><td>${r.label}</td><td class="num">${r.n}</td>${cols[2] ? h`<td class="num">${pct(r.n, total)}</td>` : ''}</tr>`)}</tbody></table></div>`;

export const pct = (n, total) => (total ? (Math.round((n / total) * 1000) / 10).toFixed(1) + ' %' : '0.0 %');

/** Horizontal bars, one series. Bar widths are applied after render (see applyBars) to satisfy the CSP. */
export function barChart({ id, title, rows, mode, unit, empty }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  const body = !rows.length ? h`<p class="muted">${empty}</p>`
    : mode === 'table' ? table([unit[0], unit[1]], rows)
    : h`<div class="bars" role="img" aria-label="${title}: ${rows.map((r) => r.label + ' ' + r.n).join(', ')}">${rows.map((r) => h`
        <span class="lbl" title="${r.label}">${r.label}</span>
        <span class="track" data-tip="${r.label}: ${r.n} ${unit[1].toLowerCase()}"><span class="bar" data-w="${(r.n / max) * 100}"></span></span>
        <span class="val">${r.n}</span>`)}</div>`;
  return h`<figure class="chart" id="chart-${id}"><div class="chart-head"><h2>${title}</h2>${rows.length ? toggle(id, mode) : ''}</div>${body}</figure>`;
}

/** One stacked bar for the four determinations, plus a labelled legend. */
export function statusChart({ id, title, rows, mode, empty }) {
  const total = rows.reduce((a, r) => a + r.n, 0);
  const body = !total ? h`<p class="muted">${empty}</p>`
    : mode === 'table' ? table(['Determination', 'Requirements', 'Share'], rows, total)
    : h`<div class="stack" role="img" aria-label="${title}: ${rows.map((r) => r.label + ' ' + r.n).join(', ')}">${rows.filter((r) => r.n).map((r) => h`<span class="c-${r.id}" data-w="${(r.n / total) * 100}" data-tip="${r.label}: ${r.n} (${pct(r.n, total)})"></span>`)}</div>
      <ul class="legend">${rows.map((r) => h`<li><span class="sw c-${r.id}" aria-hidden="true"></span>${r.label}<b>${r.n}</b><span class="muted">${pct(r.n, total)}</span></li>`)}</ul>`;
  return h`<figure class="chart" id="chart-${id}"><div class="chart-head"><h2>${title}</h2>${total ? toggle(id, mode) : ''}</div>${body}</figure>`;
}

/** Set bar widths through the CSS object model; inline style attributes are blocked by the page's CSP. */
export function applyBars(root) {
  for (const el of root.querySelectorAll('[data-w]')) el.style.width = Math.max(0, Math.min(100, Number(el.dataset.w))) + '%';
}
export { raw };
