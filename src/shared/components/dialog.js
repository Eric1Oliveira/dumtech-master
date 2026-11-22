// Diálogos modais com <dialog> nativo (foco preso, Esc fecha, acessível).

import { html, createElement } from '../utils/dom.js';
import { errorMessage } from './feedback.js';

let counter = 0;

/**
 * @typedef {Object} DialogOptions
 * @property {string} title
 * @property {string} [description]
 * @property {import('../utils/dom.js').SafeHtml} body
 * @property {string | null} [submitLabel]   null = só leitura (sem botão de confirmar)
 * @property {string} [cancelLabel]
 * @property {boolean} [danger]
 * @property {boolean} [wide]   formulários maiores (duas colunas)
 * @property {(form: FormData) => unknown | Promise<unknown>} [onSubmit]  lançar erro mantém o diálogo aberto com a mensagem
 */

/**
 * @param {DialogOptions} options
 * @returns {Promise<boolean>} true quando confirmado com sucesso
 */
export function openDialog({ title, description, body, submitLabel = 'Salvar', cancelLabel = 'Cancelar', danger = false, wide = false, onSubmit }) {
  const id = `dialog-${++counter}`;
  const dialog = /** @type {HTMLDialogElement} */ (
    createElement(html`
      <dialog class="dialog ${wide ? 'dialog--wide' : ''}" aria-labelledby="${id}-title">
        <form class="dialog__form" novalidate>
          <header class="dialog__head">
            <h2 class="dialog__title" id="${id}-title">${title}</h2>
            ${description ? html`<p class="dialog__desc">${description}</p>` : ''}
          </header>
          <div class="dialog__body">${body}</div>
          <p class="form-error" role="alert" hidden></p>
          <footer class="dialog__foot">
            <button type="button" class="btn btn--ghost" data-cancel>${cancelLabel}</button>
            ${submitLabel ? html`<button type="submit" class="btn ${danger ? 'btn--danger' : 'btn--primary'}">${submitLabel}</button>` : ''}
          </footer>
        </form>
      </dialog>`)
  );
  const form = /** @type {HTMLFormElement} */ (dialog.querySelector('form'));
  const errorBox = /** @type {HTMLElement} */ (dialog.querySelector('.form-error'));
  const submit = /** @type {HTMLButtonElement} */ (dialog.querySelector('[type=submit]'));
  document.body.append(dialog);
  dialog.showModal();

  return new Promise((resolve) => {
    let result = false;
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!submit || !form.reportValidity()) return;
      submit.disabled = true;
      errorBox.hidden = true;
      try {
        await onSubmit?.(new FormData(form));
        result = true;
        dialog.close();
      } catch (error) {
        errorBox.textContent = errorMessage(error);
        errorBox.hidden = false;
        submit.disabled = false;
      }
    });
  });
}

/**
 * @param {{ title: string, message: string, confirmLabel: string, danger?: boolean }} options
 */
export const confirmDialog = ({ title, message, confirmLabel, danger = false }) =>
  openDialog({ title, body: html`<p class="dialog__text">${message}</p>`, submitLabel: confirmLabel, danger });
