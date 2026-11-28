// Clientes no celular: busca, quanto cada um paga e se está em dia no mês; no detalhe, os
// contatos com toque para ligar ou abrir o WhatsApp, os projetos, os pagamentos e as propostas.

import { html } from '../../shared/utils/dom.js';
import { formatMoney, formatDate, formatMonth, normalize } from '../../shared/utils/format.js';
import { billingStatus, monthKey } from '../../core/billing.js';
import { CUSTOMER_STATUS, CUSTOMER_KINDS, formatDocument, whatsappLink, primaryPhone } from '../../core/customers.js';
import { proposalNumber, PROPOSAL_STATUS } from '../../core/proposals.js';
import { icon } from '../../shared/components/icons.js';
import { empty, section, list, row, pill, billingPill, dot } from '../ui.js';

const RANK = /** @type {Record<string, number>} */ ({ late: 3, open: 2, paid: 1, none: 0 });

/** Situação do cliente no mês: a pior das mensalidades ativas. @param {import('../model.js').Model} m @param {string} customerId */
function monthState(m, customerId) {
  if (!m.payments) return null;
  const month = monthKey(m.todayKey);
  const states = m.subs.filter((s) => s.customerId === customerId && s.status === 'active' && s.monthlyAmount).map((s) => billingStatus(s, /** @type {any[]} */ (m.payments), month, m.todayKey));
  return states.sort((a, b) => RANK[b] - RANK[a])[0] ?? null;
}

const tel = (/** @type {string} */ phone) => `tel:${String(phone).replace(/[^\d+]/g, '')}`;

/** Botões de contato (só abrem o telefone, o WhatsApp ou o e-mail do celular). @param {{ phone?: string | null, email?: string | null }} c */
function reach(c) {
  const wa = whatsappLink(c.phone ?? null);
  return html`<div class="m-reach">
    ${c.phone ? html`<a class="m-reach__btn" href="${tel(c.phone)}">${icon('phone')}<span>Ligar</span></a>` : ''}
    ${wa ? html`<a class="m-reach__btn" href="${wa}" target="_blank" rel="noopener noreferrer">${icon('message')}<span>WhatsApp</span></a>` : ''}
    ${c.email ? html`<a class="m-reach__btn" href="mailto:${c.email}">${icon('mail')}<span>E-mail</span></a>` : ''}
  </div>`;
}

/** @param {import('../model.js').Model} m */
function listView(m) {
  if (!m.can('customers.view')) return empty('Sem acesso aos clientes', 'Seu papel nesta organização não inclui os clientes.');
  if (!m.customers.length) return empty('Nenhum cliente ainda', 'Os clientes cadastrados no computador aparecem aqui.');
  return html`
    <label class="m-search">${icon('search')}<span class="sr-only">Buscar cliente</span>
      <input type="search" placeholder="Buscar por nome, cidade ou etiqueta" data-search autocomplete="off" enterkeyhint="search"></label>
    <ul class="m-list" data-results>${m.customers.map((c) => {
      const monthly = m.subs.filter((s) => s.customerId === c.id && s.status === 'active').reduce((t, s) => t + (s.monthlyAmount ?? 0), 0);
      const state = monthState(m, c.id);
      const status = CUSTOMER_STATUS.find((s) => s.key === c.status);
      return html`<li data-text="${normalize(`${c.name} ${c.city ?? ''} ${(c.tags ?? []).join(' ')}`)}">
        <a class="m-row" href="#/clientes/${c.id}">
          <span class="m-row__lead">${dot(state === 'late' ? 'error' : state === 'paid' ? 'ok' : state === 'open' ? 'info' : 'muted')}</span>
          <span class="m-row__body"><span class="m-row__title">${c.name}</span><span class="m-row__sub">${[c.city, status?.label].filter(Boolean).join(' · ')}</span></span>
          <span class="m-row__end">${monthly ? html`<span class="m-row__value">${formatMoney(monthly)}</span>` : ''}${state && state !== 'none' ? html`<span class="m-row__sub">${state === 'late' ? 'atrasado' : state === 'paid' ? 'pago no mês' : 'em aberto'}</span>` : ''}</span>
          <span class="m-row__chev" aria-hidden="true">${icon('chevronRight')}</span>
        </a></li>`;
    })}</ul>
    <p class="m-empty__text" data-none hidden>Nenhum cliente com esse nome.</p>`;
}

/** @param {import('../model.js').Model} m @param {string} id */
function detailView(m, id) {
  const c = m.customers.find((x) => x.id === id);
  if (!c) return empty('Cliente não encontrado', 'Ele pode ter sido excluído no computador.');
  const month = monthKey(m.todayKey);
  const status = CUSTOMER_STATUS.find((s) => s.key === c.status);
  const kind = CUSTOMER_KINDS.find((k) => k.key === c.kind);
  const contacts = m.contacts.filter((x) => x.customerId === c.id);
  const subs = m.subs.filter((s) => s.customerId === c.id && s.status !== 'cancelled');
  const subIds = new Set(subs.map((s) => s.id));
  const paid = (m.payments ?? []).filter((p) => subIds.has(p.subscriptionId)).slice(0, 6);
  const productName = new Map(subs.map((s) => [s.id, s.productName]));
  const proposals = m.proposals.filter((p) => p.customerId === c.id);
  return html`
    <header class="m-detail">
      <div class="m-detail__pills">${pill(status?.label ?? c.status, status?.tone ?? 'muted')}${kind ? pill(kind.label) : ''}</div>
      <h2 class="m-detail__title">${c.name}</h2>
      <p class="m-detail__meta">${[c.document ? `${kind?.document ?? 'Documento'} ${formatDocument(c.document)}` : '', c.city].filter(Boolean).join(' · ')}</p>
      ${reach({ phone: primaryPhone(c, contacts), email: c.email })}
    </header>
    ${subs.length
      ? section('Projetos', list(subs.map((s) => row({
          href: `#/projetos/${s.productId}`,
          title: s.productName || 'Projeto',
          sub: s.billingDay ? `vence todo dia ${s.billingDay}` : s.status === 'pending' ? 'começa a pagar quando publicar' : '',
          end: s.monthlyAmount ? formatMoney(s.monthlyAmount) : '',
          endSub: m.payments && s.status === 'active' ? billingPill(billingStatus(s, m.payments, month, m.todayKey)) : '',
        }))))
      : ''}
    ${contacts.length
      ? section('Contatos', html`<ul class="m-list">${contacts.map((x) => html`<li><div class="m-row m-row--stack">
          <span class="m-row__body"><span class="m-row__title">${x.name}${x.isPrimary ? html` <span class="m-row__tag">principal</span>` : ''}</span>
            <span class="m-row__sub">${[x.role, x.phone, x.email].filter(Boolean).join(' · ')}</span></span>
          ${reach(x)}</div></li>`)}</ul>`)
      : ''}
    ${paid.length
      ? section('Últimos pagamentos', list(paid.map((p) => row({
          title: formatMonth(p.month),
          sub: `${productName.get(p.subscriptionId) ?? ''} · pago em ${formatDate(p.paidOn)}`,
          end: formatMoney(p.amount),
        }))))
      : ''}
    ${proposals.length && m.can('proposals.view')
      ? section('Propostas', list(proposals.map((p) => {
          const s = PROPOSAL_STATUS.find((k) => k.key === p.status);
          return row({ title: `${proposalNumber(p.number)} · ${p.title}`, sub: p.validUntil ? `válida até ${formatDate(p.validUntil)}` : '', end: pill(s?.label ?? p.status, s?.tone ?? 'muted') });
        })))
      : ''}
    ${c.notes ? section('Observações', html`<p class="m-note">${c.notes}</p>`) : ''}`;
}

export default {
  /** @param {import('../model.js').Model} m @param {{ id: string | null }} route */
  title: (m, route) => (route.id ? (m.customers.find((c) => c.id === route.id)?.name ?? 'Cliente') : 'Clientes'),
  back: (/** @type {any} */ _m, /** @type {{ id: string | null }} */ route) => (route.id ? '#/clientes' : null),
  /** @param {import('../model.js').Model} m @param {{ id: string | null }} route */
  render: (m, route) => (route.id ? detailView(m, route.id) : listView(m)),
  /** Busca na própria lista (nada sai do celular). @param {HTMLElement} el */
  mount(el) {
    const input = /** @type {HTMLInputElement | null} */ (el.querySelector('[data-search]'));
    if (!input) return;
    const items = /** @type {HTMLElement[]} */ ([...el.querySelectorAll('[data-results] > li')]);
    const none = /** @type {HTMLElement} */ (el.querySelector('[data-none]'));
    input.addEventListener('input', () => {
      const q = normalize(input.value.trim());
      let shown = 0;
      for (const li of items) {
        const hit = !q || String(li.dataset.text).includes(q);
        li.hidden = !hit;
        if (hit) shown += 1;
      }
      none.hidden = shown > 0;
    });
  },
};
