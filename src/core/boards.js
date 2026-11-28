// Montagem das telas Hoje e Dinheiro a partir das listas (regra pura, sem tela nem banco).
// O computador (dashboard, finance) e o app do celular usam as mesmas funções: os números batem.

import { formatMoney, formatDate } from '../shared/utils/format.js';
import { billingStatus, monthKey, dueDate, adjustmentDue } from './billing.js';
import { ASSET_KINDS } from './infra.js';
import { serviceCosts, mrr } from './costs.js';
import { todayList } from './today.js';
import { labelOf } from './validate.js';

/** @typedef {(permission: string) => boolean} Can */

/**
 * "Hoje": a lista do que precisa de você e os números do mês.
 * `payments` = null quando a pessoa não vê as cobranças.
 * @param {{ products: any[], subs: any[], payments: any[] | null, customers: any[], contacts: any[], monitors: any[],
 *   assets: any[], links: any[], tasks: any[], proposals: any[], billing: any }} src
 * @param {{ todayKey: string, me?: string | null, can: Can }} options
 */
export function todayBoard({ products, subs, payments, customers, contacts, monitors, assets, links, tasks, proposals, billing }, { todayKey, me = null, can }) {
  const month = monthKey(todayKey);
  const name = new Map(products.map((p) => /** @type {[string, string]} */ ([p.id, p.name])));
  const phoneOf = (/** @type {string} */ customerId) =>
    contacts.find((c) => c.customerId === customerId && c.isPrimary && c.phone)?.phone ?? customers.find((c) => c.id === customerId)?.phone ?? null;
  const active = subs.filter((s) => s.status === 'active' && s.monthlyAmount);
  const billings = payments
    ? active.filter((s) => s.billingDay).map((s) => ({
        sub: s,
        subId: s.id,
        customerId: s.customerId,
        customerName: s.customerName,
        productName: s.productName,
        amountLabel: formatMoney(s.monthlyAmount ?? 0),
        due: dueDate(month, /** @type {number} */ (s.billingDay)),
        state: billingStatus(s, payments, month, todayKey),
        phone: phoneOf(s.customerId),
      }))
    : [];
  const customerOf = (/** @type {string} */ productId) => subs.find((s) => s.productId === productId && s.status !== 'cancelled')?.customerName ?? '';
  /** Cliente do projeto e o telefone dele (aviso de queda). */
  const contactOf = (/** @type {string | null} */ productId) => {
    const sub = productId ? subs.find((s) => s.productId === productId && s.status !== 'cancelled') : null;
    return sub ? { name: sub.customerName, phone: phoneOf(sub.customerId) } : null;
  };
  const setups = can('products.manage')
    ? products.filter((p) => (p.status === 'building' || p.status === 'live') && p.setupAmount && !p.setupPaidOn)
        .map((p) => ({ productId: p.id, name: p.name, customerName: customerOf(p.id), amountLabel: formatMoney(p.setupAmount ?? 0) }))
    : [];
  const pct = Number(billing?.adjustPct ?? 5);
  const adjustments = can('products.manage')
    ? subs.flatMap((sub) => {
        const due = adjustmentDue(sub, todayKey, pct);
        if (!due) return [];
        const when = due.days < 0 ? 'desde ' + formatDate(due.date) : 'em ' + formatDate(due.date);
        return [{ sub, due, subId: sub.id, customerName: sub.customerName, productName: sub.productName, date: due.date,
          label: `1 ano ${when} · ${formatMoney(sub.monthlyAmount ?? 0)} → ${formatMoney(due.amount)} (+${String(due.pct).replace('.', ',')}%)` }];
      })
    : [];
  const items = todayList({
    monitors: monitors.map((m) => ({ ...m, projectName: m.productId ? name.get(m.productId) : undefined })),
    billings,
    setups,
    adjustments,
    assets: assets.map((a) => ({ ...a, kindLabel: labelOf(ASSET_KINDS, a.kind) })),
    tasks,
    proposals,
  }, todayKey, me);
  const costs = serviceCosts({ assets, links, projects: products });
  const expected = billings.filter((b) => b.state !== 'none').reduce((s, b) => s + (b.sub.monthlyAmount ?? 0), 0);
  const mine = new Set(subs.map((s) => s.id));
  const received = (payments ?? []).filter((p) => p.month === month && mine.has(p.subscriptionId)).reduce((s, p) => s + p.amount, 0);
  return { items, adjustments, contactOf, billings, products, subs, tasks, assets, monitors, billing, month, monthly: mrr(subs), expected, received, cost: can('infra.view') ? costs.total : null, seesBilling: Boolean(payments) };
}

/** Os 12 meses até o atual: "2025-12" … "2026-11". @param {string} todayKey */
export const lastMonths = (todayKey) => {
  const [y, m] = todayKey.split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
};

/**
 * "Dinheiro": mensalidades, custo dos serviços, mês (previsto/recebido/a receber/atrasado),
 * lucro por projeto e recebido nos 12 meses. Implantação paga antes da empresa não entra.
 * @param {{ products: any[], subs: any[], payments: any[], assets: any[], links: any[], entries: any[] }} src
 * @param {{ todayKey: string, can: Can }} options
 */
export function moneyBoard({ products, subs, payments, assets, links, entries }, { todayKey, can }) {
  const month = monthKey(todayKey);
  const year = todayKey.slice(0, 4);
  const costs = serviceCosts({ assets, links, projects: products });
  const monthly = mrr(subs);
  const seesCost = can('infra.view');
  const active = subs.filter((s) => s.status === 'active' && s.monthlyAmount);
  const states = active.map((s) => ({ s, state: billingStatus(s, payments, month, todayKey) }));
  const expected = states.filter((x) => x.state !== 'none').reduce((t, x) => t + (x.s.monthlyAmount ?? 0), 0);
  const received = payments.filter((p) => p.month === month).reduce((t, p) => t + p.amount, 0);
  const sum = (/** @type {{ s: any }[]} */ list) => list.reduce((t, x) => t + (x.s.monthlyAmount ?? 0), 0);
  const late = states.filter((x) => x.state === 'late');
  const open = states.filter((x) => x.state === 'open');
  const inMonth = (/** @type {string} */ ym) => ({
    fees: payments.filter((p) => p.month === ym).reduce((t, p) => t + p.amount, 0),
    setups: products.filter((p) => !p.setupOutside && p.setupPaidOn?.startsWith(ym)).reduce((t, p) => t + (p.setupAmount ?? 0), 0),
    extras: entries.filter((e) => e.kind === 'revenue' && e.occurredOn.startsWith(ym)).reduce((t, e) => t + e.amount, 0),
  });
  const months = lastMonths(todayKey).map((ym) => ({ month: ym, ...inMonth(ym) }));
  const yearTotal = months.filter((x) => x.month.startsWith(year)).reduce((t, x) => t + x.fees + x.setups + x.extras, 0);
  const rows = products
    .filter((p) => p.status === 'building' || p.status === 'live')
    .map((p) => {
      const mine = subs.filter((s) => s.productId === p.id && s.status !== 'cancelled');
      const value = p.status === 'live' ? mine.filter((s) => s.status === 'active').reduce((t, s) => t + (s.monthlyAmount ?? 0), 0) : mine.reduce((t, s) => t + (s.monthlyAmount ?? 0), 0);
      const cost = costs.projectCost(p.id);
      return { p, customers: mine.map((s) => s.customerName).join(', '), value, cost, profit: value - cost, margin: value > 0 ? Math.round(((value - cost) / value) * 100) : null };
    });
  return {
    month,
    year,
    costs,
    monthly,
    seesCost,
    expected,
    expectedCount: states.filter((x) => x.state !== 'none').length,
    received,
    late: { count: late.length, total: sum(late) },
    open: { count: open.length, total: sum(open) },
    months,
    yearTotal,
    rows,
  };
}
