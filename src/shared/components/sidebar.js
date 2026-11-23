// Sidebar: marca, troca de organização, módulos por grupo e menu do usuário.
// Recolhida, mostra só os ícones dos módulos (o nome aparece no title).

import { html, setHtml, createElement, bindActions } from '../utils/dom.js';
import { initials } from '../utils/format.js';
import { getState, subscribe } from '../../core/state.js';
import { roleName } from '../../core/permissions.js';
import { GROUPS, MODULES } from '../../modules/index.js';
import { canDo, switchOrganization, signOut, updateMyName } from '../../services/auth.js';
import { openDialog } from './dialog.js';
import { toast } from './feedback.js';
import { togglePopover, closePopover } from './popover.js';
import { promptNewOrganization } from './org-dialog.js';
import { icon } from './icons.js';
import { toastError } from './feedback.js';

/** @type {string} */
let activeModule = '';

/**
 * @param {HTMLElement} root
 * @returns {() => void} desmonta (remove ouvintes de estado)
 */
export function mountSidebar(root) {
  const draw = () => setHtml(root, template());
  draw();
  bindActions(root, {
    'org-menu': (button) => togglePopover(button, orgMenu(), { align: 'start' }),
    'user-menu': (button) => togglePopover(button, userMenu(), { align: 'start' }),
    'sign-out': () => signOut().catch(toastError),
  });
  return subscribe((_, patch) => {
    if ('org' in patch || 'orgs' in patch || 'user' in patch) draw();
  });
}

/** @param {string} moduleId */
export function setActiveModule(moduleId) {
  activeModule = moduleId;
  for (const link of document.querySelectorAll('.nav__item')) {
    const isActive = /** @type {HTMLElement} */ (link).dataset.module === moduleId;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function template() {
  const { org, user } = getState();
  const visible = MODULES.filter((m) => !m.hidden && (!m.permission || canDo(m.permission)));
  return html`
    <div class="sidebar__brand">
      <a class="brand" href="#/dashboard" aria-label="DUMTech Master — Command Center">
        <span class="brand__mark">DUM</span><span class="brand__name">Master</span>
      </a>
    </div>

    <button type="button" class="org-switch" data-action="org-menu" aria-haspopup="menu" aria-expanded="false" title="${org?.name ?? ''}">
      <span class="org-switch__badge" aria-hidden="true">${initials(org?.name ?? '')}</span>
      <span class="org-switch__text">
        <span class="org-switch__name">${org?.name ?? 'Sem organização'}</span>
        <span class="org-switch__role">${org ? roleName(org.role) : ''}</span>
      </span>
      ${icon('chevronDown', 'org-switch__chevron')}
    </button>

    <nav class="nav" aria-label="Módulos">
      ${GROUPS.map((group) => {
        const items = visible.filter((m) => m.group === group);
        if (!items.length) return '';
        return html`
          ${group ? html`<p class="nav__group">${group}</p>` : ''}
          <ul class="nav__list">
            ${items.map(
              (m) => html`<li>
                <a class="nav__item ${m.id === activeModule ? 'is-active' : ''}"
                   href="#/${m.id}" data-module="${m.id}" title="${m.name}"
                   ${m.id === activeModule ? html`aria-current="page"` : ''}>
                  ${icon(m.icon, 'nav__icon')}
                  <span class="nav__label">${m.name}</span>
                </a>
              </li>`,
            )}
          </ul>`;
      })}
    </nav>

    <div class="sidebar__foot">
      <button type="button" class="user-chip" data-action="user-menu" aria-haspopup="menu" aria-expanded="false" title="${user?.email ?? ''}">
        <span class="avatar" aria-hidden="true">${initials(user?.name ?? '')}</span>
        <span class="user-chip__text">
          <span class="user-chip__name">${user?.name ?? ''}</span>
          <span class="user-chip__mail">${user?.email ?? ''}</span>
        </span>
      </button>
      <button type="button" class="icon-btn sidebar__logout" data-action="sign-out" aria-label="Sair da conta" title="Sair da conta">${icon('logout')}</button>
    </div>`;
}

function orgMenu() {
  const { orgs, org } = getState();
  const panel = createElement(html`
    <div class="menu" role="menu" aria-label="Organizações">
      <p class="menu__label">Organizações</p>
      ${orgs.map(
        (o) => html`<button type="button" class="menu__item" role="menuitemradio" aria-checked="${o.id === org?.id}" data-org="${o.id}">
          <span class="menu__text">${o.name}<small>${roleName(o.role)}</small></span>
          ${o.id === org?.id ? icon('check') : ''}
        </button>`,
      )}
      <hr class="menu__sep">
      <button type="button" class="menu__item" role="menuitem" data-new-org>${icon('plus')}<span class="menu__text">Nova organização</span></button>
    </div>`);
  panel.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const item = /** @type {HTMLElement | null} */ (target.closest('[data-org]'));
    if (item) {
      closePopover();
      switchOrganization(item.dataset.org);
    } else if (target.closest('[data-new-org]')) {
      closePopover();
      promptNewOrganization();
    }
  });
  return panel;
}

function userMenu() {
  const { user } = getState();
  const panel = createElement(html`
    <div class="menu" role="menu" aria-label="Conta">
      <div class="menu__head">
        <strong>${user?.name ?? ''}</strong>
        <small>${user?.email ?? ''}</small>
        <small>Sua conta</small>
      </div>
      <hr class="menu__sep">
      <button type="button" class="menu__item" role="menuitem" data-my-name>${icon('edit')}<span class="menu__text">Meu nome</span></button>
      <button type="button" class="menu__item" role="menuitem" data-sign-out>${icon('logout')}<span class="menu__text">Sair</span></button>
    </div>`);
  panel.querySelector('[data-my-name]').addEventListener('click', async () => {
    closePopover();
    const ok = await openDialog({
      title: 'Meu nome',
      description: 'É como a equipe vê você: nas tarefas, no Caderno, na auditoria e nos avisos (no lugar do e-mail).',
      body: html`<label class="field"><span class="field__label">Nome ou apelido</span><input class="input" name="name" value="${user?.name ?? ''}" required minlength="2" maxlength="80" autocomplete="nickname"></label>`,
      submitLabel: 'Salvar',
      onSubmit: (form) => updateMyName(String(form.get('name') ?? '')),
    }).catch((error) => (toastError(error), false));
    if (ok) toast('Nome salvo.', 'success');
  });
  panel.querySelector('[data-sign-out]').addEventListener('click', () => {
    closePopover();
    signOut().catch(toastError);
  });
  return panel;
}
