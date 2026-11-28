// Telas de entrada do celular: parear pelo QR, bloqueio (digital ou PIN) e "ainda não ligado".

import { html, setHtml, trusted } from '../shared/utils/dom.js';
import { icon } from '../shared/components/icons.js';
import { api, ApiError } from './api.js';
import { saveDevice, setSession, suggestedName, bioAvailable, createCredential, signChallenge } from './device.js';

/** A marca do DUM (a mesma do favicon). */
const MARK = trusted('<svg class="m-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#15181C"/><path d="M9 9h6.2c4.3 0 7.3 2.8 7.3 7s-3 7-7.3 7H9z" fill="none" stroke="#5CC2A0" stroke-width="2.6"/><rect x="13" y="14.6" width="5" height="2.8" rx="1" fill="#5CC2A0"/></svg>');

const message = (/** @type {unknown} */ e) => (e instanceof Error && e.message) || 'Não deu certo. Tente de novo.';

/** @param {HTMLElement} root @param {'new' | 'revoked' | 'forgot' | 'config'} reason */
export function welcomeScreen(root, reason = 'new') {
  const TEXT = {
    new: ['Este celular ainda não está ligado', 'No computador, abra o DUM Master em Ajustes › App no celular, toque em “Ligar um celular” e leia o QR com a câmera.'],
    revoked: ['Este celular foi desligado', 'Ele não vê mais o sistema nem recebe avisos. Para usar de novo, gere outro QR no computador, em Ajustes › App no celular.'],
    forgot: ['Celular desligado', 'Pronto: ele não vê mais o sistema nem recebe avisos. Para ligar de novo, leia outro QR no computador.'],
    config: ['Falta configurar o servidor', 'Este endereço não tem o env.js com o endereço do Supabase. Publique com “npm run deploy”.'],
  }[reason];
  setHtml(root, html`<main class="m-entry">
    ${MARK}
    <h1 class="m-entry__title">${TEXT[0]}</h1>
    <p class="m-entry__text">${TEXT[1]}</p>
  </main>`);
}

/**
 * Parear: nome, PIN e (se o celular tiver) a digital. Depois já abre a sessão com o PIN.
 * @param {HTMLElement} root @param {string} code @param {() => void} done
 */
export async function pairScreen(root, code, done) {
  const [name, canBio] = await Promise.all([suggestedName(), bioAvailable()]);
  setHtml(root, html`<main class="m-entry">
    ${MARK}
    <h1 class="m-entry__title">Ligar este celular</h1>
    <p class="m-entry__text">Ele vai acompanhar o DUM Master e receber os avisos, sem editar nada.</p>
    <form class="m-form" novalidate>
      <label class="m-field"><span>Nome deste celular</span>
        <input name="name" value="${name}" maxlength="60" autocomplete="off" autocapitalize="words" enterkeyhint="next" required></label>
      <label class="m-field"><span>Crie um PIN de 4 a 6 números</span>
        <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" enterkeyhint="next" required></label>
      <label class="m-field"><span>Repita o PIN</span>
        <input name="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" enterkeyhint="done" required></label>
      ${canBio
        ? html`<label class="m-switch m-switch--card"><span><strong>Abrir com a digital</strong><small>O PIN fica para quando a digital não der.</small></span>
            <input type="checkbox" role="switch" name="bio" checked></label>`
        : html`<p class="m-hint">Este celular não ofereceu a digital para o app, então ele vai abrir com o PIN.</p>`}
      <p class="m-error" role="alert" hidden></p>
      <button class="m-btn m-btn--primary m-btn--block" type="submit">Ligar celular</button>
    </form>
  </main>`);
  const form = /** @type {HTMLFormElement} */ (root.querySelector('form'));
  const error = /** @type {HTMLElement} */ (form.querySelector('.m-error'));
  const submit = /** @type {HTMLButtonElement} */ (form.querySelector('[type=submit]'));
  const fail = (/** @type {string} */ text) => {
    error.textContent = text;
    error.hidden = false;
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const data = new FormData(form);
    const label = String(data.get('name') ?? '').trim() || 'Celular';
    const pin = String(data.get('pin') ?? '');
    if (!/^\d{4,6}$/.test(pin)) return fail('O PIN precisa ter de 4 a 6 números.');
    if (pin !== String(data.get('pin2') ?? '')) return fail('Os dois PINs não são iguais.');
    submit.disabled = true;
    submit.textContent = 'Ligando…';
    try {
      let credential = null;
      if (data.get('bio') === 'on') {
        try {
          credential = await createCredential(`DUM · ${label}`);
        } catch {
          credential = null; // sem digital (cancelou ou o celular recusou): segue com o PIN
        }
      }
      const r = await api('pair', { code, name: label, pin, credential });
      const device = { id: r.device, secret: r.secret, name: r.name, org: r.org, user: r.user, bio: Boolean(r.bio), credential: credential?.id ?? null };
      saveDevice(device);
      const u = await api('unlock', { device: device.id, secret: device.secret, pin });
      setSession(u.session);
      done();
    } catch (e) {
      fail(message(e));
      submit.disabled = false;
      submit.textContent = 'Ligar celular';
    }
  });
}

/**
 * Bloqueio: digital (pedida sozinha ao abrir) ou PIN no teclado do app.
 * @param {HTMLElement} root
 * @param {import('./device.js').Device} device
 * @param {{ unlocked: () => void, revoked: () => void }} on
 */
export function lockScreen(root, device, on) {
  setHtml(root, html`<main class="m-entry m-lock">
    ${MARK}
    <p class="m-entry__org">${device.org}</p>
    <h1 class="m-entry__title">DUM Celular</h1>
    ${device.bio && device.credential
      ? html`<button type="button" class="m-btn m-btn--primary m-btn--block" data-bio>${icon('shield')}<span>Entrar com a digital</span></button>
          <p class="m-lock__or">ou digite o PIN</p>`
      : html`<p class="m-entry__text">Digite o PIN deste celular</p>`}
    <div class="m-pin" data-dots aria-label="PIN digitado"></div>
    <p class="m-error" role="alert" hidden></p>
    <div class="m-keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) =>
      k === '' ? html`<span></span>`
      : k === 'del' ? html`<button type="button" class="m-key m-key--quiet" data-key="del" aria-label="Apagar">${icon('arrowLeft')}</button>`
      : html`<button type="button" class="m-key" data-key="${k}">${k}</button>`)}</div>
    <button type="button" class="m-btn m-btn--block" data-enter disabled>Entrar</button>
  </main>`);
  const dots = /** @type {HTMLElement} */ (root.querySelector('[data-dots]'));
  const error = /** @type {HTMLElement} */ (root.querySelector('.m-error'));
  const enter = /** @type {HTMLButtonElement} */ (root.querySelector('[data-enter]'));
  let pin = '';
  let busy = false;
  const draw = () => {
    dots.replaceChildren(...Array.from({ length: Math.max(4, pin.length) }, (_, i) => {
      const d = document.createElement('span');
      d.className = i < pin.length ? 'is-on' : '';
      return d;
    }));
    enter.disabled = busy || pin.length < 4;
  };
  const show = (/** @type {string} */ text) => {
    error.textContent = text;
    error.hidden = !text;
  };
  /** @param {() => Promise<any>} attempt @param {boolean} [silent] tentativa automática: falhou, fica quieta */
  const run = async (attempt, silent = false) => {
    if (busy) return;
    busy = true;
    show('');
    draw();
    try {
      const r = await attempt();
      setSession(r.session);
      on.unlocked();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'revoked') return on.revoked();
      const cancelled = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError');
      if (!(silent && cancelled)) show(cancelled ? 'A digital foi cancelada. Toque de novo ou digite o PIN.' : message(e));
      pin = '';
    } finally {
      busy = false;
      draw();
    }
  };
  const viaPin = () => run(() => api('unlock', { device: device.id, secret: device.secret, pin }));
  const viaBio = (auto = false) => run(async () => {
    const c = await api('challenge', { device: device.id, secret: device.secret });
    if (!c.bio) throw new Error('A digital não está cadastrada neste celular. Use o PIN.');
    const assertion = await signChallenge(c.challenge, c.credential);
    return api('unlock', { device: device.id, secret: device.secret, assertion });
  }, auto);
  const press = (/** @type {string} */ key) => {
    if (busy) return;
    if (key === 'del') pin = pin.slice(0, -1);
    else if (pin.length < 6) pin += key;
    show('');
    draw();
  };
  root.addEventListener('click', (event) => {
    const el = /** @type {HTMLElement} */ (event.target).closest('button');
    if (!el) return;
    if (el.dataset.key) press(el.dataset.key);
    else if (el.hasAttribute('data-enter')) viaPin();
    else if (el.hasAttribute('data-bio')) viaBio();
  });
  const onKey = (/** @type {KeyboardEvent} */ event) => {
    if (!root.querySelector('.m-lock')) return document.removeEventListener('keydown', onKey);
    if (/^\d$/.test(event.key)) press(event.key);
    else if (event.key === 'Backspace') press('del');
    else if (event.key === 'Enter' && pin.length >= 4) viaPin();
  };
  document.addEventListener('keydown', onKey);
  draw();
  if (device.bio && device.credential && document.visibilityState === 'visible') viaBio(true);
}
