// Home, Dashboard and Guide.
import { h } from './ui.js';
import { app, data, scoped, TABS, VERSION, BUILD_DATE } from './ctx.js';
import { dashboard } from '../core/stats.js';
import { fmtRupees } from '../core/money.js';
import { barChart, statusChart, pct } from './charts.js';
import { SAMPLE_SIZE } from './sample.js';

const emptyStart = (what) => h`<div class="empty"><h2>${what}</h2>
  <p>Add a grid code document to begin, or load the worked example to see a finished requirement sheet.</p>
  <div class="row" role="group"><button type="button" class="btn primary" data-act="doc-add">Add a document</button><button type="button" class="btn" data-act="sample-load">Load worked example</button></div></div>`;
export { emptyStart };

export function viewHome() {
  const d = data();
  return h`<section class="view">
    <div class="head"><h1>Grid code requirements for wind turbines</h1></div>
    <p class="lead">AnaGrid keeps the grid connection documents of each country you work in, reads them line by line, and turns them into one requirement sheet in which every requirement cites its document, article, paragraph and line. Record the turbine's proven capabilities and each requirement is judged as compliant, partially compliant, non-compliant or insufficient data.</p>
    <div class="row"><button type="button" class="btn primary" data-act="doc-add">Add a document</button>
      ${d.docs.length ? h`<a class="btn" href="#reqs">Open requirements</a>` : h`<button type="button" class="btn" data-act="sample-load">Load worked example</button>`}
      <button type="button" class="btn quiet" data-act="quickstart">Quick start</button></div>
    ${app.volatile ? h`<p class="note bad">This browser is not letting the app store data, so anything you add is lost when the page closes. Leave private browsing, or allow site data for this page, then reload.</p>` : ''}
    <p class="muted small">${d.docs.length} documents, ${d.reqs.length} requirements, ${d.countries.length} ${d.countries.length === 1 ? 'country' : 'countries'} stored on this device.</p>
    <h2>Sections</h2>
    <div class="cards">${TABS.filter((t) => t.id !== 'home').map((t) => h`<a class="card" href="#${t.id}"><h3>${t.label}</h3><p class="small">${t.blurb}</p></a>`)}</div>
  </section>`;
}

export function viewDashboard() {
  const d = data();
  if (!d.docs.length) return h`<section class="view"><div class="head"><h1>Dashboard</h1></div>${emptyStart('Nothing to chart yet')}</section>`;
  const s = dashboard({ docs: d.docs, reqs: d.reqs, caps: d.caps }, { country: app.state.country });
  const m = (id) => app.state.chart[id] || 'chart';
  const tile = (k, v, sub, wide) => h`<div class="tile${wide ? ' wide' : ''}"><div class="k">${k}</div><div class="v">${v}</div>${sub ? h`<div class="s">${sub}</div>` : ''}</div>`;
  return h`<section class="view">
    <div class="head"><h1>Dashboard</h1><span class="muted">${app.state.country || 'All countries'}</span></div>
    <div class="tiles">
      ${tile('Documents', s.docs)}${tile('Countries', s.countries)}${tile('Requirements', s.reqs)}
      ${tile('With numeric thresholds', s.withThresholds, pct(s.withThresholds, s.reqs) + ' of requirements')}
      ${tile('With open findings', s.flagged, 'figures, operator-set values, cross-references')}
      ${tile('Determinations made', s.determined + ' of ' + s.reqs, pct(s.determined, s.reqs) + ' judged on recorded data')}
      ${tile('Cost to close gaps', '₹ ' + fmtRupees(s.costPaise), 'sum of estimates entered', true)}
    </div>
    ${statusChart({ id: 'status', title: 'Determinations', rows: s.byStatus, mode: m('status'), empty: 'No requirements yet. Open a document and choose Extract requirements.' })}
    ${barChart({ id: 'cat', title: 'Requirements by category', rows: s.byCategory, mode: m('cat'), unit: ['Category', 'Requirements'], empty: 'No requirements yet. Open a document and choose Extract requirements.' })}
    ${barChart({ id: 'kind', title: 'Documents by type', rows: s.byKind, mode: m('kind'), unit: ['Document type', 'Documents'], empty: 'No documents in this country.' })}
    ${barChart({ id: 'doc', title: 'Requirements per document', rows: s.byDoc, mode: m('doc'), unit: ['Document', 'Requirements'], empty: 'No documents in this country.' })}
  </section>`;
}

export function viewGuide() {
  return h`<section class="view">
    <div class="head"><h1>Guide</h1><button type="button" class="btn" data-act="quickstart">Open quick start</button></div>
    <div class="card"><h2>The workflow</h2>
      <ol class="steps">
        <li><div><b>Collect.</b> On Documents choose a country and open <i>What to collect</i>: a checklist of document types (transmission code, distribution code, national parameter decisions, EU regulation, operator data lists, standards). The app has no network access, so you find the files at the operator, regulator and official gazette and add them here.</div></li>
        <li><div><b>Store.</b> Add each document with its official reference, date, language and status. Choose a .docx, .pdf or .txt file or paste the text. The text is kept on this device with line numbers; PDFs also keep page numbers.</div></li>
        <li><div><b>Translate.</b> If the text is not English, open the document and choose Translate. Translation runs inside the browser (Chrome 138 or later on a desktop). Lines keep their numbers, so citations hold for the original and the English text. In other browsers, paste an English version with Edit.</div></li>
        <li><div><b>Extract.</b> Choose Extract requirements. Every clause is split into paragraphs and table rows; obligations and numeric limits are recognised, classified into categories, and listed with article, paragraph, page and line. Review the list, untick what you do not need, and save. Nothing is saved before you press Save.</div></li>
        <li><div><b>Judge.</b> On Compliance record what the turbine can do, each value with its evidence. On a requirement add checks such as <i>RoCoF withstand ≥ 2 Hz/s</i>. The determination is computed: all checks met is compliant, mixed is partially compliant, none met is non-compliant, any missing value is insufficient data. Without checks you may set a determination by hand, but compliant needs written evidence.</div></li>
        <li><div><b>Report.</b> The Report tab builds the requirements document: sources, summary, every requirement with its citation and thresholds, discrepancies between documents, and the items that can block approval. Download it as HTML, Markdown or CSV, or print it.</div></li>
      </ol></div>
    <div class="card"><h2>Worked example</h2>
      <p><b>Input</b> (one clause of a made-up code): <span class="quote">Article 12. (1) A power park module shall remain connected to the network and operate within the frequency range of 47.5 Hz to 48.5 Hz for at least 30 minutes.</span></p>
      <p><b>Expected output:</b> one requirement cited as <i>Article 12, para (1), line 7</i>; obligation mandatory; category Frequency ranges; applies to power park modules; thresholds <i>47.5 Hz to 48.5 Hz</i> (range) and <i>at least 30 minutes</i> (≥ 30 min). With the capability <i>Operating time at 47.5-48.5 Hz = 30 min</i> and the check <i>≥ 30 min</i> the determination is compliant, with a note that the value sits exactly on the limit. Without the capability it is insufficient data.</p>
      <p>The Croatia example (Data tab, or the button on an empty Home) holds ${SAMPLE_SIZE.docs} documents and ${SAMPLE_SIZE.reqs} condensed requirements with article and table-row citations. Its turbine values are invented for demonstration.</p></div>
    <div class="card"><h2>What the findings mean</h2>
      <ul><li><b>Figure:</b> the clause points to a curve. Figure content is not text, so read the values from the source and add them as checks.</li>
      <li><b>Operator-set value:</b> the number is fixed per project by the operator or the connection agreement. Get it in writing.</li>
      <li><b>Not yet defined:</b> the source itself leaves the parameter open. Treat as an approval risk.</li>
      <li><b>No number:</b> an obligation without an acceptance criterion or test parameter.</li>
      <li><b>Standard or cross-reference:</b> the requirement is completed by another article or a standard that must be read with it.</li>
      <li><b>Discrepancy:</b> two stored documents give different values for the same band, or a manual determination contradicts the computed one.</li></ul></div>
    <div class="card"><h2>Dates, weeks and money</h2>
      <p>Type dates day first (28/10/2026 or 28/10). Times are 24-hour, Asia/Calcutta. Week (CW46, Monday to Sunday) and financial year (1 April to 31 March, FY 2026-27) are derived from the date. Costs are rupees with lakh grouping (1,23,456.78) and are added as whole paise, so totals are exact.</p></div>
    <div class="card"><h2>Sync, backup and offline use</h2>
      <p>Data lives in this browser. On the Data tab choose a folder inside OneDrive to sync between devices: each session writes one compressed save file, keeps its newest three, and merges the files of other devices record by record. The pill at the top always shows the state: saved, saving, changes waiting, folder access needed or sync problem. Folder sync needs Chrome or Edge on a computer. Export a JSON backup now and then. After the first visit the page opens without a network connection and can be installed as an app.</p></div>
    <div class="card"><h2>Limits to know</h2>
      <ul><li>Extraction is rule based and deterministic. It does not interpret figures, formulas or scanned pages, and it reads English wording best; translate first.</li>
      <li>PDF text is read by position: check tables against the source. Password-protected and scanned PDFs cannot be read.</li>
      <li>A .docx has no fixed pages, so citations from Word files give clause, paragraph and line.</li>
      <li>The tool supports an engineering review. The determination is only as good as the capability data and evidence recorded.</li></ul></div>
    <div class="card"><h2>Version</h2>
      <p>AnaGrid ${VERSION}${BUILD_DATE ? h`, built ${BUILD_DATE}` : ''}.</p>
      <div class="table-wrap"><table class="resp"><thead><tr><th>Version</th><th>Date</th><th>Changes</th></tr></thead><tbody>
        <tr><td data-l="Version">1.0.0</td><td data-l="Date">13/11/2026</td><td data-l="Changes">First release: document register, .docx and PDF reading, on-device translation, requirement extraction with citations, capability checks and determinations, dashboard, requirements document, CSV and JSON import and export, folder sync, offline use.</td></tr>
      </tbody></table></div></div>
  </section>`;
}
