// Kit do Novo projeto: o que foi marcado vira mensalidade, implantação, custo e as linhas da proposta (spec 5.2).

import { monthlyEquivalent } from './infra.js';

const round2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;
const brl = (/** @type {number} */ n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * @typedef {{ description: string, quantity: number, unitPrice: number, recurring: boolean }} KitLine
 * @typedef {{ name: string, price: number | null, pricePeriod: string | null, cost?: number | null, costPeriod?: string | null }} PricedThing
 */

/**
 * shared = compartilhados marcados; exclusive = exclusivos novos; items = itens da tabela de preços
 * marcados; shareOf = rateio (serviceCosts().shareOf).
 * @param {{
 *   shared: (PricedThing & { id: string })[],
 *   exclusive: PricedThing[],
 *   items: { name: string, price: number, recurring: boolean }[],
 *   shareOf: (asset: any, extra?: number) => number,
 * }} input
 */
export function suggestKit({ shared, exclusive, items, shareOf }) {
  /** @type {KitLine[]} */
  const lines = [];
  let monthly = 0;
  let setup = 0;
  let cost = 0;
  const priced = (/** @type {string} */ description, /** @type {number | null} */ price, /** @type {string | null} */ period) => {
    if (!price) return;
    if (period === 'once') {
      setup += price;
      lines.push({ description, quantity: 1, unitPrice: price, recurring: false });
      return;
    }
    const perMonth = round2(monthlyEquivalent(price, period ?? 'monthly'));
    monthly += perMonth;
    lines.push({ description: period === 'yearly' ? `${description} (${brl(price)}/ano)` : description, quantity: 1, unitPrice: perMonth, recurring: true });
  };
  for (const a of shared) {
    cost += shareOf(a, 1);
    priced(a.name, a.price, a.pricePeriod);
  }
  for (const e of exclusive) {
    cost += monthlyEquivalent(e.cost ?? null, e.costPeriod ?? null);
    priced(e.name, e.price, e.pricePeriod);
  }
  for (const i of items) priced(i.name, i.price, i.recurring ? 'monthly' : 'once');
  return { monthly: round2(monthly), setup: round2(setup), cost: round2(cost), lines };
}

const sum = (/** @type {KitLine[]} */ list) => round2(list.reduce((s, l) => s + l.quantity * l.unitPrice, 0));

/**
 * Linhas da proposta. Se o valor foi mudado à mão, os itens viram uma linha só ("inclui ...")
 * com o valor combinado — a proposta sempre fecha com o que vai ser cobrado.
 * @param {KitLine[]} lines @param {{ monthly: number, setup: number }} values
 * @returns {KitLine[]}
 */
export function proposalLines(lines, { monthly, setup }) {
  const once = lines.filter((l) => !l.recurring);
  const rec = lines.filter((l) => l.recurring);
  const names = (/** @type {KitLine[]} */ list) => list.map((l) => l.description).join(', ');
  /** @type {KitLine[]} */
  const out = [];
  if (setup > 0) {
    out.push(...(once.length && sum(once) === round2(setup)
      ? once
      : [{ description: once.length ? `Implantação — inclui ${names(once)}` : 'Implantação', quantity: 1, unitPrice: round2(setup), recurring: false }]));
  }
  if (monthly > 0) {
    out.push(...(rec.length && sum(rec) === round2(monthly)
      ? rec
      : [{ description: rec.length ? `Mensalidade — inclui ${names(rec)}` : 'Mensalidade', quantity: 1, unitPrice: round2(monthly), recurring: true }]));
  }
  return out;
}

/** Lucro e margem (null quando não há mensalidade). @param {number} monthly @param {number} cost */
export const marginOf = (monthly, cost) => ({ profit: round2(monthly - cost), margin: monthly > 0 ? Math.round(((monthly - cost) / monthly) * 100) : null });
