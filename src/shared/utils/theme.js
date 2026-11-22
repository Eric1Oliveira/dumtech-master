// Tema claro/escuro/sistema. O primeiro paint é feito por assets/js/theme-boot.js.

import { getState, setState, uiPrefs } from '../../core/state.js';
import { events } from '../../core/events.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');

/** @typedef {'light' | 'dark' | 'system'} ThemePref */

export const THEME_LABELS = { light: 'Claro', dark: 'Escuro', system: 'Automático (sistema)' };

/** @param {ThemePref} pref */
function apply(pref) {
  const resolved = pref === 'dark' || (pref === 'system' && media.matches) ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  events.emit('theme:changed', resolved);
}

/** @param {ThemePref} pref */
export function setTheme(pref) {
  uiPrefs.set('theme', pref === 'system' ? null : pref);
  setState({ theme: pref });
  apply(pref);
}

/** Claro → Escuro → Sistema → Claro */
export function cycleTheme() {
  const order = /** @type {ThemePref[]} */ (['light', 'dark', 'system']);
  setTheme(order[(order.indexOf(getState().theme) + 1) % order.length]);
}

media.addEventListener('change', () => {
  if (getState().theme === 'system') apply('system');
});
