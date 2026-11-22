// Trilha de auditoria: filtro por tipo e busca. Somente leitura — gravada pelo banco.

import { html, setHtml, $ } from '../../shared/utils/dom.js';
import { formatDateTime, normalize } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { data } from '../../services/data.js';
import { describeAudit, AUDIT_GROUPS } from '../../shared/utils/audit-text.js';
import { dataTable } from '../../shared/components/table.js';
import { emptyState, loadError } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';

const LIMIT = 200;

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, signal }) {
  const { org } = getState();
  /** @type {import('../../services/data.js').AuditEntry[]} */
  let entries = [];
  let group = '';
  let query = '';

  setHtml(
    root,
    html`<section class="panel">
      <header class="panel__head">
        <div class="toolbar">
          <label class="search-field">${icon('search')}<span class="sr-only">Buscar na auditoria</span>
            <input class="input input--bare" type="search" placeholder="Buscar pessoa ou ação" data-search></label>
          <label class="sr-only" for="audit-group">Tipo</label>
          <select class="input input--sm" id="audit-group" data-group>
            <option value="">Todos os tipos</option>
            ${AUDIT_GROUPS.map((g) => html`<option value="${g.id}">${g.label}</option>`)}
          </select>
        </div>
        <button type="button" class="icon-btn" data-refresh aria-label="Atualizar" title="Atualizar">${icon('refresh')}</button>
      </header>
      <div id="audit-table"><div class="skeleton"></div></div>
      <footer class="panel__foot"><span>Mostra os ${LIMIT} registros mais recentes. Registros não podem ser editados nem apagados.</span></footer>
    </section>`,
  );
  const slot = /** @type {HTMLElement} */ ($('#audit-table', root));

  const draw = () => {
    const terms = normalize(query);
    const rows = entries.filter(
      (e) => (!group || e.action.startsWith(`${group}.`)) && normalize(`${e.actorLabel} ${describeAudit(e)}`).includes(terms),
    );
    slot.replaceChildren(
      dataTable({
        label: 'Auditoria',
        rows,
        sort: { key: 'when', dir: 'desc' },
        empty: emptyState({ title: entries.length ? 'Nenhum registro com esses filtros' : 'Nenhum registro ainda', compact: true }),
        columns: [
          { key: 'when', label: 'Quando', sortValue: (e) => e.createdAt, render: (e) => html`<time class="mono nowrap" datetime="${e.createdAt}">${formatDateTime(e.createdAt)}</time>` },
          { key: 'who', label: 'Quem', sortValue: (e) => e.actorLabel, render: (e) => e.actorLabel },
          { key: 'what', label: 'O que', render: (e) => describeAudit(e) },
          { key: 'code', label: 'Ação', hideOnMobile: true, render: (e) => html`<span class="mono muted">${e.action}</span>` },
        ],
      }),
    );
  };

  const load = async () => {
    setHtml(slot, html`<div class="skeleton"></div>`);
    try {
      entries = await data.audit.list(org.id, { limit: LIMIT });
      if (!signal.aborted) draw();
    } catch (error) {
      if (!signal.aborted) setHtml(slot, loadError(error));
    }
  };

  $('[data-search]', root).addEventListener('input', (e) => ((query = /** @type {HTMLInputElement} */ (e.target).value), draw()), { signal });
  $('[data-group]', root).addEventListener('change', (e) => ((group = /** @type {HTMLSelectElement} */ (e.target).value), draw()), { signal });
  $('[data-refresh]', root).addEventListener('click', load, { signal });
  await load();
}
