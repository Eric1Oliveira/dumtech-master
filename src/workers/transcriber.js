// Worker de transcrição (Whisper no navegador). Recebe áudio 16 kHz mono e devolve trechos com tempo.
// Biblioteca local em assets/js/vendor/ai (transformers.js + ONNX Runtime), sem CDN.

// @ts-nocheck — worker (escopo de worker, não de janela).
const VENDOR = new URL('../../assets/js/vendor/ai/', import.meta.url).href;
// A biblioteca carrega em paralelo; o ouvinte já existe (nenhuma mensagem se perde).
const lib = import(`${VENDOR}transformers.min.js`).then((m) => {
  m.env.allowLocalModels = false;
  m.env.useBrowserCache = true;
  m.env.backends.onnx.wasm.wasmPaths = VENDOR;
  if (!self.crossOriginIsolated) m.env.backends.onnx.wasm.numThreads = 1;
  return m;
});

/** @type {any} */
let asr = null;
let loaded = '';

/** @param {number} id @param {any} result */
const reply = (id, result) => self.postMessage({ id, ok: true, result });

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      const key = `${data.model}|${data.device}`;
      if (asr && loaded === key) return reply(id, true);
      await asr?.dispose?.();
      const { pipeline } = await lib;
      asr = await pipeline('automatic-speech-recognition', data.model, {
        device: data.device,
        dtype: data.dtype,
        progress_callback: (/** @type {any} */ p) =>
          self.postMessage({ type: 'progress', status: p.status, file: p.file, loaded: p.loaded, total: p.total, progress: p.progress }),
      });
      loaded = key;
      return reply(id, true);
    }
    if (type === 'run') {
      if (!asr) throw new Error('Modelo de transcrição não carregado.');
      /** @type {Float32Array} */
      const audio = data.audio;
      const out = await asr(audio, { language: 'portuguese', task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
      const chunks = Array.isArray(out?.chunks) && out.chunks.length ? out.chunks : [{ timestamp: [0, audio.length / 16000], text: out?.text ?? '' }];
      const segments = chunks
        .map((/** @type {any} */ c) => ({
          s: Math.round((data.offset + (c.timestamp?.[0] ?? 0)) * 10) / 10,
          e: Math.round((data.offset + (c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0)) * 10) / 10,
          who: data.who ?? null,
          text: String(c.text ?? '').trim(),
        }))
        .filter((/** @type {any} */ s) => s.text);
      return reply(id, segments);
    }
    throw new Error(`Pedido desconhecido: ${type}`);
  } catch (error) {
    self.postMessage({ id, ok: false, error: /** @type {Error} */ (error)?.message || String(error) });
  }
};
