// Validações comuns dos formulários. Cada função devolve o valor limpo ou lança Error
// com a mensagem que aparece para o usuário. O banco confere de novo (constraints).

/** @param {unknown} value */
export const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

/**
 * @param {unknown} value
 * @param {string} label
 * @param {number} min
 * @param {number} max
 */
export function requiredText(value, label, min, max) {
  const text = clean(value);
  if (text.length < min || text.length > max) throw new Error(`${label} precisa ter entre ${min} e ${max} caracteres.`);
  return text;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {number} max
 * @returns {string | null}
 */
export function optionalText(value, label, max) {
  const text = clean(value);
  if (text.length > max) throw new Error(`${label}: no máximo ${max} caracteres.`);
  return text || null;
}

/** Texto longo (quebras de linha preservadas). */
export function longText(/** @type {unknown} */ value, /** @type {string} */ label, max = 4000) {
  const text = String(value ?? '').trim();
  if (text.length > max) throw new Error(`${label}: no máximo ${max.toLocaleString('pt-BR')} caracteres.`);
  return text;
}

/**
 * Valor em reais (aceita "1.234,56" ou "1234.56"). Vazio = null.
 * @param {unknown} value
 * @param {string} label
 * @returns {number | null}
 */
export function money(value, label) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return checkMoney(value, label);
  let text = String(value).trim().replace(/^R\$\s*/, '');
  if (!text) return null;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  return checkMoney(Number(text), label);
}

/** @param {number} n @param {string} label */
function checkMoney(n, label) {
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label}: informe um valor válido (zero ou mais).`);
  if (n > 9_999_999_999) throw new Error(`${label}: valor alto demais.`);
  return Math.round(n * 100) / 100;
}

/**
 * Data AAAA-MM-DD (input type=date). Vazio = null.
 * @param {unknown} value
 * @param {string} label
 * @returns {string | null}
 */
export function dateOrNull(value, label) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new Error(`${label}: data inválida.`);
  return text;
}

/**
 * @template {string} K
 * @param {readonly { key: K }[]} options
 * @param {unknown} value
 * @param {K} fallback
 * @returns {K}
 */
export const pick = (options, value, fallback) => /** @type {K} */ (options.some((o) => o.key === value) ? value : fallback);

/** @param {unknown} value @returns {string | null} */
export const idOrNull = (value) => (value ? String(value) : null);

/** @param {unknown} value @param {string} label @returns {string | null} */
export function urlOrNull(value, label) {
  const text = clean(value);
  if (!text) return null;
  if (!/^https?:\/\/\S+$/i.test(text)) throw new Error(`${label}: comece com https:// (ou http://).`);
  if (text.length > 500) throw new Error(`${label}: endereço longo demais.`);
  return text;
}

/** @param {readonly { key: string, label: string }[]} options @param {string} key */
export const labelOf = (options, key) => options.find((o) => o.key === key)?.label ?? key;

/** Data local de hoje em AAAA-MM-DD. */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
