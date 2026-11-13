# Verification record, version 1.0.0 (13/11/2026)

Everything below was run during the build session on Node 22.23 and Chrome for Testing 153 (headless, Linux). What was **not** run is listed at the end; nothing in this file is reported from memory.

## Two methods

| Method | What it is |
|---|---|
| A. Automated tests | 56 unit tests (`npm test`) and 46 browser checks (`npm run test:e2e`: 35 function, 11 appearance) against the built `dist/` |
| B. Independent recomputation and inspection | Dashboard figures against a separate count of stored records; worked-example numbers against the English translation and the Croatian original; PDF reader against a reference extractor; screenshots reviewed by eye at desktop and phone sizes in both themes; Lighthouse |

## Counts per round

| Round | Unit tests | Browser: function | Browser: appearance | Review by eye | Outcome |
|---|---|---|---|---|---|
| 1, first full run | 52 of 52 | 24 of 33 | 10 of 11 | 1 defect (chart bars not drawn) | 2 app defects and 1 visual defect fixed; 7 failures were errors in the test script and were corrected |
| 1, rerun after fixes | 52 of 52 | 33 of 33 | 11 of 11 | clean | pass |
| 2, final build, everything rerun | 56 of 56 | 35 of 35 | 11 of 11 | 2 defects (table columns broke words mid-word; phone tiles in one column) | both fixed |
| 2, rerun after fixes | 56 of 56 | 35 of 35 | 11 of 11 | clean | pass |

Between the rounds four tests were added (partial selection in the extraction preview, hostile addresses, drawn size of chart bars, numbered headings glued to article markers) and the whole suite was rerun after every change. Earlier unit-level runs while the core was written: 19 of 19, 24 of 26 (two threshold defects), 37 of 39 (sync timer not awaited), 46 of 46, 51 of 52 (one colour below 4.5:1), then 52 of 52. Root causes are in [FMEA.md](FMEA.md).

## What the tests cover (prompt section 11)

| Required check | Where | Result |
|---|---|---|
| Midnight crossing, month end, 29 February | `dates-money-units.test.mjs`; browser "midnight, month end and leap day" | pass |
| Totals worked out by hand match to the paisa | unit: 1,23,456.78 + 0.10 + 0.20 + 99,999.99 = 2,23,457.07; browser: 1,23,456.78 + 0.22 = 1,23,457.00 | pass |
| ISO week 53 and 31 March / 1 April | unit and browser (31/12/2026 = CW53, 01/01/2027 = CW53 of 2026, 31/03/2027 = FY 2026-27, 01/04/2027 = FY 2027-28) | pass |
| Two devices add at the same time; a deletion reaches the other | unit (in-memory folder) and browser (two separate profiles exchanging real gzip save files) | pass |
| merge() commutative, associative, idempotent | 300 seeded random cases with frequent ties | pass |
| Reload, then offline | browser: service worker controls the page, network off, reload, 7 requirements still listed, embedded font available | pass |
| Phone 320, 360, 390 px | every tab: page width ≤ viewport, every visible control ≥ 44 × 44 px, bottom tabs, tables as cards, dialogs fit | pass |
| Round trip export → empty copy → import | JSON backup (unit and browser) and CSV (unit): counts and cost totals equal | pass |
| Every dashboard figure against a separate number | unit (plain loops) and browser (records read straight from IndexedDB) | pass |
| Characterisation before refactoring | the report test pinned the output before the report body was split out for the in-app preview | pass |
| Golden examples with rubric | 5 made-up examples × (correct, complete, format) = 15 of 15 | pass |
| Injection | hostile title and text shown as text, no element injected, no script ran; CSP refuses a request to another site | pass |
| Contrast | every text/background pair of both themes ≥ 4.5:1, marks ≥ 3:1, computed from the stylesheet | pass |

## Checks on the supplied Croatian documents (run locally; the documents are not in the repository)

- **Built-in readers and extractor on the four 2024 documents.** Transmission network rules (.docx, 3,185 lines): 635 clauses, 394 obligations or numeric limits, 232 of 232 articles found (plus one marker that the translation itself misnumbers as 233). National RfG decision: 6 of 6 articles and the Annex II table rows. EU 2016/631 (PDF, 68 pages): 72 of 72 articles, with page numbers. Three articles were first missed (205, 207, 209); the rule was corrected and a test added.
- **PDF reader against `pdftotext`** on the 11 text PDFs supplied: word recall 98.3 % to 100 %, precision 99.1 % to 100 %. Two PDFs are encrypted (RC4, AES) and are refused with an explanation; one is scanned and yields no text.
- **Worked example.** Each of the 61 entries had every number checked against the cited provision in the English translation, and the 58 Croatian entries also against the Croatian original. One automatic mismatch ("15,000" against "15000") was resolved by reading Article 91(2) of the original. The three EU entries were read against the regulation text.

## Speed

Lighthouse 12.8.2, mobile profile (simulated 4× CPU slowdown, 150 ms round trip, 1.6 Mbit/s), local server with gzip.

| Measure | Before | After | Change made |
|---|---|---|---|
| `index.html` size (gzip) | 300.0 kB (150.5 kB) | 269.4 kB (about 127 kB) | medium font weight dropped; weights 400 and 600 kept |
| First contentful paint | 1.4 s | 1.3 s | same |
| Largest contentful paint | 1.7 s | 1.5 s | same |
| Time to interactive | 1.7 s | 1.5 s | same |
| Lighthouse performance / accessibility / best practices | 99 / 100 / 100 | 100 / 100 / 100 | same |
| Slowest action: open the extraction preview for a 20,000-line document (4,200 clauses) | 874 to 1,060 ms | 204 to 281 ms | only the first 300 rows are drawn; the selection is held in a set |

Other timings on the same large document: save 4,200 requirements and list them 184 to 430 ms; one search keystroke 41 to 67 ms; dashboard 70 to 78 ms; report with 4,200 requirements 683 to 941 ms. Analysis of the real 3,185-line code takes about 75 ms.

## Stage checkpoints

| Stage | Deliverables | Tests run | Open issues at exit | Exit |
|---|---|---|---|---|
| 1 Plan | file list (see ARCHITECTURE.md) | none | none | pass |
| 2 Core logic | dates, money, units, CSV, extraction, evaluation, report | 26 unit tests | none | pass |
| 3 Storage and sync | store, merge, sync engine, import/export | 46 unit tests | none | pass |
| 4 Pages and styles | 8 tabs, dialogs, charts, themes, phone layout | browser round 1 | none after fixes | pass |
| 5 Import and export | .docx and PDF readers, CSV, backup, report downloads | unit and browser | encrypted and scanned PDFs unreadable (documented) | pass |
| 6 Documents and CI files | README, docs, workflows, guards | 56 unit tests | workflows not executed | pass with note |
| 7 Second round | full rerun, visual review, Lighthouse | 56 + 46 | none | pass |

## Usability test: not yet run with a person

A 5-task test with one first-time user could not be run in the build session, because no person was available. The script is below for the owner to run with a colleague. The browser test group 1 performs the same five tasks on a cold profile, which shows that the path works, not that a newcomer finds it.

Give the participant only the live link and these tasks. Note the time, wrong turns and where help was needed. Fix anything that blocks a task.

1. Add a grid code document for a country from a file on the computer.
2. Extract its requirements and save them.
3. Find the requirement on rate of change of frequency and open it at its line in the source.
4. Record that the turbine withstands 2.5 Hz/s, with evidence, and make that requirement show as compliant.
5. Download the requirements document.

## Not verified

- **GitHub Actions.** The workflows were not executed: the repository did not exist and the session could not push. Action versions are pinned to the newest release tags found on 13/11/2026 (`checkout` 7.0.1, `setup-node` 7.1.0, `configure-pages` 6.0.0, `upload-pages-artifact` 5.0.0, `deploy-pages` 5.0.1).
- **The deployed page.** Lighthouse and all tests ran against a local server, not against github.io, and not on a real phone.
- **Real on-device translation.** The test browser has no Translator API; the feature was tested with a stand-in that proves line-for-line handling, not translation quality.
- **A real OneDrive folder.** Sync was tested with a stand-in folder picker and real gzip save files moved between two browser profiles.
- **A real on-screen keyboard.** Emulated by shrinking the viewport while a field had focus.
- **App installation prompt.** Manifest, icons and service worker were checked; the install flow itself was not clicked through.
