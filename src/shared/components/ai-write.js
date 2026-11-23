// Janela "Gerar com IA" (IA local, no navegador): carrega o modelo, gera o texto, mostra para
// revisar/editar e devolve o texto final (ou null). Usada no Caderno, propostas, cobrança, Hoje e DUM AI.

import { html, setHtml } from '../utils/dom.js';
import { openDialog, confirmDialog } from './dialog.js';
import { toast, errorMessage } from './feedback.js';
import { cleanAi } from '../../core/ai-prompts.js';

/** @typedef {import('../../core/ai-prompts.js').Msg} Msg */

const ai = () => import('../../modules/workspace/ai.js');

/** Dá para usar a IA neste navegador? (WebGPU e IA local ligada) */
export async function aiReady() {
  const m = await ai();
  return m.aiLevel() !== 'off' && (await m.gpu()).webgpu;
}

/** Gera sem mostrar janela (para quem trata o resultado). @param {Msg[]} messages @param {{ schema?: object | null, maxTokens?: number, onStatus?: (t: string) => void }} [o] */
export async function aiRun(messages, { schema = null, maxTokens = 700, onStatus } = {}) {
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
  await m.minutesModel.load((text) => onStatus?.(text));
  onStatus?.('Escrevendo…');
  return cleanAi(await m.minutesModel.chat(messages, schema, maxTokens));
}

/**
 * Gera e abre a revisão. Devolve o texto aprovado (editável) ou null.
 * @param {Msg[]} messages
 * @param {{ title: string, useLabel?: string, maxTokens?: number, readOnly?: boolean, extra?: (text: string) => any }} options
 */
export async function aiWrite(messages, { title, useLabel = 'Usar este texto', maxTokens = 700, readOnly = false, extra }) {
  /** @type {string | null} */
  let result = null;
  let failed = '';
  let finalText = '';
  const done = openDialog({
    title,
    description: 'IA local: roda no seu computador. Revise antes de usar.',
    wide: true,
    body: html`<div class="aiw" data-aiw><p class="aiw__status" data-aiw-status>Preparando a IA…</p><div class="skeleton"></div></div>`,
    submitLabel: useLabel,
    onSubmit: (form) => {
      if (failed) throw new Error(failed);
      const text = String(form.get('text') ?? finalText).trim();
      if (!text) throw new Error('Ainda não há texto. Espere a IA terminar.');
      finalText = text;
    },
  });
  const dialog = /** @type {HTMLElement | null} */ ([...document.querySelectorAll('dialog[open]')].at(-1) ?? null);
  const box = dialog?.querySelector('[data-aiw]');
  const submit = /** @type {HTMLButtonElement | null} */ (dialog?.querySelector('[type=submit]') ?? null);
  if (submit) submit.disabled = true;
  try {
    result = await aiRun(messages, { maxTokens, onStatus: (t) => { const s = box?.querySelector('[data-aiw-status]'); if (s) s.textContent = t; } });
    if (result === null) {
      /** @type {HTMLDialogElement | null} */ (/** @type {any} */ (dialog))?.close();
      return null;
    }
    finalText = result;
    if (box) {
      setHtml(/** @type {HTMLElement} */ (box), html`${readOnly
        ? html`<div class="aiw__out prewrap">${result}</div>`
        : html`<textarea class="input aiw__text" name="text" rows="12">${result}</textarea>`}
        ${extra ? extra(result) : ''}`);
    }
  } catch (error) {
    failed = errorMessage(error);
    if (box) setHtml(/** @type {HTMLElement} */ (box), html`<p class="notice notice--warn">${failed}</p>`);
  } finally {
    if (submit) submit.disabled = Boolean(failed);
  }
  const ok = await done;
  if (!ok) return null;
  if (failed) toast(failed, 'danger');
  return finalText || null;
}
