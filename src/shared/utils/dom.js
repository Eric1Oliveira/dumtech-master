// Templates HTML com escape automático. Todo texto vindo de dados passa por aqui:
// interpolações são escapadas, salvo quando já são SafeHtml (outro html``).

export class SafeHtml {
  /** @param {string} value */
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/** @param {unknown} value */
export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** @param {unknown} value @returns {string} */
const toHtml = (value) => {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(toHtml).join('');
  if (value instanceof SafeHtml) return value.value;
  return escapeHtml(value);
};

/**
 * Tagged template seguro: html`<p>${nome}</p>`
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += toHtml(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Marca uma string confiável (ex.: SVG de ícone do próprio código) como HTML. */
export const trusted = (/** @type {string} */ markup) => new SafeHtml(markup);

/**
 * Substitui o conteúdo de um elemento.
 * @param {Element} target
 * @param {SafeHtml} template
 */
export function setHtml(target, template) {
  target.innerHTML = template.value;
}

/**
 * Cria um elemento a partir de um template com um único nó raiz.
 * @param {SafeHtml} template
 * @returns {HTMLElement}
 */
export function createElement(template) {
  const tpl = document.createElement('template');
  tpl.innerHTML = template.value.trim();
  return /** @type {HTMLElement} */ (tpl.content.firstElementChild);
}

/**
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement | null}
 */
export const $ = (selector, root = document) => root.querySelector(selector);

/**
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement[]}
 */
export const $$ = (selector, root = document) => /** @type {HTMLElement[]} */ ([...root.querySelectorAll(selector)]);

/**
 * Delegação: um ouvinte para todos os [data-action] dentro de root.
 * @param {HTMLElement} root
 * @param {Record<string, (el: HTMLElement, event: Event) => void>} actions
 * @param {AbortSignal} [signal]
 */
export function bindActions(root, actions, signal) {
  root.addEventListener(
    'click',
    (event) => {
      const el = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('[data-action]'));
      if (!el || !root.contains(el)) return;
      const handler = actions[el.dataset.action];
      if (handler) {
        event.preventDefault();
        handler(el, event);
      }
    },
    { signal },
  );
}
