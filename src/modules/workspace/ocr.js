// Ler texto de imagem e PDF no navegador: PDF pelo texto (pdf.js); imagem e PDF escaneado por OCR
// (Tesseract, português). Bibliotecas em assets/js/vendor (sem CDN); nada sai do computador.

import { html } from '../../shared/utils/dom.js';
import { openDialog } from '../../shared/components/dialog.js';
import { errorMessage } from '../../shared/components/feedback.js';

const VENDOR = (/** @type {string} */ path) => new URL(`../../../assets/js/vendor/${path}`, import.meta.url).href;
const MAX_PAGES = 30;
const OCR_PAGES = 10;

/** @typedef {(text: string, pct: number | null) => void} Status */

/** @type {Promise<any> | null} */
let ocr = null;
/** @type {Status | null} */
let ocrStatus = null;

/** Leitor de imagem (carrega uma vez: ~3 MB do leitor + 2,4 MB do português). */
function ocrWorker() {
  ocr ??= (async () => {
    const T = (await import(VENDOR('ocr/tesseract.esm.min.js'))).default;
    return T.createWorker('por', 1, {
      workerPath: VENDOR('ocr/worker.min.js'),
      corePath: VENDOR('ocr'),
      langPath: VENDOR('ocr'),
      gzip: false,
      workerBlobURL: false,
      logger: (/** @type {any} */ m) =>
        ocrStatus?.(m.status === 'recognizing text' ? `Lendo o texto: ${Math.round((m.progress ?? 0) * 100)}%` : 'Preparando o leitor de imagem…', m.status === 'recognizing text' ? m.progress ?? 0 : null),
    });
  })().catch((error) => {
    ocr = null;
    throw error;
  });
  return ocr;
}

/** @param {any} input imagem, canvas ou arquivo @param {Status} [onStatus] */
async function imageText(input, onStatus) {
  ocrStatus = onStatus ?? null;
  const worker = await ocrWorker();
  const { data } = await worker.recognize(input);
  return String(data?.text ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** @param {File | Blob} file @param {Status} [onStatus] */
async function pdfText(file, onStatus) {
  const pdfjs = await import(VENDOR('pdf/pdf.min.js'));
  pdfjs.GlobalWorkerOptions.workerSrc = VENDOR('pdf/pdf.worker.min.js');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const total = Math.min(doc.numPages, MAX_PAGES);
  const out = [];
  for (let i = 1; i <= total; i += 1) {
    onStatus?.(`Lendo a página ${i} de ${total}…`, (i - 1) / total);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = content.items.map((/** @type {any} */ it) => `${it.str ?? ''}${it.hasEOL ? '\n' : ''}`).join('').trim();
    // Página sem texto (escaneada): desenha e usa o OCR.
    if (text.length < 20 && i <= OCR_PAGES) {
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')), canvas, viewport }).promise;
      text = await imageText(canvas, (s, p) => onStatus?.(`Página ${i} (escaneada): ${s.toLowerCase()}`, p));
    }
    if (text) out.push(total > 1 ? `Página ${i}\n${text}` : text);
  }
  if (doc.numPages > MAX_PAGES) out.push(`(lidas as primeiras ${MAX_PAGES} de ${doc.numPages} páginas)`);
  return out.join('\n\n');
}

/** Texto de uma imagem ou PDF. @param {File | Blob} file @param {Status} [onStatus] */
export async function extractText(file, onStatus) {
  const name = 'name' in file ? String(file.name) : '';
  if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) return pdfText(file, onStatus);
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(name)) return imageText(file, onStatus);
  throw new Error('Use uma imagem (PNG, JPG, WEBP) ou um PDF.');
}

/** Lê o arquivo mostrando o progresso; a pessoa revisa e devolve o texto (ou null). @param {File | Blob} file @param {string} name */
export async function extractDialog(file, name) {
  let busy = true;
  let failed = '';
  let text = '';
  const done = openDialog({
    title: `Texto de ${name}`,
    description: 'Lido aqui no seu computador: PDF pelo texto, imagem ou PDF escaneado por OCR. Revise antes de usar.',
    wide: true,
    body: html`<div class="aiw">
      <div class="aiw__bar"><span class="aiw__status" data-st><span class="aiw__dot" aria-hidden="true"></span><span data-st-text>Abrindo o arquivo…</span></span></div>
      <span class="aiw__progress" data-pr hidden><span></span></span>
      <textarea class="input aiw__text is-writing" name="text" rows="13" readonly aria-label="Texto lido"></textarea>
    </div>`,
    submitLabel: 'Inserir na página',
    onSubmit: (form) => {
      if (busy) throw new Error('Espere terminar a leitura.');
      if (failed) throw new Error(failed);
      text = String(form.get('text') ?? '').trim();
      if (!text) throw new Error('Nenhum texto encontrado neste arquivo.');
    },
  });
  const dialog = /** @type {HTMLElement} */ ([...document.querySelectorAll('dialog[open]')].at(-1));
  const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (dialog.querySelector(s));
  const area = /** @type {HTMLTextAreaElement} */ ($('textarea'));
  const bar = $('[data-pr]');
  const status = (/** @type {string} */ s, /** @type {number | null} */ pct, tone = '') => {
    $('[data-st-text]').textContent = s;
    $('[data-st]').dataset.tone = tone;
    bar.hidden = pct === null;
    /** @type {HTMLElement} */ (bar.firstElementChild).style.width = `${Math.round((pct ?? 0) * 100)}%`;
  };
  try {
    const out = await extractText(file, (s, p) => status(s, p));
    area.value = out;
    const words = out.split(/\s+/).filter(Boolean).length;
    status(out ? `Pronto · ${words} palavra${words === 1 ? '' : 's'} · pode editar` : 'Nenhum texto encontrado.', null, out ? 'ok' : 'error');
  } catch (error) {
    failed = errorMessage(error);
    status(failed, null, 'error');
  } finally {
    busy = false;
    area.readOnly = false;
    area.classList.remove('is-writing');
  }
  return (await done) ? text : null;
}

/** Abre o seletor de arquivo (imagem ou PDF). @returns {Promise<File | null>} */
export function pickFile() {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*,application/pdf,.pdf' });
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
