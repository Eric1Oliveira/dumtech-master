// Cobrança das assinaturas (cliente × produto com valor mensal e dia de vencimento).
// Espelho de customer_products (monthly_amount, billing_day) e billing_payments (migration 0012).
// A situação do mês (pago / em aberto / atrasado) é calculada aqui; o banco guarda só o pagamento.

import { money, dateOrNull, today } from './validate.js';

export const BILLING_STATUS = /** @type {const} */ ([
  { key: 'paid', label: 'Pago', tone: 'ok' },
  { key: 'open', label: 'Em aberto', tone: 'info' },
  { key: 'late', label: 'Atrasado', tone: 'danger' },
  { key: 'none', label: 'Sem cobrança', tone: 'muted' },
]);

/** @typedef {'paid' | 'open' | 'late' | 'none'} BillingState */

/**
 * @typedef {Object} SubscriptionTerms
 * @property {number | null} monthlyAmount
 * @property {number | null} billingDay   1–28 (todo mês tem)
 */

/** @param {Record<string, any>} input @returns {SubscriptionTerms} */
export function normalizeTerms(input) {
  const monthlyAmount = money(input.monthlyAmount, 'Valor mensal');
  const raw = String(input.billingDay ?? '').trim();
  let billingDay = null;
  if (raw) {
    billingDay = Number(raw);
    if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) throw new Error('Dia de vencimento: de 1 a 28 (todo mês tem).');
  }
  return { monthlyAmount, billingDay };
}

/**
 * @typedef {Object} PaymentInput
 * @property {string} subscriptionId
 * @property {string} month    AAAA-MM
 * @property {number} amount
 * @property {string} paidOn   AAAA-MM-DD
 * @property {string} note
 */

/** @param {Record<string, any>} input @returns {PaymentInput} */
export function normalizePayment(input) {
  if (!input.subscriptionId) throw new Error('Escolha a assinatura.');
  const month = String(input.month ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Mês inválido.');
  const amount = money(input.amount, 'Valor pago');
  if (amount === null) throw new Error('Informe o valor pago.');
  const note = String(input.note ?? '').trim();
  if (note.length > 300) throw new Error('A observação passa de 300 caracteres.');
  return { subscriptionId: String(input.subscriptionId), month, amount, paidOn: dateOrNull(input.paidOn, 'Data do pagamento') ?? today(), note };
}

/** "2026-11-18" → "2026-11" */
export const monthKey = (/** @type {string} */ dateKey = today()) => dateKey.slice(0, 7);

/** Vencimento do mês: "2026-11" + 10 → "2026-11-10". */
export const dueDate = (/** @type {string} */ month, /** @type {number} */ day) => `${month}-${String(day).padStart(2, '0')}`;

/**
 * Situação de uma assinatura num mês.
 * Sem valor mensal ou cancelada = sem cobrança. Começou depois do vencimento daquele mês = sem cobrança no mês.
 * @param {{ id: string, status: string, monthlyAmount: number | null, billingDay: number | null, since: string }} sub
 * @param {{ subscriptionId: string, month: string }[]} payments
 * @param {string} month     AAAA-MM
 * @param {string} todayKey  AAAA-MM-DD
 * @returns {BillingState}
 */
export function billingStatus(sub, payments, month, todayKey) {
  if (sub.status !== 'active' || !sub.monthlyAmount) return 'none';
  if (payments.some((p) => p.subscriptionId === sub.id && p.month === month)) return 'paid';
  if (month < monthKey(sub.since)) return 'none';
  if (!sub.billingDay) return 'open';
  const due = dueDate(month, sub.billingDay);
  if (sub.since > due) return 'none';
  return due < todayKey ? 'late' : 'open';
}

/** Mensagem padrão da cobrança (Ajustes › Cobrança pode trocar). Variáveis: {cliente} {projeto} {valor} {vencimento} {pix}. */
export const DEFAULT_BILLING_MESSAGE =
  'Olá, {cliente}! Passando para lembrar da mensalidade de {projeto}: {valor}, com vencimento em {vencimento}. {pix}Qualquer dúvida, estou à disposição. Obrigado!';

/**
 * Texto da cobrança com as variáveis trocadas. {pix} vira "Chave Pix: … " (ou some, sem chave).
 * @param {string | null | undefined} template
 * @param {{ cliente: string, projeto: string, valor: string, vencimento: string, pix?: string | null }} values
 */
export function billingMessage(template, { cliente, projeto, valor, vencimento, pix }) {
  const vars = { cliente, projeto, valor, vencimento, pix: pix ? `Chave Pix: ${pix}. ` : '' };
  return String(template || DEFAULT_BILLING_MESSAGE)
    .replace(/\{(cliente|projeto|valor|vencimento|pix)\}/g, (_, key) => vars[/** @type {keyof typeof vars} */ (key)])
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Mesma data um ano depois (29/02 vira 28/02). @param {string} dateKey */
export function oneYearAfter(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const day = m === 2 && d === 29 ? 28 : d;
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Reajuste anual a sugerir: 1 ano depois do último reajuste (ou do início da mensalidade), avisado
 * a partir de 15 dias antes. null = nada a fazer agora.
 * @param {{ status: string, monthlyAmount: number | null, since: string, adjustedOn?: string | null }} sub
 * @param {string} todayKey @param {number} pct reajuste sugerido em %
 */
export function adjustmentDue(sub, todayKey, pct, windowDays = 15) {
  if (sub.status !== 'active' || !sub.monthlyAmount || !(pct > 0)) return null;
  const date = oneYearAfter(sub.adjustedOn ?? sub.since);
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 864e5);
  if (days > windowDays) return null;
  return { date, days, pct, amount: Math.round(sub.monthlyAmount * (1 + pct / 100) * 100) / 100 };
}
