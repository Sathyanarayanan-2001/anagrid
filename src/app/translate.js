// On-device translation through the browser's Translator API (Chrome 138+ on desktop).
// The text never leaves the device: the browser downloads a language model once and translates
// locally. Where the API is missing the app says so and the user pastes an English text instead.
import { InputError } from '../core/util.js';

export const translatorAvailable = () => typeof self.Translator === 'function' || typeof self.Translator === 'object';

export const SOURCE_LANGS = [
  ['hr', 'Croatian'], ['de', 'German'], ['es', 'Spanish'], ['fr', 'French'], ['it', 'Italian'], ['pt', 'Portuguese'], ['pl', 'Polish'], ['nl', 'Dutch'],
  ['tr', 'Turkish'], ['el', 'Greek'], ['ro', 'Romanian'], ['bg', 'Bulgarian'], ['cs', 'Czech'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['hu', 'Hungarian'],
  ['da', 'Danish'], ['sv', 'Swedish'], ['no', 'Norwegian'], ['fi', 'Finnish'], ['uk', 'Ukrainian'], ['ru', 'Russian'], ['ar', 'Arabic'], ['hi', 'Hindi'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['id', 'Indonesian'],
];

/**
 * Translate line by line so line numbers stay the same in the original and the English text.
 * That keeps every citation valid for both versions.
 * @param {string} text @param {string} source BCP-47 code
 * @param {function({phase:string, done:number, total:number})} onProgress
 * @param {{cancelled:boolean}} token set cancelled = true to stop
 */
export async function translateText(text, source, onProgress, token = {}) {
  if (!translatorAvailable()) throw new InputError('This browser has no on-device translator. Use Chrome 138 or later on a desktop computer, or paste an English version of the text with Edit.', 'lang');
  const pair = { sourceLanguage: source, targetLanguage: 'en' };
  let state = 'available';
  try { if (self.Translator.availability) state = await self.Translator.availability(pair); } catch { state = 'unavailable'; }
  if (state === 'unavailable') throw new InputError('The browser cannot translate this language to English on this device. Paste an English version of the text with Edit instead.', 'lang');
  const tr = await self.Translator.create({ ...pair, monitor(m) { m.addEventListener('downloadprogress', (e) => onProgress({ phase: 'download', done: e.loaded, total: 1 })); } });
  const lines = text.split('\n');
  const outLines = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    if (token.cancelled) throw new InputError('Translation stopped. Nothing was changed.', 'lang');
    const line = lines[i];
    const ff = line.startsWith('\f') ? '\f' : '';
    const body = ff ? line.slice(1) : line;
    // Lines without letters (blank lines, numbers, table borders) are copied as they are.
    outLines[i] = /\p{L}/u.test(body) ? ff + String(await tr.translate(body)).replace(/\s*\n\s*/g, ' ') : line;
    if (i % 10 === 0) onProgress({ phase: 'translate', done: i + 1, total: lines.length });
  }
  onProgress({ phase: 'translate', done: lines.length, total: lines.length });
  if (tr.destroy) tr.destroy();
  return outLines.join('\n');
}
