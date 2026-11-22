// Hoje: a lista do que pede atenção, em ordem de prioridade, e a data em palavras.
// Regra pura (sem tela nem banco) — a tela Hoje só desenha o resultado.

import { daysUntil } from './infra.js';
import { proposalNumber } from './proposals.js';

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });

/**
 * Data em palavras, relativa a hoje: "hoje", "amanhã", "há 3 dias", "sex., 21/11".
 * @param {string | null} date
 * @param {string} todayKey
 */
export function dayLabel(date, todayKey) {
  const days = daysUntil(date, todayKey);
  if (days === null) return 'sem data';
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days === -1) return 'ontem';
  if (days < 0) return `há ${-days} dias`;
  return WEEKDAY.format(new Date(`${date}T00:00:00Z`)).replace(/\.,/, ',');
}

/** "Bom dia" / "Boa tarde" / "Boa noite" pela hora local. */
export const greeting = (hour = new Date().getHours()) => (hour < 5 ? 'Boa noite' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite');

/**
 * @typedef {Object} TodayItem   um item do "Hoje", já com a ação certa
 * @property {'down' | 'billing' | 'setup' | 'adjust' | 'renewal' | 'unstable' | 'task' | 'proposal'} kind
 * @property {number} rank       prioridade (0 = primeiro)
 * @property {'error' | 'warn' | 'info' | 'ok'} tone
 * @property {string} title
 * @property {string} context
 * @property {string | null} date
 * @property {string} href
 * @property {string} [id]        o que a ação usa (assinatura, projeto, serviço, tarefa)
 * @property {string | null} [phone]
 */

/**
 * "Hoje": uma lista só, por prioridade — fora do ar → cobranças atrasadas → cobranças vencendo (até 3 dias)
 * → implantação a receber → vencimentos de serviços (até 30 dias) → instáveis/lentos → tarefas atrasadas
 * ou de hoje → propostas esperando resposta.
 * @param {{
 *   monitors?: { id: string, productId: string | null, label: string, enabled: boolean, state: string, lastCode: number | null, projectName?: string }[],
 *   billings?: { subId: string, customerId: string, customerName: string, productName: string, amountLabel: string, due: string, state: string, phone: string | null }[],
 *   setups?: { productId: string, name: string, customerName: string, amountLabel: string }[],
 *   adjustments?: { subId: string, customerName: string, productName: string, date: string, label: string }[],
 *   assets?: { id: string, name: string, status: string, renewsAt: string | null, kindLabel?: string }[],
 *   tasks?: { id: string, title: string, status: string, dueDate: string | null, productId: string, projectName?: string, assigneeId?: string | null, assigneeName?: string | null }[],
 *   proposals?: { id: string, number: number, title: string, status: string, validUntil: string | null, customerName?: string }[],
 * }} sources
 * @param {string} todayKey
 * @param {string | null} [me]
 * @returns {TodayItem[]}
 */
export function todayList({ monitors = [], billings = [], setups = [], adjustments = [], assets = [], tasks = [], proposals = [] }, todayKey, me = null) {
  /** @type {TodayItem[]} */
  const items = [];
  const where = (/** @type {{ projectName?: string, label: string }} */ m) => (m.projectName ? `${m.projectName} · ${m.label}` : m.label);
  for (const m of monitors) {
    if (!m.enabled) continue;
    const href = m.productId ? `#/projects/${m.productId}` : '#/infrastructure';
    if (m.state === 'down') items.push({ kind: 'down', rank: 0, tone: 'error', title: `${where(m)} fora do ar`, context: m.lastCode ? `HTTP ${m.lastCode} na última verificação` : 'Sem resposta na última verificação', date: null, href });
    else if (m.state === 'unstable' || m.state === 'slow') items.push({ kind: 'unstable', rank: 5, tone: 'warn', title: `${where(m)} ${m.state === 'slow' ? 'lento' : 'instável'}`, context: m.state === 'slow' ? 'Respondendo devagar' : 'Oscilou na última hora', date: null, href });
  }
  for (const b of billings) {
    const days = daysUntil(b.due, todayKey) ?? 0;
    if (b.state === 'late') items.push({ kind: 'billing', rank: 1, tone: 'error', title: `Cobrar ${b.customerName}`, context: `${b.productName} · ${b.amountLabel} · venceu`, date: b.due, href: `#/customers/${b.customerId}`, id: b.subId, phone: b.phone });
    else if (b.state === 'open' && days <= 3) items.push({ kind: 'billing', rank: 2, tone: 'warn', title: `Cobrar ${b.customerName}`, context: `${b.productName} · ${b.amountLabel}`, date: b.due, href: `#/customers/${b.customerId}`, id: b.subId, phone: b.phone });
  }
  for (const s of setups) items.push({ kind: 'setup', rank: 3, tone: 'info', title: `Receber implantação de ${s.customerName || s.name}`, context: `${s.name} · ${s.amountLabel}`, date: null, href: `#/projects/${s.productId}`, id: s.productId });
  for (const a of assets) {
    if (a.status !== 'active' || !a.renewsAt) continue;
    const days = daysUntil(a.renewsAt, todayKey) ?? 99;
    if (days <= 30) items.push({ kind: 'renewal', rank: 4, tone: days <= 7 ? 'error' : 'warn', title: `Renovar ${a.name}`, context: a.kindLabel ?? 'Serviço', date: a.renewsAt, href: '#/infrastructure', id: a.id });
  }
  for (const t of tasks) {
    if (t.status === 'done' || !t.dueDate || t.dueDate > todayKey) continue;
    const who = t.assigneeId && t.assigneeId === me ? 'você' : t.assigneeName || '';
    items.push({ kind: 'task', rank: 6, tone: t.dueDate < todayKey ? 'error' : 'warn', title: t.title, context: [t.projectName, who].filter(Boolean).join(' · '), date: t.dueDate, href: `#/projects/${t.productId}`, id: t.id });
  }
  for (const p of proposals) {
    if (p.status !== 'sent') continue;
    items.push({ kind: 'proposal', rank: 7, tone: 'info', title: `${proposalNumber(p.number)} · ${p.title}`, context: [p.customerName, 'esperando resposta'].filter(Boolean).join(' · '), date: p.validUntil, href: `#/proposals/${p.id}` });
  }
  return items.sort((a, b) => a.rank - b.rank || (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.title.localeCompare(b.title, 'pt-BR'));
}
