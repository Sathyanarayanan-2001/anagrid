// Build: bundle the modules, inline script, styles and fonts into one index.html, and write
// a Content-Security-Policy that allows exactly that script and that style (by hash).
import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = root + 'src/', dist = root + 'dist/';
const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
const read = (p) => readFileSync(p, 'utf8');
const sha = (s) => "'sha256-" + createHash('sha256').update(s, 'utf8').digest('base64') + "'";

// Release date comes from the changelog so a rebuild of the same version gives the same file.
const rel = new RegExp('## \\[' + pkg.version.replace(/\./g, '\\.') + '\\] - (\\d{4})-(\\d{2})-(\\d{2})').exec(read(root + 'CHANGELOG.md'));
const buildDate = rel ? rel[3] + '/' + rel[2] + '/' + rel[1] : '';

const js = await build({
  entryPoints: [src + 'app/main.js'], bundle: true, format: 'iife', minify: true, target: 'es2022', write: false, legalComments: 'none',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_DATE__: JSON.stringify(buildDate) },
});
// "</script" inside the bundle would end the inline script element early.
const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').trim();

// IBM Plex Sans, embedded so the page needs no font request. Unicode ranges are read from the
// package so the browser only decodes the extended set when a document needs it.
// Two weights only (400, 600): the 500 weight was dropped after measuring (docs/VERIFICATION.md);
// medium-weight labels fall back to 400.
const fdir = root + 'node_modules/@fontsource/ibm-plex-sans/';
function face(weight, subset) {
  const css = read(fdir + weight + '.css');
  const block = new RegExp('/\\* ibm-plex-sans-' + subset + '-' + weight + '-normal \\*/\\s*@font-face \\{[^}]*unicode-range: ([^;]+);').exec(css);
  if (!block) throw new Error('unicode-range not found for ' + subset + ' ' + weight);
  const b64 = readFileSync(fdir + 'files/ibm-plex-sans-' + subset + '-' + weight + '-normal.woff2').toString('base64');
  return '@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:' + weight + ';font-display:swap;src:url(data:font/woff2;base64,' + b64 + ') format("woff2");unicode-range:' + block[1] + '}';
}
const fonts = [face(400, 'latin'), face(600, 'latin'), face(400, 'latin-ext')].join('\n');
const style = (await transform(read(src + 'styles.css').replace('{{FONTS}}', fonts), { loader: 'css', minify: true })).code.trim();

const csp = ["default-src 'none'", 'script-src ' + sha(script), 'style-src ' + sha(style), "img-src 'self' data: blob:", 'font-src data:', "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'", "base-uri 'none'", "form-action 'none'"].join('; ');
const html = read(src + 'index.template.html').replace('{{CSP}}', csp).replace('{{STYLE}}', () => style).replace('{{SCRIPT}}', () => script);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist + 'icons', { recursive: true });
writeFileSync(dist + 'index.html', html);
writeFileSync(dist + 'sw.js', read(src + 'sw.js').replace('__APP_VERSION__', pkg.version));
copyFileSync(src + 'manifest.webmanifest', dist + 'manifest.webmanifest');
for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) copyFileSync(src + 'icons/' + f, dist + 'icons/' + f);
writeFileSync(dist + '.nojekyll', '');
// The embedded font is under the SIL Open Font License, which must travel with it.
mkdirSync(dist + 'licenses', { recursive: true });
copyFileSync(root + 'licenses/IBM-Plex-Sans-OFL.txt', dist + 'licenses/IBM-Plex-Sans-OFL.txt');
const kb = (n) => (n / 1024).toFixed(1) + ' kB';
console.log('dist/index.html ' + kb(Buffer.byteLength(html)) + ' (script ' + kb(Buffer.byteLength(script)) + ', style with fonts ' + kb(Buffer.byteLength(style)) + '), version ' + pkg.version);
