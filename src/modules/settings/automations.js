// Ajustes › Automações: as mesmas rotinas da tela de Automações, dentro de Ajustes (sem o título duplicado).

import { $ } from '../../shared/utils/dom.js';
import { render as renderAutomations } from '../automation/index.js';

/** @param {import('../index.js').ModuleContext} ctx */
export async function render(ctx) {
  await renderAutomations(ctx);
  $('.page-head', ctx.root)?.remove();
}
