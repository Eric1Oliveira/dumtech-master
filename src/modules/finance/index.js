// Dinheiro — os números do próprio Master (mensalidades reais, custo dos serviços com o rateio,
// lucro por projeto, recebido mês a mês), o que falta lançar no FinanceSolux (um por um, com
// confirmação — push-review.js) e a conta da empresa no FinanceSolux, lida na hora.
// Implantação paga antes da empresa (setupOutside) aparece no projeto, mas não entra nas contas.

import { html, setHtml, $, bindActions } from '../../shared/utils/dom.js';
import { formatMoney, formatRelative, formatDate } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { billingStatus, monthKey } from '../../core/billing.js';
import { serviceCosts, mrr } from '../../core/costs.js';
import { today } from '../../core/validate.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { dataTable } from '../../shared/components/table.js';
import { emptyState, errorMessage, loadError, toast, toastError } from '../../shared/components/feedback.js';
import { openPushReview } from './push-review.js';

const LINK_STATUS = {
  sent: { label: 'Criado no FinanceSolux', tone: 'ok' },
  skipped: { label: 'Já estava lá', tone: 'muted' },
  sending: { label: 'Envio sem confirmação', tone: 'warn' },
};

const monthFormat = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** "2026-11" → "novembro de 2026" */
const monthLabel = (/** @type {string} */ ym) => monthFormat.format(new Date(`${ym}-01T00:00:00Z`));
const muted = (/** @type {string} */ text = '—') => html`<span class="muted">${text}</span>`;

/** Parte do valor do mês que é recorrente prevista (ainda não caiu). */
const projectedNote = (/** @type {number} */ value) => (value > 0 ? html`<small class="stat-note">inclui ${formatMoney(value)} de recorrentes previstas</small>` : '');

/** Os 12 meses até o atual: "2025-12" … "2026-11". @param {string} todayKey */
const lastMonths = (todayKey) => {
  const [y, m] = todayKey.split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
};

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, signal }) {
  const { org } = getState();
  const seesMaster = canDo('products.view') && canDo('customers.view');
  setHtml(
    root,
    html`<header class="page-head">
        <div>
          <h1 class="page-title">Dinheiro</h1>
          <p class="page-sub">Quanto entra, quanto custa e quanto sobra — por projeto e da empresa</p>
        </div>
        <div class="page-actions"><button type="button" class="btn btn--secondary" data-action="refresh">Atualizar</button></div>
      </header>
      ${seesMaster ? html`<div data-master><div class="skeleton"></div></div>` : ''}
      <section class="panel" aria-labelledby="push-title">
        <header class="panel__head"><div><h2 class="panel__title" id="push-title">Lançar no FinanceSolux</h2><p class="panel__hint">O que o Master registrou e ainda não está lá. Nada é criado sem você confirmar, um por um.</p></div></header>
        <div data-push><div class="skeleton"></div></div>
      </section>
      <section class="panel" aria-labelledby="fs-title">
        <header class="panel__head"><div><h2 class="panel__title" id="fs-title">Conta da empresa (FinanceSolux)</h2><p class="panel__hint">Lida na hora; o FinanceSolux continua sendo o sistema financeiro</p></div></header>
        <div data-finance><div class="skeleton"></div></div>
      </section>`,
  );
  const slot = /** @type {HTMLElement} */ ($('[data-finance]', root));

  const drawSteps = (/** @type {string} */ reason) =>
    setHtml(
      slot,
      html`<p class="notice notice--warn"><strong>Sem leitura do FinanceSolux agora.</strong> ${reason}</p>
        <h3 class="subhead">Para ligar (uma vez só)</h3>
        <ol class="steps">
          <li><strong>Endereço:</strong> em <a href="#/settings/integrations">Ajustes › Integrações</a>, informe o endereço do projeto Supabase do FinanceSolux.</li>
          <li><strong>Função:</strong> no Supabase do Master, em Edge Functions, publique <span class="mono">financesolux-summary</span> (código em <span class="mono">supabase/functions/financesolux-summary/index.ts</span>).</li>
          <li><strong>Segredos:</strong> em Edge Functions › Secrets, cadastre <span class="mono">FINANCESOLUX_HUB_READ_KEY</span> (o mesmo <span class="mono">HUB_READ_KEY</span> do FinanceSolux — chave só de leitura) e <span class="mono">FINANCESOLUX_ANON_KEY</span> (chave pública do FinanceSolux).</li>
          <li><strong>FinanceSolux:</strong> a função <span class="mono">hub-export</span> dele publicada, com os secrets <span class="mono">HUB_READ_KEY</span> e <span class="mono">HUB_ACCOUNT_EMAIL</span> (e-mail da conta da empresa que o Master lê).</li>
          <li><strong>Para lançar daqui:</strong> publique <span class="mono">financesolux-push</span> no Master e <span class="mono">hub-import</span> no FinanceSolux, com a mesma chave em <span class="mono">FINANCESOLUX_HUB_WRITE_KEY</span> (Master) e <span class="mono">HUB_WRITE_KEY</span> (FinanceSolux).</li>
        </ol>`,
    );

  /** Os números do Master: mensalidades, custos, lucro por projeto, recebido. */
  const drawMaster = async () => {
    const box = $('[data-master]', root);
    if (!box) return;
    try {
      const todayKey = today();
      const month = monthKey(todayKey);
      const year = todayKey.slice(0, 4);
      const [products, subs, payments, assets, links, entries] = await Promise.all([
        data.products.list(org.id),
        data.customerProducts.list(org.id),
        data.payments.list(org.id),
        canDo('infra.view') ? data.assets.list(org.id) : [],
        data.assetLinks.list(org.id).catch(() => []),
        data.productEntries.list(org.id).catch(() => []),
      ]);
      if (signal.aborted) return;
      const costs = serviceCosts({ assets, links, projects: products });
      const monthly = mrr(subs);
      const seesCost = canDo('infra.view');
      const active = subs.filter((s) => s.status === 'active' && s.monthlyAmount);
      const states = active.map((s) => ({ s, state: billingStatus(s, payments, month, todayKey) }));
      const expected = states.filter((x) => x.state !== 'none').reduce((t, x) => t + (x.s.monthlyAmount ?? 0), 0);
      const received = payments.filter((p) => p.month === month).reduce((t, p) => t + p.amount, 0);
      const late = states.filter((x) => x.state === 'late');
      const open = states.filter((x) => x.state === 'open');
      const sum = (/** @type {{ s: any }[]} */ list) => list.reduce((t, x) => t + (x.s.monthlyAmount ?? 0), 0);
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

      setHtml(
        /** @type {HTMLElement} */ (box),
        html`<dl class="stat-strip">
            <div><dt>Mensalidades</dt><dd class="mono">${formatMoney(monthly)}</dd><span class="stat-note">por mês, de quem está pagando</span></div>
            <div><dt>Custo dos serviços</dt><dd class="mono">${seesCost ? formatMoney(costs.total) : '—'}</dd><span class="stat-note">${seesCost ? `${formatMoney(costs.shared)} compartilhados · ${formatMoney(costs.exclusive)} exclusivos` : 'sem acesso aos serviços'}</span></div>
            <div><dt>Lucro por mês</dt><dd class="mono ${seesCost && monthly - costs.total < 0 ? 'is-overdue' : ''}">${seesCost ? formatMoney(monthly - costs.total) : '—'}</dd><span class="stat-note">${seesCost && monthly ? `margem ${Math.round(((monthly - costs.total) / monthly) * 100)}%` : 'mensalidades − serviços'}</span></div>
            <div><dt>Recebido em ${year}</dt><dd class="mono">${formatMoney(yearTotal)}</dd><span class="stat-note">mensalidades, implantações e ganhos avulsos</span></div>
          </dl>
          <section class="panel" aria-labelledby="month-title">
            <header class="panel__head"><div><h2 class="panel__title" id="month-title">${monthLabel(month)}</h2><p class="panel__hint">Mensalidades deste mês</p></div><a class="link-action" href="#/dashboard">Cobrar no Hoje →</a></header>
            <div class="kpi-band kpi-band--4">
              <div class="kpi"><p class="kpi__label">Previsto</p><p class="kpi__value">${formatMoney(expected)}</p><p class="kpi__note">${states.filter((x) => x.state !== 'none').length} mensalidade(s)</p></div>
              <div class="kpi"><p class="kpi__label">Recebido</p><p class="kpi__value">${formatMoney(received)}</p><p class="kpi__note">${expected ? `${Math.round((received / expected) * 100)}% do previsto` : 'nada previsto'}</p></div>
              <div class="kpi"><p class="kpi__label">A receber</p><p class="kpi__value">${formatMoney(sum(open))}</p><p class="kpi__note">${open.length} ainda no prazo</p></div>
              <div class="kpi"><p class="kpi__label">Atrasado</p><p class="kpi__value ${late.length ? 'is-negative' : ''}">${formatMoney(sum(late))}</p><p class="kpi__note">${late.length ? `${late.length} cliente(s)` : 'ninguém atrasado'}</p></div>
            </div>
          </section>
          ${seesCost
            ? html`<section class="panel" aria-labelledby="profit-title">
                <header class="panel__head"><div><h2 class="panel__title" id="profit-title">Lucro por projeto</h2><p class="panel__hint">Do menor para o maior: quem dá prejuízo aparece primeiro</p></div></header>
                <div data-profit></div>
              </section>`
            : ''}
          <section class="panel" aria-labelledby="received-title">
            <header class="panel__head"><div><h2 class="panel__title" id="received-title">Recebido nos últimos 12 meses</h2><p class="panel__hint">O que foi marcado como pago no Master (implantação paga antes da empresa não entra)</p></div></header>
            <div data-received></div>
          </section>`,
      );
      $('[data-profit]', /** @type {HTMLElement} */ (box))?.replaceChildren(
        dataTable({
          label: 'Lucro por projeto',
          rows,
          sort: { key: 'profit', dir: 'asc' },
          empty: emptyState({ title: 'Nenhum projeto em construção ou publicado', compact: true }),
          columns: [
            { key: 'name', label: 'Projeto', sortValue: (r) => r.p.name, render: (r) => html`<span class="person"><a class="link-strong" href="#/projects/${r.p.id}">${r.p.name}</a><small>${r.customers || (r.p.status === 'building' ? 'em construção' : 'sem cliente')}</small></span>` },
            { key: 'value', label: 'Mensalidade', align: 'end', sortValue: (r) => r.value, render: (r) => (r.value ? html`<span class="mono">${formatMoney(r.value)}</span>` : muted()) },
            { key: 'cost', label: 'Custo/mês', align: 'end', hideOnMobile: true, sortValue: (r) => r.cost, render: (r) => html`<span class="mono">${formatMoney(r.cost)}</span>` },
            { key: 'profit', label: 'Lucro/mês', align: 'end', sortValue: (r) => r.profit, render: (r) => html`<span class="mono ${r.profit < 0 ? 'amount--out' : ''}">${formatMoney(r.profit)}</span>` },
            { key: 'margin', label: 'Margem', align: 'end', hideOnMobile: true, sortValue: (r) => r.margin ?? -999, render: (r) => (r.margin === null ? muted() : html`<span class="mono ${r.margin < 0 ? 'amount--out' : ''}">${r.margin}%</span>`) },
          ],
        }),
      );
      $('[data-received]', /** @type {HTMLElement} */ (box))?.replaceChildren(
        dataTable({
          label: 'Recebido por mês',
          rows: months,
          sort: { key: 'month', dir: 'desc' },
          empty: emptyState({ title: 'Nada recebido ainda', compact: true }),
          columns: [
            { key: 'month', label: 'Mês', sortValue: (x) => x.month, render: (x) => monthLabel(x.month) },
            { key: 'fees', label: 'Mensalidades', align: 'end', sortValue: (x) => x.fees, render: (x) => (x.fees ? html`<span class="mono">${formatMoney(x.fees)}</span>` : muted()) },
            { key: 'setups', label: 'Implantações', align: 'end', hideOnMobile: true, sortValue: (x) => x.setups, render: (x) => (x.setups ? html`<span class="mono">${formatMoney(x.setups)}</span>` : muted()) },
            { key: 'extras', label: 'Avulsos', align: 'end', hideOnMobile: true, sortValue: (x) => x.extras, render: (x) => (x.extras ? html`<span class="mono">${formatMoney(x.extras)}</span>` : muted()) },
            { key: 'total', label: 'Total', align: 'end', sortValue: (x) => x.fees + x.setups + x.extras, render: (x) => html`<strong class="mono">${formatMoney(x.fees + x.setups + x.extras)}</strong>` },
          ],
        }),
      );
    } catch (error) {
      if (!signal.aborted) setHtml(/** @type {HTMLElement} */ (box), loadError(error));
    }
  };

  /** A conta da empresa no FinanceSolux. */
  const drawFinanceSolux = async () => {
    setHtml(slot, html`<div class="skeleton"></div>`);
    try {
      const s = await data.finance.summary(org.id);
      if (signal.aborted) return;
      const last = s.lastTransactionOn ? `último lançamento em ${formatDate(s.lastTransactionOn)}` : 'nenhum lançamento ainda';
      setHtml(
        slot,
        html`<div class="kpi-band kpi-band--4">
            <div class="kpi"><p class="kpi__label">Receita do mês</p><p class="kpi__value">${formatMoney(s.revenue)}</p>${projectedNote(s.projectedRevenue)}</div>
            <div class="kpi"><p class="kpi__label">Despesa do mês</p><p class="kpi__value">${formatMoney(s.expenses)}</p>${projectedNote(s.projectedExpenses)}</div>
            <div class="kpi"><p class="kpi__label">Resultado do mês</p><p class="kpi__value ${s.net < 0 ? 'is-negative' : ''}">${formatMoney(s.net)}</p></div>
            <div class="kpi"><p class="kpi__label">Saldo em caixa</p><p class="kpi__value ${s.balance < 0 ? 'is-negative' : ''}">${formatMoney(s.balance)}</p></div>
          </div>
          <h3 class="subhead">Últimos 6 meses · ${s.account}</h3>
          <p class="panel__hint">${last} · lido ${formatRelative(s.fetchedAt)}</p>
          <div data-months></div>`,
      );
      /** @type {HTMLElement} */ ($('[data-months]', slot)).replaceChildren(
        dataTable({
          label: 'Últimos 6 meses',
          rows: s.months,
          sort: { key: 'month', dir: 'desc' },
          empty: emptyState({ title: 'Sem lançamentos nos últimos meses', compact: true }),
          columns: [
            { key: 'month', label: 'Mês', sortValue: (x) => x.month, render: (x) => monthLabel(x.month) },
            { key: 'revenue', label: 'Receita', align: 'end', sortValue: (x) => x.revenue, render: (x) => html`<span class="mono">${formatMoney(x.revenue)}</span>` },
            { key: 'expenses', label: 'Despesa', align: 'end', sortValue: (x) => x.expenses, render: (x) => html`<span class="mono">${formatMoney(x.expenses)}</span>` },
            { key: 'net', label: 'Resultado', align: 'end', sortValue: (x) => x.revenue - x.expenses, render: (x) => html`<span class="mono ${x.revenue - x.expenses < 0 ? 'is-overdue' : ''}">${formatMoney(x.revenue - x.expenses)}</span>` },
          ],
        }),
      );
    } catch (error) {
      if (!signal.aborted) drawSteps(errorMessage(error));
    }
  };

  /** O que falta lançar no FinanceSolux e o que já foi. */
  const drawPush = async () => {
    const box = /** @type {HTMLElement} */ ($('[data-push]', root));
    /** @type {import('../../services/data.js').FinanceItem[]} */
    let items;
    try {
      items = await data.finance.items(org.id);
      if (signal.aborted) return;
    } catch (error) {
      if (!signal.aborted) setHtml(box, loadError(error));
      return;
    }
    const pending = items.filter((i) => i.status === null || i.status === 'sending');
    const done = items.filter((i) => i.status === 'sent' || i.status === 'skipped');
    const total = (/** @type {string} */ kind) => pending.filter((i) => i.kind === kind).reduce((t, i) => t + i.amount, 0);
    const manage = canDo('finance.manage');
    /** Colunas de situação e ação só quando alguma linha precisa delas. */
    /** @param {import('../../services/data.js').FinanceItem[]} rows @returns {import('../../shared/components/table.js').Column<import('../../services/data.js').FinanceItem>[]} */
    const columns = (rows) => {
      const withStatus = rows.some((i) => i.status !== null);
      const withUndo = manage && rows.some((i) => i.status === 'skipped' || i.status === 'sending');
      return [
        { key: 'date', label: 'Data', sortValue: (i) => i.occurredOn, render: (i) => html`<span class="mono">${formatDate(i.occurredOn)}</span>` },
        { key: 'description', label: 'Descrição', sortValue: (i) => i.description, render: (i) => html`<a class="link-strong" href="#/projects/${i.projectId}">${i.description}</a>` },
        {
          key: 'amount',
          label: 'Valor',
          align: 'end',
          sortValue: (i) => (i.kind === 'revenue' ? i.amount : -i.amount),
          render: (i) => html`<span class="mono ${i.kind === 'revenue' ? 'amount--in' : 'amount--out'}">${i.kind === 'revenue' ? '+' : '−'} ${formatMoney(i.amount)}</span>`,
        },
        ...(withStatus
          ? [{
              key: 'status',
              label: 'Situação',
              hideOnMobile: true,
              sortValue: (/** @type {import('../../services/data.js').FinanceItem} */ i) => i.status ?? '',
              render: (/** @type {import('../../services/data.js').FinanceItem} */ i) => {
                const s = i.status ? LINK_STATUS[i.status] : null;
                return s ? html`<span class="status-pill status-pill--${s.tone}">${s.label}</span>` : muted('Falta lançar');
              },
            }]
          : []),
        ...(withUndo
          ? [{
              key: 'actions',
              label: 'Ações',
              align: /** @type {const} */ ('end'),
              render: (/** @type {import('../../services/data.js').FinanceItem} */ i) => (i.status === 'skipped' || i.status === 'sending'
                ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="unlink" data-source="${i.source}" data-id="${i.sourceId}">Voltar para a lista</button>`
                : ''),
            }]
          : []),
      ];
    };
    const revenue = total('revenue');
    const cost = total('cost');
    setHtml(
      box,
      html`<div class="push-strip">
          ${pending.length
            ? html`<p class="push-strip__text"><strong>${pending.length} lançamento${pending.length === 1 ? '' : 's'} do Master</strong> ainda não ${pending.length === 1 ? 'está' : 'estão'} no FinanceSolux${revenue ? ` · + ${formatMoney(revenue)} de receitas` : ''}${cost ? ` · − ${formatMoney(cost)} de despesas` : ''}</p>`
            : html`<p class="push-strip__text">${items.length ? 'Tudo o que o Master registrou já está no FinanceSolux.' : 'O Master ainda não registrou nenhum recebimento ou gasto.'}</p>`}
          ${manage && pending.length ? html`<button type="button" class="btn btn--primary" data-action="push">Revisar e lançar</button>` : ''}
        </div>
        ${pending.length ? html`<div class="push-table" data-pending></div>` : ''}
        ${done.length ? html`<details class="push-history"><summary class="link-action">Já lançados (${done.length})</summary><div data-done></div></details>` : ''}`,
    );
    $('[data-pending]', box)?.replaceChildren(
      dataTable({ label: 'Falta lançar no FinanceSolux', rows: pending, sort: { key: 'date', dir: 'desc' }, empty: emptyState({ title: 'Nada para lançar', compact: true }), columns: columns(pending) }),
    );
    $('[data-done]', box)?.replaceChildren(
      dataTable({ label: 'Já lançados no FinanceSolux', rows: done, sort: { key: 'date', dir: 'desc' }, empty: emptyState({ title: 'Nada lançado ainda', compact: true }), columns: columns(done) }),
    );
  };

  const load = () => Promise.all([drawMaster(), drawPush(), drawFinanceSolux()]);
  bindActions(
    root,
    {
      refresh: () => load(),
      push: async () => {
        const r = await openPushReview(org.id);
        if (signal.aborted) return;
        if (r.sent || r.skipped) await Promise.all([drawPush(), r.sent ? drawFinanceSolux() : null]);
      },
      unlink: async (el) => {
        try {
          await data.finance.clear(org.id, { source: String(el.dataset.source), sourceId: String(el.dataset.id) });
          toast('Voltou para a lista do que falta lançar.', 'success');
          await drawPush();
        } catch (error) {
          toastError(error);
        }
      },
    },
    signal,
  );
  await load();
}
