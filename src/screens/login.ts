import { sb } from '../db/supabase';
import { store } from '../db/store';
import { h, clear } from '../ui/dom';
import { icon } from '../ui/icons';
import { alertBox, loading, textField } from '../ui/components';

const markSrc = './icons/icon.svg';

export function renderLogin(root: HTMLElement) {
  clear(root);
  const email = textField('البريد الإلكتروني', '', { type: 'email', ltr: true, autocomplete: 'email' });
  const msg = h('div');
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'أرسل رابط الدخول');
  const form = h('form', { class: 'stack', onsubmit: async (e: Event) => {
    e.preventDefault();
    const value = email.get();
    if (!/^\S+@\S+\.\S+$/.test(value)) { email.setError('اكتب بريداً صحيحاً'); return; }
    email.setError(null);
    btn.disabled = true;
    clear(msg);
    const redirect = location.href.split('#')[0];
    const { error } = await sb().auth.signInWithOtp({ email: value, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
    btn.disabled = false;
    if (error) { msg.append(alertBox('danger', [`تعذر الإرسال: ${error.message}`])); return; }
    msg.append(alertBox('info', [h('strong', null, 'تفقد بريدك'), h('div', { class: 'small' }, `أرسلنا رابط الدخول إلى ${value}. افتحه من هذا الجهاز، أو اكتب الرمز المرسل هنا (مفيد عند استخدام التطبيق من الشاشة الرئيسية).`)]));
    msg.append(codeForm(value));
  } }, email.el, btn, msg);

  root.append(h('div', { class: 'login' },
    h('img', { src: markSrc, alt: '', class: 'mark' }),
    h('h1', null, 'بناء البيت'),
    h('p', { class: 'muted', style: 'margin:0 0 28px' }, 'كل تكاليف ومستندات البيت في مكان واحد.'),
    form,
  ));
}

function codeForm(email: string) {
  const code = textField('رمز الدخول', '', { ltr: true, autocomplete: 'one-time-code' });
  code.input.setAttribute('inputmode', 'numeric');
  const out = h('div');
  const btn = h('button', { class: 'btn block', type: 'button', onclick: async () => {
    const token = code.get().replace(/\s/g, '');
    if (token.length < 6) { code.setError('اكتب الرمز كاملاً'); return; }
    btn.disabled = true;
    const { error } = await sb().auth.verifyOtp({ email, token, type: 'email' });
    btn.disabled = false;
    if (error) code.setError('الرمز غير صحيح أو منتهي');
  } }, 'دخول بالرمز');
  out.append(h('div', { class: 'stack', style: 'margin-top:16px' }, code.el, btn));
  return out;
}

export function renderNotMember(root: HTMLElement, onSignOut: () => void) {
  clear(root);
  root.append(h('div', { class: 'login' },
    h('span', { class: 'lead-icon warn', style: 'width:56px;height:56px;margin-bottom:16px' }, icon('alert')),
    h('h1', { style: 'font-size:24px' }, 'حسابك غير مضاف للمشروع'),
    h('p', { class: 'muted' }, 'سجّلت الدخول بنجاح، لكن هذا البريد غير مرتبط بمشروع البيت بعد. شغّل ملف الإعداد 003_seed.sql في Supabase بهذا البريد ثم أعد فتح التطبيق.'),
    h('div', { class: 'panel pad', style: 'margin:16px 0' }, h('div', { class: 'num', style: 'overflow-wrap:anywhere' }, store.email), h('div', { class: 'small muted num', style: 'overflow-wrap:anywhere' }, store.userId)),
    h('div', { class: 'stack' },
      h('button', { class: 'btn primary block', onclick: () => location.reload() }, 'إعادة المحاولة'),
      h('button', { class: 'btn block', onclick: onSignOut }, 'الدخول ببريد آخر'),
    ),
  ));
}

export function renderBoot(root: HTMLElement, text?: string) {
  clear(root);
  root.append(loading(text));
}
