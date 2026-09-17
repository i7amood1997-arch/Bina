import './styles.css';
import { startRouter } from './app';
import { DEMO } from './config';
import { store } from './db/store';
import { supabase } from './db/supabase';
import { flushUploads } from './documents';
import { renderBoot, renderLogin, renderNotMember } from './screens/login';
import { h } from './ui/dom';
import { alertBox } from './ui/components';

// screens register their routes on import
import './screens/home';
import './screens/vendors';
import './screens/commitments';
import './screens/payments';
import './screens/documents';
import './screens/capture';
import './screens/summary';
import './screens/settings';

const root = document.getElementById('app')!;
let started = false;

async function start(userId: string, email: string) {
  if (started) return;
  started = true;
  renderBoot(root, 'تحميل البيانات…');
  await store.init(userId, email);
  if (store.state === 'not_member') {
    renderNotMember(root, async () => { await store.resetLocal(); await supabase?.auth.signOut(); location.reload(); });
    return;
  }
  if (store.state === 'error') {
    root.innerHTML = '';
    root.append(h('div', { class: 'login' }, alertBox('danger', ['تعذر تحميل البيانات. تحقق من الاتصال ثم أعد المحاولة.'],
      [h('button', { class: 'btn sm', onclick: () => location.reload() }, 'إعادة المحاولة')])));
    return;
  }
  startRouter();
  void flushUploads();
}

async function boot() {
  if (DEMO) (window as unknown as { __bina: typeof store }).__bina = store; // for local testing only
  renderBoot(root);
  if (DEMO) { await start('demo-user', 'demo@local'); return; }
  const client = supabase!;
  const { data } = await client.auth.getSession();
  if (data.session) {
    await start(data.session.user.id, data.session.user.email ?? '');
  } else {
    renderLogin(root);
  }
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session && !started) {
      history.replaceState(null, '', location.pathname + '#/');
      void start(session.user.id, session.user.email ?? '');
    }
    if (event === 'SIGNED_OUT') location.reload();
  });
}

void boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
  });
}
