// Formatação em pt-BR.

const LOCALE = 'pt-BR';

const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeStyle: 'short' });
const dateLong = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
const currency = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'BRL' });
const integer = new Intl.NumberFormat(LOCALE);

/** @param {string | number | Date} value */
export const formatDateTime = (value) => dateTime.format(new Date(value));

/** @param {string | number | Date} value */
export const formatDateLong = (value) => dateLong.format(new Date(value));

const dateOnly = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeZone: 'UTC' });
/** Data pura do banco (AAAA-MM-DD) → dd/mm/aaaa, sem deslocar fuso. @param {string | null | undefined} value */
export const formatDate = (value) => (value ? dateOnly.format(new Date(`${value}T00:00:00Z`)) : '');

const monthLong = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** "2026-11" → "novembro de 2026" @param {string} ym */
export const formatMonth = (ym) => monthLong.format(new Date(`${ym}-01T00:00:00Z`));

/** @param {number} value */
export const formatMoney = (value) => currency.format(value);

/** @param {number} value */
export const formatInteger = (value) => integer.format(value);

/**
 * "há 5 minutos", "ontem"…
 * @param {string | number | Date} value
 * @param {number} [now]
 */
export function formatRelative(value, now = Date.now()) {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const steps = /** @type {const} */ ([
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Infinity],
  ]);
  let amount = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(amount) < size) return unit === 'second' && Math.abs(amount) < 45 ? 'agora' : relative.format(Math.round(amount), unit);
    amount /= size;
  }
  return formatDateTime(value);
}

/**
 * Minúsculas e sem acento — base da busca.
 * @param {string} text
 */
export const normalize = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** @param {string} name */
export const initials = (name) =>
  String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || '?';
