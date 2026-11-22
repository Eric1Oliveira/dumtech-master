// Painel de um site/sistema: "está tudo ok?" e "quanto dá de dinheiro?".
// Regras puras: a tela junta os dados (infraestrutura, analytics, assinaturas, lançamentos) e desenha.

import { requiredText, money, dateOrNull, pick, today } from './validate.js';
import { daysUntil } from './infra.js';
import { billingStatus, monthKey } from './billing.js';

export const ENTRY_KINDS = /** @type {const} */ ([
  { key: 'revenue', label: 'Receita' },
  { key: 'cost', label: 'Custo' },
]);

/**
 * @typedef {Object} EntryInput   lançamento avulso do site (espelho de product_entries)
 * @property {string} productId
 * @property {'revenue' | 'cost'} kind
 * @property {string} description
 * @property {number} amount
 * @property {string} occurredOn
 */

/** @param {Record<string, any>} input @returns {EntryInput} */
export function normalizeEntry(input) {
  if (!input.productId) throw new Error('Escolha o site ou sistema.');
  const amount = money(input.amount, 'Valor');
  if (!amount) throw new Error('Informe um valor maior que zero.');
  return {
    productId: String(input.productId),
    kind: pick(ENTRY_KINDS, input.kind, 'cost'),
    description: requiredText(input.description, 'A descrição', 2, 200),
    amount,
    occurredOn: dateOrNull(input.occurredOn, 'Data') ?? today(),
  };
}

/** @typedef {'ok' | 'warn' | 'error' | 'unknown'} Level */
/** @typedef {{ level: Level, title: string, text: string }} Check */

const RANK = { unknown: 0, ok: 1, warn: 2, error: 3 };
const worst = (/** @type {Level[]} */ levels) => levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), /** @type {Level} */ ('unknown'));

/**
 * @typedef {{ kind: string, enabled: boolean, state: string, lastCode: number | null }} SiteMonitor
 * @typedef {{ kind: string, name: string, status: string, renewsAt: string | null }} SiteAsset
 * @typedef {{ events: number, lastDay: string | null } | null} SiteUsage   null = coleta não instalada
 */

/**
 * Situação de um grupo de monitores (site ou banco).
 * @param {SiteMonitor[]} list @param {'site' | 'banco'} what @param {string} missing frase quando não há monitor
 * @returns {{ level: Level, text: string }}
 */
function availability(list, what, missing) {
  if (!list.length) return { level: /** @type {Level} */ ('unknown'), text: missing };
  const on = list.filter((m) => m.enabled);
  if (!on.length) return { level: /** @type {Level} */ ('unknown'), text: 'Verificação desligada' };
  const down = on.find((m) => m.state === 'down');
  if (down) return { level: 'error', text: `${what === 'banco' ? 'Sem resposta' : 'Fora do ar'}${down.lastCode ? ` (HTTP ${down.lastCode})` : ''}` };
  if (on.some((m) => m.state === 'unstable')) return { level: 'warn', text: 'Instável' };
  if (on.some((m) => m.state === 'slow')) return { level: 'warn', text: 'Lento' };
  if (on.every((m) => m.state === 'unknown')) return { level: /** @type {Level} */ ('unknown'), text: 'Aguardando a primeira verificação' };
  return { level: /** @type {Level} */ ('ok'), text: what === 'banco' ? 'Respondendo' : 'No ar' };
}

/** Prazo em palavras. @param {number} days */
const inDays = (days) => (days < 0 ? `venceu há ${-days} dia${days < -1 ? 's' : ''}` : days === 0 ? 'vence hoje' : `vence em ${days} dia${days > 1 ? 's' : ''}`);

/**
 * "Está tudo ok?" — cada cartão com nível e frase, mais o nível geral e os motivos.
 * @param {{ monitors: SiteMonitor[], assets: SiteAsset[], usage: SiteUsage, lateBillings: number, todayKey?: string }} input
 */
export function siteHealth({ monitors, assets, usage, lateBillings, todayKey = today() }) {
  const active = assets.filter((a) => a.status === 'active');
  const site = availability(monitors.filter((m) => m.kind === 'site'), 'site', 'Cadastre o endereço do site para verificar');
  const database = availability(monitors.filter((m) => m.kind === 'database'), 'banco', 'Nenhum banco monitorado');

  const domains = active.filter((a) => a.kind === 'domain' && a.renewsAt).sort((a, b) => String(a.renewsAt).localeCompare(String(b.renewsAt)));
  /** @type {{ level: Level, text: string }} */
  let domain = { level: 'unknown', text: active.some((a) => a.kind === 'domain') ? 'Sem data de vencimento' : 'Nenhum domínio cadastrado' };
  if (domains.length) {
    const days = /** @type {number} */ (daysUntil(domains[0].renewsAt, todayKey));
    domain = { level: days <= 7 ? 'error' : days <= 30 ? 'warn' : 'ok', text: days > 30 ? 'Em dia' : `${domains[0].name} ${inDays(days)}` };
  }

  /** @type {{ level: Level, text: string }} */
  let use = { level: 'unknown', text: 'Coleta de uso não instalada' };
  if (usage) {
    const idle = usage.lastDay ? -(/** @type {number} */ (daysUntil(usage.lastDay, todayKey))) : null;
    if (!usage.events || idle === null) use = { level: 'warn', text: 'Sem uso nos últimos 30 dias' };
    else if (idle > 7) use = { level: 'warn', text: `Último uso há ${idle} dias` };
    else use = { level: 'ok', text: `${usage.events} evento${usage.events > 1 ? 's' : ''} em 30 dias` };
  }

  /** @type {Check[]} */
  const reasons = [];
  if (site.level === 'error') reasons.push({ level: 'error', title: 'Site', text: site.text });
  if (database.level === 'error') reasons.push({ level: 'error', title: 'Banco', text: database.text });
  if (domain.level === 'error' || domain.level === 'warn') reasons.push({ level: domain.level, title: 'Domínio', text: domain.text });
  for (const a of active) {
    if (a.kind === 'domain' || !a.renewsAt) continue;
    const days = /** @type {number} */ (daysUntil(a.renewsAt, todayKey));
    if (days <= 30) reasons.push({ level: days <= 7 ? 'error' : 'warn', title: a.name, text: inDays(days) });
  }
  if (use.level === 'warn') reasons.push({ level: 'warn', title: 'Uso', text: use.text });
  if (lateBillings) reasons.push({ level: 'warn', title: 'Cobrança', text: `${lateBillings} mensalidade${lateBillings > 1 ? 's' : ''} atrasada${lateBillings > 1 ? 's' : ''}` });

  const known = [site, database, domain, use].filter((c) => c.level !== 'unknown');
  const level = reasons.length ? worst(reasons.map((r) => r.level)) : known.length ? 'ok' : 'unknown';
  return { level: /** @type {Level} */ (level), reasons, site, database, domain, usage: use };
}

export const HEALTH_LABEL = { ok: 'Tudo ok', warn: 'Atenção', error: 'Problema', unknown: 'Sem verificação' };

/**
 * Dinheiro do projeto: recorrente (mensalidades × custo dos serviços, já com o rateio dos compartilhados)
 * e realizado (pagamentos, implantação e lançamentos). Custo dos serviços no ano = custo mensal × meses
 * desde o início do projeto neste ano (estimativa).
 * @param {{
 *   subs: { id: string, status: string, monthlyAmount: number | null, billingDay: number | null, since: string }[],
 *   monthlyCost: number,
 *   startDate?: string | null,
 *   setup?: { amount: number | null, paidOn: string | null },
 *   entries: { kind: string, amount: number, occurredOn: string }[],
 *   payments: { subscriptionId: string, month: string, amount: number }[],
 *   todayKey?: string,
 * }} input
 */
export function siteMoney({ subs, monthlyCost: cost, startDate = null, setup = { amount: null, paidOn: null }, entries, payments, todayKey = today() }) {
  const month = monthKey(todayKey);
  const year = todayKey.slice(0, 4);
  const mine = new Set(subs.map((s) => s.id));
  const ownPayments = payments.filter((p) => mine.has(p.subscriptionId));
  const active = subs.filter((s) => s.status === 'active');
  const mrr = active.reduce((sum, s) => sum + (s.monthlyAmount ?? 0), 0);
  const sumIf = (/** @type {(e: any) => boolean} */ test) => entries.filter(test).reduce((s, e) => s + e.amount, 0);
  const receivedMonth = ownPayments.filter((p) => p.month === month).reduce((s, p) => s + p.amount, 0);
  const setupYear = setup.paidOn?.startsWith(year) ? setup.amount ?? 0 : 0;
  const receivedYear = ownPayments.filter((p) => p.month.startsWith(year)).reduce((s, p) => s + p.amount, 0) + setupYear;
  const extraRevenueYear = sumIf((e) => e.kind === 'revenue' && e.occurredOn.startsWith(year));
  const extraCostYear = sumIf((e) => e.kind === 'cost' && e.occurredOn.startsWith(year));
  const currentMonth = Number(todayKey.slice(5, 7));
  const fromMonth = startDate && startDate.slice(0, 4) === year ? Number(startDate.slice(5, 7)) : startDate && startDate.slice(0, 4) > year ? currentMonth + 1 : 1;
  const servicesYear = cost * Math.max(0, currentMonth - fromMonth + 1);
  const states = active.map((s) => billingStatus(s, payments, month, todayKey));
  return {
    mrr,
    monthlyCost: cost,
    margin: mrr - cost,
    receivedMonth,
    expectedMonth: active.filter((_, i) => states[i] !== 'none').reduce((s, x) => s + (x.monthlyAmount ?? 0), 0),
    lateBillings: states.filter((s) => s === 'late').length,
    setupDue: setup.amount && !setup.paidOn ? setup.amount : 0,
    extraRevenueMonth: sumIf((e) => e.kind === 'revenue' && e.occurredOn.startsWith(month)),
    extraCostMonth: sumIf((e) => e.kind === 'cost' && e.occurredOn.startsWith(month)),
    year: {
      revenue: receivedYear + extraRevenueYear,
      cost: extraCostYear + servicesYear,
      result: receivedYear + extraRevenueYear - extraCostYear - servicesYear,
    },
  };
}
