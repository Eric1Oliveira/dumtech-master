// CRM e Clientes — carteira da organização: quem é, quanto paga, se a mensalidade está em dia.
// Lista em #/customers · ficha em #/customers/<id>.
// Ler: customers.view. Cadastrar, editar e excluir: customers.manage. O banco confere tudo de novo.

import { html, setHtml, $, bindActions } from '../../shared/utils/dom.js';
import { normalize, formatInteger, formatMoney } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { CUSTOMER_STATUS, CUSTOMER_KINDS, formatDocument } from '../../core/customers.js';
import { billingStatus, monthKey } from '../../core/billing.js';
import { today } from '../../core/validate.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { dataTable } from '../../shared/components/table.js';
import { confirmDialog } from '../../shared/components/dialog.js';
import { emptyState, loadError, toast, toastError } from '../../shared/components/feedback.js';
import { statusPill } from '../../shared/components/list-page.js';
import { icon } from '../../shared/components/icons.js';
import { billingPill } from './billing-ui.js';
import { editCustomer } from './customer-form.js';
import { renderCustomerDetail } from './customer-detail.js';

/** @typedef {import('../../services/data.js').Customer} Customer */
/** @typedef {import('../../core/billing.js').BillingState} BillingState */
/** @typedef {Customer & { monthly: number, products: number, billing: BillingState | null }} Row */

const kindLabel = (/** @type {string} */ key) => CUSTOMER_KINDS.find((k) => k.key === key)?.label ?? key;
/** Pior situação do mês entre as mensalidades do cliente. */
const BILLING_RANK = { late: 0, open: 1, paid: 2, none: 3 };

/** Etiquetas clicáveis (filtram a lista). @param {string[]} tags */
export const tagChips = (tags, clickable = true) =>
  tags.length
    ? html`<span class="tags">${tags.map((t) => (clickable ? html`<button type="button" class="tag" data-action="tag" data-tag="${t}">${t}</button>` : html`<span class="tag">${t}</span>`))}</span>`
    : '';

/** @param {import('../index.js').ModuleContext} ctx */
export async function render(ctx) {
  if (ctx.route.section) return renderCustomerDetail(ctx, ctx.route.section);
  return renderList(ctx);
}

/** @param {import('../index.js').ModuleContext} ctx */
async function renderList({ root, signal }) {
  const { org } = getState();
  const manage = canDo('customers.manage');
  /** @type {Row[]} */
  let customers = [];
  let query = '';
  let status = '';

  setHtml(
    root,
    html`<header class="page-head">
        <div>
          <h1 class="page-title">Clientes</h1>
          <p class="page-sub">Carteira de ${org.name}: quem é, quanto paga e se está em dia</p>
        </div>
        ${manage
          ? html`<div class="page-actions">
              <button type="button" class="btn btn--primary" data-action="new">${icon('plus')}<span>Novo cliente</span></button>
            </div>`
          : ''}
      </header>
      <div data-strip></div>
      <section class="panel">
        <header class="panel__head">
          <div class="segmented segmented--counts" role="tablist" aria-label="Situação" data-filters></div>
          <label class="search-field">
            ${icon('search')}<span class="sr-only">Buscar cliente</span>
            <input class="input input--bare" type="search" placeholder="Nome, documento, cidade ou etiqueta" data-search>
          </label>
        </header>
        <div id="customers-table"><div class="skeleton"></div></div>
      </section>`,
  );
  const tableSlot = /** @type {HTMLElement} */ ($('#customers-table', root));
  const filters = /** @type {HTMLElement} */ ($('[data-filters]', root));
  const search = /** @type {HTMLInputElement} */ ($('[data-search]', root));

  const drawStrip = () => {
    const paying = customers.filter((c) => c.monthly > 0);
    const late = customers.filter((c) => c.billing === 'late').length;
    setHtml(
      /** @type {HTMLElement} */ ($('[data-strip]', root)),
      customers.length && canDo('products.view')
        ? html`<dl class="stat-strip stat-strip--spaced">
            <div><dt>Clientes ativos</dt><dd class="mono">${formatInteger(customers.filter((c) => c.status === 'active').length)}</dd></div>
            <div><dt>Pagando mensalidade</dt><dd class="mono">${formatInteger(paying.length)}</dd></div>
            <div><dt>Receita mensal da carteira</dt><dd class="mono">${formatMoney(paying.reduce((s, c) => s + c.monthly, 0))}</dd></div>
            <div><dt>Mensalidades atrasadas</dt><dd class="mono ${late ? 'is-overdue' : ''}">${formatInteger(late)}</dd></div>
          </dl>`
        : html``,
    );
  };

  const drawFilters = () => {
    const count = (/** @type {string} */ key) => customers.filter((c) => !key || c.status === key).length;
    setHtml(
      filters,
      html`${[{ key: '', label: 'Todos' }, ...CUSTOMER_STATUS].map(
        (s) => html`<button type="button" role="tab" class="segmented__item" aria-selected="${status === s.key}" data-status="${s.key}">
          ${s.label}<span class="segmented__count">${formatInteger(count(s.key))}</span>
        </button>`,
      )}`,
    );
  };

  const drawTable = () => {
    if (!customers.length) {
      setHtml(
        tableSlot,
        html`<div class="empty">
          <span class="empty__icon" aria-hidden="true">${icon('users')}</span>
          <p class="empty__title">Nenhum cliente cadastrado</p>
          <p class="empty__text">${manage ? 'Cadastre o primeiro cliente. Depois, na ficha dele, ligue os sites que ele usa e quanto paga.' : 'Quando a equipe cadastrar clientes, eles aparecem aqui.'}</p>
          ${manage ? html`<button type="button" class="btn btn--secondary" data-action="new">${icon('plus')}<span>Cadastrar cliente</span></button>` : ''}
        </div>`,
      );
      return;
    }
    const terms = normalize(query);
    const rows = customers.filter(
      (c) => (!status || c.status === status) && normalize(`${c.name} ${c.document ?? ''} ${formatDocument(c.document)} ${c.email ?? ''} ${c.city ?? ''} ${c.tags.join(' ')}`).includes(terms),
    );
    const seeMoney = canDo('products.view');
    tableSlot.replaceChildren(
      dataTable({
        label: 'Clientes',
        rows,
        sort: { key: 'name', dir: 'asc' },
        empty: emptyState({ title: 'Nenhum cliente encontrado', text: 'Ajuste a busca, a etiqueta ou o filtro de situação.', compact: true }),
        columns: [
          {
            key: 'name',
            label: 'Cliente',
            sortValue: (c) => c.name,
            render: (c) => html`<span class="person">
              <a class="link-strong" href="#/customers/${c.id}">${c.name}</a>
              <small>${kindLabel(c.kind)}${c.document ? html` · <span class="mono">${formatDocument(c.document)}</span>` : ''}${c.city ? ` · ${c.city}` : ''}</small>
            </span>`,
          },
          { key: 'tags', label: 'Etiquetas', hideOnMobile: true, render: (c) => tagChips(c.tags) || html`<span class="muted">—</span>` },
          ...(seeMoney
            ? [
                { key: 'monthly', label: 'Paga por mês', align: /** @type {const} */ ('end'), sortValue: (/** @type {Row} */ c) => c.monthly, render: (/** @type {Row} */ c) => (c.monthly ? html`<span class="mono">${formatMoney(c.monthly)}</span>` : html`<span class="muted">—</span>`) },
                { key: 'billing', label: 'Este mês', sortValue: (/** @type {Row} */ c) => BILLING_RANK[c.billing ?? 'none'], render: (/** @type {Row} */ c) => (c.billing && c.billing !== 'none' ? billingPill(c.billing) : html`<span class="muted">—</span>`) },
              ]
            : []),
          { key: 'status', label: 'Situação', sortValue: (c) => CUSTOMER_STATUS.findIndex((s) => s.key === c.status), render: (c) => statusPill(CUSTOMER_STATUS, c.status) },
          { key: 'owner', label: 'Responsável', hideOnMobile: true, sortValue: (c) => c.ownerName, render: (c) => c.ownerName || html`<span class="muted">—</span>` },
          ...(manage
            ? [{
                key: 'actions',
                label: 'Ações',
                align: /** @type {const} */ ('end'),
                render: (/** @type {Row} */ c) =>
                  html`<button type="button" class="icon-btn icon-btn--sm" data-action="remove" data-id="${c.id}" aria-label="Excluir ${c.name}" title="Excluir">${icon('trash')}</button>`,
              }]
            : []),
        ],
      }),
    );
  };

  const draw = () => {
    drawStrip();
    drawFilters();
    drawTable();
  };

  const load = async () => {
    try {
      const [list, subs, payments] = await Promise.all([
        data.customers.list(org.id),
        canDo('products.view') ? data.customerProducts.list(org.id) : [],
        canDo('products.view') ? data.payments.list(org.id) : [],
      ]);
      const todayKey = today();
      const month = monthKey(todayKey);
      customers = list.map((c) => {
        const mine = subs.filter((s) => s.customerId === c.id && s.status === 'active');
        const states = mine.map((s) => billingStatus(s, payments, month, todayKey)).filter((s) => s !== 'none');
        return {
          ...c,
          monthly: mine.reduce((sum, s) => sum + (s.monthlyAmount ?? 0), 0),
          products: mine.length,
          billing: states.length ? states.sort((a, b) => BILLING_RANK[a] - BILLING_RANK[b])[0] : null,
        };
      });
      if (!signal.aborted) draw();
    } catch (error) {
      if (!signal.aborted) setHtml(tableSlot, loadError(error));
    }
  };

  search.addEventListener('input', () => {
    query = search.value;
    drawTable();
  }, { signal });

  filters.addEventListener('click', (event) => {
    const tab = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('[data-status]'));
    if (!tab) return;
    status = tab.dataset.status;
    drawFilters();
    drawTable();
  }, { signal });

  bindActions(
    root,
    {
      new: async () => {
        if (await editCustomer(null).catch((e) => (toastError(e), false))) {
          toast('Cliente cadastrado.', 'success');
          load();
        }
      },
      tag: (el) => {
        search.value = el.dataset.tag;
        query = search.value;
        drawTable();
      },
      remove: async (el) => {
        const c = customers.find((x) => x.id === el.dataset.id);
        const ok = await confirmDialog({
          title: 'Excluir cliente?',
          message: `“${c.name}” sai da carteira, junto com os contatos e as mensalidades dele. A exclusão fica registrada na auditoria.`,
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!ok) return;
        try {
          await data.customers.remove(org.id, c.id);
          toast('Cliente excluído.', 'success');
          load();
        } catch (error) {
          toastError(error);
        }
      },
    },
    signal,
  );

  await load();
}
