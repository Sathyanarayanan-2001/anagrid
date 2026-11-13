# FMEA, DMAIC and root-cause notes

## FMEA

Scales 1 to 10. Severity: effect on a compliance decision. Occurrence: how often the cause is expected. Detection: 1 = always caught before it matters, 10 = cannot be caught. RPN = S × O × D. Ordered by RPN.

| # | Area | Failure mode | Effect | Cause | S | O | D | RPN | Control in place | Further action |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Import | Figure or curve content missing from the text | FRT, P-Q and U-Q limits absent from the sheet | Curves exist only as images | 9 | 8 | 3 | 216 | FIGURE and IMAGE findings on the clause; listed under blockers in the report | Enter the curve points as checks by hand; consider a curve entry form |
| 2 | Import | Translation changes technical meaning | Wrong quantity or negation in a requirement | Machine translation (browser or external) | 9 | 5 | 4 | 180 | Original kept line for line; Show original toggle; warning in the translate dialog | Review numbers and negations against the original for every saved requirement |
| 3 | Evaluation | Capability value entered wrongly or for the wrong configuration | False COMPLIANT | Human entry, stale data sheet | 10 | 3 | 5 | 150 | Evidence field; "no evidence" finding; "exactly on the limit" note | Second-person review of the capability table before issuing a report |
| 4 | Import | PDF table columns merged or reordered | Value attached to the wrong row | PDF text is positional | 8 | 4 | 4 | 128 | Warning on every PDF import; page and line cited so the source can be checked | Prefer the .docx or official HTML where it exists |
| 5 | Import | Clause boundary missed | Requirement cited under the previous article | Unusual numbering or translation artefacts | 7 | 3 | 5 | 105 | Heuristics tested on golden set and on real codes; preview before saving; "no numbering recognised" warning | Add the pattern to the golden set when found |
| 6 | Evaluation | Requirement saved without checks stays INSUFFICIENT | Gaps not judged | Checks are added by hand | 5 | 7 | 2 | 70 | Dashboard "determinations made"; Compliance note counting requirements with thresholds but no check | none |
| 7 | Import | Number read with wrong decimal separator | Limit off by a factor of 1,000 | "15,000" against "50,2" | 9 | 2 | 3 | 54 | Plausibility rule per unit; NUMBER finding when ambiguous; raw text shown | none |
| 8 | Reporting | Report issued while documents are missing or superseded | Requirement from an outdated code | Register incomplete | 8 | 3 | 2 | 48 | Source table with status and date in every report; "What to collect" checklist | Check the gazette for amendments before each study |
| 9 | Storage | Browser data cleared | Loss of all entries on that device | Private mode, site data deleted | 8 | 2 | 3 | 48 | Folder sync; JSON backup; banner when storage is unavailable | Keep a sync folder connected |
| 10 | Evaluation | Unit mismatch between capability and check | Wrong comparison | pu against kV, s against ms | 8 | 3 | 1 | 24 | Explicit conversion table; incompatible units count as no data and are reported | none |
| 11 | Storage | Two devices edit the same record | One edit lost | Concurrent work | 4 | 3 | 2 | 24 | Per-record merge, newer wins, deterministic tie-break; tombstones | none |
| 12 | Storage | Save file half-delivered by the sync app | Sync stops | Cloud latency | 5 | 4 | 1 | 20 | Unreadable files skipped and retried; state shows files still arriving | none |
| 13 | Reporting | Spreadsheet alters clause numbers on CSV round trip | "5.10" becomes 5.1 | Spreadsheet type guessing | 6 | 3 | 1 | 18 | Reference-like text written as `="5.10"` and unwrapped on import | none |
| 14 | Import | Hostile content in a document or file name | Script execution | Untrusted files | 9 | 1 | 1 | 9 | Escape-by-default rendering; strict CSP; tested | none |

## DMAIC

**Define.** The user must not need to reopen a source document: every requirement in the sheet carries its exact wording, thresholds and citation, and every determination rests on recorded evidence. Defects are: a missed or mis-cited requirement, a wrong threshold, an assumed compliance, lost data.

**Measure.**
- Extraction: 5 golden examples, 15 of 15 rubric points; on the four 2024 Croatian documents the engine found 232 of 232 articles of the transmission code and 72 of 72 articles of the EU regulation.
- PDF reader against a reference extractor on 11 text PDFs: word recall 98.3 % to 100 %.
- Tests: counts per round in [VERIFICATION.md](VERIFICATION.md).
- Speed: first load and slowest actions, before and after each optimisation, in [VERIFICATION.md](VERIFICATION.md).

**Analyse.** Root causes of the defects found during the build are listed below. The dominant residual risks are outside the software: figures, translation quality and capability data (FMEA 1 to 3).

**Improve.** Fixes made: see the table below; two speed optimisations (extraction preview, font payload).

**Control.** 56 unit tests and 46 browser checks run on every push and pull request; the golden set gates changes to extraction rules; repository guards block private files; the contrast test gates colour changes; the changelog and revision table record every release.

## Root causes (5 Whys) of defects found during verification

| Defect | Why chain | Fix | Guard |
|---|---|---|---|
| Chart bars invisible | Bars had a width but no size → the bar was an inline element → inline elements ignore width and height → the mark was written as a `span` without `display: block` → the first test checked the style value, not the drawn size | `display: block` on the bar | Test now measures the drawn width and height of every bar |
| `Q/Pmax ≤ 0.33 as shown` not recognised | Threshold missed → the pattern rejected a number followed by a letter → the look-ahead meant to stop partial numbers also matched the next word → rule written too broadly → no example with trailing words | Look-ahead limited to digits and units | Golden example G3 |
| "within 150 ms at 110 kV" gave ≤ 110 kV | Comparator applied to the wrong number → search window reached back past an earlier number → window was by distance only → no rule that a phrase belongs to the nearest number | Phrase ignored when a digit lies between it and the number | Threshold unit test |
| Requirements list empty after deleting a document | Filter still pointed at the deleted document → filter state is kept across views → deletion did not clear dependent state → no single owner of filter validity | Filter dropped when its document no longer exists | Browser test deletes a filtered document |
| Open document stayed selected after extraction | Tab was switched in two places → one path skipped the cleanup → state was changed directly instead of through the route | Tab changes go through the address only | Browser test "extracting the same document again" |
| Chart toggle had no pressed state | `aria-pressed` rendered empty → the template helper dropped booleans → `true` treated like `false` | `true` renders as text | Browser test on the toggle |
| `#__proto__` showed an error page | Route lookup used a plain object → inherited keys counted as routes | Own-key lookup | Browser test with hostile addresses |
| Articles 205, 207, 209 of a real code not opened as clauses | Heading with commas or ending in "point" rejected → rule assumed commas mean a sentence → rule built from too few examples | Numbered headings accepted; reference-word list reduced | Unit test with those headings |
| Muted text below 4.5:1 on one surface | Token chosen by eye → no computed check at the time | Darker token | Contrast test for every text/background pair |
