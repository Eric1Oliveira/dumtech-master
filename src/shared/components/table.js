// Tabela com ordenação por coluna. Ações dentro das células são tratadas pela
// tela (delegação com data-action).

import { html, setHtml } from '../utils/dom.js';
import { icon } from './icons.js';
import { normalize } from '../utils/format.js';

/**
 * @template T
 * @typedef {Object} Column
 * @property {string} key
 * @property {string} label
 * @property {(row: T) => unknown} [render]       conteúdo da célula (texto ou html``)
 * @property {(row: T) => string | number} [sortValue]  presente = coluna ordenável
 * @property {'end'} [align]
 * @property {boolean} [hideOnMobile]
 */

/**
 * @template T
 * @param {{ columns: Column<T>[], rows: T[], empty: import('../utils/dom.js').SafeHtml, sort?: { key: string, dir: 'asc' | 'desc' }, label: string }} options
 * @returns {HTMLElement}
 */
export function dataTable({ columns, rows, empty, sort, label }) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  let order = sort ?? null;

  const sorted = () => {
    const column = columns.find((c) => c.key === order?.key);
    if (!column?.sortValue) return rows;
    const factor = order.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = column.sortValue(a);
      const y = column.sortValue(b);
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * factor;
      return normalize(String(x)).localeCompare(normalize(String(y)), 'pt-BR') * factor;
    });
  };

  const draw = () => {
    if (!rows.length) return setHtml(wrap, empty);
    setHtml(
      wrap,
      html`<table class="table" aria-label="${label}">
        <thead><tr>${columns.map((c) => {
          const cls = [c.align === 'end' ? 'is-end' : '', c.hideOnMobile ? 'hide-mobile' : ''].join(' ');
          if (!c.sortValue) return html`<th scope="col" class="${cls}">${c.label}</th>`;
          const dir = order?.key === c.key ? order.dir : null;
          return html`<th scope="col" class="${cls}" aria-sort="${dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}">
            <button type="button" class="table__sort" data-sort="${c.key}">${c.label}${dir ? icon(dir === 'asc' ? 'chevronUp' : 'chevronDown') : ''}</button></th>`;
        })}</tr></thead>
        <tbody>${sorted().map(
          (row) => html`<tr>${columns.map((c) => {
            const cls = [c.align === 'end' ? 'is-end' : '', c.hideOnMobile ? 'hide-mobile' : '', c.key === 'actions' ? 'is-actions' : ''].join(' ');
            // data-label: no celular a linha vira cartão e cada célula mostra o nome da coluna.
            return html`<td class="${cls}" data-label="${c.label}">${c.render ? c.render(row) : /** @type {any} */ (row)[c.key]}</td>`;
          })}</tr>`,
        )}</tbody>
      </table>`,
    );
  };

  wrap.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('[data-sort]'));
    if (!button) return;
    const key = button.dataset.sort;
    order = { key, dir: order?.key === key && order.dir === 'asc' ? 'desc' : 'asc' };
    draw();
    /** @type {HTMLElement | null} */ (wrap.querySelector(`[data-sort="${key}"]`))?.focus();
  });

  draw();
  return wrap;
}
