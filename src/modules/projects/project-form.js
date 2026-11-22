// Edição do projeto (dados da ficha). A etapa não muda aqui: só pelos botões da página.

import { getState } from '../../core/state.js';
import { PRODUCT_KINDS } from '../../core/catalog.js';
import { data } from '../../services/data.js';
import { openRecordDialog, memberOptions } from '../../shared/components/record-form.js';

/** @typedef {import('../../services/data.js').Product} Product */

/** @param {Product} current @returns {Promise<boolean>} */
export async function editProject(current) {
  const { org } = getState();
  const members = await data.members.list(org.id).catch(() => []);
  return openRecordDialog({
    title: 'Editar projeto',
    fields: [
      { name: 'name', label: 'Nome', required: true, maxlength: 120, full: true },
      { name: 'kind', label: 'Tipo', type: 'select', options: PRODUCT_KINDS.map((k) => ({ value: k.key, label: k.label })) },
      { name: 'url', label: 'Endereço', type: 'url', placeholder: 'https://', hint: 'O "No ar" vigia este endereço.' },
      { name: 'setupAmount', label: 'Implantação (R$)', type: 'money', hint: 'Valor único combinado' },
      ...(current.kind === 'system'
        ? [{ name: 'monthlyPrice', label: 'Mensalidade padrão (R$)', type: /** @type {const} */ ('money'), hint: 'Sugerida ao adicionar um cliente' }]
        : []),
      { name: 'startDate', label: 'Início', type: 'date' },
      { name: 'dueDate', label: 'Prazo da construção', type: 'date' },
      { name: 'ownerId', label: 'Responsável', type: 'select', options: memberOptions(members), full: true },
      { name: 'description', label: 'Descrição', type: 'textarea' },
    ],
    values: current,
    submitLabel: 'Salvar alterações',
    // Junta com o que não está no formulário (ex.: implantação recebida) para não apagar.
    onSubmit: (values) => data.products.save(org.id, /** @type {any} */ ({ ...current, ...values }), current.id),
  });
}
