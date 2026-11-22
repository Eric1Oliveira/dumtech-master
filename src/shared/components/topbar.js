// Topbar: recolher menu, onde estou, busca, notificações e tema.

import { html, setHtml, bindActions, $ } from '../utils/dom.js';
import { getState, setState, uiPrefs } from '../../core/state.js';
import { events } from '../../core/events.js';
import { cycleTheme, THEME_LABELS } from '../utils/theme.js';
import { openCommandPalette } from './command-palette.js';
import { toggleNotificationCenter } from './notification-center.js';
import { toggleAssistant } from './assistant-panel.js';
import { icon } from './icons.js';

const MOBILE = window.matchMedia('(max-width: 900px)');

/**
 * @param {HTMLElement} root
 * @returns {() => void} desmonta
 */
export function mountTopbar(root) {
  setHtml(
    root,
    html`
      <button type="button" class="icon-btn" data-action="toggle-sidebar" aria-controls="sidebar">${icon('panel')}</button>
      <nav class="crumbs" aria-label="Você está em" id="crumbs"></nav>
      <button type="button" class="search-trigger" data-action="search" aria-label="Buscar ou ir para (Ctrl+K)">
        ${icon('search')}<span class="search-trigger__text">Buscar ou ir para…</span><kbd>Ctrl K</kbd>
      </button>
      <div class="topbar__actions">
        <button type="button" class="assistant-trigger" data-action="assistant" aria-expanded="false" title="Perguntar sobre os dados do sistema">
          ${icon('message')}<span>DUM AI</span>
        </button>
        <button type="button" class="icon-btn" data-action="notifications" aria-haspopup="dialog" aria-expanded="false" id="bell">
          ${icon('bell')}<span class="count-badge" hidden></span>
        </button>
        <button type="button" class="icon-btn" data-action="theme" id="theme-btn"></button>
      </div>`,
  );

  bindActions(root, {
    'toggle-sidebar': () => toggleSidebar(),
    search: () => openCommandPalette(),
    notifications: (button) => toggleNotificationCenter(button),
    assistant: () => toggleAssistant(),
    theme: () => cycleTheme(),
  });

  updateThemeButton();
  updateSidebarButton();
  return events.on('theme:changed', updateThemeButton);
}

/** Desktop recolhe/expande; celular abre/fecha a gaveta. */
export function toggleSidebar() {
  const shell = document.querySelector('.shell');
  if (MOBILE.matches) {
    shell?.classList.toggle('is-drawer-open');
  } else {
    const collapsed = !getState().sidebarCollapsed;
    uiPrefs.set('sidebar', collapsed ? 'collapsed' : null);
    setState({ sidebarCollapsed: collapsed });
    shell?.classList.toggle('is-collapsed', collapsed);
  }
  updateSidebarButton();
}

function updateSidebarButton() {
  const button = $('[data-action="toggle-sidebar"]');
  if (!button) return;
  const label = MOBILE.matches ? 'Abrir menu' : getState().sidebarCollapsed ? 'Expandir menu' : 'Recolher menu';
  button.setAttribute('aria-label', label);
  button.title = label;
}

function updateThemeButton() {
  const button = $('#theme-btn');
  if (!button) return;
  const pref = getState().theme;
  setHtml(button, icon(pref === 'light' ? 'sun' : pref === 'dark' ? 'moon' : 'monitor'));
  const label = `Tema: ${THEME_LABELS[pref]}. Clique para trocar.`;
  button.setAttribute('aria-label', label);
  button.title = label;
}

/**
 * @param {{ icon: import('./icons.js').IconName, name: string, href: string } | null} module
 * @param {string | null} section
 */
export function setCrumbs(module, section) {
  const crumbs = $('#crumbs');
  if (!crumbs) return;
  setHtml(
    crumbs,
    module
      ? html`<a class="crumbs__module" href="${module.href}">${icon(module.icon, 'crumbs__icon')}<span class="crumbs__name">${module.name}</span></a>
          ${section ? html`<span class="crumbs__sep" aria-hidden="true">/</span><span class="crumbs__section" aria-current="page">${section}</span>` : ''}`
      : html`<span class="crumbs__section">Página não encontrada</span>`,
  );
}

MOBILE.addEventListener('change', updateSidebarButton);
