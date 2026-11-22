// Ajustes › Cobrança: a chave Pix e a mensagem que o Hoje usa no botão de WhatsApp de cada cobrança.

import { html, setHtml, $ } from '../../shared/utils/dom.js';
import { getState } from '../../core/state.js';
import { DEFAULT_BILLING_MESSAGE, billingMessage } from '../../core/billing.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { toast, errorMessage } from '../../shared/components/feedback.js';

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, signal }) {
  const { org } = getState();
  const manage = canDo('org.update');
  /** @type {{ pixKey?: string, message?: string, adjustPct?: number }} */
  const current = (await data.settings.get(org.id, 'billing').catch(() => null)) ?? {};
  if (signal.aborted) return;
  setHtml(
    root,
    html`<section class="panel" aria-labelledby="billing-title">
      <header class="panel__head"><div><h2 class="panel__title" id="billing-title">Cobrança pelo WhatsApp</h2>
        <p class="panel__hint">No Hoje, cada mensalidade vencendo ou atrasada tem um botão que abre o WhatsApp do cliente com esta mensagem pronta.</p></div></header>
      <form class="form-grid" id="billing-form" novalidate>
        <label class="field form-grid__full"><span class="field__label">Chave Pix (opcional)</span>
          <input class="input" name="pixKey" maxlength="140" value="${current.pixKey ?? ''}" placeholder="CNPJ, e-mail, telefone ou chave aleatória" ${manage ? '' : html`disabled`}></label>
        <label class="field"><span class="field__label">Reajuste anual sugerido (%)</span>
          <input class="input mono" name="adjustPct" inputmode="decimal" maxlength="5" value="${String(current.adjustPct ?? 5).replace('.', ',')}" ${manage ? '' : html`disabled`}>
          <span class="field__hint">No aniversário de cada mensalidade, o Hoje sugere o valor novo. 0 desliga.</span></label>
        <label class="field form-grid__full"><span class="field__label">Mensagem</span>
          <textarea class="input" name="message" rows="5" maxlength="1000" ${manage ? '' : html`disabled`}>${current.message || DEFAULT_BILLING_MESSAGE}</textarea>
          <span class="field__hint">Troca sozinho: {cliente}, {projeto}, {valor}, {vencimento} e {pix} (vira “Chave Pix: …”).</span></label>
        <div class="form-grid__full"><p class="subhead">Como o cliente recebe</p><p class="chat-bubble" data-preview></p></div>
        <p class="form-error form-grid__full" role="alert" hidden></p>
        ${manage ? html`<div class="form-grid__full"><button type="submit" class="btn btn--primary">Salvar</button></div>` : html`<p class="panel__text form-grid__full">Só proprietários e administradores mudam a cobrança.</p>`}
      </form>
    </section>`,
  );
  const form = /** @type {HTMLFormElement} */ ($('#billing-form', root));
  const errorBox = /** @type {HTMLElement} */ ($('.form-error', form));
  const values = () => {
    const pct = Number(String(new FormData(form).get('adjustPct') ?? current.adjustPct ?? 5).replace(',', '.'));
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) throw new Error('Reajuste: de 0 a 50%.');
    return { pixKey: String(new FormData(form).get('pixKey') ?? current.pixKey ?? '').trim(), message: String(new FormData(form).get('message') ?? current.message ?? ''), adjustPct: Math.round(pct * 100) / 100 };
  };
  const preview = () => {
    const v = { pixKey: String(new FormData(form).get('pixKey') ?? current.pixKey ?? '').trim(), message: String(new FormData(form).get('message') ?? current.message ?? '') };
    /** @type {HTMLElement} */ ($('[data-preview]', root)).textContent = billingMessage(v.message, { cliente: 'Padaria Sol', projeto: 'Site Padaria Sol', valor: 'R$ 129,00', vencimento: '10/12/2026', pix: v.pixKey });
  };
  form.addEventListener('input', preview, { signal });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    try {
      await data.settings.set(org.id, 'billing', values());
      toast('Cobrança salva.', 'success');
    } catch (error) {
      errorBox.textContent = errorMessage(error);
      errorBox.hidden = false;
    }
  }, { signal });
  preview();
}
