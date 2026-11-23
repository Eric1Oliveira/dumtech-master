// Ficha do cliente (#/customers/<id>): dados, contatos, o que usa e paga, cobranças, propostas e projetos.

import { html, setHtml, $, bindActions } from '../../shared/utils/dom.js';
import { formatDate, formatMoney, formatMonth, formatInteger, formatRelative } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { CUSTOMER_STATUS, CUSTOMER_KINDS, formatDocument, whatsappLink } from '../../core/customers.js';
import { billingStatus, monthKey } from '../../core/billing.js';
import { PROPOSAL_STATUS, proposalNumber } from '../../core/proposals.js';
import { PRODUCT_STATUS } from '../../core/catalog.js';
import { today } from '../../core/validate.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { dataTable } from '../../shared/components/table.js';
import { confirmDialog } from '../../shared/components/dialog.js';
import { statusPill } from '../../shared/components/list-page.js';
import { emptyState, loadError, toast, toastError } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';
import { editCustomer, editContact, docLabel } from './customer-form.js';
import { billingPill, linkSubscription, editSubscription, markPaid, undoPayment, monthCell } from './billing-ui.js';

/** @typedef {import('../../services/data.js').Customer} Customer */
/** @typedef {import('../../services/data.js').CustomerProduct} Subscription */

const muted = (/** @type {string} */ text = '—') => html`<span class="muted">${text}</span>`;
const kindLabel = (/** @type {string} */ key) => CUSTOMER_KINDS.find((k) => k.key === key)?.label ?? key;
const RANK = { late: 0, open: 1, paid: 2, none: 3 };

/**
 * @param {import('../index.js').ModuleContext} ctx
 * @param {string} id
 */
export async function renderCustomerDetail({ root, module, signal }, id) {
  const { org } = getState();
  const manage = canDo('customers.manage');
  const manageProducts = canDo('products.manage');
  const seeProducts = canDo('products.view');
  setHtml(root, html`<div class="skeleton"></div>`);

  /** @type {Customer | undefined} */
  let customer;
  /** @type {import('../../services/data.js').CustomerContact[]} */
  let contacts = [];
  /** @type {Subscription[]} */
  let subs = [];
  /** @type {import('../../services/data.js').Payment[]} */
  let payments = [];
  /** @type {import('../../services/data.js').Proposal[] | null} */
  let proposals = null;
  /** @type {Map<string, string>} etapa de cada projeto */
  let stages = new Map();
  /** @type {import('../../services/data.js').PageMeta[]} páginas do Caderno ligadas ao cliente */
  let pages = [];

  const load = async () => {
    let all;
    let products;
    [all, contacts, subs, payments, proposals, products] = await Promise.all([
      data.customers.list(org.id),
      data.customerContacts.list(org.id, { customerId: id }),
      seeProducts ? data.customerProducts.list(org.id, { customerId: id }) : [],
      data.payments.list(org.id),
      canDo('proposals.view') ? data.proposals.list(org.id).then((l) => l.filter((p) => p.customerId === id)) : null,
      seeProducts ? data.products.list(org.id) : [],
    ]);
    customer = all.find((c) => c.id === id);
    stages = new Map(products.map((p) => /** @type {[string, string]} */ ([p.id, p.status])));
    pages = canDo('workspace.view') ? (await data.pages.list(org.id).catch(() => [])).filter((p) => p.customerId === id && !p.archivedAt) : [];
    const mine = new Set(subs.map((s) => s.id));
    payments = payments.filter((p) => mine.has(p.subscriptionId));
  };

  const todayKey = today();
  const month = monthKey(todayKey);
  const stateOf = (/** @type {Subscription} */ s) => billingStatus(s, payments, month, todayKey);
  const paymentOf = (/** @type {string} */ subId) => payments.find((p) => p.subscriptionId === subId && p.month === month) ?? null;

  const draw = () => {
    if (!customer) {
      setHtml(root, emptyState({ title: 'Cliente não encontrado', text: 'Ele pode ter sido excluído.', action: { label: 'Voltar à carteira', href: '#/customers' } }));
      return;
    }
    const c = customer;
    document.title = `${c.name} · ${module.name} — DUMTech Master`;
    const active = subs.filter((s) => s.status === 'active');
    const monthly = active.reduce((sum, s) => sum + (s.monthlyAmount ?? 0), 0);
    const states = active.map(stateOf).filter((s) => s !== 'none');
    const worst = states.sort((a, b) => RANK[a] - RANK[b])[0] ?? null;
    const late = states.filter((s) => s === 'late').length;
    const received = payments.filter((p) => p.month.startsWith(todayKey.slice(0, 4))).reduce((s, p) => s + p.amount, 0);

    setHtml(
      root,
      html`<header class="page-head">
          <div>
            <p class="eyebrow"><a class="back-link" href="#/customers">${icon('arrowLeft')}Clientes</a></p>
            <h1 class="page-title">${c.name}</h1>
            <p class="page-sub page-sub--row">${kindLabel(c.kind)}${c.document ? html` · <span class="mono">${formatDocument(c.document)}</span>` : ''} ${statusPill(CUSTOMER_STATUS, c.status)}
              ${c.tags.length ? html`<span class="tags">${c.tags.map((t) => html`<span class="tag">${t}</span>`)}</span>` : ''}</p>
          </div>
          ${manage
            ? html`<div class="page-actions">
                <button type="button" class="btn btn--ghost" data-action="remove">${icon('trash')}<span>Excluir</span></button>
                <button type="button" class="btn btn--secondary" data-action="edit">${icon('edit')}<span>Editar</span></button>
              </div>`
            : ''}
        </header>
        ${seeProducts
          ? html`<dl class="stat-strip stat-strip--spaced">
              <div><dt>Paga por mês</dt><dd class="mono">${formatMoney(monthly)}</dd></div>
              <div><dt>${formatMonth(month)}</dt><dd>${worst ? billingPill(worst) : muted('sem cobrança')}</dd></div>
              <div><dt>Mensalidades atrasadas</dt><dd class="mono ${late ? 'is-overdue' : ''}">${formatInteger(late)}</dd></div>
              <div><dt>Recebido em ${todayKey.slice(0, 4)}</dt><dd class="mono">${formatMoney(received)}</dd></div>
            </dl>`
          : ''}
        <div class="detail-layout">
          <div class="detail-main">
            ${seeProducts
              ? html`<section class="panel" aria-labelledby="subs-title">
                  <header class="panel__head">
                    <div><h2 class="panel__title" id="subs-title">Projetos</h2><p class="panel__hint">Valor, vencimento e situação de ${formatMonth(month)}</p></div>
                    <div class="panel__tools">
                      ${manageProducts ? html`<button type="button" class="btn btn--secondary btn--sm" data-action="link">${icon('plus')}<span>Sistema existente</span></button>
                        <a class="btn btn--primary btn--sm" href="#/projects/novo?customer=${c.id}">${icon('plus')}<span>Novo projeto</span></a>` : ''}
                    </div>
                  </header>
                  <div data-subs></div>
                </section>
                <section class="panel" aria-labelledby="pay-title">
                  <header class="panel__head"><h2 class="panel__title" id="pay-title">Pagamentos recebidos</h2></header>
                  <div data-payments></div>
                </section>`
              : ''}
            ${proposals ? html`<section class="panel" aria-labelledby="prop-title"><header class="panel__head"><h2 class="panel__title" id="prop-title">Propostas</h2></header><div data-proposals></div></section>` : ''}
            ${pages.length ? html`<section class="panel" aria-labelledby="nb-title"><header class="panel__head"><h2 class="panel__title" id="nb-title">Caderno</h2></header><ul class="nb-list">${pages.map((pg) => html`<li><a class="nb-list__link" href="#/workspace/${pg.id}"><span class="nb-list__icon" aria-hidden="true">${pg.icon || (pg.kind === 'meeting' ? '🎙️' : '📄')}</span><span class="nb-list__title">${pg.title || 'Sem título'}</span><small>editada ${formatRelative(pg.updatedAt)}</small></a></li>`)}</ul></section>` : ''}
          </div>
          <aside class="detail-aside">
            <section class="panel" aria-labelledby="contact-title">
              <header class="panel__head"><h2 class="panel__title" id="contact-title">Contato</h2></header>
              <dl class="facts facts--stack">
                <div><dt>E-mail</dt><dd>${c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : '—'}</dd></div>
                <div><dt>Telefone</dt><dd>${phoneLinks(c.phone)}</dd></div>
                <div><dt>Cidade</dt><dd>${c.city || '—'}</dd></div>
                <div><dt>${docLabel(c.kind)}</dt><dd class="mono">${formatDocument(c.document) || '—'}</dd></div>
                <div><dt>Responsável</dt><dd>${c.ownerName || '—'}</dd></div>
                <div><dt>Cliente desde</dt><dd>${formatDate(c.createdAt.slice(0, 10))}</dd></div>
              </dl>
              ${c.notes ? html`<p class="prewrap detail-text">${c.notes}</p>` : ''}
            </section>
            <section class="panel" aria-labelledby="people-title">
              <header class="panel__head">
                <h2 class="panel__title" id="people-title">Pessoas de contato</h2>
                ${manage ? html`<button type="button" class="icon-btn icon-btn--sm" data-action="new-contact" aria-label="Adicionar pessoa de contato" title="Adicionar">${icon('plus')}</button>` : ''}
              </header>
              ${contacts.length
                ? html`<ul class="people">${[...contacts].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map(
                    (p) => html`<li class="people__item">
                      <span class="avatar" aria-hidden="true">${p.name.slice(0, 2).toUpperCase()}</span>
                      <span class="people__text">
                        <strong>${p.name}${p.isPrimary ? html` <span class="status-pill status-pill--info">principal</span>` : ''}</strong>
                        ${p.role ? html`<small>${p.role}</small>` : ''}
                        <small>${phoneLinks(p.phone)}${p.email ? html` · <a href="mailto:${p.email}">${p.email}</a>` : ''}</small>
                      </span>
                      ${manage
                        ? html`<span class="row-actions">
                            <button type="button" class="icon-btn icon-btn--sm" data-action="edit-contact" data-contact="${p.id}" aria-label="Editar ${p.name}" title="Editar">${icon('edit')}</button>
                            <button type="button" class="icon-btn icon-btn--sm" data-action="remove-contact" data-contact="${p.id}" aria-label="Excluir ${p.name}" title="Excluir">${icon('trash')}</button>
                          </span>`
                        : ''}
                    </li>`,
                  )}</ul>`
                : emptyState({ title: 'Nenhuma pessoa cadastrada', text: 'Quem decide, quem paga, quem usa o sistema.', compact: true })}
            </section>
          </aside>
        </div>`,
    );
    drawTables();
  };

  const drawTables = () => {
    const subsSlot = $('[data-subs]', root);
    subsSlot?.replaceChildren(
      dataTable({
        label: 'Sites e sistemas que usa',
        rows: subs,
        sort: { key: 'product', dir: 'asc' },
        empty: emptyState({ title: 'Nenhum projeto ainda', text: 'Use “Novo projeto”: o que inclui e os valores saem em 4 passos.', compact: true }),
        columns: [
          { key: 'product', label: 'Projeto', sortValue: (s) => s.productName, render: (s) => html`<span class="person"><a class="link-strong" href="#/projects/${s.productId}">${s.productName}</a><small>${statusPill(PRODUCT_STATUS, stages.get(s.productId) ?? 'live')} ${s.status === 'pending' ? 'combinada · começa ao publicar' : s.status === 'cancelled' ? 'cancelada' : `desde ${formatDate(s.since)}`}</small></span>` },
          { key: 'amount', label: 'Valor/mês', align: 'end', sortValue: (s) => s.monthlyAmount ?? 0, render: (s) => (s.monthlyAmount ? html`<span class="mono">${formatMoney(s.monthlyAmount)}</span>` : muted()) },
          { key: 'day', label: 'Vence', hideOnMobile: true, sortValue: (s) => s.billingDay ?? 99, render: (s) => (s.billingDay ? `dia ${s.billingDay}` : muted()) },
          { key: 'month', label: 'Este mês', sortValue: (s) => RANK[stateOf(s)], render: (s) => monthCell(stateOf(s), paymentOf(s.id)) },
          {
            key: 'actions',
            label: 'Ações',
            align: 'end',
            render: (s) => html`<span class="row-actions">
              ${manage && s.status === 'active' && s.monthlyAmount
                ? paymentOf(s.id)
                  ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="undo-paid" data-sub="${s.id}">Desfazer</button>`
                  : html`<button type="button" class="btn btn--quiet btn--sm" data-action="paid" data-sub="${s.id}">${icon('check')}<span>Pago</span></button>`
                : ''}
              ${manageProducts ? html`<button type="button" class="icon-btn icon-btn--sm" data-action="edit-sub" data-sub="${s.id}" aria-label="Editar mensalidade de ${s.productName}" title="Editar mensalidade">${icon('edit')}</button>` : ''}
            </span>`,
          },
        ],
      }),
    );

    const subName = (/** @type {string} */ subId) => subs.find((s) => s.id === subId)?.productName ?? '';
    $('[data-payments]', root)?.replaceChildren(
      dataTable({
        label: 'Pagamentos recebidos',
        rows: payments.slice(0, 24),
        sort: { key: 'month', dir: 'desc' },
        empty: emptyState({ title: 'Nenhum pagamento registrado', text: 'Use “Pago” na mensalidade do mês para registrar.', compact: true }),
        columns: [
          { key: 'month', label: 'Mês', sortValue: (p) => p.month, render: (p) => formatMonth(p.month) },
          { key: 'product', label: 'Projeto', hideOnMobile: true, sortValue: (p) => subName(p.subscriptionId), render: (p) => subName(p.subscriptionId) },
          { key: 'amount', label: 'Valor', align: 'end', sortValue: (p) => p.amount, render: (p) => html`<span class="mono">${formatMoney(p.amount)}</span>` },
          { key: 'paid', label: 'Pago em', sortValue: (p) => p.paidOn, render: (p) => html`<span class="person"><span class="mono">${formatDate(p.paidOn)}</span>${p.note ? html`<small>${p.note}</small>` : ''}</span>` },
        ],
      }),
    );

    if (proposals) {
      $('[data-proposals]', root)?.replaceChildren(
        dataTable({
          label: 'Propostas',
          rows: proposals,
          sort: { key: 'number', dir: 'desc' },
          empty: emptyState({ title: 'Nenhuma proposta para este cliente', compact: true }),
          columns: [
            { key: 'number', label: 'Proposta', sortValue: (p) => p.number, render: (p) => html`<span class="person"><a class="link-strong" href="#/proposals/${p.id}">${proposalNumber(p.number)} · ${p.title}</a><small>${p.validUntil ? `válida até ${formatDate(p.validUntil)}` : ''}</small></span>` },
            { key: 'status', label: 'Situação', sortValue: (p) => p.status, render: (p) => statusPill(PROPOSAL_STATUS, p.status) },
            { key: 'total', label: 'Valor', align: 'end', sortValue: (p) => p.totalMonthly + p.totalOnce, render: (p) => html`<span class="person"><span class="mono">${formatMoney(p.totalOnce)}</span>${p.totalMonthly ? html`<small>+ ${formatMoney(p.totalMonthly)}/mês</small>` : ''}</span>` },
          ],
        }),
      );
    }
  };

  const refresh = async () => {
    try {
      await load();
      if (!signal.aborted) draw();
    } catch (error) {
      toastError(error);
    }
  };
  const subOf = (/** @type {string} */ subId) => /** @type {Subscription} */ (subs.find((s) => s.id === subId));
  /** Roda a ação; se ela confirmar, avisa e recarrega a ficha. @param {() => Promise<unknown>} action @param {string} message */
  const run = async (action, message) => {
    if (await action().catch((e) => (toastError(e), false))) {
      toast(message, 'success');
      refresh();
    }
  };

  try {
    await load();
  } catch (error) {
    if (!signal.aborted) setHtml(root, loadError(error));
    return;
  }
  if (signal.aborted) return;
  draw();

  bindActions(root, {
    edit: () => run(() => editCustomer(/** @type {Customer} */ (customer)), 'Cliente atualizado.'),
    remove: async () => {
      const c = /** @type {Customer} */ (customer);
      const ok = await confirmDialog({ title: 'Excluir cliente?', message: `“${c.name}” sai da carteira, junto com os contatos e as mensalidades dele. A exclusão fica registrada na auditoria.`, confirmLabel: 'Excluir', danger: true });
      if (!ok) return;
      try {
        await data.customers.remove(org.id, c.id);
        toast('Cliente excluído.', 'success');
        location.hash = '#/customers';
      } catch (error) {
        toastError(error);
      }
    },
    link: async () => {
      const products = (await data.products.list(org.id)).filter((p) => p.status !== 'ended' && !subs.some((s) => s.productId === p.id && s.status !== 'cancelled'));
      if (!products.length) return toast('Não há outro projeto para incluir. Use “Novo projeto”.', 'info');
      run(() => linkSubscription(org.id, { customers: [], products, customerId: id, title: 'Cliente de um sistema existente' }), 'Mensalidade salva.');
    },
    'edit-sub': (el) => run(() => editSubscription(org.id, subOf(el.dataset.sub)), 'Mensalidade atualizada.'),
    paid: (el) => run(() => markPaid(org.id, subOf(el.dataset.sub)), 'Pagamento registrado.'),
    'undo-paid': (el) => {
      const sub = subOf(el.dataset.sub);
      const payment = paymentOf(sub.id);
      if (payment) run(() => undoPayment(org.id, payment, sub), 'Pagamento desfeito.');
    },
    'new-contact': () => run(() => editContact(id, null), 'Contato adicionado.'),
    'edit-contact': (el) => run(() => editContact(id, contacts.find((p) => p.id === el.dataset.contact) ?? null), 'Contato atualizado.'),
    'remove-contact': async (el) => {
      const person = contacts.find((p) => p.id === el.dataset.contact);
      const ok = await confirmDialog({ title: 'Excluir contato?', message: `${person.name} sai da ficha de ${customer?.name}.`, confirmLabel: 'Excluir', danger: true });
      if (ok) run(() => data.customerContacts.remove(org.id, person.id).then(() => true), 'Contato excluído.');
    },
  }, signal);
}

/** Telefone com link de ligar e de WhatsApp. @param {string | null} phone */
function phoneLinks(phone) {
  if (!phone) return '—';
  const wa = whatsappLink(phone);
  return html`<span class="phone-links"><a href="tel:${phone.replace(/[^\d+]/g, '')}">${phone}</a>${wa ? html`<a class="wa-link" href="${wa}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}</span>`;
}
