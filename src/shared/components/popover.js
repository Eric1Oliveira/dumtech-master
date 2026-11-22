// Painel flutuante ancorado num botão (menus, notificações).
// Um aberto por vez; fecha com Esc, clique fora, troca de rota ou redimensionamento.

/** @type {{ anchor: HTMLElement, close: () => void } | null} */
let active = null;

/**
 * Abre (ou fecha, se já estiver aberto no mesmo botão).
 * @param {HTMLElement} anchor
 * @param {HTMLElement} panel
 * @param {{ align?: 'start' | 'end', onClose?: () => void }} [options]
 * @returns {(() => void) | null} função que fecha, ou null se foi fechado
 */
export function togglePopover(anchor, panel, { align = 'start', onClose } = {}) {
  if (active?.anchor === anchor) {
    active.close();
    return null;
  }
  active?.close();

  panel.classList.add('popover');
  document.body.append(panel);
  const rect = anchor.getBoundingClientRect();
  const width = panel.offsetWidth;
  const left = align === 'end' ? rect.right - width : rect.left;
  panel.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
  panel.style.top = `${rect.bottom + 6}px`;
  anchor.setAttribute('aria-expanded', 'true');

  const controller = new AbortController();
  const { signal } = controller;
  const close = () => {
    controller.abort();
    panel.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (active?.anchor === anchor) active = null;
    onClose?.();
  };

  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = /** @type {Node} */ (event.target);
      if (!panel.contains(target) && !anchor.contains(target)) close();
    },
    { signal, capture: true },
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        close();
        anchor.focus();
      }
    },
    { signal },
  );
  window.addEventListener('resize', close, { signal });
  window.addEventListener('hashchange', close, { signal });

  active = { anchor, close };
  /** @type {HTMLElement | null} */ (panel.querySelector('button, a, input'))?.focus();
  return close;
}

export const closePopover = () => active?.close();
