// Ditado: grava o microfone até a pessoa clicar em "Parar" e transcreve com o Whisper local.
// Usado no "adicionar rápido" de tarefas e nas páginas do Caderno. O áudio não sai do computador.

import { html } from '../../shared/utils/dom.js';
import { openDialog } from '../../shared/components/dialog.js';
import { formatClock, cleanSegments } from '../../core/minutes.js';
import { startRecording } from './recorder.js';
import { transcriber, okToDownloadWhisper } from './ai.js';

/** @param {{ title?: string, hint?: string }} [options] @returns {Promise<string | null>} */
export async function dictate({ title = 'Ditar', hint = 'Fale normalmente e clique em "Parar e usar" quando terminar.' } = {}) {
  if (!(await okToDownloadWhisper())) return null;
  /** @type {{ audio: Float32Array, offset: number, who: string | null }[]} */
  let chunks = [];
  /** @type {Awaited<ReturnType<typeof startRecording>> | null} */
  let rec = null;
  let text = '';
  /** @type {HTMLElement | null} */
  let dialog = null;
  const $ = (/** @type {string} */ s) => /** @type {HTMLElement | null} */ (dialog?.querySelector(s) ?? null);
  const setStatus = (/** @type {string} */ s) => {
    const el = $('[data-dict-status]');
    if (el) el.textContent = s;
  };
  // Começa a carregar o modelo enquanto a pessoa fala.
  const loading = transcriber.load((s) => setStatus(s)).catch((e) => e);
  const start = () =>
    startRecording({
      call: null,
      onChunk: (c) => chunks.push(c),
      onLevel: (v) => {
        const el = $('[data-dict-level]');
        if (el) el.style.transform = `scaleX(${Math.max(0.04, v)})`;
      },
    });
  rec = await start();
  const timer = setInterval(() => {
    const el = $('[data-dict-time]');
    if (el && rec) el.textContent = formatClock(rec.elapsed());
  }, 500);
  const done = openDialog({
    title,
    description: `${hint} O áudio fica só no seu computador.`,
    body: html`<div class="dict" role="status">
        <span class="mt-rec__dot" aria-hidden="true"></span>
        <span class="mono" data-dict-time>00:00</span>
        <span class="mt-level dict__level" aria-hidden="true"><span data-dict-level></span></span>
      </div>
      <p class="dict__status" data-dict-status>Ouvindo…</p>`,
    submitLabel: 'Parar e usar',
    onSubmit: async () => {
      setStatus('Transcrevendo…');
      if (rec) await rec.stop();
      rec = null;
      const ready = await loading;
      if (ready instanceof Error) throw ready;
      const parts = [];
      for (const c of chunks) parts.push(...(await transcriber.run(c.audio, c.offset, null)));
      text = cleanSegments(parts).map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
      if (!text) {
        chunks = [];
        rec = await start();
        setStatus('Ouvindo de novo…');
        throw new Error('Não entendi nada. Fale de novo e clique em "Parar e usar".');
      }
    },
  });
  dialog = /** @type {HTMLElement} */ ([...document.querySelectorAll('dialog[open]')].at(-1));
  const ok = await done;
  clearInterval(timer);
  if (rec) await rec.stop();
  return ok ? text : null;
}
