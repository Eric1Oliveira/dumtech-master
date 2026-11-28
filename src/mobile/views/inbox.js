// Avisos no celular: os últimos 40 do sininho (só leitura: abrir aqui não marca como lido).

import { html } from '../../shared/utils/dom.js';
import { formatRelative } from '../../shared/utils/format.js';
import { phoneRoute } from '../model.js';
import { empty, dot } from '../ui.js';
import { icon } from '../../shared/components/icons.js';

export default {
  title: () => 'Avisos',
  back: () => '#/hoje',
  /** @param {import('../model.js').Model} m */
  render(m) {
    if (!m.notifications.length) return empty('Nenhum aviso ainda', 'Quando um site cair, uma cobrança vencer ou alguém registrar um pagamento, aparece aqui e na tela do celular.');
    return html`<ul class="m-list m-inbox">${m.notifications.map((n) => html`<li>
      <a class="m-row m-row--stack ${n.readAt ? '' : 'is-unread'}" href="${phoneRoute(n.link)}">
        <span class="m-row__lead">${dot(n.kind)}</span>
        <span class="m-row__body"><span class="m-row__title">${n.title}</span>${n.body ? html`<span class="m-row__sub">${n.body}</span>` : ''}
          <span class="m-row__time">${formatRelative(n.createdAt)}</span></span>
        <span class="m-row__chev" aria-hidden="true">${icon('chevronRight')}</span>
      </a></li>`)}</ul>`;
  },
};
