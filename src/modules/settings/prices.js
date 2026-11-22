// Ajustes › Tabela de preços: o que se vende além dos serviços (criação do site, manutenção, logo…).
// Aparece para marcar no Novo projeto e nas propostas; o valor entra na mensalidade ou na implantação.

import { html, setHtml, $, bindActions } from '../../shared/utils/dom.js';
import { formatMoney } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { openRecordDialog } from '../../shared/components/record-form.js';
import { confirmDialog } from '../../shared/components/dialog.js';
import { dataTable } from '../../shared/components/table.js';
import { emptyState, loadError, toast, toastError } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';

/** @typedef {import('../../services/data.js').SaleItem} SaleItem */

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, signal }) {
  const { org } = getState();
  const manage = canDo('products.manage');
  /** @type {SaleItem[]} */
  let items = [];

  setHtml(
    root,
    html`<section class="panel" aria-labelledby="prices-title">
      <header class="panel__head">
        <div><h2 class="panel__title" id="prices-title">Tabela de preços</h2>
          <p class="panel__hint">O que você vende além dos serviços. Marque no Novo projeto e o valor entra sozinho na mensalidade ou na implantação.</p></div>
        ${manage ? html`<button type="button" class="btn btn--primary btn--sm" data-action="new">${icon('plus')}<span>Novo item</span></button>` : ''}
      </header>
      <div data-items><div class="skeleton"></div></div>
    </section>`,
  );

  const draw = () => {
    $('[data-items]', root)?.replaceChildren(
      dataTable({
        label: 'Tabela de preços',
        rows: items,
        sort: { key: 'position', dir: 'asc' },
        empty: emptyState({ title: 'Nenhum item ainda', text: 'Ex.: Criação do site (único), Manutenção (mensal), Logo (único).', compact: true }),
        columns: [
          {
            key: 'position',
            label: 'Item',
            sortValue: (i) => i.position * 1000 + i.name.charCodeAt(0),
            render: (i) => html`<span class="person">${manage ? html`<button type="button" class="link-strong" data-action="edit" data-id="${i.id}">${i.name}</button>` : html`<strong>${i.name}</strong>`}
              <small>${i.active ? (i.recurring ? 'entra na mensalidade' : 'entra na implantação') : 'fora de uso'}</small></span>`,
          },
          { key: 'price', label: 'Preço', align: 'end', sortValue: (i) => i.price, render: (i) => html`<span class="mono">${formatMoney(i.price)}</span><small class="muted">${i.recurring ? '/mês' : ' único'}</small>` },
          ...(manage
            ? [{ key: 'actions', label: 'Ações', align: /** @type {const} */ ('end'), render: (/** @type {SaleItem} */ i) => html`<button type="button" class="icon-btn icon-btn--sm" data-action="remove" data-id="${i.id}" aria-label="Excluir ${i.name}" title="Excluir">${icon('trash')}</button>` }]
            : []),
        ],
      }),
    );
  };

  const load = async () => {
    try {
      items = await data.saleItems.list(org.id);
      if (!signal.aborted) draw();
    } catch (error) {
      if (!signal.aborted) setHtml(/** @type {HTMLElement} */ ($('[data-items]', root)), loadError(error));
    }
  };

  /** @param {SaleItem | null} current */
  const edit = (current) =>
    openRecordDialog({
      title: current ? 'Editar item' : 'Novo item',
      fields: [
        { name: 'name', label: 'Nome', required: true, maxlength: 120, full: true, placeholder: 'Ex.: Manutenção mensal' },
        { name: 'price', label: 'Preço (R$)', type: 'money', required: true },
        { name: 'recurring', label: 'Cobrança', type: 'select', options: [{ value: 'true', label: 'Mensal (entra na mensalidade)' }, { value: '', label: 'Único (entra na implantação)' }] },
        { name: 'position', label: 'Ordem na lista', maxlength: 3, placeholder: '1' },
        { name: 'active', label: 'Em uso (aparece no Novo projeto)', type: 'checkbox', full: true },
      ],
      values: current ? { ...current, recurring: current.recurring ? 'true' : '', position: String(current.position) } : { recurring: 'true', active: true, position: String(items.length + 1) },
      submitLabel: current ? 'Salvar' : 'Adicionar',
      onSubmit: (values) => data.saleItems.save(org.id, /** @type {any} */ (values), current?.id),
    });

  bindActions(root, {
    new: async () => {
      if (await edit(null).catch((e) => (toastError(e), false))) {
        toast('Item adicionado.', 'success');
        load();
      }
    },
    edit: async (el) => {
      const item = items.find((i) => i.id === el.dataset.id);
      if (item && (await edit(item).catch((e) => (toastError(e), false)))) {
        toast('Item atualizado.', 'success');
        load();
      }
    },
    remove: async (el) => {
      const item = items.find((i) => i.id === el.dataset.id);
      if (!item || !(await confirmDialog({ title: 'Excluir item?', message: `“${item.name}” sai da tabela. Propostas antigas não mudam.`, confirmLabel: 'Excluir', danger: true }))) return;
      try {
        await data.saleItems.remove(org.id, item.id);
        toast('Item excluído.', 'success');
        load();
      } catch (error) {
        toastError(error);
      }
    },
  }, signal);

  await load();
}
