// DUM Celular (m/): o DUM Master no bolso, só para ver. Fluxo:
//   sem aparelho → "ainda não ligado"   ·   #/parear/<código> → nome + PIN + digital
//   aparelho sem sessão → bloqueio (digital ou PIN)   ·   sessão → telas (Hoje, No ar, Dinheiro, Projetos, Clientes)
// Bloqueia sozinho depois de 5 min fora da tela. Atualiza a cada minuto com a tela aberta.

import { html, setHtml, $, $$ } from '../shared/utils/dom.js';
import { formatRelative } from '../shared/utils/format.js';
import { icon } from '../shared/components/icons.js';
import { api, isConfigured } from './api.js';
import {
  loadDevice, forgetDevice, getSession, clearSession, pushSupported, pushIntent, setPushIntent,
  currentSubscription, subscribe, unsubscribe, subscriptionPayload,
} from './device.js';
import { buildModel, health, phoneRoute } from './model.js';
import { welcomeScreen, pairScreen, lockScreen } from './entry.js';
import today from './views/today.js';
import live from './views/live.js';
import money from './views/money.js';
import projects, { proposals } from './views/projects.js';
import customers from './views/customers.js';
import inbox from './views/inbox.js';
import settings, { ready } from './views/settings.js';

const LOCK_AFTER = 5 * 60e3;
const REFRESH_EVERY = 60e3;

/** @type {Record<string, any>} */
const VIEWS = { hoje: today, 'no-ar': live, dinheiro: money, projetos: projects, propostas: proposals, clientes: customers, avisos: inbox, ajustes: settings, pronto: ready };

/** @type {{ id: string, label: string, icon: import('../shared/components/icons.js').IconName, can: (m: import('./model.js').Model) => boolean }[]} */
const TABS = [
  { id: 'hoje', label: 'Hoje', icon: 'home', can: (m) => m.can('dashboard.view') },
  { id: 'no-ar', label: 'No ar', icon: 'globe', can: (m) => m.can('infra.view') || m.can('products.view') },
  { id: 'dinheiro', label: 'Dinheiro', icon: 'wallet', can: (m) => Boolean(m.money) },
  { id: 'projetos', label: 'Projetos', icon: 'package', can: (m) => m.can('products.view') },
  { id: 'clientes', label: 'Clientes', icon: 'users', can: (m) => m.can('customers.view') },
];
const TAB_OF = /** @type {Record<string, string>} */ ({ propostas: 'projetos' });

const root = /** @type {HTMLElement} */ (document.getElementById('app'));
/** @type {import('./model.js').Model | null} */
let model = null;
let loadedAt = 0;
let hiddenAt = 0;
let timer = 0;
let lastHash = '';
/** @type {any} */
let installPrompt = null;

const parse = () => {
  const [path, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { path: path || 'hoje', id: rest.length ? decodeURIComponent(rest.join('/')) : null };
};

// Recados rápidos ---------------------------------------------------------------------------------
/** @param {string} text @param {'ok' | 'error'} [kind] */
function toast(text, kind = 'ok') {
  document.querySelector('.m-toast')?.remove();
  const el = document.createElement('div');
  el.className = `m-toast m-toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 3600);
}

/** Confirmação no padrão do sistema (dialog nativo, sem biblioteca). @param {string} title @param {string} text */
function confirmBox(title, text) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'm-dialog';
    setHtml(d, html`<form method="dialog"><h2>${title}</h2><p>${text}</p>
      <div class="m-dialog__actions"><button class="m-btn" value="no">Cancelar</button><button class="m-btn m-btn--danger" value="yes">Desligar</button></div></form>`);
    d.addEventListener('close', () => {
      resolve(d.returnValue === 'yes');
      d.remove();
    });
    document.body.append(d);
    d.showModal();
  });
}

// Avisos (push) -----------------------------------------------------------------------------------
const pushCtx = {
  async enablePush() {
    if (!model?.vapid) throw new Error('O servidor ainda não tem as chaves dos avisos. Tente de novo em instantes.');
    const sub = await subscribe(model.vapid);
    const r = await api('push-set', { session: getSession(), push: subscriptionPayload(sub), prefs: model.device?.prefs ?? {} });
    setPushIntent('on');
    model.device = { ...model.device, push: true, endpoint: sub.endpoint, prefs: r.prefs };
  },
  async disablePush() {
    await unsubscribe().catch(() => null);
    const r = await api('push-set', { session: getSession(), push: null, prefs: model?.device?.prefs ?? {} });
    setPushIntent('off');
    if (model) model.device = { ...model.device, push: false, endpoint: null, prefs: r.prefs };
  },
  /** @param {Record<string, unknown>} prefs */
  async savePrefs(prefs) {
    const sub = model?.device?.push ? await currentSubscription() : null;
    const r = await api('push-set', { session: getSession(), push: sub ? subscriptionPayload(sub) : null, prefs });
    if (model) model.device = { ...model.device, prefs: r.prefs, push: Boolean(sub) };
  },
  async testPush() {
    const sub = await currentSubscription();
    if (!sub) throw new Error('Ligue os avisos antes de testar.');
    await api('push-test', { session: getSession(), push: subscriptionPayload(sub) });
  },
};

/** Quem escolheu receber avisos continua recebendo, mesmo se o Chrome trocou a inscrição. */
async function syncPush() {
  if (!model?.vapid || !pushSupported() || pushIntent() !== 'on' || Notification.permission !== 'granted') return;
  try {
    const sub = await currentSubscription();
    if (sub && model.device?.endpoint === sub.endpoint) return;
    await pushCtx.enablePush();
  } catch {
    /* tenta de novo na próxima atualização */
  }
}

// Ciclo de vida -----------------------------------------------------------------------------------
const ctx = {
  ...pushCtx,
  toast,
  confirm: confirmBox,
  rerender: () => drawApp(true),
  lock: () => lockNow(),
  async forget() {
    await api('forget', { session: getSession() }).catch(() => null);
    await unsubscribe().catch(() => null);
    forgetDevice();
    model = null;
    welcomeScreen(root, 'forgot');
  },
  canInstall: () => Boolean(installPrompt),
  standalone: () => matchMedia('(display-mode: standalone)').matches,
  async install() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
  },
};

function lockNow() {
  const s = getSession();
  if (s) api('lock', { session: s }).catch(() => null);
  clearSession();
  model = null;
  start();
}

async function load() {
  try {
    model = buildModel(await api('snapshot', { session: getSession() }));
    loadedAt = Date.now();
    syncPush();
    return true;
  } catch (e) {
    const code = /** @type {any} */ (e).code;
    if (code === 'locked') {
      clearSession();
      model = null;
      start();
      return false;
    }
    if (code === 'revoked') {
      forgetDevice();
      model = null;
      welcomeScreen(root, 'revoked');
      return false;
    }
    if (!model) {
      setHtml(root, html`<main class="m-entry"><h1 class="m-entry__title">Não abriu agora</h1>
        <p class="m-entry__text">${e instanceof Error ? e.message : 'O servidor não respondeu.'}</p>
        <button type="button" class="m-btn m-btn--primary m-btn--block" data-retry>Tentar de novo</button></main>`);
      $('[data-retry]', root)?.addEventListener('click', () => start());
    } else {
      toast(e instanceof Error ? e.message : 'Não atualizou.', 'error');
    }
    return false;
  }
}

async function refresh() {
  if (!model || !getSession()) return;
  if (await load()) drawApp(true);
}

function schedule() {
  clearInterval(timer);
  timer = window.setInterval(() => {
    if (!document.hidden) refresh();
  }, REFRESH_EVERY);
}

/** A barra do status do Android acompanha o fundo do app (claro ou escuro). */
function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  for (const meta of $$('meta[name="theme-color"]')) meta.setAttribute('content', bg || '#0f1419');
}

/** @param {boolean} [keepScroll] */
function drawApp(keepScroll = false) {
  if (!model) return;
  const m = model;
  const route = parse();
  const view = VIEWS[route.path] ?? VIEWS.hoje;
  const back = view.back?.(m, route) ?? null;
  const unread = m.notifications.filter((n) => !n.readAt).length;
  const tab = TAB_OF[route.path] ?? route.path;
  const y = window.scrollY;
  setHtml(root, html`<div class="m-app" data-health="${health(m)}">
    <header class="m-bar">
      ${back ? html`<a class="m-bar__btn m-bar__back" href="${back}" aria-label="Voltar">${icon('arrowLeft')}</a>` : ''}
      <div class="m-bar__titles"><span class="m-bar__org">${m.org.name}</span><h1 class="m-bar__title">${view.title(m, route)}</h1></div>
      <button type="button" class="m-bar__btn" data-refresh aria-label="Atualizar">${icon('refresh')}</button>
      <a class="m-bar__btn" href="#/avisos" aria-label="Avisos${unread ? `: ${unread} não lidos` : ''}">${icon('bell')}${unread ? html`<span class="m-bar__badge">${unread > 9 ? '9+' : unread}</span>` : ''}</a>
      <a class="m-bar__btn" href="#/ajustes" aria-label="Ajustes deste celular">${icon('settings')}</a>
    </header>
    <main class="m-main">${view.render(m, route, ctx)}
      <p class="m-updated">Atualizado ${formatRelative(m.generatedAt)}</p></main>
    <nav class="m-tabs" aria-label="Telas">${TABS.filter((t) => t.can(m)).map((t) => html`<a class="m-tab ${t.id === tab ? 'is-active' : ''}" href="#/${t.id}" ${t.id === tab ? html`aria-current="page"` : ''}>${icon(t.icon)}<span>${t.label}</span></a>`)}</nav>
  </div>`);
  for (const el of $$('[data-w]', root)) el.style.setProperty('--w', `${Math.max(0, Math.min(100, Number(el.dataset.w) || 0))}%`);
  const main = /** @type {HTMLElement} */ ($('.m-main', root));
  view.mount?.(main, m, ctx);
  $('[data-refresh]', root)?.addEventListener('click', async (event) => {
    const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
    button.classList.add('is-spinning');
    await refresh();
  });
  window.scrollTo(0, keepScroll && lastHash === location.hash ? y : 0);
  lastHash = location.hash;
  syncThemeColor();
}

async function start() {
  if (!isConfigured()) return welcomeScreen(root, 'config');
  const route = parse();
  if (route.path === 'ir') {
    location.replace(phoneRoute(route.id));
    return;
  }
  if (route.path === 'parear' && route.id) {
    return pairScreen(root, route.id, () => {
      history.replaceState(null, '', '#/pronto');
      start();
    });
  }
  const device = loadDevice();
  if (!device) return welcomeScreen(root, 'new');
  if (!getSession()) {
    model = null;
    return lockScreen(root, device, { unlocked: () => start(), revoked: () => (forgetDevice(), welcomeScreen(root, 'revoked')) });
  }
  if (!model && !(await load())) return;
  drawApp();
  schedule();
}

// Liga tudo ---------------------------------------------------------------------------------------
window.addEventListener('hashchange', () => (model && getSession() && parse().path !== 'parear' && parse().path !== 'ir' ? drawApp() : start()));
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  if (getSession() && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER) return lockNow();
  if (model && Date.now() - loadedAt > 30e3) refresh();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!localStorage.getItem('dum.theme')) document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  syncThemeColor();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => null);
  // Toque num aviso com o app aberto: o sw.js manda a tela certa.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'open') location.hash = phoneRoute(event.data.link);
  });
}

start();
