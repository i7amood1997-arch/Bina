import { go, markActivitySeen, rerender, route, type Screen } from '../app';
import { getApiKey, setApiKey } from '../ai';
import { DEMO, DRIVE_ENABLED } from '../config';
import { store, type Conflict } from '../db/store';
import { supabase } from '../db/supabase';
import { flushUploads, pendingUploadCount, uploadError } from '../documents';
import { createFolder, driveFolder, getToken, hasValidToken, pickFolder } from '../drive';
import { fmtDate, fmtWhen, today } from '../dates';
import { formatBD } from '../money';
import { ENTITY, FIELD } from '../strings';
import { dbTable, type TableName } from '../types';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import {
  alertBox, confirmDialog, empty, formFooter, openSheet, textField, toast, topbar,
} from '../ui/components';
import { activityList, syncStatus, vendorName } from './common';

route('/settings', async (): Promise<Screen> => {
  const project = store.project();
  const pendingUploads = DEMO ? 0 : await pendingUploadCount();
  const folder = driveFolder();

  const section = (title: string, ...children: (HTMLElement | null)[]) =>
    h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, title)), ...children);
  const linkRow = (href: string, ic: Parameters<typeof icon>[0], label: string, meta?: string) =>
    h('li', null, h('a', { class: 'row', href }, h('span', { class: 'lead-icon' }, icon(ic)),
      h('div', { class: 'main' }, h('span', { class: 'title' }, label), meta ? h('span', { class: 'meta' }, meta) : null), icon('chev', 'chev')));
  const actionRow = (ic: Parameters<typeof icon>[0], label: string, meta: string | null, onclick: () => void) =>
    h('li', null, h('button', { class: 'row', onclick }, h('span', { class: 'lead-icon' }, icon(ic)),
      h('div', { class: 'main' }, h('span', { class: 'title' }, label), meta ? h('span', { class: 'meta' }, meta) : null), icon('chev', 'chev')));

  const editName = () => {
    const f = textField('اسمك كما يظهر في السجل', store.myName());
    openSheet((close) => [h('h2', null, 'اسم العرض'), f.el, h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn primary block', onclick: async () => { if (f.get()) { await store.updateDisplayName(f.get()); close(); rerender(); } } }, 'حفظ'))]);
  };

  const editKey = () => {
    const f = textField('Claude API key', getApiKey() ?? '', { ltr: true, type: 'password', hint: 'يُحفظ على هذا الجهاز فقط. أنشئه من console.anthropic.com' });
    openSheet((close) => [h('h2', null, 'مفتاح القراءة الذكية'), f.el, h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn primary block', onclick: () => { setApiKey(f.get()); close(); toast(f.get() ? 'تم حفظ المفتاح' : 'تم حذف المفتاح'); rerender(); } }, 'حفظ'),
      getApiKey() ? h('button', { class: 'btn block danger', onclick: () => { setApiKey(null); close(); rerender(); } }, 'حذف المفتاح') : null,
    )]);
  };

  const driveSetup = async () => {
    const choice = await new Promise<'pick' | 'create' | null>((resolve) => {
      let done = false;
      openSheet((close) => [
        h('h2', null, 'مجلد Google Drive'),
        h('p', { class: 'muted' }, 'اختر مجلد "بناء البيت" المشترك بينكما. إن لم يكن موجوداً، أنشئه من هنا ثم شاركه مع الطرف الآخر كمحرّر من Google Drive.'),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn primary block', onclick: () => { done = true; resolve('pick'); close(); } }, 'اختيار مجلد موجود'),
          h('button', { class: 'btn block', onclick: () => { done = true; resolve('create'); close(); } }, 'إنشاء مجلد جديد'),
        ),
      ]);
      const obs = new MutationObserver(() => { if (!document.querySelector('.scrim')) { if (!done) resolve(null); obs.disconnect(); } });
      obs.observe(document.body, { childList: true });
    });
    try {
      if (choice === 'pick') { const f = await pickFolder(); if (f) toast(`تم اختيار "${f.name}"`); }
      if (choice === 'create') { const f = await createFolder('بناء البيت'); toast(`تم إنشاء "${f.name}". شاركه الآن مع الطرف الآخر من Drive.`); }
      await flushUploads(true);
    } catch (e) { toast((e as Error).message); }
    rerender();
  };

  const uploadNow = async () => {
    try { await getToken(true); await flushUploads(true); toast('تم رفع الملفات'); } catch (e) { toast((e as Error).message); }
    rerender();
  };

  const editProject = () => go('/edit/project');

  const exportJson = () => {
    const data: Record<string, unknown> = { exported_at: new Date().toISOString(), members: store.members };
    for (const t of ['projects', 'payers', 'vendors', 'commitments', 'milestones', 'variations', 'payments', 'documents', 'document_links'] as TableName[]) data[t] = store.all(t, { includeDeleted: true });
    download(`bina-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
  };
  const exportCsv = () => {
    const rows = [['date', 'vendor', 'commitment', 'amount_bd', 'method', 'paid_by', 'ref_no', 'has_proof']];
    const links = store.all('document_links');
    for (const p of store.all('payments').sort((a, b) => a.date.localeCompare(b.date))) {
      const c = store.get('commitments', p.commitment_id);
      rows.push([p.date, vendorName(c?.vendor_id), c?.title ?? '', (p.amount / 1000).toFixed(3), p.method,
        store.get('payers', p.payer_id)?.name ?? '', p.ref_no ?? '', links.some((l) => l.entity_type === 'payment' && l.entity_id === p.id) ? 'yes' : 'no']);
    }
    const csv = '\ufeff' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`bina-payments-${today()}.csv`, csv, 'text/csv');
  };

  const signOut = async () => {
    if (!(await confirmDialog({ title: 'تسجيل الخروج؟', body: store.pendingCount ? `هناك ${store.pendingCount} تعديل لم يُزامن بعد وسيُفقد.` : 'ستحتاج رابط دخول جديد.', ok: 'تسجيل الخروج', danger: true }))) return;
    await store.resetLocal();
    await supabase?.auth.signOut();
    location.hash = '/';
    location.reload();
  };

  return {
    top: topbar('الإعدادات', { back: '/' }),
    body: [
      h('div', { style: 'margin:0 2px' }, syncStatus()),
      ...store.conflicts.map(conflictCard),
      store.syncErrors.length ? alertBox('danger', [h('strong', null, 'تعذّر حفظ بعض التعديلات'), h('div', { class: 'small num' }, store.syncErrors.slice(0, 3).join(' | '))]) : null,

      section('الحساب', h('ul', { class: 'list panel' },
        actionRow('user', store.myName(), DEMO ? 'وضع تجريبي' : store.email, editName),
        h('li', null, h('div', { class: 'row' }, h('span', { class: 'lead-icon' }, icon('user')),
          h('div', { class: 'main' }, h('span', { class: 'title' }, 'أعضاء المشروع'), h('span', { class: 'meta' }, store.members.map((m) => m.display_name).join('، '))))),
        DEMO ? null : actionRow('close', 'تسجيل الخروج', null, signOut),
      )),

      section('المشروع', h('ul', { class: 'list panel' },
        actionRow('building', project?.name ?? 'المشروع', `احتياطي ${project?.contingency_pct ?? 10}%${project?.plot_no ? ` · قطعة ${project.plot_no}` : ''}`, editProject),
        linkRow('#/payers', 'pay', 'من يدفع', store.payers().map((p) => p.name).join('، ')),
      )),

      section('المستندات والقراءة الذكية', h('ul', { class: 'list panel' },
        actionRow('key', 'مفتاح Claude API', getApiKey() ? 'مُضاف على هذا الجهاز' : 'غير مُضاف — القراءة الذكية معطلة', editKey),
        DEMO ? h('li', null, h('div', { class: 'row' }, h('span', { class: 'lead-icon' }, icon('folder')), h('div', { class: 'main' }, h('span', { class: 'title' }, 'Google Drive'), h('span', { class: 'meta' }, 'غير متاح في الوضع التجريبي. الملفات تُحفظ على هذا الجهاز.'))))
          : !DRIVE_ENABLED ? h('li', null, h('div', { class: 'row' }, h('span', { class: 'lead-icon warn' }, icon('folder')), h('div', { class: 'main' }, h('span', { class: 'title' }, 'Google Drive غير مُعد'), h('span', { class: 'meta' }, 'أضف VITE_GOOGLE_CLIENT_ID عند البناء'))))
          : actionRow('folder', 'مجلد Google Drive', folder ? `${folder.name}${hasValidToken() ? ' · متصل' : ''}` : 'لم يُختر بعد', driveSetup),
        pendingUploads ? actionRow('upload', `${pendingUploads} ملف بانتظار الرفع`, uploadError ?? 'اضغط للرفع الآن', uploadNow) : null,
      )),

      section('السجل والأمان', h('ul', { class: 'list panel' },
        linkRow('#/activity', 'activity', 'آخر النشاطات'),
        linkRow('#/trash', 'trash', 'سلة المحذوفات', 'تُمسح نهائياً بعد 30 يوماً'),
        actionRow('download', 'نسخة احتياطية JSON', 'كل البيانات بما فيها المحذوفة', exportJson),
        actionRow('download', 'تصدير الدفعات CSV', 'يفتح في Excel', exportCsv),
        DEMO ? null : actionRow('sync', 'مزامنة الآن', store.pendingCount ? `${store.pendingCount} تعديل معلّق` : null, async () => { await store.refresh(); await store.flush(); toast('تمت المزامنة'); }),
      )),
      h('p', { class: 'small muted', style: 'text-align:center;margin-top:24px' }, 'بناء البيت · الإصدار 1.0'),
    ],
    live: true,
  };
});

function download(name: string, content: string, mime: string) {
  const a = h('a', { href: URL.createObjectURL(new Blob([content], { type: mime })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

function conflictCard(c: Conflict): HTMLElement {
  const ignore = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'project_id', 'id']);
  const keys = [...new Set([...Object.keys(c.mine), ...Object.keys(c.theirs)])].filter((k) => !ignore.has(k) && JSON.stringify(c.mine[k]) !== JSON.stringify(c.theirs[k]));
  const fmt = (k: string, v: unknown) => (v === null || v === undefined || v === '' ? '—' : /amount|retention_held/.test(k) ? formatBD(Number(v)) : String(v));
  const who = store.memberName(String(c.theirs.updated_by ?? ''));
  return alertBox('danger', [
    h('strong', null, `تعارض في ${ENTITY[c.table.replace(/s$/, '') as keyof typeof ENTITY] ?? 'سجل'}: ${String(c.theirs.title ?? c.theirs.name ?? '')}`),
    h('div', { class: 'small' }, `${who} عدّله قبل أن تُحفظ نسختك.`),
    h('div', { class: 'diff', style: 'margin-top:8px' },
      h('span', { class: 'h' }, 'الحقل'), h('span', { class: 'h' }, 'نسختك'), h('span', { class: 'h' }, `نسخة ${who}`),
      ...keys.flatMap((k) => [h('span', null, FIELD[k] ?? k), h('span', { class: 'changed' }, fmt(k, c.mine[k])), h('span', null, fmt(k, c.theirs[k]))]),
    ),
  ], [
    h('button', { class: 'btn sm primary', onclick: () => { store.resolveConflict(c, 'mine'); toast('تم حفظ نسختك'); } }, 'احتفظ بنسختي'),
    h('button', { class: 'btn sm', onclick: () => { store.resolveConflict(c, 'theirs'); toast(`تم اعتماد نسخة ${who}`); } }, `اعتمد نسخة ${who}`),
  ]);
}

route('/edit/project', (): Screen => {
  const p = store.project();
  const name = textField('اسم المشروع', p?.name ?? '');
  const plot = textField('رقم القطعة', p?.plot_no ?? '', { ltr: true });
  const loc = textField('الموقع', p?.location ?? '');
  const cont = textField('نسبة الاحتياطي %', String(p?.contingency_pct ?? 10), { ltr: true, hint: 'تُحسب من المبالغ المتبقية غير المدفوعة' });
  const save = () => {
    const pctVal = Number(cont.get());
    if (!Number.isFinite(pctVal) || pctVal < 0 || pctVal > 100) { cont.setError('اكتب رقماً بين 0 و 100'); return; }
    if (!name.get()) { name.setError('اكتب الاسم'); return; }
    store.save('projects', { id: store.projectId!, name: name.get(), plot_no: plot.get() || null, location: loc.get() || null, contingency_pct: pctVal });
    toast('تم الحفظ');
    history.back();
  };
  return {
    top: topbar('المشروع', { back: true }),
    body: h('div', { class: 'stack' }, name.el, h('div', { class: 'grid2' }, plot.el, loc.el), cont.el),
    footer: formFooter('حفظ', save),
    form: true,
  };
});

route('/payers', (): Screen => {
  const add = () => {
    const f = textField('الاسم', '');
    openSheet((close) => [h('h2', null, 'إضافة دافع'), f.el, h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn primary block', onclick: () => { if (!f.get()) return; store.save('payers', { name: f.get(), user_id: null }); close(); } }, 'إضافة'))]);
  };
  const rename = (id: string, current: string) => {
    const f = textField('الاسم', current);
    openSheet((close) => [h('h2', null, 'تعديل الاسم'), f.el, h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn primary block', onclick: () => { if (!f.get()) return; store.save('payers', { id, name: f.get() }); close(); } }, 'حفظ'))]);
  };
  const payments = store.all('payments');
  return {
    top: topbar('من يدفع', { back: true }),
    body: [
      h('p', { class: 'muted small', style: 'margin:4px 2px 12px' }, 'كل دفعة تُسجل باسم من دفعها. أضف غيركما إن ساهم أحد آخر.'),
      h('ul', { class: 'list panel' }, ...store.payers().map((p) => {
        const used = payments.filter((x) => x.payer_id === p.id).length;
        return h('li', null, h('div', { class: 'row' },
          h('div', { class: 'main' }, h('span', { class: 'title' }, p.name), h('span', { class: 'meta' }, `${used} دفعة${p.user_id ? ' · حساب مرتبط' : ''}`)),
          h('button', { class: 'btn sm', onclick: () => rename(p.id, p.name) }, 'تعديل'),
          !used && !p.user_id ? h('button', { class: 'btn sm danger', onclick: () => { store.softDelete('payers', p.id); toast('تم الحذف', { label: 'تراجع', run: () => store.restore('payers', p.id) }); } }, 'حذف') : null,
        ));
      })),
      h('div', { class: 'actions-row' }, h('button', { class: 'btn', onclick: add }, icon('plus'), 'إضافة دافع')),
    ],
    live: true,
  };
});

route('/activity', (): Screen => {
  const entries = store.audit
    .filter((a) => a.entity_type !== 'hb_ai_corrections' && !(a.entity_type === 'hb_document_links' && a.action === 'update'))
    .slice(0, 200);
  setTimeout(markActivitySeen, 0);
  return {
    top: topbar('آخر النشاطات', { back: true }),
    body: [h('div', { class: 'panel', style: 'margin-top:8px' }, activityList(entries))],
    live: true,
  };
});

const TRASH_TABLES: TableName[] = ['vendors', 'commitments', 'payments', 'milestones', 'variations', 'documents', 'payers'];
const TRASH_ENTITY: Record<string, keyof typeof ENTITY> = {
  vendors: 'vendor', commitments: 'commitment', payments: 'payment', milestones: 'milestone', variations: 'variation', documents: 'document', payers: 'payer',
};

route('/trash', (): Screen => {
  const items = TRASH_TABLES.flatMap((t) => store.all(t, { includeDeleted: true }).filter((r) => r.deleted_at).map((r) => ({ t, r })))
    .sort((a, b) => String(b.r.deleted_at).localeCompare(String(a.r.deleted_at)));
  // children deleted together with a parent are restored with it; show only top-level deletions
  const parentTs = new Set(items.filter((i) => i.t === 'commitments' || i.t === 'vendors').map((i) => i.r.deleted_at));
  const visible = items.filter((i) => i.t === 'commitments' || i.t === 'vendors' || !parentTs.has(i.r.deleted_at));

  const label = (t: TableName, r: Record<string, unknown>) => {
    if (t === 'payments') {
      const c = store.get('commitments', String(r.commitment_id));
      return `${formatBD(Number(r.amount))} · ${vendorName(c?.vendor_id)} · ${fmtDate(String(r.date))}`;
    }
    return String(r.title ?? r.name ?? '');
  };
  const daysLeft = (ts: string) => Math.max(0, 30 - Math.floor((Date.now() - new Date(ts).getTime()) / 86400000));

  return {
    top: topbar('سلة المحذوفات', { back: true }),
    body: [
      h('p', { class: 'muted small', style: 'margin:4px 2px 12px' }, 'استرجاع أي عنصر يعيد كل الأرقام كما كانت. حذف عقد أو جهة يحذف دفعاتها معها ويسترجعها معها.'),
      visible.length ? h('ul', { class: 'list panel' }, ...visible.map(({ t, r }) => h('li', null, h('div', { class: 'row' },
        h('div', { class: 'main' },
          h('span', { class: 'meta' }, ENTITY[TRASH_ENTITY[t]]),
          h('span', { class: 'title' }, label(t, r as unknown as Record<string, unknown>)),
          h('span', { class: 'meta' }, `حذفه ${store.memberName(r.updated_by)} ${fmtWhen(r.deleted_at!)} · يُمسح بعد ${daysLeft(r.deleted_at!)} يوماً`),
        ),
        h('button', { class: 'btn sm primary', onclick: () => { store.restore(t, r.id); toast('تم الاسترجاع'); } }, 'استرجاع'),
      )))) : h('div', { class: 'panel' }, empty('السلة فارغة.')),
    ],
    live: true,
  };
});

route('/history/:table/:id', async ({ table, id }): Promise<Screen> => {
  const t = table as TableName;
  let entries: Awaited<ReturnType<typeof store.history>> = [];
  let error: string | null = null;
  try { entries = await store.history(t, id); } catch (e) { error = (e as Error).message; }
  const ignore = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'project_id', 'id']);
  const fmt = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    if (/amount|retention_held/.test(k)) return formatBD(Number(v));
    if (k === 'vendor_id') return vendorName(String(v));
    if (k === 'payer_id') return store.get('payers', String(v))?.name ?? String(v);
    if (k === 'commitment_id') return store.get('commitments', String(v))?.title ?? String(v);
    if (k === 'milestone_id') return store.get('milestones', String(v))?.title ?? String(v);
    if (k === 'deleted_at') return 'نعم';
    if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
    return String(v);
  };

  const card = (a: (typeof entries)[number]) => {
    const before = a.before ?? {};
    const after = a.after ?? {};
    const changed = a.action === 'update'
      ? Object.keys(after).filter((k) => !ignore.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      : [];
    const actionText = { insert: 'أنشأ السجل', update: 'عدّل', delete: 'حذف', restore: 'استرجع', purge: 'مسح نهائياً' }[a.action];
    return h('li', null, h('div', { class: 'pad' },
      h('div', { style: 'display:flex;justify-content:space-between;gap:8px' },
        h('strong', null, `${store.memberName(a.user_id)} ${actionText}`), h('span', { class: 'small muted' }, fmtWhen(a.at))),
      changed.length ? h('div', { class: 'diff', style: 'margin-top:8px' },
        h('span', { class: 'h' }, 'الحقل'), h('span', { class: 'h' }, 'قبل'), h('span', { class: 'h' }, 'بعد'),
        ...changed.flatMap((k) => [h('span', null, FIELD[k] ?? k), h('span', null, fmt(k, before[k])), h('span', { class: 'changed' }, fmt(k, after[k]))]),
      ) : null,
      a.action === 'update' && changed.length ? h('button', { class: 'btn sm', style: 'margin-top:10px', onclick: async () => {
        if (!(await confirmDialog({ title: 'استرجاع هذه القيمة؟', body: 'يرجع السجل إلى ما كان عليه قبل هذا التعديل. يُسجَّل الاسترجاع كتعديل جديد.', ok: 'استرجاع' }))) return;
        const current = store.get(t, id) as unknown as Record<string, unknown> | undefined;
        const patch: Record<string, unknown> = { ...(current ?? {}) };
        changed.forEach((k) => { patch[k] = before[k]; });
        store.restoreValues(t, id, patch);
        toast('تم الاسترجاع');
        rerender();
      } }, icon('history'), 'استرجاع هذه القيمة') : null,
    ));
  };

  return {
    top: topbar('سجل التعديلات', { back: true }),
    body: [
      error ? alertBox('danger', [error]) : null,
      !DEMO && !store.online ? alertBox('info', ['بدون اتصال: يظهر السجل المحفوظ على الجهاز فقط.']) : null,
      entries.length ? h('ul', { class: 'list panel', style: 'margin-top:8px' }, ...entries.filter((e) => e.entity_type === dbTable(t)).map(card)) : h('div', { class: 'panel', style: 'margin-top:8px' }, empty('لا يوجد سجل بعد.')),
    ].filter(Boolean) as HTMLElement[],
  };
});
