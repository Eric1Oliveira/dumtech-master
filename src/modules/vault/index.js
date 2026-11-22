// Senhas — cofre pessoal. Cada pessoa tem o seu, com a frase-mestra só dela: ninguém mais vê nem os
// títulos. Tudo é cifrado e decifrado aqui no navegador (src/core/vault-crypto.js); o servidor guarda
// só cifrados e registra cada abertura. Compartilhar manda uma cópia cifrada para o cofre de outra
// pessoa (só a chave dela abre); quem compartilha edita → a cópia é recifrada na hora.
// A chave fica só na memória desta aba e tranca sozinha após 10 minutos sem uso.

import { html, setHtml, $, bindActions } from '../../shared/utils/dom.js';
import { formatRelative, formatDateTime } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { events } from '../../core/events.js';
import { labelOf } from '../../core/validate.js';
import {
  createVault, unlockVault, seal, unseal, itemAad, passphraseProblem, strongPassword,
  createKeyPair, openPrivateKey, rewrapPrivateKey, sealFor, openShared, shareAad,
} from '../../core/vault-crypto.js';
import { data } from '../../services/data.js';
import { listPage } from '../../shared/components/list-page.js';
import { openRecordDialog } from '../../shared/components/record-form.js';
import { openDialog, confirmDialog } from '../../shared/components/dialog.js';
import { loadError, toast, toastError, errorMessage } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';

/** @typedef {import('../../modules/index.js').ModuleContext} Ctx */
/** @typedef {{ username?: string, secret?: string, url?: string, notes?: string }} SecretValue */
/**
 * Linha da lista: segredo meu ou cópia recebida.
 * @typedef {{ id: string, title: string, kind: 'login' | 'api_key' | 'note', updatedAt: string, mine: boolean,
 *   sharedWith: string[], ownerName: string, itemId: string }} Row
 */

const FILTERS = /** @type {const} */ ([
  { key: 'login', label: 'Logins' },
  { key: 'api_key', label: 'Chaves de API' },
  { key: 'note', label: 'Notas' },
  { key: 'received', label: 'Recebidas' },
]);
const KIND_OPTIONS = [
  { value: 'login', label: 'Login (usuário e senha)' },
  { value: 'api_key', label: 'Chave de API ou token' },
  { value: 'note', label: 'Nota secreta' },
];
const KIND_LABEL = KIND_OPTIONS.map((k) => ({ key: k.value, label: k.label.replace(/ \(.*\)$/, '') }));
const KIND_ICON = /** @type {const} */ ({ login: 'lock', api_key: 'zap', note: 'fileText' });
const LOCK_AFTER_MS = 10 * 60 * 1000;

/** @type {{ orgId: string, userId: string, key: CryptoKey, privateKey: CryptoKey } | null} */
let session = null;
let lockTimer = 0;

function lock() {
  session = null;
  clearTimeout(lockTimer);
  if (location.hash.startsWith('#/vault')) window.dispatchEvent(new HashChangeEvent('hashchange'));
}
function touch() {
  clearTimeout(lockTimer);
  lockTimer = window.setTimeout(lock, LOCK_AFTER_MS);
}
events.on('org:changed', () => (session = null));
events.on('session:changed', () => (session = null));

const header = (/** @type {string} */ sub) => html`<header class="page-head">
  <div>
    <h1 class="page-title">Senhas</h1>
    <p class="page-sub">${sub}</p>
  </div>
</header>`;

/** Abre a chave de compartilhamento (e cria, num cofre de antes do compartilhamento). */
async function sharingKey(/** @type {string} */ orgId, /** @type {string} */ userId, /** @type {CryptoKey} */ key, /** @type {import('../../core/vault-crypto.js').VaultSettings} */ settings) {
  if (settings.publicKey && settings.keyIv && settings.keyCipher) return openPrivateKey(key, { keyIv: settings.keyIv, keyCipher: settings.keyCipher }, orgId, userId);
  const { keys, privateKey } = await createKeyPair(key, orgId, userId);
  await data.vault.setKeys(orgId, keys);
  return privateKey;
}

/** @param {Ctx} ctx */
export async function render(ctx) {
  const { org, user } = getState();
  if (session && (session.orgId !== org.id || session.userId !== user?.id)) session = null;
  setHtml(ctx.root, html`<div class="skeleton"></div>`);
  let settings;
  try {
    settings = await data.vault.settings(org.id);
  } catch (error) {
    if (!ctx.signal.aborted) setHtml(ctx.root, loadError(error));
    return;
  }
  if (ctx.signal.aborted) return;
  if (!settings) return renderSetup(ctx);
  if (!session) return renderUnlock(ctx, settings);
  touch();
  return renderOpen(ctx);
}

/** Primeiro uso: criar o próprio cofre. @param {Ctx} ctx */
function renderSetup({ root, signal }) {
  const { org, user } = getState();
  setHtml(
    root,
    html`${header('Seu cofre pessoal de senhas, cifrado no navegador')}
      <section class="vault-gate" aria-labelledby="gate-title">
        <span class="vault-gate__seal" aria-hidden="true">${icon('shield')}</span>
        <h2 class="vault-gate__title" id="gate-title">Criar o seu cofre</h2>
        <p class="vault-gate__lead">Só você abre. Nem os administradores de ${org.name} veem o que tem dentro, nem os títulos.</p>
        <ul class="vault-points">
          <li>${icon('lock')}<span>A frase-mestra cifra tudo aqui no navegador. O servidor só recebe texto cifrado.</span></li>
          <li>${icon('send')}<span>Para passar um acesso a alguém da equipe, compartilhe só aquele item: ele chega cifrado no cofre da pessoa.</span></li>
          <li>${icon('alert')}<span>A frase não é guardada em lugar nenhum. Sem ela, ninguém recupera os segredos.</span></li>
        </ul>
        <form class="vault-form" id="vault-setup" novalidate>
          <label class="field"><span class="field__label">Frase-mestra</span>
            <input class="input" type="password" name="pass" required minlength="12" autocomplete="new-password"></label>
          <label class="field"><span class="field__label">Repita a frase-mestra</span>
            <input class="input" type="password" name="again" required autocomplete="new-password">
            <span class="field__hint">Pelo menos 12 caracteres. Uma frase com 4 ou mais palavras é forte e fácil de lembrar.</span></label>
          <p class="form-error" role="alert" hidden></p>
          <button type="submit" class="btn btn--primary btn--block">${icon('lock')}<span>Criar o meu cofre</span></button>
        </form>
      </section>`,
  );
  const form = /** @type {HTMLFormElement} */ ($('#vault-setup', root));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const pass = String(values.get('pass'));
    const errorBox = /** @type {HTMLElement} */ ($('.form-error', form));
    const button = /** @type {HTMLButtonElement} */ ($('[type=submit]', form));
    const label = /** @type {HTMLElement} */ (button.lastElementChild);
    errorBox.hidden = true;
    try {
      if (pass !== String(values.get('again'))) throw new Error('As duas frases não são iguais.');
      button.disabled = true;
      label.textContent = 'Gerando as chaves…';
      const { settings, key } = await createVault(pass, org.id);
      const { keys, privateKey } = await createKeyPair(key, org.id, user.id);
      await data.vault.setup(org.id, { ...settings, ...keys });
      session = { orgId: org.id, userId: user.id, key, privateKey };
      toast('Cofre criado. Ele fica aberto nesta aba até você trancar.', 'success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (error) {
      errorBox.textContent = errorMessage(error);
      errorBox.hidden = false;
      button.disabled = false;
      label.textContent = 'Criar o meu cofre';
    }
  }, { signal });
}

/** @param {Ctx} ctx @param {import('../../core/vault-crypto.js').VaultSettings} settings */
function renderUnlock({ root, signal }, settings) {
  const { org, user } = getState();
  setHtml(
    root,
    html`${header('Seu cofre pessoal de senhas')}
      <section class="vault-gate vault-gate--compact" aria-labelledby="gate-title">
        <span class="vault-gate__seal" aria-hidden="true">${icon('lock')}</span>
        <h2 class="vault-gate__title" id="gate-title">Cofre trancado</h2>
        <p class="vault-gate__lead">Digite a sua frase-mestra. Ela é conferida aqui, sem sair do navegador.</p>
        <form class="vault-form" id="vault-unlock" novalidate>
          <label class="field"><span class="field__label">Frase-mestra</span>
            <input class="input" type="password" name="pass" required autocomplete="current-password"></label>
          <p class="form-error" role="alert" hidden></p>
          <button type="submit" class="btn btn--primary btn--block">${icon('lock')}<span>Abrir o cofre</span></button>
        </form>
      </section>`,
  );
  const form = /** @type {HTMLFormElement} */ ($('#vault-unlock', root));
  /** @type {HTMLInputElement} */ ($('[name=pass]', form)).focus();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = /** @type {HTMLElement} */ ($('.form-error', form));
    const button = /** @type {HTMLButtonElement} */ ($('[type=submit]', form));
    const label = /** @type {HTMLElement} */ (button.lastElementChild);
    button.disabled = true;
    label.textContent = 'Conferindo…';
    errorBox.hidden = true;
    try {
      const key = await unlockVault(String(new FormData(form).get('pass')), settings, org.id);
      session = { orgId: org.id, userId: user.id, key, privateKey: await sharingKey(org.id, user.id, key, settings) };
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (error) {
      errorBox.textContent = errorMessage(error);
      errorBox.hidden = false;
      button.disabled = false;
      label.textContent = 'Abrir o cofre';
    }
  }, { signal });
}

/** @param {Ctx} ctx */
async function renderOpen({ root, module, signal }) {
  const { org } = getState();
  const page = listPage(/** @type {import('../../shared/components/list-page.js').ListPageOptions<Row>} */ ({
    root,
    module,
    signal,
    title: 'Senhas',
    sub: 'Seu cofre pessoal · aberto nesta aba · tranca sozinho após 10 minutos sem uso',
    newLabel: null,
    statuses: FILTERS,
    statusOf: (r) => (r.mine ? r.kind : 'received'),
    searchOf: (r) => `${r.title} ${r.ownerName} ${r.sharedWith.join(' ')}`,
    searchLabel: 'Buscar pelo título ou pessoa',
    sort: { key: 'title', dir: 'asc' },
    empty: { title: 'Cofre vazio', text: 'Guarde aqui senhas de painéis, chaves de API e acessos. O que a equipe compartilhar com você aparece em Recebidas.' },
    columns: [
      {
        key: 'title',
        label: 'Segredo',
        sortValue: (r) => r.title,
        render: (r) => html`<button type="button" class="secret-name" data-action="open" data-id="${r.id}">
          <span class="secret-name__icon secret-name__icon--${r.mine ? 'mine' : 'received'}" aria-hidden="true">${icon(KIND_ICON[r.kind])}</span>
          <span class="person"><strong>${r.title}</strong><small>${labelOf(KIND_LABEL, r.kind)}</small></span>
        </button>`,
      },
      {
        key: 'people',
        label: 'Compartilhamento',
        hideOnMobile: true,
        sortValue: (r) => (r.mine ? r.sharedWith.length : -1),
        render: (r) =>
          r.mine
            ? r.sharedWith.length
              ? html`<span class="share-chip">${icon('users')}<span>${r.sharedWith.length === 1 ? r.sharedWith[0] : `${r.sharedWith.length} pessoas`}</span></span>`
              : html`<span class="muted">só você</span>`
            : html`<span class="share-chip share-chip--in">${icon('send')}<span>de ${r.ownerName}</span></span>`,
      },
      { key: 'updated', label: 'Atualizado', hideOnMobile: true, sortValue: (r) => r.updatedAt, render: (r) => html`<span title="${formatDateTime(r.updatedAt)}">${formatRelative(r.updatedAt)}</span>` },
      {
        key: 'actions',
        label: 'Ações',
        align: /** @type {const} */ ('end'),
        render: (r) => html`<span class="row-actions">
          ${r.mine
            ? html`<button type="button" class="icon-btn icon-btn--sm" data-action="share" data-id="${r.id}" aria-label="Compartilhar ${r.title}" title="Compartilhar">${icon('send')}</button>
              <button type="button" class="icon-btn icon-btn--sm" data-action="remove" data-id="${r.id}" aria-label="Excluir ${r.title}" title="Excluir">${icon('trash')}</button>`
            : html`<button type="button" class="icon-btn icon-btn--sm" data-action="drop" data-id="${r.id}" aria-label="Tirar ${r.title} do meu cofre" title="Tirar do meu cofre">${icon('x')}</button>`}
        </span>`,
      },
    ],
  }));

  let actions = $('.page-actions', root);
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'page-actions';
    /** @type {HTMLElement} */ ($('.page-head', root)).append(actions);
  }
  setHtml(
    actions,
    html`<button type="button" class="btn btn--ghost" data-action="lock">${icon('lock')}<span>Trancar</span></button>
      <button type="button" class="btn btn--secondary" data-action="rotate">Trocar frase-mestra</button>
      <button type="button" class="btn btn--primary" data-action="new">${icon('plus')}<span>Novo segredo</span></button>`,
  );

  /** @type {Row[]} */
  let rows = [];
  const load = async () => {
    try {
      const [mine, received] = await Promise.all([data.vault.list(org.id), data.vault.received(org.id)]);
      rows = [
        ...mine.map((i) => ({ ...i, mine: true, ownerName: '', itemId: i.id })),
        ...received.map((r) => ({ ...r, mine: false, sharedWith: [] })),
      ];
      if (!signal.aborted) page.show(rows);
    } catch (error) {
      if (!signal.aborted) page.fail(error);
    }
  };
  const rowOf = (/** @type {string | undefined} */ id) => /** @type {Row} */ (rows.find((r) => r.id === id));

  /** Decifra um segredo meu (abertura auditada). @param {Row} row @returns {Promise<SecretValue>} */
  const valueOf = async (row) => {
    if (!session) throw new Error('O cofre trancou. Abra de novo.');
    return unseal(session.key, await data.vault.open(org.id, row.id), itemAad(org.id, row.id));
  };

  /** Recifra a cópia de cada pessoa que já recebe este segredo. @param {string} itemId @param {SecretValue} value */
  const reshare = async (itemId, value) => {
    for (const t of await data.vault.sharesOf(org.id, itemId)) {
      await data.vault.share(org.id, itemId, t.recipientId, await sealFor(t.publicKey, value, shareAad(org.id, itemId, t.recipientId)));
    }
  };

  /** Cadastro/edição: cifra no navegador e envia só o cifrado. @param {Row | null} item @param {SecretValue} value */
  const edit = async (item, value) => {
    touch();
    const saving = openRecordDialog({
      title: item ? 'Editar segredo' : 'Novo segredo',
      description: item?.sharedWith.length ? `Quem recebeu (${item.sharedWith.join(', ')}) passa a ver a versão nova.` : 'Tudo, menos o título, é cifrado aqui antes de sair do navegador.',
      fields: [
        { name: 'title', label: 'Título', required: true, maxlength: 120, placeholder: 'Ex.: Supabase produção' },
        { name: 'kind', label: 'Tipo', type: 'select', options: KIND_OPTIONS },
        { name: 'username', label: 'Usuário ou e-mail', maxlength: 200, full: true },
        { name: 'secret', label: 'Senha, chave ou token', type: 'password', full: true, maxlength: 4000, mono: true },
        { name: 'url', label: 'Endereço', type: 'url', maxlength: 500, full: true, placeholder: 'https://' },
        { name: 'notes', label: 'Observações', type: 'textarea' },
      ],
      values: { title: item?.title ?? '', kind: item?.kind ?? 'login', ...value },
      submitLabel: item ? 'Salvar segredo' : 'Guardar no cofre',
      onSubmit: async (v) => {
        if (!session) throw new Error('O cofre trancou. Abra de novo para salvar.');
        const title = String(v.title ?? '').trim();
        if (title.length < 2 || title.length > 120) throw new Error('O título precisa ter entre 2 e 120 caracteres.');
        const id = item?.id ?? globalThis.crypto.randomUUID();
        const payload = { username: String(v.username ?? ''), secret: String(v.secret ?? ''), url: String(v.url ?? ''), notes: String(v.notes ?? '') };
        await data.vault.save(org.id, { id, title, kind: String(v.kind), box: await seal(session.key, payload, itemAad(org.id, id)) });
        if (item?.sharedWith.length) await reshare(id, payload);
      },
    });
    // Gerador de senha forte ao lado do campo
    const field = /** @type {HTMLInputElement | null} */ (document.querySelector('dialog.dialog[open] [name=secret]'));
    if (field) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'link-action field__action';
      button.textContent = 'Gerar senha forte';
      button.addEventListener('click', () => {
        field.value = strongPassword();
        field.type = 'text';
      });
      field.after(button);
    }
    if (await saving) {
      toast(item ? 'Segredo atualizado.' : 'Segredo guardado no cofre.', 'success');
      load();
    }
  };

  /** Com quem este segredo está compartilhado: marca e desmarca. @param {Row} row @param {SecretValue | null} known */
  const share = async (row, known = null) => {
    touch();
    let members;
    let current;
    try {
      [members, current] = await Promise.all([data.vault.members(org.id), data.vault.sharesOf(org.id, row.id)]);
    } catch (error) {
      return toastError(error);
    }
    const has = new Map(current.map((t) => [t.recipientId, t.shareId]));
    const ok = await openDialog({
      title: 'Compartilhar',
      description: `“${row.title}” vai cifrado para o cofre de cada pessoa marcada. Só ela abre; se você editar, ela vê a versão nova.`,
      body: members.length
        ? html`<div class="pick-list">${members.map(
            (m) => html`<label class="pick">
              <input type="checkbox" name="to" value="${m.userId}" ${has.has(m.userId) ? html`checked` : ''}>
              <span class="avatar avatar--sm" aria-hidden="true">${m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
              <span class="pick__body"><strong>${m.name}</strong><small>${m.email}</small></span>
            </label>`,
          )}</div>`
        : html`<p class="notice">Ninguém da equipe criou o cofre ainda. Quando alguém criar, aparece aqui.</p>`,
      submitLabel: members.length ? 'Salvar' : null,
      cancelLabel: members.length ? 'Cancelar' : 'Fechar',
      onSubmit: async (form) => {
        if (!session) throw new Error('O cofre trancou. Abra de novo.');
        const chosen = new Set(form.getAll('to').map(String));
        const adding = members.filter((m) => chosen.has(m.userId) && !has.has(m.userId));
        const value = adding.length ? known ?? (await valueOf(row)) : null;
        for (const m of adding) await data.vault.share(org.id, row.id, m.userId, await sealFor(m.publicKey, value, shareAad(org.id, row.id, m.userId)));
        for (const [recipientId, shareId] of has) if (!chosen.has(recipientId)) await data.vault.unshare(org.id, shareId);
      },
    }).catch((e) => (toastError(e), false));
    if (ok) {
      toast('Compartilhamento atualizado.', 'success');
      load();
    }
  };

  /** Abre (auditado), decifra e mostra. @param {Row} row */
  const reveal = async (row) => {
    touch();
    if (!session) return lock();
    /** @type {SecretValue} */
    let value;
    try {
      value = row.mine
        ? await valueOf(row)
        : await openShared(session.privateKey, await data.vault.openShared(org.id, row.id), shareAad(org.id, row.itemId, session.userId));
    } catch (error) {
      toastError(error instanceof Error && error.name === 'OperationError' ? new Error('Este segredo não abre com a chave deste cofre (cifrado inválido).') : error);
      return;
    }
    const line = (/** @type {string} */ label, /** @type {keyof SecretValue} */ field, /** @type {boolean} */ hidden) => html`<div class="secret__row">
      <dt>${label}</dt>
      <dd><span class="mono secret__value" data-value="${field}">${hidden ? '••••••••••••' : value[field]}</span>
        <span class="secret__tools">
          ${hidden ? html`<button type="button" class="link-action" data-reveal="${field}">Mostrar</button>` : ''}
          <button type="button" class="link-action" data-copy="${field}">Copiar</button>
        </span></dd>
    </div>`;
    const origin = row.mine
      ? row.sharedWith.length ? `compartilhado com ${row.sharedWith.join(', ')}` : 'só no seu cofre'
      : `recebido de ${row.ownerName} · só leitura`;
    const done = openDialog({
      title: row.title,
      description: `${labelOf(KIND_LABEL, row.kind)} · ${origin} · esta abertura fica na auditoria`,
      wide: true,
      body: html`<dl class="secret">
        ${value.username ? line(row.kind === 'login' ? 'Usuário' : 'Identificação', 'username', false) : ''}
        ${value.secret ? line(row.kind === 'api_key' ? 'Chave' : 'Senha', 'secret', true) : ''}
        ${value.url ? html`<div class="secret__row"><dt>Endereço</dt><dd><a href="${value.url}" target="_blank" rel="noopener noreferrer">${value.url}</a></dd></div>` : ''}
        ${value.notes ? html`<div class="secret__row"><dt>Observações</dt><dd class="prewrap">${value.notes}</dd></div>` : ''}
      </dl>
      ${row.mine ? html`<p class="secret__foot"><button type="button" class="btn btn--secondary btn--sm" data-share>${icon('send')}<span>Compartilhar</span></button></p>` : ''}`,
      submitLabel: row.mine ? 'Editar' : null,
      cancelLabel: 'Fechar',
    });
    const dialog = /** @type {HTMLDialogElement} */ ([...document.querySelectorAll('dialog.dialog[open]')].at(-1));
    dialog.addEventListener('click', async (event) => {
      const target = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest('button') ?? event.target);
      const copy = /** @type {keyof SecretValue | undefined} */ (target.dataset.copy);
      const show = /** @type {keyof SecretValue | undefined} */ (target.dataset.reveal);
      if (copy) {
        try {
          await navigator.clipboard.writeText(value[copy] ?? '');
          toast('Copiado.', 'success');
        } catch {
          toast('Não foi possível copiar. Use “Mostrar” e copie à mão.', 'danger');
        }
      }
      if (show) {
        /** @type {HTMLElement} */ ($(`[data-value="${show}"]`, dialog)).textContent = value[show] ?? '';
        target.remove();
      }
      if (target.hasAttribute('data-share')) {
        dialog.close();
        share(row, value);
      }
    });
    if (await done) edit(row, value);
  };

  /** Nova frase-mestra: recifra tudo e a chave de compartilhamento, e troca de uma vez no servidor. */
  const rotate = async () => {
    touch();
    const ok = await openDialog({
      title: 'Trocar a frase-mestra',
      description: 'Seus segredos são recifrados aqui com a frase nova. O que você compartilhou e recebeu continua abrindo.',
      body: html`<label class="field"><span class="field__label">Nova frase-mestra</span><input class="input" type="password" name="pass" required minlength="12" autocomplete="new-password"></label>
        <label class="field"><span class="field__label">Repita a nova frase</span><input class="input" type="password" name="again" required autocomplete="new-password"></label>`,
      submitLabel: 'Trocar e recifrar',
      onSubmit: async (form) => {
        if (!session) throw new Error('O cofre trancou. Abra de novo.');
        const pass = String(form.get('pass'));
        if (pass !== String(form.get('again'))) throw new Error('As duas frases não são iguais.');
        const problem = passphraseProblem(pass);
        if (problem) throw new Error(problem);
        const current = await data.vault.settings(org.id);
        const { settings, key } = await createVault(pass, org.id);
        const keys = current?.keyIv && current.keyCipher ? await rewrapPrivateKey(session.key, key, { keyIv: current.keyIv, keyCipher: current.keyCipher }, org.id, session.userId) : {};
        const resealed = [];
        for (const b of await data.vault.exportAll(org.id)) {
          const value = await unseal(session.key, b, itemAad(org.id, b.id));
          resealed.push({ id: b.id, ...(await seal(key, value, itemAad(org.id, b.id))) });
        }
        await data.vault.rotate(org.id, { ...settings, ...keys }, resealed);
        session = { ...session, key };
      },
    });
    if (ok) toast('Frase-mestra trocada.', 'success');
  };

  bindActions(root, {
    lock: () => lock(),
    new: () => edit(null, {}),
    open: (el) => reveal(rowOf(el.dataset.id)),
    share: (el) => share(rowOf(el.dataset.id)),
    rotate: () => rotate(),
    remove: async (el) => {
      const row = rowOf(el.dataset.id);
      const extra = row.sharedWith.length ? ` A cópia de ${row.sharedWith.join(', ')} também some.` : '';
      if (!(await confirmDialog({ title: 'Excluir segredo?', message: `“${row.title}” sai do seu cofre para sempre.${extra}`, confirmLabel: 'Excluir', danger: true }))) return;
      try {
        await data.vault.remove(org.id, row.id);
        toast('Segredo excluído.', 'success');
        load();
      } catch (error) {
        toastError(error);
      }
    },
    drop: async (el) => {
      const row = rowOf(el.dataset.id);
      if (!(await confirmDialog({ title: 'Tirar do seu cofre?', message: `Você deixa de receber “${row.title}” de ${row.ownerName}. Para voltar, a pessoa compartilha de novo.`, confirmLabel: 'Tirar', danger: true }))) return;
      try {
        await data.vault.unshare(org.id, row.id);
        toast('Tirado do seu cofre.', 'success');
        load();
      } catch (error) {
        toastError(error);
      }
    },
  }, signal);

  await load();
}
