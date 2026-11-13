# Security

## Supported versions

The version deployed at https://sathyanarayanan-2001.github.io/anagrid/ (latest `main`).

## Reporting a problem

Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). Please do not open a public issue for a security problem, and do not attach real project documents or backups to any report.

## Design notes

- **No server.** The app is static files. User data stays in the browser (IndexedDB) and, if the user chooses, in save files in a folder of their own.
- **Content-Security-Policy.** `default-src 'none'`; the single inline script and style are allowed by SHA-256 hash; no `unsafe-inline`, no remote origins. A request to any other site is refused by the browser.
- **Injection.** All rendering goes through an escaping template tag; document text is shown as text; links are limited to http and https; the downloaded report escapes every value.
- **Input validation.** Every form field, imported row, backup record and typed address is validated; malformed records in a backup or save file are skipped.
- **Secrets.** The app needs none. Never put API keys, tokens or passwords in code or in the repository; a tool that needs one must read it from the environment.
- **Dependencies.** None at runtime. Build-time dependencies are pinned to exact versions with a committed lock file; GitHub Actions are pinned to exact release tags and run with read-only default permissions.
- **Shared origin.** All projects under one github.io account share a browser origin. AnaGrid prefixes its IndexedDB database, localStorage keys and cache names with `anagrid` and never touches other keys.
