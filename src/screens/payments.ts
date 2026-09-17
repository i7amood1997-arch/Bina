import { go, route, type Screen } from '../app';
import { store } from '../db/store';
import { linkDocument, prepareFile, saveDocument, unlinkDocument } from '../documents';
import { commitmentFigures, findDuplicatePayments, milestoneStatus, overpayment, paymentHasProof } from '../engine';
import { fmtDate, today } from '../dates';
import { formatBD } from '../money';
import { COMMITMENT_TYPE, DOC_TYPE, options, PAYMENT_METHOD } from '../strings';
import type { Commitment, Payment, PaymentMethod } from '../types';
import { h, money } from '../ui/dom';
import { icon } from '../ui/icons';
import {
  alertBox, amountField, chooseDialog, confirmDialog, dateField, empty, filePicker, formFooter, iconButton,
  payerField, selectField, textArea, textField, toast, topbar,
} from '../ui/components';
import { kv, vendorName } from './common';
import { notFound } from './vendors';

export interface PaymentDraft {
  amount: number; date: string; method: PaymentMethod; payer_id: string;
  ref_no: string | null; milestone_id: string | null; notes: string | null;
}

/**
 * Runs duplicate + overpayment checks, then saves (commitment if new) + payment + files.
 * Returns the saved payment, or null if the user backed out.
 */
export async function checkAndSavePayment(o: {
  commitment: Commitment; isNewCommitment?: boolean; payment: PaymentDraft; paymentId?: string;
  files?: File[]; existingDocIds?: string[];
}): Promise<Payment | null> {
  const { commitment: c, payment: p } = o;
  const snap = store.snapshot();

  // 1. duplicate
  const dups = findDuplicatePayments(
    { id: o.paymentId, amount: p.amount, date: p.date, ref_no: p.ref_no, vendor_id: c.vendor_id },
    snap.payments, snap.commitments,
  );
  if (dups.length) {
    const d = dups[0];
    const ok = await confirmDialog({
      title: 'يبدو أن هذه الدفعة مسجلة',
      body: h('div', null,
        h('p', null, `${store.memberName(d.created_by)} سجّل دفعة مشابهة:`),
        h('div', { class: 'panel pad' }, kv([
          ['الجهة', vendorName(store.get('commitments', d.commitment_id)?.vendor_id)],
          ['المبلغ', formatBD(d.amount)], ['التاريخ', fmtDate(d.date)], ['المرجع', d.ref_no],
        ])),
      ),
      ok: 'حفظ رغم ذلك', cancel: 'رجوع',
    });
    if (!ok) return null;
  }

  // 2. overpayment
  const over = o.isNewCommitment ? Math.max(0, p.amount - c.original_amount) : overpayment(c, snap, p.amount, o.paymentId);
  if (over > 0) {
    const choice = await chooseDialog<'variation' | 'save'>({
      title: 'الدفعة أكبر من المتبقي',
      body: `ستتجاوز قيمة "${c.title}" بمبلغ ${formatBD(over)}. إن كان هناك عمل إضافي متفق عليه، سجّل أمر تغيير بالفرق.`,
      choices: [
        { value: 'variation', label: `أمر تغيير بـ ${formatBD(over)} ثم حفظ`, primary: true },
        { value: 'save', label: 'حفظ بدون أمر تغيير' },
      ],
    });
    if (!choice) return null;
    if (choice === 'variation') {
      if (o.isNewCommitment) { store.save('commitments', { ...c }); o.isNewCommitment = false; }
      store.save('variations', { commitment_id: c.id, title: 'فرق دفعة', amount: over, reason: 'دفعة تجاوزت القيمة', date: p.date, status: 'approved' });
    }
  }

  if (o.isNewCommitment) store.save('commitments', { ...c });
  const saved = store.save('payments', {
    id: o.paymentId, commitment_id: c.id, milestone_id: p.milestone_id, kind: 'normal',
    amount: p.amount, date: p.date, method: p.method, payer_id: p.payer_id,
    ref_no: p.ref_no, retention_held: 0, notes: p.notes,
  });
  store.rememberPayer(p.payer_id);

  for (const docId of o.existingDocIds ?? []) linkDocument(docId, { entity_type: 'payment', entity_id: saved.id });
  for (const file of o.files ?? []) {
    const prepared = await prepareFile(file);
    if (prepared.duplicate) {
      const link = await confirmDialog({
        title: 'هذا الملف مرفوع مسبقاً',
        body: `المستند "${prepared.duplicate.title}" له نفس المحتوى. اربطه بهذه الدفعة بدل رفعه مرة ثانية؟`,
        ok: 'ربط الموجود', cancel: 'رفع نسخة جديدة',
      });
      if (link) { linkDocument(prepared.duplicate.id, { entity_type: 'payment', entity_id: saved.id }); continue; }
    }
    await saveDocument({
      prepared, type: 'receipt', title: `سند دفعة ${vendorName(c.vendor_id)}`, date: p.date, amount: p.amount,
      vendorName: vendorName(c.vendor_id),
      links: [{ entity_type: 'payment', entity_id: saved.id }],
    });
  }
  return saved;
}

function paymentForm(id: string | undefined, q: URLSearchParams): Screen {
  const existing = id ? store.get('payments', id) : undefined;
  if (id && !existing) return notFound('الدفعة غير موجودة');
  const vendorFilter = q.get('vendor');
  const commitments = store.all('commitments')
    .filter((c) => c.status !== 'cancelled' || c.id === existing?.commitment_id)
    .filter((c) => !vendorFilter || c.vendor_id === vendorFilter)
    .sort((a, b) => vendorName(a.vendor_id).localeCompare(vendorName(b.vendor_id), 'ar'));
  const snap = store.snapshot();
  const presetC = existing?.commitment_id ?? q.get('commitment') ?? (commitments.length === 1 ? commitments[0].id : '');

  const cSel = selectField<string>('الدفعة لـ', commitments.map((c) => {
    const f = commitmentFigures(c, snap);
    return [c.id, `${vendorName(c.vendor_id)} · ${c.title} (متبقي ${formatBD(f.remaining)})`];
  }), presetC, { placeholder: 'اختر العقد أو الشراء' });
  const msSel = selectField<string>('المرحلة', [], '', { placeholder: 'بدون مرحلة', hint: 'اختياري. يحدّث حالة المرحلة تلقائياً' });
  const info = h('div');
  const amount = amountField('المبلغ', existing?.amount ?? null);
  const date = dateField('التاريخ', existing?.date ?? today());
  const payer = payerField(existing?.payer_id);
  const method = selectField<PaymentMethod>('طريقة الدفع', options(PAYMENT_METHOD), existing?.method ?? 'bank_transfer');
  const ref = textField('رقم الإيصال أو التحويل', existing?.ref_no ?? '', { ltr: true });
  const notes = textArea('ملاحظات', existing?.notes ?? '');
  const files = filePicker();

  const refreshMilestones = (preset?: string) => {
    const cid = cSel.get();
    const ms = store.all('milestones').filter((m) => m.commitment_id === cid).sort((a, b) => a.sort_order - b.sort_order);
    msSel.setOptions(ms.map((m) => {
      const st = milestoneStatus(m, snap.payments.filter((p) => p.id !== id), today());
      return [m.id, `${m.title} · ${formatBD(m.amount)}${st === 'paid' ? ' (مدفوعة)' : ''}`];
    }), preset ?? '');
    msSel.el.hidden = ms.length === 0;
    const c = store.get('commitments', cid);
    info.innerHTML = '';
    if (c) {
      const f = commitmentFigures(c, { variations: snap.variations, payments: snap.payments.filter((p) => p.id !== id) });
      info.append(h('div', { class: 'panel pad small' }, kv([
        ['النوع', COMMITMENT_TYPE[c.type]], ['القيمة', formatBD(f.adjusted)], ['المدفوع', formatBD(f.paid)], ['المتبقي', formatBD(f.remaining)],
      ])));
    }
  };
  cSel.input.addEventListener('change', () => refreshMilestones());
  msSel.input.addEventListener('change', () => {
    const m = store.get('milestones', msSel.get());
    if (m && !amount.get()) amount.set(Math.max(0, m.amount - snap.payments.filter((p) => p.milestone_id === m.id && p.id !== id).reduce((a, p) => a + p.amount, 0)));
  });
  refreshMilestones(existing?.milestone_id ?? q.get('milestone') ?? '');
  if (!existing && q.get('milestone')) msSel.input.dispatchEvent(new Event('change'));

  const save = async () => {
    let ok = true;
    const c = store.get('commitments', cSel.get());
    if (!c) { cSel.setError('اختر العقد أو الشراء'); ok = false; } else cSel.setError(null);
    const a = amount.get();
    if (!a || a <= 0) { amount.setError('اكتب المبلغ'); ok = false; } else amount.setError(null);
    if (!payer.get()) { payer.setError('اختر من دفع'); ok = false; }
    if (!date.get()) { date.setError('اختر التاريخ'); ok = false; }
    if (!ok) return;
    const saved = await checkAndSavePayment({
      commitment: c!, paymentId: id,
      payment: { amount: a!, date: date.get()!, method: method.get() as PaymentMethod, payer_id: payer.get(), ref_no: ref.get() || null, milestone_id: msSel.get() || null, notes: notes.get() || null },
      files: files.files(),
    });
    if (!saved) return;
    toast(id ? 'تم حفظ التعديلات' : 'تم تسجيل الدفعة');
    if (id) history.back(); else go(`/payment/${saved.id}`);
  };

  return {
    top: topbar(id ? 'تعديل الدفعة' : 'دفعة جديدة', { back: true }),
    body: h('form', { class: 'stack', onsubmit: (e: Event) => { e.preventDefault(); void save(); } },
      commitments.length ? null : alertBox('info', ['سجّل عقداً أو شراءً أولاً، ثم أضف دفعاته.'], [
        h('a', { class: 'btn sm', href: '#/add/contract' }, 'عقد جديد'),
        h('a', { class: 'btn sm', href: '#/add/purchase' }, 'شراء مباشر'),
      ]),
      cSel.el, info, msSel.el, amount.el,
      h('div', { class: 'grid2' }, date.el, payer.el),
      id ? null : files.el,
      h('details', { class: 'more', open: !!(existing?.ref_no || existing?.notes) }, h('summary', null, 'تفاصيل إضافية'),
        h('div', { class: 'stack' }, method.el, ref.el, notes.el)),
    ),
    footer: formFooter(id ? 'حفظ التعديلات' : 'حفظ الدفعة', save),
    form: true,
  };
}

route('/add/payment', (_, q) => paymentForm(undefined, q));
route('/edit/payment/:id', ({ id }, q) => paymentForm(id, q));

route('/payment/:id', ({ id }): Screen => {
  const p = store.get('payments', id);
  if (!p || p.deleted_at) return notFound('الدفعة غير موجودة');
  const c = store.get('commitments', p.commitment_id);
  const m = store.get('milestones', p.milestone_id);
  const links = store.linksTo('payment', id);
  const proof = paymentHasProof(p, store.all('document_links'));

  const del = async () => {
    if (!(await confirmDialog({ title: 'حذف الدفعة؟', body: `${formatBD(p.amount)} بتاريخ ${fmtDate(p.date)}. تبقى في سلة المحذوفات 30 يوماً.`, ok: 'حذف', danger: true }))) return;
    store.softDelete('payments', id);
    history.back();
    toast('تم حذف الدفعة', { label: 'تراجع', run: () => store.restore('payments', id) });
  };

  return {
    top: topbar('دفعة', {
      back: true, sub: c ? `${vendorName(c.vendor_id)} · ${c.title}` : undefined,
      actions: [iconButton('edit', 'تعديل', () => go(`/edit/payment/${id}`))],
    }),
    body: [
      h('div', { class: 'hero' },
        h('p', { class: 'label' }, fmtDate(p.date)),
        h('p', { class: 'big', style: 'margin-bottom:6px' }, money(formatBD(p.amount, false)), h('span', { class: 'unit' }, 'BD')),
        h('span', { class: `chip ${proof ? 'paid' : 'warn'}` }, proof ? 'موثقة بسند' : 'بدون سند'),
      ),
      h('div', { class: 'panel pad', style: 'margin-top:12px' }, kv([
        ['من دفع', store.get('payers', p.payer_id)?.name ?? ''],
        ['طريقة الدفع', PAYMENT_METHOD[p.method]],
        ['المرجع', p.ref_no ? h('span', { class: 'num' }, p.ref_no) : null],
        ['الالتزام', c ? h('a', { href: `#/commitment/${c.id}` }, c.title) : null],
        ['المرحلة', m?.title],
        ['ملاحظات', p.notes],
        ['سجّلها', `${store.memberName(p.created_by)}`],
      ])),
      proof ? null : alertBox('warn', [h('strong', null, 'أرفق الإثبات'), h('div', { class: 'small' }, 'صورة السند أو إيصال التحويل أو الشيك.')], [
        h('a', { class: 'btn sm primary', href: `#/attach?entity=payment&id=${id}` }, icon('camera'), 'إرفاق'),
      ]),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, 'المستندات'), h('a', { href: `#/attach?entity=payment&id=${id}` }, 'إرفاق')),
        links.length ? h('ul', { class: 'list panel' }, ...links.map((l) => {
          const d = store.get('documents', l.document_id);
          if (!d || d.deleted_at) return null;
          return h('li', null, h('div', { class: 'row' },
            h('a', { class: 'main', href: `#/document/${d.id}`, style: 'text-decoration:none;color:inherit' },
              h('span', { class: 'title' }, d.title), h('span', { class: 'meta' }, `${DOC_TYPE[d.type]} · ${fmtDate(d.date)}`)),
            h('button', { class: 'btn sm', onclick: () => { unlinkDocument(l.id); toast('أُزيل الربط', { label: 'تراجع', run: () => store.restore('document_links', l.id) }); } }, 'إزالة الربط'),
          ));
        })) : h('div', { class: 'panel' }, empty('لا يوجد مستند مرفق.')),
      ),
      h('div', { class: 'actions-row', style: 'margin-top:24px' },
        h('a', { class: 'btn sm', href: `#/history/payments/${id}` }, icon('history'), 'السجل'),
        h('button', { class: 'btn sm danger', onclick: del }, icon('trash'), 'حذف الدفعة'),
      ),
    ],
    live: true,
  };
});
