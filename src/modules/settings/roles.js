// Matriz de papéis × permissões (somente leitura; o catálogo vem das migrations).

import { html, setHtml } from '../../shared/utils/dom.js';
import { getState } from '../../core/state.js';
import { ROLES, PERMISSIONS, can } from '../../core/permissions.js';
import { icon } from '../../shared/components/icons.js';

/** @param {import('../index.js').ModuleContext} ctx */
export function render({ root }) {
  const mine = getState().org.role;
  setHtml(
    root,
    html`<section class="panel">
        <header class="panel__head"><h2 class="panel__title">Papéis</h2></header>
        <dl class="role-list">
          ${ROLES.map((r) => html`<div class="${r.key === mine ? 'is-mine' : ''}"><dt>${r.name}${r.key === mine ? html` <span class="status-pill status-pill--ok">seu papel</span>` : ''}</dt><dd>${r.summary}</dd></div>`)}
        </dl>
      </section>
      <section class="panel">
        <header class="panel__head"><h2 class="panel__title">Permissões por papel</h2></header>
        <div class="table-wrap">
          <table class="table table--matrix" aria-label="Permissões por papel">
            <thead><tr><th scope="col">Permissão</th>${ROLES.map((r) => html`<th scope="col" class="is-center ${r.key === mine ? 'is-mine' : ''}">${r.name}</th>`)}</tr></thead>
            <tbody>${PERMISSIONS.map(
              (p) => html`<tr><th scope="row"><span class="perm">${p.description}<small class="mono">${p.key}</small></span></th>
                ${ROLES.map((r) => html`<td class="is-center ${r.key === mine ? 'is-mine' : ''}">${can(r.key, p.key) ? html`<span class="tick" title="Permitido">${icon('check')}<span class="sr-only">sim</span></span>` : html`<span class="muted" aria-label="não">—</span>`}</td>`)}</tr>`,
            )}</tbody>
          </table>
        </div>
        <footer class="panel__foot"><span>No Supabase estas regras são aplicadas pelo banco (RLS e funções), não pela interface.</span></footer>
      </section>`,
  );
}
