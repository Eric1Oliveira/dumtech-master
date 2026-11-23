// Regras dos Serviços (infra_assets; espelho das migrations 0009 e 0013).
// Compartilhado = usado por vários projetos (asset_projects); exclusivo = de um projeto (productId).

import { requiredText, optionalText, longText, money, dateOrNull, pick, idOrNull, urlOrNull, today } from './validate.js';
import { normalizeSchedule } from './monitor.js';

export const ASSET_KINDS = /** @type {const} */ ([
  { key: 'domain', label: 'Domínio', icon: 'globe' },
  { key: 'hosting', label: 'Hospedagem', icon: 'server' },
  { key: 'database', label: 'Banco de dados', icon: 'database' },
  { key: 'repository', label: 'Repositório', icon: 'book' },
  { key: 'email', label: 'E-mail', icon: 'mail' },
  { key: 'server', label: 'Servidor', icon: 'server' },
  { key: 'service', label: 'Outro serviço', icon: 'package' },
]);

export const COST_PERIODS = /** @type {const} */ ([
  { key: 'monthly', label: 'por mês' },
  { key: 'yearly', label: 'por ano' },
  { key: 'once', label: 'pagamento único' },
]);

/** Como um compartilhado entra no custo de cada projeto. */
export const SPLIT_RULES = /** @type {const} */ ([
  { key: 'equal', label: 'Dividir igual entre os projetos' },
  { key: 'fixed', label: 'Valor fixo por projeto' },
  { key: 'company', label: 'Só da empresa (não divide)' },
]);

/**
 * @typedef {Object} AssetInput
 * @property {string} name
 * @property {'domain' | 'hosting' | 'database' | 'repository' | 'email' | 'server' | 'service'} kind
 * @property {string | null} provider
 * @property {boolean} shared
 * @property {'equal' | 'fixed' | 'company' | null} split
 * @property {number | null} fixedShare
 * @property {string | null} productId   exclusivo: o projeto dono
 * @property {string | null} url
 * @property {string | null} renewsAt
 * @property {boolean} renewsAuto        data buscada no registro do domínio
 * @property {number | null} cost
 * @property {'monthly' | 'yearly' | 'once' | null} costPeriod
 * @property {number | null} price       quanto se cobra do cliente (por projeto que usa)
 * @property {'monthly' | 'yearly' | 'once' | null} pricePeriod
 * @property {'active' | 'inactive'} status
 * @property {string | null} ownerId
 * @property {string} notes
 */

/** Endereço que o servidor pode vigiar: https público (nunca a rede interna). */
export const MONITORABLE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/.*)?$/i;
const INTERNAL = /^https:\/\/(localhost|[^/]*\.(local|internal))([:/]|$)/i;
/** @param {string | null | undefined} url */
export const isPublicHttps = (url) => Boolean(url) && MONITORABLE.test(String(url)) && !INTERNAL.test(String(url));

const on = (/** @type {unknown} */ v) => v === true || v === 'on' || v === 'true';

/** @param {Record<string, any>} input @returns {AssetInput} */
export function normalizeAsset(input) {
  const shared = on(input.shared);
  const cost = money(input.cost, 'Custo');
  const price = money(input.price, 'Preço ao cliente');
  const split = shared ? pick(SPLIT_RULES, input.split, 'equal') : null;
  const fixedShare = split === 'fixed' ? money(input.fixedShare, 'Valor por projeto') : null;
  if (split === 'fixed' && fixedShare === null) throw new Error('Informe o valor fixo que cada projeto paga deste serviço.');
  return {
    name: requiredText(input.name, 'O nome', 2, 120),
    kind: pick(ASSET_KINDS, input.kind, 'service'),
    provider: optionalText(input.provider, 'Fornecedor', 80),
    shared,
    split,
    fixedShare,
    productId: shared ? null : idOrNull(input.productId),
    url: urlOrNull(input.url, 'Endereço'),
    renewsAt: dateOrNull(input.renewsAt, 'Vencimento'),
    renewsAuto: on(input.renewsAuto),
    cost,
    costPeriod: cost === null ? null : pick(COST_PERIODS, input.costPeriod, 'monthly'),
    price,
    pricePeriod: price === null ? null : pick(COST_PERIODS, input.pricePeriod, 'monthly'),
    status: input.status === 'inactive' ? 'inactive' : 'active',
    ownerId: idOrNull(input.ownerId),
    notes: longText(input.notes, 'Observações'),
  };
}

export const MONITOR_KINDS = /** @type {const} */ ([
  { key: 'site', label: 'Site' },
  { key: 'database', label: 'Banco de dados' },
  { key: 'service', label: 'Serviço' },
]);

/** Monitor (o que o servidor vigia). Endereço próprio só para o tipo serviço; site e banco leem do projeto/serviço. @param {Record<string, any>} input */
export function normalizeMonitor(input) {
  const url = urlOrNull(input.url, 'Endereço');
  if (url && !isPublicHttps(url)) throw new Error('Para monitorar, informe um endereço https público (ex.: https://app.dumtech.com.br).');
  const productId = idOrNull(input.productId);
  const assetId = idOrNull(input.assetId);
  if (!productId && !assetId && !url) throw new Error('Diga o que monitorar: o site de um projeto, um serviço ou um endereço.');
  return {
    productId,
    assetId,
    kind: pick(MONITOR_KINDS, input.kind, 'service'),
    label: requiredText(input.label, 'O nome', 1, 120),
    url,
    enabled: input.enabled !== false && input.enabled !== 'false',
    ...normalizeSchedule(input),
  };
}

/** Valor mensal equivalente: anual ÷ 12; pagamento único não entra. @param {number | null | undefined} value @param {string | null | undefined} period */
export const monthlyEquivalent = (value, period) =>
  !value ? 0 : period === 'yearly' ? value / 12 : period === 'once' ? 0 : value;

/** Custo mensal equivalente de um serviço ativo (o custo inteiro, sem rateio). @param {{ cost: number | null, costPeriod: string | null, status: string }} a */
export const monthlyCost = (a) => (a.status !== 'active' ? 0 : monthlyEquivalent(a.cost, a.costPeriod));

/** Dias até o vencimento (negativo = vencido). @param {string | null} date */
export function daysUntil(date, todayKey = today()) {
  if (!date) return null;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 864e5);
}
