// CSV reading and writing (RFC 4180 style) plus header discovery for imports.
import { InputError, squash } from './util.js';

const BOM = '﻿';

/** Pick the delimiter that splits the sample lines most consistently (comma, semicolon or tab). */
function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t']) {
    const score = lines.reduce((a, l) => a + (l.split(d).length - 1), 0);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/**
 * Parse CSV text to an array of rows (arrays of strings). Handles a byte order mark, quoted
 * fields with embedded delimiters, doubled quotes and line breaks. Single pass, O(n).
 */
export function parseCSV(text, delimiter) {
  let s = String(text ?? '');
  if (s.startsWith(BOM)) s = s.slice(1);
  const d = delimiter || sniffDelimiter(s);
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === d) { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; i++; continue;
    }
    field += c; i++;
  }
  if (quoted) throw new InputError('The CSV file ends inside a quoted field. Check for a missing closing quote (").', 'file');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Reference-like text (clause "5.10", gazette "10/2024", long digit strings) is written as
 * ="5.10" so a spreadsheet keeps it as text. Without this, 5.10 becomes 5.1, 10/2024 becomes a
 * date and long numbers become 6.27E+11, and the original characters cannot be recovered.
 */
export function protectText(v) {
  const s = String(v ?? '');
  return /^[\d\s.,\/\-+eE:]+$/.test(s) && /\d/.test(s) ? '="' + s + '"' : s;
}

export function unprotectText(v) {
  const m = /^="(.*)"$/s.exec(String(v ?? ''));
  return m ? m[1] : String(v ?? '');
}

/** Rows -> CSV text: UTF-8 byte order mark, CRLF line ends, fields quoted only when needed. O(n). */
export function toCSV(rows) {
  const q = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) || s.startsWith('=') ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return BOM + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

const norm = (h) => squash(h).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

/**
 * Find the header row and map columns by name.
 * Why scan: exported sheets often start with title or date lines before the real header.
 * @param {string[][]} rows
 * @param {Object<string,string[]>} aliases field -> accepted header names
 * @param {string[]} required fields that must be present
 * @returns {{headerIndex:number, columns:Object<string,number>}}
 */
export function findHeader(rows, aliases, required = []) {
  const lookup = new Map(); // normalised header text -> field; a map so each cell is matched in O(1)
  for (const [field, names] of Object.entries(aliases)) {
    for (const nm of [field, ...names]) lookup.set(norm(nm), field);
  }
  let best = null;
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    const columns = {};
    rows[i].forEach((cell, c) => {
      const f = lookup.get(norm(cell));
      if (f && !(f in columns)) columns[f] = c;
    });
    const hits = Object.keys(columns).length;
    const hasRequired = required.every((f) => f in columns);
    if (hasRequired && hits >= 2 && (!best || hits > best.hits)) best = { headerIndex: i, columns, hits };
  }
  if (!best) {
    throw new InputError('No header row found. The file needs a row with these column names: ' +
      required.join(', ') + '. Other accepted columns: ' +
      Object.keys(aliases).filter((f) => !required.includes(f)).join(', ') + '.', 'file');
  }
  return { headerIndex: best.headerIndex, columns: best.columns };
}
