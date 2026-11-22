// Hoje: o que precisa de você agora, numa lista só por prioridade — cada item com a ação ao lado
// (WhatsApp com a mensagem pronta, Pago, Recebi, Renovei, Feito) —, os números do mês e os
// projetos publicados com o "No ar".

import { html, setHtml, $, bindActions } from '../../shared/utils/dom.js';
import { formatDateLong, formatMoney, formatDate } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { roleName } from '../../core/permissions.js';
import { billingStatus, monthKey, dueDate, billingMessage, adjustmentDue } from '../../core/billing.js';
import { whatsappLink } from '../../core/customers.js';
import { ASSET_KINDS } from '../../core/infra.js';
import { serviceCosts, mrr } from '../../core/costs.js';
import { todayList, dayLabel, greeting } from '../../core/today.js';
import { labelOf, today } from '../../core/validate.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { emptyState, loadError, toast, toastError } from '../../shared/components/feedback.js';
import { openRecordDialog } from '../../shared/components/record-form.js';
import { icon } from '../../shared/components/icons.js';
import { markPaid } from '../customers/billing-ui.js';
import { editAsset, monitorBadge } from '../infrastructure/index.js';

const KIND_ICON = /** @type {const} */ ({ down: 'alert', billing: 'wallet', setup: 'wallet', renewal: 'calendar', unstable: 'zap', task: 'check', proposal: 'fileText' });

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, signal }) {
  const { org, user } = getState();
  const firstName = (user?.name ?? '').trim().split(/\s+/)[0] ?? '';
  setHtml(
    root,
    html`<header class="page-head">
        <div>
          <h1 class="page-title">${greeting()}${firstName ? `, ${firstName}` : ''}</h1>
          <p class="page-sub">${formatDateLong(new Date())} · ${org.name} · você é ${roleName(org.role)}</p>
        </div>
        ${canDo('products.manage') ? html`<div class="page-actions"><a class="btn btn--primary" href="#/projects/novo">${icon('plus')}<span>Novo projeto</span></a></div>` : ''}
      </header>
      <div data-numbers><div class="skeleton"></div></div>
      <section class="panel" aria-labelledby="todo-title">
        <header class="panel__head"><div><h2 class="panel__title" id="todo-title">Precisa de você</h2><p class="panel__hint" data-count></p></div></header>
        <div data-list><div class="skeleton"></div></div>
      </section>
      <section class="panel" aria-labelledby="live-title" data-board-panel hidden>
        <header class="panel__head"><div><h2 class="panel__title" id="live-title">Publicados</h2><p class="panel__hint">Verificados a cada minuto pelo servidor</p></div>
          <a class="link-action" href="#/projects">Todos os projetos →</a></header>
        <div class="live-grid" data-board></div>
      </section>`,
  );

  /** @type {any} */
  let state = null;

  const load = async () => {
    const todayKey = today();
    const month = monthKey(todayKey);
    const [products, subs, payments, customers, contacts, monitors, assets, links, tasks, proposals, billing] = await Promise.all([
      canDo('products.view') ? data.products.list(org.id) : [],
      canDo('products.view') ? data.customerProducts.list(org.id) : [],
      canDo('customers.view') ? data.payments.list(org.id) : null,
      canDo('customers.view') ? data.customers.list(org.id) : [],
      canDo('customers.view') ? data.customerContacts.list(org.id).catch(() => []) : [],
      data.monitors.list(org.id).catch(() => []),
      canDo('infra.view') ? data.assets.list(org.id) : [],
      data.assetLinks.list(org.id).catch(() => []),
      canDo('projects.view') ? data.tasks.list(org.id) : [],
      canDo('proposals.view') ? data.proposals.list(org.id) : [],
      data.settings.get(org.id, 'billing').catch(() => null),
    ]);
    const name = new Map(products.map((p) => /** @type {[string, string]} */ ([p.id, p.name])));
    const phoneOf = (/** @type {string} */ customerId) =>
      contacts.find((c) => c.customerId === customerId && c.isPrimary && c.phone)?.phone ?? customers.find((c) => c.id === customerId)?.phone ?? null;
    const active = subs.filter((s) => s.status === 'active' && s.monthlyAmount);
    const billings = payments
      ? active.filter((s) => s.billingDay).map((s) => ({
          sub: s,
          subId: s.id,
          customerId: s.customerId,
          customerName: s.customerName,
          productName: s.productName,
          amountLabel: formatMoney(s.monthlyAmount ?? 0),
          due: dueDate(month, /** @type {number} */ (s.billingDay)),
          state: billingStatus(s, payments, month, todayKey),
          phone: phoneOf(s.customerId),
        }))
      : [];
    const customerOf = (/** @type {string} */ productId) => subs.find((s) => s.productId === productId && s.status !== 'cancelled')?.customerName ?? '';
    const setups = canDo('products.manage')
      ? products.filter((p) => (p.status === 'building' || p.status === 'live') && p.setupAmount && !p.setupPaidOn)
          .map((p) => ({ productId: p.id, name: p.name, customerName: customerOf(p.id), amountLabel: formatMoney(p.setupAmount ?? 0) }))
      : [];
    const pct = Number(billing?.adjustPct ?? 5);
    const adjustments = canDo('products.manage')
      ? subs.flatMap((sub) => {
          const due = adjustmentDue(sub, todayKey, pct);
          if (!due) return [];
          const when = due.days < 0 ? 'desde ' + formatDate(due.date) : 'em ' + formatDate(due.date);
          return [{ sub, due, subId: sub.id, customerName: sub.customerName, productName: sub.productName, date: due.date,
            label: `1 ano ${when} · ${formatMoney(sub.monthlyAmount ?? 0)} → ${formatMoney(due.amount)} (+${String(due.pct).replace('.', ',')}%)` }];
        })
      : [];
    const items = todayList({
      monitors: monitors.map((m) => ({ ...m, projectName: m.productId ? name.get(m.productId) : undefined })),
      billings,
      setups,
      adjustments,
      assets: assets.map((a) => ({ ...a, kindLabel: labelOf(ASSET_KINDS, a.kind) })),
      tasks,
      proposals,
    }, todayKey, user?.id ?? null);
    const costs = serviceCosts({ assets, links, projects: products });
    const expected = billings.filter((b) => b.state !== 'none').reduce((s, b) => s + (b.sub.monthlyAmount ?? 0), 0);
    const mine = new Set(subs.map((s) => s.id));
    const received = (payments ?? []).filter((p) => p.month === month && mine.has(p.subscriptionId)).reduce((s, p) => s + p.amount, 0);
    state = { items, adjustments, billings, products, subs, tasks, assets, monitors, billing, month, monthly: mrr(subs), expected, received, cost: canDo('infra.view') ? costs.total : null, seesBilling: Boolean(payments) };
  };

  const draw = () => {
    const s = state;
    const late = s.items.filter((/** @type {any} */ i) => i.tone === 'error').length;
    setHtml(
      /** @type {HTMLElement} */ ($('[data-numbers]', root)),
      html`<dl class="stat-strip">
        <div><dt>Mensalidades</dt><dd class="mono">${formatMoney(s.monthly)}</dd><span class="stat-note">por mês, de quem está pagando</span></div>
        <div><dt>Recebido no mês</dt><dd class="mono">${s.seesBilling ? formatMoney(s.received) : '—'}</dd><span class="stat-note">${s.seesBilling ? `de ${formatMoney(s.expected)} previsto` : 'sem acesso às cobranças'}</span></div>
        <div><dt>Custo dos serviços</dt><dd class="mono">${s.cost === null ? '—' : formatMoney(s.cost)}</dd><span class="stat-note">por mês, compartilhados + exclusivos</span></div>
        <div><dt>Lucro estimado</dt><dd class="mono ${s.cost !== null && s.monthly - s.cost < 0 ? 'is-overdue' : ''}">${s.cost === null ? '—' : formatMoney(s.monthly - s.cost)}</dd><span class="stat-note">mensalidades − serviços</span></div>
      </dl>`,
    );
    const count = /** @type {HTMLElement} */ ($('[data-count]', root));
    count.textContent = s.items.length ? `${s.items.length} ${s.items.length === 1 ? 'item' : 'itens'}${late ? ` · ${late} urgente${late > 1 ? 's' : ''}` : ''}` : 'Nada pendente';
    setHtml(
      /** @type {HTMLElement} */ ($('[data-list]', root)),
      s.items.length
        ? html`<ul class="todo-list">${s.items.map((/** @type {any} */ i) => html`<li class="todo todo--${i.tone}">
            <span class="todo__icon" aria-hidden="true">${icon(KIND_ICON[/** @type {keyof typeof KIND_ICON} */ (i.kind)])}</span>
            <div class="todo__body">
              <a class="todo__title" href="${i.href}">${i.title}</a>
              <small>${i.context}${i.date ? ` · ${dayLabel(i.date, today())}` : ''}</small>
            </div>
            <div class="todo__actions">${actions(i)}</div>
          </li>`)}</ul>`
        : emptyState({ title: 'Tudo em dia', text: 'Nada fora do ar, nenhuma cobrança atrasada, nenhum vencimento perto.', compact: true }),
    );
    const live = s.products.filter((/** @type {any} */ p) => p.status === 'live');
    const boardPanel = /** @type {HTMLElement} */ ($('[data-board-panel]', root));
    boardPanel.hidden = !live.length;
    setHtml(
      /** @type {HTMLElement} */ ($('[data-board]', root)),
      html`${live.map((/** @type {any} */ p) => {
        const site = s.monitors.find((/** @type {any} */ m) => m.productId === p.id && m.kind === 'site');
        const monthly = s.subs.filter((/** @type {any} */ x) => x.productId === p.id && x.status === 'active').reduce((sum, /** @type {any} */ x) => sum + (x.monthlyAmount ?? 0), 0);
        return html`<a class="live-card" href="#/projects/${p.id}">
          <span class="live-card__name">${p.name}</span>
          ${site ? monitorBadge(site) : html`<span class="muted">sem verificação</span>`}
          <span class="live-card__money mono">${monthly ? `${formatMoney(monthly)}/mês` : ''}</span>
        </a>`;
      })}`,
    );
    /** @type {HTMLElement} */ ($('[data-list]', root)).dataset.ready = 'true';
  };

  /** Ação do item: WhatsApp com a mensagem pronta e Pago; Recebi; Renovei; Feito; Ver. @param {any} i */
  function actions(i) {
    if (i.kind === 'billing') {
      const b = state.billings.find((/** @type {any} */ x) => x.subId === i.id);
      const base = whatsappLink(i.phone);
      const text = billingMessage(state.billing?.message, {
        cliente: b.customerName,
        projeto: b.productName,
        valor: b.amountLabel,
        vencimento: formatDate(b.due),
        pix: state.billing?.pixKey,
      });
      return html`${base ? html`<a class="btn btn--secondary btn--sm" href="${base}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener noreferrer">${icon('message')}<span>WhatsApp</span></a>` : ''}
        ${canDo('customers.manage') ? html`<button type="button" class="btn btn--quiet btn--sm" data-action="paid" data-id="${i.id}">${icon('check')}<span>Pago</span></button>` : ''}`;
    }
    if (i.kind === 'adjust') {
      return html`<button type="button" class="btn btn--secondary btn--sm" data-action="adjust" data-id="${i.id}">${icon('edit')}<span>Reajustar</span></button>
        <button type="button" class="btn btn--ghost btn--sm" data-action="keep" data-id="${i.id}">Manter</button>`;
    }
    if (i.kind === 'setup') return html`<button type="button" class="btn btn--quiet btn--sm" data-action="setup" data-id="${i.id}">${icon('check')}<span>Recebi</span></button>`;
    if (i.kind === 'renewal' && canDo('infra.manage')) return html`<button type="button" class="btn btn--secondary btn--sm" data-action="renew" data-id="${i.id}">${icon('calendar')}<span>Renovei</span></button>`;
    if (i.kind === 'task' && canDo('projects.manage')) return html`<button type="button" class="btn btn--quiet btn--sm" data-action="task" data-id="${i.id}">${icon('check')}<span>Feito</span></button>`;
    return html`<a class="btn btn--ghost btn--sm" href="${i.href}">Ver</a>`;
  }

  const refresh = async (/** @type {string} */ message) => {
    if (message) toast(message, 'success');
    try {
      await load();
      if (!signal.aborted) draw();
    } catch (error) {
      toastError(error);
    }
  };

  try {
    await load();
    if (!signal.aborted) draw();
  } catch (error) {
    if (!signal.aborted) setHtml(/** @type {HTMLElement} */ ($('[data-list]', root)), loadError(error));
    return;
  }

  bindActions(root, {
    paid: async (el) => {
      const b = state.billings.find((/** @type {any} */ x) => x.subId === el.dataset.id);
      if (b && (await markPaid(org.id, b.sub).catch((e) => (toastError(e), false)))) refresh('Pagamento registrado.');
    },
    adjust: async (el) => {
      const j = state.adjustments.find((/** @type {any} */ x) => x.subId === el.dataset.id);
      if (!j) return;
      const ok = await openRecordDialog({
        title: 'Reajuste anual',
        description: `${j.customerName} · ${j.productName}. O valor novo passa a valer nas próximas cobranças.`,
        fields: [{ name: 'monthlyAmount', label: 'Mensalidade nova (R$)', type: 'money', required: true, full: true }],
        values: { monthlyAmount: j.due.amount },
        submitLabel: 'Reajustar',
        onSubmit: (v) => data.customerProducts.update(org.id, j.sub.id, /** @type {any} */ ({ monthlyAmount: v.monthlyAmount, billingDay: j.sub.billingDay, adjustedOn: j.due.date })),
      }).catch((e) => (toastError(e), false));
      if (ok) refresh('Mensalidade reajustada.');
    },
    keep: async (el) => {
      const j = state.adjustments.find((/** @type {any} */ x) => x.subId === el.dataset.id);
      if (!j) return;
      try {
        await data.customerProducts.update(org.id, j.sub.id, /** @type {any} */ ({ monthlyAmount: j.sub.monthlyAmount, billingDay: j.sub.billingDay, adjustedOn: j.due.date }));
        refresh('Valor mantido. O próximo reajuste fica para daqui a 1 ano.');
      } catch (error) {
        toastError(error);
      }
    },
    setup: async (el) => {
      const p = state.products.find((/** @type {any} */ x) => x.id === el.dataset.id);
      if (!p) return;
      try {
        await data.products.save(org.id, /** @type {any} */ ({ ...p, setupPaidOn: today() }), p.id);
        refresh('Implantação recebida.');
      } catch (error) {
        toastError(error);
      }
    },
    renew: async (el) => {
      const a = state.assets.find((/** @type {any} */ x) => x.id === el.dataset.id);
      if (a && (await editAsset(a).catch((e) => (toastError(e), false)))) refresh('Vencimento atualizado.');
    },
    task: async (el) => {
      const t = state.tasks.find((/** @type {any} */ x) => x.id === el.dataset.id);
      if (!t) return;
      try {
        await data.tasks.save(org.id, /** @type {any} */ ({ ...t, status: 'done' }), t.id);
        refresh('Tarefa feita.');
      } catch (error) {
        toastError(error);
      }
    },
  }, signal);
}
