// Small rendering helpers. All HTML is built with the h`` tag, which escapes every
// interpolated value unless it is itself the result of h`` (or raw()). That makes escaping
// the default instead of something each view has to remember.
import { esc, InputError } from '../core/util.js';

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
const out = (v) => {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(out).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
};
export function h(strings, ...vals) {
  let s = '';
  strings.forEach((part, i) => { s += part; if (i < vals.length) s += out(vals[i]); });
  return new Raw(s);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
export function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, bad ? 7000 : 3500);
}

/** Plain-words message for any error; unexpected errors still say what to do next. */
export function errText(e) {
  if (e instanceof InputError) return e.message;
  return 'Something went wrong: ' + (e && e.message ? e.message : 'unknown error') + '. Your saved data is not affected. Try again; if it repeats, export a backup from the Data tab and reload the page.';
}

/**
 * Modal dialog with a form.
 * @param {{title:string, body:Raw, submit?:string, wide?:boolean, cancel?:string, extra?:Raw,
 *   onSubmit?:function(FormData, HTMLDialogElement):any, onOpen?:function(HTMLDialogElement)}} opt
 * onSubmit may throw InputError: the message is shown in the dialog and the field is focused,
 * and nothing is closed or lost.
 */
export function openDialog(opt) {
  const dlg = document.createElement('dialog');
  if (opt.wide) dlg.className = 'wide';
  dlg.innerHTML = h`<form novalidate>
    <div class="dlg-head"><h2>${opt.title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">Close</button></div>
    <div class="dlg-body"><div class="form-error" role="alert"></div>${opt.body}</div>
    <div class="dlg-foot">${opt.extra || ''}<button type="button" class="btn" data-close>${opt.cancel || 'Cancel'}</button>${opt.submit ? h`<button type="submit" class="btn primary">${opt.submit}</button>` : ''}</div>
  </form>`.s;
  $('#dialogs').append(dlg);
  const form = $('form', dlg);
  const fail = (e) => {
    const box = $('.form-error', dlg);
    box.textContent = errText(e);
    $$('[aria-invalid]', dlg).forEach((el) => el.removeAttribute('aria-invalid'));
    const field = e instanceof InputError && e.field ? form.elements[e.field] || $('[data-field="' + CSS.escape(e.field) + '"]', dlg) : null;
    if (field && field.focus) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
    box.scrollIntoView({ block: 'nearest' });
  };
  dlg.fail = fail;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!opt.onSubmit) { dlg.close(); return; }
    const btn = $('button[type="submit"]', dlg);
    try {
      if (btn) btn.disabled = true;
      const keep = await opt.onSubmit(new FormData(form), dlg);
      if (keep !== false) dlg.close();
    } catch (e) {
      fail(e);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  dlg.addEventListener('click', (ev) => { if (ev.target.closest('[data-close]')) dlg.close(); });
  dlg.addEventListener('close', () => { dlg.remove(); if (opt.onClose) opt.onClose(); });
  // Keep the field being typed in above the on-screen keyboard: after the keyboard has resized
  // the viewport, bring the focused control back into view. Nothing is re-rendered on resize,
  // so the keyboard never closes by itself.
  dlg.addEventListener('focusin', (ev) => {
    if (ev.target.matches('input, textarea, select')) setTimeout(() => ev.target.scrollIntoView({ block: 'center', behavior: 'auto' }), 250);
  });
  dlg.showModal();
  if (opt.onOpen) opt.onOpen(dlg);
  return dlg;
}

/** Yes/no question; for irreversible actions the user must type a word first. */
export function confirmDialog({ title, text, confirm = 'Confirm', danger = false, typed = '' }) {
  return new Promise((resolve) => {
    let done = false;
    openDialog({
      title,
      body: h`<p>${text}</p>${typed ? h`<label class="field"><span>Type ${typed} to confirm</span><input type="text" name="typed" autocomplete="off" autocapitalize="characters"></label>` : ''}`,
      submit: confirm,
      onSubmit: (fd) => {
        if (typed && String(fd.get('typed')).trim().toUpperCase() !== typed) throw new InputError('Type ' + typed + ' exactly to confirm, or press Cancel.', 'typed');
        done = true; resolve(true);
      },
      onClose: () => { if (!done) resolve(false); },
      onOpen: (dlg) => { if (danger) $('button[type="submit"]', dlg).classList.replace('primary', 'danger'); },
    });
  });
}

export function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const options = (list, selected, placeholder) => h`${placeholder !== undefined ? h`<option value="">${placeholder}</option>` : ''}${list.map((o) => h`<option value="${o.id}" ${o.id === selected ? raw('selected') : ''}>${o.label}</option>`)}`;
