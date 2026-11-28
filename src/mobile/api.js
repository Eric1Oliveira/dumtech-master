// O app do celular fala só com a Edge Function `mobile` (nunca com o banco direto, nunca com o
// login da pessoa). No smoke test, tools/server.js troca este arquivo por tests/support/fake-mobile.js.

export class ApiError extends Error {
  /** @param {string} message @param {string} code @param {number} status */
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const env = () => /** @type {any} */ (globalThis).DUM_ENV ?? {};
export const isConfigured = () => Boolean(env().SUPABASE_URL);

/**
 * @param {string} action
 * @param {Record<string, unknown>} [body]
 * @returns {Promise<any>}
 */
export async function api(action, body = {}) {
  let res;
  try {
    res = await fetch(`${env().SUPABASE_URL}/functions/v1/mobile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: String(env().SUPABASE_ANON_KEY ?? '') },
      body: JSON.stringify({ ...body, action }),
    });
  } catch {
    throw new ApiError('Sem internet agora. Confira a conexão e tente de novo.', 'offline', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  if (res.status === 404 && !data.error) throw new ApiError('A função “mobile” ainda não foi publicada no Supabase.', 'missing', 404);
  throw new ApiError(data.error || 'O servidor não respondeu. Tente de novo.', data.code || 'error', res.status);
}
