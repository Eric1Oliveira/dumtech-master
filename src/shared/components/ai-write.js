// Janela "Gerar com IA" (IA local, no navegador): carrega o modelo, escreve o texto AO VIVO (aparece
// enquanto é gerado), deixa copiar, gerar de novo e editar, e devolve o texto final (ou null).
// Usada no Caderno, propostas, cobrança, Hoje, projeto, cliente e DUM AI.

import { html, setHtml } from '../utils/dom.js';
import { openDialog, confirmDialog } from './dialog.js';
import { toast, errorMessage } from './feedback.js';
import { icon } from './icons.js';
import { cleanAi } from '../../core/ai-prompts.js';
import { whatsappLink } from '../../core/customers.js';

/** @typedef {import('../../core/ai-prompts.js').Msg} Msg */

const ai = () => import('../../modules/workspace/ai.js');

/** Dá para usar a IA neste navegador? (WebGPU e IA local ligada) */
export async function aiReady() {
  const m = await ai();
  return m.aiLevel() !== 'off' && (await m.gpu()).webgpu;
}

/**
 * Entrega o texto aprovado: abre o WhatsApp do cliente com ele ou, sem telefone, copia.
 * @param {string} text @param {string | null | undefined} phone
 */
export async function sendText(text, phone) {
  const link = whatsappLink(phone ?? null);
  if (link) {
    window.open(`${link}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Texto copiado. Cole onde for mandar.', 'success');
  } catch {
    toast('Não consegui copiar. Selecione o texto e use Ctrl+C.', 'info');
  }
}

/**
 * Gera sem janela própria. Devolve null se a pessoa não quis baixar o modelo.
 * @param {Msg[]} messages
 * @param {{ schema?: object | null, maxTokens?: number, onStatus?: (text: string, pct: number | null) => void, onToken?: ((text: string) => void) | null }} [o]
 */
export async function aiRun(messages, { schema = null, maxTokens = 700, onStatus, onToken = null } = {}) {
  const m = await ai();
  if (m.aiLevel() === 'off') throw new Error('A IA local está desligada (Caderno › IA local).');
  if (!(await m.gpu()).webgpu) throw new Error('Este navegador não tem WebGPU. Use Chrome ou Edge atualizados num PC com placa de vídeo.');
  if (!m.accepted('llm')) {
    const ok = await confirmDialog({
      title: 'Baixar o modelo de IA?',
      message: `Na primeira vez o Master baixa um modelo de IA (${m.aiLevel() === 'light' ? 'cerca de 1,4 GB' : 'cerca de 2,4 GB'}). Ele roda aqui no navegador: nada do que você escreve vai para servidor nenhum.`,
      confirmLabel: 'Baixar e continuar',
    });
    if (!ok) return null;
    m.accept('llm');
  }
  await m.minutesModel.load((text, pct) => onStatus?.(text, pct));
  onStatus?.('Escrevendo…', null);
  return cleanAi(await m.minutesModel.chat(messages, schema, maxTokens, onToken));
}

/**
 * Gera e abre a revisão. Devolve o texto aprovado (editável) ou null.
 * @param {Msg[]} messages
 * @param {{ title: string, useLabel?: string, maxTokens?: number, readOnly?: boolean, extra?: (text: string) => any }} options
 */
export async function aiWrite(messages, { title, useLabel = 'Usar este texto', maxTokens = 700, readOnly = false, extra }) {
  let failed = '';
  let finalText = '';
  let busy = false;
  let declined = false;
  const done = openDialog({
    title,
    description: 'IA local: roda no seu computador. Revise antes de usar.',
    wide: true,
    body: html`<div class="aiw">
      <div class="aiw__bar">
        <span class="aiw__status" data-aiw-status><span class="aiw__dot" aria-hidden="true"></span><span data-aiw-text>Preparando a IA…</span></span>
        <span class="aiw__tools">
          <button type="button" class="btn btn--ghost btn--sm" data-aiw="copy" disabled>${icon('copy')}<span>Copiar</span></button>
          <button type="button" class="btn btn--ghost btn--sm" data-aiw="again" disabled>${icon('refresh')}<span>Gerar de novo</span></button>
        </span>
      </div>
      <span class="aiw__progress" data-aiw-progress hidden><span></span></span>
      ${readOnly
        ? html`<div class="aiw__out prewrap is-writing" data-aiw-out aria-live="polite"></div>`
        : html`<textarea class="input aiw__text is-writing" name="text" rows="13" data-aiw-out readonly aria-label="Texto gerado"></textarea>`}
      <div data-aiw-extra></div>
    </div>`,
    submitLabel: useLabel,
    onSubmit: (form) => {
      if (busy) throw new Error('Espere a IA terminar de escrever.');
      if (failed) throw new Error(failed);
      const text = readOnly ? finalText : String(form.get('text') ?? '').trim();
      if (!text) throw new Error('Ainda não há texto.');
      finalText = text;
    },
  });
  const dialog = /** @type {HTMLDialogElement} */ ([...document.querySelectorAll('dialog[open]')].at(-1));
  const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (dialog.querySelector(s));
  const out = /** @type {HTMLTextAreaElement | HTMLElement} */ ($('[data-aiw-out]'));
  const submit = /** @type {HTMLButtonElement} */ ($('[type=submit]'));
  const tools = /** @type {HTMLButtonElement[]} */ ([...dialog.querySelectorAll('[data-aiw]')]);
  const bar = $('[data-aiw-progress]');
  const show = (/** @type {string} */ text) => {
    if ('value' in out) out.value = text;
    else out.textContent = text;
    out.scrollTop = out.scrollHeight;
  };
  const status = (/** @type {string} */ text, /** @type {number | null} */ pct = null, tone = '') => {
    $('[data-aiw-text]').textContent = text;
    $('[data-aiw-status]').dataset.tone = tone;
    bar.hidden = pct === null;
    /** @type {HTMLElement} */ (bar.firstElementChild).style.width = `${Math.round((pct ?? 0) * 100)}%`;
  };

  const generate = async () => {
    busy = true;
    failed = '';
    submit.disabled = true;
    tools.forEach((b) => (b.disabled = true));
    out.classList.add('is-writing');
    if ('readOnly' in out) out.readOnly = true;
    show('');
    try {
      const text = await aiRun(messages, { maxTokens, onStatus: status, onToken: (t) => show(cleanAi(t)) });
      if (text === null) {
        declined = true;
        dialog.close();
        return;
      }
      finalText = text;
      show(text);
      const words = text.split(/\s+/).filter(Boolean).length;
      status(`Pronto · ${words} palavra${words === 1 ? '' : 's'}${readOnly ? '' : ' · pode editar'}`, null, 'ok');
      if (extra) setHtml($('[data-aiw-extra]'), html`${extra(text)}`);
    } catch (error) {
      failed = errorMessage(error);
      status(failed, null, 'error');
    } finally {
      busy = false;
      out.classList.remove('is-writing');
      if ('readOnly' in out) out.readOnly = false;
      submit.disabled = Boolean(failed);
      tools.forEach((b) => (b.disabled = Boolean(failed) && b.dataset.aiw === 'copy'));
    }
  };
  dialog.addEventListener('click', async (e) => {
    const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-aiw]'));
    if (!btn || busy) return;
    if (btn.dataset.aiw === 'again') return generate();
    const text = 'value' in out ? out.value : finalText;
    try {
      await navigator.clipboard.writeText(text);
      toast('Texto copiado.', 'success');
    } catch {
      toast('Não consegui copiar. Selecione o texto e use Ctrl+C.', 'info');
    }
  });
  generate();
  const ok = await done;
  if (!ok || declined) return null;
  return finalText || null;
}
