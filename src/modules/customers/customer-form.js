// Formulários de cliente (cadastro/edição, com etiquetas) e de pessoa de contato.

import { html, $ } from '../../shared/utils/dom.js';
import { getState } from '../../core/state.js';
import { CUSTOMER_STATUS, CUSTOMER_KINDS, formatDocument, cleanDocument } from '../../core/customers.js';
import { data } from '../../services/data.js';
import { openDialog } from '../../shared/components/dialog.js';
import { openRecordDialog } from '../../shared/components/record-form.js';

/** @typedef {import('../../services/data.js').Customer} Customer */
/** @typedef {import('../../services/data.js').CustomerInput} CustomerInput */
/** @typedef {import('../../services/data.js').CustomerContact} CustomerContact */

export const docLabel = (/** @type {string} */ kind) => CUSTOMER_KINDS.find((k) => k.key === kind)?.document ?? 'Documento';

/** Cadastro/edição de cliente. @param {Customer | null} current @returns {Promise<boolean>} */
export async function editCustomer(current) {
  const { org } = getState();
  const members = await data.members.list(org.id).catch(() => []);
  const c = current ?? /** @type {Partial<Customer>} */ ({ kind: 'company', status: 'lead', notes: '', tags: [] });
  const saving = openDialog({
    title: current ? 'Editar cliente' : 'Novo cliente',
    wide: true,
    body: html`<div class="form-grid">
      <label class="field"><span class="field__label">Tipo</span>
        <select class="input" name="kind">
          ${CUSTOMER_KINDS.map((k) => html`<option value="${k.key}" ${c.kind === k.key ? html`selected` : ''}>${k.label}</option>`)}
        </select></label>
      <label class="field"><span class="field__label">Situação</span>
        <select class="input" name="status">
          ${CUSTOMER_STATUS.map((s) => html`<option value="${s.key}" ${c.status === s.key ? html`selected` : ''}>${s.label}</option>`)}
        </select></label>
      <label class="field form-grid__full"><span class="field__label" data-name-label>${c.kind === 'person' ? 'Nome completo' : 'Razão social ou nome fantasia'}</span>
        <input class="input" name="name" required minlength="2" maxlength="120" value="${c.name ?? ''}" autocomplete="off"></label>
      <label class="field"><span class="field__label" data-doc-label>${docLabel(c.kind)}</span>
        <input class="input mono" name="document" maxlength="18" value="${formatDocument(c.document)}" autocomplete="off" placeholder="opcional"></label>
      <label class="field"><span class="field__label">Cidade</span>
        <input class="input" name="city" maxlength="80" value="${c.city ?? ''}" placeholder="opcional"></label>
      <label class="field"><span class="field__label">E-mail</span>
        <input class="input" type="email" name="email" value="${c.email ?? ''}" autocomplete="off" placeholder="opcional"></label>
      <label class="field"><span class="field__label">Telefone / WhatsApp</span>
        <input class="input" type="tel" name="phone" maxlength="30" value="${c.phone ?? ''}" autocomplete="off" placeholder="opcional"></label>
      <label class="field form-grid__full"><span class="field__label">Etiquetas</span>
        <input class="input" name="tags" maxlength="400" value="${(c.tags ?? []).join(', ')}" autocomplete="off" placeholder="Ex.: restaurante, VIP, indicação">
        <span class="field__hint">Separe por vírgula. Servem para filtrar a carteira.</span></label>
      <label class="field form-grid__full"><span class="field__label">Responsável</span>
        <select class="input" name="ownerId">
          <option value="">Sem responsável</option>
          ${members.map((m) => html`<option value="${m.userId}" ${c.ownerId === m.userId ? html`selected` : ''}>${m.name || m.email}</option>`)}
        </select></label>
      <label class="field form-grid__full"><span class="field__label">Observações</span>
        <textarea class="input" name="notes" rows="3" maxlength="4000">${c.notes ?? ''}</textarea></label>
    </div>`,
    submitLabel: current ? 'Salvar alterações' : 'Cadastrar cliente',
    onSubmit: async (form) => {
      await data.customers.save(org.id, /** @type {CustomerInput} */ (/** @type {any} */ (Object.fromEntries(form))), current?.id);
    },
  });

  // Rótulos acompanham o tipo (CNPJ para empresa, CPF para pessoa).
  const dialog = /** @type {HTMLElement} */ (document.querySelector('dialog.dialog[open]:last-of-type'));
  const kind = /** @type {HTMLSelectElement} */ ($('[name=kind]', dialog));
  kind.addEventListener('change', () => {
    $('[data-doc-label]', dialog).textContent = docLabel(kind.value);
    $('[data-name-label]', dialog).textContent = kind.value === 'person' ? 'Nome completo' : 'Razão social ou nome fantasia';
  });
  const doc = /** @type {HTMLInputElement} */ ($('[name=document]', dialog));
  doc.addEventListener('blur', () => {
    const clean = cleanDocument(doc.value);
    if (clean.length === 11 || clean.length === 14) doc.value = formatDocument(clean);
  });

  return Boolean(await saving);
}

/** Pessoa de contato do cliente. @param {string} customerId @param {CustomerContact | null} current */
export const editContact = (customerId, current) =>
  openRecordDialog({
    title: current ? 'Editar contato' : 'Nova pessoa de contato',
    fields: [
      { name: 'name', label: 'Nome', required: true, maxlength: 120, full: true },
      { name: 'role', label: 'Cargo', maxlength: 80, placeholder: 'Ex.: dono, financeiro, marketing' },
      { name: 'phone', label: 'Telefone / WhatsApp', type: 'tel', maxlength: 30 },
      { name: 'email', label: 'E-mail', type: 'email', full: true },
      { name: 'isPrimary', label: 'Contato principal', type: 'checkbox', full: true },
    ],
    values: current ?? {},
    submitLabel: current ? 'Salvar' : 'Adicionar contato',
    onSubmit: (values) => data.customerContacts.save(getState().org.id, /** @type {any} */ ({ ...values, customerId }), current?.id),
  });
