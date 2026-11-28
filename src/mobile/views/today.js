// Hoje no celular: o veredito numa linha, os números do mês, o que precisa de você (com o
// WhatsApp da cobrança pronto) e os sites publicados. Mesma montagem do computador (todayBoard).

import { html } from '../../shared/utils/dom.js';
import { formatMoney, formatDate } from '../../shared/utils/format.js';
import { dayLabel, greeting } from '../../core/today.js';
import { whatsappLink } from '../../core/customers.js';
import { billingMessage } from '../../core/billing.js';
import { icon } from '../../shared/components/icons.js';
import { verdict, phoneRoute } from '../model.js';
import { empty, section, list, row, monitorPill } from '../ui.js';

const KIND_ICON = /** @type {const} */ ({ down: 'alert', billing: 'wallet', setup: 'wallet', renewal: 'calendar', unstable: 'zap', task: 'check', proposal: 'fileText', adjust: 'chart' });
const dayFormat = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

/** WhatsApp com a mensagem de cobrança pronta (a mesma do computador). @param {any} item @param {import('../model.js').Model} m */
function chargeLink(item, m) {
  const b = m.today?.billings.find((x) => x.subId === item.id);
  const base = whatsappLink(item.phone);
  if (!b || !base) return null;
  const text = billingMessage(m.billing?.message, {
    cliente: b.customerName, projeto: b.productName, valor: b.amountLabel, vencimento: formatDate(b.due), pix: m.billing?.pixKey,
  });
  return `${base}?text=${encodeURIComponent(text)}`;
}

export default {
  title: () => 'Hoje',
  /** @param {import('../model.js').Model} m */
  render(m) {
    const t = m.today;
    if (!t) return empty('Sem acesso ao Hoje', 'Seu papel nesta organização não inclui o painel do dia.');
    const v = verdict(t.items);
    const first = String(m.me.name ?? '').trim().split(/\s+/)[0];
    const live = m.products.filter((p) => p.status === 'live');
    const negative = t.cost !== null && t.monthly - t.cost < 0;
    return html`
      <div class="m-verdict m-verdict--${v.tone}">
        <p class="m-verdict__eyebrow">${greeting()}${first ? `, ${first}` : ''} · ${dayFormat.format(new Date(`${m.todayKey}T12:00:00`))}</p>
        <p class="m-verdict__text">${v.text}</p>
      </div>
      <dl class="m-stats">
        <div><dt>Mensalidades</dt><dd>${formatMoney(t.monthly)}</dd><span>por mês</span></div>
        <div><dt>Recebido no mês</dt><dd>${t.seesBilling ? formatMoney(t.received) : '—'}</dd><span>${t.seesBilling ? `de ${formatMoney(t.expected)}` : 'sem acesso'}</span></div>
        <div><dt>Custo dos serviços</dt><dd>${t.cost === null ? '—' : formatMoney(t.cost)}</dd><span>por mês</span></div>
        <div><dt>Lucro estimado</dt><dd class="${negative ? 'is-negative' : ''}">${t.cost === null ? '—' : formatMoney(t.monthly - t.cost)}</dd><span>mensalidades − serviços</span></div>
      </dl>
      ${section(
        'Precisa de você',
        t.items.length
          ? html`<ul class="m-items">${t.items.map((i) => {
              const wa = i.kind === 'billing' ? chargeLink(i, m) : null;
              return html`<li class="m-item m-item--${i.tone}">
                <a class="m-item__main" href="${phoneRoute(i.href)}">
                  <span class="m-item__icon" aria-hidden="true">${icon(KIND_ICON[/** @type {keyof typeof KIND_ICON} */ (i.kind)] ?? 'info')}</span>
                  <span class="m-item__body"><strong>${i.title}</strong><small>${i.context}${i.date ? ` · ${dayLabel(i.date, m.todayKey)}` : ''}</small></span>
                </a>
                ${wa ? html`<a class="m-item__action" href="${wa}" target="_blank" rel="noopener noreferrer">${icon('message')}<span>WhatsApp</span></a>` : ''}
              </li>`;
            })}</ul>`
          : empty('Nada pendente', 'Nada fora do ar, nenhuma cobrança atrasada, nenhum vencimento perto.'),
        t.items.length ? `${t.items.length} ${t.items.length === 1 ? 'item' : 'itens'}` : '',
      )}
      ${live.length
        ? section('Publicados', list(live.map((p) => {
            const site = m.monitors.find((x) => x.productId === p.id && x.kind === 'site');
            const monthly = m.subs.filter((s) => s.productId === p.id && s.status === 'active').reduce((sum, s) => sum + (s.monthlyAmount ?? 0), 0);
            return row({ href: `#/projetos/${p.id}`, title: p.name, sub: site ? monitorPill(site) : 'sem verificação', end: monthly ? formatMoney(monthly) : '', endSub: monthly ? 'por mês' : '' });
          })))
        : ''}`;
  },
};
