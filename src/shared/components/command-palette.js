// Busca global (Ctrl+K / ⌘K): módulos, seções, organizações e ações.

import { html, setHtml, createElement } from '../utils/dom.js';
import { normalize } from '../utils/format.js';
import { getState } from '../../core/state.js';
import { navigate } from '../../core/router.js';
import { MODULES } from '../../modules/index.js';
import { canDo, switchOrganization, signOut } from '../../services/auth.js';
import { cycleTheme } from '../utils/theme.js';
import { promptNewOrganization } from './org-dialog.js';
import { toggleSidebar } from './topbar.js';
import { markAllNotificationsRead } from './notification-center.js';
import { openAssistant } from './assistant-panel.js';
import { toastError } from './feedback.js';

/**
 * @typedef {Object} Command
 * @property {string} id
 * @property {string} group
 * @property {string} label
 * @property {string} [hint]     texto à direita (sigla, papel…)
 * @property {string} [keywords]
 * @property {() => void} run
 */

/** @returns {Command[]} */
function buildCommands() {
  const { orgs, org } = getState();
  /** @type {Command[]} */
  const list = [];
  for (const m of MODULES) {
    if (m.permission && !canDo(m.permission)) continue;
    list.push({
      id: `module:${m.id}`,
      group: 'Módulos',
      label: m.name,
      hint: m.code,
      keywords: `${m.code} ${m.group} ${m.summary}`,
      run: () => navigate(`/${m.id}`),
    });
    for (const s of m.sections ?? []) {
      if (s.permission && !canDo(s.permission)) continue;
      list.push({
        id: `section:${m.id}/${s.id}`,
        group: m.name,
        label: s.name,
        hint: m.code,
        keywords: s.keywords,
        run: () => navigate(`/${m.id}/${s.id}`),
      });
    }
  }
  for (const o of orgs) {
    if (o.id === org?.id) continue;
    list.push({ id: `org:${o.id}`, group: 'Organizações', label: `Trocar para ${o.name}`, keywords: 'organização empresa', run: () => switchOrganization(o.id) });
  }
  list.push(
    { id: 'action:new-org', group: 'Ações', label: 'Nova organização', keywords: 'criar empresa', run: () => promptNewOrganization() },
    { id: 'action:theme', group: 'Ações', label: 'Alternar tema claro/escuro', keywords: 'dark light aparência', run: () => cycleTheme() },
    { id: 'action:sidebar', group: 'Ações', label: 'Recolher ou expandir o menu', keywords: 'sidebar barra lateral', run: () => toggleSidebar() },
    { id: 'action:read-all', group: 'Ações', label: 'Marcar notificações como lidas', keywords: 'avisos', run: () => markAllNotificationsRead() },
    { id: 'action:assistant', group: 'Ações', label: 'Perguntar ao DUM AI', keywords: 'assistente chat bot ia ajuda pergunta resumo', run: () => openAssistant() },
    { id: 'action:sign-out', group: 'Ações', label: 'Sair', keywords: 'logout encerrar sessão', run: () => signOut().catch(toastError) },
  );
  return list;
}

/**
 * Todos os termos digitados precisam aparecer (sem acento, sem caixa).
 * Ordem: título que começa com a busca → título que contém → demais campos.
 * @param {Command[]} commands
 * @param {string} query
 */
export function filterCommands(commands, query) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return commands;
  const text = terms.join(' ');
  return commands
    .filter((c) => {
      const haystack = normalize(`${c.label} ${c.group} ${c.hint ?? ''} ${c.keywords ?? ''}`);
      return terms.every((t) => haystack.includes(t));
    })
    .map((c) => {
      const label = normalize(c.label);
      return { c, rank: label.startsWith(text) ? 0 : terms.every((t) => label.includes(t)) ? 1 : 2 };
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ c }) => c);
}

/** @type {HTMLDialogElement | null} */
let dialog = null;

export function openCommandPalette() {
  if (dialog) return;
  const commands = buildCommands();
  let results = commands;
  let index = 0;

  dialog = /** @type {HTMLDialogElement} */ (
    createElement(html`
      <dialog class="palette" aria-label="Busca global">
        <div class="palette__field">
          <input class="palette__input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list"
                 aria-autocomplete="list" placeholder="Buscar módulo, seção ou ação…" autocomplete="off" spellcheck="false">
          <kbd>Esc</kbd>
        </div>
        <ul class="palette__list" id="palette-list" role="listbox"></ul>
        <p class="palette__foot"><kbd>↑</kbd><kbd>↓</kbd> navegar <kbd>Enter</kbd> abrir</p>
      </dialog>`)
  );
  const input = /** @type {HTMLInputElement} */ (dialog.querySelector('input'));
  const list = /** @type {HTMLElement} */ (dialog.querySelector('ul'));

  const draw = () => {
    if (!results.length) {
      setHtml(list, html`<li class="palette__empty">Nada encontrado para “${input.value}”.</li>`);
      input.removeAttribute('aria-activedescendant');
      return;
    }
    let lastGroup = '';
    setHtml(
      list,
      html`${results.map((c, i) => {
        const header = c.group !== lastGroup ? html`<li class="palette__group" role="presentation">${c.group}</li>` : '';
        lastGroup = c.group;
        return html`${header}<li class="palette__item ${i === index ? 'is-active' : ''}" role="option" id="cmd-${i}" aria-selected="${i === index}" data-index="${i}">
          <span>${c.label}</span>${c.hint ? html`<span class="palette__hint">${c.hint}</span>` : ''}</li>`;
      })}`,
    );
    input.setAttribute('aria-activedescendant', `cmd-${index}`);
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };

  const run = (/** @type {number} */ i) => {
    const command = results[i];
    if (!command) return;
    dialog.close();
    command.run();
  };

  input.addEventListener('input', () => {
    results = filterCommands(commands, input.value);
    index = 0;
    draw();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!results.length) return;
      index = (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      draw();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(index);
    }
  });
  list.addEventListener('click', (event) => {
    const item = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('[data-index]'));
    if (item) run(Number(item.dataset.index));
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    dialog = null;
  });

  document.body.append(dialog);
  dialog.showModal();
  draw();
  input.focus();
}

/** Atalho global. Chamado uma vez pelo app. */
export function bindCommandPaletteShortcut() {
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (dialog) dialog.close();
      else if (getState().org) openCommandPalette();
    }
  });
}
