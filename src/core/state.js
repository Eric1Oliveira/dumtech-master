// Estado global da sessão e preferências de interface deste navegador.

/**
 * @typedef {Object} User
 * @property {string} id
 * @property {string} name
 * @property {string} email
 */

/**
 * @typedef {Object} OrgSummary
 * @property {string} id
 * @property {string} name
 * @property {import('./permissions.js').RoleKey} role
 */

/**
 * @typedef {Object} AppState
 * @property {User | null} user
 * @property {OrgSummary[]} orgs
 * @property {OrgSummary | null} org        organização ativa
 * @property {boolean} sidebarCollapsed
 * @property {'light' | 'dark' | 'system'} theme
 */

/** Preferências só deste navegador (localStorage pode falhar em modo privado). */
export const uiPrefs = {
  /** @param {string} key */
  get(key) {
    try {
      return localStorage.getItem(`dum.${key}`);
    } catch {
      return null;
    }
  },
  /** @param {string} key @param {string | null} value */
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem(`dum.${key}`);
      else localStorage.setItem(`dum.${key}`, value);
    } catch {
      /* sem persistência, segue em memória */
    }
  },
};

const storedTheme = uiPrefs.get('theme');

/** @type {AppState} */
const state = {
  user: null,
  orgs: [],
  org: null,
  sidebarCollapsed: uiPrefs.get('sidebar') === 'collapsed',
  theme: storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'system',
};

/** @type {Set<(state: AppState, patch: Partial<AppState>) => void>} */
const subscribers = new Set();

/** @returns {Readonly<AppState>} */
export const getState = () => state;

/** @param {Partial<AppState>} patch */
export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of [...subscribers]) fn(state, patch);
}

/**
 * @param {(state: AppState, patch: Partial<AppState>) => void} fn
 * @returns {() => void}
 */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
