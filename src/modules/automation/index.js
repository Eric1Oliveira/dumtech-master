// Automações e DUM AI — rotinas diárias que rodam no servidor (pg_cron) e geram avisos.
// O assistente DUM AI depende de um provedor de IA pago: fica documentado, sem botão de enfeite.

import { html, setHtml, $, bindActions } from '../../shared/utils/dom.js';
import { formatRelative, formatDateTime } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { AUTOMATIONS } from '../../core/automations.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { loadError, toast, toastError } from '../../shared/components/feedback.js';
import { openAssistant } from '../../shared/components/assistant-panel.js';

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, module, signal }) {
  const { org } = getState();
  const manage = canDo('automations.manage');

  setHtml(
    root,
    html`<header class="page-head">
        <div>
          <h1 class="page-title">Automações</h1>
          <p class="page-sub">Rotinas que rodam sozinhas no servidor, todo dia às 8h (Brasília), e avisam as pessoas certas</p>
        </div>
      </header>
      <div data-scheduler></div>
      <section class="panel" aria-labelledby="routines-title">
        <header class="panel__head"><h2 class="panel__title" id="routines-title">Rotinas</h2></header>
        <div data-routines><div class="skeleton"></div></div>
      </section>
      <section class="panel" aria-labelledby="ai-title">
        <header class="panel__head">
          <h2 class="panel__title" id="ai-title">DUM AI</h2>
          <button type="button" class="btn btn--primary btn--sm" data-action="open-ai">Abrir o DUM AI</button>
        </header>
        <p class="detail-text detail-text--flush">Assistente por regras, sem IA paga e sem enviar nada para fora: entende perguntas em português sobre clientes,
          propostas, projetos, tarefas, produtos, infraestrutura, equipe e atividade, e responde com os dados que o papel de cada pessoa pode ver
          (no Supabase, o próprio banco filtra). Também abre pelo botão “DUM AI” no topo de qualquer tela.</p>
      </section>`,
  );
  const routinesSlot = /** @type {HTMLElement} */ ($('[data-routines]', root));
  const schedulerSlot = /** @type {HTMLElement} */ ($('[data-scheduler]', root));

  const info = await data.health.info().catch(() => ({ schemaVersion: '', scheduler: false, httpChecks: false, storage: false }));
  setHtml(
    schedulerSlot,
    info.scheduler
      ? html`<p class="notice notice--ok"><strong>Agendador ativo no servidor.</strong> As rotinas ligadas rodam mesmo com todos os navegadores fechados.</p>`
      : html`<p class="notice notice--warn"><strong>Agendador indisponível neste projeto</strong> (extensão pg_cron). As rotinas só rodam pelo botão “Rodar agora”.</p>`,
  );

  /** @type {import('../../services/data.js').AutomationState[]} */
  let states = [];
  const draw = () => {
    setHtml(
      routinesSlot,
      html`<ul class="routines">${AUTOMATIONS.map((a) => {
        const s = states.find((x) => x.key === a.key);
        return html`<li class="routine">
          <div class="routine__text">
            <p class="routine__name">${a.name}</p>
            <p class="routine__desc">${a.description}</p>
            <p class="routine__meta">Para: ${a.audience} · ${s?.lastRunAt
              ? html`última execução <time datetime="${s.lastRunAt}" title="${formatDateTime(s.lastRunAt)}">${formatRelative(s.lastRunAt)}</time> — ${s.lastResult}`
              : 'ainda não rodou'}</p>
          </div>
          <div class="routine__controls">
            ${manage ? html`<button type="button" class="btn btn--ghost btn--sm" data-action="run" data-key="${a.key}">Rodar agora</button>` : ''}
            <label class="switch" title="${s?.enabled ? 'Ligada' : 'Desligada'}">
              <input type="checkbox" role="switch" data-toggle="${a.key}" ${s?.enabled ? html`checked` : ''} ${manage ? '' : html`disabled`}>
              <span class="switch__track" aria-hidden="true"></span>
              <span class="sr-only">${a.name}: ${s?.enabled ? 'ligada' : 'desligada'}</span>
            </label>
          </div>
        </li>`;
      })}</ul>`,
    );
  };

  const load = async () => {
    try {
      states = await data.automations.list(org.id);
      if (!signal.aborted) draw();
    } catch (error) {
      if (!signal.aborted) setHtml(routinesSlot, loadError(error));
    }
  };

  routinesSlot.addEventListener('change', async (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const key = input.dataset.toggle;
    if (!key) return;
    input.disabled = true;
    try {
      await data.automations.set(org.id, key, input.checked);
      toast(`${AUTOMATIONS.find((a) => a.key === key)?.name}: ${input.checked ? 'ligada' : 'desligada'}.`, 'success');
      await load();
    } catch (error) {
      input.checked = !input.checked;
      input.disabled = false;
      toastError(error);
    }
  }, { signal });

  bindActions(root, {
    'open-ai': () => openAssistant('Resumo da empresa'),
    run: async (el) => {
      const button = /** @type {HTMLButtonElement} */ (el);
      button.disabled = true;
      try {
        const result = await data.automations.run(org.id, el.dataset.key);
        toast(result, 'success');
        await load();
      } catch (error) {
        toastError(error);
        button.disabled = false;
      }
    },
  }, signal);

  await load();
}
