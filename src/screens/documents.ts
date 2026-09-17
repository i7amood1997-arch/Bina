import { go, route, type Screen } from '../app';
import { DEMO } from '../config';
import { store } from '../db/store';
import { localBlob, unlinkDocument } from '../documents';
import { drivePreviewUrl, driveViewUrl } from '../drive';
import { paymentsWithoutProof } from '../engine';
import { fmtDate } from '../dates';
import { fmtSize, isImage, isPdf } from '../files';
import { formatBD } from '../money';
import { DOC_TYPE, ENTITY, options } from '../strings';
import type { DocType, EntityType } from '../types';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import {
  amountField, confirmDialog, dateField, empty, formFooter, iconButton, segmented, selectField, textField, toast, topbar,
} from '../ui/components';
import { docRow, kv, paymentRow, vendorName } from './common';
import { notFound } from './vendors';

let filterType: DocType | '' = '';
let filterVendor = '';

function docVendorIds(docId: string): Set<string> {
  const out = new Set<string>();
  for (const l of store.all('document_links').filter((x) => x.document_id === docId)) {
    if (l.entity_type === 'vendor') out.add(l.entity_id);
    if (l.entity_type === 'commitment') { const c = store.get('commitments', l.entity_id); if (c?.vendor_id) out.add(c.vendor_id); }
    if (l.entity_type === 'payment') {
      const p = store.get('payments', l.entity_id);
      const c = store.get('commitments', p?.commitment_id);
      if (c?.vendor_id) out.add(c.vendor_id);
    }
    if (l.entity_type === 'variation' || l.entity_type === 'milestone') {
      const row = l.entity_type === 'variation' ? store.get('variations', l.entity_id) : store.get('milestones', l.entity_id);
      const c = store.get('commitments', row?.commitment_id);
      if (c?.vendor_id) out.add(c.vendor_id);
    }
  }
  return out;
}

route('/documents', (_, q): Screen => {
  const view = q.get('view') === 'missing' ? 'missing' : 'all';
  const snap = store.snapshot();
  const missing = paymentsWithoutProof(snap.payments, snap.links).sort((a, b) => b.date.localeCompare(a.date));
  const switcher = segmented('العرض', [['all', 'كل المستندات'], ['missing', `بدون سند (${missing.length})`]], view, (v) => go(v === 'missing' ? '/documents?view=missing' : '/documents'));
  switcher.el.querySelector('.label')!.classList.add('sr-only');

  if (view === 'missing') {
    return {
      top: topbar('المستندات'),
      body: [
        switcher.el,
        h('p', { class: 'small muted', style: 'margin:12px 2px 8px' }, 'دفعات تحتاج صورة سند أو إيصال تحويل. افتح الدفعة ثم اضغط إرفاق.'),
        missing.length ? h('ul', { class: 'list panel' }, ...missing.map((p) => paymentRow(p))) : h('div', { class: 'panel' }, empty('كل الدفعات موثقة.')),
      ],
      tab: 'docs',
      live: true,
    };
  }

  const list = h('ul', { class: 'list panel' });
  const typeSel = selectField<DocType>('النوع', options(DOC_TYPE), filterType, { placeholder: 'كل الأنواع' });
  const vendors = store.all('vendors').sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const vendorSel = selectField<string>('الجهة', vendors.map((v) => [v.id, v.name]), filterVendor, { placeholder: 'كل الجهات' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'ابحث بالعنوان', 'aria-label': 'بحث' });

  const draw = () => {
    filterType = typeSel.get();
    filterVendor = vendorSel.get();
    const text = search.value.trim();
    list.innerHTML = '';
    const docs = store.all('documents')
      .filter((d) => !filterType || d.type === filterType)
      .filter((d) => !text || d.title.includes(text) || (d.file_name ?? '').includes(text))
      .filter((d) => !filterVendor || docVendorIds(d.id).has(filterVendor))
      .sort((a, b) => String(b.date ?? b.created_at).localeCompare(String(a.date ?? a.created_at)));
    if (!docs.length) {
      list.append(h('li', null, empty(store.all('documents').length ? 'لا توجد نتائج.' : 'لا توجد مستندات بعد. صوّر أول سند أو عقد.',
        h('a', { class: 'btn primary', href: '#/capture' }, icon('camera'), 'صوّر مستند'))));
      return;
    }
    docs.forEach((d) => list.append(docRow(d)));
  };
  [typeSel.input, vendorSel.input].forEach((i) => i.addEventListener('change', draw));
  search.addEventListener('input', draw);
  draw();

  return {
    top: topbar('المستندات'),
    body: [
      switcher.el,
      h('div', { class: 'stack', style: 'margin:12px 0' }, search, h('div', { class: 'grid2' }, typeSel.el, vendorSel.el)),
      list,
    ],
    tab: 'docs',
    live: true,
  };
});

function entityLabel(type: EntityType, id: string): { text: string; href: string } | null {
  if (type === 'vendor') { const v = store.get('vendors', id); return v && !v.deleted_at ? { text: v.name, href: `#/vendor/${id}` } : null; }
  if (type === 'commitment') { const c = store.get('commitments', id); return c && !c.deleted_at ? { text: `${vendorName(c.vendor_id)} · ${c.title}`, href: `#/commitment/${id}` } : null; }
  if (type === 'payment') {
    const p = store.get('payments', id);
    if (!p || p.deleted_at) return null;
    const c = store.get('commitments', p.commitment_id);
    return { text: `${formatBD(p.amount)} · ${vendorName(c?.vendor_id)} · ${fmtDate(p.date)}`, href: `#/payment/${id}` };
  }
  if (type === 'variation') { const v = store.get('variations', id); return v && !v.deleted_at ? { text: v.title, href: `#/commitment/${v.commitment_id}` } : null; }
  const m = store.get('milestones', id);
  return m && !m.deleted_at ? { text: m.title, href: `#/commitment/${m.commitment_id}` } : null;
}

route('/document/:id', async ({ id }): Promise<Screen> => {
  const d = store.get('documents', id);
  if (!d || d.deleted_at) return notFound('المستند غير موجود');
  const links = store.all('document_links').filter((l) => l.document_id === id);

  let preview: HTMLElement;
  const blob = await localBlob(id);
  if (blob) {
    const url = URL.createObjectURL(blob);
    preview = isImage(d.mime) ? h('img', { class: 'preview-img', src: url, alt: d.title })
      : isPdf(d.mime) ? h('iframe', { class: 'preview', src: url, title: d.title })
      : h('a', { class: 'btn', href: url, download: d.file_name ?? 'file' }, icon('download'), 'تنزيل الملف');
  } else if (d.drive_file_id && !d.drive_file_id.startsWith('local:')) {
    preview = h('iframe', { class: 'preview', src: drivePreviewUrl(d.drive_file_id), title: d.title, allow: 'autoplay' });
  } else {
    preview = h('div', { class: 'panel' }, empty('الملف غير متاح على هذا الجهاز بعد.'));
  }

  const del = async () => {
    const ok = await confirmDialog({
      title: 'حذف المستند؟',
      body: 'يُحذف من التطبيق ويُزال ربطه، ويبقى في سلة المحذوفات 30 يوماً. الملف نفسه يبقى في Google Drive.',
      ok: 'حذف', danger: true,
    });
    if (!ok) return;
    store.softDelete('documents', id);
    history.back();
    toast('تم حذف المستند', { label: 'تراجع', run: () => store.restore('documents', id) });
  };

  return {
    top: topbar(d.title, {
      back: true, sub: DOC_TYPE[d.type],
      actions: [iconButton('edit', 'تعديل', () => go(`/edit/document/${id}`))],
    }),
    body: [
      h('div', { style: 'margin-top:8px' }, preview),
      d.drive_file_id && !d.drive_file_id.startsWith('local:')
        ? h('div', { class: 'actions-row' }, h('a', { class: 'btn sm', href: d.drive_url ?? driveViewUrl(d.drive_file_id), target: '_blank', rel: 'noopener' }, icon('external'), 'فتح في Google Drive'))
        : (!DEMO ? h('p', { class: 'small muted' }, 'بانتظار الرفع إلى Google Drive.') : null),
      h('div', { class: 'panel pad', style: 'margin-top:12px' }, kv([
        ['التاريخ', fmtDate(d.date)],
        ['المبلغ', d.amount ? formatBD(d.amount) : null],
        ['اسم الملف', d.file_name ? h('span', { class: 'num' }, d.file_name) : null],
        ['الحجم', fmtSize(d.size)],
        ['أضافه', store.memberName(d.created_by)],
      ])),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, 'مرتبط بـ')),
        links.length ? h('ul', { class: 'list panel' }, ...links.map((l) => {
          const lab = entityLabel(l.entity_type, l.entity_id);
          if (!lab) return null;
          return h('li', null, h('div', { class: 'row' },
            h('a', { class: 'main', href: lab.href, style: 'text-decoration:none;color:inherit' },
              h('span', { class: 'meta' }, ENTITY[l.entity_type]), h('span', { class: 'title' }, lab.text)),
            h('button', { class: 'btn sm', onclick: () => { unlinkDocument(l.id); toast('أُزيل الربط', { label: 'تراجع', run: () => store.restore('document_links', l.id) }); } }, 'إزالة'),
          ));
        })) : h('div', { class: 'panel' }, empty('غير مرتبط بأي جهة أو دفعة.')),
      ),
      h('div', { class: 'actions-row', style: 'margin-top:24px' },
        h('a', { class: 'btn sm', href: `#/history/documents/${id}` }, icon('history'), 'السجل'),
        h('button', { class: 'btn sm danger', onclick: del }, icon('trash'), 'حذف المستند'),
      ),
    ],
    tab: 'docs',
    live: true,
  };
});

route('/edit/document/:id', ({ id }): Screen => {
  const d = store.get('documents', id);
  if (!d) return notFound('المستند غير موجود');
  const title = textField('العنوان', d.title);
  const type = selectField<DocType>('النوع', options(DOC_TYPE), d.type);
  const date = dateField('التاريخ', d.date);
  const amount = amountField('المبلغ (اختياري)', d.amount);
  const save = () => {
    if (!title.get()) { title.setError('اكتب العنوان'); return; }
    store.save('documents', { id, title: title.get(), type: (type.get() || 'other') as DocType, date: date.get(), amount: amount.get() });
    toast('تم الحفظ');
    history.back();
  };
  return {
    top: topbar('تعديل المستند', { back: true }),
    body: h('div', { class: 'stack' }, title.el, type.el, date.el, amount.el,
      h('p', { class: 'small muted' }, 'تغيير العنوان هنا لا يغيّر اسم الملف في Google Drive.')),
    footer: formFooter('حفظ', save),
    form: true,
  };
});
