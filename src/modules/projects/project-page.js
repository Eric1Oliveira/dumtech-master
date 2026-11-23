// Página do projeto (#/projects/<id>): a etapa e o próximo passo no topo; depois o que importa em cada
// etapa — proposta, construção (checklist), no ar, quem paga, quanto dá e o que o projeto usa.

import { html, setHtml, $, bindActions } from '../../shared/utils/dom.js';
import { formatDate, formatMoney, formatMonth, formatInteger, formatRelative } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { PRODUCT_KINDS, PRODUCT_STATUS } from '../../core/catalog.js';
import { ASSET_KINDS, monthlyEquivalent } from '../../core/infra.js';
import { NEXT_STEPS, TASK_STATUS } from '../../core/projects.js';
import { PROPOSAL_STATUS, proposalNumber } from '../../core/proposals.js';
import { ENTRY_KINDS, HEALTH_LABEL } from '../../core/sites.js';
import { monthKey } from '../../core/billing.js';
import { dayLabel } from '../../core/today.js';
import { labelOf, today } from '../../core/validate.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { statusPill } from '../../shared/components/list-page.js';
import { openRecordDialog, memberOptions } from '../../shared/components/record-form.js';
import { openDialog, confirmDialog } from '../../shared/components/dialog.js';
import { dataTable } from '../../shared/components/table.js';
import { emptyState, loadError, toast, toastError } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';
import { FILE_MAX_BYTES, formatBytes } from '../../core/workspace.js';
import { causeText, durationText, uptime, pctText, blocks, msStats, responseSeries } from '../../core/monitor.js';
import { uptimeStrip, drawLineChart } from '../../shared/components/charts.js';
import { renewalBadge, editAsset, monitorBadge, editSchedule } from '../infrastructure/index.js';
import { scheduleText } from '../../core/monitor.js';
import { linkSubscription, editSubscription, markPaid, undoPayment, monthCell } from '../customers/billing-ui.js';
import { loadProjects, summarizeProject } from './project-data.js';
import { editProject } from './project-form.js';
import { newPage } from '../workspace/new-page.js';

/** @typedef {ReturnType<typeof summarizeProject>} Project */
/** @typedef {import('../../services/data.js').Asset} Asset */

const LEVEL_ICON = /** @type {const} */ ({ ok: 'check', warn: 'alert', error: 'alert', unknown: 'clock' });
const muted = (/** @type {string} */ text = '—') => html`<span class="muted">${text}</span>`;
const host = (/** @type {string} */ url) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
const periodShort = (/** @type {string | null} */ p) => (p === 'yearly' ? '/ano' : p === 'once' ? ' único' : '/mês');
const STAGES = PRODUCT_STATUS.filter((s) => s.key !== 'ended');

/**
 * @param {import('../index.js').ModuleContext} ctx
 * @param {string} id
 */
export async function renderProjectPage({ root, module, signal }, id) {
  const { org } = getState();
  const manage = canDo('products.manage');
  const manageInfra = canDo('infra.manage');
  const manageTasks = canDo('projects.manage');
  const manageBilling = canDo('customers.manage');
  setHtml(root, html`<div class="skeleton"></div>`);

  /** @type {Project | null} */
  let p = null;
  /** @type {Awaited<ReturnType<typeof loadProjects>> | null} */
  let bundle = null;

  const load = async () => {
    bundle = await loadProjects(org.id, id);
    const product = bundle.products.find((x) => x.id === id);
    p = product ? summarizeProject(product, bundle) : null;
  };

  const draw = () => {
    if (!p) {
      setHtml(root, emptyState({ title: 'Projeto não encontrado', text: 'Ele pode ter sido excluído.', action: { label: 'Voltar aos projetos', href: '#/projects' } }));
      return;
    }
    const s = p;
    const pr = s.product;
    document.title = `${pr.name} · ${module.name} — DUMTech Master`;
    const stage = pr.status;
    const sections = {
      proposal: () => [proposalPanel(s), notebookPanel(), kitPanel(), subsPanel(), filesPanel()],
      building: () => [checklistPanel(), notebookPanel(), kitPanel(), subsPanel(), filesPanel(), s.proposals.length ? proposalPanel(s) : ''],
      live: () => [uptimePanel(), subsPanel(), moneyPanel(s), notebookPanel(), kitPanel(), entriesPanel(), filesPanel(), s.tasks.length ? checklistPanel(true) : '', s.proposals.length ? proposalPanel(s) : ''],
      ended: () => [subsPanel(), notebookPanel(), kitPanel(), entriesPanel(), filesPanel(), s.proposals.length ? proposalPanel(s) : ''],
    };
    setHtml(
      root,
      html`<header class="page-head">
          <div>
            <p class="eyebrow"><a class="back-link" href="#/projects">${icon('arrowLeft')}Projetos</a></p>
            <h1 class="page-title">${pr.name}</h1>
            <p class="page-sub page-sub--row">${labelOf(PRODUCT_KINDS, pr.kind)}
              ${s.customers.length ? html`· ${s.customers.map((c, i) => html`${i ? ', ' : ''}<a href="#/customers/${c.id}">${c.name}</a>`)}` : ''}
              ${statusPill(PRODUCT_STATUS, stage)}
              ${pr.url ? html`<a class="ext-link" href="${pr.url}" target="_blank" rel="noopener noreferrer">${host(pr.url)}${icon('external')}</a>` : ''}</p>
          </div>
          ${manage
            ? html`<div class="page-actions">
                <button type="button" class="btn btn--ghost" data-action="remove">${icon('trash')}<span>Excluir</span></button>
                <button type="button" class="btn btn--secondary" data-action="edit">${icon('edit')}<span>Editar</span></button>
              </div>`
            : ''}
        </header>
        ${stageBar(s, manage)}
        ${stage === 'live' ? html`${statusBanner(s)}${checkCards(s)}` : ''}
        ${numbers(s)}
        <div class="detail-layout">
          <div class="detail-main">${sections[stage]()}</div>
          <aside class="detail-aside">${factsPanel(s)}${stage === 'live' ? '' : monitorsPanel(s)}</aside>
        </div>`,
    );
    drawSubs();
    drawKit();
    drawEntries();
    drawFiles();
    if (stage === 'live') drawUptime();
  };

  // Seções ---------------------------------------------------------------------------
  const checklistPanel = (collapsed = false) => {
    const s = /** @type {Project} */ (p);
    const { total, done } = s.progress;
    const body = html`<progress class="progress" max="${Math.max(total, 1)}" value="${done}" aria-label="Checklist: ${done} de ${total} feitas"></progress>
      ${s.tasks.length
        ? html`<ul class="checklist">
            ${s.tasks.map(
              (t) => html`<li class="checklist__item ${t.status === 'done' ? 'is-done' : ''}">
                <label class="checklist__check">
                  <input type="checkbox" data-action="toggle-task" data-task="${t.id}" ${t.status === 'done' ? html`checked` : ''} ${manageTasks ? '' : html`disabled`}>
                  <span>${t.title}</span>
                </label>
                <span class="checklist__meta">${[t.assigneeName, t.dueDate ? `até ${formatDate(t.dueDate)}` : ''].filter(Boolean).join(' · ')}</span>
                ${manageTasks
                  ? html`<span class="row-actions">
                      <button type="button" class="icon-btn icon-btn--sm" data-action="edit-task" data-task="${t.id}" aria-label="Editar ${t.title}" title="Editar">${icon('edit')}</button>
                      <button type="button" class="icon-btn icon-btn--sm" data-action="remove-task" data-task="${t.id}" aria-label="Excluir ${t.title}" title="Excluir">${icon('trash')}</button>
                    </span>`
                  : ''}
              </li>`,
            )}
          </ul>`
        : emptyState({ title: 'Sem tarefas', text: 'Adicione o que falta para publicar.', compact: true })}`;
    const head = html`<header class="panel__head">
        <div><h2 class="panel__title" id="build-title">Construção</h2>
          <p class="panel__hint">${done} de ${total} feita${total === 1 ? '' : 's'}${s.product.dueDate ? ` · prazo ${formatDate(s.product.dueDate)}` : ''}</p></div>
        ${manageTasks && !collapsed ? html`<button type="button" class="btn btn--secondary btn--sm" data-action="new-task">${icon('plus')}<span>Tarefa</span></button>` : ''}
      </header>`;
    return collapsed
      ? html`<details class="panel panel--details"><summary class="panel__summary">${head}</summary>${body}</details>`
      : html`<section class="panel" aria-labelledby="build-title">${head}${body}</section>`;
  };

  const kitPanel = () => {
    const s = /** @type {Project} */ (p);
    if (!s.own) return html`<section class="panel"><header class="panel__head"><h2 class="panel__title">O que inclui</h2></header>${emptyState({ title: 'Sem acesso aos serviços', text: 'Seu papel não inclui Serviços.', compact: true })}</section>`;
    return html`<section class="panel" aria-labelledby="kit-title">
      <header class="panel__head">
        <div><h2 class="panel__title" id="kit-title">O que inclui</h2>
          <p class="panel__hint">Custo para o projeto: <strong>${formatMoney(s.money.monthlyCost)}/mês</strong>${s.product.status === 'proposal' ? ' (quando fechar)' : ''}</p></div>
        <div class="panel__tools">
          ${manage ? html`<button type="button" class="btn btn--secondary btn--sm" data-action="pick-shared">${icon('check')}<span>Compartilhados</span></button>` : ''}
          ${manageInfra ? html`<button type="button" class="btn btn--secondary btn--sm" data-action="add-asset">${icon('plus')}<span>Exclusivo</span></button>` : ''}
        </div>
      </header>
      <div data-kit></div>
    </section>`;
  };

  const subsPanel = () => html`<section class="panel" aria-labelledby="subs-title">
      <header class="panel__head">
        <div><h2 class="panel__title" id="subs-title">Clientes e mensalidades</h2>
          <p class="panel__hint">${/** @type {Project} */ (p).product.status === 'live' ? formatMonth(monthKey()) : 'Combinadas: começam a cobrar quando o projeto for publicado'}</p></div>
        ${manage && canDo('customers.view') ? html`<button type="button" class="btn btn--secondary btn--sm" data-action="link">${icon('plus')}<span>Cliente</span></button>` : ''}
      </header>
      <div data-subs></div>
    </section>`;

  const entriesPanel = () => html`<section class="panel" aria-labelledby="entries-title">
      <header class="panel__head">
        <div><h2 class="panel__title" id="entries-title">Gastos e ganhos avulsos</h2><p class="panel__hint">O que não é mensalidade nem serviço: freelancer, anúncio, venda avulsa</p></div>
        ${manage ? html`<button type="button" class="btn btn--secondary btn--sm" data-action="new-entry">${icon('plus')}<span>Lançar</span></button>` : ''}
      </header>
      <div data-entries></div>
    </section>`;

  const drawSubs = () => {
    const s = /** @type {Project} */ (p);
    $('[data-subs]', root)?.replaceChildren(
      dataTable({
        label: 'Clientes e mensalidades',
        rows: s.subs,
        sort: { key: 'customer', dir: 'asc' },
        empty: emptyState({ title: 'Ninguém paga por este projeto ainda', text: 'Adicione o cliente com o valor e o dia de vencimento.', compact: true }),
        columns: [
          {
            key: 'customer',
            label: 'Cliente',
            sortValue: (x) => x.customerName,
            render: (x) => html`<span class="person"><a class="link-strong" href="#/customers/${x.customerId}">${x.customerName}</a>
              <small>${x.status === 'pending' ? 'combinada · começa ao publicar' : x.status === 'cancelled' ? 'cancelada' : `desde ${formatDate(x.since)}`}</small></span>`,
          },
          { key: 'amount', label: 'Valor/mês', align: 'end', sortValue: (x) => x.monthlyAmount ?? 0, render: (x) => (x.monthlyAmount ? html`<span class="mono">${formatMoney(x.monthlyAmount)}</span>` : muted()) },
          { key: 'day', label: 'Vence', hideOnMobile: true, sortValue: (x) => x.billingDay ?? 99, render: (x) => (x.billingDay ? `dia ${x.billingDay}` : muted()) },
          ...(s.billing && s.product.status === 'live'
            ? [{ key: 'month', label: 'Este mês', render: (/** @type {any} */ x) => monthCell(/** @type {any} */ (s.billing)[x.id], s.paymentOf(x.id)) }]
            : []),
          {
            key: 'actions',
            label: 'Ações',
            align: /** @type {const} */ ('end'),
            render: (x) => html`<span class="row-actions">
              ${manageBilling && s.billing && x.status === 'active' && x.monthlyAmount
                ? s.paymentOf(x.id)
                  ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="undo-paid" data-sub="${x.id}">Desfazer</button>`
                  : html`<button type="button" class="btn btn--quiet btn--sm" data-action="paid" data-sub="${x.id}">${icon('check')}<span>Pago</span></button>`
                : ''}
              ${manage ? html`<button type="button" class="icon-btn icon-btn--sm" data-action="edit-sub" data-sub="${x.id}" aria-label="Editar mensalidade de ${x.customerName}" title="Editar mensalidade">${icon('edit')}</button>
                <button type="button" class="icon-btn icon-btn--sm" data-action="unlink" data-sub="${x.id}" aria-label="Remover ${x.customerName}" title="Remover">${icon('x')}</button>` : ''}
            </span>`,
          },
        ],
      }),
    );
  };

  const drawKit = () => {
    const s = /** @type {Project} */ (p);
    const slot = $('[data-kit]', root);
    if (!slot || !s.own || !s.shared || !bundle) return;
    const costs = bundle.costs;
    const projected = s.product.status === 'proposal';
    const paying = s.product.status === 'building' || s.product.status === 'live';
    /** @type {(Asset & { scope: 'shared' | 'own', share: number })[]} */
    const rows = [
      ...s.shared.map((a) => ({ ...a, scope: /** @type {const} */ ('shared'), share: paying ? costs.shareOf(a) : projected ? costs.shareOf(a, 1) : 0 })),
      ...s.own.map((a) => ({ ...a, scope: /** @type {const} */ ('own'), share: monthlyEquivalent(a.cost, a.costPeriod) })),
    ];
    slot.replaceChildren(
      dataTable({
        label: 'O que inclui',
        rows,
        sort: { key: 'name', dir: 'asc' },
        empty: emptyState({ title: 'Nenhum serviço ainda', text: 'Marque os compartilhados que ele usa (GitHub, Supabase, HostGator…) e cadastre os exclusivos (domínio, banco).', compact: true }),
        columns: [
          {
            key: 'name',
            label: 'Serviço',
            sortValue: (a) => `${a.scope}${a.name}`,
            render: (a) => html`<span class="person"><strong>${a.name}</strong>
              <small>${labelOf(ASSET_KINDS, a.kind)}${a.provider ? ` · ${a.provider}` : ''} · <span class="tag tag--${a.scope}">${a.scope === 'shared' ? 'compartilhado' : 'exclusivo'}</span>${a.status === 'inactive' ? ' · desativado' : ''}</small></span>`,
          },
          {
            key: 'cost',
            label: 'Custo/mês',
            align: 'end',
            sortValue: (a) => a.share,
            render: (a) => html`<span class="person person--end"><span class="mono">${formatMoney(a.share)}</span>
              <small>${a.scope === 'shared' ? (a.split === 'company' ? 'custo da empresa' : a.split === 'fixed' ? 'valor fixo por projeto' : `÷ ${Math.max(costs.coverage(a).users + (projected ? 1 : 0), 1)} projetos`) : a.cost !== null && a.costPeriod !== 'monthly' ? `${formatMoney(a.cost)}${periodShort(a.costPeriod)}` : ''}</small></span>`,
          },
          { key: 'price', label: 'Cobra', align: 'end', hideOnMobile: true, sortValue: (a) => a.price ?? 0, render: (a) => (a.price ? html`<span class="mono">${formatMoney(a.price)}</span><small class="muted">${periodShort(a.pricePeriod)}</small>` : muted()) },
          { key: 'renews', label: 'Vence', hideOnMobile: true, sortValue: (a) => a.renewsAt ?? '9999', render: (a) => renewalBadge(a.renewsAt) },
          {
            key: 'actions',
            label: 'Ações',
            align: /** @type {const} */ ('end'),
            render: (a) => html`<span class="row-actions">
              ${a.scope === 'own' && manageInfra ? html`<button type="button" class="icon-btn icon-btn--sm" data-action="edit-asset" data-asset="${a.id}" aria-label="Editar ${a.name}" title="Editar">${icon('edit')}</button>` : ''}
              ${a.scope === 'shared' && manage ? html`<button type="button" class="icon-btn icon-btn--sm" data-action="unpick" data-asset="${a.id}" aria-label="Tirar ${a.name} do projeto" title="Tirar do projeto">${icon('x')}</button>` : ''}
            </span>`,
          },
        ],
      }),
    );
  };

  const manageFiles = canDo('workspace.manage');

  /** Caderno do projeto: páginas e reuniões ligadas + o que ficou combinado nas atas. */
  const notebookPanel = () => {
    const s = /** @type {Project} */ (p);
    if (!canDo('workspace.view')) return '';
    const pages = [...s.pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
    const open = s.pageTasks.filter((t) => t.status !== 'done');
    return html`<section class="panel" aria-labelledby="nb-title">
      <header class="panel__head">
        <div><h2 class="panel__title" id="nb-title">Caderno do projeto</h2><p class="panel__hint">Páginas, reuniões e o que ficou combinado nas atas</p></div>
        ${manageFiles
          ? html`<div class="panel__tools">
              <button type="button" class="btn btn--secondary btn--sm" data-action="nb-page">${icon('plus')}<span>Página</span></button>
              <button type="button" class="btn btn--secondary btn--sm" data-action="nb-meeting">${icon('plus')}<span>Reunião</span></button>
            </div>`
          : ''}
      </header>
      ${pages.length || open.length
        ? html`${pages.length
            ? html`<ul class="nb-list">${pages.map((pg) => html`<li><a class="nb-list__link" href="#/workspace/${pg.id}"><span class="nb-list__icon" aria-hidden="true">${pg.icon || (pg.kind === 'meeting' ? '🎙️' : '📄')}</span><span class="nb-list__title">${pg.title || 'Sem título'}</span><small>editada ${formatRelative(pg.updatedAt)}</small></a></li>`)}</ul>`
            : ''}
          ${open.length
            ? html`<h3 class="subhead">Combinado nas reuniões</h3>
              <ul class="nb-list">${open.map((t) => html`<li><a class="nb-list__link" href="#/workspace/${t.pageId}"><span class="nb-list__icon" aria-hidden="true">☐</span><span class="nb-list__title">${t.title}</span><small>${[t.assigneeName, t.dueDate ? `até ${formatDate(t.dueDate)}` : ''].filter(Boolean).join(' · ')}</small></a></li>`)}</ul>`
            : ''}`
        : emptyState({ title: 'Nada no Caderno ainda', text: 'Crie o briefing, registre reuniões e a ata sai com as tarefas.', compact: true })}
    </section>`;
  };

  const filesPanel = () => {
    const s = /** @type {Project} */ (p);
    if (!s.files) return '';
    return html`<section class="panel" aria-labelledby="files-title">
      <header class="panel__head">
        <div><h2 class="panel__title" id="files-title">Arquivos</h2><p class="panel__hint">Contrato, logo, briefing, acessos de fornecedor. Até 10 MB cada, guardados em pasta privada</p></div>
        ${manageFiles ? html`<label class="btn btn--secondary btn--sm file-pick">${icon('plus')}<span>Enviar arquivo</span><input type="file" data-project-upload class="sr-only" multiple></label>` : ''}
      </header>
      <div data-files></div>
    </section>`;
  };

  const drawFiles = () => {
    const s = /** @type {Project} */ (p);
    const slot = $('[data-files]', root);
    if (!slot || !s.files) return;
    slot.replaceChildren(
      dataTable({
        label: 'Arquivos do projeto',
        rows: s.files,
        sort: { key: 'date', dir: 'desc' },
        empty: emptyState({ title: 'Nenhum arquivo', text: 'Guarde aqui o contrato assinado, a logo e o que o cliente mandar.', compact: true }),
        columns: [
          { key: 'name', label: 'Arquivo', sortValue: (f) => f.name, render: (f) => html`<button type="button" class="link-strong" data-action="download-file" data-file="${f.id}">${f.name}</button>` },
          { key: 'size', label: 'Tamanho', align: 'end', hideOnMobile: true, sortValue: (f) => f.size, render: (f) => html`<span class="mono">${formatBytes(f.size)}</span>` },
          { key: 'date', label: 'Enviado', hideOnMobile: true, sortValue: (f) => f.createdAt, render: (f) => html`<span class="person"><span class="mono">${formatDate(f.createdAt.slice(0, 10))}</span><small>${f.uploaderName}</small></span>` },
          ...(manageFiles
            ? [{ key: 'actions', label: 'Ações', align: /** @type {const} */ ('end'), render: (/** @type {any} */ f) => html`<button type="button" class="icon-btn icon-btn--sm" data-action="remove-file" data-file="${f.id}" aria-label="Excluir ${f.name}" title="Excluir">${icon('trash')}</button>` }]
            : []),
        ],
      }),
    );
  };

  const drawEntries = () => {
    const s = /** @type {Project} */ (p);
    $('[data-entries]', root)?.replaceChildren(
      dataTable({
        label: 'Gastos e ganhos avulsos',
        rows: s.entries,
        sort: { key: 'date', dir: 'desc' },
        empty: emptyState({ title: 'Nenhum lançamento', text: 'Ex.: freelancer do layout, anúncio, plugin pago, venda avulsa.', compact: true }),
        columns: [
          { key: 'date', label: 'Data', sortValue: (e) => e.occurredOn, render: (e) => html`<span class="mono">${formatDate(e.occurredOn)}</span>` },
          { key: 'description', label: 'Descrição', sortValue: (e) => e.description, render: (e) => e.description },
          {
            key: 'amount',
            label: 'Valor',
            align: 'end',
            sortValue: (e) => (e.kind === 'revenue' ? e.amount : -e.amount),
            render: (e) => html`<span class="mono ${e.kind === 'revenue' ? 'amount--in' : 'amount--out'}">${e.kind === 'revenue' ? '+' : '−'} ${formatMoney(e.amount)}</span>`,
          },
          ...(manage
            ? [{ key: 'actions', label: 'Ações', align: /** @type {const} */ ('end'), render: (/** @type {any} */ e) => html`<button type="button" class="icon-btn icon-btn--sm" data-action="remove-entry" data-entry="${e.id}" aria-label="Excluir lançamento ${e.description}" title="Excluir">${icon('trash')}</button>` }]
            : []),
        ],
      }),
    );
  };

  // "No ar" completo (publicado) ---------------------------------------------------------
  /** @type {Map<string, '24h' | '7d' | '30d'>} */
  const ranges = new Map();
  /** @type {Awaited<ReturnType<typeof data.monitoring.history>> | null} */
  let history = null;
  const canWatch = canDo('products.manage') || canDo('infra.manage');
  const timeOf = (/** @type {number} */ t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dateTimeOf = (/** @type {number} */ t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const uptimePanel = () => {
    const s = /** @type {Project} */ (p);
    const siteMissing = !s.monitors.some((m) => m.kind === 'site');
    return html`<section class="panel" aria-labelledby="up-title">
      <header class="panel__head">
        <div><h2 class="panel__title" id="up-title">No ar</h2><p class="panel__hint">O servidor confere a cada minuto e avisa no sininho se cair (2 falhas seguidas)</p></div>
        <div class="panel__tools">
          ${s.monitors.some((m) => m.enabled) ? html`<button type="button" class="btn btn--secondary btn--sm" data-action="check-now">${icon('refresh')}<span>Verificar agora</span></button>` : ''}
          ${siteMissing && s.product.url && canWatch ? html`<button type="button" class="btn btn--secondary btn--sm" data-action="watch-site">${icon('globe')}<span>Verificar o site</span></button>` : ''}
        </div>
      </header>
      ${s.monitors.length
        ? s.monitors.map((m) => html`<article class="uptime" data-uptime="${m.id}"><div class="skeleton"></div></article>`)
        : emptyState({ title: 'Nada sendo verificado', text: s.product.url ? 'Ligue a verificação do site.' : 'Coloque o endereço do site em Editar.', compact: true })}
    </section>`;
  };

  /** Um monitor: estado, disponibilidade, faixa de 24 h, gráfico, quedas e detalhes. @param {import('../../services/data.js').Monitor} m */
  const drawMonitor = (m) => {
    const slot = $(`[data-uptime="${m.id}"]`, root);
    if (!slot || !history) return;
    const now = Date.now();
    const mine = {
      checks: history.checks.filter((c) => c.monitorId === m.id),
      hourly: history.hourly.filter((h) => h.monitorId === m.id),
    };
    const incidents = history.incidents.filter((i) => i.monitorId === m.id);
    const range = ranges.get(m.id) ?? '24h';
    const series = responseSeries(mine, range, now);
    const stats = msStats(range === '24h' ? series.map((x) => x.value) : mine.checks.filter((c) => c.ok && c.msTotal !== null).map((c) => /** @type {number} */ (c.msTotal)));
    const all = msStats(mine.checks.filter((c) => c.ok && c.msTotal !== null).map((c) => /** @type {number} */ (c.msTotal)));
    const last = mine.checks[mine.checks.length - 1];
    const host = (m.target ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    setHtml(
      slot,
      html`<header class="uptime__head">
          <span class="person"><strong>${m.label}</strong><small>${host || 'sem endereço'}</small></span>
          ${monitorBadge(m)}
          ${canWatch ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="toggle-monitor" data-monitor="${m.id}">${m.enabled ? 'Desligar' : 'Ligar'}</button>` : ''}
          ${canWatch && m.enabled ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="schedule" data-monitor="${m.id}" title="Horário de verificação">${icon('clock')}<span>${scheduleText(m)}</span></button>` : ''}
        </header>
        <dl class="uptime__nums">
          <div><dt>24 horas</dt><dd class="mono">${pctText(uptime(mine, 24, now).pct)}</dd></div>
          <div><dt>7 dias</dt><dd class="mono">${pctText(uptime(mine, 24 * 7, now).pct)}</dd></div>
          <div><dt>30 dias</dt><dd class="mono">${pctText(uptime(mine, 24 * 30, now).pct)}</dd></div>
          <div><dt>Resposta média</dt><dd class="mono">${all.avg !== null ? `${all.avg} ms` : '—'}</dd></div>
          <div><dt>p95 (24 h)</dt><dd class="mono">${all.p95 !== null ? `${all.p95} ms` : '—'}</dd></div>
        </dl>
        ${uptimeStrip(blocks(mine.checks, m.slowMs, now), timeOf)}
        <div class="uptime__chart-head">
          <h3 class="subhead">Tempo de resposta</h3>
          <div class="segmented" role="tablist" aria-label="Período">
            ${[['24h', '24 h'], ['7d', '7 dias'], ['30d', '30 dias']].map(([key, text]) => html`<button type="button" class="segmented__item" role="tab" aria-selected="${range === key ? 'true' : 'false'}" data-action="range" data-monitor="${m.id}" data-range="${key}">${text}</button>`)}
          </div>
        </div>
        <div class="chart" data-chart></div>
        <p class="chart__stats">${stats.count ? `Média ${stats.avg} ms · p95 ${stats.p95} ms · máximo ${stats.max} ms · ${range === '24h' ? `${stats.count} verificações` : 'por hora'}` : 'Sem dados neste período.'}</p>
        <h3 class="subhead">Quedas</h3>
        ${incidents.length
          ? html`<ul class="row-list">${incidents.slice(0, 8).map((i) => {
              const start = Date.parse(i.startedAt);
              const end = i.endedAt ? Date.parse(i.endedAt) : now;
              return html`<li class="row-list__item">
                <span class="status-dot status-dot--${i.endedAt ? 'warn' : 'error'}" aria-hidden="true"></span>
                <span>${dateTimeOf(start)}</span>
                <span class="muted">${causeText(i.cause, i.code)}</span>
                <span class="mono">${i.endedAt ? durationText(end - start) : `fora há ${durationText(end - start)}`}</span>
              </li>`;
            })}</ul>`
          : html`<p class="muted detail-text">Nenhuma queda nos últimos 30 dias.</p>`}
        <details class="more">
          <summary>Detalhes técnicos</summary>
          <dl class="facts facts--grid">
            <div><dt>Última verificação</dt><dd>${m.lastCheckAt ? dateTimeOf(Date.parse(m.lastCheckAt)) : '—'}</dd></div>
            <div><dt>Resposta (código HTTP)</dt><dd class="mono">${m.lastCode ?? '—'}</dd></div>
            <div><dt>Tempo total</dt><dd class="mono">${m.lastMs !== null ? `${m.lastMs} ms` : '—'}</dd></div>
            <div><dt>Conexão (DNS + TLS)</dt><dd class="mono">${last?.msConnect != null ? `${last.msConnect} ms` : '—'}</dd></div>
            <div><dt>Servidor</dt><dd class="mono">${last?.msConnect != null && last?.msTotal != null ? `${Math.max(0, last.msTotal - last.msConnect)} ms` : '—'}</dd></div>
            <div><dt>Endereço verificado</dt><dd class="break">${m.target ?? '—'}</dd></div>
            <div><dt>Conta como lento acima de</dt><dd class="mono">${m.slowMs} ms</dd></div>
            <div><dt>Tempo limite</dt><dd class="mono">10 s</dd></div>
            <div><dt>Quem verifica</dt><dd>Servidor do Supabase, a cada minuto (${scheduleText(m)})</dd></div>
          </dl>
        </details>`,
    );
    drawLineChart(/** @type {HTMLElement} */ ($('[data-chart]', slot)), series, {
      label: `Tempo de resposta de ${m.label}: ${stats.count ? `média ${stats.avg} ms` : 'sem dados'}`,
      time: range === '24h' ? timeOf : (t) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      slowMs: m.slowMs,
    });
  };

  const drawUptime = async () => {
    const s = /** @type {Project} */ (p);
    if (!s.monitors.length) return;
    try {
      history = await data.monitoring.history(org.id, s.monitors.map((m) => m.id));
      if (signal.aborted) return;
      s.monitors.forEach(drawMonitor);
    } catch (error) {
      for (const m of s.monitors) setHtml(/** @type {HTMLElement} */ ($(`[data-uptime="${m.id}"]`, root)), loadError(error));
    }
  };

  // Dados ----------------------------------------------------------------------------
  const refresh = async () => {
    try {
      await load();
      if (!signal.aborted) draw();
    } catch (error) {
      toastError(error);
    }
  };
  const done = async (/** @type {string} */ message) => {
    toast(message, 'success');
    await refresh();
  };
  const subOf = (/** @type {string | undefined} */ subId) => /** @type {Project} */ (p).subs.find((x) => x.id === subId);
  const taskOf = (/** @type {string | undefined} */ taskId) => /** @type {Project} */ (p).tasks.find((t) => t.id === taskId);

  try {
    await load();
  } catch (error) {
    if (!signal.aborted) setHtml(root, loadError(error));
    return;
  }
  if (signal.aborted) return;
  draw();

  /** Tarefa: criar ou editar. @param {any} current */
  const editTask = async (current) => {
    const members = await data.members.list(org.id).catch(() => []);
    return openRecordDialog({
      title: current ? 'Editar tarefa' : 'Nova tarefa',
      fields: [
        { name: 'title', label: 'Tarefa', required: true, maxlength: 200, full: true },
        { name: 'assigneeId', label: 'Quem faz', type: 'select', options: memberOptions(members, 'Ninguém ainda') },
        { name: 'dueDate', label: 'Prazo', type: 'date' },
        { name: 'status', label: 'Situação', type: 'select', options: TASK_STATUS.map((t) => ({ value: t.key, label: t.label })) },
      ],
      values: current ?? { status: 'todo' },
      submitLabel: current ? 'Salvar' : 'Adicionar',
      onSubmit: (values) =>
        data.tasks.save(org.id, /** @type {any} */ ({ ...current, ...values, productId: id, position: current?.position ?? /** @type {Project} */ (p).tasks.length + 1 }), current?.id),
    });
  };

  bindActions(root, {
    edit: async () => {
      if (await editProject(/** @type {Project} */ (p).product).catch((e) => (toastError(e), false))) done('Projeto atualizado.');
    },
    remove: async () => {
      const pr = /** @type {Project} */ (p).product;
      const ok = await confirmDialog({ title: 'Excluir projeto?', message: `“${pr.name}” sai do sistema com mensalidades, pagamentos, tarefas e monitores. Os serviços exclusivos ficam em Serviços, sem projeto.`, confirmLabel: 'Excluir', danger: true });
      if (!ok) return;
      try {
        await data.products.remove(org.id, pr.id);
        toast('Projeto excluído.', 'success');
        location.hash = '#/projects';
      } catch (error) {
        toastError(error);
      }
    },
    stage: async (el) => moveStage(/** @type {any} */ (el.dataset.to)),
    setup: async () => {
      const pr = /** @type {Project} */ (p).product;
      try {
        await data.products.save(org.id, /** @type {any} */ ({ ...pr, setupPaidOn: pr.setupPaidOn ? null : today(), setupOutside: false }), pr.id);
        done(pr.setupPaidOn ? 'Recebimento desfeito.' : 'Implantação recebida.');
      } catch (error) {
        toastError(error);
      }
    },
    'nb-page': async () => {
      try {
        location.hash = `#/workspace/${await newPage(org.id, { productId: id, templateId: 'briefing' })}`;
      } catch (error) {
        toastError(error);
      }
    },
    'nb-meeting': async () => {
      try {
        location.hash = `#/workspace/${await newPage(org.id, { productId: id, templateId: 'meeting' })}`;
      } catch (error) {
        toastError(error);
      }
    },
    'setup-edit': async () => {
      const pr = /** @type {Project} */ (p).product;
      const current = pr.setupOutside ? 'outside' : pr.setupPaidOn ? 'paid' : 'due';
      const choice = (/** @type {string} */ value, /** @type {string} */ title, /** @type {string} */ text) =>
        html`<label class="choice"><input type="radio" name="state" value="${value}" ${current === value ? html`checked` : ''}><span><strong>${title}</strong><small>${text}</small></span></label>`;
      const ok = await openDialog({
        title: 'Implantação',
        description: `${pr.name} · ${formatMoney(pr.setupAmount ?? 0)}`,
        body: html`<div class="choice-row" role="radiogroup" aria-label="Situação da implantação">
            ${choice('due', 'A receber', 'Ainda não pagou')}
            ${choice('paid', 'Recebida', 'Entra no Recebido e pode ir para o FinanceSolux')}
            ${choice('outside', 'Paga antes da empresa', 'Fica registrada como paga, mas não entra nas contas')}
          </div>
          <label class="field"><span class="field__label">Paga em</span><input class="input" type="date" name="paidOn" value="${pr.setupPaidOn ?? today()}"></label>
          <p class="field__hint">Se ela já foi lançada no FinanceSolux e agora não deve contar, apague o lançamento lá também.</p>`,
        onSubmit: async (form) => {
          const state = String(form.get('state') ?? current);
          const paidOn = state === 'due' ? null : String(form.get('paidOn') || today());
          await data.products.save(org.id, /** @type {any} */ ({ ...pr, setupPaidOn: paidOn, setupOutside: state === 'outside' }), pr.id);
        },
      }).catch((e) => (toastError(e), false));
      if (ok) done('Implantação atualizada.');
    },
    'new-task': async () => {
      if (await editTask(null).catch((e) => (toastError(e), false))) done('Tarefa adicionada.');
    },
    'edit-task': async (el) => {
      if (await editTask(taskOf(el.dataset.task)).catch((e) => (toastError(e), false))) done('Tarefa atualizada.');
    },
    'toggle-task': async (el) => {
      const t = taskOf(el.dataset.task);
      if (!t) return;
      try {
        await data.tasks.save(org.id, /** @type {any} */ ({ ...t, status: t.status === 'done' ? 'todo' : 'done' }), t.id);
        await refresh();
        const s = /** @type {Project} */ (p);
        if (s.progress.complete && s.product.status === 'building') toast('Checklist completo. Quando o site estiver no ar, clique em Publicar.', 'success');
      } catch (error) {
        toastError(error);
        refresh();
      }
    },
    'remove-task': async (el) => {
      const t = taskOf(el.dataset.task);
      if (!t || !(await confirmDialog({ title: 'Excluir tarefa?', message: `“${t.title}”`, confirmLabel: 'Excluir', danger: true }))) return;
      try {
        await data.tasks.remove(org.id, t.id);
        done('Tarefa excluída.');
      } catch (error) {
        toastError(error);
      }
    },
    'pick-shared': () => pickShared(),
    unpick: async (el) => {
      const a = /** @type {Project} */ (p).shared?.find((x) => x.id === el.dataset.asset);
      if (!a) return;
      try {
        await data.assetLinks.remove(org.id, a.id, id);
        done(`${a.name} saiu do projeto.`);
      } catch (error) {
        toastError(error);
      }
    },
    'add-asset': async () => {
      if (await editAsset(null, { productId: id, kind: 'domain' }).catch((e) => (toastError(e), false))) done('Serviço cadastrado.');
    },
    'edit-asset': async (el) => {
      const a = /** @type {Project} */ (p).own?.find((x) => x.id === el.dataset.asset);
      if (a && (await editAsset(a).catch((e) => (toastError(e), false)))) done('Serviço atualizado.');
    },
    link: async () => {
      const s = /** @type {Project} */ (p);
      const customers = (await data.customers.list(org.id)).filter((c) => !s.subs.some((x) => x.customerId === c.id && x.status !== 'cancelled'));
      if (!customers.length) return toast('Todos os clientes já estão neste projeto (ou ainda não há clientes).', 'info');
      if (await linkSubscription(org.id, { customers, products: [s.product], productId: s.product.id, title: 'Cliente do projeto' }).catch((e) => (toastError(e), false))) done('Cliente adicionado.');
    },
    'edit-sub': async (el) => {
      const sub = subOf(el.dataset.sub);
      if (sub && (await editSubscription(org.id, sub).catch((e) => (toastError(e), false)))) done('Mensalidade atualizada.');
    },
    unlink: async (el) => {
      const sub = subOf(el.dataset.sub);
      if (!sub) return;
      const ok = await confirmDialog({ title: 'Remover cliente do projeto?', message: `${sub.customerName} deixa de pagar por ${sub.productName}. Os pagamentos registrados desta mensalidade também saem.`, confirmLabel: 'Remover', danger: true });
      if (!ok) return;
      try {
        await data.customerProducts.unlink(org.id, sub.id);
        done('Cliente removido.');
      } catch (error) {
        toastError(error);
      }
    },
    paid: async (el) => {
      const sub = subOf(el.dataset.sub);
      if (sub && (await markPaid(org.id, sub).catch((e) => (toastError(e), false)))) done('Pagamento registrado.');
    },
    'undo-paid': async (el) => {
      const sub = subOf(el.dataset.sub);
      const payment = sub ? /** @type {Project} */ (p).paymentOf(sub.id) : null;
      if (sub && payment && (await undoPayment(org.id, payment, sub).catch((e) => (toastError(e), false)))) done('Pagamento desfeito.');
    },
    'new-entry': async () => {
      const ok = await openRecordDialog({
        title: 'Lançar gasto ou ganho',
        description: /** @type {Project} */ (p).product.name,
        fields: [
          { name: 'kind', label: 'Tipo', type: 'select', options: ENTRY_KINDS.map((k) => ({ value: k.key, label: k.key === 'cost' ? 'Gasto' : 'Ganho' })) },
          { name: 'amount', label: 'Valor (R$)', type: 'money', required: true },
          { name: 'description', label: 'Descrição', required: true, maxlength: 200, full: true, placeholder: 'Ex.: Freelancer do layout, anúncio no Google' },
          { name: 'occurredOn', label: 'Data', type: 'date', required: true },
        ],
        values: { kind: 'cost', occurredOn: today() },
        submitLabel: 'Lançar',
        onSubmit: (values) => data.productEntries.save(org.id, /** @type {any} */ ({ ...values, productId: id })),
      }).catch((e) => (toastError(e), false));
      if (ok) done('Lançamento registrado.');
    },
    'remove-entry': async (el) => {
      const entry = /** @type {Project} */ (p).entries.find((e) => e.id === el.dataset.entry);
      if (!entry || !(await confirmDialog({ title: 'Excluir lançamento?', message: `“${entry.description}” (${formatMoney(entry.amount)}) sai do resultado.`, confirmLabel: 'Excluir', danger: true }))) return;
      try {
        await data.productEntries.remove(org.id, entry.id);
        done('Lançamento excluído.');
      } catch (error) {
        toastError(error);
      }
    },
    'download-file': async (el) => {
      const f = /** @type {Project} */ (p).files?.find((x) => x.id === el.dataset.file);
      if (!f) return;
      try {
        window.open(await data.files.link(org.id, f), '_blank', 'noopener');
      } catch (error) {
        toastError(error);
      }
    },
    'remove-file': async (el) => {
      const f = /** @type {Project} */ (p).files?.find((x) => x.id === el.dataset.file);
      if (!f || !(await confirmDialog({ title: 'Excluir arquivo?', message: `“${f.name}” sai do projeto e da pasta para sempre.`, confirmLabel: 'Excluir', danger: true }))) return;
      try {
        await data.files.remove(org.id, f);
        done('Arquivo excluído.');
      } catch (error) {
        toastError(error);
      }
    },
    schedule: async (el) => {
      const m = /** @type {Project} */ (p).monitors.find((x) => x.id === el.dataset.monitor);
      if (m && (await editSchedule(m).catch((e) => (toastError(e), false)))) done('Horário de verificação salvo.');
    },
    'toggle-monitor': async (el) => {
      const m = /** @type {Project} */ (p).monitors.find((x) => x.id === el.dataset.monitor);
      if (!m) return;
      try {
        await data.monitors.save(org.id, { ...m, enabled: !m.enabled }, m.id);
        done(m.enabled ? 'Monitoramento desligado.' : 'Monitoramento ligado.');
      } catch (error) {
        toastError(error);
      }
    },
    'watch-site': async () => {
      try {
        await data.monitors.save(org.id, { productId: id, kind: 'site', label: 'Site', enabled: true });
        done('O site passa a ser verificado.');
      } catch (error) {
        toastError(error);
      }
    },
    range: (el) => {
      const m = /** @type {Project} */ (p).monitors.find((x) => x.id === el.dataset.monitor);
      if (!m) return;
      ranges.set(m.id, /** @type {'24h' | '7d' | '30d'} */ (el.dataset.range));
      drawMonitor(m);
    },
    'check-now': async (el) => {
      const button = /** @type {HTMLButtonElement} */ (el);
      button.disabled = true;
      try {
        const sent = await data.monitoring.checkNow(org.id);
        if (!sent) return toast('Acabou de ser verificado. Tente de novo em alguns segundos.', 'info');
        done(`${sent} endereço${sent > 1 ? 's' : ''} verificado${sent > 1 ? 's' : ''} agora.`);
      } catch (error) {
        toastError(error);
      } finally {
        button.disabled = false;
      }
    },
  }, signal);

  root.addEventListener('change', async (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (!input.matches?.('[data-project-upload]') || !input.files?.length) return;
    const list = [...input.files];
    input.value = '';
    const big = list.find((f) => f.size > FILE_MAX_BYTES);
    if (big) return toastError(new Error(`“${big.name}” passa de 10 MB.`));
    try {
      for (const f of list) await data.files.upload(org.id, f, id);
      done(list.length > 1 ? `${list.length} arquivos enviados.` : 'Arquivo enviado.');
    } catch (error) {
      toastError(error);
    }
  }, { signal });

  /** Compartilhados que o projeto usa: marca e desmarca de uma vez. */
  async function pickShared() {
    const s = /** @type {Project} */ (p);
    const all = (bundle?.assets ?? []).filter((a) => a.shared && a.status === 'active');
    if (!all.length) {
      toast(canDo('infra.manage') ? 'Cadastre primeiro os serviços compartilhados em Serviços (GitHub, Supabase, HostGator…).' : 'Ainda não há serviços compartilhados cadastrados.', 'info');
      return;
    }
    const mine = new Set((s.shared ?? []).map((a) => a.id));
    const ok = await openDialog({
      title: 'Compartilhados que o projeto usa',
      description: 'Marque o que este projeto usa. O custo de cada um se divide sozinho entre os projetos.',
      body: html`<div class="pick-list">${all.map(
        (a) => html`<label class="pick">
          <input type="checkbox" name="asset" value="${a.id}" ${mine.has(a.id) ? html`checked` : ''}>
          <span class="pick__body"><strong>${a.name}</strong><small>${labelOf(ASSET_KINDS, a.kind)}${a.provider ? ` · ${a.provider}` : ''} · ${formatMoney(a.cost ?? 0)}${periodShort(a.costPeriod)}${a.price ? ` · cobra ${formatMoney(a.price)}${periodShort(a.pricePeriod)}` : ''}</small></span>
        </label>`,
      )}</div>`,
      submitLabel: 'Salvar',
      onSubmit: async (form) => {
        const chosen = new Set(form.getAll('asset').map(String));
        for (const a of all) {
          if (chosen.has(a.id) && !mine.has(a.id)) await data.assetLinks.add(org.id, a.id, id);
          if (!chosen.has(a.id) && mine.has(a.id)) await data.assetLinks.remove(org.id, a.id, id);
        }
      },
    }).catch((e) => (toastError(e), false));
    if (ok) done('Serviços do projeto atualizados.');
  }

  /** Botão de etapa: pergunta o que precisa e chama setStage. @param {'building' | 'live' | 'ended'} to */
  async function moveStage(to) {
    const pr = /** @type {Project} */ (p).product;
    const from = pr.status;
    let ok = false;
    if (to === 'building' && from === 'proposal') {
      ok = await openRecordDialog({
        title: 'Cliente aceitou',
        description: 'O projeto vai para a construção com o checklist padrão e o cliente vira ativo. A mensalidade só começa a contar quando publicar.',
        fields: [{ name: 'dueDate', label: 'Prazo de entrega (opcional)', type: 'date', full: true }],
        values: { dueDate: pr.dueDate ?? '' },
        submitLabel: 'Começar a construção',
        onSubmit: (v) => data.products.setStage(org.id, pr.id, 'building', { dueDate: v.dueDate || undefined }),
      }).catch((e) => (toastError(e), false));
    } else if (to === 'live') {
      ok = await openRecordDialog({
        title: 'Publicar',
        description: 'A mensalidade passa a ser cobrada e o servidor começa a verificar se o site está no ar.',
        fields: [
          { name: 'url', label: 'Endereço do site', type: 'url', required: true, full: true, placeholder: 'https://' },
          { name: 'since', label: 'Cobrar a partir de', type: 'date', required: true },
        ],
        values: { url: pr.url ?? '', since: today() },
        submitLabel: 'Publicar',
        onSubmit: (v) => data.products.setStage(org.id, pr.id, 'live', { url: v.url, since: v.since }),
      }).catch((e) => (toastError(e), false));
    } else if (to === 'ended') {
      const refused = from === 'proposal';
      ok = await openDialog({
        title: refused ? 'Cliente recusou?' : from === 'building' ? 'Cancelar projeto?' : 'Encerrar projeto?',
        description: refused ? 'A proposta fica como recusada e o projeto vai para Encerrados.' : 'As mensalidades são canceladas e o monitoramento desliga.',
        body: refused ? html`` : html`<label class="checkbox"><input type="checkbox" name="endServices" checked> <span>Desativar também os serviços exclusivos (domínio, banco)</span></label>`,
        submitLabel: refused ? 'Marcar como recusada' : 'Encerrar',
        danger: true,
        onSubmit: (form) => data.products.setStage(org.id, pr.id, 'ended', { endServices: refused ? false : form.get('endServices') === 'on' }),
      }).catch((e) => (toastError(e), false));
    } else if (to === 'building') {
      ok = await confirmDialog({ title: 'Reabrir projeto?', message: 'Ele volta para a construção. As mensalidades continuam canceladas até você reativar.', confirmLabel: 'Reabrir' })
        .then((yes) => (yes ? data.products.setStage(org.id, pr.id, 'building').then(() => true) : false))
        .catch((e) => (toastError(e), false));
    }
    if (ok) done('Etapa atualizada.');
  }
}

// Peças da página (sem estado) ------------------------------------------------------------

/** Etapas e o próximo passo. @param {Project} s @param {boolean} manage */
function stageBar(s, manage) {
  const stage = s.product.status;
  const index = STAGES.findIndex((x) => x.key === stage);
  const steps = NEXT_STEPS[stage] ?? [];
  const hint = {
    proposal: s.proposals.length
      ? `Proposta ${s.proposals[0].status === 'sent' ? 'enviada' : 'em rascunho'}. Quando o cliente aceitar, a construção começa com o checklist.`
      : 'Monte a proposta ou, se já fechou, marque que o cliente aceitou.',
    building: s.progress.total
      ? s.progress.complete
        ? 'Checklist completo. Publique quando o site estiver no ar.'
        : `${s.progress.done} de ${s.progress.total} tarefas feitas${s.product.dueDate ? ` · prazo ${formatDate(s.product.dueDate)}` : ''}.`
      : 'Publique quando o site estiver no ar.',
    live: `Publicado${s.product.startDate ? ` desde ${formatDate(s.product.startDate)}` : ''}. ${s.activeSubs ? `Cobrando ${formatMoney(s.money.mrr)}/mês.` : 'Ninguém pagando ainda.'}`,
    ended: 'Encerrado: mensalidades canceladas e monitoramento desligado.',
  }[stage];
  return html`<section class="stagebar ${stage === 'ended' ? 'stagebar--ended' : ''}" aria-label="Etapa do projeto">
    <ol class="stagebar__steps">
      ${STAGES.map(
        (x, i) => html`<li class="stagebar__step ${stage !== 'ended' && i < index ? 'is-done' : ''} ${i === index ? 'is-current' : ''}" ${i === index ? html`aria-current="step"` : ''}>
          <span class="stagebar__dot" aria-hidden="true">${stage !== 'ended' && i < index ? icon('check') : i + 1}</span><span>${x.label}</span></li>`,
      )}
    </ol>
    <div class="stagebar__next">
      <p class="stagebar__hint">${hint}</p>
      ${manage
        ? html`<div class="stagebar__actions">
            ${stage === 'proposal' && canDo('proposals.manage') && !s.proposals.some((x) => x.status === 'draft' || x.status === 'sent') && s.customers.length
              ? html`<a class="btn btn--secondary" href="#/proposals/new?project=${s.product.id}&customer=${s.customers[0].id}">${icon('fileText')}<span>Montar proposta</span></a>`
              : ''}
            ${steps.map((step, i) => html`<button type="button" class="btn ${step.danger ? 'btn--ghost' : i === 0 ? 'btn--primary' : 'btn--secondary'}" data-action="stage" data-to="${step.to}">${!step.danger && i === 0 ? icon(step.to === 'live' ? 'globe' : 'check') : ''}<span>${step.label}</span></button>`)}
          </div>`
        : ''}
    </div>
  </section>`;
}

/** Os 4 números do projeto. @param {Project} s */
function numbers(s) {
  const pr = s.product;
  const before = pr.status === 'proposal' || pr.status === 'building';
  const profit = s.monthly - s.money.monthlyCost;
  const margin = s.monthly > 0 ? Math.round((profit / s.monthly) * 100) : null;
  return html`<dl class="stat-strip stat-strip--spaced">
    <div><dt>Mensalidade</dt><dd class="mono">${formatMoney(s.monthly)}</dd><span class="stat-note">${before ? 'combinada · começa ao publicar' : `${formatInteger(s.activeSubs)} cliente${s.activeSubs === 1 ? '' : 's'} pagando`}</span></div>
    <div><dt>Custo/mês</dt><dd class="mono">${s.own ? formatMoney(s.money.monthlyCost) : '—'}</dd><span class="stat-note">${s.own ? 'serviços, com a parte dos compartilhados' : 'sem acesso aos serviços'}</span></div>
    <div><dt>Lucro/mês</dt><dd class="mono ${profit < 0 ? 'is-overdue' : ''}">${s.own ? formatMoney(profit) : '—'}</dd><span class="stat-note">${margin === null ? 'sem mensalidade' : `margem ${margin}%`}</span></div>
    <div><dt>Implantação</dt><dd class="mono">${pr.setupAmount ? formatMoney(pr.setupAmount) : '—'}</dd><span class="stat-note">${setupNote(pr)}</span></div>
  </dl>`;
}

/** Situação da implantação, com a ação de quem pode mexer. @param {import('../../services/data.js').Product} pr */
function setupNote(pr) {
  if (!pr.setupAmount) return 'sem valor único';
  const manage = canDo('products.manage') && pr.status !== 'proposal';
  const change = manage ? html` · <button type="button" class="link-action" data-action="setup-edit">Alterar</button>` : '';
  if (pr.setupOutside) return html`paga antes da empresa · não entra nas contas${change}`;
  if (pr.setupPaidOn) return html`recebida em ${formatDate(pr.setupPaidOn)}${change}`;
  return html`a receber${manage ? html` · <button type="button" class="link-action" data-action="setup">Recebi</button>` : ''}`;
}

/** Selo geral (publicado): Tudo ok / Atenção / Problema, com os motivos. @param {Project} s */
function statusBanner(s) {
  const { level, reasons } = s.health;
  const text = reasons.length
    ? reasons.map((r) => `${r.title}: ${r.text}`).join(' · ')
    : level === 'ok'
      ? 'Tudo o que é verificado está em ordem.'
      : s.monitors.some((m) => m.enabled)
        ? 'Aguardando a primeira verificação do servidor (sai em minutos).'
        : 'Coloque o endereço do site para o sistema acompanhar se está no ar.';
  return html`<section class="site-status site-status--${level}" aria-label="Situação geral">
    <span class="site-status__icon" aria-hidden="true">${icon(LEVEL_ICON[level])}</span>
    <div class="site-status__body"><p class="site-status__title">${HEALTH_LABEL[level]}</p><p class="site-status__text">${text}</p></div>
  </section>`;
}

/** No ar, banco, domínio e uso. @param {Project} s */
function checkCards(s) {
  const domain = (s.own ?? []).filter((a) => a.status === 'active' && a.kind === 'domain' && a.renewsAt).sort((a, b) => String(a.renewsAt).localeCompare(String(b.renewsAt)))[0];
  const site = s.monitors.find((m) => m.kind === 'site');
  const db = s.monitors.find((m) => m.kind === 'database');
  const card = (/** @type {string} */ title, /** @type {any} */ glyph, /** @type {{ level: string, text: string }} */ c, /** @type {unknown} */ detail) =>
    html`<article class="check-card check-card--${c.level}">
      <p class="check-card__head">${icon(glyph)}<span>${title}</span><span class="status-dot status-dot--${c.level === 'unknown' ? 'info' : c.level}" aria-hidden="true"></span></p>
      <p class="check-card__value">${c.text}</p>
      <p class="check-card__detail">${detail || ''}</p>
    </article>`;
  return html`<div class="check-grid">
    ${card('No ar', 'globe', s.health.site, site?.lastCheckAt ? `verificado ${formatRelative(site.lastCheckAt)}${site.lastMs ? ` · ${site.lastMs} ms` : ''}` : site?.target ? host(site.target) : '')}
    ${card('Banco de dados', 'database', s.health.database, db?.lastCheckAt ? `verificado ${formatRelative(db.lastCheckAt)}` : db?.label ?? '')}
    ${card('Domínio', 'calendar', s.health.domain, domain ? `renova em ${formatDate(domain.renewsAt)}${domain.renewsAuto ? ' · do registro' : ''}` : '')}
    ${card('Em uso', 'chart', s.health.usage,
      s.usage?.lastDay
        ? `último uso ${dayLabel(s.usage.lastDay, today())}`
        : s.tracked === false && canDo('analytics.manage')
          ? html`<a href="#/analytics">Criar chave de coleta →</a>`
          : s.tracked === null ? 'Sem acesso ao uso' : '')}
  </div>`;
}

/** Dinheiro do ano (publicado). @param {Project} s */
function moneyPanel(s) {
  const m = s.money;
  const year = today().slice(0, 4);
  return html`<section class="panel" aria-labelledby="money-title">
    <header class="panel__head"><h2 class="panel__title" id="money-title">Dinheiro</h2><p class="panel__hint">Este mês e o ano</p></header>
    <div class="kpi-band kpi-band--3">
      <div class="kpi"><p class="kpi__label">Recebido no mês</p><p class="kpi__value">${s.billing ? formatMoney(m.receivedMonth) : '—'}</p><p class="kpi__note">${!s.billing ? 'sem acesso às cobranças' : m.expectedMonth ? `de ${formatMoney(m.expectedMonth)}${m.lateBillings ? ` · ${m.lateBillings} atrasada${m.lateBillings > 1 ? 's' : ''}` : ''}` : 'nada vence neste mês'}</p></div>
      <div class="kpi"><p class="kpi__label">Receitas em ${year}</p><p class="kpi__value">${formatMoney(m.year.revenue)}</p><p class="kpi__note">mensalidades, implantação e ganhos</p></div>
      <div class="kpi"><p class="kpi__label">Resultado em ${year}</p><p class="kpi__value ${m.year.result < 0 ? 'is-negative' : ''}">${formatMoney(m.year.result)}</p><p class="kpi__note">receitas − serviços − gastos</p></div>
    </div>
  </section>`;
}

/** Proposta(s) do projeto. @param {Project} s */
function proposalPanel(s) {
  return html`<section class="panel" aria-labelledby="prop-title">
    <header class="panel__head"><div><h2 class="panel__title" id="prop-title">Proposta</h2><p class="panel__hint">O documento para o cliente: imprimir, salvar em PDF e acompanhar</p></div></header>
    ${s.proposals.length
      ? html`<ul class="row-list">${s.proposals.map(
          (x) => html`<li class="row-list__item">
            <a class="link-strong" href="#/proposals/${x.id}">${proposalNumber(x.number)} · ${x.title}</a>
            ${statusPill(PROPOSAL_STATUS, x.status)}
            <span class="mono">${formatMoney(x.totalOnce)}${x.totalMonthly ? ` + ${formatMoney(x.totalMonthly)}/mês` : ''}</span>
          </li>`,
        )}</ul>`
      : emptyState({ title: 'Sem proposta', text: s.customers.length ? 'Use “Montar proposta” na barra de etapas.' : 'Adicione o cliente para montar a proposta.', compact: true })}
  </section>`;
}

/** Ficha lateral. @param {Project} s */
function factsPanel(s) {
  const pr = s.product;
  return html`<section class="panel" aria-labelledby="facts-title">
    <header class="panel__head"><h2 class="panel__title" id="facts-title">Ficha</h2></header>
    <dl class="facts facts--stack">
      <div><dt>Endereço</dt><dd>${pr.url ? html`<a href="${pr.url}" target="_blank" rel="noopener noreferrer">${host(pr.url)}</a>` : '—'}</dd></div>
      <div><dt>Início</dt><dd>${pr.startDate ? formatDate(pr.startDate) : '—'}</dd></div>
      <div><dt>Prazo da construção</dt><dd>${pr.dueDate ? formatDate(pr.dueDate) : '—'}</dd></div>
      ${pr.kind === 'system' ? html`<div><dt>Mensalidade padrão</dt><dd class="mono">${pr.monthlyPrice !== null ? formatMoney(pr.monthlyPrice) : '—'}</dd></div>` : ''}
      <div><dt>Próximo vencimento</dt><dd>${s.nextRenewal ? formatDate(s.nextRenewal) : '—'}</dd></div>
      <div><dt>Responsável</dt><dd>${pr.ownerName || '—'}</dd></div>
    </dl>
    ${pr.description ? html`<p class="prewrap detail-text">${pr.description}</p>` : ''}
  </section>`;
}

/** O que o servidor vigia neste projeto. @param {Project} s */
function monitorsPanel(s) {
  const pr = s.product;
  const canWatch = canDo('products.manage') || canDo('infra.manage');
  const siteMissing = !s.monitors.some((m) => m.kind === 'site');
  return html`<section class="panel" aria-labelledby="mon-title">
    <header class="panel__head"><h2 class="panel__title" id="mon-title">No ar</h2>
      ${s.monitors.some((m) => m.enabled) && (canDo('infra.view') || canWatch) ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="check-now">${icon('refresh')}<span>Verificar</span></button>` : ''}</header>
    ${s.monitors.length
      ? html`<ul class="mon-list">${s.monitors.map(
          (m) => html`<li class="mon-list__item">
            <span class="person"><strong>${m.label}</strong><small>${m.target ? host(m.target) : 'sem endereço'}${m.lastCheckAt ? ` · ${formatRelative(m.lastCheckAt)}` : ''}</small></span>
            ${monitorBadge(m)}
            ${canWatch ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="toggle-monitor" data-monitor="${m.id}">${m.enabled ? 'Desligar' : 'Ligar'}</button>` : ''}
          ${canWatch && m.enabled ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="schedule" data-monitor="${m.id}" title="Horário de verificação">${icon('clock')}<span>${scheduleText(m)}</span></button>` : ''}
          </li>`,
        )}</ul>`
      : html`<p class="muted detail-text">${pr.status === 'live' ? 'Nada sendo verificado.' : 'O monitoramento liga quando o projeto for publicado.'}</p>`}
    ${pr.status === 'live' && siteMissing && pr.url && canWatch ? html`<p class="detail-text"><button type="button" class="btn btn--secondary btn--sm" data-action="watch-site">${icon('globe')}<span>Verificar o site</span></button></p>` : ''}
  </section>`;
}
