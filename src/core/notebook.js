// Caderno estilo Notion: ícones de linha com cor (sem emoji), status de projeto interno, tipo de
// documento, prioridade de tarefa, progresso, calendário e "adicionar rápido" em linguagem natural
// ("Revisar layout @Bia sexta !alta #Site Padaria"). Tudo puro — testado em tests/core.test.js.

import { parseDue, matchMember, fold } from './minutes.js';

/** Ícones que uma página pode ter (nomes de src/shared/components/icons.js). */
export const PAGE_ICONS = [
  'fileText', 'book', 'bookmark', 'folder', 'briefcase', 'target', 'flag', 'rocket', 'lightbulb', 'compass',
  'layers', 'grid', 'listChecks', 'checkCircle', 'calendar', 'clock', 'mic', 'message', 'megaphone', 'users',
  'user', 'building', 'package', 'globe', 'code', 'database', 'server', 'palette', 'chart', 'wallet',
  'shield', 'lock', 'zap', 'star', 'heart', 'mail', 'phone', 'settings', 'kanban', 'sparkles',
];
export const ICON_COLORS = /** @type {const} */ (['', 'gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink']);
export const COLOR_LABEL = { '': 'Padrão', gray: 'Cinza', blue: 'Azul', green: 'Verde', yellow: 'Amarelo', orange: 'Laranja', red: 'Vermelho', purple: 'Roxo', pink: 'Rosa' };

/** Ícone padrão de cada tipo de página. @param {string} kind */
export const defaultIcon = (kind) => (kind === 'meeting' ? 'mic' : kind === 'project' ? 'folder' : 'fileText');
/** Ícone válido (emoji antigo ou nome desconhecido → padrão do tipo). @param {{ icon?: string | null, kind?: string }} p */
export const pageIconName = (p) => (p.icon && PAGE_ICONS.includes(p.icon) ? p.icon : defaultIcon(p.kind ?? 'page'));

export const PROJECT_STATUS = /** @type {const} */ ([
  { key: 'idea', label: 'Ideia', tone: 'muted' },
  { key: 'planned', label: 'Planejado', tone: 'info' },
  { key: 'active', label: 'Em andamento', tone: 'warn' },
  { key: 'paused', label: 'Pausado', tone: 'muted' },
  { key: 'done', label: 'Concluído', tone: 'ok' },
]);
/** Colunas do quadro de projetos (internos e de clientes juntos). */
export const PROJECT_BOARD = /** @type {const} */ (['idea', 'planned', 'active', 'paused', 'done']);
/** Etapa do projeto de cliente → coluna do quadro. */
export const CLIENT_BUCKET = { proposal: 'planned', building: 'active', live: 'done', ended: 'done' };

export const DOC_TYPES = /** @type {const} */ ([
  { key: 'note', label: 'Nota' },
  { key: 'process', label: 'Processo' },
  { key: 'guide', label: 'Guia' },
  { key: 'briefing', label: 'Briefing' },
  { key: 'proposal', label: 'Proposta' },
  { key: 'reference', label: 'Referência' },
]);

export const PRIORITIES = /** @type {const} */ ([
  { key: 'urgent', label: 'Urgente', tone: 'danger', rank: 0 },
  { key: 'high', label: 'Alta', tone: 'warn', rank: 1 },
  { key: 'medium', label: 'Média', tone: 'info', rank: 2 },
  { key: 'low', label: 'Baixa', tone: 'muted', rank: 3 },
]);
/** @param {string | null | undefined} key */
export const priorityOf = (key) => PRIORITIES.find((p) => p.key === key) ?? null;

/**
 * Propriedades da página (jsonb props), validadas por tipo.
 * projeto: status, responsável, início e prazo · documento: tipo
 * @param {string} kind @param {Record<string, any>} input
 */
export function normalizeProps(kind, input) {
  const p = input && typeof input === 'object' ? input : {};
  const date = (/** @type {unknown} */ v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const id = (/** @type {unknown} */ v) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  if (kind === 'project') {
    const start = date(p.startDate);
    const due = date(p.dueDate);
    if (start && due && due < start) throw new Error('O prazo não pode ser antes do início.');
    return { status: PROJECT_STATUS.some((s) => s.key === p.status) ? p.status : 'planned', ownerId: id(p.ownerId), startDate: start, dueDate: due };
  }
  if (kind === 'page') return DOC_TYPES.some((t) => t.key === p.docType) ? { docType: p.docType } : {};
  return {};
}

/** Progresso das tarefas. @param {{ status: string }[]} tasks */
export function progressOf(tasks) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : null };
}

/**
 * Página-projeto mais próxima subindo a árvore (a tarefa de uma reunião dentro de um projeto é do projeto).
 * @template {{ id: string, parentId: string | null, kind: string }} T
 * @param {string | null | undefined} pageId @param {Map<string, T>} byId
 * @returns {T | null}
 */
export function projectPageOf(pageId, byId) {
  const seen = new Set();
  let cur = pageId ? byId.get(pageId) : undefined;
  while (cur && !seen.has(cur.id)) {
    if (cur.kind === 'project') return cur;
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return null;
}

/** Semanas do mês (segunda a domingo) com os dias de fora em cinza. @param {number} year @param {number} month 1–12 */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(1 - offset);
  /** @type {{ date: string, inMonth: boolean }[][]} */
  const weeks = [];
  const cur = new Date(start);
  do {
    const week = [];
    for (let i = 0; i < 7; i += 1) {
      week.push({ date: cur.toISOString().slice(0, 10), inMonth: cur.getUTCMonth() === month - 1 });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (cur.getUTCMonth() === month - 1);
  return weeks;
}

const PRIORITY_WORDS = /** @type {Record<string, string>} */ ({ urgente: 'urgent', alta: 'high', media: 'medium', baixa: 'low', '1': 'urgent', '2': 'high', '3': 'medium', '4': 'low' });
const DATE_PHRASE = /(?:^|\s)((?:ate|para|pra|no dia|na|no)\s+)?(hoje|amanha|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|semana que vem|proxima semana|fim do mes|dia \d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2} de (?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro))(?:-feira)?(?=$|[\s,.;])/;

/**
 * "Adicionar rápido": tira do texto @responsável, !prioridade, #projeto e a data falada.
 * @param {string} text
 * @param {{ members: { userId: string, name: string, email?: string }[], projects: { id: string, name: string, kind: 'client' | 'internal' }[], todayKey: string }} ctx
 * @returns {{ title: string, assigneeId: string | null, assigneeName: string | null, priority: string | null, dueDate: string | null, project: { id: string, name: string, kind: 'client' | 'internal' } | null }}
 */
export function parseQuickTask(text, { members, projects, todayKey }) {
  let rest = ` ${String(text ?? '').replace(/\s+/g, ' ').trim()} `;
  /** @type {{ userId: string, name: string } | null} */
  let member = null;
  rest = rest.replace(/\s@([\p{L}\d._-]+(?:\s[\p{L}][\p{L}\d._-]*)?)/u, (all, name) => {
    const full = members.find((m) => fold(m.name) === fold(name)) ?? null;
    const first = full ?? matchMember(String(name).split(' ')[0], members);
    if (!first) return all;
    member = first;
    // "@Bia Souza" usa as duas palavras; "@Bia revisar" devolve a segunda
    return full ? ' ' : ` ${String(name).split(' ').slice(1).join(' ')}`;
  });
  /** @type {string | null} */
  let priority = null;
  rest = rest.replace(/\s!(urgente|alta|m[eé]dia|baixa|[1-4])(?=\s)/i, (_, p) => {
    priority = PRIORITY_WORDS[fold(p)] ?? null;
    return ' ';
  });
  /** @type {{ id: string, name: string, kind: 'client' | 'internal' } | null} */
  let project = null;
  const hash = rest.match(/\s#([^\s#@!][^#@!]*?)(?=\s(?:@|!|#)|\s*$)/);
  if (hash) {
    const want = fold(hash[1]).trim();
    const words = want.split(' ');
    // o nome mais longo que bate com o começo do que foi digitado
    for (let n = words.length; n > 0 && !project; n -= 1) {
      const prefix = words.slice(0, n).join(' ');
      project = projects.find((p) => fold(p.name) === prefix) ?? projects.find((p) => fold(p.name).startsWith(prefix) && prefix.length >= 3) ?? null;
      if (project) rest = rest.replace(new RegExp(`\\s#${hash[1].split(' ').slice(0, n).join(' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), ' ');
    }
  }
  /** @type {string | null} */
  let dueDate = null;
  const folded = fold(rest);
  const date = folded.match(DATE_PHRASE);
  if (date) {
    dueDate = parseDue(date[0], todayKey);
    if (dueDate) {
      const at = folded.indexOf(date[0]);
      rest = `${rest.slice(0, at)} ${rest.slice(at + date[0].length)}`;
    }
  }
  const title = rest.replace(/\s+/g, ' ').trim().replace(/^[-–—:,]\s*/, '');
  const m = /** @type {{ userId: string, name: string } | null} */ (member);
  return { title: title.charAt(0).toUpperCase() + title.slice(1), assigneeId: m?.userId ?? null, assigneeName: m?.name ?? null, priority, dueDate, project };
}
