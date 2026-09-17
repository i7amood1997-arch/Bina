import { store } from '../db/store';
import { isImage } from '../files';
import { filsToInput, parseFils } from '../money';
import { CATEGORY, options } from '../strings';
import type { Category } from '../types';
import { h } from './dom';
import { icon, type IconName } from './icons';

// ---------- top bar ----------
export function topbar(title: string, opts: { back?: string | true; sub?: string; actions?: HTMLElement[] } = {}) {
  const back = opts.back
    ? h('button', {
        class: 'icon-btn', 'aria-label': 'رجوع',
        onclick: () => (opts.back === true || history.length > 1 ? history.back() : (location.hash = String(opts.back))),
      }, icon('back'))
    : null;
  return h('header', { class: 'topbar' },
    back,
    h('h1', null, title, opts.sub ? h('span', { class: 'sub' }, opts.sub) : null),
    ...(opts.actions ?? []),
  );
}

export function iconButton(name: IconName, label: string, onclick: () => void) {
  return h('button', { class: 'icon-btn', 'aria-label': label, title: label, onclick }, icon(name));
}

// ---------- toast ----------
let toastEl: HTMLElement | null = null;
let toastTimer: number | undefined;
export function toast(msg: string, action?: { label: string; run: () => void }, ms = 5000) {
  toastEl?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'msg' }, msg),
    action ? h('button', { onclick: () => { action.run(); el.remove(); } }, action.label) : null,
  );
  document.body.appendChild(el);
  toastEl = el;
  toastTimer = window.setTimeout(() => el.remove(), ms);
}

// ---------- sheets & dialogs ----------
export function openSheet(build: (close: () => void) => HTMLElement[], opts: { label?: string } = {}): () => void {
  const prevFocus = document.activeElement as HTMLElement | null;
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label ?? '' });
  const scrim = h('div', { class: 'scrim' }, sheet);
  const close = () => {
    scrim.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', close);
    prevFocus?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close);
  sheet.append(h('div', { class: 'grip' }), ...build(close));
  document.body.appendChild(scrim);
  (sheet.querySelector('button, input, select, textarea, a') as HTMLElement | null)?.focus();
  return close;
}

export function confirmDialog(o: { title: string; body?: string | HTMLElement; ok: string; danger?: boolean; cancel?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v); } };
    const close = openSheet((c) => [
      h('h2', null, o.title),
      o.body ? (typeof o.body === 'string' ? h('p', null, o.body) : o.body) : null,
      h('div', { class: 'dialog-actions' },
        h('button', { class: `btn block ${o.danger ? 'danger-fill' : 'primary'}`, onclick: () => { finish(true); c(); } }, o.ok),
        h('button', { class: 'btn block', onclick: () => { finish(false); c(); } }, o.cancel ?? 'إلغاء'),
      ),
    ].filter(Boolean) as HTMLElement[]);
    const obs = new MutationObserver(() => { if (!document.querySelector('.scrim')) { finish(false); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
    void close;
  });
}

export function chooseDialog<T extends string>(o: { title: string; body?: string | HTMLElement; choices: { value: T; label: string; primary?: boolean; danger?: boolean }[] }): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: T | null) => { if (!done) { done = true; resolve(v); } };
    openSheet((c) => [
      h('h2', null, o.title),
      o.body ? (typeof o.body === 'string' ? h('p', null, o.body) : o.body) : null,
      h('div', { class: 'dialog-actions' },
        ...o.choices.map((ch) => h('button', {
          class: `btn block ${ch.primary ? 'primary' : ''} ${ch.danger ? 'danger' : ''}`,
          onclick: () => { finish(ch.value); c(); },
        }, ch.label)),
        h('button', { class: 'btn block', onclick: () => { finish(null); c(); } }, 'إلغاء'),
      ),
    ].filter(Boolean) as HTMLElement[]);
    const obs = new MutationObserver(() => { if (!document.querySelector('.scrim')) { finish(null); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
  });
}

// ---------- fields ----------
let fid = 0;
const nextId = () => `f${++fid}`;

export interface Field<T> { el: HTMLElement; get(): T; set(v: T): void; input: HTMLElement; setError(msg: string | null): void; }

function wrapField(label: string, input: HTMLElement, id: string, hint?: string) {
  const err = h('div', { class: 'err', role: 'alert' });
  err.hidden = true;
  const el = h('div', { class: 'field' },
    h('label', { for: id }, label),
    input,
    hint ? h('div', { class: 'hint' }, hint) : null,
    err,
  );
  const setError = (msg: string | null) => {
    err.textContent = msg ?? '';
    err.hidden = !msg;
    input.querySelector('.input')?.classList.toggle('invalid', !!msg);
    input.classList.toggle('invalid', !!msg);
  };
  return { el, setError };
}

export function textField(label: string, value = '', o: { hint?: string; placeholder?: string; required?: boolean; ltr?: boolean; type?: string; autocomplete?: string } = {}): Field<string> {
  const id = nextId();
  const input = h('input', { id, class: `input ${o.ltr ? 'ltr' : ''}`, type: o.type ?? 'text', value, placeholder: o.placeholder, required: o.required, autocomplete: o.autocomplete ?? 'off' });
  const w = wrapField(label, input, id, o.hint);
  return { el: w.el, input, setError: w.setError, get: () => input.value.trim(), set: (v) => { input.value = v; } };
}

export function textArea(label: string, value = '', o: { hint?: string } = {}): Field<string> {
  const id = nextId();
  const input = h('textarea', { id, class: 'input' });
  input.value = value;
  const w = wrapField(label, input, id, o.hint);
  return { el: w.el, input, setError: w.setError, get: () => input.value.trim(), set: (v) => { input.value = v; } };
}

export function amountField(label: string, fils: number | null = null, o: { hint?: string; allowZero?: boolean } = {}): Field<number | null> {
  const id = nextId();
  const input = h('input', { id, class: 'input', inputmode: 'decimal', value: filsToInput(fils), placeholder: '0.000', autocomplete: 'off' });
  const wrap = h('div', { class: 'amount-wrap' }, input, h('span', { class: 'cur', 'aria-hidden': 'true' }, 'BD'));
  const w = wrapField(label, wrap, id, o.hint);
  return {
    el: w.el, input, setError: w.setError,
    get: () => parseFils(input.value),
    set: (v) => { input.value = filsToInput(v); },
  };
}

export function dateField(label: string, value: string | null, o: { hint?: string; optional?: boolean } = {}): Field<string | null> {
  const id = nextId();
  const input = h('input', { id, class: 'input ltr', type: 'date', value: value ?? '' });
  const w = wrapField(label, input, id, o.hint);
  return { el: w.el, input, setError: w.setError, get: () => input.value || null, set: (v) => { input.value = v ?? ''; } };
}

export function selectField<T extends string>(label: string, opts: [T, string][], value: T | '' , o: { hint?: string; placeholder?: string } = {}): Field<T | ''> & { setOptions(opts: [T, string][], value?: T | ''): void } {
  const id = nextId();
  const input = h('select', { id, class: 'input' });
  const fill = (list: [T, string][], v: T | '') => {
    input.innerHTML = '';
    if (o.placeholder !== undefined) input.append(h('option', { value: '' }, o.placeholder));
    for (const [k, l] of list) input.append(h('option', { value: k }, l));
    input.value = v;
  };
  fill(opts, value);
  const w = wrapField(label, input, id, o.hint);
  return {
    el: w.el, input, setError: w.setError,
    get: () => input.value as T | '',
    set: (v) => { input.value = v; },
    setOptions: (list, v) => fill(list, v ?? (input.value as T | '')),
  };
}

export function categoryField(value: Category): Field<Category> {
  const f = selectField('الفئة', options(CATEGORY), value);
  return { ...f, get: () => (f.get() || 'other') as Category };
}

export function segmented<T extends string>(label: string, choices: [T, string][], value: T, onchange?: (v: T) => void) {
  let current = value;
  const buttons = choices.map(([k, l]) => h('button', {
    type: 'button', 'aria-pressed': String(k === value),
    onclick: () => {
      current = k;
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(choices[i][0] === k)));
      onchange?.(k);
    },
  }, l));
  const el = h('div', { class: 'field' }, h('div', { class: 'label' }, label), h('div', { class: 'segmented', role: 'group', 'aria-label': label }, ...buttons));
  return { el, get: () => current };
}

/** Vendor select with an inline "new vendor" option. */
export function vendorField(value: string | null, o: { optional?: boolean; category?: Category; onchange?: (vendorId: string | null) => void; newName?: string } = {}) {
  const NEW = '__new__';
  const vendors = store.all('vendors').sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const sel = selectField<string>('الجهة', [...vendors.map((v) => [v.id, v.name] as [string, string]), [NEW, '+ جهة جديدة']],
    value ?? (o.newName ? NEW : ''), { placeholder: o.optional ? 'بدون جهة' : 'اختر الجهة' });
  const nameF = textField('اسم الجهة الجديدة', o.newName ?? '');
  const toggle = () => { nameF.el.hidden = sel.get() !== NEW; };
  sel.input.addEventListener('change', () => { toggle(); o.onchange?.(sel.get() && sel.get() !== NEW ? sel.get() : null); });
  toggle();
  const el = h('div', { class: 'stack' }, sel.el, nameF.el);
  return {
    el,
    selectedId: () => (sel.get() && sel.get() !== NEW ? sel.get() : null),
    isNew: () => sel.get() === NEW,
    /** Returns the vendor id, creating the vendor when needed. null when none chosen. */
    resolve(category: Category): string | null | false {
      const v = sel.get();
      if (v === NEW) {
        const name = nameF.get();
        if (!name) { nameF.setError('اكتب اسم الجهة'); return false; }
        const existing = store.all('vendors').find((x) => x.name.trim() === name);
        if (existing) return existing.id;
        return store.save('vendors', { name, category, contact_name: null, phone: null, cr_no: null, notes: null }).id;
      }
      if (!v) {
        if (o.optional) return null;
        sel.setError('اختر الجهة');
        return false;
      }
      return v;
    },
    setError: sel.setError,
  };
}

export function payerField(value?: string) {
  const payers = store.payers();
  return selectField<string>('من دفع', payers.map((p) => [p.id, p.name]), value ?? store.defaultPayerId() ?? '');
}

/** Two buttons: take photo / choose file. Keeps a list of chosen files with thumbnails. */
export function filePicker(o: { multiple?: boolean; label?: string } = {}) {
  const files: File[] = [];
  const list = h('div', { class: 'files' });
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sr-only', 'aria-hidden': 'true', tabindex: '-1' });
  const picker = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'sr-only', multiple: o.multiple !== false, 'aria-hidden': 'true', tabindex: '-1' });
  const render = () => {
    list.innerHTML = '';
    files.forEach((f, i) => {
      const thumb = isImage(f.type) ? h('img', { src: URL.createObjectURL(f), alt: '' }) : h('span', { class: 'lead-icon' }, icon('file'));
      list.append(h('div', { class: 'file-item' }, thumb,
        h('div', { class: 'main' }, f.name || 'صورة'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'إزالة', onclick: () => { files.splice(i, 1); render(); } }, icon('close')),
      ));
    });
  };
  const add = (e: Event) => {
    const inp = e.target as HTMLInputElement;
    for (const f of Array.from(inp.files ?? [])) {
      if (o.multiple === false) files.length = 0;
      files.push(f);
    }
    inp.value = '';
    render();
  };
  camera.addEventListener('change', add);
  picker.addEventListener('change', add);
  const el = h('div', { class: 'field' },
    h('div', { class: 'label' }, o.label ?? 'المستند (سند، فاتورة، إيصال)'),
    h('div', { class: 'file-pick' },
      h('button', { type: 'button', class: 'btn', onclick: () => camera.click() }, icon('camera'), 'صوّر'),
      h('button', { type: 'button', class: 'btn', onclick: () => picker.click() }, icon('upload'), 'اختر ملف'),
    ),
    camera, picker, list,
  );
  return { el, files: () => [...files] };
}

export function formFooter(primaryLabel: string, onsave: () => void | Promise<void>, extra?: HTMLElement) {
  const btn = h('button', { type: 'button', class: 'btn primary' }, primaryLabel);
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await onsave(); } finally { btn.disabled = false; }
  });
  return h('div', { class: 'form-footer' }, h('div', { class: 'inner' }, extra ?? null, btn));
}

export function empty(text: string, action?: HTMLElement) {
  return h('div', { class: 'empty' }, h('p', null, text), action ?? null);
}

export function alertBox(kind: 'warn' | 'info' | 'danger', body: (HTMLElement | string)[], actions: HTMLElement[] = []) {
  return h('div', { class: `alert ${kind === 'warn' ? '' : kind}` },
    icon(kind === 'info' ? 'info' : 'alert'),
    h('div', { class: 'body' }, ...body, actions.length ? h('div', { class: 'actions' }, ...actions) : null),
  );
}

export function loading(text = 'جارٍ التحميل…') {
  return h('div', { class: 'center' }, h('div', { class: 'spinner', role: 'progressbar', 'aria-label': text }), h('div', { class: 'muted' }, text));
}
