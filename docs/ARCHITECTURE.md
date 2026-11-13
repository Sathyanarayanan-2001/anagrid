# Architecture

## Shape

A static single-page app. The build inlines one script, one stylesheet and the fonts into `index.html`; the only other files are the service worker, the manifest, the icons and the font licence. There is no framework and no runtime dependency.

```
src/
  core/            pure logic; runs in Node (tests) and in the browser
    util.js        escaping, canonical JSON, stable sort, retry with timeout
    dates.js       day-first parsing, ISO weeks, financial year, Asia/Calcutta stamps
    money.js       rupees <-> whole paise, lakh grouping, exact totals
    units.js       explicit unit conversion table
    csv.js         CSV read/write, header discovery, text protection for spreadsheets
    catalog.js     categories, document kinds, determinations, checklists
    extract.js     segmentation, thresholds, classification, findings, language guess
    evaluate.js    checks -> determination, cross-document discrepancies
    model.js       record shapes and input validation
    store.js       in-memory indexed store with a persistence adapter
    merge.js       per-record merge, tombstones
    sync.js        folder sync engine (directory injected)
    transfer.js    CSV import plans, CSV export, JSON backup
    report.js      requirements document (data -> Markdown / HTML)
    stats.js       dashboard figures
    docx.js        .docx reader (ZIP + XML)
    pdf.js         PDF text reader
  app/             browser only: views, dialogs, IndexedDB, folder access, translation
  styles.css, index.template.html, sw.js, manifest.webmanifest, icons/
scripts/           build, local server, browser tests, icon generator
tests/             unit tests (node:test), golden examples, generated fixtures
```

## Data model

Every record has `id`, type `t` and update time `u` (milliseconds). A deletion is a tombstone `{id, t, d: 1, u}`.

| Type | Fields |
|---|---|
| `doc` | country, title, kind, issuer, ref (text), version, published (ISO date), lang, status, url, notes, text, orig, added |
| `req` | code, docId, country, cite {clause, para, heading, section, page, line, lineEnd}, text, ctx, modality, cat, rel, thresholds[], flags[], checks[], manual {status, evidence}, action, due, cost (paise), seq, key |
| `cap` | key, value, unit, evidence |

Storage: IndexedDB database `anagrid-v1` (stores `rec` and `kv`). localStorage keys `anagrid:v1:*` hold only the theme, the quick-start flag and the device id. Cache name `anagrid-v<version>`.

## Determination rules

1. A requirement with checks is computed: all met → COMPLIANT; met and not met mixed → PARTIALLY COMPLIANT; none met → NON-COMPLIANT; any check without a recorded value and no failure → INSUFFICIENT DATA.
2. Without checks a manual determination applies, but COMPLIANT and PARTIALLY COMPLIANT require written evidence.
3. Otherwise INSUFFICIENT DATA. Compliance is never assumed.

Notes are added when a value sits exactly on a limit, when a capability has no evidence, when units do not match, and when a manual determination contradicts the computed one.

## Extraction pipeline

1. **Segment.** Lines are scanned once. Clause markers (`Article 12.`, `Članak 12.`, `§ 5`, `Section 4.2 …`, `Annex II`, numbered headings) open clauses; a marker glued to the end of a heading or a heading on the line before or after is recognised; a reference inside a sentence (`… in accordance with Article 25.`) is not a marker. Inside a clause, `(1)` and `1.` open paragraphs; list items attach to their paragraph; table rows (`a | b | c`) become separate rows with their header as context. Form feeds give page numbers.
2. **Thresholds.** Numbers with units, ranges and named quantities (`cos φ`, `Q/Pmax`, `Plt`) with the comparator found next to them. Decimal and thousands commas are told apart by plausibility and flagged when ambiguous.
3. **Classify.** Obligation strength from modal verbs; category by weighted phrase votes (headings count double); applicability (power park modules, all generating modules, synchronous only, any user, other), inherited from the clause when a paragraph does not name its subject.
4. **Findings.** Figure references, image placeholders, operator-set values, undefined parameters, obligations without a number, standards and cross-references.

The engine is deterministic: the same text always gives the same candidates.

## Complexity of the main operations

n = records or text length, k = records of one type, c = checks of a requirement, m = text chunks on a PDF page.

| Operation | Time | Memory | Note |
|---|---|---|---|
| Lookup by id (`Store.get`) | O(1) | O(n) | hash map |
| List one type (`Store.all`) | O(k) | O(k) | per-type id set |
| Put / remove | O(1) amortised | O(1) | plus one IndexedDB write |
| Merge two record sets | O(n) | O(n) | map lookups; total order (u, canonical JSON) |
| Canonical JSON of a record | O(s log f) | O(s) | s = size, f = keys per object |
| Segment and analyse a document | O(n) | O(n) | single pass; de-duplication by hash map |
| Evaluate one requirement | O(c) | O(c) | capability index is a map |
| Dashboard figures | O(n) | O(n) | one pass with counters |
| Cross-document discrepancies | O(n + p) | O(n) | grouping by band in a map; p = pairs reported |
| Sort requirements / documents | O(n log n) | O(n) | stable, multi-key |
| Filter and search requirements | O(n) + O(n log n) | O(n) | first 150 rows rendered |
| CSV parse / write | O(n) | O(n) | single pass |
| Import plan | O(r) | O(r) | r = rows; document and duplicate lookups by map |
| .docx read | O(n) | O(n) | one pass over XML tokens |
| PDF read | O(n + Σ m log m) | O(n) | chunks sorted per page |
| Sync pull | O(f + n) | O(n) | f = files; unchanged files skipped by signature |

Nothing is worse than O(n log n).

## Sync

Each session writes one file `anagrid-save-<device>-<session start>.json.gz` holding every record, about 3 seconds after a change and at once when the page is hidden. It keeps the newest three files of its device. A pull reads every other session's file, skips files that cannot be read yet and retries them next time, and merges per record: newer `u` wins; on an exact tie the larger canonical JSON text wins, so all devices settle identically. All operations run through one queue, so a pull always waits for a running write.

## Security model

See [SECURITY.md](../SECURITY.md). In short: no server, strict CSP by hash, escape-by-default rendering, validation at every boundary.

## Design tokens

IBM Plex Sans (embedded, weights 400 and 600). Type scale 12 / 13 / 14 / 16 / 20 / 24 px, line height 1.45, tabular numbers. Slate neutrals, emerald accent, amber and red for warnings. Both themes are checked for WCAG 2.2 AA contrast in `tests/pdf-contrast.test.mjs`. Phone layout below 860 px: bottom tab bar, tables as cards, 44 px targets.
