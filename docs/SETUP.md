# Setup

## Requirements

- Node 22 and npm (build and tests only; the app itself needs nothing but a browser).
- Chrome or Chromium for the browser tests. If it is not in a standard location, set `CHROME_PATH`.

## Local use

```bash
npm ci
npm run check      # unit tests, build, browser tests
npm run serve      # http://127.0.0.1:8080
```

`npm run build` writes `dist/`: `index.html` (script, styles and fonts inlined), `sw.js`, `manifest.webmanifest`, `icons/`, `licenses/`.

## First publication on GitHub

The repository `anagrid` does not exist yet. Create it and publish through a pull request:

1. On GitHub create an empty public repository named `anagrid` under `Sathyanarayanan-2001` (no README, no licence, no .gitignore).
2. Unzip the hand-over archive, open a terminal in the folder, then:

   ```bash
   git init -b main
   git commit --allow-empty -m "chore: start repository"
   git remote add origin https://github.com/Sathyanarayanan-2001/anagrid.git
   git push -u origin main

   git switch -c feat/anagrid-v1
   git add .
   git status            # check the list: no PDF, Word, backup or save file may appear
   git commit -m "feat: AnaGrid 1.0.0"
   git push -u origin feat/anagrid-v1
   ```

3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Open a pull request from `feat/anagrid-v1` to `main`. Wait for the **CI** check to pass, then merge.
5. The **Deploy to GitHub Pages** workflow runs on `main`. When it is green the app is live at https://sathyanarayanan-2001.github.io/anagrid/.
6. Recommended: **Settings → Branches → Add rule** for `main`: require a pull request and the `test` status check.

The workflows could not be run before hand-over (no push access from the build session). If a step fails on the first run, the log names the step; the commands are the same as `npm run check` locally.

## Sync folder (per device)

1. Open the live page in Chrome or Edge on the computer.
2. Data → **Choose sync folder** → pick or create a folder inside OneDrive, for example `OneDrive/AnaGrid`.
3. Repeat on the second computer with the same OneDrive folder.

After a browser restart the browser may ask again for folder permission; the pill at the top then reads **Folder access needed** and the Data tab shows **Reconnect folder**.

## Install as an app

In Chrome or Edge open the live page and choose **Install AnaGrid** from the address bar or the browser menu. After the first visit it opens without a network connection.

## Checking speed

```bash
npm run build && npm run serve &
npx lighthouse@12 http://127.0.0.1:8080/ --only-categories=performance,accessibility,best-practices
```

The numbers measured for this release are in [VERIFICATION.md](VERIFICATION.md).
