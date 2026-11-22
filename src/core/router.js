// Roteador por hash (#/modulo/secao). Funciona em qualquer hospedagem estática,
// sem configurar fallback de rotas no servidor.

/**
 * @typedef {Object} Route
 * @property {string} path      ex.: "/settings/members"
 * @property {string} module    ex.: "settings"
 * @property {string | null} section  ex.: "members"
 * @property {URLSearchParams} params
 */

export const DEFAULT_MODULE = 'dashboard';

/**
 * @param {string} hash
 * @returns {Route}
 */
export function parseHash(hash) {
  const [pathPart, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const module = parts[0] || DEFAULT_MODULE;
  return {
    path: `/${[module, ...parts.slice(1)].join('/')}`,
    module,
    section: parts[1] ?? null,
    params: new URLSearchParams(query),
  };
}

/** @param {string} path ex.: "/settings/members" */
export const href = (path) => `#${path}`;

/** @param {string} path */
export function navigate(path) {
  if (location.hash === href(path)) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = href(path);
}

export const currentRoute = () => parseHash(location.hash);

/**
 * @param {(route: Route) => void} onRoute
 * @returns {() => void} para o roteador
 */
export function startRouter(onRoute) {
  const handler = () => onRoute(currentRoute());
  window.addEventListener('hashchange', handler);
  handler();
  return () => window.removeEventListener('hashchange', handler);
}
