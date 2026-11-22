// Barramento de eventos entre partes da interface que não se conhecem.
//
// Eventos em uso:
//   session:changed        login / logout
//   org:changed            troca de organização ativa
//   notifications:changed  nova notificação ou leitura
//   data:changed           algo gravado (membros, integrações…) — telas abertas recarregam
//   theme:changed          tema aplicado ('light' | 'dark')

/** @type {Map<string, Set<(detail?: any) => void>>} */
const listeners = new Map();

export const events = {
  /**
   * @param {string} name
   * @param {(detail?: any) => void} handler
   * @returns {() => void} função que remove o ouvinte
   */
  on(name, handler) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(handler);
    return () => listeners.get(name)?.delete(handler);
  },

  /**
   * @param {string} name
   * @param {any} [detail]
   */
  emit(name, detail) {
    for (const handler of [...(listeners.get(name) ?? [])]) {
      try {
        handler(detail);
      } catch (error) {
        console.error(`[events] ${name}`, error);
      }
    }
  },
};
