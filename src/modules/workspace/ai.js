// IA local do Caderno — tudo roda no navegador, em Web Workers:
//   transcrição: Whisper (transformers.js + ONNX Runtime; WebGPU quando há, senão WASM)
//   ata: modelo de linguagem pequeno (WebLLM; só com WebGPU)
// Os modelos vêm do Hugging Face na primeira vez e ficam no cache do navegador. O áudio e o texto
// da reunião nunca saem deste computador. Sem WebGPU (ou com a IA desligada) a ata sai por regras.

import { confirmDialog } from '../../shared/components/dialog.js';
import { toast } from '../../shared/components/feedback.js';

const LEVEL_KEY = 'dum.caderno.ai';
const ACCEPT_KEY = 'dum.caderno.ai.ok';

export const AI_LEVELS = /** @type {const} */ ([
  { key: 'full', label: 'Completa', hint: 'Melhor qualidade. Primeira vez: cerca de 3 GB (Whisper turbo + modelo de 4B). Precisa de placa de vídeo com uns 4 GB.' },
  { key: 'light', label: 'Leve', hint: 'Para PCs mais simples. Primeira vez: cerca de 1,6 GB (Whisper small + modelo de 2B).' },
  { key: 'off', label: 'Desligada', hint: 'Nada é baixado. Transcrição só colando o texto; ata por regras.' },
]);

/** @returns {'full' | 'light' | 'off'} */
export function aiLevel() {
  const v = localStorage.getItem(LEVEL_KEY);
  return v === 'light' || v === 'off' ? v : 'full';
}
/** @param {'full' | 'light' | 'off'} level */
export const setAiLevel = (level) => localStorage.setItem(LEVEL_KEY, level);

/** @type {Promise<{ webgpu: boolean, f16: boolean }> | null} */
let gpuInfo = null;
/** O navegador tem WebGPU (e meia precisão)? */
export function gpu() {
  gpuInfo ??= (async () => {
    try {
      const nav = /** @type {any} */ (navigator);
      const adapter = nav.gpu ? await nav.gpu.requestAdapter() : null;
      return { webgpu: Boolean(adapter), f16: Boolean(adapter?.features?.has('shader-f16')) };
    } catch {
      return { webgpu: false, f16: false };
    }
  })();
  return gpuInfo;
}

/** Pergunta uma vez por modelo antes do download grande. @param {'whisper' | 'llm' | 'embed'} which */
export const accepted = (which) => localStorage.getItem(`${ACCEPT_KEY}.${which}.${aiLevel()}`) === '1';
/** @param {'whisper' | 'llm' | 'embed'} which */
export const accept = (which) => localStorage.setItem(`${ACCEPT_KEY}.${which}.${aiLevel()}`, '1');

/** Apaga os modelos baixados (libera espaço). */
export async function clearModels() {
  const names = await caches.keys();
  await Promise.all(names.filter((n) => /transformers|webllm|onnx/i.test(n)).map((n) => caches.delete(n)));
  for (const key of Object.keys(localStorage)) if (key.startsWith(ACCEPT_KEY)) localStorage.removeItem(key);
  transcriber.reset();
  minutesModel.reset();
  embedder.reset();
}

/** Pergunta (uma vez) antes de baixar o Whisper (reuniões e ditado). */
export async function okToDownloadWhisper() {
  if (aiLevel() === 'off') {
    toast('A IA local está desligada. Ligue em Caderno › IA local.', 'info');
    return false;
  }
  if (accepted('whisper')) return true;
  const g = await gpu();
  const size = !g.webgpu ? 'cerca de 80 MB' : aiLevel() === 'light' ? 'cerca de 250 MB' : 'cerca de 600 MB';
  const ok = await confirmDialog({
    title: 'Baixar o modelo de transcrição?',
    message: `Na primeira vez o Master baixa o Whisper (${size}). Ele fica guardado neste navegador e roda aqui: o áudio não vai para nenhum servidor.${g.webgpu ? '' : ' Este navegador não tem WebGPU: a transcrição vai ser mais lenta.'}`,
    confirmLabel: 'Baixar e continuar',
  });
  if (ok) accept('whisper');
  return ok;
}

/** Quanto os modelos ocupam (aprox.). */
export async function storageUsed() {
  try {
    const est = await navigator.storage.estimate();
    return est.usage ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Cliente de um worker com pedidos numerados e progresso.
 * @param {URL} url
 */
function workerClient(url) {
  /** @type {Worker | null} */
  let worker = null;
  let seq = 0;
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void, onToken?: ((text: string) => void) | null }>} */
  const pending = new Map();
  /** @type {((p: any) => void) | null} */
  let progress = null;
  const fail = (/** @type {Error} */ error) => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  const ensure = () => {
    if (worker) return worker;
    worker = new Worker(url, { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') return progress?.(data);
      if (data.type === 'token') return pending.get(data.id)?.onToken?.(data.text);
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.ok) p.resolve(data.result);
      else p.reject(new Error(data.error || 'Falha na IA local.'));
    };
    worker.onerror = (e) => fail(new Error(e.message || 'A IA local parou.'));
    return worker;
  };
  return {
    /** @param {string} type @param {Record<string, any>} [payload] @param {Transferable[]} [transfer] @param {((text: string) => void) | null} [onToken] @returns {Promise<any>} */
    call(type, payload = {}, transfer = [], onToken = null) {
      const w = ensure();
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onToken });
        w.postMessage({ id, type, ...payload }, transfer);
      });
    },
    /** @param {((p: any) => void) | null} fn */
    onProgress(fn) {
      progress = fn;
    },
    reset() {
      fail(new Error('IA local reiniciada.'));
    },
  };
}

const transcriberWorker = workerClient(new URL('../../workers/transcriber.js', import.meta.url));
const embedWorker = workerClient(new URL('../../workers/embedder.js', import.meta.url));

let embedReady = false;
/**
 * Busca pelo sentido: modelo pequeno multilíngue de frases (~120 MB na 1ª vez), roda em WASM (não precisa de
 * placa de vídeo). Escolhido por separar bem no português: assunto certo ~0,35–0,5; sem relação < 0,2.
 */
export const embedder = {
  /** @param {(text: string, pct: number | null) => void} report */
  async load(report) {
    if (aiLevel() === 'off') throw new Error('A IA local está desligada (Caderno › IA local).');
    if (embedReady) return;
    embedWorker.onProgress(downloadTracker(report, 'busca'));
    await embedWorker.call('load', { model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' });
    embedReady = true;
  },
  /** @param {string[]} texts @returns {Promise<number[][]>} */
  embed(texts) {
    return embedWorker.call('embed', { texts: texts.map((t) => t.slice(0, 1500)) });
  },
  reset() {
    embedReady = false;
    embedWorker.reset();
  },
};
const minutesWorker = workerClient(new URL('../../workers/minutes-llm.js', import.meta.url));

/** Soma o progresso de vários arquivos baixados. */
function downloadTracker(/** @type {(text: string, pct: number | null) => void} */ report, label = 'transcrição') {
  /** @type {Map<string, { loaded: number, total: number }>} */
  const files = new Map();
  return (/** @type {any} */ p) => {
    if (p.status === 'progress' && p.file) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      const loaded = [...files.values()].reduce((s, f) => s + f.loaded, 0);
      const total = [...files.values()].reduce((s, f) => s + f.total, 0);
      if (total > 1_000_000) report(`Baixando o modelo de ${label}: ${Math.round((loaded / total) * 100)}% (${Math.round(loaded / 1e6)} de ${Math.round(total / 1e6)} MB) — só na primeira vez`, loaded / total);
    } else if (p.status === 'ready') report(`Modelo de ${label} pronto.`, 1);
  };
}

let whisperKey = '';
export const transcriber = {
  /**
   * Carrega o Whisper certo para este navegador.
   * @param {(text: string, pct: number | null) => void} report
   */
  async load(report) {
    const level = aiLevel();
    if (level === 'off') throw new Error('A IA local está desligada (Caderno › IA local).');
    const g = await gpu();
    const model = g.webgpu ? (level === 'light' ? 'onnx-community/whisper-small' : 'onnx-community/whisper-large-v3-turbo') : 'onnx-community/whisper-base';
    const device = g.webgpu ? 'webgpu' : 'wasm';
    const dtype = g.webgpu ? { encoder_model: g.f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' } : 'q8';
    const key = `${model}|${device}`;
    if (whisperKey === key) return;
    transcriberWorker.onProgress(downloadTracker(report));
    navigator.storage?.persist?.().catch(() => {});
    try {
      await transcriberWorker.call('load', { model, device, dtype });
    } catch (error) {
      if (device !== 'webgpu') throw error;
      // WebGPU falhou nesta máquina: cai para o modelo leve em WASM.
      transcriberWorker.reset();
      await transcriberWorker.call('load', { model: 'onnx-community/whisper-base', device: 'wasm', dtype: 'q8' });
    }
    whisperKey = key;
  },
  /**
   * @param {Float32Array} audio 16 kHz mono
   * @param {number} offset segundos desde o começo
   * @param {string | null} who
   * @returns {Promise<import('../../core/minutes.js').Segment[]>}
   */
  run(audio, offset, who) {
    return transcriberWorker.call('run', { audio, offset, who }, [audio.buffer]);
  },
  reset() {
    whisperKey = '';
    transcriberWorker.reset();
  },
};

let llmModel = '';
export const minutesModel = {
  /** @param {(text: string, pct: number | null) => void} report @returns {Promise<string>} nome do modelo */
  async load(report) {
    const level = aiLevel();
    if (level === 'off') throw new Error('A IA local está desligada.');
    const g = await gpu();
    if (!g.webgpu) throw new Error('Este navegador não tem WebGPU (use Chrome ou Edge atualizados).');
    const q = g.f16 ? 'q4f16_1' : 'q4f32_1';
    const prefer = level === 'light'
      ? [`Qwen3.5-2B-${q}-MLC`, `Qwen3-1.7B-${q}-MLC`, `Qwen2.5-1.5B-Instruct-${q}-MLC`]
      : [`Qwen3.5-4B-${q}-MLC`, `Qwen3-4B-${q}-MLC`, `Qwen2.5-3B-Instruct-${q}-MLC`];
    minutesWorker.onProgress((p) => report(p.text && /fetch|carreg|load/i.test(p.text) && p.progress < 1
      ? `Baixando o modelo da ata: ${Math.round((p.progress ?? 0) * 100)}% — só na primeira vez`
      : 'Preparando o modelo da ata…', p.progress ?? null));
    navigator.storage?.persist?.().catch(() => {});
    llmModel = await minutesWorker.call('load', { prefer });
    return llmModel;
  },
  /**
   * @param {{ role: 'system' | 'user', content: string }[]} messages
   * @param {object | null} schema   null = texto livre
   * @param {number} [maxTokens]
   * @param {((text: string) => void) | null} [onToken]   recebe o texto enquanto é escrito
   * @returns {Promise<string>}
   */
  chat(messages, schema, maxTokens = 900, onToken = null) {
    return minutesWorker.call('chat', { messages, schema, maxTokens, stream: Boolean(onToken) }, [], onToken);
  },
  reset() {
    llmModel = '';
    minutesWorker.reset();
  },
};
