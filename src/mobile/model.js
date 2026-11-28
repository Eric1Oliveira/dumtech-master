// O que a função `mobile` devolve (mobile_snapshot: linhas do banco, como a API) → os mesmos
// objetos e as mesmas contas do computador (rows.js + boards.js). Regra pura: testada no Node.

import { ROWS } from '../services/rows.js';
import { todayBoard, moneyBoard } from '../core/boards.js';
import { serviceCosts } from '../core/costs.js';

/** @param {any} raw */
export function buildModel(raw) {
  /** @param {keyof typeof ROWS} key */
  const list = (key) => /** @type {any[]} */ (raw[key] ?? []).map(/** @type {any} */ (ROWS[key]));
  const permissions = new Set(/** @type {string[]} */ (raw.permissions ?? []));
  const can = (/** @type {string} */ p) => permissions.has(p);
  const products = list('products');
  const subs = list('subs');
  const payments = raw.payments ? list('payments') : null;
  const customers = list('customers');
  const contacts = list('contacts');
  const monitors = list('monitors');
  const assets = list('assets');
  const links = list('links');
  const tasks = list('tasks');
  const proposals = list('proposals');
  const entries = list('entries');
  const todayKey = String(raw.today);
  const projectName = new Map(products.map((p) => [p.id, p.name]));
  const today = can('dashboard.view')
    ? todayBoard({ products, subs, payments, customers, contacts, monitors, assets, links, tasks, proposals, billing: raw.billing }, { todayKey, me: raw.me?.id ?? null, can })
    : null;
  const money = can('finance.view') && can('products.view') && can('customers.view')
    ? moneyBoard({ products, subs, payments: payments ?? [], assets, links, entries }, { todayKey, can })
    : null;
  return {
    me: raw.me ?? { id: '', name: '' },
    org: raw.org ?? { id: '', name: '', role: 'viewer' },
    device: raw.device ?? null,
    vapid: raw.vapid ?? null,
    generatedAt: raw.generated_at ?? new Date().toISOString(),
    todayKey,
    can,
    billing: raw.billing ?? null,
    products,
    subs,
    payments,
    customers,
    contacts,
    monitors: monitors.map((m) => ({ ...m, name: m.productId && projectName.get(m.productId) ? `${projectName.get(m.productId)} · ${m.label}` : m.label })),
    assets,
    tasks,
    proposals,
    incidents: list('incidents'),
    uptime: new Map(list('uptime').map((u) => [u.monitorId, u])),
    notifications: list('notifications'),
    costs: can('infra.view') ? serviceCosts({ assets, links, projects: products }) : null,
    today,
    money,
  };
}

/** @typedef {ReturnType<typeof buildModel>} Model */

/** Disponibilidade em %, ou null sem verificações. @param {number} ok @param {number} checks */
export const pct = (ok, checks) => (checks ? Math.floor((ok / checks) * 10000) / 100 : null);

const TONE_RANK = { error: 3, warn: 2, info: 1, ok: 0 };
const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) => `${n} ${n === 1 ? one : many}`;

/**
 * Veredito do Hoje numa linha: as duas coisas mais urgentes, na ordem de prioridade.
 * @param {{ kind: string, tone: string }[]} items
 * @returns {{ tone: 'error' | 'warn' | 'info' | 'ok', text: string }}
 */
export function verdict(items) {
  if (!items.length) return { tone: 'ok', text: 'Tudo em dia.' };
  /** @type {Map<string, number>} */
  const count = new Map();
  for (const i of items) {
    const key = i.kind === 'billing' ? (i.tone === 'error' ? 'billing-late' : 'billing') : i.kind;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  /** @type {[string, (n: number) => string][]} */
  const PHRASES = [
    ['down', (n) => plural(n, 'site fora do ar', 'sites fora do ar')],
    ['billing-late', (n) => plural(n, 'cobrança atrasada', 'cobranças atrasadas')],
    ['billing', (n) => plural(n, 'cobrança para fazer', 'cobranças para fazer')],
    ['setup', (n) => plural(n, 'implantação a receber', 'implantações a receber')],
    ['renewal', (n) => plural(n, 'vencimento perto', 'vencimentos perto')],
    ['adjust', (n) => plural(n, 'reajuste para decidir', 'reajustes para decidir')],
    ['unstable', (n) => plural(n, 'site oscilando', 'sites oscilando')],
    ['task', (n) => plural(n, 'tarefa para hoje', 'tarefas para hoje')],
    ['proposal', (n) => plural(n, 'proposta esperando', 'propostas esperando')],
  ];
  const parts = PHRASES.filter(([k]) => count.has(k)).map(([k, text]) => text(/** @type {number} */ (count.get(k))));
  const tone = /** @type {'error' | 'warn' | 'info' | 'ok'} */ (items.reduce((t, i) => ((TONE_RANK[/** @type {keyof typeof TONE_RANK} */ (i.tone)] ?? 0) > TONE_RANK[t] ? i.tone : t), 'ok'));
  const rest = parts.length - 2;
  return { tone, text: `${parts.slice(0, 2).join(' · ')}${rest > 0 ? ` e mais ${rest}` : ''}.` };
}

/**
 * Luz do topo (todas as telas): fora do ar ou cobrança atrasada = vermelho; oscilando, cobrança
 * do dia ou vencimento em 7 dias = âmbar. Tarefa e proposta não acendem a luz.
 * @param {Model} m
 */
export function health(m) {
  const items = m.today?.items ?? [];
  if (m.monitors.some((x) => x.enabled && x.state === 'down') || items.some((i) => i.kind === 'billing' && i.tone === 'error')) return 'error';
  if (m.monitors.some((x) => x.enabled && (x.state === 'slow' || x.state === 'unstable')) || items.some((i) => i.kind === 'billing' || (i.kind === 'renewal' && i.tone === 'error'))) return 'warn';
  return 'ok';
}

/** Link do computador (aviso, item do Hoje) → tela do celular. @param {string | null | undefined} link */
export function phoneRoute(link) {
  const [, area, id] = /^#\/([^/?]+)(?:\/([^/?]+))?/.exec(link ?? '') ?? [];
  switch (area) {
    case 'projects':
    case 'products':
      return id && id !== 'novo' ? `#/projetos/${id}` : '#/projetos';
    case 'customers':
      return id ? `#/clientes/${id}` : '#/clientes';
    case 'infrastructure':
      return '#/no-ar';
    case 'finance':
      return '#/dinheiro';
    case 'proposals':
      return '#/propostas';
    case 'dashboard':
    case 'workspace':
      return '#/hoje';
    case 'settings':
      return id === 'mobile' ? '#/ajustes' : '#/avisos';
    default:
      return '#/avisos';
  }
}
