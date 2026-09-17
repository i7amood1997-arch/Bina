import { go, route, type Screen } from '../app';
import { store } from '../db/store';
import { linkDocument, prepareFile, saveDocument } from '../documents';
import { commitmentFigures, milestonePaid, milestoneStatus, scheduleGap } from '../engine';
import { fmtDate, today } from '../dates';
import { formatBD, parseFils } from '../money';
import { CATEGORY, COMMITMENT_TYPE, DOC_TYPE, options, VARIATION_STATUS } from '../strings';
import type { Category, Commitment, DocType, Milestone } from '../types';
import { h, money } from '../ui/dom';
import { icon } from '../ui/icons';
import {
  alertBox, amountField, categoryField, confirmDialog, dateField, empty, filePicker, formFooter, iconButton,
  openSheet, payerField, segmented, selectField, textArea, textField, toast, topbar, vendorField,
} from '../ui/components';
import { docRow, kv, milestoneChip, paymentRow, statusChip, vendorName } from './common';
import { notFound } from './vendors';
import { checkAndSavePayment } from './payments';
import { PAYMENT_METHOD } from '../strings';
import type { PaymentMethod } from '../types';

// ---------- detail ----------
route('/commitment/:id', ({ id }): Screen => {
  const c = store.get('commitments', id);
  if (!c || c.deleted_at) return notFound('الالتزام غير موجود');
  const snap = store.snapshot();
  const f = commitmentFigures(c, snap);
  const milestones = snap.milestones.filter((m) => m.commitment_id === id).sort((a, b) => a.sort_order - b.sort_order);
  const variations = store.all('variations').filter((v) => v.commitment_id === id).sort((a, b) => b.date.localeCompare(a.date));
  const payments = snap.payments.filter((p) => p.commitment_id === id).sort((a, b) => b.date.localeCompare(a.date));
  const docs = store.docsFor('commitment', id);
  const gap = scheduleGap(c, snap);

  const setStatus = async (status: 'approved' | 'cancelled' | 'estimated') => {
    if (status === 'cancelled') {
      const ok = await confirmDialog({
        title: 'إلغاء هذا الالتزام؟',
        body: f.paid ? `يبقى المدفوع (${formatBD(f.paid)}) محسوباً في المصروف، ويُستبعد المتبقي من التكلفة المتوقعة.` : 'يُستبعد من التكلفة المتوقعة.',
        ok: 'إلغاء الالتزام', danger: true, cancel: 'رجوع',
      });
      if (!ok) return;
    }
    store.save('commitments', { id, status });
    toast(status === 'approved' ? 'تم الاعتماد' : status === 'cancelled' ? 'تم الإلغاء' : 'تم التحديث');
  };

  const del = async () => {
    const ok = await confirmDialog({
      title: 'حذف الالتزام؟',
      body: `سينتقل مع ${payments.length} دفعة و${milestones.length} مرحلة إلى سلة المحذوفات لمدة 30 يوماً.`,
      ok: 'حذف', danger: true,
    });
    if (!ok) return;
    store.softDelete('commitments', id);
    history.back();
    toast('تم الحذف', { label: 'تراجع', run: () => store.restore('commitments', id) });
  };

  const markDue = (m: Milestone) => {
    store.save('milestones', { id: m.id, marked_due: !m.marked_due });
    toast(m.marked_due ? 'أُلغي الاستحقاق' : 'صارت المرحلة مستحقة');
  };

  const milestoneList = milestones.length
    ? h('ul', { class: 'list panel' }, ...milestones.map((m) => {
        const st = milestoneStatus(m, snap.payments, today());
        const paid = milestonePaid(m, snap.payments);
        return h('li', null, h('div', { class: 'ms-item' },
          h('div', { class: 'line' }, h('span', { class: 'title' }, m.title), money(formatBD(m.amount))),
          [m.due_trigger, m.due_date ? `تستحق ${fmtDate(m.due_date)}` : null, paid && st !== 'paid' ? `مدفوع ${formatBD(paid)}` : null].some(Boolean)
            ? h('span', { class: 'meta small muted' }, [m.due_trigger, m.due_date ? `تستحق ${fmtDate(m.due_date)}` : null, paid && st !== 'paid' ? `مدفوع ${formatBD(paid)}` : null].filter(Boolean).join(' · '))
            : null,
          h('div', { class: 'acts' },
            milestoneChip(m),
            st === 'not_due' || (st === 'due' && m.marked_due) ? h('button', { class: 'btn sm', onclick: () => markDue(m) }, m.marked_due ? 'إلغاء الاستحقاق' : 'استحقت') : null,
            st !== 'paid' && c.status !== 'cancelled' ? h('a', { class: 'btn sm', href: `#/add/payment?commitment=${id}&milestone=${m.id}` }, 'دفع') : null,
          ),
        ));
      }))
    : null;

  return {
    top: topbar(c.title, {
      back: true,
      sub: `${vendorName(c.vendor_id)} · ${COMMITMENT_TYPE[c.type]}`,
      actions: [iconButton('edit', 'تعديل', () => go(`/edit/commitment/${id}`))],
    }),
    body: [
      h('div', { style: 'margin:4px 0 10px;display:flex;gap:6px;flex-wrap:wrap' }, statusChip(f.status), h('span', { class: 'chip' }, CATEGORY[c.category])),
      h('dl', { class: 'figures' },
        h('div', null, h('dt', null, 'المدفوع'), h('dd', null, money(formatBD(f.paid)))),
        h('div', null, h('dt', null, 'المتبقي'), h('dd', { class: f.remaining < 0 ? 'neg' : '' }, money(formatBD(f.remaining)))),
        h('div', null, h('dt', null, 'القيمة الأصلية'), h('dd', null, money(formatBD(f.original)))),
        h('div', null, h('dt', null, 'أوامر التغيير'), h('dd', null, money(formatBD(f.variationsTotal)))),
        h('div', { class: 'wide' }, h('dt', null, 'القيمة المعدّلة'), h('dd', null, money(formatBD(f.adjusted)))),
        f.retentionHeld ? h('div', { class: 'wide' }, h('dt', null, 'منها محتجز'), h('dd', null, money(formatBD(f.retentionHeld)))) : null,
      ),
      f.remaining < 0 ? alertBox('danger', [h('strong', null, 'المدفوع أكبر من القيمة'), h('div', { class: 'small' }, `بفارق ${formatBD(-f.remaining)}. سجّل أمر تغيير أو صحّح الدفعات.`)]) : null,
      gap !== 0 ? alertBox('warn', [h('strong', null, 'مجموع المراحل لا يساوي القيمة'), h('div', { class: 'small' }, `الفرق ${formatBD(gap)}. عدّل المراحل من زر التعديل.`)]) : null,
      h('div', { class: 'actions-row' },
        c.status === 'cancelled' ? null : h('a', { class: 'btn primary sm', href: `#/add/payment?commitment=${id}` }, icon('pay'), 'دفعة'),
        c.status === 'estimated' ? h('button', { class: 'btn sm', onclick: () => setStatus('approved') }, icon('check'), 'تم الاتفاق') : null,
        c.status !== 'estimated' && c.status !== 'cancelled' ? h('a', { class: 'btn sm', href: `#/add/variation?commitment=${id}` }, icon('change'), 'أمر تغيير') : null,
        h('a', { class: 'btn sm', href: `#/attach?entity=commitment&id=${id}` }, icon('link'), 'مستند'),
      ),
      (c.ref_no || c.signed_date || c.notes) ? h('div', { class: 'panel pad', style: 'margin-top:12px' }, kv([
        ['رقم المرجع', c.ref_no ? h('span', { class: 'num' }, c.ref_no) : null],
        ['تاريخ التوقيع', c.signed_date ? fmtDate(c.signed_date) : null],
        ['ملاحظات', c.notes],
      ])) : null,
      milestoneList ? h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, 'مراحل الدفع')), milestoneList) : null,
      variations.length ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, 'أوامر التغيير')),
        h('ul', { class: 'list panel' }, ...variations.map((v) => h('li', null, h('a', { class: 'row', href: `#/edit/variation/${v.id}` },
          h('div', { class: 'main' }, h('span', { class: 'title' }, v.title), h('span', { class: 'meta' }, `${fmtDate(v.date)} · ${v.reason}`),
            h('div', { style: 'margin-top:4px' }, h('span', { class: `chip ${v.status === 'approved' ? 'paid' : v.status === 'rejected' ? 'danger' : ''}` }, VARIATION_STATUS[v.status]))),
          h('div', { class: 'end' }, money(`${v.amount > 0 ? '+' : ''}${formatBD(v.amount)}`)),
          icon('chev', 'chev'),
        )))),
      ) : null,
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, `الدفعات (${payments.length})`)),
        payments.length ? h('ul', { class: 'list panel' }, ...payments.map((p) => paymentRow(p, { showCommitment: false }))) : h('div', { class: 'panel' }, empty('لم تُسجل دفعات بعد.')),
      ),
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, `المستندات (${docs.length})`), h('a', { href: `#/attach?entity=commitment&id=${id}` }, 'إرفاق')),
        docs.length ? h('ul', { class: 'list panel' }, ...docs.map((d) => docRow(d))) : h('div', { class: 'panel' }, empty('أرفق العقد أو عرض السعر هنا.')),
      ),
      h('div', { class: 'actions-row', style: 'margin-top:24px' },
        h('a', { class: 'btn sm', href: `#/history/commitments/${id}` }, icon('history'), 'السجل'),
        c.vendor_id ? h('a', { class: 'btn sm', href: `#/vendor/${c.vendor_id}` }, icon('building'), 'الجهة') : null,
        c.status !== 'cancelled' ? h('button', { class: 'btn sm danger', onclick: () => setStatus('cancelled') }, 'إلغاء الالتزام') : h('button', { class: 'btn sm', onclick: () => setStatus('approved') }, 'إعادة اعتماد'),
        h('button', { class: 'btn sm danger', onclick: del }, icon('trash'), 'حذف'),
      ),
    ],
    tab: 'vendors',
    live: true,
  };
});

// ---------- milestone editor (used by contract form) ----------
interface MsDraft { id?: string; title: string; amount: number | null; due_trigger: string; due_date: string | null; marked_due: boolean; }

function milestoneEditor(initial: MsDraft[], getTotal: () => number | null) {
  const rows: { draft: MsDraft; el: HTMLElement; title: HTMLInputElement; amount: HTMLInputElement; trigger: HTMLInputElement; date: HTMLInputElement }[] = [];
  const box = h('div', { class: 'stack' });
  const balance = h('div', { class: 'balance', 'aria-live': 'polite' });
  const listEl = h('div', { class: 'stack' });
  const removed: string[] = [];

  const read = (r: (typeof rows)[number]): MsDraft => ({
    id: r.draft.id,
    title: r.title.value.trim(),
    amount: amountOf(r.amount.value),
    due_trigger: r.trigger.value.trim(),
    due_date: r.date.value || null,
    marked_due: r.draft.marked_due,
  });

  const update = () => {
    const total = getTotal();
    const s = rows.reduce((a, r) => a + (read(r).amount ?? 0), 0);
    if (!rows.length) { balance.hidden = true; return; }
    balance.hidden = false;
    const diff = (total ?? 0) - s;
    balance.className = `balance ${diff === 0 ? '' : 'off'}`;
    balance.textContent = diff === 0
      ? `مجموع المراحل ${formatBD(s)} يساوي قيمة العقد`
      : `مجموع المراحل ${formatBD(s)} · ${diff > 0 ? 'ناقص' : 'زائد'} ${formatBD(Math.abs(diff))}`;
  };

  const add = (d: MsDraft) => {
    const title = h('input', { class: 'input', placeholder: 'مثال: بعد صب القواعد', value: d.title, 'aria-label': 'اسم المرحلة' });
    const amount = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'المبلغ', value: d.amount !== null ? String(d.amount / 1000) : '', 'aria-label': 'مبلغ المرحلة' });
    const trigger = h('input', { class: 'input', placeholder: 'شرط الاستحقاق (اختياري)', value: d.due_trigger, 'aria-label': 'شرط الاستحقاق' });
    const date = h('input', { class: 'input ltr', type: 'date', value: d.due_date ?? '', 'aria-label': 'تاريخ الاستحقاق (اختياري)' });
    const r = { draft: d, el: h('div'), title, amount, trigger, date };
    const rm = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'حذف المرحلة', onclick: () => {
      if (d.id) removed.push(d.id);
      rows.splice(rows.indexOf(r), 1); r.el.remove(); update();
    } }, icon('close'));
    r.el = h('div', { class: 'ms-row' }, title, amount, rm,
      h('div', { class: 'full grid2' }, trigger, date));
    amount.addEventListener('input', update);
    rows.push(r);
    listEl.append(r.el);
    update();
  };

  initial.forEach(add);
  box.append(
    h('div', { class: 'label', style: 'font-weight:600;font-size:15px' }, 'مراحل الدفع'),
    listEl,
    balance,
    h('button', { type: 'button', class: 'btn', onclick: () => { add({ title: '', amount: null, due_trigger: '', due_date: null, marked_due: false }); rows.at(-1)!.title.focus(); } }, icon('plus'), 'أضف مرحلة'),
  );
  update();
  return { el: box, update, values: () => rows.map(read), removed };
}

const amountOf = (s: string) => parseFils(s);

// ---------- contract / estimate / edit form ----------
function commitmentForm(kind: 'staged_contract' | 'estimate' | 'edit', id: string | undefined, q: URLSearchParams): Screen {
  const existing = id ? store.get('commitments', id) : undefined;
  if (id && !existing) return notFound('الالتزام غير موجود');
  const type = existing?.type ?? (kind === 'edit' ? 'staged_contract' : kind);
  const presetVendor = existing?.vendor_id ?? q.get('vendor');
  const vendorCat = presetVendor ? store.get('vendors', presetVendor)?.category : undefined;

  const vendor = vendorField(presetVendor, { optional: type === 'estimate', onchange: (vid) => {
    const vc = vid ? store.get('vendors', vid)?.category : undefined;
    if (vc && !existing) cat.set(vc);
  } });
  const title = textField(type === 'estimate' ? 'البند' : 'عنوان العقد', existing?.title ?? q.get('title') ?? '', {
    placeholder: type === 'estimate' ? 'مثال: الأدوات الصحية' : 'مثال: عقد الهيكل الأسود',
  });
  const cat = categoryField((existing?.category ?? (q.get('category') as Category | null) ?? vendorCat ?? 'other'));
  const amount = amountField(type === 'estimate' ? 'التكلفة التقديرية' : type === 'direct_purchase' ? 'المبلغ الإجمالي' : 'قيمة العقد', existing?.original_amount ?? null);
  const signed = dateField('تاريخ التوقيع', existing?.signed_date ?? (type === 'staged_contract' && !existing ? today() : null));
  const ref = textField('رقم العقد أو عرض السعر', existing?.ref_no ?? '', { ltr: true });
  const retention = textField('نسبة المحتجز %', existing?.retention_pct ? String(existing.retention_pct) : '', { ltr: true, hint: 'اتركها فارغة إن لم يكن في العقد محتجز' });
  const notes = textArea('ملاحظات', existing?.notes ?? '');
  const files = filePicker({ label: type === 'estimate' ? 'مرفق (عرض سعر مثلاً)' : 'نسخة العقد' });

  const existingMs = id ? store.all('milestones').filter((m) => m.commitment_id === id).sort((a, b) => a.sort_order - b.sort_order) : [];
  const ms = type === 'staged_contract'
    ? milestoneEditor(existingMs.map((m) => ({ id: m.id, title: m.title, amount: m.amount, due_trigger: m.due_trigger ?? '', due_date: m.due_date, marked_due: m.marked_due })), () => amount.get())
    : null;
  amount.input.addEventListener('input', () => ms?.update());

  const save = async () => {
    let ok = true;
    if (!title.get()) { title.setError('اكتب العنوان'); ok = false; }
    const amt = amount.get();
    if (amt === null || amt < 0) { amount.setError('اكتب المبلغ بالدينار'); ok = false; } else amount.setError(null);
    const vid = vendor.resolve(cat.get());
    if (vid === false) ok = false;
    const msValues = ms?.values() ?? [];
    if (msValues.some((m) => !m.title || m.amount === null)) { toast('أكمل اسم ومبلغ كل مرحلة أو احذفها'); ok = false; }
    if (!ok) return;

    const rp = retention.get() ? Number(retention.get()) : null;
    const row = store.save('commitments', {
      id, vendor_id: (vid as string | null) || null, type, title: title.get(), category: cat.get(), original_amount: amt!,
      status: existing?.status ?? (type === 'estimate' ? 'estimated' : 'approved'),
      signed_date: signed.get(), ref_no: ref.get() || null, notes: notes.get() || null,
      retention_pct: rp !== null && Number.isFinite(rp) ? rp : null,
    });
    msValues.forEach((m, i) => store.save('milestones', {
      id: m.id, commitment_id: row.id, sort_order: i, title: m.title, amount: m.amount!,
      due_trigger: m.due_trigger || null, due_date: m.due_date, marked_due: m.marked_due,
    }));
    ms?.removed.forEach((mid) => store.softDelete('milestones', mid));
    for (const file of files.files()) {
      const prepared = await prepareFile(file);
      await saveDocument({
        prepared, type: type === 'estimate' ? 'quotation' : 'contract', title: `${title.get()}`,
        date: signed.get(), amount: amt, vendorName: vid ? vendorName(vid) : null,
        links: [{ entity_type: 'commitment', entity_id: row.id }],
      });
    }
    toast(id ? 'تم حفظ التعديلات' : 'تم الحفظ');
    if (id) history.back(); else go(`/commitment/${row.id}`);
  };

  const heading = id ? 'تعديل' : type === 'estimate' ? 'بند متوقع' : 'عقد جديد';
  return {
    top: topbar(heading, { back: true }),
    body: h('form', { class: 'stack', onsubmit: (e: Event) => { e.preventDefault(); void save(); } },
      type === 'estimate' && !id ? alertBox('info', ['للتكاليف التي تعرف أنها قادمة ولم تشترها بعد، مثل الأدوات الصحية والبلاط. تدخل في التكلفة المتوقعة فقط.']) : null,
      vendor.el, title.el, cat.el, amount.el,
      ms?.el ?? null,
      type !== 'estimate' ? h('div', { class: 'grid2' }, signed.el, ref.el) : null,
      id ? null : files.el,
      h('details', { class: 'more' }, h('summary', null, 'تفاصيل إضافية'), h('div', { class: 'stack' }, type === 'staged_contract' ? retention.el : null, notes.el)),
    ),
    footer: formFooter(id ? 'حفظ التعديلات' : 'حفظ', save),
    form: true,
  };
}

route('/add/contract', (_, q) => commitmentForm('staged_contract', undefined, q));
route('/add/estimate', (_, q) => commitmentForm('estimate', undefined, q));
route('/edit/commitment/:id', ({ id }, q) => commitmentForm('edit', id, q));

// ---------- direct purchase ----------
route('/add/purchase', (_, q): Screen => {
  const presetVendor = q.get('vendor');
  const vendor = vendorField(presetVendor, { onchange: (vid) => {
    const vc = vid ? store.get('vendors', vid)?.category : undefined;
    if (vc) cat.set(vc);
  } });
  const title = textField('ماذا اشتريت؟', q.get('title') ?? '', { placeholder: 'مثال: بلاط الصالة' });
  const cat = categoryField((presetVendor && store.get('vendors', presetVendor)?.category) || 'other');
  const total = amountField('المبلغ الإجمالي', null);
  const deposit = segmented('طريقة السداد', [['full', 'دفعة واحدة'], ['partial', 'عربون والباقي لاحقاً']], 'full', (v) => { paidNow.el.hidden = v === 'full'; });
  const paidNow = amountField('المدفوع الآن', null);
  paidNow.el.hidden = true;
  const date = dateField('التاريخ', today());
  const method = selectField<PaymentMethod>('طريقة الدفع', options(PAYMENT_METHOD), 'bank_transfer');
  const payer = payerField();
  const ref = textField('رقم الإيصال أو التحويل', '', { ltr: true });
  const notes = textArea('ملاحظات');
  const files = filePicker();

  const save = async () => {
    let ok = true;
    if (!title.get()) { title.setError('اكتب ما الذي اشتريته'); ok = false; } else title.setError(null);
    const t = total.get();
    if (!t || t <= 0) { total.setError('اكتب المبلغ'); ok = false; } else total.setError(null);
    const partial = deposit.get() === 'partial';
    const now = partial ? paidNow.get() : t;
    if (partial && (!now || now <= 0 || (t !== null && now >= t))) { paidNow.setError('المدفوع الآن يجب أن يكون أقل من الإجمالي'); ok = false; } else paidNow.setError(null);
    if (!payer.get()) { payer.setError('اختر من دفع'); ok = false; }
    const vid = vendor.resolve(cat.get());
    if (vid === false) ok = false;
    if (!ok) return;

    const commitment: Commitment = {
      id: crypto.randomUUID(), project_id: store.projectId!, deleted_at: null,
      vendor_id: vid as string | null, type: 'direct_purchase', title: title.get(), category: cat.get(), original_amount: t!,
      status: 'approved', signed_date: date.get(), retention_pct: null, ref_no: null, notes: notes.get() || null,
    };
    const saved = await checkAndSavePayment({
      commitment, isNewCommitment: true,
      payment: { amount: now!, date: date.get() ?? today(), method: method.get() as PaymentMethod, payer_id: payer.get(), ref_no: ref.get() || null, milestone_id: null, notes: null },
      files: files.files(),
    });
    if (!saved) return;
    toast('تم تسجيل الشراء');
    go(`/commitment/${commitment.id}`);
  };

  return {
    top: topbar('شراء مباشر', { back: true }),
    body: h('form', { class: 'stack', onsubmit: (e: Event) => { e.preventDefault(); void save(); } },
      vendor.el, title.el, total.el, deposit.el, paidNow.el,
      h('div', { class: 'grid2' }, date.el, payer.el),
      files.el,
      h('details', { class: 'more' }, h('summary', null, 'تفاصيل إضافية'),
        h('div', { class: 'stack' }, cat.el, method.el, ref.el, notes.el)),
    ),
    footer: formFooter('حفظ الشراء', save),
    form: true,
  };
});

// ---------- variation ----------
function variationForm(id: string | undefined, q: URLSearchParams): Screen {
  const existing = id ? store.get('variations', id) : undefined;
  const open = store.all('commitments').filter((c) => c.status !== 'cancelled' && c.status !== 'estimated');
  const cSel = selectField<string>('العقد', open.map((c) => [c.id, `${vendorName(c.vendor_id)} · ${c.title}`]), existing?.commitment_id ?? q.get('commitment') ?? '', { placeholder: 'اختر العقد' });
  const dir = segmented('النوع', [['add', 'إضافة على العقد'], ['remove', 'خصم من العقد']], existing && existing.amount < 0 ? 'remove' : 'add');
  const title = textField('الوصف', existing?.title ?? '', { placeholder: 'مثال: غرفة إضافية في السطح' });
  const amount = amountField('المبلغ', existing ? Math.abs(existing.amount) : (q.get('amount') ? Number(q.get('amount')) : null));
  const reason = textArea('السبب', existing?.reason ?? '');
  const date = dateField('التاريخ', existing?.date ?? today());
  const status = selectField('الحالة', options(VARIATION_STATUS), existing?.status ?? 'approved', { hint: 'المقترح والمرفوض لا يغيّران قيمة العقد' });
  const files = filePicker({ label: 'مرفق (اختياري)' });

  const save = async () => {
    let ok = true;
    if (!cSel.get()) { cSel.setError('اختر العقد'); ok = false; }
    if (!title.get()) { title.setError('اكتب الوصف'); ok = false; }
    if (!reason.get()) { reason.setError('اكتب السبب'); ok = false; }
    const a = amount.get();
    if (!a || a <= 0) { amount.setError('اكتب المبلغ'); ok = false; }
    if (!ok) return;
    const row = store.save('variations', {
      id, commitment_id: cSel.get(), title: title.get(), reason: reason.get(),
      amount: dir.get() === 'remove' ? -a! : a!, date: date.get() ?? today(), status: status.get() || 'approved',
    });
    for (const file of files.files()) {
      const c = store.get('commitments', row.commitment_id);
      await saveDocument({ prepared: await prepareFile(file), type: 'correspondence', title: `أمر تغيير: ${row.title}`, date: row.date, amount: a, vendorName: vendorName(c?.vendor_id), links: [{ entity_type: 'variation', entity_id: row.id }, { entity_type: 'commitment', entity_id: row.commitment_id }] });
    }
    toast('تم حفظ أمر التغيير');
    const ret = q.get('return');
    if (ret) go(ret); else history.back();
  };

  const del = existing ? h('button', { type: 'button', class: 'btn danger', onclick: async () => {
    if (!(await confirmDialog({ title: 'حذف أمر التغيير؟', ok: 'حذف', danger: true }))) return;
    store.softDelete('variations', existing.id);
    history.back();
    toast('تم الحذف', { label: 'تراجع', run: () => store.restore('variations', existing.id) });
  } }, icon('trash')) : undefined;

  return {
    top: topbar(id ? 'تعديل أمر التغيير' : 'أمر تغيير', { back: true, actions: id ? [iconButton('history', 'السجل', () => go(`/history/variations/${id}`))] : [] }),
    body: h('form', { class: 'stack', onsubmit: (e: Event) => { e.preventDefault(); void save(); } },
      open.length ? null : alertBox('warn', ['لا توجد عقود معتمدة بعد.']),
      cSel.el, dir.el, title.el, amount.el, reason.el, h('div', { class: 'grid2' }, date.el, status.el), id ? null : files.el),
    footer: formFooter('حفظ', save, del),
    form: true,
  };
}
route('/add/variation', (_, q) => variationForm(undefined, q));
route('/edit/variation/:id', ({ id }, q) => variationForm(id, q));

// ---------- quick "attach document to entity" ----------
route('/attach', (_, q): Screen => {
  const entity = q.get('entity') as 'vendor' | 'commitment' | 'payment' | 'milestone' | 'variation';
  const eid = q.get('id') ?? '';
  const files = filePicker();
  const type = selectField<DocType>('نوع المستند', options(DOC_TYPE), entity === 'payment' ? 'receipt' : entity === 'commitment' ? 'contract' : 'other');
  let defaultTitle = '';
  let vendorLabel: string | null = null;
  let amountDefault: number | null = null;
  let dateDefault: string | null = today();
  if (entity === 'payment') {
    const p = store.get('payments', eid);
    const c = store.get('commitments', p?.commitment_id);
    vendorLabel = vendorName(c?.vendor_id);
    defaultTitle = `سند دفعة ${vendorLabel}`;
    amountDefault = p?.amount ?? null;
    dateDefault = p?.date ?? dateDefault;
  } else if (entity === 'commitment') {
    const c = store.get('commitments', eid);
    vendorLabel = vendorName(c?.vendor_id);
    defaultTitle = c?.title ?? '';
  } else if (entity === 'vendor') {
    vendorLabel = vendorName(eid);
    defaultTitle = vendorLabel;
  }
  const title = textField('العنوان', defaultTitle);
  const date = dateField('تاريخ المستند', dateDefault);

  const pickExisting = () => {
    const docs = store.all('documents').sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 60);
    openSheet((close) => [
      h('h2', null, 'اختر مستنداً موجوداً'),
      docs.length ? h('ul', { class: 'list' }, ...docs.map((d) => h('li', null, h('button', { class: 'row', onclick: async () => {
        linkDocument(d.id, { entity_type: entity, entity_id: eid });
        close(); toast('تم ربط المستند'); history.back();
      } }, h('div', { class: 'main' }, h('span', { class: 'title' }, d.title), h('span', { class: 'meta' }, `${DOC_TYPE[d.type]} · ${fmtDate(d.date)}`)))))) : empty('لا توجد مستندات.'),
    ]);
  };

  const save = async () => {
    const list = files.files();
    if (!list.length) { toast('صوّر المستند أو اختر ملفاً'); return; }
    for (const file of list) {
      const prepared = await prepareFile(file);
      if (prepared.duplicate) {
        const ok = await confirmDialog({ title: 'هذا الملف مرفوع مسبقاً', body: `باسم "${prepared.duplicate.title}". هل تريد ربط المستند الموجود بدلاً من رفعه مرة أخرى؟`, ok: 'ربط الموجود', cancel: 'رفع نسخة جديدة' });
        if (ok) {
            linkDocument(prepared.duplicate.id, { entity_type: entity, entity_id: eid });
          continue;
        }
      }
      await saveDocument({ prepared, type: type.get() as DocType, title: title.get() || 'مستند', date: date.get(), amount: amountDefault, vendorName: vendorLabel, links: [{ entity_type: entity, entity_id: eid }] });
    }
    toast('تم إرفاق المستند');
    history.back();
  };

  return {
    top: topbar('إرفاق مستند', { back: true }),
    body: h('div', { class: 'stack' }, files.el, type.el, title.el, date.el,
      h('button', { type: 'button', class: 'link-btn', onclick: pickExisting }, 'أو اربط مستنداً مرفوعاً مسبقاً')),
    footer: formFooter('إرفاق', save),
    form: true,
  };
});

export { milestoneEditor };
