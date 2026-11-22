// Regras do Workspace (espelho da migration 0010).

import { requiredText } from './validate.js';

export const FILE_MAX_BYTES = 10 * 1024 * 1024;

/** @typedef {{ title: string, body: string, pinned: boolean }} DocumentInput */

/** @param {Record<string, any>} input @returns {DocumentInput} */
export function normalizeDocument(input) {
  const body = String(input.body ?? '');
  if (body.length > 100_000) throw new Error('O documento passa de 100 mil caracteres. Divida em mais de um.');
  return {
    title: requiredText(input.title, 'O título', 1, 160),
    body,
    pinned: input.pinned === true || input.pinned === 'on' || input.pinned === 'true',
  };
}

/** Nome seguro para o caminho no Storage (mantém a extensão). @param {string} name */
export function safeFileName(name) {
  const clean = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+/, '');
  return (clean || 'arquivo').slice(-120);
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
