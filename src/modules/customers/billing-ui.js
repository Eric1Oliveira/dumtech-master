// Ações de cobrança usadas na ficha do cliente e no painel do site:
// vincular (assinatura), editar valor/vencimento, marcar o mês como pago e desfazer.

import { html } from '../../shared/utils/dom.js';
import { formatMoney, formatMonth } from '../../shared/utils/format.js';
import { BILLING_STATUS, monthKey } from '../../core/billing.js';
import { today } from '../../core/validate.js';
import { data } from '../../services/data.js';
import { openRecordDialog } from '../../shared/components/record-form.js';
import { confirmDialog } from '../../shared/components/dialog.js';
import { statusPill } from '../../shared/components/list-page.js';

/** @typedef {import('../../services/data.js').CustomerProduct} Subscription */
/** @typedef {import('../../services/data.js').Payment} Payment */

/** Pílula da situação do mês (pago / em aberto / atrasado / sem cobrança). */
export const billingPill = (/** @type {import('../../core/billing.js').BillingState} */ state) => statusPill(BILLING_STATUS, state);

/** "R$ 89,90/mês · dia 10" */
export const termsText = (/** @type {Subscription} */ s) =>
  [s.monthlyAmount ? `${formatMoney(s.monthlyAmount)}/mês` : 'sem valor mensal', s.billingDay ? `vence dia ${s.billingDay}` : null].filter(Boolean).join(' · ');

/** @param {string} orgId @param {Subscription} sub @param {string} [month] */
export const markPaid = (orgId, sub, month = monthKey()) =>
  openRecordDialog({
    title: `Marcar ${formatMonth(month)} como pago`,
    description: `${sub.customerName} · ${sub.productName}`,
    fields: [
      { name: 'amount', label: 'Valor pago (R$)', type: 'money', required: true },
      { name: 'paidOn', label: 'Pago em', type: 'date', required: true },
      { name: 'note', label: 'Observação', maxlength: 300, full: true, placeholder: 'Ex.: Pix, boleto, cartão' },
    ],
    values: { amount: sub.monthlyAmount, paidOn: today() },
    submitLabel: 'Marcar como pago',
    onSubmit: (values) => data.payments.save(orgId, /** @type {any} */ ({ ...values, subscriptionId: sub.id, month })),
  });

/** @param {string} orgId @param {Payment} payment @param {Subscription} sub */
export async function undoPayment(orgId, payment, sub) {
  const ok = await confirmDialog({
    title: 'Desfazer pagamento?',
    message: `${formatMonth(payment.month)} de ${sub.customerName} volta a ficar em aberto. Fica registrado na auditoria.`,
    confirmLabel: 'Desfazer',
    danger: true,
  });
  if (ok) await data.payments.remove(orgId, payment.id);
  return ok;
}

const dayField = { name: 'billingDay', label: 'Dia de vencimento', maxlength: 2, placeholder: '1 a 28', hint: 'Até 28, para existir em todo mês.' };

/** Valor e vencimento de uma assinatura (e cancelar/reativar). @param {string} orgId @param {Subscription} sub */
export const editSubscription = (orgId, sub) =>
  openRecordDialog({
    title: 'Mensalidade',
    description: `${sub.customerName} · ${sub.productName}`,
    fields: [
      { name: 'monthlyAmount', label: 'Valor mensal (R$)', type: 'money' },
      dayField,
      { name: 'status', label: 'Situação', type: 'select', options: [{ value: 'active', label: 'Ativa (cobrando)' }, { value: 'pending', label: 'Combinada (começa ao publicar)' }, { value: 'cancelled', label: 'Cancelada' }], full: true },
    ],
    values: { monthlyAmount: sub.monthlyAmount, billingDay: sub.billingDay ?? '', status: sub.status },
    submitLabel: 'Salvar',
    onSubmit: (values) => data.customerProducts.update(orgId, sub.id, /** @type {any} */ (values)),
  });

/**
 * Mensalidade cliente × projeto (o único diálogo para isso). Um dos lados vem fixo (a tela de onde se abriu).
 * Valor vazio = mensalidade padrão do projeto. Projeto ainda não publicado: fica combinada (pending).
 * @param {string} orgId
 * @param {{ customers: { id: string, name: string }[], products: { id: string, name: string, status?: string, monthlyPrice: number | null }[],
 *   customerId?: string, productId?: string, title: string }} options
 */
export function linkSubscription(orgId, { customers, products, customerId, productId, title }) {
  const fixedProduct = productId ? products.find((p) => p.id === productId) : null;
  return openRecordDialog({
    title,
    description: fixedProduct ? `Quem paga por ${fixedProduct.name} e quanto.` : 'Escolha o projeto que o cliente usa e quanto paga.',
    fields: [
      customerId
        ? { name: 'productId', label: 'Projeto', type: 'select', required: true, full: true, options: products.map((p) => ({ value: p.id, label: p.monthlyPrice ? `${p.name} (${formatMoney(p.monthlyPrice)}/mês)` : p.name })) }
        : { name: 'customerId', label: 'Cliente', type: 'select', required: true, full: true, options: customers.map((c) => ({ value: c.id, label: c.name })) },
      { name: 'monthlyAmount', label: 'Valor mensal (R$)', type: 'money', hint: 'Vazio = mensalidade padrão do projeto' },
      dayField,
    ],
    values: { monthlyAmount: fixedProduct?.monthlyPrice ?? null },
    submitLabel: 'Salvar mensalidade',
    onSubmit: async (values) => {
      const product = products.find((p) => p.id === (productId ?? values.productId));
      const monthlyAmount = String(values.monthlyAmount ?? '').trim() ? values.monthlyAmount : product?.monthlyPrice ?? null;
      await data.customerProducts.link(orgId, customerId ?? values.customerId, product.id, /** @type {any} */ ({ monthlyAmount, billingDay: values.billingDay, status: product.status && product.status !== 'live' ? 'pending' : 'active' }));
    },
  });
}

/** Ícone + texto curto para a coluna "Este mês" (com ação quando cabe). */
export const monthCell = (/** @type {import('../../core/billing.js').BillingState} */ state, /** @type {Payment | null} */ payment) =>
  html`<span class="person">${billingPill(state)}${payment ? html`<small>${formatMoney(payment.amount)} em ${payment.paidOn.split('-').reverse().join('/')}</small>` : ''}</span>`;
