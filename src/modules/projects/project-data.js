// Junta, para os projetos, o que cada parte do sistema sabe: serviços (custo com rateio dos compartilhados,
// vencimentos), monitores (no ar), mensalidades e pagamentos, tarefas, propostas e uso. Cada fonte só
// entra se o papel permitir; sem permissão, a tela mostra "sem acesso" em vez de inventar.

import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { today } from '../../core/validate.js';
import { monthKey, billingStatus } from '../../core/billing.js';
import { siteHealth, siteMoney } from '../../core/sites.js';
import { serviceCosts } from '../../core/costs.js';
import { checklistProgress } from '../../core/projects.js';

/** @typedef {import('../../services/data.js').Product} Product */

/**
 * @param {string} orgId
 * @param {string} [productId]  só um projeto (página) ou todos (lista)
 */
export async function loadProjects(orgId, productId) {
  const filter = productId ? { productId } : {};
  const [products, subs, assets, links, monitors, entries, payments, keys, daily, tasks, proposals, files] = await Promise.all([
    data.products.list(orgId),
    data.customerProducts.list(orgId, filter),
    canDo('infra.view') ? data.assets.list(orgId) : null,
    data.assetLinks.list(orgId).catch(() => []),
    data.monitors.list(orgId).catch(() => []),
    data.productEntries.list(orgId, filter),
    canDo('customers.view') ? data.payments.list(orgId) : null,
    canDo('analytics.view') ? data.analytics.keys(orgId).catch(() => null) : null,
    canDo('analytics.view') ? data.analytics.daily(orgId, 30).catch(() => []) : [],
    canDo('projects.view') ? data.tasks.list(orgId, filter).catch(() => []) : [],
    canDo('proposals.view') ? data.proposals.list(orgId).catch(() => []) : [],
    canDo('workspace.view') ? data.files.list(orgId).catch(() => null) : null,
  ]);
  const costs = serviceCosts({ assets: assets ?? [], links, projects: products });
  return { products, subs, assets, links, monitors, entries, payments, keys, daily, tasks, proposals, files, costs };
}

/** @typedef {Awaited<ReturnType<typeof loadProjects>>} ProjectsBundle */

/**
 * Tudo o que a lista e a página mostram de um projeto.
 * @param {Product} product
 * @param {ProjectsBundle} bundle
 * @param {string} [todayKey]
 */
export function summarizeProject(product, bundle, todayKey = today()) {
  const subs = bundle.subs.filter((s) => s.productId === product.id);
  const own = bundle.assets ? bundle.assets.filter((a) => !a.shared && a.productId === product.id) : null;
  const shared = bundle.assets ? bundle.assets.filter((a) => a.shared && bundle.links.some((l) => l.assetId === a.id && l.productId === product.id)) : null;
  const monitors = bundle.monitors.filter((m) => m.productId === product.id);
  const entries = bundle.entries.filter((e) => e.productId === product.id);
  const tasks = bundle.tasks.filter((t) => t.productId === product.id).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  const proposals = bundle.proposals.filter((p) => p.productId === product.id);
  const payments = bundle.payments ?? [];
  const tracked = bundle.keys ? bundle.keys.some((k) => k.productId === product.id && !k.revokedAt) : null;
  const days = bundle.daily.filter((d) => d.productId === product.id && d.events > 0);
  /** @type {import('../../core/sites.js').SiteUsage} */
  const usage = tracked ? { events: days.reduce((s, d) => s + d.events, 0), lastDay: days.map((d) => d.day).sort().at(-1) ?? null } : null;
  const monthlyCost = bundle.assets ? bundle.costs.projectCost(product.id, product.status === 'proposal') : 0;
  const money = siteMoney({
    subs,
    monthlyCost,
    startDate: product.startDate,
    setup: { amount: product.setupAmount, paidOn: product.setupPaidOn },
    entries,
    payments,
    todayKey,
  });
  const health = siteHealth({ monitors, assets: own ?? [], usage, lateBillings: bundle.payments ? money.lateBillings : 0, todayKey });
  const month = monthKey(todayKey);
  const nextRenewal = [...(own ?? []), ...(shared ?? [])]
    .filter((a) => a.status === 'active' && a.renewsAt)
    .map((a) => /** @type {string} */ (a.renewsAt))
    .sort()[0] ?? null;
  const live = subs.filter((s) => s.status !== 'cancelled');
  return {
    product,
    subs,
    own,
    shared,
    monitors,
    entries,
    tasks,
    proposals,
    /** arquivos do projeto (null = sem acesso ou Storage fora) */
    files: bundle.files ? bundle.files.filter((f) => f.productId === product.id) : null,
    usage,
    tracked,
    money,
    health,
    nextRenewal,
    progress: checklistProgress(tasks),
    /** mensalidade combinada (antes de publicar) ou cobrada (publicado) */
    monthly: product.status === 'live' ? money.mrr : live.reduce((s, x) => s + (x.monthlyAmount ?? 0), 0),
    activeSubs: subs.filter((s) => s.status === 'active').length,
    customers: [...new Map(live.map((s) => [s.customerId, s.customerName])).entries()].map(([id, name]) => ({ id, name })),
    /** situação da mensalidade deste mês por assinatura (null = sem permissão para ver pagamentos) */
    billing: bundle.payments ? Object.fromEntries(subs.map((s) => [s.id, billingStatus(s, payments, month, todayKey)])) : null,
    paymentOf: (/** @type {string} */ subId) => payments.find((p) => p.subscriptionId === subId && p.month === month) ?? null,
  };
}
