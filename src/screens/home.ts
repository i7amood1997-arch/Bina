import { route, type Screen } from '../app';
import { store } from '../db/store';
import { milestoneStatus, paymentsWithoutProof, projectFigures } from '../engine';
import { today } from '../dates';
import { formatBD, pct } from '../money';
import { h, money } from '../ui/dom';
import { icon } from '../ui/icons';
import { iconButton, topbar } from '../ui/components';
import { activityList, syncStatus, systemAlerts, vendorName } from './common';

route('/', (): Screen => {
  const snap = store.snapshot();
  const f = projectFigures(snap);
  const project = store.project();
  const t = today();

  const share = (v: number) => (f.forecast > 0 ? `${(v / f.forecast) * 100}%` : '0%');
  const approvedRemaining = Math.max(0, f.remaining - f.estimatesTotal);

  const hero = h('section', { class: 'hero', 'aria-labelledby': 'forecast-label' },
    h('p', { class: 'label', id: 'forecast-label' }, 'التكلفة المتوقعة للبيت'),
    h('p', { class: 'big' }, money(formatBD(f.forecast, false)), h('span', { class: 'unit' }, 'BD')),
    h('div', { class: 'bar', role: 'img', 'aria-label': `مدفوع ${pct(f.progress)} من التكلفة المتوقعة` },
      h('span', { class: 'paid', style: `width:${share(f.paid)}` }),
      h('span', { class: 'remaining', style: `width:${share(approvedRemaining)}` }),
      h('span', { class: 'estimates', style: `width:${share(Math.min(f.estimatesTotal, f.remaining))}` }),
      h('span', { class: 'hatch', style: `width:${share(f.contingency)}` }),
    ),
    h('ul', { class: 'legend' },
      h('li', null, h('span', { class: 'sw paid' }), h('span', null, `مدفوع (${pct(f.progress)})`), money(formatBD(f.paid))),
      h('li', null, h('span', { class: 'sw remaining' }), h('span', null, 'متبقي على العقود والمشتريات'), money(formatBD(approvedRemaining))),
      f.estimatesTotal ? h('li', null, h('span', { class: 'sw estimates' }), h('span', null, 'بنود متوقعة لم تُشترَ'), money(formatBD(f.estimatesTotal))) : null,
      h('li', null, h('span', { class: 'sw hatch' }), h('span', null, `احتياطي ${snap.contingencyPct}%`), money(formatBD(f.contingency))),
    ),
  );

  const alerts: HTMLElement[] = [...systemAlerts()];
  const noProof = paymentsWithoutProof(snap.payments, snap.links);
  if (noProof.length) {
    alerts.push(h('a', { class: 'alert', href: '#/documents?view=missing', style: 'text-decoration:none' },
      icon('alert'),
      h('div', { class: 'body' },
        h('strong', null, `${noProof.length} ${noProof.length === 1 ? 'دفعة' : 'دفعات'} بدون سند`),
        h('div', { class: 'small' }, `بمجموع ${formatBD(noProof.reduce((a, p) => a + p.amount, 0))}. اضغط لإرفاق الإثبات.`),
      ),
    ));
  }

  const due = snap.milestones
    .filter((m) => milestoneStatus(m, snap.payments, t) === 'due')
    .map((m) => ({ m, c: store.get('commitments', m.commitment_id) }))
    .filter((x) => x.c && !x.c.deleted_at && x.c.status !== 'cancelled');

  const dueSection = due.length
    ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, 'دفعات مستحقة')),
        h('ul', { class: 'list panel' }, ...due.map(({ m, c }) => h('li', null,
          h('a', { class: 'row', href: `#/add/payment?commitment=${c!.id}&milestone=${m.id}` },
            h('span', { class: 'lead-icon warn' }, icon('pay')),
            h('div', { class: 'main' }, h('span', { class: 'title' }, m.title), h('span', { class: 'meta' }, `${vendorName(c!.vendor_id)} · ${c!.title}`)),
            h('div', { class: 'end' }, money(formatBD(m.amount)), h('span', { class: 'meta' }, 'سجّل الدفعة')),
          ),
        ))),
      )
    : null;

  const recent = store.audit.filter((a) => a.entity_type !== 'hb_ai_corrections' && a.entity_type !== 'hb_projects').slice(0, 5);

  const body = h('div', null,
    hero,
    ...alerts,
    dueSection,
    snap.commitments.length === 0 ? h('section', { class: 'section panel pad' },
      h('h2', { style: 'margin:0 0 6px;font-size:18px' }, 'ابدأ بتسجيل ما لديك'),
      h('p', { class: 'muted', style: 'margin:0 0 14px' }, 'أضف عقد المقاول ومكتب الإشراف، ثم سجّل كل دفعة مع سندها. يمكنك تصوير العقد وسيقرأ التطبيق القيمة والمراحل.'),
      h('div', { class: 'actions-row' },
        h('a', { class: 'btn primary', href: '#/capture' }, icon('camera'), 'صوّر عقداً'),
        h('a', { class: 'btn', href: '#/add/contract' }, 'أدخل عقداً يدوياً'),
      ),
    ) : null,
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, 'آخر النشاطات'), h('a', { href: '#/activity' }, 'الكل')),
      h('div', { class: 'panel' }, activityList(recent)),
    ),
  );

  return {
    top: topbar(project?.name ?? 'بناء البيت', {
      actions: [iconButton('settings', 'الإعدادات', () => (location.hash = '/settings'))],
    }),
    body: [h('div', { style: 'margin:-2px 2px 4px' }, syncStatus()), body],
    tab: 'home',
    live: true,
  };
});
