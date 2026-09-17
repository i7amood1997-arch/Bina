import { store } from './db/store';
import { local } from './config';
import { h, clear } from './ui/dom';
import { icon, type IconName } from './ui/icons';
import { openSheet } from './ui/components';

export type Tab = 'home' | 'vendors' | 'docs' | 'summary';

export interface Screen {
  top: HTMLElement;
  body: HTMLElement | (HTMLElement | null)[];
  footer?: HTMLElement;
  tab?: Tab;
  form?: boolean;
  /** Re-render when data changes (list/detail screens). Forms must not be live. */
  live?: boolean;
}
export type ScreenFn = (params: Record<string, string>, query: URLSearchParams) => Screen | Promise<Screen>;

interface Route { pattern: RegExp; keys: string[]; fn: ScreenFn; }
const routes: Route[] = [];

export function route(path: string, fn: ScreenFn) {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replace(/:([a-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ pattern, keys, fn });
}

export const go = (path: string) => { location.hash = path; };

let current: { route: Route; params: Record<string, string>; query: URLSearchParams } | null = null;
let renderSeq = 0;
let liveTimer: number | undefined;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs ?? '') };
}

async function render(keepScroll = false) {
  const { path, query } = parseHash();
  const match = routes.map((r) => ({ r, m: path.match(r.pattern) })).find((x) => x.m);
  const app = document.getElementById('app')!;
  if (!match) { go('/'); return; }
  const params: Record<string, string> = {};
  match.r.keys.forEach((k, i) => (params[k] = decodeURIComponent(match.m![i + 1])));
  current = { route: match.r, params, query };
  const seq = ++renderSeq;
  const scrollY = window.scrollY;
  let screen: Screen;
  try {
    screen = await match.r.fn(params, query);
  } catch (e) {
    console.error(e);
    screen = { top: h('header', { class: 'topbar' }, h('h1', null, 'حدث خطأ')), body: h('div', { class: 'empty' }, String((e as Error).message ?? e)) };
  }
  if (seq !== renderSeq) return;
  clear(app);
  const main = h('main', { class: `view ${screen.form ? 'form-view' : ''}`, id: 'main' });
  (Array.isArray(screen.body) ? screen.body : [screen.body]).forEach((b) => { if (b) main.append(b); });
  app.append(screen.top, main);
  if (screen.footer) app.append(screen.footer);
  if (!screen.form) app.append(fab(), nav(screen.tab));
  (app as HTMLElement & { _live?: boolean })._live = !!screen.live;
  if (keepScroll) window.scrollTo(0, scrollY);
  else window.scrollTo(0, 0);
}

function nav(tab?: Tab) {
  const unseen = unseenActivity();
  const item = (t: Tab, href: string, ic: IconName, label: string, badge = 0) =>
    h('a', { href: `#${href}`, 'aria-current': tab === t ? 'page' : undefined },
      icon(ic), label, badge ? h('span', { class: 'badge', 'aria-label': `${badge} جديد` }, String(badge)) : null);
  return h('nav', { class: 'nav', 'aria-label': 'التنقل الرئيسي' },
    item('home', '/', 'home', 'الرئيسية', unseen),
    item('vendors', '/vendors', 'vendors', 'الجهات'),
    item('docs', '/documents', 'docs', 'المستندات'),
    item('summary', '/summary', 'chart', 'الملخص'),
  );
}

function fab() {
  return h('button', { class: 'fab', onclick: openAddSheet, 'aria-haspopup': 'dialog' }, icon('plus'), 'إضافة');
}

export function openAddSheet() {
  const tile = (ic: IconName, label: string, hint: string, href: string, cls = '') =>
    h('button', { class: cls, onclick: () => go(href) }, icon(ic), h('span', null, label, h('small', null, hint)));
  openSheet(() => [
    h('h2', null, 'ماذا تريد أن تضيف؟'),
    h('div', { class: 'add-grid' },
      tile('camera', 'صوّر مستند', 'سند أو فاتورة أو عقد، والتطبيق يقرأ البيانات', '/capture', 'primary-tile'),
      tile('pay', 'دفعة', 'على عقد أو شراء مسجّل', '/add/payment'),
      tile('cart', 'شراء مباشر', 'دفعة واحدة أو عربون', '/add/purchase'),
      tile('contract', 'عقد جديد', 'بقيمة ومراحل دفع', '/add/contract'),
      tile('estimate', 'بند متوقع', 'تكلفة لم تُشترَ بعد', '/add/estimate'),
      tile('change', 'أمر تغيير', 'إضافة أو خصم على عقد', '/add/variation'),
      tile('building', 'جهة', 'مقاول، مورد، مكتب…', '/add/vendor'),
    ),
  ], { label: 'إضافة' });
}

export function unseenActivity(): number {
  const seen = local.get(`activitySeen.${store.userId}`) ?? '';
  return store.audit.filter((a) => a.user_id && a.user_id !== store.userId && a.at > seen && a.entity_type !== 'hb_ai_corrections').length;
}
export function markActivitySeen() {
  local.set(`activitySeen.${store.userId}`, new Date().toISOString());
}

export function startRouter() {
  window.addEventListener('hashchange', () => void render());
  store.subscribe(() => {
    const app = document.getElementById('app') as HTMLElement & { _live?: boolean };
    if (!app?._live || document.querySelector('.scrim')) return;
    clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => void render(true), 120);
  });
  void render();
}

export function rerender() { void render(true); }
export function currentRoute() { return current; }
