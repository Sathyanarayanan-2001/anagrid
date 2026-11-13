# Contributing

## Workflow

1. Create a branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Make the change with tests. `npm run check` runs unit tests, the build and the browser tests.
3. Open a pull request. CI must pass before merging; `main` deploys to GitHub Pages.

## Rules for code

- Plain HTML, CSS and JavaScript. No framework, no CDN, no runtime dependency. Everything ships inside one `index.html`.
- Logic lives in `src/core` as pure modules that run in Node and in the browser, so it can be unit tested without a browser.
- Every value shown on screen goes through the `h` template tag (escapes by default). Never build HTML by string concatenation.
- Validate input at the boundary (`src/core/model.js`) and throw `InputError` with a message that says what is wrong and how to fix it.
- Money is whole paise. Dates are `{y, m, d}` triples. Unit conversions go through `src/core/units.js`.
- Look records up by id through maps; sort with `stableSort` and give a tie-break.
- Comments explain why, not what.
- No inline `style="…"` attributes and no inline event handlers: the Content-Security-Policy blocks them.

## Rules for tests and data

- Each test states its input and the expected result worked out by hand.
- Use made-up text, names and amounts only. Never commit a real grid code file, a company document, a backup, a save file or an export. `.gitignore` and `tests/repo.test.mjs` enforce this.
- Before refactoring, write a test that pins the current behaviour.
- A change to the extraction rules must keep `tests/golden.mjs` at 15 of 15 rubric points, or the golden set must be updated with the reason in the pull request.
- Rerun the whole suite after every change.

## Releasing

Update `package.json` version, add a dated section to `CHANGELOG.md` (the build reads the release date from it), update the revision table in the Guide (`src/app/views-a.js`), merge to `main`.
