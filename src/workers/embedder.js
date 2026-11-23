// @ts-nocheck — worker (escopo de worker, não de janela).
// Busca pelo sentido: transforma textos em vetores (paraphrase-multilingual-MiniLM-L12-v2, WASM) para comparar
// a pergunta com as páginas mesmo sem as mesmas palavras. Roda no navegador; nada sai daqui.
const VENDOR = new URL('../../assets/js/vendor/ai/', import.meta.url).href;
const lib = import(`${VENDOR}transformers.min.js`).then((m) => {
  m.env.allowLocalModels = false;
  m.env.useBrowserCache = true;
  m.env.backends.onnx.wasm.wasmPaths = VENDOR;
  if (!self.crossOriginIsolated) m.env.backends.onnx.wasm.numThreads = 1;
  return m;
});

let extractor = null;
const reply = (id, result) => self.postMessage({ id, ok: true, result });

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      if (!extractor) {
        const { pipeline } = await lib;
        extractor = await pipeline('feature-extraction', data.model, {
          device: 'wasm',
          dtype: 'q8',
          progress_callback: (p) => self.postMessage({ type: 'progress', status: p.status, file: p.file, loaded: p.loaded, total: p.total }),
        });
      }
      return reply(id, true);
    }
    if (type === 'embed') {
      if (!extractor) throw new Error('Modelo de busca não carregado.');
      const out = [];
      for (let i = 0; i < data.texts.length; i += 8) {
        const batch = data.texts.slice(i, i + 8);
        const t = await extractor(batch, { pooling: 'mean', normalize: true });
        out.push(...t.tolist());
      }
      return reply(id, out);
    }
    throw new Error(`Pedido desconhecido: ${type}`);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
