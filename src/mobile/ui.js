// Peças visuais do app do celular (classes em assets/css/mobile.css).

import { html } from '../shared/utils/dom.js';
import { icon } from '../shared/components/icons.js';
import { STATE } from '../core/monitor.js';
import { PRODUCT_STATUS } from '../core/catalog.js';
import { BILLING_STATUS } from '../core/billing.js';

/** Tons do sistema → tons do celular (danger e error são o mesmo vermelho). */
const TONE = /** @type {Record<string, string>} */ ({ error: 'error', danger: 'error', warn: 'warn', warning: 'warn', info: 'info', ok: 'ok', success: 'ok', muted: 'muted' });
export const tone = (/** @type {string | undefined} */ t) => TONE[t ?? ''] ?? 'muted';

export const pill = (/** @type {string} */ label, /** @type {string} */ t = 'muted') => html`<span class="m-pill m-pill--${tone(t)}">${label}</span>`;
export const dot = (/** @type {string} */ t) => html`<span class="m-dot m-dot--${tone(t)}" aria-hidden="true"></span>`;

export const empty = (/** @type {string} */ title, text = '') =>
  html`<div class="m-empty"><p class="m-empty__title">${title}</p>${text ? html`<p class="m-empty__text">${text}</p>` : ''}</div>`;

/** @param {string} title @param {unknown} body @param {unknown} [aside] */
export const section = (title, body, aside = '') =>
  html`<section class="m-section"><header class="m-section__head"><h2 class="m-section__title">${title}</h2>${aside ? html`<span class="m-section__aside">${aside}</span>` : ''}</header>${body}</section>`;

/**
 * Linha de lista tocável.
 * @param {{ href?: string | null, lead?: unknown, title: unknown, sub?: unknown, end?: unknown, endSub?: unknown, t?: string }} r
 */
export function row({ href = null, lead = '', title, sub = '', end = '', endSub = '', t = '' }) {
  const inner = html`${lead ? html`<span class="m-row__lead">${lead}</span>` : ''}
    <span class="m-row__body"><span class="m-row__title">${title}</span>${sub ? html`<span class="m-row__sub">${sub}</span>` : ''}</span>
    ${end || endSub ? html`<span class="m-row__end">${end ? html`<span class="m-row__value">${end}</span>` : ''}${endSub ? html`<span class="m-row__sub">${endSub}</span>` : ''}</span>` : ''}
    ${href ? html`<span class="m-row__chev" aria-hidden="true">${icon('chevronRight')}</span>` : ''}`;
  const cls = `m-row${t ? ` m-row--${tone(t)}` : ''}`;
  return href ? html`<li><a class="${cls}" href="${href}">${inner}</a></li>` : html`<li><div class="${cls}">${inner}</div></li>`;
}

export const list = (/** @type {unknown[]} */ rows) => html`<ul class="m-list">${rows}</ul>`;

/** Estado do "No ar" (ponto + texto). @param {{ state: string, enabled?: boolean }} m */
export const monitorPill = (m) => {
  if (m.enabled === false) return pill('Pausado', 'muted');
  const s = STATE[/** @type {keyof typeof STATE} */ (m.state)] ?? STATE.unknown;
  return pill(s.label, s.tone === 'info' ? 'muted' : s.tone);
};
export const monitorTone = (/** @type {{ state: string, enabled?: boolean }} */ m) =>
  m.enabled === false ? 'muted' : tone(STATE[/** @type {keyof typeof STATE} */ (m.state)]?.tone === 'info' ? 'muted' : STATE[/** @type {keyof typeof STATE} */ (m.state)]?.tone);

export const stagePill = (/** @type {string} */ status) => {
  const s = PRODUCT_STATUS.find((x) => x.key === status);
  return pill(s?.label ?? status, s?.tone ?? 'muted');
};

export const billingPill = (/** @type {string} */ state) => {
  const s = BILLING_STATUS.find((x) => x.key === state);
  return pill(s?.label ?? state, s?.tone ?? 'muted');
};

/** Endereço sem "https://" e sem a barra final. @param {string | null | undefined} url */
export const host = (url) => {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
};
