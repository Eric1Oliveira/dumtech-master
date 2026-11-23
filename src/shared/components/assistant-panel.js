// Painel de conversa do DUM AI (abre pela barra do topo, em qualquer tela).
// A conversa fica só na memória desta aba: some ao trocar de organização ou sair.

import { html, setHtml, createElement, $ } from '../utils/dom.js';
import { events } from '../../core/events.js';
import { getState } from '../../core/state.js';
import { icon } from './icons.js';

/** @typedef {import('../../services/assistant.js').Reply} Reply */
/** @typedef {{ from: 'me', text: string } | { from: 'bot', reply: Reply }} Message */

/** @type {Message[]} */
let messages = [];
/** @type {HTMLElement | null} */
let panel = null;
let busy = false;

const MOBILE = window.matchMedia('(max-width: 640px)');

events.on('org:changed', () => (messages = []));
events.on('session:changed', () => {
  messages = [];
  closeAssistant();
});

/** @param {Reply} reply */
const replyHtml = (reply) => html`
  <p>${reply.text}</p>
  ${reply.items?.length
    ? html`<ul class="bot__items">${reply.items.map(
        (i) => html`<li class="bot__item ${i.tone ? `bot__item--${i.tone}` : ''}">
          ${i.href ? html`<a href="${i.href}">${i.label}</a>` : html`<span>${i.label}</span>`}
          ${i.sub ? html`<small>${i.sub}</small>` : ''}
        </li>`,
      )}</ul>`
    : ''}
  ${reply.items?.length || reply.text ? html`<button type="button" class="chip-btn bot__ai" data-explain>Explicar com IA</button>` : ''}
  ${reply.suggestions?.length
    ? html`<div class="bot__chips">${reply.suggestions.map((s) => html`<button type="button" class="chip-btn" data-ask="${s}">${s}</button>`)}</div>`
    : ''}`;

function drawMessages() {
  const list = panel && $('[data-messages]', panel);
  if (!list) return;
  setHtml(
    list,
    html`${messages.map((m) =>
      m.from === 'me'
        ? html`<div class="msg msg--me"><p>${m.text}</p></div>`
        : html`<div class="msg msg--bot">${replyHtml(m.reply)}</div>`,
    )}
    ${busy ? html`<div class="msg msg--bot msg--busy" aria-label="Consultando">Consultando os dados…</div>` : ''}`,
  );
  list.scrollTop = list.scrollHeight;
}

/** @param {string} question */
async function ask(question) {
  const text = question.trim();
  if (!text || busy) return;
  messages.push({ from: 'me', text });
  busy = true;
  drawMessages();
  const { answer } = await import('../../services/assistant.js');
  const reply = await answer(text);
  busy = false;
  messages.push({ from: 'bot', reply });
  drawMessages();
}

/** IA local explica a resposta (só com os dados já mostrados). @param {Element | null} msg */
async function explain(msg) {
  const i = [...(panel?.querySelectorAll('.msg') ?? [])].indexOf(/** @type {Element} */ (msg));
  const reply = /** @type {any} */ (messages[i])?.reply;
  const question = [...messages.slice(0, i)].reverse().find((m) => m.from === 'me')?.text ?? '';
  if (!reply) return;
  const facts = [reply.text, ...(reply.items ?? []).map((/** @type {any} */ x) => [x.label, x.sub].filter(Boolean).join(' — '))].filter(Boolean).slice(0, 25);
  const { aiWrite } = await import('./ai-write.js');
  const { explainMessages } = await import('../../core/ai-prompts.js');
  await aiWrite(explainMessages(question, facts), { title: 'Explicação da IA', useLabel: 'Fechar', readOnly: true, maxTokens: 450 });
}

/** Abre o painel (opcionalmente já perguntando algo). @param {string} [question] */
export async function openAssistant(question) {
  if (!panel) {
    panel = createElement(html`
      <aside class="assistant" aria-label="DUM AI" role="complementary">
        <header class="assistant__head">
          <div>
            <p class="assistant__title">${icon('message')} DUM AI</p>
            <p class="assistant__sub">Assistente por regras · responde com o que o seu papel em ${getState().org?.name ?? ''} pode ver</p>
          </div>
          <button type="button" class="icon-btn" data-close aria-label="Fechar o DUM AI">${icon('x')}</button>
        </header>
        <div class="assistant__messages" data-messages aria-live="polite"></div>
        <form class="assistant__form" novalidate>
          <label class="sr-only" for="assistant-input">Pergunta</label>
          <input class="input" id="assistant-input" name="question" autocomplete="off" maxlength="300" placeholder="Pergunte: tarefas atrasadas, propostas abertas…">
          <button type="submit" class="btn btn--primary" aria-label="Enviar pergunta">${icon('arrowRight')}</button>
        </form>
      </aside>`);
    document.body.append(panel);
    panel.addEventListener('click', (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      const chip = /** @type {HTMLElement | null} */ (target.closest('[data-ask]'));
      if (chip) ask(chip.dataset.ask);
      else if (target.closest('[data-explain]')) explain(target.closest('.msg'));
      else if (target.closest('[data-close]')) closeAssistant();
      else if (target.closest('a[href^="#/"]') && MOBILE.matches) closeAssistant();
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeAssistant();
    });
    const form = /** @type {HTMLFormElement} */ ($('form', panel));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = /** @type {HTMLInputElement} */ (form.elements.namedItem('question'));
      const text = input.value;
      input.value = '';
      ask(text);
    });
    document.querySelector('[data-action="assistant"]')?.setAttribute('aria-expanded', 'true');
    if (!messages.length) {
      const { answer } = await import('../../services/assistant.js');
      messages.push({ from: 'bot', reply: await answer('ajuda') });
    }
    drawMessages();
  }
  /** @type {HTMLInputElement} */ ($('#assistant-input', panel)).focus();
  if (question) ask(question);
}

export function closeAssistant() {
  panel?.remove();
  panel = null;
  document.querySelector('[data-action="assistant"]')?.setAttribute('aria-expanded', 'false');
}

export const toggleAssistant = () => (panel ? closeAssistant() : openAssistant());
