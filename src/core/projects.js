// Etapas do projeto e checklist da construção (espelho de project_set_stage, migration 0013).

import { requiredText, dateOrNull, pick, idOrNull } from './validate.js';

/** @typedef {'proposal' | 'building' | 'live' | 'ended'} Stage */

/**
 * Próximos passos de cada etapa; o primeiro é o principal (botão destacado).
 * @type {Record<Stage, { to: Stage, label: string, danger?: boolean }[]>}
 */
export const NEXT_STEPS = {
  proposal: [{ to: 'building', label: 'Cliente aceitou' }, { to: 'ended', label: 'Cliente recusou', danger: true }],
  building: [{ to: 'live', label: 'Publicar' }, { to: 'ended', label: 'Cancelar projeto', danger: true }],
  live: [{ to: 'ended', label: 'Encerrar', danger: true }],
  ended: [{ to: 'building', label: 'Reabrir' }],
};

/** @param {string} from @param {string} to */
export const canMove = (from, to) => (NEXT_STEPS[/** @type {Stage} */ (from)] ?? []).some((s) => s.to === to);

/** Igual a public.default_checklist() — o teste do banco confere. */
export const DEFAULT_CHECKLIST = [
  'Registrar ou apontar o domínio',
  'Criar o banco de dados',
  'Montar o layout',
  'Desenvolver as páginas e funções',
  'Testar no celular e no computador',
  'Publicar e ligar o monitoramento',
  'Entregar ao cliente e explicar o uso',
];

/** Checklist dos Ajustes: 1 a 30 itens de 2 a 200 caracteres (igual a org_setting_set). @param {unknown} raw */
export function normalizeChecklist(raw) {
  const items = String(raw ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!items.length || items.length > 30) throw new Error('O checklist precisa ter de 1 a 30 itens (um por linha).');
  const bad = items.find((s) => s.length < 2 || s.length > 200);
  if (bad) throw new Error(`“${bad.slice(0, 40)}”: cada item precisa ter de 2 a 200 caracteres.`);
  return items;
}

export const TASK_STATUS = /** @type {const} */ ([
  { key: 'todo', label: 'A fazer' },
  { key: 'doing', label: 'Fazendo' },
  { key: 'done', label: 'Feito' },
]);

/**
 * @typedef {Object} TaskInput
 * @property {string} productId   o projeto
 * @property {string} title
 * @property {'todo' | 'doing' | 'done'} status
 * @property {string | null} assigneeId
 * @property {string | null} dueDate
 * @property {number} position
 */

/** @param {Record<string, any>} input @returns {TaskInput} */
export function normalizeTask(input) {
  if (!input.productId) throw new Error('A tarefa precisa de um projeto.');
  return {
    productId: String(input.productId),
    title: requiredText(input.title, 'A tarefa', 2, 200),
    status: pick(TASK_STATUS, input.status, 'todo'),
    assigneeId: idOrNull(input.assigneeId),
    dueDate: dateOrNull(input.dueDate, 'Prazo'),
    position: Number.isInteger(Number(input.position)) ? Number(input.position) : 0,
  };
}

/** Tarefa atrasada: aberta e com prazo antes de hoje. */
export const isOverdue = (/** @type {{ status: string, dueDate: string | null }} */ t, /** @type {string} */ todayKey) =>
  t.status !== 'done' && Boolean(t.dueDate) && /** @type {string} */ (t.dueDate) < todayKey;

/** @param {{ status: string }[]} tasks */
export function checklistProgress(tasks) {
  const done = tasks.filter((t) => t.status === 'done').length;
  return { total: tasks.length, done, complete: tasks.length > 0 && done === tasks.length };
}
