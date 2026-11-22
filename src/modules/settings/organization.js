// Organização ativa (nome) e lista das organizações da pessoa.

import { html, setHtml, $, bindActions } from '../../shared/utils/dom.js';
import { getState } from '../../core/state.js';
import { roleName } from '../../core/permissions.js';
import { data } from '../../services/data.js';
import { canDo, loadOrganizations, switchOrganization } from '../../services/auth.js';
import { dataTable } from '../../shared/components/table.js';
import { promptNewOrganization } from '../../shared/components/org-dialog.js';
import { errorMessage, toast } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';

/** @param {import('../index.js').ModuleContext} ctx */
export function render({ root, signal }) {
  const { org, orgs } = getState();
  const editable = canDo('org.update');

  setHtml(
    root,
    html`<section class="panel">
        <header class="panel__head"><h2 class="panel__title">Dados da organização</h2></header>
        <form class="form-row" id="org-name-form" novalidate>
          <label class="field field--grow"><span class="field__label">Nome</span>
            <input class="input" name="name" value="${org.name}" required minlength="2" maxlength="80" ${editable ? '' : html`disabled`}></label>
          ${editable ? html`<button type="submit" class="btn btn--primary">Salvar nome</button>` : ''}
        </form>
        <p class="form-error" role="alert" hidden></p>
        <dl class="facts">
          <div><dt>Seu papel</dt><dd>${roleName(org.role)}</dd></div>
          <div><dt>Identificador</dt><dd class="mono">${org.id}</dd></div>
        </dl>
        ${editable ? '' : html`<p class="panel__text">Somente proprietários e administradores editam a organização.</p>`}
      </section>

      <section class="panel">
        <header class="panel__head">
          <h2 class="panel__title">Suas organizações</h2>
          <button type="button" class="btn btn--secondary btn--sm" data-action="new-org">${icon('plus')}<span>Nova organização</span></button>
        </header>
        <div id="org-table"></div>
      </section>`,
  );

  $('#org-table', root).append(
    dataTable({
      label: 'Suas organizações',
      rows: orgs,
      sort: { key: 'name', dir: 'asc' },
      empty: html``,
      columns: [
        { key: 'name', label: 'Nome', sortValue: (o) => o.name },
        { key: 'role', label: 'Seu papel', sortValue: (o) => roleName(o.role), render: (o) => roleName(o.role) },
        {
          key: 'open',
          label: 'Ação',
          align: 'end',
          render: (o) =>
            o.id === org.id
              ? html`<span class="status-pill status-pill--ok">Ativa</span>`
              : html`<button type="button" class="btn btn--quiet btn--sm" data-action="switch" data-org="${o.id}">Abrir</button>`,
        },
      ],
    }),
  );

  bindActions(
    root,
    {
      'new-org': () => promptNewOrganization(),
      switch: (el) => switchOrganization(el.dataset.org),
    },
    signal,
  );

  $('#org-name-form', root)?.addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();
      const form = /** @type {HTMLFormElement} */ (event.target);
      const errorBox = /** @type {HTMLElement} */ ($('.form-error', root));
      if (!form.reportValidity()) return;
      const name = String(new FormData(form).get('name')).trim();
      errorBox.hidden = true;
      try {
        await data.orgs.rename(org.id, name);
        await loadOrganizations();
        toast('Nome da organização salvo.', 'success');
      } catch (error) {
        errorBox.textContent = errorMessage(error);
        errorBox.hidden = false;
      }
    },
    { signal },
  );
}
