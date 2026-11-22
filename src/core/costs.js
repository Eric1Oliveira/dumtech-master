// Quanto cada projeto custa por mês, com a parte dos serviços compartilhados (spec 5.1).
// Só pagam serviço os projetos Em construção ou Publicados; proposta e encerrado não entram no rateio.

import { monthlyEquivalent } from './infra.js';

const PAYING = new Set(['building', 'live']);
const round2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/**
 * @typedef {{ id: string, shared: boolean, split: string | null, fixedShare: number | null, productId: string | null,
 *   cost: number | null, costPeriod: string | null, status: string }} CostAsset
 */

/**
 * @param {{ assets: CostAsset[], links: { assetId: string, productId: string }[], projects: { id: string, status: string }[] }} input
 */
export function serviceCosts({ assets, links, projects }) {
  const stage = new Map(projects.map((p) => [p.id, p.status]));
  /** @type {Map<string, Set<string>>} todos os projetos marcados em cada compartilhado */
  const linked = new Map();
  /** @type {Map<string, string[]>} os que pagam (construção/publicado) */
  const paying = new Map();
  for (const l of links) {
    (linked.get(l.assetId) ?? linked.set(l.assetId, new Set()).get(l.assetId))?.add(l.productId);
    if (PAYING.has(stage.get(l.productId) ?? '')) (paying.get(l.assetId) ?? paying.set(l.assetId, []).get(l.assetId))?.push(l.productId);
  }
  const active = assets.filter((a) => a.status === 'active');
  const full = (/** @type {CostAsset} */ a) => monthlyEquivalent(a.cost, a.costPeriod);

  /** Parte mensal de um compartilhado por projeto; `extra` = projetos a mais (prévia do Novo projeto). */
  const shareOf = (/** @type {CostAsset} */ a, extra = 0) => {
    if (!a.shared || a.status !== 'active' || a.split === 'company') return 0;
    if (a.split === 'fixed') return a.fixedShare ?? 0;
    const n = (paying.get(a.id)?.length ?? 0) + extra;
    return n ? round2(full(a) / n) : 0;
  };

  /**
   * Custo mensal do projeto. `projected` = como ficaria se ele passasse a pagar (projeto em proposta).
   * @param {string} productId
   */
  const projectCost = (productId, projected = false) => {
    let total = 0;
    for (const a of active) {
      if (!a.shared) {
        if (a.productId === productId) total += full(a);
      } else if (linked.get(a.id)?.has(productId)) {
        const pays = paying.get(a.id)?.includes(productId);
        total += pays ? shareOf(a) : projected ? shareOf(a, 1) : 0;
      }
    }
    return round2(total);
  };

  /** Quanto do custo do compartilhado os projetos cobrem. @param {CostAsset} a */
  const coverage = (a) => {
    const users = paying.get(a.id)?.length ?? 0;
    const monthly = round2(full(a));
    const covered = a.split === 'company' ? 0 : a.split === 'fixed' ? round2(users * (a.fixedShare ?? 0)) : users ? monthly : 0;
    return { users, monthly, covered, gap: round2(monthly - covered) };
  };

  const total = round2(active.reduce((s, a) => s + full(a), 0));
  const shared = round2(active.filter((a) => a.shared).reduce((s, a) => s + full(a), 0));
  return {
    shareOf,
    projectCost,
    coverage,
    /** projetos marcados num compartilhado (qualquer etapa) */
    projectsOf: (/** @type {string} */ assetId) => [...(linked.get(assetId) ?? [])],
    total,
    shared,
    exclusive: round2(total - shared),
  };
}

/** Mensalidades (MRR): soma das mensalidades ativas — a mesma conta em todas as telas. @param {{ status: string, monthlyAmount: number | null }[]} subs */
export const mrr = (subs) => round2(subs.filter((s) => s.status === 'active').reduce((sum, s) => sum + (s.monthlyAmount ?? 0), 0));
