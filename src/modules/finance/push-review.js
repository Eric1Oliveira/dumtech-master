// Lançar no FinanceSolux, um por um: para cada item a pessoa decide Criar, "Já está lá" ou Pular.
// Nada é criado sem o clique. Se parece já existir lá (mesmo tipo e valor, até 7 dias), a ação
// principal vira "Já está lá" — criar continua possível, mas não é o caminho do Enter.

import { html, setHtml, createElement } from '../../shared/utils/dom.js';
import { formatMoney, formatDate } from '../../shared/utils/format.js';
import { data } from '../../services/data.js';
import { errorMessage } from '../../shared/components/feedback.js';

const SOURCE_LABEL = { payment: 'Mensalidade paga', setup: 'Implantação recebida', entry: 'Lançamento avulso' };

/** @typedef {import('../../services/data.js').FinanceReview} FinanceReview */
/** @typedef {FinanceReview['items'][number]} ReviewItem */

/**
 * @param {string} orgId
 * @returns {Promise<{ sent: number, skipped: number, passed: number }>}
 */
export function openPushReview(orgId) {
  const dialog = /** @type {HTMLDialogElement} */ (
    createElement(html`<dialog class="dialog dialog--wide" aria-labelledby="push-title"><form class="dialog__form" novalidate></form></dialog>`)
  );
  const form = /** @type {HTMLFormElement} */ (dialog.querySelector('form'));
  document.body.append(dialog);
  dialog.showModal();

  const result = { sent: 0, skipped: 0, passed: 0 };
  /** @type {FinanceReview | null} */
  let review = null;
  let index = 0;
  let busy = false;
  /** Última categoria escolhida por tipo de origem (a próxima mensalidade já vem com ela). */
  /** @type {Record<string, string>} */
  const chosen = {};
  const groupOf = (/** @type {ReviewItem} */ item) => (item.source === 'entry' ? `entry-${item.kind}` : item.source);

  const shell = (/** @type {any} */ head, /** @type {any} */ body, /** @type {any} */ foot) =>
    setHtml(
      form,
      html`<header class="dialog__head">${head}</header>
        <div class="dialog__body">${body}</div>
        <p class="form-error" role="alert" hidden></p>
        <footer class="dialog__foot push-foot">${foot}</footer>`,
    );
  const closeOnly = html`<button type="submit" class="btn btn--primary">Fechar</button>`;

  const drawLoading = () =>
    shell(html`<h2 class="dialog__title" id="push-title">Lançar no FinanceSolux</h2>`, html`<p class="dialog__text">Conferindo o que já existe lá…</p><div class="skeleton"></div>`, html`<button type="button" class="btn btn--ghost" data-step="stop">Cancelar</button>`);

  const drawMessage = (/** @type {string} */ title, /** @type {any} */ text) =>
    shell(html`<h2 class="dialog__title" id="push-title">${title}</h2>`, text, closeOnly);

  const drawDone = () => {
    const parts = [
      result.sent && `${result.sent} criado(s) no FinanceSolux`,
      result.skipped && `${result.skipped} marcado(s) como já lançado(s)`,
      result.passed && `${result.passed} pulado(s) por agora`,
    ].filter(Boolean);
    drawMessage('Pronto', html`<p class="dialog__text">${parts.length ? `${parts.join(' · ')}.` : 'Nada foi alterado.'}</p>
      ${result.passed ? html`<p class="dialog__text">Os pulados continuam na lista para depois.</p>` : ''}`);
  };

  /** Opções de categoria: as da conta para o tipo, com a sugestão na frente se ainda não existir lá. */
  const categoryOptions = (/** @type {ReviewItem} */ item) => {
    const type = item.kind === 'cost' ? 'despesa' : 'receita';
    const names = (review?.categories ?? []).filter((c) => c.type === type).map((c) => c.name);
    const wanted = chosen[groupOf(item)] ?? item.category;
    const has = (/** @type {string} */ n) => names.some((x) => x.toLowerCase() === n.toLowerCase());
    const selected = names.find((x) => x.toLowerCase() === wanted.toLowerCase()) ?? wanted;
    const options = has(item.category) ? names : [item.category, ...names];
    if (!options.some((x) => x.toLowerCase() === selected.toLowerCase())) options.unshift(selected);
    return options.map((name) => html`<option value="${name}" ${name === selected ? html`selected` : ''}>${has(name) ? name : `${name} (nova)`}</option>`);
  };

  const drawItem = () => {
    if (!review) return;
    const item = review.items[index];
    if (!item) return drawDone();
    const revenue = item.kind === 'revenue';
    const beforeAdjust = review.adjustmentOn && item.occurredOn <= review.adjustmentOn;
    const looksSent = item.matches.length > 0;
    shell(
      html`<p class="push-count">${index + 1} de ${review.items.length}${review.account ? ` · conta ${review.account}` : ''}</p>
        <h2 class="dialog__title" id="push-title">Criar esta ${revenue ? 'receita' : 'despesa'} no FinanceSolux?</h2>`,
      html`<div class="push-item">
          <span class="status-pill ${revenue ? 'status-pill--ok' : 'status-pill--danger'}">${revenue ? 'Receita' : 'Despesa'}</span>
          <p class="push-item__amount mono ${revenue ? 'amount--in' : 'amount--out'}">${revenue ? '+' : '−'} ${formatMoney(item.amount)}</p>
          <p class="push-item__desc">${item.description}</p>
        </div>
        <dl class="facts facts--stack">
          <div><dt>Data</dt><dd class="mono">${formatDate(item.occurredOn)}</dd></div>
          <div><dt>Origem</dt><dd>${SOURCE_LABEL[item.source]} · <a class="link-action" href="#/projects/${item.projectId}">ver projeto</a></dd></div>
        </dl>
        <label class="field"><span class="field__label">Categoria no FinanceSolux</span>
          <select class="input" name="category">${categoryOptions(item)}</select>
          <span class="field__hint">Se for nova, ela é criada lá junto.</span></label>
        ${item.status === 'sending' ? html`<p class="notice notice--warn"><strong>Um envio anterior não terminou.</strong> Confira no FinanceSolux antes de criar de novo.</p>` : ''}
        ${looksSent
          ? html`<div class="notice notice--warn"><strong>Parece que já está lá:</strong>
              <ul class="push-matches">${item.matches.map((m) => html`<li>${m.description || 'sem descrição'} · <span class="mono">${formatMoney(m.amount)}</span> · ${formatDate(m.date)}</li>`)}</ul>
              Se for o mesmo, use “Já está lá”.</div>`
          : ''}
        ${beforeAdjust ? html`<p class="notice notice--warn"><strong>Data antes do último ajuste de saldo (${formatDate(/** @type {string} */ (review.adjustmentOn))}).</strong> Esse dinheiro talvez já esteja no saldo de lá.</p>` : ''}`,
      html`<button type="button" class="btn btn--ghost" data-step="stop">Parar</button>
        <span class="push-foot__gap"></span>
        <button type="button" class="btn btn--ghost" data-step="pass">Pular</button>
        <button type="${looksSent ? 'submit' : 'button'}" class="btn ${looksSent ? 'btn--primary' : 'btn--secondary'}" data-step="skip">Já está lá</button>
        <button type="${looksSent ? 'button' : 'submit'}" class="btn ${looksSent ? 'btn--secondary' : 'btn--primary'}" data-step="send">${looksSent ? 'Criar mesmo assim' : 'Criar no FinanceSolux'}</button>`,
    );
    /** @type {HTMLElement | null} */ (form.querySelector(looksSent ? '[data-step=skip]' : '[data-step=send]'))?.focus();
  };

  /** @param {'send' | 'skip' | 'pass' | 'stop'} step */
  const act = async (step) => {
    if (busy) return;
    if (step === 'stop' || !review || !review.items[index]) return dialog.close();
    const item = review.items[index];
    if (step === 'pass') {
      result.passed += 1;
      index += 1;
      return drawItem();
    }
    const buttons = /** @type {HTMLButtonElement[]} */ ([...form.querySelectorAll('.push-foot button')]);
    const errorBox = /** @type {HTMLElement} */ (form.querySelector('.form-error'));
    busy = true;
    buttons.forEach((b) => (b.disabled = true));
    errorBox.hidden = true;
    try {
      if (step === 'send') {
        const category = String(new FormData(form).get('category') ?? item.category);
        await data.finance.send(orgId, { source: item.source, sourceId: item.sourceId, category });
        chosen[groupOf(item)] = category;
        result.sent += 1;
      } else {
        await data.finance.skip(orgId, { source: item.source, sourceId: item.sourceId });
        result.skipped += 1;
      }
      index += 1;
      busy = false;
      drawItem();
    } catch (error) {
      busy = false;
      buttons.forEach((b) => (b.disabled = false));
      errorBox.textContent = errorMessage(error);
      errorBox.hidden = false;
    }
  };

  form.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('button[data-step]');
    if (!button || button.getAttribute('type') === 'submit') return;
    act(/** @type {any} */ (/** @type {HTMLElement} */ (button).dataset.step));
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const primary = /** @type {HTMLElement | null} */ (form.querySelector('button[type=submit][data-step]'));
    if (primary) act(/** @type {any} */ (primary.dataset.step));
    else dialog.close();
  });

  drawLoading();
  data.finance
    .review(orgId)
    .then((r) => {
      if (!dialog.open) return;
      review = r;
      if (!r.items.length) drawMessage('Nada para lançar', html`<p class="dialog__text">Tudo o que o Master registrou já está no FinanceSolux.</p>`);
      else drawItem();
    })
    .catch((error) => {
      if (dialog.open) drawMessage('Sem conexão com o FinanceSolux', html`<p class="notice notice--warn">${errorMessage(error)}</p>`);
    });

  // Esc no meio de um envio deixaria a contagem errada: espera terminar.
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });

  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
  });
}
