// Dinheiro no celular: o mês (recebido de previsto, a receber, atrasado), o que entra e sai por
// mês, o lucro por projeto (quem dá prejuízo primeiro) e o recebido nos 12 meses (moneyBoard).

import { html } from '../../shared/utils/dom.js';
import { formatMoney, formatMonth } from '../../shared/utils/format.js';
import { empty, section, list, row } from '../ui.js';

const shortMonth = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

export default {
  title: () => 'Dinheiro',
  /** @param {import('../model.js').Model} m */
  render(m) {
    const b = m.money;
    if (!b) return empty('Sem acesso ao Dinheiro', 'Seu papel nesta organização não inclui os números do dinheiro.');
    const share = b.expected ? Math.min(100, Math.round((b.received / b.expected) * 100)) : 0;
    const profit = b.monthly - b.costs.total;
    const top = Math.max(1, ...b.months.map((x) => x.fees + x.setups + x.extras));
    const rows = [...b.rows].sort((x, y) => x.profit - y.profit);
    return html`
      <div class="m-money">
        <p class="m-money__eyebrow">${formatMonth(b.month)} · recebido</p>
        <p class="m-money__value">${formatMoney(b.received)}</p>
        <div class="m-meter" role="img" aria-label="${share}% do previsto recebido"><span data-w="${share}"></span></div>
        <p class="m-money__note">${b.expected ? `${share}% de ${formatMoney(b.expected)} previsto · ${b.expectedCount} mensalidade${b.expectedCount === 1 ? '' : 's'}` : 'Nenhuma mensalidade prevista neste mês'}</p>
      </div>
      <dl class="m-stats m-stats--3">
        <div><dt>A receber</dt><dd>${formatMoney(b.open.total)}</dd><span>${b.open.count} no prazo</span></div>
        <div><dt>Atrasado</dt><dd class="${b.late.count ? 'is-negative' : ''}">${formatMoney(b.late.total)}</dd><span>${b.late.count ? `${b.late.count} cliente${b.late.count === 1 ? '' : 's'}` : 'ninguém'}</span></div>
        <div><dt>No ano</dt><dd>${formatMoney(b.yearTotal)}</dd><span>recebido em ${b.year}</span></div>
      </dl>
      ${section('Por mês', html`<dl class="m-ledger">
        <div><dt>Mensalidades</dt><dd>${formatMoney(b.monthly)}</dd></div>
        <div><dt>Custo dos serviços</dt><dd>${b.seesCost ? `− ${formatMoney(b.costs.total)}` : '—'}</dd></div>
        <div class="m-ledger__total"><dt>Lucro</dt><dd class="${b.seesCost && profit < 0 ? 'is-negative' : ''}">${b.seesCost ? formatMoney(profit) : '—'}${b.seesCost && b.monthly ? html`<small>margem ${Math.round((profit / b.monthly) * 100)}%</small>` : ''}</dd></div>
      </dl>`)}
      ${b.seesCost
        ? section('Lucro por projeto', rows.length
            ? list(rows.map((r) => row({
                href: `#/projetos/${r.p.id}`,
                title: r.p.name,
                sub: `${r.customers || (r.p.status === 'building' ? 'em construção' : 'sem cliente')} · custo ${formatMoney(r.cost)}`,
                end: formatMoney(r.profit),
                endSub: r.margin === null ? 'sem mensalidade' : `margem ${r.margin}%`,
                t: r.profit < 0 ? 'error' : '',
              })))
            : empty('Nenhum projeto em construção ou publicado'), 'do menor para o maior')
        : ''}
      ${section('Recebido nos 12 meses', html`<ol class="m-bars">${b.months.map((x) => {
        const total = x.fees + x.setups + x.extras;
        return html`<li class="${x.month === b.month ? 'is-current' : ''}">
          <span class="m-bars__label">${shortMonth.format(new Date(`${x.month}-01T00:00:00Z`)).replace('. de ', '/').replace('.', '')}</span>
          <span class="m-bars__track"><span data-w="${Math.round((total / top) * 100)}"></span></span>
          <span class="m-bars__value">${total ? formatMoney(total) : '—'}</span>
        </li>`;
      })}</ol>`)}`;
  },
};
