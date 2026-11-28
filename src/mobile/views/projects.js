// Projetos no celular: por etapa (publicados, em construção, proposta; encerrados recolhidos),
// o detalhe de cada um (no ar, dinheiro, clientes com a situação do mês, tarefas abertas) e as propostas.

import { html } from '../../shared/utils/dom.js';
import { formatMoney, formatDate, formatDateTime } from '../../shared/utils/format.js';
import { billingStatus, monthKey } from '../../core/billing.js';
import { proposalNumber, PROPOSAL_STATUS } from '../../core/proposals.js';
import { causeText, durationText, pctText } from '../../core/monitor.js';
import { dayLabel } from '../../core/today.js';
import { icon } from '../../shared/components/icons.js';
import { pct } from '../model.js';
import { empty, section, list, row, pill, stagePill, monitorPill, monitorTone, billingPill, dot, host } from '../ui.js';

/** @param {import('../model.js').Model} m @param {string} productId */
const monthlyOf = (m, productId) => m.subs.filter((s) => s.productId === productId && s.status === 'active').reduce((t, s) => t + (s.monthlyAmount ?? 0), 0);

/** @param {import('../model.js').Model} m @param {any} p */
function projectRow(m, p) {
  const site = m.monitors.find((x) => x.productId === p.id && x.kind === 'site');
  const customers = m.subs.filter((s) => s.productId === p.id && s.status !== 'cancelled').map((s) => s.customerName).filter(Boolean);
  const monthly = monthlyOf(m, p.id);
  return row({
    href: `#/projetos/${p.id}`,
    lead: site ? dot(monitorTone(site)) : '',
    title: p.name,
    sub: customers.join(', ') || (p.kind === 'system' ? 'Sistema' : 'Site'),
    end: monthly ? formatMoney(monthly) : '',
    endSub: p.status === 'live' && site ? monitorPill(site) : p.status !== 'live' ? stagePill(p.status) : '',
  });
}

/** @param {import('../model.js').Model} m */
function listView(m) {
  if (!m.can('products.view')) return empty('Sem acesso aos projetos', 'Seu papel nesta organização não inclui os projetos.');
  if (!m.products.length) return empty('Nenhum projeto ainda', 'Os projetos criados no computador aparecem aqui.');
  const by = (/** @type {string} */ s) => m.products.filter((p) => p.status === s);
  const waiting = m.proposals.filter((p) => p.status === 'sent').length;
  const ended = by('ended');
  return html`
    ${m.can('proposals.view') && m.proposals.length
      ? html`<a class="m-banner" href="#/propostas">${icon('fileText')}<span><strong>Propostas</strong> · ${waiting ? `${waiting} esperando resposta` : `${m.proposals.length} no total`}</span>${icon('chevronRight')}</a>`
      : ''}
    ${[['live', 'Publicados'], ['building', 'Em construção'], ['proposal', 'Proposta']].map(([key, title]) => {
      const rows = by(key);
      return rows.length ? section(title, list(rows.map((p) => projectRow(m, p))), String(rows.length)) : '';
    })}
    ${ended.length ? html`<details class="m-fold"><summary>Encerrados · ${ended.length}</summary>${list(ended.map((p) => projectRow(m, p)))}</details>` : ''}`;
}

/** @param {import('../model.js').Model} m @param {string} id */
function detailView(m, id) {
  const p = m.products.find((x) => x.id === id);
  if (!p) return empty('Projeto não encontrado', 'Ele pode ter sido excluído no computador.');
  const month = monthKey(m.todayKey);
  const monitors = m.monitors.filter((x) => x.productId === p.id);
  const subs = m.subs.filter((s) => s.productId === p.id && s.status !== 'cancelled');
  const monthly = monthlyOf(m, p.id);
  const cost = m.costs ? m.costs.projectCost(p.id) : null;
  const incidents = m.incidents.filter((i) => monitors.some((x) => x.id === i.monitorId));
  const tasks = m.tasks.filter((t) => t.productId === p.id);
  const proposals = m.proposals.filter((x) => x.productId === p.id);
  const setup = p.setupAmount
    ? p.setupOutside ? 'paga antes da empresa' : p.setupPaidOn ? `recebida em ${formatDate(p.setupPaidOn)}` : 'a receber'
    : '';
  return html`
    <header class="m-detail">
      <div class="m-detail__pills">${stagePill(p.status)}${p.kind === 'system' ? pill('Sistema') : pill('Site')}</div>
      <h2 class="m-detail__title">${p.name}</h2>
      ${p.url ? html`<a class="m-detail__link" href="${p.url}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${host(p.url)}</span></a>` : ''}
    </header>
    ${monitors.length
      ? section('No ar', list(monitors.map((x) => {
          const u = m.uptime.get(x.id);
          return row({
            lead: dot(monitorTone(x)),
            title: x.label,
            sub: `24 h ${pctText(u ? pct(Number(u.dayOk), Number(u.dayChecks)) : null)} · 30 dias ${pctText(u ? pct(Number(u.monthOk), Number(u.monthChecks)) : null)}`,
            end: monitorPill(x),
            endSub: x.lastMs ? `${x.lastMs} ms` : '',
          });
        })))
      : ''}
    ${m.can('customers.view') || monthly
      ? section('Dinheiro', html`<dl class="m-ledger">
          <div><dt>Mensalidade</dt><dd>${monthly ? formatMoney(monthly) : '—'}</dd></div>
          ${cost !== null ? html`<div><dt>Custo dos serviços</dt><dd>− ${formatMoney(cost)}</dd></div>
            <div class="m-ledger__total"><dt>Lucro por mês</dt><dd class="${monthly - cost < 0 ? 'is-negative' : ''}">${formatMoney(monthly - cost)}</dd></div>` : ''}
          ${p.setupAmount ? html`<div><dt>Implantação</dt><dd>${formatMoney(p.setupAmount)}<small>${setup}</small></dd></div>` : ''}
        </dl>`)
      : ''}
    ${subs.length
      ? section('Clientes', list(subs.map((s) => row({
          href: m.can('customers.view') ? `#/clientes/${s.customerId}` : null,
          title: s.customerName || 'Cliente',
          sub: s.billingDay ? `vence todo dia ${s.billingDay}` : s.status === 'pending' ? 'começa a pagar quando publicar' : 'sem dia de cobrança',
          end: s.monthlyAmount ? formatMoney(s.monthlyAmount) : '',
          endSub: m.payments && s.status === 'active' ? billingPill(billingStatus(s, m.payments, month, m.todayKey)) : '',
        }))))
      : ''}
    ${tasks.length
      ? section('Tarefas abertas', list(tasks.map((t) => row({
          lead: dot(t.dueDate && t.dueDate < m.todayKey ? 'error' : 'muted'),
          title: t.title,
          sub: [t.assigneeName, t.dueDate ? dayLabel(t.dueDate, m.todayKey) : ''].filter(Boolean).join(' · ') || 'sem responsável',
        }))), String(tasks.length))
      : ''}
    ${proposals.length && m.can('proposals.view') ? section('Propostas', list(proposals.map((x) => proposalRow(x)))) : ''}
    ${incidents.length
      ? section('Quedas nos últimos 30 dias', list(incidents.map((i) => row({
          lead: dot(i.endedAt ? 'muted' : 'error'),
          title: formatDateTime(i.startedAt),
          sub: causeText(i.cause, i.code),
          end: i.endedAt ? durationText(Date.parse(i.endedAt) - Date.parse(i.startedAt)) : 'ainda fora',
        }))))
      : ''}`;
}

/** @param {any} x */
function proposalRow(x) {
  const s = PROPOSAL_STATUS.find((k) => k.key === x.status);
  const values = [x.totalOnce ? formatMoney(x.totalOnce) : '', x.totalMonthly ? `${formatMoney(x.totalMonthly)}/mês` : ''].filter(Boolean).join(' + ');
  return row({
    href: x.productId ? `#/projetos/${x.productId}` : null,
    title: `${proposalNumber(x.number)} · ${x.title}`,
    sub: [x.customerName, x.validUntil ? `válida até ${formatDate(x.validUntil)}` : ''].filter(Boolean).join(' · '),
    end: pill(s?.label ?? x.status, s?.tone ?? 'muted'),
    endSub: values,
  });
}

export const proposals = {
  title: () => 'Propostas',
  back: () => '#/projetos',
  /** @param {import('../model.js').Model} m */
  render(m) {
    if (!m.can('proposals.view')) return empty('Sem acesso às propostas');
    if (!m.proposals.length) return empty('Nenhuma proposta ainda');
    return html`${PROPOSAL_STATUS.map((s) => {
      const rows = m.proposals.filter((x) => x.status === s.key).slice(0, s.key === 'sent' || s.key === 'draft' ? 50 : 10);
      return rows.length ? section({ sent: 'Esperando resposta', draft: 'Rascunhos', accepted: 'Aceitas', rejected: 'Recusadas' }[s.key] ?? s.label, list(rows.map(proposalRow)), String(rows.length)) : '';
    })}`;
  },
};

export default {
  /** @param {import('../model.js').Model} m @param {{ id: string | null }} route */
  title: (m, route) => (route.id ? (m.products.find((p) => p.id === route.id)?.name ?? 'Projeto') : 'Projetos'),
  back: (/** @type {any} */ _m, /** @type {{ id: string | null }} */ route) => (route.id ? '#/projetos' : null),
  /** @param {import('../model.js').Model} m @param {{ id: string | null }} route */
  render: (m, route) => (route.id ? detailView(m, route.id) : listView(m)),
};
