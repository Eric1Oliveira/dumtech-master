// Administração e Segurança: abas por seção, cada uma num arquivo.

import { html, setHtml, $ } from '../../shared/utils/dom.js';
import { canDo } from '../../services/auth.js';
import { getState } from '../../core/state.js';
import { emptyState } from '../../shared/components/feedback.js';

/** @type {Record<string, () => Promise<{ render: import('../index.js').ModuleRender }>>} */
const SECTIONS = {
  organization: () => import('./organization.js'),
  members: () => import('./members.js'),
  prices: () => import('./prices.js'),
  billing: () => import('./billing.js'),
  mobile: () => import('./mobile.js'),
  alerts: () => import('./alerts.js'),
  checklist: () => import('./checklist.js'),
  automations: () => import('./automations.js'),
  roles: () => import('./roles.js'),
  audit: () => import('./audit.js'),
  integrations: () => import('./integrations.js'),
  environment: () => import('./environment.js'),
};

/** @param {import('../index.js').ModuleContext} ctx */
export async function render(ctx) {
  const { root, route, module, signal } = ctx;
  const sections = module.sections.filter((s) => !s.permission || canDo(s.permission));
  const requested = module.sections.find((s) => s.id === route.section);
  const current = requested ?? sections[0];

  setHtml(
    root,
    html`<header class="page-head">
        <div>
          <h1 class="page-title">${module.name}</h1>
          <p class="page-sub">Como a ${getState().org.name} funciona: equipe, preços, cobrança e o sistema</p>
        </div>
      </header>
      <nav class="tabs" aria-label="Seções de administração">
        ${sections.map((s) => html`<a class="tabs__item" href="#/${module.id}/${s.id}" ${s.id === current.id ? html`aria-current="page"` : ''}>${s.name}</a>`)}
      </nav>
      <div class="section-body"></div>`,
  );
  const body = /** @type {HTMLElement} */ ($('.section-body', root));

  if (current.permission && !canDo(current.permission)) {
    setHtml(body, emptyState({ title: 'Sem acesso a esta seção', text: 'Seu papel nesta organização não inclui esta área.' }));
    return;
  }
  const { render: renderSection } = await SECTIONS[current.id]();
  if (signal.aborted) return;
  await renderSection({ ...ctx, root: body });
}
