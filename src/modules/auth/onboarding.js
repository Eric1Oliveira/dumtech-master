// Primeira organização. Sem organização não há o que mostrar: tudo pertence a uma.

import { html, setHtml, $ } from '../../shared/utils/dom.js';
import { getState } from '../../core/state.js';
import { events } from '../../core/events.js';
import { createOrganization, signOut } from '../../services/auth.js';
import { errorMessage, toastError } from '../../shared/components/feedback.js';

/** @param {HTMLElement} root */
export function renderOnboarding(root) {
  document.title = 'Primeira organização — DUMTech Master';
  const { user } = getState();
  setHtml(
    root,
    html`<div class="entry">
      <div class="entry__panel">
        <p class="brand brand--large"><span class="brand__mark">DUM</span><span class="brand__name">Master</span></p>
        <h1 class="entry__title">Olá, ${user?.name.split(' ')[0] ?? ''}. Crie sua organização.</h1>
        <p class="entry__lead">Clientes, projetos, membros e auditoria pertencem a uma organização — e ficam isolados das outras. Você será o proprietário.</p>
        <form class="stack" id="org-form" novalidate>
          <label class="field"><span class="field__label">Nome da organização</span>
            <input class="input" name="name" required minlength="2" maxlength="80" autocomplete="organization"></label>
          <p class="form-error" role="alert" hidden></p>
          <button type="submit" class="btn btn--primary btn--block">Criar organização</button>
        </form>
        <button type="button" class="link-action" id="leave">Sair</button>
      </div>
      <p class="entry__foot">Conectado como ${user?.email ?? ''}</p>
    </div>`,
  );
  /** @type {HTMLInputElement} */ ($('input', root)).focus();

  $('#leave', root).addEventListener('click', () => signOut().catch(toastError));
  $('#org-form', root).addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = /** @type {HTMLFormElement} */ (event.target);
    const errorBox = /** @type {HTMLElement} */ ($('.form-error', form));
    const button = /** @type {HTMLButtonElement} */ ($('[type=submit]', form));
    if (!form.reportValidity()) return;
    button.disabled = true;
    try {
      await createOrganization(String(new FormData(form).get('name')));
      events.emit('session:changed');
    } catch (error) {
      errorBox.textContent = errorMessage(error);
      errorBox.hidden = false;
      button.disabled = false;
    }
  });
}
