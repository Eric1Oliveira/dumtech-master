// Propostas — documento do projeto, do rascunho ao aceite. Aceita leva o projeto à construção.
// #/proposals (lista) · #/proposals/new?project=<id>&customer=<id> (nova) · #/proposals/<id> (editor ou documento)

import { html, setHtml, $, $$, bindActions } from '../../shared/utils/dom.js';
import { formatDate, formatMoney, formatRelative, formatDateTime } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { PROPOSAL_STATUS, TRANSITIONS, proposalNumber, proposalTotals, normalizeItem } from '../../core/proposals.js';
import { labelOf, today } from '../../core/validate.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { listPage, statusPill } from '../../shared/components/list-page.js';
import { confirmDialog } from '../../shared/components/dialog.js';
import { emptyState, loadError, toast, toastError, errorMessage } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';
import { aiWrite, aiRun } from '../../shared/components/ai-write.js';
import { proposalMessages, proposalItemsMessages, pickCatalog, PROPOSAL_ITEMS_SCHEMA } from '../../core/ai-prompts.js';

/** @typedef {import('../../services/data.js').Proposal} Proposal */
/** @typedef {import('../../core/proposals.js').ProposalItem} ProposalItem */
/** @typedef {import('../../modules/index.js').ModuleContext} Ctx */

const muted = (/** @type {string} */ text = '—') => html`<span class="muted">${text}</span>`;
const money = (/** @type {number} */ v) => html`<span class="mono">${formatMoney(v)}</span>`;
const moneyInput = (/** @type {number} */ v) => (v ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

/** @param {Ctx} ctx */
export async function render(ctx) {
  const id = ctx.route.section;
  if (id === 'new') return renderEditor(ctx, null, [], ctx.route.params);
  if (id) return renderProposal(ctx, id);
  return renderList(ctx);
}

/** Validade vencida de uma proposta ainda em aberto. @param {Proposal} p */
const expired = (p) => (p.status === 'sent' || p.status === 'draft') && Boolean(p.validUntil) && p.validUntil < today();

/** @param {Ctx} ctx */
async function renderList({ root, module, signal }) {
  const { org } = getState();
  const manage = canDo('proposals.manage');
  const page = listPage({
    root,
    module,
    signal,
    title: 'Propostas',
    sub: `Orçamentos de ${org.name}, do rascunho ao aceite`,
    newLabel: manage ? 'Nova proposta' : null,
    statuses: PROPOSAL_STATUS,
    statusOf: (p) => p.status,
    searchOf: (p) => `${proposalNumber(p.number)} ${p.title} ${p.customerName}`,
    searchLabel: 'Número, título ou cliente',
    sort: { key: 'number', dir: 'desc' },
    empty: {
      title: 'Nenhuma proposta ainda',
      text: manage ? 'Monte a primeira proposta com itens do catálogo. Quando aceita, ela vira projeto.' : 'Quando a equipe montar propostas, elas aparecem aqui.',
    },
    columns: [
      {
        key: 'number',
        label: 'Proposta',
        sortValue: (p) => p.number,
        render: (p) => html`<span class="person">
          <a class="link-strong" href="#/proposals/${p.id}"><span class="mono">${proposalNumber(p.number)}</span> · ${p.title}</a>
          <small>${p.customerName}</small>
        </span>`,
      },
      { key: 'status', label: 'Situação', sortValue: (p) => p.status, render: (p) => statusPill(PROPOSAL_STATUS, p.status) },
      { key: 'once', label: 'Único', align: 'end', sortValue: (p) => p.totalOnce, render: (p) => (p.totalOnce ? money(p.totalOnce) : muted()) },
      { key: 'monthly', label: 'Mensal', align: 'end', sortValue: (p) => p.totalMonthly, render: (p) => (p.totalMonthly ? money(p.totalMonthly) : muted()) },
      {
        key: 'valid',
        label: 'Validade',
        hideOnMobile: true,
        sortValue: (p) => p.validUntil ?? '',
        render: (p) => (p.validUntil ? html`<span class="mono ${expired(p) ? 'is-overdue' : ''}">${formatDate(p.validUntil)}</span>` : muted()),
      },
      { key: 'updated', label: 'Atualizada', hideOnMobile: true, sortValue: (p) => p.updatedAt, render: (p) => html`<span class="mono" title="${formatDateTime(p.updatedAt)}">${formatRelative(p.updatedAt)}</span>` },
    ],
  });

  bindActions(root, { new: () => (location.hash = '#/proposals/new') }, signal);
  try {
    const list = await data.proposals.list(org.id);
    if (!signal.aborted) page.show(list);
  } catch (error) {
    if (!signal.aborted) page.fail(error);
  }
}

/** @param {Ctx} ctx @param {string} id */
async function renderProposal(ctx, id) {
  const { org } = getState();
  setHtml(ctx.root, html`<div class="skeleton"></div>`);
  try {
    const [proposal, items] = await Promise.all([
      data.proposals.list(org.id).then((list) => list.find((p) => p.id === id)),
      data.proposals.items(org.id, id),
    ]);
    if (ctx.signal.aborted) return;
    if (!proposal) {
      setHtml(ctx.root, emptyState({ title: 'Proposta não encontrada', text: 'Ela pode ter sido excluída.', action: { label: 'Voltar às propostas', href: '#/proposals' } }));
      return;
    }
    document.title = `${proposalNumber(proposal.number)} · ${ctx.module.name} — DUMTech Master`;
    if (proposal.status === 'draft' && canDo('proposals.manage')) return renderEditor(ctx, proposal, items);
    return renderDocument(ctx, proposal, items);
  } catch (error) {
    if (!ctx.signal.aborted) setHtml(ctx.root, loadError(error));
  }
}

/**
 * Editor do rascunho (ou nova proposta).
 * @param {Ctx} ctx
 * @param {Proposal | null} proposal
 * @param {ProposalItem[]} initialItems
 */
async function renderEditor({ root, module, signal }, proposal, initialItems, params = new URLSearchParams()) {
  const { org } = getState();
  setHtml(root, html`<div class="skeleton"></div>`);
  let customers;
  let catalog;
  try {
    [customers, catalog] = await Promise.all([data.customers.list(org.id), data.saleItems.list(org.id).catch(() => [])]);
  } catch (error) {
    if (!signal.aborted) setHtml(root, loadError(error));
    return;
  }
  if (signal.aborted) return;
  customers.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const sellable = catalog.filter((p) => p.active).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'));
  const productId = proposal?.productId ?? params.get('project') ?? null;
  const chosen = proposal?.customerId ?? params.get('customer') ?? '';

  /** @type {ProposalItem[]} */
  const items = initialItems.length ? initialItems.map((i) => ({ ...i })) : [{ productId: null, description: '', quantity: 1, unitPrice: 0, recurring: false }];
  const title = proposal ? `${proposalNumber(proposal.number)} · ${proposal.title}` : 'Nova proposta';

  if (!customers.length) {
    setHtml(root, emptyState({ title: 'Cadastre um cliente primeiro', text: 'Toda proposta é para um cliente da carteira.', action: { label: 'Ir para Clientes', href: '#/customers' } }));
    return;
  }

  setHtml(
    root,
    html`<header class="page-head">
        <div>
          <p class="eyebrow"><a class="back-link" href="#/proposals">${icon('arrowLeft')}Propostas</a></p>
          <h1 class="page-title">${title}</h1>
          <p class="page-sub">${statusPill(PROPOSAL_STATUS, 'draft')} · os itens podem mudar até a proposta ser enviada</p>
        </div>
        <div class="page-actions">
          ${proposal ? html`<button type="button" class="btn btn--ghost" data-action="remove">${icon('trash')}<span>Excluir</span></button>` : ''}
          <button type="button" class="btn btn--secondary" data-action="save">Salvar rascunho</button>
          <button type="button" class="btn btn--primary" data-action="send">Salvar e marcar como enviada</button>
        </div>
      </header>
      <form class="stack" id="proposal-form" novalidate>
        <section class="panel">
          <div class="form-grid">
            <label class="field"><span class="field__label">Cliente</span>
              <select class="input" name="customerId" required>
                ${proposal ? '' : html`<option value="">Escolha o cliente</option>`}
                ${customers.map((c) => html`<option value="${c.id}" ${chosen === c.id ? html`selected` : ''}>${c.name}</option>`)}
              </select></label>
            <label class="field"><span class="field__label">Validade</span>
              <input class="input" type="date" name="validUntil" value="${proposal?.validUntil ?? ''}"></label>
            <label class="field form-grid__full"><span class="field__label">Título</span>
              <input class="input" name="title" required maxlength="160" value="${proposal?.title ?? ''}" placeholder="Ex.: Implantação do sistema de gestão" autocomplete="off"></label>
          </div>
        </section>
        <section class="panel" aria-labelledby="items-title">
          <header class="panel__head">
            <h2 class="panel__title" id="items-title">Itens</h2>
            <p class="panel__hint">Escolher um produto preenche descrição e preço (mensalidade quando houver).</p>
          </header>
          <div class="items" data-items></div>
          <div class="items__foot">
            <button type="button" class="btn btn--ghost btn--sm" data-action="add-item">${icon('plus')}<span>Adicionar item</span></button>
            <dl class="totals" data-totals></dl>
          </div>
        </section>
        <section class="panel">
          <div class="ai-row"><button type="button" class="btn btn--ghost btn--sm" data-action="ai-notes">${icon('sparkles')}<span>Escrever com IA</span></button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="ai-items">${icon('sparkles')}<span>Sugerir itens com IA</span></button></div>
          <label class="field"><span class="field__label">Observações e condições</span>
            <textarea class="input" name="notes" rows="4" maxlength="4000" placeholder="Prazos, forma de pagamento, o que não está incluso…">${proposal?.notes ?? ''}</textarea></label>
        </section>
        <p class="form-error" role="alert" hidden></p>
      </form>`,
  );

  const form = /** @type {HTMLFormElement} */ ($('#proposal-form', root));
  const itemsSlot = /** @type {HTMLElement} */ ($('[data-items]', root));
  const totalsSlot = /** @type {HTMLElement} */ ($('[data-totals]', root));
  const errorBox = /** @type {HTMLElement} */ ($('.form-error', root));

  const lineTotal = (/** @type {ProposalItem} */ i) => Math.round((Number(i.quantity) || 0) * (Number(i.unitPrice) || 0) * 100) / 100;

  const drawTotals = () => {
    const t = proposalTotals(items.map((i) => ({ ...i, quantity: Number(i.quantity) || 0, unitPrice: Number(i.unitPrice) || 0 })));
    setHtml(totalsSlot, html`<div><dt>Total único</dt><dd class="mono">${formatMoney(t.once)}</dd></div><div><dt>Total mensal</dt><dd class="mono">${formatMoney(t.monthly)}</dd></div>`);
    $$('[data-line-total]', itemsSlot).forEach((el, index) => (el.textContent = formatMoney(lineTotal(items[index]))));
  };

  const drawItems = () => {
    setHtml(
      itemsSlot,
      html`<div class="items__head" aria-hidden="true"><span>Da tabela</span><span>Descrição</span><span>Qtd</span><span>Preço unitário</span><span>Mensal</span><span>Total</span><span></span></div>
      ${items.map(
        (item, index) => html`<div class="items__row" data-index="${index}">
          <label class="items__cell"><span class="items__label">Da tabela de preços</span>
            <select class="input input--sm" data-field="productId" aria-label="Item da tabela de preços ${index + 1}">
              <option value="">Item avulso</option>
              ${sellable.map((p) => html`<option value="${p.id}" ${item.productId === p.id ? html`selected` : ''}>${p.name}</option>`)}
            </select></label>
          <label class="items__cell items__cell--grow"><span class="items__label">Descrição</span>
            <input class="input input--sm" data-field="description" value="${item.description}" maxlength="300" aria-label="Descrição do item ${index + 1}"></label>
          <label class="items__cell"><span class="items__label">Qtd</span>
            <input class="input input--sm mono" data-field="quantity" inputmode="decimal" value="${String(item.quantity).replace('.', ',')}" aria-label="Quantidade do item ${index + 1}"></label>
          <label class="items__cell"><span class="items__label">Preço unitário</span>
            <input class="input input--sm mono" data-field="unitPrice" inputmode="decimal" value="${moneyInput(item.unitPrice)}" placeholder="0,00" aria-label="Preço unitário do item ${index + 1}"></label>
          <label class="items__cell items__cell--check"><span class="items__label">Mensal</span>
            <input type="checkbox" data-field="recurring" ${item.recurring ? html`checked` : ''} aria-label="Item ${index + 1} é mensal"></label>
          <span class="items__cell mono items__total" data-line-total></span>
          <button type="button" class="icon-btn icon-btn--sm" data-action="remove-item" data-index="${index}" aria-label="Remover item ${index + 1}" title="Remover item" ${items.length === 1 ? html`disabled` : ''}>${icon('x')}</button>
        </div>`,
      )}`,
    );
    drawTotals();
  };

  /** Converte o texto digitado (1.234,56) em número para o total parcial. */
  const parseNumber = (/** @type {string} */ v) => {
    const text = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v;
    const n = Number(text);
    return Number.isFinite(n) ? n : 0;
  };

  itemsSlot.addEventListener('input', (event) => {
    const field = /** @type {HTMLInputElement} */ (event.target);
    const row = /** @type {HTMLElement | null} */ (field.closest('[data-index]'));
    if (!row || !field.dataset.field) return;
    const item = items[Number(row.dataset.index)];
    if (field.dataset.field === 'description') item.description = field.value;
    if (field.dataset.field === 'quantity') item.quantity = parseNumber(field.value);
    if (field.dataset.field === 'unitPrice') item.unitPrice = parseNumber(field.value);
    drawTotals();
  }, { signal });

  itemsSlot.addEventListener('change', (event) => {
    const field = /** @type {HTMLInputElement} */ (event.target);
    const row = /** @type {HTMLElement | null} */ (field.closest('[data-index]'));
    if (!row) return;
    const item = items[Number(row.dataset.index)];
    if (field.dataset.field === 'recurring') {
      item.recurring = field.checked;
      drawTotals();
    }
    if (field.dataset.field === 'productId') {
      const product = sellable.find((p) => p.id === field.value);
      item.productId = product?.id ?? null;
      if (product) {
        item.description = product.name;
        item.recurring = product.recurring;
        item.unitPrice = product.price;
      }
      drawItems();
    }
  }, { signal });

  /** Lê o formulário inteiro no formato do contrato de dados. */
  const collect = () => {
    const values = Object.fromEntries(new FormData(form));
    return { customerId: String(values.customerId ?? ''), title: String(values.title ?? ''), validUntil: String(values.validUntil ?? ''), notes: String(values.notes ?? ''), items, productId };
  };

  /** Salva; devolve o id (ou null se falhou, com a mensagem na tela). */
  const save = async () => {
    errorBox.hidden = true;
    try {
      items.forEach(normalizeItem);
      return await data.proposals.save(org.id, /** @type {any} */ (collect()), proposal?.id);
    } catch (error) {
      errorBox.textContent = errorMessage(error);
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'nearest' });
      return null;
    }
  };

  const busy = (/** @type {boolean} */ on) => $$('.page-actions .btn', root).forEach((b) => (/** @type {HTMLButtonElement} */ (b).disabled = on));

  const notesEl = () => /** @type {HTMLTextAreaElement} */ (form.querySelector('[name="notes"]'));
  bindActions(root, {
    'ai-notes': async () => {
      const v = collect();
      const out = await aiWrite(proposalMessages({ customer: customers.find((c) => c.id === v.customerId)?.name ?? '', title: v.title, notes: v.notes, items: items.map((i) => i.description).filter(Boolean) }), { title: 'Observações da proposta', maxTokens: 700 });
      if (out) notesEl().value = out;
    },
    'ai-items': async () => {
      const notes = notesEl().value.trim();
      if (notes.length < 10) return toast('Escreva nas observações o que o cliente pediu.', 'info');
      try {
        const text = await aiRun(proposalItemsMessages(notes, sellable.map((s) => s.name)), { schema: PROPOSAL_ITEMS_SCHEMA, maxTokens: 300 });
        if (text === null) return;
        const picked = pickCatalog(text, sellable).filter((p) => !items.some((i) => i.productId === p.id));
        if (!picked.length) return toast('A IA não achou itens novos na tabela de preços.', 'info');
        const blank = items.length === 1 && !items[0].description;
        if (blank) items.length = 0;
        for (const p of picked) items.push({ productId: p.id, description: p.name, quantity: 1, unitPrice: p.price, recurring: p.recurring });
        drawItems();
        toast(`${picked.length} item(ns) sugerido(s). Confira os valores.`, 'success');
      } catch (error) {
        toastError(error);
      }
    },
    'add-item': () => {
      items.push({ productId: null, description: '', quantity: 1, unitPrice: 0, recurring: false });
      drawItems();
      /** @type {HTMLElement | null} */ ($(`[data-index="${items.length - 1}"] [data-field="productId"]`, itemsSlot))?.focus();
    },
    'remove-item': (el) => {
      items.splice(Number(el.dataset.index), 1);
      drawItems();
    },
    save: async () => {
      busy(true);
      const id = await save();
      busy(false);
      if (!id) return;
      toast('Rascunho salvo.', 'success');
      if (!proposal) location.hash = `#/proposals/${id}`;
      else window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
    send: async () => {
      busy(true);
      const id = await save();
      if (!id) return busy(false);
      try {
        await data.proposals.setStatus(org.id, id, 'sent');
        toast('Proposta marcada como enviada.', 'success');
        if (location.hash === `#/proposals/${id}`) window.dispatchEvent(new HashChangeEvent('hashchange'));
        else location.hash = `#/proposals/${id}`;
      } catch (error) {
        busy(false);
        toastError(error);
      }
    },
    remove: async () => {
      const ok = await confirmDialog({ title: 'Excluir rascunho?', message: `${title} será apagada. A exclusão fica na auditoria.`, confirmLabel: 'Excluir', danger: true });
      if (!ok) return;
      try {
        await data.proposals.remove(org.id, proposal.id);
        toast('Proposta excluída.', 'success');
        location.hash = '#/proposals';
      } catch (error) {
        toastError(error);
      }
    },
  }, signal);

  drawItems();
}

/**
 * Documento da proposta (enviada, decidida ou para quem só lê). Também é a versão impressa.
 * @param {Ctx} ctx
 * @param {Proposal} p
 * @param {ProposalItem[]} items
 */
function renderDocument({ root, module, signal }, p, items) {
  const { org } = getState();
  const manage = canDo('proposals.manage');
  const next = manage ? TRANSITIONS[p.status] : [];
  const actionLabel = { draft: 'Voltar para rascunho', sent: 'Marcar como enviada', accepted: 'Aceitar', rejected: 'Recusar' };

  setHtml(
    root,
    html`<header class="page-head no-print">
        <div>
          <p class="eyebrow"><a class="back-link" href="#/proposals">${icon('arrowLeft')}Propostas</a></p>
          <h1 class="page-title"><span class="mono">${proposalNumber(p.number)}</span> · ${p.title}</h1>
          <p class="page-sub">${statusPill(PROPOSAL_STATUS, p.status)} · ${p.customerName}${p.decidedAt ? ` · decidida em ${formatDateTime(p.decidedAt)}` : p.sentAt ? ` · enviada em ${formatDateTime(p.sentAt)}` : ''}</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn--ghost" data-action="print">${icon('printer')}<span>Imprimir / PDF</span></button>
          ${p.status === 'rejected' && manage ? html`<button type="button" class="btn btn--ghost" data-action="remove">${icon('trash')}<span>Excluir</span></button>` : ''}
          ${next.map((s) => html`<button type="button" class="btn ${s === 'accepted' ? 'btn--primary' : 'btn--secondary'}" data-action="status" data-status="${s}">${actionLabel[s]}</button>`)}
          ${p.productId ? html`<a class="btn btn--primary" href="#/projects/${p.productId}">Abrir projeto${icon('arrowRight')}</a>` : ''}
        </div>
      </header>
      <article class="doc">
        <header class="doc__head">
          <div>
            <p class="doc__org">${org.name}</p>
            <p class="doc__kind">Proposta comercial</p>
          </div>
          <dl class="doc__meta">
            <div><dt>Número</dt><dd class="mono">${proposalNumber(p.number)}</dd></div>
            <div><dt>Data</dt><dd>${new Date(p.sentAt ?? p.createdAt).toLocaleDateString('pt-BR')}</dd></div>
            ${p.validUntil ? html`<div><dt>Válida até</dt><dd>${formatDate(p.validUntil)}</dd></div>` : ''}
          </dl>
        </header>
        <p class="doc__to"><span>Para</span> ${p.customerName}</p>
        <h2 class="doc__title">${p.title}</h2>
        <table class="doc__items">
          <thead><tr><th>Descrição</th><th class="num">Qtd</th><th class="num">Preço unitário</th><th class="num">Total</th></tr></thead>
          <tbody>
            ${items.map(
              (i) => html`<tr>
                <td>${i.description}${i.recurring ? html` <span class="doc__tag">mensal</span>` : ''}</td>
                <td class="num mono">${String(i.quantity).replace('.', ',')}</td>
                <td class="num mono">${formatMoney(i.unitPrice)}${i.recurring ? '/mês' : ''}</td>
                <td class="num mono">${formatMoney(Math.round(i.quantity * i.unitPrice * 100) / 100)}${i.recurring ? '/mês' : ''}</td>
              </tr>`,
            )}
          </tbody>
        </table>
        <dl class="doc__totals">
          ${p.totalOnce ? html`<div><dt>Total único</dt><dd class="mono">${formatMoney(p.totalOnce)}</dd></div>` : ''}
          ${p.totalMonthly ? html`<div><dt>Total mensal</dt><dd class="mono">${formatMoney(p.totalMonthly)}/mês</dd></div>` : ''}
        </dl>
        ${p.notes ? html`<section class="doc__notes"><h3>Observações e condições</h3><p class="prewrap">${p.notes}</p></section>` : ''}
      </article>`,
  );

  bindActions(root, {
    print: () => window.print(),
    status: async (el) => {
      const status = /** @type {import('../../core/proposals.js').ProposalStatus} */ (el.dataset.status);
      if (status === 'accepted' || status === 'rejected') {
        const ok = await confirmDialog(
          status === 'accepted'
            ? { title: 'Cliente aceitou?', message: `O projeto vai para a construção com o checklist, ${p.customerName} vira cliente ativo e a mensalidade fica combinada até publicar.`, confirmLabel: 'Aceitar e começar a construção' }
            : { title: 'Recusar proposta?', message: 'Ela fica como recusada; dá para voltar a rascunho depois.', confirmLabel: 'Recusar', danger: true },
        );
        if (!ok) return;
      }
      try {
        const result = await data.proposals.setStatus(org.id, p.id, status);
        toast(`${proposalNumber(p.number)}: ${labelOf(PROPOSAL_STATUS, status).toLowerCase()}.`, 'success');
        if (result.projectId) location.hash = `#/projects/${result.projectId}`;
        else window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (error) {
        toastError(error);
      }
    },
    remove: async () => {
      const ok = await confirmDialog({ title: 'Excluir proposta recusada?', message: 'A exclusão fica registrada na auditoria.', confirmLabel: 'Excluir', danger: true });
      if (!ok) return;
      try {
        await data.proposals.remove(org.id, p.id);
        toast('Proposta excluída.', 'success');
        location.hash = '#/proposals';
      } catch (error) {
        toastError(error);
      }
    },
  }, signal);
}
