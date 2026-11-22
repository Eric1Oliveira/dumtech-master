// Integrações. FinanceSolux: o Master só LÊ totais; o financeiro continua lá.
// Aqui fica só o que não é segredo (endereço do projeto). A chave de leitura vai
// para os secrets do Supabase e é usada por uma Edge Function — nunca pelo navegador.

import { html, setHtml, $ } from '../../shared/utils/dom.js';
import { formatDateTime } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { errorMessage, loadError, toast } from '../../shared/components/feedback.js';

const STATUS = {
  none: { label: 'Não conectado', tone: 'info' },
  pending: { label: 'Aguardando servidor', tone: 'warn' },
  active: { label: 'Ativo', tone: 'ok' },
  error: { label: 'Com erro', tone: 'danger' },
  disabled: { label: 'Desativado', tone: 'info' },
};

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, signal }) {
  const { org } = getState();
  const manage = canDo('integrations.manage');

  const draw = async () => {
    let integration;
    try {
      integration = (await data.integrations.list(org.id)).find((i) => i.provider === 'financesolux');
    } catch (error) {
      setHtml(root, loadError(error));
      return;
    }
    if (signal.aborted) return;
    const status = STATUS[integration?.status ?? 'none'];
    const url = integration?.config?.project_url ?? '';
    const steps = [
      { done: Boolean(url), text: 'Endereço do projeto FinanceSolux salvo aqui.' },
      { done: integration?.status === 'active', text: 'Secrets FINANCESOLUX_HUB_READ_KEY (o HUB_READ_KEY do FinanceSolux, só leitura) e FINANCESOLUX_ANON_KEY cadastrados nas Edge Functions do Master — fora do navegador.' },
      { done: integration?.status === 'active', text: 'Edge Function “financesolux-summary” publicada: lê receita, despesa e saldo da conta da empresa (hub-export) e marca a integração como ativa ao abrir o Financeiro.' },
    ];

    setHtml(
      root,
      html`<section class="panel">
        <header class="panel__head">
          <div>
            <h2 class="panel__title">FinanceSolux</h2>
            <p class="panel__text">Fonte dos indicadores financeiros do Command Center. Nada é copiado nem lançado aqui: o FinanceSolux continua sendo o sistema financeiro.</p>
          </div>
          <span class="status-pill status-pill--${status.tone}">${status.label}</span>
        </header>

        <form class="form-row" id="fs-form" novalidate>
          <label class="field field--grow"><span class="field__label">Endereço do projeto Supabase do FinanceSolux</span>
            <input class="input mono" name="project_url" type="url" inputmode="url" placeholder="https://xxxxxxxx.supabase.co" value="${url}" required pattern="https://.+" ${manage ? '' : html`disabled`}>
            <span class="field__hint">Não cole chaves aqui. Só o endereço.</span></label>
          ${manage ? html`<button type="submit" class="btn btn--primary">Salvar endereço</button>` : ''}
        </form>
        <p class="form-error" role="alert" hidden></p>

        <h3 class="subhead">Para ativar</h3>
        <ol class="steps">${steps.map((s) => html`<li class="${s.done ? 'is-done' : ''}">${s.text}${s.done ? html`<span class="sr-only"> (concluído)</span>` : ''}</li>`)}</ol>
        ${integration ? html`<footer class="panel__foot"><span>Última alteração: <span class="mono">${formatDateTime(integration.updatedAt)}</span></span></footer>` : ''}
      </section>`,
    );

    $('#fs-form', root)?.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();
        const form = /** @type {HTMLFormElement} */ (event.target);
        const errorBox = /** @type {HTMLElement} */ ($('.form-error', root));
        if (!form.reportValidity()) return;
        errorBox.hidden = true;
        try {
          await data.integrations.saveConfig(org.id, 'financesolux', { project_url: String(new FormData(form).get('project_url')).trim() });
          toast('Endereço do FinanceSolux salvo.', 'success');
          draw();
        } catch (error) {
          errorBox.textContent = errorMessage(error);
          errorBox.hidden = false;
        }
      },
      { signal },
    );
  };

  await draw();
}
