# Changelog

All notable changes are listed here. Versions follow semantic versioning; dates are ISO (year-month-day).

## [1.1.0] - 2026-11-13

### Added
- Find official documents: type a country or region and a year; the built-in source catalogue lists the documents published in or before that year with official reference, date, state at the cut-off and a link to the official publisher. The current year runs to today; a future year is treated as today.
- Catalogue entries for Croatia, Australia, India, Germany, Spain, France, Italy, Poland, the Netherlands and the European Union; official operator list for the other ENTSO-E countries.
- Add one or all found documents to the register with their metadata.
- `scripts/check-sources.mjs` and the "Check official sources" workflow, which request every catalogue link from GitHub's servers.

## [1.0.0] - 2026-11-13

First release.

### Added
- Document register per country with type, official reference, date, language, status and source link.
- Built-in readers for .docx, text-based .pdf and .txt files; page numbers kept for PDFs.
- On-device translation to English through the browser Translator API, line by line, original kept.
- Requirement extraction: clause, paragraph and table-row segmentation, obligation strength, numeric thresholds with units and comparators, 22 categories, applicability, findings.
- Compliance: turbine capability register, checks with explicit unit conversion, four determinations, cross-document discrepancy detection.
- Requirements document as HTML, Markdown and CSV; print layout.
- Dashboard with Chart and Table views.
- Gap tracking per requirement: action, due date (day first; ISO week and financial year derived), cost in rupees held as whole paise.
- CSV import with header discovery, column aliases and a preview with a status per row; JSON backup.
- Folder sync with per-record merge, tombstones, newest-three pruning and a permanent state indicator.
- Offline use (service worker, network first), installable manifest and icons, strict Content-Security-Policy.
- Light and dark themes, phone layout with bottom tabs, quick start, guide.
- Worked example: Croatia, 4 documents, 61 requirements.

### Revision history

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.1.0 | 2026-11-13 | Sathyanarayanan | Source catalogue with year cut-off |
| 1.0.0 | 2026-11-13 | Sathyanarayanan | First release |
