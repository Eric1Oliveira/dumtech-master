// Ajustes › Construção: o checklist que todo projeto ganha quando o cliente aceita (ou "já fechado").

import { html, setHtml, $ } from '../../shared/utils/dom.js';
import { getState } from '../../core/state.js';
import { DEFAULT_CHECKLIST, normalizeChecklist } from '../../core/projects.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { toast, errorMessage } from '../../shared/components/feedback.js';

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, signal }) {
  const { org } = getState();
  const manage = canDo('org.update');
  /** @type {{ items?: string[] } | null} */
  const current = await data.settings.get(org.id, 'checklist').catch(() => null);
  if (signal.aborted) return;
  const items = current?.items?.length ? current.items : DEFAULT_CHECKLIST;
  setHtml(
    root,
    html`<section class="panel" aria-labelledby="checklist-title">
      <header class="panel__head"><div><h2 class="panel__title" id="checklist-title">Checklist da construção</h2>
        <p class="panel__hint">Quando um projeto entra em construção, ele ganha estas tarefas, nesta ordem. Mudar aqui vale para os próximos projetos.</p></div></header>
      <form class="form-grid" id="checklist-form" novalidate>
        <label class="field form-grid__full"><span class="field__label">Uma tarefa por linha (até 30)</span>
          <textarea class="input" name="items" rows="10" ${manage ? '' : html`disabled`}>${items.join('\n')}</textarea></label>
        <p class="form-error form-grid__full" role="alert" hidden></p>
        ${manage
          ? html`<div class="form-grid__full form-actions"><button type="submit" class="btn btn--primary">Salvar</button>
              <button type="button" class="btn btn--ghost" data-reset>Voltar ao padrão</button></div>`
          : html`<p class="panel__text form-grid__full">Só proprietários e administradores mudam o checklist.</p>`}
      </form>
    </section>`,
  );
  const form = /** @type {HTMLFormElement} */ ($('#checklist-form', root));
  const errorBox = /** @type {HTMLElement} */ ($('.form-error', form));
  const area = /** @type {HTMLTextAreaElement} */ (form.elements.namedItem('items'));
  $('[data-reset]', form)?.addEventListener('click', () => {
    area.value = DEFAULT_CHECKLIST.join('\n');
  }, { signal });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    try {
      await data.settings.set(org.id, 'checklist', { items: normalizeChecklist(area.value) });
      toast('Checklist salvo. Vale para os próximos projetos.', 'success');
    } catch (error) {
      errorBox.textContent = errorMessage(error);
      errorBox.hidden = false;
    }
  }, { signal });
}
