// Regras das propostas (espelho de save_proposal / set_proposal_status na migration 0008).

import { requiredText, longText, money, dateOrNull, idOrNull } from './validate.js';

export const PROPOSAL_STATUS = /** @type {const} */ ([
  { key: 'draft', label: 'Rascunho', tone: 'muted' },
  { key: 'sent', label: 'Enviada', tone: 'info' },
  { key: 'accepted', label: 'Aceita', tone: 'ok' },
  { key: 'rejected', label: 'Recusada', tone: 'danger' },
]);

/** @typedef {'draft' | 'sent' | 'accepted' | 'rejected'} ProposalStatus */

/** Mudanças de situação permitidas (aceita é final: virou projeto). */
export const TRANSITIONS = /** @type {Record<ProposalStatus, ProposalStatus[]>} */ ({
  draft: ['sent'],
  sent: ['draft', 'accepted', 'rejected'],
  rejected: ['draft'],
  accepted: [],
});

/** @param {ProposalStatus} from @param {ProposalStatus} to */
export const canTransition = (from, to) => TRANSITIONS[from]?.includes(to) ?? false;

/** @param {number} n */
export const proposalNumber = (n) => `P-${String(n).padStart(4, '0')}`;

/**
 * @typedef {Object} ProposalItem
 * @property {string | null} productId
 * @property {string} description
 * @property {number} quantity
 * @property {number} unitPrice
 * @property {boolean} recurring   true = mensal
 */

/**
 * @typedef {Object} ProposalInput
 * @property {string} customerId
 * @property {string} title
 * @property {string | null} validUntil
 * @property {string} notes
 * @property {ProposalItem[]} items
 * @property {string | null} [productId]   o projeto da proposta
 */

/** @param {Record<string, any>} item @returns {ProposalItem} */
export function normalizeItem(item) {
  const description = String(item.description ?? '').trim();
  if (description.length < 1 || description.length > 300) throw new Error('Cada item precisa de uma descrição (até 300 caracteres).');
  const quantity = Number(String(item.quantity ?? '1').replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('A quantidade precisa ser maior que zero.');
  return {
    productId: idOrNull(item.productId),
    description,
    quantity: Math.round(quantity * 100) / 100,
    unitPrice: money(item.unitPrice, 'Preço') ?? 0,
    recurring: item.recurring === true || item.recurring === 'true' || item.recurring === 'on',
  };
}

/** @param {Record<string, any>} input @returns {ProposalInput} */
export function normalizeProposal(input) {
  if (!input.customerId) throw new Error('Escolha o cliente da proposta.');
  const items = (Array.isArray(input.items) ? input.items : []).map(normalizeItem);
  if (!items.length) throw new Error('Inclua pelo menos um item na proposta.');
  if (items.length > 100) throw new Error('Limite de 100 itens por proposta.');
  return {
    customerId: String(input.customerId),
    title: requiredText(input.title, 'O título', 2, 160),
    validUntil: dateOrNull(input.validUntil, 'Validade'),
    notes: longText(input.notes, 'Observações'),
    items,
  };
}

/** @param {ProposalItem[]} items */
export function proposalTotals(items) {
  let once = 0;
  let monthly = 0;
  for (const i of items) {
    const value = Math.round(i.quantity * i.unitPrice * 100) / 100;
    if (i.recurring) monthly += value;
    else once += value;
  }
  return { once: Math.round(once * 100) / 100, monthly: Math.round(monthly * 100) / 100 };
}
