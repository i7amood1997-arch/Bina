import { go, route, type Screen } from '../app';
import { store } from '../db/store';
import { commitmentFigures, vendorFigures } from '../engine';
import { fmtDate, today } from '../dates';
import { formatBD } from '../money';
import { CATEGORY, COMMITMENT_TYPE, options, PAYMENT_METHOD } from '../strings';
import type { Category } from '../types';
import { h, money } from '../ui/dom';
import { icon } from '../ui/icons';
import {
  categoryField, confirmDialog, empty, formFooter, iconButton, selectField, textArea, textField, toast, topbar,
} from '../ui/components';
import { commitmentRow, docRow, kv, paymentRow } from './common';

let lastQuery = '';
let lastCat: Category | '' = '';

route('/vendors', (): Screen => {
  const snap = store.snapshot();
  const list = h('ul', { class: 'list panel' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'ابحث عن جهة', value: lastQuery, 'aria-label': 'بحث' });
  const cat = selectField<Category>('الفئة', options(CATEGORY), lastCat, { placeholder: 'كل الفئات' });
  cat.el.querySelector('label')!.classList.add('sr-only');

  const draw = () => {
    lastQuery = search.value.trim();
    lastCat = cat.get();
    list.innerHTML = '';
    const vendors = store.all('vendors')
      .filter((v) => !lastQuery || v.name.includes(lastQuery) || (v.contact_name ?? '').includes(lastQuery))
      .filter((v) => !lastCat || v.category === lastCat)
      .map((v) => ({ v, f: vendorFigures(v.id, snap) }))
      .sort((a, b) => b.f.adjusted - a.f.adjusted || a.v.name.localeCompare(b.v.name, 'ar'));
    if (!vendors.length) {
      list.append(h('li', null, empty(store.all('vendors').length ? 'لا توجد نتائج.' : 'لا توجد جهات بعد.',
        h('a', { class: 'btn primary', href: '#/add/vendor' }, 'أضف جهة'))));
      return;
    }
    for (const { v, f } of vendors) {
      list.append(h('li', null, h('a', { class: 'row', href: `#/vendor/${v.id}` },
        h('div', { class: 'main' },
          h('span', { class: 'title' }, v.name),
          h('span', { class: 'meta' }, `${CATEGORY[v.category]} · ${f.count} ${f.count === 1 ? 'التزام' : 'التزامات'}`),
          f.adjusted > 0 ? h('div', { class: 'bar thin', style: 'margin-top:8px', 'aria-hidden': 'true' },
            h('span', { class: 'paid', style: `width:${Math.min(100, (f.paid / f.adjusted) * 100)}%` })) : null,
        ),
        h('div', { class: 'end' },
          money(formatBD(f.paid)),
          h('span', { class: 'meta' }, 'متبقي ', money(formatBD(f.remaining))),
        ),
        icon('chev', 'chev'),
      )));
    }
  };
  search.addEventListener('input', draw);
  cat.input.addEventListener('change', draw);
  draw();

  return {
    top: topbar('الجهات'),
    body: [
      h('div', { class: 'grid2', style: 'margin:4px 0 12px' }, search, cat.el),
      h('p', { class: 'small muted', style: 'margin:0 2px 8px' }, 'المبلغ الكبير = المدفوع لكل جهة'),
      list,
    ],
    tab: 'vendors',
    live: true,
  };
});

route('/vendor/:id', ({ id }): Screen => {
  const v = store.get('vendors', id);
  if (!v || v.deleted_at) return notFound('الجهة غير موجودة');
  const snap = store.snapshot();
  const f = vendorFigures(id, snap);
  const commitments = snap.commitments.filter((c) => c.vendor_id === id);
  const cids = new Set(commitments.map((c) => c.id));
  const payments = snap.payments.filter((p) => cids.has(p.commitment_id)).sort((a, b) => b.date.localeCompare(a.date));
  const docIds = new Set<string>();
  store.linksTo('vendor', id).forEach((l) => docIds.add(l.document_id));
  for (const l of snap.links) {
    if ((l.entity_type === 'commitment' && cids.has(l.entity_id)) ||
        (l.entity_type === 'payment' && payments.some((p) => p.id === l.entity_id))) docIds.add(l.document_id);
  }
  const docs = [...docIds].map((d) => store.get('documents', d)).filter((d) => d && !d.deleted_at);

  const del = async () => {
    const ok = await confirmDialog({
      title: `حذف ${v.name}؟`,
      body: commitments.length ? `سيتم نقل الجهة و${commitments.length} التزام مع دفعاتها إلى سلة المحذوفات لمدة 30 يوماً.` : 'ستنتقل الجهة إلى سلة المحذوفات لمدة 30 يوماً.',
      ok: 'حذف', danger: true,
    });
    if (!ok) return;
    store.softDelete('vendors', id);
    go('/vendors');
    toast('تم الحذف', { label: 'تراجع', run: () => store.restore('vendors', id) });
  };

  return {
    top: topbar(v.name, {
      back: '/vendors', sub: CATEGORY[v.category],
      actions: [iconButton('edit', 'تعديل', () => go(`/edit/vendor/${id}`))],
    }),
    body: [
      h('dl', { class: 'figures', style: 'margin-top:8px' },
        h('div', null, h('dt', null, 'المدفوع'), h('dd', null, money(formatBD(f.paid)))),
        h('div', null, h('dt', null, 'المتبقي'), h('dd', null, money(formatBD(f.remaining)))),
        h('div', { class: 'wide' }, h('dt', null, 'إجمالي الالتزامات'), h('dd', null, money(formatBD(f.adjusted)))),
      ),
      (v.contact_name || v.phone || v.cr_no || v.notes) ? h('div', { class: 'panel pad', style: 'margin-top:12px' }, kv([
        ['المسؤول', v.contact_name],
        ['الهاتف', v.phone ? h('a', { href: `tel:${v.phone}`, class: 'num' }, v.phone) : null],
        ['السجل التجاري', v.cr_no ? h('span', { class: 'num' }, v.cr_no) : null],
        ['ملاحظات', v.notes],
      ])) : null,
      h('div', { class: 'actions-row' },
        h('a', { class: 'btn primary sm', href: `#/add/payment?vendor=${id}` }, icon('pay'), 'دفعة'),
        h('a', { class: 'btn sm', href: `#/add/purchase?vendor=${id}` }, 'شراء مباشر'),
        h('a', { class: 'btn sm', href: `#/add/contract?vendor=${id}` }, 'عقد'),
        h('a', { class: 'btn sm', href: `#/statement/${id}` }, icon('print'), 'كشف حساب'),
      ),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, 'الالتزامات')),
        commitments.length
          ? h('ul', { class: 'list panel' }, ...commitments.map((c) => commitmentRow(c, { showVendor: false })))
          : h('div', { class: 'panel' }, empty('لا توجد التزامات لهذه الجهة.')),
      ),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, `الدفعات (${payments.length})`)),
        payments.length
          ? h('ul', { class: 'list panel' }, ...payments.map((p) => paymentRow(p)))
          : h('div', { class: 'panel' }, empty('لا توجد دفعات.')),
      ),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, `المستندات (${docs.length})`), h('a', { href: `#/attach?entity=vendor&id=${id}` }, 'إرفاق')),
        docs.length ? h('ul', { class: 'list panel' }, ...docs.map((d) => docRow(d!))) : h('div', { class: 'panel' }, empty('لا توجد مستندات.')),
      ),
      h('div', { class: 'actions-row' },
        h('a', { class: 'btn sm', href: `#/history/vendors/${id}` }, icon('history'), 'السجل'),
        h('button', { class: 'btn sm danger', onclick: del }, icon('trash'), 'حذف الجهة'),
      ),
    ],
    tab: 'vendors',
    live: true,
  };
});

function vendorForm(id?: string): Screen {
  const v = id ? store.get('vendors', id) : undefined;
  const name = textField('اسم الجهة', v?.name ?? '', { required: true });
  const cat = categoryField(v?.category ?? 'other');
  const contact = textField('اسم المسؤول', v?.contact_name ?? '');
  const phone = textField('الهاتف', v?.phone ?? '', { type: 'tel', ltr: true });
  const cr = textField('السجل التجاري', v?.cr_no ?? '', { ltr: true });
  const notes = textArea('ملاحظات', v?.notes ?? '');

  const save = () => {
    if (!name.get()) { name.setError('اكتب اسم الجهة'); name.input.focus(); return; }
    const dup = store.all('vendors').find((x) => x.name.trim() === name.get() && x.id !== id);
    if (dup) { name.setError('هذه الجهة مسجلة مسبقاً'); return; }
    const row = store.save('vendors', {
      id, name: name.get(), category: cat.get(), contact_name: contact.get() || null,
      phone: phone.get() || null, cr_no: cr.get() || null, notes: notes.get() || null,
    });
    toast(id ? 'تم حفظ التعديلات' : 'تمت إضافة الجهة');
    const back = new URLSearchParams(location.hash.split('?')[1] ?? '').get('return');
    if (back) go(back); else if (id) history.back(); else go(`/vendor/${row.id}`);
  };

  return {
    top: topbar(id ? 'تعديل الجهة' : 'جهة جديدة', { back: true }),
    body: h('form', { class: 'stack', onsubmit: (e: Event) => { e.preventDefault(); save(); } },
      name.el, cat.el, h('div', { class: 'grid2' }, contact.el, phone.el), cr.el, notes.el),
    footer: formFooter(id ? 'حفظ التعديلات' : 'إضافة الجهة', save),
    form: true,
  };
}
route('/add/vendor', () => vendorForm());
route('/edit/vendor/:id', ({ id }) => vendorForm(id));

route('/statement/:id', ({ id }): Screen => {
  const v = store.get('vendors', id);
  if (!v) return notFound('الجهة غير موجودة');
  const snap = store.snapshot();
  const project = store.project();
  const commitments = snap.commitments.filter((c) => c.vendor_id === id && c.status !== 'estimated');
  const f = vendorFigures(id, snap);

  const sections = commitments.map((c) => {
    const cf = commitmentFigures(c, snap);
    const vars = snap.variations.filter((x) => x.commitment_id === c.id && x.status === 'approved');
    const pays = snap.payments.filter((p) => p.commitment_id === c.id).sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    return h('section', { style: 'margin-top:24px' },
      h('h2', { style: 'font-size:17px;margin:0 0 4px' }, c.title),
      h('p', { class: 'small muted', style: 'margin:0 0 8px' }, [COMMITMENT_TYPE[c.type], c.ref_no ? `مرجع ${c.ref_no}` : null, c.signed_date ? fmtDate(c.signed_date) : null].filter(Boolean).join(' · ')),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'التاريخ'), h('th', null, 'البيان'), h('th', null, 'المرجع'), h('th', { class: 'money' }, 'مدين'), h('th', { class: 'money' }, 'دائن'), h('th', { class: 'money' }, 'الرصيد'))),
        h('tbody', null,
          (() => { running += c.original_amount; return h('tr', null, h('td', null, fmtDate(c.signed_date)), h('td', null, 'قيمة العقد'), h('td', null, c.ref_no ?? ''), h('td', { class: 'money' }, formatBD(c.original_amount, false)), h('td', null, ''), h('td', { class: 'money' }, formatBD(running, false))); })(),
          ...vars.map((x) => { running += x.amount; return h('tr', null, h('td', null, fmtDate(x.date)), h('td', null, `أمر تغيير: ${x.title}`), h('td', null, ''), h('td', { class: 'money' }, formatBD(x.amount, false)), h('td', null, ''), h('td', { class: 'money' }, formatBD(running, false))); }),
          ...pays.map((p) => { running -= p.amount; return h('tr', null, h('td', null, fmtDate(p.date)), h('td', null, `دفعة ${PAYMENT_METHOD[p.method]}${p.notes ? ` · ${p.notes}` : ''}`), h('td', null, p.ref_no ?? ''), h('td', null, ''), h('td', { class: 'money' }, formatBD(p.amount, false)), h('td', { class: 'money' }, formatBD(running, false))); }),
          h('tr', { class: 'totals' }, h('td', { colspan: '3' }, 'المتبقي'), h('td', { class: 'money' }, formatBD(cf.adjusted, false)), h('td', { class: 'money' }, formatBD(cf.paid, false)), h('td', { class: 'money' }, formatBD(cf.remaining, false))),
        ),
      )),
    );
  });

  return {
    top: topbar('كشف حساب', { back: true, actions: [iconButton('print', 'طباعة أو حفظ PDF', () => window.print())] }),
    body: h('div', { class: 'statement panel pad', style: 'margin-top:8px' },
      h('h1', { style: 'font-size:22px;margin:0' }, `كشف حساب: ${v.name}`),
      h('p', { class: 'small', style: 'margin:4px 0 0' }, [project?.name, project?.plot_no ? `قطعة ${project.plot_no}` : null, `بتاريخ ${fmtDate(today())}`].filter(Boolean).join(' · ')),
      kv([['إجمالي الالتزامات', formatBD(f.adjusted)], ['المدفوع', formatBD(f.paid)], ['المتبقي', formatBD(f.remaining)]]),
      ...sections,
      h('p', { class: 'no-print small muted', style: 'margin-top:20px' }, 'للحفظ كملف PDF: اضغط زر الطباعة ثم اختر "حفظ كـ PDF".'),
    ),
    form: true,
    live: false,
  };
});

export function notFound(what: string): Screen {
  return {
    top: topbar(what, { back: '/' }),
    body: empty('ربما حُذفت. تحقق من سلة المحذوفات في الإعدادات.', h('a', { class: 'btn', href: '#/trash' }, 'سلة المحذوفات')),
  };
}
