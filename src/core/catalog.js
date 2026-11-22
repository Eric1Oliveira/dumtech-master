// Regras do projeto (no banco, tabela products): tipo, etapas e campos editáveis (espelho da migration 0013).
// A etapa só muda pelos botões do projeto (project_set_stage), nunca pelo formulário.

import { requiredText, longText, money, pick, idOrNull, urlOrNull, dateOrNull } from './validate.js';

export const PRODUCT_KINDS = /** @type {const} */ ([
  { key: 'site', label: 'Site' },
  { key: 'system', label: 'Sistema' },
]);

/** Etapas, na ordem do fluxo. */
export const PRODUCT_STATUS = /** @type {const} */ ([
  { key: 'proposal', label: 'Proposta', tone: 'muted' },
  { key: 'building', label: 'Em construção', tone: 'info' },
  { key: 'live', label: 'Publicado', tone: 'ok' },
  { key: 'ended', label: 'Encerrado', tone: 'muted' },
]);

/**
 * @typedef {Object} ProductInput   o que o formulário do projeto edita
 * @property {string} name
 * @property {'site' | 'system'} kind
 * @property {string | null} url
 * @property {number | null} monthlyPrice   Sistema: mensalidade padrão ao adicionar cliente
 * @property {number | null} setupAmount    implantação combinada
 * @property {string | null} setupPaidOn    quando a implantação foi recebida
 * @property {string | null} startDate
 * @property {string | null} dueDate        prazo da construção
 * @property {string | null} ownerId
 * @property {string} description
 */

/**
 * Item da tabela de preços (sale_items): o que se vende além dos serviços.
 * @param {Record<string, any>} input @returns {import('../services/data.js').SaleItemInput}
 */
export function normalizeSaleItem(input) {
  const price = money(input.price, 'Preço');
  if (price === null) throw new Error('Informe o preço.');
  return {
    name: requiredText(input.name, 'O nome', 2, 120),
    price,
    recurring: input.recurring === true || input.recurring === 'on' || input.recurring === 'true',
    active: input.active !== false && input.active !== 'false',
    position: Number.isInteger(Number(input.position)) ? Number(input.position) : 0,
  };
}

/** @param {Record<string, any>} input @returns {ProductInput} */
export function normalizeProduct(input) {
  const startDate = dateOrNull(input.startDate, 'Início');
  const dueDate = dateOrNull(input.dueDate, 'Prazo');
  if (startDate && dueDate && dueDate < startDate) throw new Error('O prazo não pode ser antes do início.');
  return {
    name: requiredText(input.name, 'O nome', 2, 120),
    kind: pick(PRODUCT_KINDS, input.kind, 'site'),
    url: urlOrNull(input.url, 'Endereço'),
    monthlyPrice: money(input.monthlyPrice, 'Mensalidade padrão'),
    setupAmount: money(input.setupAmount, 'Implantação'),
    setupPaidOn: dateOrNull(input.setupPaidOn, 'Implantação recebida em'),
    startDate,
    dueDate,
    ownerId: idOrNull(input.ownerId),
    description: longText(input.description, 'Descrição'),
  };
}
