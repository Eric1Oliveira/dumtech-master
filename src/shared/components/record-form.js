// Formulário montado a partir de uma lista de campos (cadastros dos módulos).
// A validação de verdade fica nas regras de src/core/ (e no banco); aqui é só a tela.

import { html } from '../utils/dom.js';
import { openDialog } from './dialog.js';

/**
 * @typedef {Object} Field
 * @property {string} name
 * @property {string} label
 * @property {'text' | 'email' | 'tel' | 'url' | 'password' | 'money' | 'date' | 'select' | 'textarea' | 'checkbox'} [type]
 * @property {boolean} [required]
 * @property {boolean} [full]        ocupa a linha inteira
 * @property {{ value: string, label: string }[]} [options]
 * @property {string} [placeholder]
 * @property {number} [maxlength]
 * @property {string} [hint]
 * @property {boolean} [mono]
 */

/** Número em reais para o campo de texto ("1.500,00"). */
const moneyValue = (/** @type {unknown} */ v) =>
  v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * @param {Field} f
 * @param {any} value
 */
function fieldHtml(f, value) {
  const type = f.type ?? 'text';
  if (type === 'checkbox') {
    return html`<label class="check ${f.full ? 'form-grid__full' : ''}"><input type="checkbox" name="${f.name}" ${value ? html`checked` : ''}><span>${f.label}</span></label>`;
  }
  const required = f.required ? html`required` : '';
  const placeholder = f.placeholder ?? (f.required ? '' : 'opcional');
  let control;
  if (type === 'select') {
    control = html`<select class="input" name="${f.name}" ${required}>
      ${(f.options ?? []).map((o) => html`<option value="${o.value}" ${String(value ?? '') === o.value ? html`selected` : ''}>${o.label}</option>`)}
    </select>`;
  } else if (type === 'textarea') {
    control = html`<textarea class="input" name="${f.name}" rows="3" maxlength="${f.maxlength ?? 4000}">${value ?? ''}</textarea>`;
  } else if (type === 'money') {
    control = html`<input class="input mono" name="${f.name}" inputmode="decimal" value="${moneyValue(value)}" placeholder="${f.placeholder ?? '0,00'}" autocomplete="off">`;
  } else {
    control = html`<input class="input ${f.mono ? 'mono' : ''}" type="${type}" name="${f.name}" value="${value ?? ''}" ${required}
      ${f.maxlength ? html`maxlength="${f.maxlength}"` : ''} placeholder="${placeholder}" autocomplete="off">`;
  }
  return html`<label class="field ${f.full || type === 'textarea' ? 'form-grid__full' : ''}">
    <span class="field__label">${f.label}</span>${control}
    ${f.hint ? html`<span class="field__hint">${f.hint}</span>` : ''}
  </label>`;
}

/**
 * @param {Field[]} fields
 * @param {Record<string, any>} [values]
 */
export const fieldsHtml = (fields, values = {}) => html`<div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.name]))}</div>`;

/** Lê o formulário: checkbox desmarcado vira false (FormData omite). */
export function readForm(/** @type {FormData} */ form, /** @type {Field[]} */ fields) {
  /** @type {Record<string, any>} */
  const out = Object.fromEntries(form);
  for (const f of fields) if (f.type === 'checkbox') out[f.name] = form.has(f.name);
  return out;
}

/**
 * Diálogo de cadastro/edição. `onSubmit` recebe os valores; lançar erro mantém o diálogo aberto.
 * @param {{ title: string, description?: string, fields: Field[], values?: Record<string, any>, submitLabel?: string,
 *   onSubmit: (values: Record<string, any>) => unknown | Promise<unknown> }} options
 */
export const openRecordDialog = ({ title, description, fields, values = {}, submitLabel = 'Salvar', onSubmit }) =>
  openDialog({
    title,
    description,
    wide: fields.length > 3,
    body: fieldsHtml(fields, values),
    submitLabel,
    onSubmit: (form) => onSubmit(readForm(form, fields)),
  });

/**
 * Opções de pessoa responsável a partir da lista de membros.
 * @param {{ userId: string, name: string, email: string }[]} members
 * @param {string} [empty]
 */
export const memberOptions = (members, empty = 'Sem responsável') => [
  { value: '', label: empty },
  ...members.map((m) => ({ value: m.userId, label: m.name || m.email })),
];
