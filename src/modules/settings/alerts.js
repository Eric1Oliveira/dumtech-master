// Ajustes › Avisos no Telegram: liga o Telegram. Site fora do ar (e quando volta), cobranças do dia e
// vencimentos chegam no celular, mesmo com o sistema fechado. O token do bot fica só no servidor;
// o navegador usa o token uma vez, para achar a conversa (api.telegram.org, liberado na CSP).

import { html, setHtml, $, bindActions } from '../../shared/utils/dom.js';
import { getState } from '../../core/state.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { confirmDialog } from '../../shared/components/dialog.js';
import { loadError, toast, toastError, errorMessage } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';

const TOKEN = /^[0-9]{5,}:[A-Za-z0-9_-]{30,}$/;

/** Conversas que já mandaram mensagem para o bot. @param {string} token */
async function findChats(token) {
  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token).replace('%3A', ':')}/getUpdates`, { signal: AbortSignal.timeout(10000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(res.status === 401 ? 'O Telegram não reconheceu este token. Copie de novo do @BotFather.' : 'O Telegram não respondeu. Tente de novo.');
  /** @type {Map<string, string>} */
  const chats = new Map();
  for (const u of body.result ?? []) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
    if (chat?.id) chats.set(String(chat.id), chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(' ') ?? chat.username ?? String(chat.id));
  }
  return [...chats].map(([id, name]) => ({ id, name }));
}

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, signal }) {
  const { org } = getState();
  const admin = canDo('org.update');
  let status;
  try {
    status = await data.telegram.status(org.id);
  } catch (error) {
    if (!signal.aborted) setHtml(root, loadError(error));
    return;
  }
  if (signal.aborted) return;

  const intro = html`<ul class="vault-points">
    <li>${icon('alert')}<span>Site ou banco <strong>fora do ar</strong>, e quando voltam, na hora.</span></li>
    <li>${icon('wallet')}<span><strong>Cobranças do dia</strong>, às 8h: quem vence hoje e quem está atrasado.</span></li>
    <li>${icon('calendar')}<span><strong>Vencimentos</strong> de domínio, hospedagem e serviços (30, 7 e 1 dia antes).</span></li>
  </ul>`;

  if (status.configured) {
    setHtml(
      root,
      html`<section class="panel" aria-labelledby="tg-title">
        <header class="panel__head">
          <div><h2 class="panel__title" id="tg-title">Avisos no Telegram</h2>
            <p class="panel__hint"><span class="avail"><span class="status-dot status-dot--ok" aria-hidden="true"></span>Ligado${status.chat ? ` · chegam para ${status.chat}` : ''}</span></p></div>
          ${admin
            ? html`<div class="panel__tools">
                <button type="button" class="btn btn--secondary btn--sm" data-action="test">${icon('send')}<span>Enviar teste</span></button>
                <button type="button" class="btn btn--ghost btn--sm" data-action="off">Desligar</button>
              </div>`
            : ''}
        </header>
        ${intro}
        <p class="panel__hint detail-text--flush">As rotinas das 8h ficam em Ajustes › Automações: deixe “Cobranças do dia” e “Vencimentos” ligadas.</p>
      </section>`,
    );
  } else {
    setHtml(
      root,
      html`<section class="panel" aria-labelledby="tg-title">
        <header class="panel__head"><div><h2 class="panel__title" id="tg-title">Avisos no Telegram</h2>
          <p class="panel__hint">Desligado. Leva 2 minutos e é grátis.</p></div></header>
        ${intro}
        ${admin
          ? html`<form class="tg-setup" id="tg-form" novalidate>
              <ol class="steps">
                <li>No Telegram, abra o <strong>@BotFather</strong>, mande <code>/newbot</code> e escolha um nome (ex.: DUMTech Avisos). Ele responde com o <strong>token</strong>.</li>
                <li><label class="field"><span class="field__label">Cole o token aqui</span>
                  <input class="input mono" name="token" autocomplete="off" spellcheck="false" placeholder="123456789:AA..."></label></li>
                <li>Abra o seu bot no Telegram (o link vem na resposta do @BotFather) e mande <strong>oi</strong>.</li>
                <li><button type="button" class="btn btn--secondary btn--sm" data-action="find">${icon('search')}<span>Procurar a conversa</span></button>
                  <div data-chats></div></li>
              </ol>
              <p class="form-error" role="alert" hidden></p>
            </form>`
          : html`<p class="notice">Quem administra a organização liga os avisos.</p>`}
      </section>`,
    );
  }

  const form = /** @type {HTMLFormElement | null} */ ($('#tg-form', root));
  const fail = (/** @type {unknown} */ error) => {
    const box = /** @type {HTMLElement | null} */ (form && $('.form-error', form));
    if (!box) return toastError(error);
    box.textContent = errorMessage(error);
    box.hidden = false;
  };
  const tokenOf = () => String(new FormData(/** @type {HTMLFormElement} */ (form)).get('token') ?? '').trim();

  bindActions(root, {
    find: async (el) => {
      const button = /** @type {HTMLButtonElement} */ (el);
      const box = /** @type {HTMLElement} */ ($('.form-error', /** @type {HTMLFormElement} */ (form)));
      box.hidden = true;
      const token = tokenOf();
      if (!TOKEN.test(token)) return fail(new Error('Cole o token inteiro que o @BotFather mandou (números, dois-pontos e letras).'));
      button.disabled = true;
      try {
        const chats = await findChats(token);
        const slot = /** @type {HTMLElement} */ ($('[data-chats]', root));
        setHtml(
          slot,
          chats.length
            ? html`<div class="pick-list tg-chats">${chats.map(
                (c) => html`<label class="pick"><input type="radio" name="chat" value="${c.id}" data-name="${c.name}" ${chats.length === 1 ? html`checked` : ''}>
                  <span class="pick__body"><strong>${c.name}</strong><small>conversa ${c.id}</small></span></label>`,
              )}</div>
              <button type="button" class="btn btn--primary btn--sm" data-action="save">${icon('check')}<span>Ligar os avisos</span></button>`
            : html`<p class="notice">Nenhuma mensagem chegou ao bot ainda. Mande “oi” para ele no Telegram e procure de novo.</p>`,
        );
      } catch (error) {
        fail(error);
      } finally {
        button.disabled = false;
      }
    },
    save: async (el) => {
      const chosen = /** @type {HTMLInputElement | null} */ (root.querySelector('input[name=chat]:checked'));
      if (!chosen) return fail(new Error('Escolha a conversa que vai receber os avisos.'));
      /** @type {HTMLButtonElement} */ (el).disabled = true;
      try {
        await data.telegram.set(org.id, { token: tokenOf(), chatId: chosen.value, chatName: chosen.dataset.name ?? '' });
        await data.telegram.test(org.id);
        toast('Avisos ligados. Uma mensagem de teste foi para o Telegram.', 'success');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (error) {
        /** @type {HTMLButtonElement} */ (el).disabled = false;
        fail(error);
      }
    },
    test: async () => {
      try {
        toast((await data.telegram.test(org.id)) ? 'Mensagem de teste enviada. Confira o Telegram.' : 'O servidor não conseguiu enviar (pg_net desligado?).', 'info');
      } catch (error) {
        toastError(error);
      }
    },
    off: async () => {
      if (!(await confirmDialog({ title: 'Desligar os avisos?', message: 'O Telegram deixa de receber quedas, cobranças e vencimentos. O sininho continua.', confirmLabel: 'Desligar', danger: true }))) return;
      try {
        await data.telegram.set(org.id, null);
        toast('Avisos no Telegram desligados.', 'success');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (error) {
        toastError(error);
      }
    },
  }, signal);
}
