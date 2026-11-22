// Tela de entrada: e-mail + senha (entrar, criar conta, recuperar senha).
// Com um link de convite pendente, mostra para qual organização e papel a pessoa foi
// convidada e trava o e-mail no convidado.

import { html, setHtml, $ } from '../../shared/utils/dom.js';
import { signIn, signUp, requestPasswordReset, pendingInvite, discardInvite } from '../../services/auth.js';
import { data } from '../../services/data.js';
import { roleName } from '../../core/permissions.js';
import { openDialog } from '../../shared/components/dialog.js';
import { errorMessage, toast } from '../../shared/components/feedback.js';

const INVITE_PROBLEMS = {
  expired: 'Este convite expirou.',
  used: 'Este convite já foi usado. Se você já tem conta, é só entrar.',
  revoked: 'Este convite foi cancelado.',
  invalid: 'Este link de convite não é válido.',
};

/** @param {HTMLElement} root */
export async function renderLogin(root) {
  document.title = 'Entrar — DUMTech Master';
  // Ouvintes num nó próprio: somem junto com a tela ao entrar no app.
  const host = document.createElement('div');
  root.replaceChildren(host);

  /** @type {import('../../services/data.js').InvitePreview | null} */
  let invite = null;
  const token = pendingInvite();
  if (token) {
    invite = await data.invites.preview(token).catch(() => ({ status: /** @type {const} */ ('invalid') }));
    if (invite.status !== 'valid') discardInvite();
  }
  const invited = () => invite?.status === 'valid';
  // Convite abre em "Criar conta"; quem já tem conta troca para "Já tenho conta".
  let mode = /** @type {'signin' | 'signup'} */ (invited() ? 'signup' : 'signin');

  const inviteBlock = () => {
    if (!invite) return '';
    if (!invited()) {
      return html`<div class="notice notice--danger" role="alert">
        <p><strong>${INVITE_PROBLEMS[invite.status]}</strong> Peça um novo link a quem convidou você.</p>
      </div>`;
    }
    return html`<div class="invite-card">
      <p class="invite-card__eyebrow">Convite</p>
      <p class="invite-card__org">${invite.orgName}</p>
      <p class="invite-card__text">Você entra como <strong>${roleName(invite.role)}</strong>.
        ${mode === 'signup' ? 'Crie sua senha para aceitar.' : 'Entre com sua conta para aceitar.'}</p>
      <button type="button" class="link-action" data-ignore-invite>Não sou eu — entrar sem o convite</button>
    </div>`;
  };

  const draw = () => {
    const signup = mode === 'signup';
    const lockedEmail = invited() ? invite.email : null;
    const title = invited() && signup ? 'Aceitar convite' : signup ? 'Criar conta' : 'Entrar';
    setHtml(
      host,
      html`<div class="entry">
        <div class="entry__panel">
          <p class="brand brand--large"><span class="brand__mark">DUM</span><span class="brand__name">Master</span></p>
          <h1 class="entry__title">${title}</h1>
          ${inviteBlock()}

          <div class="segmented" role="tablist" aria-label="Acesso">
            <button type="button" role="tab" class="segmented__item" aria-selected="${!signup}" data-mode="signin">Já tenho conta</button>
            <button type="button" role="tab" class="segmented__item" aria-selected="${signup}" data-mode="signup">Criar conta</button>
          </div>

          <form class="stack" id="entry-form" novalidate>
            ${signup
              ? html`<label class="field"><span class="field__label">Nome</span>
                  <input class="input" name="name" autocomplete="name" ${signup ? html`required` : ''} minlength="2" maxlength="80">
                  </label>`
              : ''}
            <label class="field"><span class="field__label">E-mail</span>
              <input class="input" type="email" name="email" required autocomplete="email"
                ${lockedEmail ? html`value="${lockedEmail}" readonly aria-describedby="email-lock"` : ''}>
              ${lockedEmail ? html`<span class="field__hint" id="email-lock">O convite vale só para este e-mail.</span>` : ''}</label>
            <label class="field"><span class="field__label">Senha</span>
              <input class="input" type="password" name="password" required minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}">
              ${signup ? html`<span class="field__hint">Mínimo de 8 caracteres.</span>` : ''}</label>
            <p class="form-error" role="alert" hidden></p>
            <button type="submit" class="btn btn--primary btn--block">${signup ? (invited() ? 'Criar conta e entrar' : 'Criar conta') : 'Entrar'}</button>
          </form>

          ${!signup ? html`<button type="button" class="link-action" data-forgot>Esqueci minha senha</button>` : ''}
        </div>
        <p class="entry__foot">DUMTech Master · plataforma interna da DUMTech</p>
      </div>`,
    );
    /** @type {HTMLInputElement | null} */ ($('input:not([readonly])', host))?.focus();
  };

  host.onclick = (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const tab = /** @type {HTMLElement | null} */ (target.closest('[data-mode]'));
    if (tab) {
      mode = /** @type {'signin' | 'signup'} */ (tab.dataset.mode);
      draw();
    } else if (target.closest('[data-forgot]')) {
      forgotPassword();
    } else if (target.closest('[data-ignore-invite]')) {
      discardInvite();
      invite = null;
      mode = 'signin';
      draw();
    }
  };

  host.onsubmit = async (event) => {
    event.preventDefault();
    const form = /** @type {HTMLFormElement} */ (event.target);
    const errorBox = /** @type {HTMLElement} */ ($('.form-error', form));
    const button = /** @type {HTMLButtonElement} */ ($('[type=submit]', form));
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    const input = { email: String(values.email ?? ''), password: String(values.password ?? ''), name: String(values.name ?? '') };
    button.disabled = true;
    errorBox.hidden = true;
    try {
      if (mode === 'signup') {
        const result = await signUp(input);
        if (result.needsConfirmation) {
          toast('Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.', 'success');
          mode = 'signin';
          draw();
        }
      } else {
        await signIn(input);
      }
    } catch (error) {
      errorBox.textContent = errorMessage(error);
      errorBox.hidden = false;
      button.disabled = false;
    }
  };

  draw();
}

async function forgotPassword() {
  const sent = await openDialog({
    title: 'Recuperar senha',
    description: 'Enviaremos um link para definir uma nova senha.',
    body: html`<label class="field"><span class="field__label">E-mail</span>
      <input class="input" type="email" name="email" required autocomplete="email"></label>`,
    submitLabel: 'Enviar link',
    onSubmit: (form) => requestPasswordReset(String(form.get('email'))),
  });
  if (sent) toast('Se houver uma conta com este e-mail, o link chegará em instantes.', 'success');
}
