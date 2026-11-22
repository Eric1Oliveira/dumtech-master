// Página de lista padrão dos módulos: cabeçalho, filtro por situação (com contagem real),
// busca e tabela ordenável. O módulo cuida das ações (data-action) e do carregamento.

import { html, setHtml, $ } from '../utils/dom.js';
import { normalize, formatInteger } from '../utils/format.js';
import { dataTable } from './table.js';
import { emptyState, loadError } from './feedback.js';
import { icon } from './icons.js';

/**
 * @template T
 * @typedef {Object} ListPageOptions
 * @property {HTMLElement} root
 * @property {import('../../modules/index.js').ModuleDef} module
 * @property {string} title
 * @property {string} sub
 * @property {string | null} [newLabel]      botão principal (data-action="new"); null = sem botão
 * @property {import('../utils/dom.js').SafeHtml | ''} [actions]   botões extras antes do principal
 * @property {boolean} [newIsSecondary]      o botão "new" vira secundário (quando `actions` traz o principal)
 * @property {readonly { key: string, label: string }[]} [statuses]
 * @property {(row: T) => string} [statusOf]
 * @property {(row: T) => string} searchOf
 * @property {string} searchLabel
 * @property {import('./table.js').Column<T>[]} columns
 * @property {{ key: string, dir: 'asc' | 'desc' }} [sort]
 * @property {{ title: string, text: string }} empty   quando ainda não há nenhum registro
 * @property {AbortSignal} signal
 */

/**
 * @template T
 * @param {ListPageOptions<T>} o
 */
export function listPage(o) {
  /** @type {T[]} */
  let rows = [];
  let query = '';
  let status = '';

  setHtml(
    o.root,
    html`<header class="page-head">
        <div>
          <h1 class="page-title">${o.title}</h1>
          <p class="page-sub">${o.sub}</p>
        </div>
        ${o.newLabel || o.actions
          ? html`<div class="page-actions">${o.actions ?? ''}${o.newLabel ? html`<button type="button" class="btn ${o.newIsSecondary ? 'btn--secondary' : 'btn--primary'}" data-action="new">${icon('plus')}<span>${o.newLabel}</span></button>` : ''}</div>`
          : ''}
      </header>
      <section class="panel">
        <header class="panel__head">
          ${o.statuses ? html`<div class="segmented segmented--counts" role="tablist" aria-label="Situação" data-filters></div>` : html`<span></span>`}
          <label class="search-field">
            ${icon('search')}<span class="sr-only">Buscar</span>
            <input class="input input--bare" type="search" placeholder="${o.searchLabel}" data-search>
          </label>
        </header>
        <div data-table><div class="skeleton"></div></div>
      </section>`,
  );
  const table = /** @type {HTMLElement} */ ($('[data-table]', o.root));
  const filters = /** @type {HTMLElement | null} */ ($('[data-filters]', o.root));

  const drawFilters = () => {
    if (!filters || !o.statuses) return;
    const count = (/** @type {string} */ key) => rows.filter((r) => !key || o.statusOf(r) === key).length;
    setHtml(
      filters,
      html`${[{ key: '', label: 'Todos' }, ...o.statuses].map(
        (s) => html`<button type="button" role="tab" class="segmented__item" aria-selected="${status === s.key}" data-status="${s.key}">
          ${s.label}<span class="segmented__count">${formatInteger(count(s.key))}</span>
        </button>`,
      )}`,
    );
  };

  const drawTable = () => {
    if (!rows.length) {
      setHtml(
        table,
        html`<div class="empty">
          <p class="empty__title">${o.empty.title}</p>
          <p class="empty__text">${o.empty.text}</p>
          ${o.newLabel ? html`<button type="button" class="btn btn--secondary" data-action="new">${icon('plus')}<span>${o.newLabel}</span></button>` : ''}
        </div>`,
      );
      return;
    }
    const terms = normalize(query);
    const visible = rows.filter((r) => (!status || o.statusOf(r) === status) && normalize(o.searchOf(r)).includes(terms));
    table.replaceChildren(
      dataTable({
        label: o.title,
        rows: visible,
        sort: o.sort,
        empty: emptyState({ title: 'Nada encontrado', text: 'Ajuste a busca ou o filtro.', compact: true }),
        columns: o.columns,
      }),
    );
  };

  $('[data-search]', o.root).addEventListener('input', (event) => {
    query = /** @type {HTMLInputElement} */ (event.target).value;
    drawTable();
  }, { signal: o.signal });

  filters?.addEventListener('click', (event) => {
    const tab = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('[data-status]'));
    if (!tab) return;
    status = tab.dataset.status;
    drawFilters();
    drawTable();
  }, { signal: o.signal });

  return {
    /** @param {T[]} next */
    show(next) {
      rows = next;
      drawFilters();
      drawTable();
    },
    /** @param {unknown} error */
    fail(error) {
      setHtml(table, loadError(error));
    },
    get rows() {
      return rows;
    },
  };
}

/** Pílula de situação a partir de uma lista { key, label, tone }. */
export const statusPill = (/** @type {readonly { key: string, label: string, tone?: string }[]} */ list, /** @type {string} */ key) => {
  const s = list.find((x) => x.key === key);
  return html`<span class="status-pill status-pill--${s?.tone ?? 'info'}">${s?.label ?? key}</span>`;
};
