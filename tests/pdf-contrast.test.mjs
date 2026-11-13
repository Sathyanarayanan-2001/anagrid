import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pdfToText } from '../src/core/pdf.js';
import { analyse, citeLabel } from '../src/core/extract.js';
import { makePdf, PDF_TEXT, makeDocx, DOCX_TEXT } from './fixtures.mjs';
import { docxToText } from '../src/core/docx.js';

test('PDF reader: standard font, kerned TJ, escapes, Flate stream, ToUnicode map, page breaks', async () => {
  const r = await pdfToText(makePdf());
  assert.equal(r.pages, 2);
  assert.equal(r.text, PDF_TEXT);
  assert.equal(r.unmapped, 0);
  // Page number reaches the citation: the second clause is on page 2.
  const text = r.text + 'Jedinica mora ostati priključena.\nČlanak 3\nx shall y.\nČlanak 4\nz shall w.\n';
  const items = analyse(text).items;
  assert.equal(citeLabel(items.find((i) => i.cite.clause === 'Članak 2').cite), 'Članak 2, p. 2, line 6');
});

test('PDF reader refuses what it cannot read, with a way forward', async () => {
  await assert.rejects(pdfToText(new TextEncoder().encode('hello')), /not a PDF/);
  const enc = Buffer.from(makePdf()).toString('latin1').replace('/Root 1 0 R', '/Root 1 0 R /Encrypt 99 0 R');
  await assert.rejects(pdfToText(new Uint8Array(Buffer.from(enc, 'latin1'))), /password-protected or encrypted/);
  await assert.rejects(pdfToText(new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n')), /No pages were found/);
});

test('generated .docx fixture reads back as expected', async () => {
  assert.equal(await docxToText(makeDocx(8)), DOCX_TEXT);
});

// ---- WCAG 2.2 AA contrast, computed from the colour tokens in styles.css ----
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
const light = tokens(/:root \{([\s\S]*?)\n\}/.exec(css)[1]);
const dark = { ...light, ...tokens(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(css)[1]) };
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// [text token, background token]: every pairing the stylesheet uses for text.
const TEXT_PAIRS = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text-2', 'bg'], ['text-2', 'surface'], ['text-2', 'surface-2'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'], ['accent', 'surface'], ['accent', 'bg'], ['accent', 'surface-2'], ['accent-ink', 'accent'],
  ['accent-soft-ink', 'accent-soft'], ['warn', 'surface'], ['warn', 'warn-soft'], ['warn', 'surface-2'], ['danger', 'surface'], ['danger', 'danger-soft'], ['danger-ink', 'danger'],
  ['bg', 'text'], // tooltip and toast: inverted
];
// Non-text marks (chart fills, focus ring, input borders) need 3:1 against the surface.
const MARK_PAIRS = [['st-good', 'surface'], ['st-bad', 'surface'], ['series', 'surface'], ['focus', 'surface'], ['focus', 'bg']];

for (const [name, t] of [['light', light], ['dark', dark]]) {
  test('contrast meets WCAG 2.2 AA in the ' + name + ' theme', () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 4.5, name + ': ' + fg + ' on ' + bg + ' is ' + r.toFixed(2) + ':1, needs 4.5:1');
    }
    for (const [fg, bg] of MARK_PAIRS) {
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 3, name + ': mark ' + fg + ' on ' + bg + ' is ' + r.toFixed(2) + ':1, needs 3:1');
    }
  });
}

test('both theme blocks define the same tokens (system-dark and chosen-dark stay identical)', () => {
  const sys = /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/.exec(css)[1];
  const chosen = /:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(css)[1];
  assert.deepEqual(tokens(sys), tokens(chosen));
});
