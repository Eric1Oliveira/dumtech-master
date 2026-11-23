// Worker do modelo de linguagem local (WebLLM + WebGPU). Monta a ata a partir da transcrição.
// Biblioteca local em assets/js/vendor/ai/web-llm.js; pesos do modelo vêm do Hugging Face na 1ª vez.

// @ts-nocheck — worker (escopo de worker, não de janela).
const lib = import(new URL('../../assets/js/vendor/ai/web-llm.js', import.meta.url).href);

/** @type {any} */
let engine = null;
let loaded = '';

/** @param {number} id @param {any} result */
const reply = (id, result) => self.postMessage({ id, ok: true, result });

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      const webllm = await lib;
      const available = new Set(webllm.prebuiltAppConfig.model_list.map((/** @type {any} */ m) => m.model_id));
      const model = /** @type {string[]} */ (data.prefer).find((m) => available.has(m));
      if (!model) throw new Error('Nenhum modelo de ata compatível nesta versão.');
      if (!engine || loaded !== model) {
        await engine?.unload?.();
        engine = await webllm.CreateMLCEngine(model, {
          initProgressCallback: (/** @type {any} */ r) => self.postMessage({ type: 'progress', progress: r.progress, text: r.text }),
        });
        loaded = model;
      }
      return reply(id, model);
    }
    if (type === 'chat') {
      if (!engine) throw new Error('Modelo da ata não carregado.');
      const request = {
        messages: data.messages,
        temperature: 0.2,
        max_tokens: data.maxTokens ?? 900,
        response_format: { type: 'json_object', schema: JSON.stringify(data.schema) },
      };
      let res;
      try {
        // Qwen 3: sem "pensar em voz alta" (mais rápido e só o JSON).
        res = await engine.chat.completions.create({ ...request, extra_body: { enable_thinking: false } });
      } catch {
        res = await engine.chat.completions.create(request);
      }
      return reply(id, res?.choices?.[0]?.message?.content ?? '');
    }
    throw new Error(`Pedido desconhecido: ${type}`);
  } catch (error) {
    self.postMessage({ id, ok: false, error: /** @type {Error} */ (error)?.message || String(error) });
  }
};
