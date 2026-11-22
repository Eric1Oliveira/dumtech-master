// Avisos rápidos (toast), estados vazios e erro de carregamento.

import { html, createElement } from '../utils/dom.js';

/** @type {HTMLElement | null} */
let region = null;

/**
 * @param {string} message
 * @param {'info' | 'success' | 'danger'} [kind]
 */
export function toast(message, kind = 'info') {
  if (!region) {
    region = createElement(html`<div class="toasts" role="status" aria-live="polite"></div>`);
    document.body.append(region);
  }
  const item = createElement(html`<div class="toast toast--${kind}">${message}</div>`);
  region.append(item);
  while (region.children.length > 3) region.firstElementChild.remove(); // no máximo 3 avisos à vista
  setTimeout(() => item.remove(), 4500);
}

/** @param {unknown} error */
export const toastError = (error) => toast(errorMessage(error), 'danger');

/** @param {unknown} error */
export const errorMessage = (error) => (error instanceof Error && error.message) || 'Erro inesperado. Tente novamente.';

/**
 * @param {{ title: string, text?: string, action?: { label: string, href: string } | null, compact?: boolean }} options
 */
export const emptyState = ({ title, text, action, compact }) => html`
  <div class="empty ${compact ? 'empty--compact' : ''}">
    <p class="empty__title">${title}</p>
    ${text ? html`<p class="empty__text">${text}</p>` : ''}
    ${action ? html`<a class="link-action" href="${action.href}">${action.label} →</a>` : ''}
  </div>`;

/** @param {unknown} error */
export const loadError = (error) => html`
  <div class="empty empty--error" role="alert">
    <p class="empty__title">Não foi possível carregar</p>
    <p class="empty__text">${errorMessage(error)}</p>
  </div>`;
