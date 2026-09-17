import { route, type Screen } from '../app';
import { store } from '../db/store';
import { byCategory, byMonth, byPayer, projectFigures } from '../engine';
import { fmtMonth, today } from '../dates';
import { formatBD, formatBDShort, pct } from '../money';
import { CATEGORY } from '../strings';
import { h, money } from '../ui/dom';
import { empty, topbar } from '../ui/components';

route('/summary', (): Screen => {
  const snap = store.snapshot();
  const f = projectFigures(snap);
  const cats = byCategory(snap).filter((c) => c.forecast > 0 || c.paid > 0);
  const maxCat = Math.max(1, ...cats.map((c) => c.forecast));
  const payers = byPayer(snap.payments);
  const months = byMonth(snap.payments, today(), 12);
  const peak = Math.max(0, ...months.map((m) => m.total));
  const maxMonth = Math.max(1, peak);

  return {
    top: topbar('الملخص'),
    body: [
      h('dl', { class: 'figures', style: 'margin-top:8px' },
        h('div', null, h('dt', null, 'المدفوع'), h('dd', null, money(formatBD(f.paid)))),
        h('div', null, h('dt', null, 'نسبة الإنجاز المالي'), h('dd', null, h('span', { class: 'num' }, pct(f.progress)))),
        h('div', null, h('dt', null, 'الالتزامات'), h('dd', null, money(formatBD(f.committed)))),
        h('div', null, h('dt', null, 'الاحتياطي'), h('dd', null, money(formatBD(f.contingency)))),
        h('div', { class: 'wide' }, h('dt', null, 'التكلفة المتوقعة'), h('dd', null, money(formatBD(f.forecast)))),
      ),

      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, 'حسب الفئة'), h('span', { class: 'small muted' }, 'المدفوع من المتوقع')),
        cats.length ? h('div', { class: 'panel pad bars' }, ...cats.map((c) => h('div', { class: 'b' },
          h('div', { class: 'top' }, h('span', null, CATEGORY[c.category]), h('span', null, money(formatBDShort(c.paid)), h('span', { class: 'muted' }, ' / '), money(formatBDShort(c.forecast)))),
          h('div', { class: 'bar thin', style: `width:${Math.max(4, (c.forecast / maxCat) * 100)}%`, role: 'img', 'aria-label': `${CATEGORY[c.category]}: مدفوع ${formatBD(c.paid)} من ${formatBD(c.forecast)}` },
            h('span', { class: 'paid', style: `width:${c.forecast ? Math.min(100, (c.paid / c.forecast) * 100) : 0}%` })),
        ))) : h('div', { class: 'panel' }, empty('لا توجد بيانات بعد.')),
      ),

      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, 'حسب من دفع')),
        h('ul', { class: 'list panel' }, ...store.payers().map((p) => {
          const v = payers.get(p.id) ?? 0;
          return h('li', null, h('div', { class: 'row', style: 'cursor:default' },
            h('div', { class: 'main' }, h('span', { class: 'title' }, p.name), h('span', { class: 'meta' }, f.paid ? `${pct(v / f.paid)} من المدفوع` : '')),
            h('div', { class: 'end' }, money(formatBD(v))),
          ));
        })),
      ),

      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, 'المصروف الشهري'), h('span', { class: 'small muted' }, 'آخر 12 شهراً')),
        h('div', { class: 'panel pad' },
          h('div', { class: 'month-chart', role: 'img', 'aria-label': months.map((m) => `${fmtMonth(m.month)}: ${formatBD(m.total)}`).join('، ') },
            ...months.map((m) => h('div', { class: 'col', title: `${fmtMonth(m.month)}: ${formatBD(m.total)}` },
              h('span', { class: 'v', style: `height:${(m.total / maxMonth) * 100}%` }),
              h('small', null, m.month.slice(5)),
            )),
          ),
          h('p', { class: 'small muted', style: 'margin:10px 0 0' }, `أعلى شهر: ${formatBD(peak)}`),
        ),
      ),
    ],
    tab: 'summary',
    live: true,
  };
});
