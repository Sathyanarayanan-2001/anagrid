// Turn a chosen file into text, with a quality report so a bad extraction is never silent.
import { InputError } from '../core/util.js';
import { docxToText } from '../core/docx.js';
import { pdfToText } from '../core/pdf.js';
import { guessLanguage, LANG_NAMES } from '../core/extract.js';

const MAX_FILE = 80 * 1024 * 1024;

/** @returns {Promise<{text:string, info:string, warn:string, lang:string, name:string}>} */
export async function readDocFile(file) {
  if (file.size > MAX_FILE) throw new InputError('The file is ' + Math.round(file.size / 1048576) + ' MB; the limit is 80 MB. Split the document or save only its text.', 'file');
  if (file.size === 0) throw new InputError('The file is empty. Choose another file.', 'file');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text, warn = '', pages = 0;
  if (ext === 'docx') {
    text = await docxToText(bytes);
  } else if (ext === 'pdf') {
    const r = await pdfToText(bytes);
    text = r.text; pages = r.pages;
    const letters = (text.match(/\p{L}/gu) || []).length;
    if (letters < 40 * r.pages) warn = 'Almost no text was found in this PDF (' + letters + ' letters on ' + r.pages + ' pages). It is probably scanned. Run OCR on it first, or use a text-based version.';
    else if (r.unmapped > r.chars * 0.05) warn = 'Part of this PDF uses fonts without a text mapping, so some characters could not be read. Compare the text below with the PDF, or use the .docx version.';
    else warn = 'PDF text is read by position. Check tables and figures against the PDF: columns can merge and figure content is not captured.';
  } else if (['txt', 'md', 'text', 'csv', 'htm', 'html'].includes(ext)) {
    text = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
    if (ext === 'htm' || ext === 'html') text = new DOMParser().parseFromString(text, 'text/html').body.innerText;
    if ((text.match(/�/g) || []).length > 5) warn = 'Some characters could not be read as UTF-8. Save the file as UTF-8 text and choose it again.';
  } else if (ext === 'doc') {
    throw new InputError('Old .doc files cannot be read. Open the file in Word, save it as .docx, and choose that.', 'file');
  } else {
    throw new InputError('".' + ext + '" files are not supported. Choose a .docx, .pdf or .txt file, or paste the text.', 'file');
  }
  text = text.replace(/\r\n?/g, '\n');
  const g = guessLanguage(text);
  const lines = text.split('\n').length;
  const info = file.name + ': ' + text.length.toLocaleString('en-IN') + ' characters, ' + lines.toLocaleString('en-IN') + ' lines' + (pages ? ', ' + pages + ' pages' : '') + (g.lang ? ', looks like ' + LANG_NAMES[g.lang] : '');
  return { text, info, warn, lang: g.lang, name: file.name.replace(/\.[^.]+$/, '') };
}
