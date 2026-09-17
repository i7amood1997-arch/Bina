import { go, route, type Screen } from '../app';
import { extractDocument, getApiKey, recordCorrections, type Extraction } from '../ai';
import { store } from '../db/store';
import { linkDocument, prepareFile, saveDocument, type PreparedFile } from '../documents';
import { commitmentFigures, milestoneStatus } from '../engine';
import { fmtDate, today } from '../dates';
import { isImage } from '../files';
import { formatBD } from '../money';
import { CATEGORY, DOC_TYPE, options, PAYMENT_METHOD } from '../strings';
import type { Category, Commitment, DocType, EntityType, PaymentMethod } from '../types';
import { clear, h } from '../ui/dom';
import { icon } from '../ui/icons';
import {
  alertBox, amountField, categoryField, confirmDialog, dateField, formFooter, loading, payerField, segmented,
  selectField, textField, toast, topbar, vendorField,
} from '../ui/components';
import { milestoneEditor } from './commitments';
import { checkAndSavePayment } from './payments';
import { vendorName } from './common';

type Action = 'payment' | 'purchase' | 'contract' | 'estimate' | 'doc_only';
const LOW = 0.7;

route('/capture', (): Screen => {
  const body = h('div');
  const footerSlot = h('div');
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
  const picker = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });

  const put = (...c: (Node | null)[]) => c.forEach((x) => { if (x) body.append(x); });
  const start = () => {
    clear(body); clear(footerSlot);
    put(
      h('div', { class: 'center', style: 'padding-top:24px' },
        h('span', { class: 'lead-icon', style: 'width:72px;height:72px;border-radius:20px' }, icon('camera')),
        h('h2', { style: 'margin:0;font-size:20px' }, 'صوّر السند أو العقد'),
        h('p', { class: 'muted', style: 'margin:0;max-width:34ch' }, 'يقرأ التطبيق الجهة والمبلغ والتاريخ والمرجع، وتراجعها أنت قبل الحفظ. لا يُحفظ شيء قبل تأكيدك.'),
      ),
      h('div', { class: 'stack', style: 'margin-top:8px' },
        h('button', { class: 'btn primary block', onclick: () => camera.click() }, icon('camera'), 'فتح الكاميرا'),
        h('button', { class: 'btn block', onclick: () => picker.click() }, icon('upload'), 'اختيار صورة أو PDF'),
      ),
      getApiKey() ? null : alertBox('info', ['القراءة الذكية غير مفعّلة. ستُدخل البيانات يدوياً.'], [h('a', { class: 'btn sm', href: '#/settings' }, 'إضافة مفتاح Claude')]),
      camera, picker,
    );
  };

  const onFile = async (file: File) => {
    clear(body);
    body.append(loading('تجهيز الملف…'));
    const prepared = await prepareFile(file);
    if (prepared.duplicate) {
      const d = prepared.duplicate;
      const open = await confirmDialog({
        title: 'هذا الملف مرفوع مسبقاً',
        body: `باسم "${d.title}" بتاريخ ${fmtDate(d.date)}، أضافه ${store.memberName(d.created_by)}.`,
        ok: 'فتح المستند الموجود', cancel: 'متابعة على أي حال',
      });
      if (open) { go(`/document/${d.id}`); return; }
    }
    let ex: Extraction | null = null;
    let err: string | null = null;
    if (getApiKey()) {
      clear(body);
      body.append(loading('يقرأ المستند…'));
      try { ex = await extractDocument(prepared.blob); } catch (e) { err = (e as Error).message; }
    }
    review(prepared, ex, err);
  };

  const review = (prepared: PreparedFile, ex: Extraction | null, err: string | null) => {
    clear(body); clear(footerSlot);
    const conf = (k: string) => (ex ? Number(ex.confidence?.[k] ?? 0) : 1);
    const mark = (el: HTMLElement, k: string) => {
      if (ex && conf(k) < LOW) {
        el.querySelector('.input')?.classList.add('low');
        el.append(h('div', { class: 'hint', style: 'color:var(--warn);font-weight:600' }, 'راجِع هذه القيمة'));
      }
      return el;
    };

    const thumb = isImage(prepared.blob.type)
      ? h('img', { src: URL.createObjectURL(prepared.blob), alt: 'المستند', class: 'preview-img', style: 'max-height:220px;object-fit:contain;background:var(--surface-2)' })
      : h('div', { class: 'file-item' }, icon('file'), h('div', { class: 'main' }, (prepared.original as File).name ?? 'PDF'));

    const docType = selectField<DocType>('نوع المستند', options(DOC_TYPE), ex?.doc_type ?? 'receipt');
    const vendor = vendorField(ex?.vendor_match_id ?? null, { optional: true, newName: ex && !ex.vendor_match_id ? ex.vendor_name ?? undefined : undefined,
      onchange: (vid) => { refreshCommitments(vid); const vc = vid ? store.get('vendors', vid)?.category : undefined; if (vc) cat.set(vc); } });
    const amount = amountField('المبلغ', ex?.amount_fils ?? null);
    const date = dateField('التاريخ', ex?.date ?? today());
    const ref = textField('المرجع', ex?.ref_no ?? '', { ltr: true });
    const method = selectField<PaymentMethod>('طريقة الدفع', options(PAYMENT_METHOD), ex?.method ?? 'bank_transfer');
    const title = textField('الوصف', ex?.description ?? '', { placeholder: 'مثال: الدفعة الثانية للمقاول' });
    const cat = categoryField((ex?.vendor_match_id && store.get('vendors', ex.vendor_match_id)?.category) || 'other');
    const payer = payerField();
    const cSel = selectField<string>('العقد أو الشراء', [], '', { placeholder: 'اختر' });
    const msSel = selectField<string>('المرحلة', [], '', { placeholder: 'بدون مرحلة' });

    const refreshCommitments = (vid: string | null, preset?: string) => {
      const snap = store.snapshot();
      const list = store.all('commitments').filter((c) => c.status !== 'cancelled' && (!vid || c.vendor_id === vid));
      cSel.setOptions(list.map((c) => [c.id, `${vendorName(c.vendor_id)} · ${c.title} (متبقي ${formatBD(commitmentFigures(c, snap).remaining)})`]),
        preset ?? (list.length === 1 ? list[0].id : ''));
      refreshMilestones();
    };
    const refreshMilestones = (preset?: string) => {
      const snap = store.snapshot();
      const ms = store.all('milestones').filter((m) => m.commitment_id === cSel.get()).sort((a, b) => a.sort_order - b.sort_order);
      msSel.setOptions(ms.filter((m) => milestoneStatus(m, snap.payments, today()) !== 'paid').map((m) => [m.id, `${m.title} · ${formatBD(m.amount)}`]), preset ?? '');
      msSel.el.hidden = ms.length === 0;
    };
    cSel.input.addEventListener('change', () => refreshMilestones());
    refreshCommitments(vendor.selectedId(), ex?.commitment_match_id ?? undefined);
    if (ex?.milestone_match_id) refreshMilestones(ex.milestone_match_id);

    const t0 = ex?.doc_type ?? 'receipt';
    const defaultAction: Action =
      t0 === 'contract' ? 'contract'
      : t0 === 'quotation' ? 'estimate'
      : ['receipt', 'transfer_slip', 'cheque', 'invoice'].includes(t0) ? (ex?.commitment_match_id || store.all('commitments').length ? 'payment' : 'purchase')
      : 'doc_only';

    const ms = milestoneEditor((ex?.milestones ?? []).map((m) => ({ title: m.title, amount: m.amount_fils, due_trigger: m.due_trigger ?? '', due_date: null, marked_due: false })), () => amount.get());
    amount.input.addEventListener('input', () => ms.update());

    const exclusionChecks = (ex?.exclusions ?? []).map((x) => {
      const cb = h('input', { type: 'checkbox', checked: true });
      return { x, cb, el: h('label', { class: 'check' }, cb, h('span', null, x.title, x.category ? h('span', { class: 'muted small' }, ` · ${CATEGORY[x.category as Category]}`) : null)) };
    });

    const groups: Record<Action, HTMLElement> = {
      payment: h('div', { class: 'stack' }, cSel.el, msSel.el, payer.el, method.el),
      purchase: h('div', { class: 'stack' }, cat.el, payer.el, method.el),
      contract: h('div', { class: 'stack' }, cat.el, ms.el,
        exclusionChecks.length ? h('div', { class: 'field' },
          h('div', { class: 'label' }, 'بنود على المالك (تُضاف كبنود متوقعة بدون مبلغ)'),
          ...exclusionChecks.map((e) => e.el)) : null),
      estimate: h('div', { class: 'stack' }, cat.el),
      doc_only: h('div'),
    };
    const actionHost = h('div');
    const setAction = (a: Action) => {
      clear(actionHost);
      // cat/payer/method elements are shared; re-append moves them
      if (a === 'payment') groups.payment.append(cSel.el, msSel.el, payer.el, method.el);
      if (a === 'purchase') groups.purchase.append(cat.el, payer.el, method.el);
      if (a === 'contract') groups.contract.prepend(cat.el);
      if (a === 'estimate') groups.estimate.append(cat.el);
      actionHost.append(groups[a]);
      title.el.querySelector('label')!.textContent = a === 'contract' ? 'عنوان العقد' : a === 'estimate' ? 'البند' : a === 'purchase' ? 'ماذا اشتريت؟' : 'الوصف';
    };
    const action = segmented<Action>('ماذا تريد أن تسجّل؟', [
      ['payment', 'دفعة'], ['purchase', 'شراء'], ['contract', 'عقد'], ['estimate', 'تقدير'], ['doc_only', 'مستند فقط'],
    ], defaultAction, setAction);
    setAction(defaultAction);

    put(
      err ? alertBox('warn', [h('strong', null, 'لم تتم القراءة التلقائية'), h('div', { class: 'small' }, `${err}. أدخل البيانات يدوياً.`)]) : null,
      ex ? alertBox('info', ['راجع القيم قبل الحفظ. الحقول المظللة تحتاج تأكيداً.']) : null,
      h('div', { class: 'stack', style: 'margin-top:12px' },
        thumb,
        action.el,
        mark(docType.el, 'doc_type'),
        mark(vendor.el, 'vendor'),
        mark(amount.el, 'amount'),
        h('div', { class: 'grid2' }, mark(date.el, 'date'), mark(ref.el, 'ref_no')),
        title.el,
        actionHost,
      ),
    );

    const save = async () => {
      const a = action.get();
      const amt = amount.get();
      const vid = vendor.resolve(cat.get());
      if (vid === false) return;
      if (a !== 'doc_only' && (!amt || amt <= 0) && a !== 'contract') { amount.setError('اكتب المبلغ'); return; }
      if (a === 'contract' && (amt === null || amt < 0)) { amount.setError('اكتب قيمة العقد'); return; }
      amount.setError(null);
      const dt = date.get() ?? today();
      const typ = (docType.get() || 'other') as DocType;
      const vName = vid ? vendorName(vid) : null;
      const baseTitle = title.get();
      const links: { entity_type: EntityType; entity_id: string }[] = [];
      let target = '/documents';

      if (a === 'payment') {
        const c = store.get('commitments', cSel.get());
        if (!c) { cSel.setError('اختر العقد أو الشراء، أو اختر "شراء"'); return; }
        const p = await checkAndSavePayment({ commitment: c, payment: {
          amount: amt!, date: dt, method: method.get() as PaymentMethod, payer_id: payer.get(),
          ref_no: ref.get() || null, milestone_id: msSel.get() || null, notes: baseTitle || null,
        } });
        if (!p) return;
        links.push({ entity_type: 'payment', entity_id: p.id });
        target = `/payment/${p.id}`;
      } else if (a === 'purchase') {
        if (!baseTitle) { title.setError('اكتب ما الذي اشتريته'); return; }
        const c: Commitment = {
          id: crypto.randomUUID(), project_id: store.projectId!, deleted_at: null, vendor_id: vid, type: 'direct_purchase',
          title: baseTitle, category: cat.get(), original_amount: amt!, status: 'approved', signed_date: dt,
          retention_pct: null, ref_no: null, notes: null,
        };
        const p = await checkAndSavePayment({ commitment: c, isNewCommitment: true, payment: {
          amount: amt!, date: dt, method: method.get() as PaymentMethod, payer_id: payer.get(), ref_no: ref.get() || null, milestone_id: null, notes: null,
        } });
        if (!p) return;
        links.push({ entity_type: 'payment', entity_id: p.id });
        target = `/commitment/${c.id}`;
      } else if (a === 'contract' || a === 'estimate') {
        if (!baseTitle) { title.setError('اكتب العنوان'); return; }
        const msVals = a === 'contract' ? ms.values() : [];
        if (msVals.some((m) => !m.title || m.amount === null)) { toast('أكمل اسم ومبلغ كل مرحلة أو احذفها'); return; }
        const c = store.save('commitments', {
          vendor_id: vid, type: a === 'contract' ? 'staged_contract' : 'estimate', title: baseTitle, category: cat.get(),
          original_amount: amt ?? 0, status: a === 'contract' ? 'approved' : 'estimated',
          signed_date: a === 'contract' ? dt : null, ref_no: ref.get() || null, notes: null, retention_pct: null,
        });
        msVals.forEach((m, i) => store.save('milestones', {
          commitment_id: c.id, sort_order: i, title: m.title, amount: m.amount!, due_trigger: m.due_trigger || null, due_date: m.due_date, marked_due: false,
        }));
        for (const e of exclusionChecks) {
          if (!e.cb.checked) continue;
          store.save('commitments', {
            vendor_id: null, type: 'estimate', title: e.x.title, category: (e.x.category as Category) ?? 'other',
            original_amount: 0, status: 'estimated', signed_date: null, ref_no: null, notes: `مستثنى من ${baseTitle}`, retention_pct: null,
          });
        }
        links.push({ entity_type: 'commitment', entity_id: c.id });
        target = `/commitment/${c.id}`;
      } else if (vid) {
        links.push({ entity_type: 'vendor', entity_id: vid });
      }

      if (prepared.duplicate) {
        for (const l of links) linkDocument(prepared.duplicate.id, l);
      } else {
        await saveDocument({ prepared, type: typ, title: baseTitle || `${DOC_TYPE[typ]}${vName ? ` ${vName}` : ''}`, date: dt, amount: amt, vendorName: vName, links });
      }
      if (ex) recordCorrections(ex, { vendorId: vid, vendorName: vName, amount: amt, date: dt, docType: typ });
      toast('تم الحفظ');
      go(target);
    };

    footerSlot.append(formFooter('حفظ', save, h('button', { type: 'button', class: 'btn', onclick: start }, 'إعادة')));
  };

  const pick = (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (f) void onFile(f);
  };
  camera.addEventListener('change', pick);
  picker.addEventListener('change', pick);
  start();

  return { top: topbar('صوّر مستند', { back: true }), body: [body], footer: footerSlot, form: true };
});

