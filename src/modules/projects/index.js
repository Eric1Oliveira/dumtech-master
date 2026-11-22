// Projetos — cada site ou sistema do começo ao fim: Proposta → Em construção → Publicado → Encerrado.
// #/projects (lista) · #/projects/novo (Novo projeto) · #/projects/<id> (página). #/products/... redireciona.

import { html } from '../../shared/utils/dom.js';
import { formatMoney, formatDate } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { PRODUCT_KINDS, PRODUCT_STATUS } from '../../core/catalog.js';
import { labelOf } from '../../core/validate.js';
import { canDo } from '../../services/auth.js';
import { listPage, statusPill } from '../../shared/components/list-page.js';
import { icon } from '../../shared/components/icons.js';
import { monitorBadge, renewalBadge } from '../infrastructure/index.js';
import { loadProjects, summarizeProject } from './project-data.js';
import { renderProjectPage } from './project-page.js';
import { renderProjectWizard } from './project-wizard.js';

/** @typedef {ReturnType<typeof summarizeProject>} Project */

const muted = (/** @type {string} */ text = '—') => html`<span class="muted">${text}</span>`;
const STAGE_RANK = { building: 0, proposal: 1, live: 2, ended: 3 };

/** @param {import('../index.js').ModuleContext} ctx */
export async function render(ctx) {
  if (ctx.route.section === 'novo' || ctx.route.section === 'cadastrar') return renderProjectWizard(ctx);
  if (ctx.route.section) return renderProjectPage(ctx, ctx.route.section);
  return renderList(ctx);
}

/** O que vem a seguir: prazo da construção ou próximo vencimento. @param {Project} s */
function nextThing(s) {
  if (s.product.status === 'building' && s.product.dueDate) return html`<span class="person"><span class="mono">${formatDate(s.product.dueDate)}</span><small>entrega · ${s.progress.done}/${s.progress.total} tarefas</small></span>`;
  if (s.product.status === 'building') return html`<small class="muted">${s.progress.done}/${s.progress.total} tarefas</small>`;
  if (s.product.status === 'live') return renewalBadge(s.nextRenewal);
  if (s.product.status === 'proposal') {
    const open = s.proposals.find((x) => x.status === 'sent' || x.status === 'draft');
    return open ? html`<small class="muted">${open.status === 'sent' ? 'proposta enviada' : 'proposta em rascunho'}</small>` : muted();
  }
  return muted();
}

/** @param {import('../index.js').ModuleContext} ctx */
async function renderList({ root, module, signal }) {
  const { org } = getState();
  const manage = canDo('products.manage');
  const seeInfra = canDo('infra.view');

  const page = listPage(/** @type {import('../../shared/components/list-page.js').ListPageOptions<Project>} */ ({
    root,
    module,
    signal,
    title: 'Projetos',
    sub: `Sites e sistemas de ${org.name}, do começo ao fim`,
    newLabel: null,
    actions: manage ? html`<a class="btn btn--primary" href="#/projects/novo">${icon('plus')}<span>Novo projeto</span></a>` : '',
    statuses: PRODUCT_STATUS,
    statusOf: (s) => s.product.status,
    searchOf: (s) => `${s.product.name} ${s.product.url ?? ''} ${s.customers.map((c) => c.name).join(' ')} ${s.product.description}`,
    searchLabel: 'Projeto, cliente ou endereço',
    sort: { key: 'stage', dir: 'asc' },
    empty: {
      title: 'Nenhum projeto ainda',
      text: manage ? 'Use “Novo projeto”: cliente, o que inclui e os valores, em 4 passos.' : 'Quando a equipe criar projetos, eles aparecem aqui.',
    },
    columns: [
      {
        key: 'name',
        label: 'Projeto',
        sortValue: (s) => s.product.name,
        render: (s) => html`<span class="person">
          <a class="link-strong" href="#/projects/${s.product.id}">${s.product.name}</a>
          <small>${labelOf(PRODUCT_KINDS, s.product.kind)}${s.customers.length ? ` · ${s.customers.map((c) => c.name).join(', ')}` : ''}</small>
        </span>`,
      },
      { key: 'stage', label: 'Etapa', sortValue: (s) => STAGE_RANK[s.product.status], render: (s) => statusPill(PRODUCT_STATUS, s.product.status) },
      {
        key: 'up',
        label: 'No ar',
        hideOnMobile: true,
        sortValue: (s) => s.monitors.find((m) => m.kind === 'site')?.state ?? 'zz',
        render: (s) => {
          const site = s.monitors.find((m) => m.kind === 'site');
          return site ? monitorBadge(site) : muted();
        },
      },
      { key: 'monthly', label: 'Mensalidade', align: 'end', sortValue: (s) => s.monthly, render: (s) => (s.monthly ? html`<span class="mono">${formatMoney(s.monthly)}</span>` : muted()) },
      ...(seeInfra
        ? [{
            key: 'profit',
            label: 'Lucro/mês',
            align: /** @type {const} */ ('end'),
            hideOnMobile: true,
            sortValue: (/** @type {Project} */ s) => s.monthly - s.money.monthlyCost,
            render: (/** @type {Project} */ s) => {
              const profit = s.monthly - s.money.monthlyCost;
              return s.monthly || s.money.monthlyCost ? html`<span class="mono ${profit < 0 ? 'amount--out' : ''}">${formatMoney(profit)}</span>` : muted();
            },
          }]
        : []),
      { key: 'next', label: 'A seguir', hideOnMobile: true, sortValue: (s) => s.product.dueDate ?? s.nextRenewal ?? '9999', render: nextThing },
    ],
  }));

  try {
    const bundle = await loadProjects(org.id);
    if (!signal.aborted) page.show(bundle.products.map((p) => summarizeProject(p, bundle)));
  } catch (error) {
    if (!signal.aborted) page.fail(error);
  }
}
