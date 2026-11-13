// Guards for the repository itself: nothing private may be committed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const isRepo = (() => { try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: 'pipe' }); return true; } catch { return false; } })();

test('.gitignore blocks save, backup, export and source-document files', { skip: !isRepo }, () => {
  const mustIgnore = ['anagrid-save-abc123-1700000000000.json.gz', 'anagrid-backup-2026-11-13.json', 'anagrid-requirements-croatia-2026-11-13.csv', 'anagrid-capabilities-2026-11-13.csv',
    'old.bak', 'backup/x.json', 'exports/sheet.csv', 'private/notes.md', 'grid-code.pdf', 'docs/translation.docx', 'thresholds.xlsx', 'Croatia.zip', '.env', '.env.local', 'node_modules/x/index.js', 'dist/index.html'];
  for (const f of mustIgnore) {
    assert.doesNotThrow(() => execFileSync('git', ['check-ignore', '-q', f], { cwd: root, stdio: 'pipe' }), f + ' must be ignored');
  }
  for (const f of ['src/app/main.js', 'README.md', 'package-lock.json', 'tests/golden.mjs', 'src/icons/icon-192.png']) {
    assert.throws(() => execFileSync('git', ['check-ignore', '-q', f], { cwd: root, stdio: 'pipe' }), f + ' must not be ignored');
  }
});

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', '.scratch'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p); else yield p;
  }
}

test('no secrets, private addresses or office files anywhere in the repository', () => {
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const allowed = /@(users\.noreply\.github\.com|example\.(org|com)|fontsource\/|ibm\/)|noreply@|@v\d|@fontsource|@font-face|@media|@param|@returns/;
  const secret = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16})/;
  for (const file of walk(root)) {
    assert.ok(!/\.(pdf|docx?|xlsx?|pptx?|zip|7z|rar|gz|bak)$/i.test(file), 'office or archive file in the repository: ' + file);
    if (/\.(png|woff2)$/.test(file) || file.endsWith('package-lock.json') || file.includes('/licenses/')) continue;
    const text = readFileSync(file, 'utf8');
    assert.ok(!secret.test(text), 'secret-like text in ' + file);
    for (const m of text.match(email) || []) assert.ok(allowed.test(m) || allowed.test('@' + m.split('@')[1]), 'e-mail address in ' + file + ': ' + m);
  }
});

test('dependencies are pinned to exact versions and the lock file is present', () => {
  const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
  for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) assert.match(v, /^\d+\.\d+\.\d+$/, name + ' must be pinned exactly, got ' + v);
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0, 'the app itself has no runtime dependency');
  const lock = JSON.parse(readFileSync(root + 'package-lock.json', 'utf8'));
  assert.ok(lock.lockfileVersion >= 2);
  for (const wf of ['ci.yml', 'deploy.yml']) {
    const y = readFileSync(root + '.github/workflows/' + wf, 'utf8');
    for (const m of y.matchAll(/uses: ([\w./-]+)@(\S+)/g)) assert.match(m[2], /^v\d+\.\d+\.\d+$/, wf + ': ' + m[1] + ' must be pinned to an exact release');
    assert.match(y, /permissions:\n  contents: read/, wf + ' defaults to read-only permissions');
  }
});
