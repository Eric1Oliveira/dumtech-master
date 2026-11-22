// Inicialização: sessão → organização → casca (sidebar + topbar) → rota.

import { html, setHtml, $ } from '../shared/utils/dom.js';
import { getState } from './state.js';
import { events } from './events.js';
import { startRouter, currentRoute } from './router.js';
import { findModule } from '../modules/index.js';
import { data } from '../services/data.js';
import { isSupabaseConfigured } from '../services/supabase.js';
import { restoreSession, loadOrganizations, canDo, updatePassword, signOut, captureInviteFromUrl, acceptPendingInvite, isInviteUrl } from '../services/auth.js';
import { mountSidebar, setActiveModule } from '../shared/components/sidebar.js';
import { mountTopbar, setCrumbs } from '../shared/components/topbar.js';
import { bindCommandPaletteShortcut } from '../shared/components/command-palette.js';
import { startNotifications, stopNotifications } from '../shared/components/notification-center.js';
import { emptyState, loadError, toast, toastError } from '../shared/components/feedback.js';
import { openDialog } from '../shared/components/dialog.js';

const root = /** @type {HTMLElement} */ (document.getElementById('app'));
const APP_NAME = 'DUMTech Master';

/** @type {(() => void)[]} */
let teardown = [];
/** @type {AbortController | null} */
let view = null;
let booting = false;

async function boot() {
  if (booting) return;
  booting = true;
  teardown.forEach((fn) => fn());
  teardown = [];
  view?.abort();
  stopNotifications();
  captureInviteFromUrl();
  if (!isSupabaseConfigured()) {
    booting = false;
    setHtml(
      root,
      html`<div class="entry"><div class="entry__panel">
        <p class="brand brand--large"><span class="brand__mark">DUM</span><span class="brand__name">Master</span></p>
        <h1 class="entry__title">Falta ligar o Supabase</h1>
        <p class="entry__lead">O arquivo <code>env.js</code> não tem o endereço e a chave pública do projeto.</p>
        <ol class="steps steps--code">
          <li>Confira o <code>.env</code> (copiado do <code>.env.example</code>) com <code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code>.</li>
          <li>Rode <code>npm run env</code> para gerar o <code>env.js</code> e recarregue a página.</li>
        </ol>
      </div></div>`,
    );
    return;
  }
  try {
    const user = await restoreSession();
    if (!user) {
      const { renderLogin } = await import('../modules/auth/login.js');
      return await renderLogin(root);
    }
    const joined = await acceptPendingInvite().catch((error) => {
      toastError(error);
      return null;
    });
    await loadOrganizations();
    if (!getState().orgs.length) {
      const { renderOnboarding } = await import('../modules/auth/onboarding.js');
      return renderOnboarding(root);
    }
    mountShell();
    if (joined) toast(`Você entrou em ${joined.orgName}.`, 'success');
  } catch (error) {
    console.error(error);
    setHtml(
      root,
      html`<div class="fatal">${loadError(error)}
        <div class="fatal__actions">
          <button class="btn btn--secondary" type="button" id="retry">Tentar de novo</button>
          <button class="btn btn--ghost" type="button" id="leave">Sair da conta</button>
        </div>
      </div>`,
    );
    $('#retry')?.addEventListener('click', boot);
    $('#leave')?.addEventListener('click', () => signOut().catch(toastError));
  } finally {
    booting = false;
  }
}

function mountShell() {
  const { sidebarCollapsed } = getState();
  setHtml(
    root,
    html`<div class="shell ${sidebarCollapsed ? 'is-collapsed' : ''}">
      <a class="skip-link" href="#view">Pular para o conteúdo</a>
      <aside class="sidebar" id="sidebar" aria-label="Navegação principal"></aside>
      <div class="scrim" aria-hidden="true"></div>
      <div class="main">
        <header class="topbar" id="topbar"></header>
        <main class="view" id="view" tabindex="-1"></main>
      </div>
    </div>`,
  );
  const shell = /** @type {HTMLElement} */ (root.querySelector('.shell'));
  shell.querySelector('.scrim').addEventListener('click', () => shell.classList.remove('is-drawer-open'));
  // Links dentro do conteúdo usam href="#view" só para o skip-link; não deixar virar rota.
  shell.querySelector('.skip-link').addEventListener('click', (event) => {
    event.preventDefault();
    $('#view')?.focus();
  });

  teardown.push(
    mountSidebar($('#sidebar')),
    mountTopbar($('#topbar')),
    startRouter(renderRoute),
    events.on('org:changed', () => renderRoute(currentRoute())),
  );
  startNotifications();
}

/** @param {import('./router.js').Route} route */
async function renderRoute(route) {
  view?.abort();
  view = new AbortController();
  const { signal } = view;
  const target = /** @type {HTMLElement} */ ($('#view'));
  if (!target) return;
  document.querySelector('.shell')?.classList.remove('is-drawer-open');

  const module = findModule(route.module);
  const section = module?.sections?.find((s) => s.id === route.section) ?? module?.sections?.[0] ?? null;
  setActiveModule(module?.id ?? '');
  setCrumbs(module ? { icon: module.icon, name: module.name, href: `#/${module.id}` } : null, section?.name ?? null);
  document.title = module ? `${section ? `${section.name} · ` : ''}${module.name} — ${APP_NAME}` : APP_NAME;

  if (!module) {
    setHtml(target, emptyState({ title: 'Página não encontrada', text: `Não existe nada em “${route.path}”.`, action: { label: 'Ir para Hoje', href: '#/dashboard' } }));
    return;
  }
  if (module.permission && !canDo(module.permission)) {
    setHtml(target, emptyState({ title: 'Sem acesso a este módulo', text: 'Seu papel nesta organização não inclui este módulo. Fale com um administrador.' }));
    return;
  }

  target.scrollTop = 0;
  window.scrollTo(0, 0);
  try {
    const { render } = await module.load();
    if (signal.aborted) return;
    target.replaceChildren();
    await render({ root: target, route, module, signal });
  } catch (error) {
    if (signal.aborted) return;
    console.error(error);
    setHtml(target, loadError(error));
  }
}

// Eventos de autenticação vindos de outra aba ou do link de recuperação de senha.
data.auth.onChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    openDialog({
      title: 'Definir nova senha',
      body: html`<label class="field"><span class="field__label">Nova senha</span>
        <input class="input" type="password" name="password" required minlength="8" autocomplete="new-password"></label>`,
      submitLabel: 'Salvar senha',
      onSubmit: (form) => updatePassword(String(form.get('password'))),
    }).then((ok) => ok && toast('Senha atualizada.', 'success'));
    return;
  }
  const signedIn = Boolean(getState().user);
  if ((event === 'SIGNED_OUT' && signedIn) || (event === 'SIGNED_IN' && !signedIn)) boot();
});

events.on('session:changed', boot);
// Link de convite aberto com o app já carregado nesta aba.
window.addEventListener('hashchange', () => {
  if (isInviteUrl()) boot();
});
bindCommandPaletteShortcut();
boot();

// Instalar como app: só no site publicado. Na máquina, o sw.js serve só para desligar workers de outros projetos.
if ('serviceWorker' in navigator && location.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
