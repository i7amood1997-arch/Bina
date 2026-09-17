import { DEMO } from '../config';
import { store } from '../db/store';
import { uploadError } from '../documents';
import { commitmentFigures, milestoneStatus, paymentHasProof } from '../engine';
import { fmtDate, fmtDateShort, fmtWhen, today } from '../dates';
import { formatBD } from '../money';
import { ACTION, CATEGORY, COMMITMENT_STATUS, COMMITMENT_TYPE, DOC_TYPE, ENTITY, MILESTONE_STATUS, PAYMENT_METHOD } from '../strings';
import type { AuditEntry, Commitment, Doc, Milestone, Payment } from '../types';
import { h, money } from '../ui/dom';
import { icon } from '../ui/icons';

export function vendorName(id: string | null | undefined): string {
  return (id && store.get('vendors', id)?.name) || 'بدون جهة';
}

export function syncStatus(): HTMLElement {
  if (DEMO) return h('span', { class: 'statusline' }, h('span', { class: 'dot off' }), 'وضع تجريبي على هذا الجهاز');
  if (!store.online) {
    const n = store.pendingCount;
    return h('span', { class: 'statusline' }, h('span', { class: 'dot off' }), n ? `بدون اتصال · ${n} بانتظار المزامنة` : 'بدون اتصال');
  }
  if (store.pendingCount || store.syncing) return h('span', { class: 'statusline' }, h('span', { class: 'dot warn' }), 'بانتظار المزامنة…');
  return h('span', { class: 'statusline' }, h('span', { class: 'dot' }), 'متزامن');
}

export function systemAlerts(): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (store.conflicts.length) {
    out.push(h('a', { href: '#/settings', class: 'alert danger', style: 'text-decoration:none' }, icon('alert'),
      h('div', { class: 'body' }, h('strong', null, `${store.conflicts.length} تعارض في التعديلات`), h('div', { class: 'small' }, 'عدّلتما نفس السجل في نفس الوقت. اختر النسخة الصحيحة.'))));
  }
  if (uploadError) {
    out.push(h('a', { href: '#/settings', class: 'alert', style: 'text-decoration:none' }, icon('upload'),
      h('div', { class: 'body' }, h('strong', null, 'ملفات لم تُرفع بعد'), h('div', { class: 'small' }, uploadError))));
  }
  return out;
}

export function statusChip(status: keyof typeof COMMITMENT_STATUS) {
  const cls = status === 'fully_paid' ? 'paid' : status === 'estimated' ? 'primary' : status === 'cancelled' ? 'danger' : '';
  return h('span', { class: `chip ${cls}` }, COMMITMENT_STATUS[status]);
}

export function commitmentRow(c: Commitment, opts: { showVendor?: boolean } = {}): HTMLElement {
  const f = commitmentFigures(c, store.snapshot());
  const metaParts = [opts.showVendor !== false ? vendorName(c.vendor_id) : CATEGORY[c.category], COMMITMENT_TYPE[c.type]];
  return h('li', null, h('a', { class: 'row', href: `#/commitment/${c.id}` },
    h('div', { class: 'main' },
      h('span', { class: 'title' }, c.title),
      h('span', { class: 'meta' }, metaParts.join(' · ')),
      h('div', { style: 'margin-top:4px' }, statusChip(f.status)),
    ),
    h('div', { class: 'end' },
      money(formatBD(f.adjusted)),
      c.status === 'cancelled' || f.status === 'fully_paid'
        ? h('span', { class: 'meta' }, `مدفوع ${formatBD(f.paid)}`)
        : h('span', { class: 'meta' }, 'متبقي ', money(formatBD(f.remaining))),
    ),
    icon('chev', 'chev'),
  ));
}

export function paymentRow(p: Payment, opts: { showCommitment?: boolean } = {}): HTMLElement {
  const c = store.get('commitments', p.commitment_id);
  const proof = paymentHasProof(p, store.all('document_links'));
  const payer = store.get('payers', p.payer_id)?.name ?? '';
  const title = opts.showCommitment !== false && c ? `${vendorName(c.vendor_id)} · ${c.title}` : (p.notes || PAYMENT_METHOD[p.method]);
  return h('li', null, h('a', { class: 'row', href: `#/payment/${p.id}` },
    h('span', { class: `lead-icon ${proof ? 'paid' : 'warn'}`, title: proof ? 'موثقة' : 'بدون سند' }, icon(proof ? 'check' : 'alert')),
    h('div', { class: 'main' },
      h('span', { class: 'title' }, title),
      h('span', { class: 'meta' }, [fmtDateShort(p.date), payer, proof ? null : 'بدون سند'].filter(Boolean).join(' · ')),
    ),
    h('div', { class: 'end' }, money(formatBD(p.amount))),
    icon('chev', 'chev'),
  ));
}

export function milestoneChip(m: Milestone) {
  const s = milestoneStatus(m, store.all('payments'), today());
  const cls = s === 'paid' ? 'paid' : s === 'due' ? 'due' : s === 'partially_paid' ? 'primary' : '';
  return h('span', { class: `chip ${cls}` }, MILESTONE_STATUS[s]);
}

export function docRow(d: Doc, extra?: HTMLElement): HTMLElement {
  const pending = !d.drive_file_id;
  return h('li', null, h('a', { class: 'row', href: `#/document/${d.id}` },
    h('span', { class: 'lead-icon' }, icon('file')),
    h('div', { class: 'main' },
      h('span', { class: 'title' }, d.title),
      h('span', { class: 'meta' }, [DOC_TYPE[d.type], fmtDateShort(d.date), pending ? 'بانتظار الرفع' : null].filter(Boolean).join(' · ')),
    ),
    d.amount ? h('div', { class: 'end' }, money(formatBD(d.amount))) : null,
    extra ?? null,
    icon('chev', 'chev'),
  ));
}

const TABLE_ENTITY: Record<string, keyof typeof ENTITY> = {
  hb_vendors: 'vendor', hb_commitments: 'commitment', hb_payments: 'payment', hb_milestones: 'milestone',
  hb_variations: 'variation', hb_projects: 'project', hb_payers: 'payer', hb_documents: 'document', hb_document_links: 'document_link',
};

export function describeAudit(a: AuditEntry): { text: string; href: string | null } {
  const who = store.memberName(a.user_id);
  const row = (a.after ?? a.before ?? {}) as Record<string, unknown>;
  const ent = TABLE_ENTITY[a.entity_type] ?? 'document';
  let label = String(row.title ?? row.name ?? '');
  let href: string | null = null;
  if (ent === 'payment') {
    const c = store.get('commitments', String(row.commitment_id));
    label = `${formatBD(Number(row.amount ?? 0))} ${c ? `لـ ${vendorName(c.vendor_id)}` : ''}`;
    href = `#/payment/${a.entity_id}`;
  } else if (ent === 'commitment') href = `#/commitment/${a.entity_id}`;
  else if (ent === 'vendor') href = `#/vendor/${a.entity_id}`;
  else if (ent === 'document') href = `#/document/${a.entity_id}`;
  else if (ent === 'milestone' || ent === 'variation') href = row.commitment_id ? `#/commitment/${row.commitment_id}` : null;
  else if (ent === 'document_link') {
    const d = store.get('documents', String(row.document_id));
    label = d?.title ?? '';
    href = d ? `#/document/${d.id}` : null;
  }
  let text = `${who} ${ACTION[a.action] ?? a.action} ${ENTITY[ent]}${label ? ` ${label}` : ''}`;
  if (ent === 'document_link') {
    text = a.action === 'insert' ? `${who} أرفق المستند ${label}` : a.action === 'delete' ? `${who} أزال ربط المستند ${label}` : `${who} أعاد ربط المستند ${label}`;
  }
  return { text, href };
}

export function activityList(entries: AuditEntry[]): HTMLElement {
  if (!entries.length) return h('div', { class: 'empty' }, h('p', null, 'لا توجد نشاطات بعد.'));
  return h('ul', { class: 'list' }, ...entries.map((a) => {
    const d = describeAudit(a);
    const inner = [
      h('div', { class: 'main' }, h('span', { class: 'title', style: 'white-space:normal;font-weight:500' }, d.text), h('span', { class: 'meta' }, fmtWhen(a.at))),
    ];
    return h('li', null, d.href ? h('a', { class: 'row', href: d.href }, ...inner) : h('div', { class: 'row' }, ...inner));
  }));
}

export function kv(pairs: [string, string | HTMLElement | null | undefined][]) {
  return h('dl', { class: 'kv' }, ...pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v!)]));
}

export { fmtDate };
