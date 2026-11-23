// Caderno › Projetos, Tarefas, Reuniões e Documentos (estilo Notion, com ícones de linha).
// Projetos: os de cliente (Master) e os internos (páginas "project") juntos, em quadro ou tabela.
// Tarefas: todas (atas, projetos, soltas) em quadro, tabela ou calendário; adicionar rápido em
// linguagem natural e painel lateral para editar. Reuniões: lista e calendário. Documentos: tabela.

import { html, setHtml, createElement } from '../../shared/utils/dom.js';
import { formatDate, formatRelative, formatDateTime, normalize, initials } from '../../shared/utils/format.js';
import { icon } from '../../shared/components/icons.js';
import { emptyState, toast, toastError } from '../../shared/components/feedback.js';
import { confirmDialog } from '../../shared/components/dialog.js';
import { today } from '../../core/validate.js';
import { TASK_STATUS } from '../../core/projects.js';
import { PRODUCT_STATUS } from '../../core/catalog.js';
import {
  PROJECT_STATUS, PROJECT_BOARD, CLIENT_BUCKET, DOC_TYPES, PRIORITIES, priorityOf, pageIconName,
  progressOf, projectPageOf, monthGrid, parseQuickTask, spokenToQuick,
} from '../../core/notebook.js';
import { data } from '../../services/data.js';
import { aiWrite } from '../../shared/components/ai-write.js';
import { splitTaskMessages, parseSteps } from '../../core/ai-prompts.js';

/** @typedef {import('../../services/data.js').PageMeta} PageMeta */
/** @typedef {import('../../services/data.js').Task} Task */
/** @typedef {import('../../services/data.js').Product} Product */
/**
 * @typedef {Object} ViewCtx
 * @property {{ id: string, name: string }} org
 * @property {{ id: string, name: string } | null} user
 * @property {boolean} manage           edita o Caderno
 * @property {boolean} canTasks         cria/edita tarefas
 * @property {PageMeta[]} pages
 * @property {Map<string, PageMeta>} byId
 * @property {Task[]} tasks
 * @property {{ userId: string, name: string, email: string }[]} members
 * @property {Product[]} products
 * @property {AbortSignal} signal
 * @property {(options: Record<string, any>) => Promise<void>} create   cria página e abre
 * @property {() => void} refreshNav
 */

const WEEK = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Ícone de linha da página, com a cor escolhida. @param {{ icon?: string, kind?: string, iconColor?: string }} p */
export const pageIconHtml = (p) => html`<span class="pi ${p.iconColor ? `pi--${p.iconColor}` : ''}" aria-hidden="true">${icon(/** @type {any} */ (pageIconName(p)))}</span>`;
const title = (/** @type {{ title: string }} */ p) => p.title.trim() || 'Sem título';
const views = (/** @type {string} */ key) => localStorage.getItem(`dum.caderno.view.${key}`);
const remember = (/** @type {string} */ key, /** @type {string} */ value) => localStorage.setItem(`dum.caderno.view.${key}`, value);

/** Barra segmentada (vista/filtro). @param {string} name @param {{ key: string, label: string, icon?: any }[]} items @param {string} current */
const segmented = (name, items, current) => html`<div class="segmented nt-seg" role="tablist" aria-label="${name}">
  ${items.map((it) => html`<button type="button" role="tab" class="segmented__item" aria-selected="${it.key === current}" data-seg="${name}" data-key="${it.key}">${it.icon ? icon(it.icon) : ''}<span>${it.label}</span></button>`)}
</div>`;

/** @param {number | null} pct */
const progressBar = (pct) =>
  pct === null ? html`<span class="muted">—</span>` : html`<span class="pbar" title="${pct}% concluído"><span class="pbar__fill" data-pct="${pct}"></span></span><small class="mono">${pct}%</small>`;
/** CSP: larguras por CSSOM, nunca em atributo style. @param {HTMLElement} root */
const paintBars = (root) => root.querySelectorAll('.pbar__fill').forEach((el) => (/** @type {HTMLElement} */ (el).style.width = `${/** @type {HTMLElement} */ (el).dataset.pct}%`));

/** Projeto (unificado) de uma tarefa. @param {Task} t @param {ViewCtx} ctx */
function projectOfTask(t, ctx) {
  if (t.productId) {
    const p = ctx.products.find((x) => x.id === t.productId);
    return p ? { kind: /** @type {const} */ ('client'), id: p.id, name: p.name } : null;
  }
  const page = projectPageOf(t.pageId, ctx.byId);
  return page ? { kind: /** @type {const} */ ('internal'), id: page.id, name: title(page) } : null;
}

/** Todos os projetos (cliente + internos) no mesmo formato. @param {ViewCtx} ctx */
export function allProjects(ctx) {
  const meetings = ctx.pages.filter((p) => p.kind === 'meeting' && !p.archivedAt);
  const lastMeeting = (/** @type {(m: PageMeta) => boolean} */ test) =>
    meetings.filter(test).map((m) => m.meetingDate ?? m.createdAt.slice(0, 10)).sort().at(-1) ?? null;
  const client = ctx.products.map((p) => {
    const tasks = ctx.tasks.filter((t) => t.productId === p.id);
    return {
      kind: /** @type {const} */ ('client'), id: p.id, name: p.name, href: `#/projects/${p.id}`,
      bucket: CLIENT_BUCKET[/** @type {keyof typeof CLIENT_BUCKET} */ (p.status)] ?? 'planned',
      status: PRODUCT_STATUS.find((s) => s.key === p.status) ?? null, ownerName: p.ownerName, dueDate: p.dueDate ?? null,
      progress: progressOf(tasks), open: tasks.filter((t) => t.status !== 'done').length,
      lastMeeting: lastMeeting((m) => m.productId === p.id), icon: { icon: p.kind === 'system' ? 'code' : 'globe', kind: 'project', iconColor: 'blue' },
      updatedAt: p.updatedAt,
    };
  });
  const internal = ctx.pages.filter((p) => p.kind === 'project' && !p.archivedAt).map((p) => {
    const tasks = ctx.tasks.filter((t) => t.pageId && projectPageOf(t.pageId, ctx.byId)?.id === p.id);
    const status = PROJECT_STATUS.find((s) => s.key === p.props?.status) ?? PROJECT_STATUS[1];
    return {
      kind: /** @type {const} */ ('internal'), id: p.id, name: title(p), href: `#/workspace/${p.id}`, bucket: status.key, status,
      ownerName: ctx.members.find((m) => m.userId === p.props?.ownerId)?.name ?? '', dueDate: p.props?.dueDate ?? null,
      progress: progressOf(tasks), open: tasks.filter((t) => t.status !== 'done').length,
      lastMeeting: lastMeeting((m) => projectPageOf(m.id, ctx.byId)?.id === p.id), icon: p, updatedAt: p.updatedAt,
    };
  });
  return [...internal, ...client];
}

// Projetos -------------------------------------------------------------------------------------------
/** @param {HTMLElement} main @param {ViewCtx} ctx */
export function renderProjects(main, ctx) {
  let view = views('projects') ?? 'board';
  let filter = views('projects.filter') ?? 'all';
  const draw = () => {
    const list = allProjects(ctx).filter((p) => filter === 'all' || (filter === 'client' ? p.kind === 'client' : p.kind === 'internal'));
    const todayKey = today();
    const card = (/** @type {ReturnType<typeof allProjects>[number]} */ p) => html`<article class="kb-card ${p.kind === 'internal' && ctx.manage ? 'is-draggable' : ''}" ${p.kind === 'internal' && ctx.manage ? html`draggable="true"` : ''} data-project="${p.id}">
        <a class="kb-card__title" href="${p.href}">${pageIconHtml(p.icon)}<span>${p.name}</span></a>
        <div class="kb-card__meta">
          <span class="nt-chip ${p.kind === 'client' ? 'nt-chip--blue' : ''}">${p.kind === 'client' ? 'Cliente' : 'Interno'}</span>
          ${p.kind === 'client' && p.status ? html`<span class="muted">${p.status.label}</span>` : ''}
        </div>
        <div class="kb-card__progress">${progressBar(p.progress.pct)}</div>
        <div class="kb-card__foot">
          ${p.ownerName ? html`<span class="avatar avatar--xs" title="${p.ownerName}">${initials(p.ownerName)}</span>` : html`<span></span>`}
          ${p.dueDate ? html`<span class="nt-due ${p.dueDate < todayKey && p.bucket !== 'done' ? 'is-late' : ''}">${icon('calendar')}${formatDate(p.dueDate)}</span>` : ''}
          ${p.open ? html`<span class="muted">${p.open} aberta${p.open === 1 ? '' : 's'}</span>` : ''}
        </div>
      </article>`;
    setHtml(
      main,
      html`<header class="page-head">
          <div><h1 class="page-title nt-title">${icon('folder')}<span>Projetos</span></h1><p class="page-sub">Projetos de clientes e internos, com tarefas, reuniões e progresso</p></div>
          ${ctx.manage ? html`<div class="page-actions"><button type="button" class="btn btn--primary" data-nt="new-project">${icon('plus')}<span>Novo projeto interno</span></button></div>` : ''}
        </header>
        <div class="nt-bar">
          ${segmented('view', [{ key: 'board', label: 'Quadro', icon: 'columns' }, { key: 'table', label: 'Tabela', icon: 'table' }], view)}
          ${segmented('filter', [{ key: 'all', label: 'Todos' }, { key: 'internal', label: 'Internos' }, { key: 'client', label: 'Clientes' }], filter)}
          <span class="muted nt-count">${list.length} projeto${list.length === 1 ? '' : 's'}</span>
        </div>
        ${!list.length
          ? emptyState({ title: 'Nenhum projeto aqui', text: ctx.manage ? 'Crie um projeto interno (marketing, processo, ideia) ou um projeto de cliente em Projetos.' : '', compact: true })
          : view === 'board'
            ? html`<div class="kb" data-board="project">${PROJECT_BOARD.map((key) => {
                const col = list.filter((p) => p.bucket === key);
                const st = PROJECT_STATUS.find((s) => s.key === key);
                return html`<section class="kb-col" data-col="${key}" aria-label="${st?.label ?? key}">
                  <header class="kb-col__head"><span class="nt-dot nt-dot--${st?.tone ?? 'muted'}"></span><strong>${st?.label}</strong><small>${col.length}</small></header>
                  <div class="kb-col__body">${col.map(card)}</div>
                </section>`;
              })}</div>`
            : html`<div class="table-wrap"><table class="nt-table">
                <thead><tr><th>Projeto</th><th>Tipo</th><th>Status</th><th>Responsável</th><th>Prazo</th><th>Progresso</th><th class="hide-mobile">Última reunião</th></tr></thead>
                <tbody>${list.map((p) => html`<tr>
                  <td><a class="nt-link" href="${p.href}">${pageIconHtml(p.icon)}<span>${p.name}</span></a></td>
                  <td><span class="nt-chip ${p.kind === 'client' ? 'nt-chip--blue' : ''}">${p.kind === 'client' ? 'Cliente' : 'Interno'}</span></td>
                  <td>${p.kind === 'client' ? html`<span class="muted">${p.status?.label ?? '—'}</span>` : html`<span class="status-pill status-pill--${p.status?.tone ?? 'info'}">${p.status?.label}</span>`}</td>
                  <td>${p.ownerName || html`<span class="muted">—</span>`}</td>
                  <td class="mono">${p.dueDate ? formatDate(p.dueDate) : html`<span class="muted">—</span>`}</td>
                  <td><span class="nt-progress">${progressBar(p.progress.pct)}</span></td>
                  <td class="hide-mobile mono">${p.lastMeeting ? formatDate(p.lastMeeting) : html`<span class="muted">—</span>`}</td>
                </tr>`)}</tbody></table></div>`}`,
    );
    paintBars(main);
  };
  main.addEventListener('click', async (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    const seg = /** @type {HTMLElement | null} */ (el.closest('[data-seg]'));
    if (seg) {
      if (seg.dataset.seg === 'view') remember('projects', (view = String(seg.dataset.key)));
      else remember('projects.filter', (filter = String(seg.dataset.key)));
      return draw();
    }
    if (el.closest('[data-nt="new-project"]')) await ctx.create({ templateId: 'project', props: { status: 'planned', ownerId: ctx.user?.id ?? null } });
  }, { signal: ctx.signal });
  boardDrag(main, ctx.signal, 'project', async (id, col) => {
    const page = ctx.byId.get(id);
    if (!page || page.props?.status === col) return;
    try {
      const props = { ...(page.props ?? {}), status: col };
      await data.pages.save(ctx.org.id, id, { props });
      page.props = props;
      draw();
    } catch (error) {
      toastError(error);
    }
  });
  draw();
}

/** Arrastar cartões entre colunas (HTML5 drag & drop). @param {HTMLElement} root @param {AbortSignal} signal @param {string} board @param {(id: string, col: string) => void} onDrop */
function boardDrag(root, signal, board, onDrop) {
  /** @type {string | null} */
  let dragging = null;
  const key = board === 'project' ? 'project' : 'task';
  root.addEventListener('dragstart', (e) => {
    const card = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest?.(`[data-${key}][draggable="true"]`));
    if (!card) return;
    dragging = card.dataset[key] ?? null;
    e.dataTransfer?.setData('text/plain', dragging ?? '');
    card.classList.add('is-dragging');
  }, { signal });
  root.addEventListener('dragover', (e) => {
    const col = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest?.(`[data-board="${board}"] [data-col]`));
    if (!dragging || !col) return;
    e.preventDefault();
    root.querySelectorAll('.kb-col.is-over').forEach((c) => c.classList.remove('is-over'));
    col.classList.add('is-over');
  }, { signal });
  root.addEventListener('drop', (e) => {
    const col = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest?.(`[data-board="${board}"] [data-col]`));
    if (!dragging || !col) return;
    e.preventDefault();
    const id = dragging;
    dragging = null;
    onDrop(id, String(col.dataset.col));
  }, { signal });
  root.addEventListener('dragend', () => {
    dragging = null;
    root.querySelectorAll('.is-dragging, .is-over').forEach((c) => c.classList.remove('is-dragging', 'is-over'));
  }, { signal });
}

// Tarefas ---------------------------------------------------------------------------------------------
/**
 * @param {HTMLElement} main @param {ViewCtx} ctx
 * @param {{ projectPageId?: string }} [scope]   dentro de um projeto interno: só as dele
 */
export function renderTasks(main, ctx, scope = {}) {
  const scoped = Boolean(scope.projectPageId);
  let view = scoped ? 'table' : views('tasks') ?? 'board';
  let mine = !scoped && views('tasks.mine') === '1';
  let showDone = views('tasks.done') === '1';
  let project = '';
  let who = '';
  let prio = '';
  let month = today().slice(0, 7);
  const projects = allProjects(ctx);
  const todayKey = today();

  const visible = () =>
    ctx.tasks.filter((t) => {
      const p = projectOfTask(t, ctx);
      if (scoped) return p?.kind === 'internal' && p.id === scope.projectPageId && (showDone || t.status !== 'done');
      if (mine && t.assigneeId !== ctx.user?.id) return false;
      if (!showDone && t.status === 'done' && view !== 'board') return false;
      if (project === 'none' ? p : project && p?.id !== project) return false;
      if (who && (who === 'none' ? t.assigneeId : t.assigneeId !== who)) return false;
      if (prio && (prio === 'none' ? t.priority : t.priority !== prio)) return false;
      return true;
    });

  const prioBadge = (/** @type {Task} */ t) => {
    const p = priorityOf(t.priority);
    return p ? html`<span class="prio prio--${p.key}" title="Prioridade ${p.label}">${icon('flag')}${p.label}</span>` : '';
  };
  const due = (/** @type {Task} */ t) =>
    t.dueDate ? html`<span class="nt-due ${t.status !== 'done' && t.dueDate < todayKey ? 'is-late' : t.dueDate === todayKey ? 'is-today' : ''}">${icon('calendar')}${t.dueDate === todayKey ? 'hoje' : formatDate(t.dueDate).slice(0, 5)}</span>` : '';
  const sourceOf = (/** @type {Task} */ t) => {
    const page = t.pageId ? ctx.byId.get(t.pageId) : null;
    return page && page.kind !== 'project' ? html`<a class="nt-src" href="#/workspace/${page.id}" title="Origem">${pageIconHtml(page)}<span>${title(page)}</span></a>` : '';
  };

  const drawBoard = (/** @type {Task[]} */ list) => html`<div class="kb" data-board="task">${TASK_STATUS.map((s) => {
      const col = list.filter((t) => t.status === s.key).sort((a, b) => (priorityOf(a.priority)?.rank ?? 9) - (priorityOf(b.priority)?.rank ?? 9) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
      const shown = s.key === 'done' && !showDone ? col.slice(0, 8) : col;
      return html`<section class="kb-col" data-col="${s.key}" aria-label="${s.label}">
        <header class="kb-col__head"><span class="nt-dot nt-dot--${s.key === 'done' ? 'ok' : s.key === 'doing' ? 'warn' : 'muted'}"></span><strong>${s.label}</strong><small>${col.length}</small></header>
        <div class="kb-col__body">${shown.map((t) => {
          const p = projectOfTask(t, ctx);
          return html`<article class="kb-card ${ctx.canTasks ? 'is-draggable' : ''} ${t.status === 'done' ? 'is-done' : ''}" ${ctx.canTasks ? html`draggable="true"` : ''} data-task="${t.id}">
            <button type="button" class="kb-card__title kb-card__open" data-open="${t.id}">${t.title}</button>
            ${t.priority || t.dueDate || p ? html`<div class="kb-card__meta">${prioBadge(t)}${due(t)}${p ? html`<span class="nt-chip">${p.name}</span>` : ''}</div>` : ''}
            <div class="kb-card__foot">${t.assigneeName ? html`<span class="avatar avatar--xs" title="${t.assigneeName}">${initials(t.assigneeName)}</span>` : html`<span class="muted">sem responsável</span>`}${sourceOf(t)}</div>
          </article>`;
        })}${s.key === 'done' && col.length > shown.length ? html`<button type="button" class="link-action kb-more" data-nt="show-done">Ver as ${col.length} feitas</button>` : ''}</div>
      </section>`;
    })}</div>`;

  const memberOpts = (/** @type {string | null} */ selected) => html`<option value="">—</option>${ctx.members.map((m) => html`<option value="${m.userId}" ${selected === m.userId ? html`selected` : ''}>${m.name}</option>`)}`;
  const drawTable = (/** @type {Task[]} */ list) => html`<div class="table-wrap"><table class="nt-table nt-table--tasks">
      <thead><tr><th class="nt-col-check"><span class="sr-only">Feita</span></th><th>Tarefa</th><th>Status</th><th>Prioridade</th><th>Responsável</th><th>Prazo</th>${scoped ? '' : html`<th class="hide-mobile">Projeto</th>`}</tr></thead>
      <tbody>${list
        .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
        .map((t) => {
          const p = projectOfTask(t, ctx);
          const dis = ctx.canTasks ? '' : html`disabled`;
          return html`<tr class="${t.status === 'done' ? 'is-done' : ''}" data-row="${t.id}">
            <td class="nt-col-check"><button type="button" class="ed-check ${t.status === 'done' ? 'is-on' : ''}" data-done="${t.id}" aria-label="Concluir ${t.title}" ${dis}></button></td>
            <td><button type="button" class="nt-task-title" data-open="${t.id}">${t.title}</button>${sourceOf(t)}</td>
            <td><select class="input input--sm nt-inline" data-field="status" data-id="${t.id}" ${dis}>${TASK_STATUS.map((s) => html`<option value="${s.key}" ${t.status === s.key ? html`selected` : ''}>${s.label}</option>`)}</select></td>
            <td><select class="input input--sm nt-inline" data-field="priority" data-id="${t.id}" ${dis}><option value="">—</option>${PRIORITIES.map((p) => html`<option value="${p.key}" ${t.priority === p.key ? html`selected` : ''}>${p.label}</option>`)}</select></td>
            <td><select class="input input--sm nt-inline" data-field="assigneeId" data-id="${t.id}" ${dis}>${memberOpts(t.assigneeId)}</select></td>
            <td><input class="input input--sm nt-inline ${t.status !== 'done' && t.dueDate && t.dueDate < todayKey ? 'is-late' : ''}" type="date" data-field="dueDate" data-id="${t.id}" value="${t.dueDate ?? ''}" ${dis}></td>
            ${scoped ? '' : html`<td class="hide-mobile">${p ? html`<span class="nt-chip ${p.kind === 'client' ? 'nt-chip--blue' : ''}">${p.name}</span>` : html`<span class="muted">—</span>`}</td>`}
          </tr>`;
        })}</tbody></table></div>`;

  const drawCalendar = (/** @type {Task[]} */ list) => {
    const [y, m] = month.split('-').map(Number);
    const meetings = ctx.pages.filter((p) => p.kind === 'meeting' && !p.archivedAt && p.meetingDate?.startsWith(month));
    return html`<div class="cal">
      <header class="cal__head">
        <button type="button" class="icon-btn" data-month="-1" aria-label="Mês anterior">${icon('arrowLeft')}</button>
        <strong>${monthName.format(new Date(Date.UTC(y, m - 1, 1)))}</strong>
        <button type="button" class="icon-btn" data-month="1" aria-label="Próximo mês">${icon('arrowRight')}</button>
        <button type="button" class="btn btn--ghost btn--sm" data-month="0">Hoje</button>
      </header>
      <div class="cal__grid" role="grid">
        ${WEEK.map((d) => html`<div class="cal__dow" role="columnheader">${d}</div>`)}
        ${monthGrid(y, m).flat().map((d) => {
          const dayTasks = list.filter((t) => t.dueDate === d.date);
          const dayMeetings = meetings.filter((p) => p.meetingDate === d.date);
          return html`<div class="cal__day ${d.inMonth ? '' : 'is-out'} ${d.date === todayKey ? 'is-today' : ''}" role="gridcell">
            <span class="cal__num">${Number(d.date.slice(8))}</span>
            ${dayMeetings.map((p) => html`<a class="cal__item cal__item--meeting" href="#/workspace/${p.id}">${icon('mic')}<span>${title(p)}</span></a>`)}
            ${dayTasks.slice(0, 4).map((t) => html`<button type="button" class="cal__item ${t.status === 'done' ? 'is-done' : ''} ${priorityOf(t.priority) ? `cal__item--${t.priority}` : ''}" data-open="${t.id}">${t.title}</button>`)}
            ${dayTasks.length > 4 ? html`<small class="muted">+${dayTasks.length - 4}</small>` : ''}
          </div>`;
        })}
      </div>
    </div>`;
  };

  const draw = () => {
    const list = visible();
    setHtml(
      main,
      html`${scoped
          ? ''
          : html`<header class="page-head"><div><h1 class="page-title nt-title">${icon('listChecks')}<span>Tarefas</span></h1><p class="page-sub">Todas as tarefas: das atas, dos projetos e as soltas</p></div></header>`}
        ${ctx.canTasks
          ? html`<form class="qa" data-quick>
              <span class="qa__icon" aria-hidden="true">${icon('plus')}</span>
              <input class="qa__input" name="q" autocomplete="off" placeholder="${scoped ? 'Nova tarefa do projeto… ex.: Revisar textos @Bia sexta !alta' : 'Nova tarefa… ex.: Revisar layout @Bia sexta !alta #Site Padaria'}" aria-label="Nova tarefa">
              <span class="qa__preview" data-preview></span>
              <button type="button" class="icon-btn qa__mic" data-nt="dictate" title="Ditar a tarefa" aria-label="Ditar a tarefa">${icon('mic')}</button>
              <button type="submit" class="btn btn--primary btn--sm">Adicionar</button>
            </form>`
          : ''}
        <div class="nt-bar">
          ${scoped ? '' : segmented('view', [{ key: 'board', label: 'Quadro', icon: 'columns' }, { key: 'table', label: 'Tabela', icon: 'table' }, { key: 'calendar', label: 'Calendário', icon: 'calendar' }], view)}
          ${scoped ? '' : html`<button type="button" class="chip-btn ${mine ? 'is-on' : ''}" data-nt="mine" aria-pressed="${mine}">${icon('user')}<span>Minhas</span></button>`}
          ${scoped
            ? ''
            : html`<select class="input input--sm" data-filter="project" aria-label="Projeto"><option value="">Todos os projetos</option><option value="none" ${project === 'none' ? html`selected` : ''}>Sem projeto</option>
                ${projects.map((p) => html`<option value="${p.id}" ${project === p.id ? html`selected` : ''}>${p.name}</option>`)}</select>
              <select class="input input--sm" data-filter="who" aria-label="Responsável"><option value="">Todos</option><option value="none" ${who === 'none' ? html`selected` : ''}>Sem responsável</option>${ctx.members.map((m) => html`<option value="${m.userId}" ${who === m.userId ? html`selected` : ''}>${m.name}</option>`)}</select>
              <select class="input input--sm" data-filter="prio" aria-label="Prioridade"><option value="">Qualquer prioridade</option>${PRIORITIES.map((p) => html`<option value="${p.key}" ${prio === p.key ? html`selected` : ''}>${p.label}</option>`)}</select>`}
          <label class="checkbox nt-done"><input type="checkbox" data-nt="done" ${showDone ? html`checked` : ''}> <span>Mostrar feitas</span></label>
          <span class="muted nt-count">${list.filter((t) => t.status !== 'done').length} aberta(s)</span>
        </div>
        ${!list.length && view !== 'calendar'
          ? emptyState({ title: 'Nenhuma tarefa aqui', text: ctx.canTasks ? 'Escreva acima: "Revisar layout @Bia sexta !alta".' : '', compact: true })
          : view === 'board' ? drawBoard(list) : view === 'calendar' ? drawCalendar(list) : drawTable(list)}`,
    );
  };

  /** @param {Task} t @param {Record<string, any>} changes */
  async function saveTask(t, changes) {
    const next = { ...t, ...changes };
    await data.tasks.save(ctx.org.id, /** @type {any} */ (next), t.id);
    const member = ctx.members.find((m) => m.userId === next.assigneeId);
    Object.assign(t, changes, { assigneeName: member?.name ?? '', doneAt: next.status === 'done' ? t.doneAt ?? new Date().toISOString() : null });
  }

  const preview = () => {
    const input = /** @type {HTMLInputElement | null} */ (main.querySelector('[data-quick] [name="q"]'));
    const box = main.querySelector('[data-preview]');
    if (!input || !box) return;
    const q = parseQuickTask(input.value, { members: ctx.members, projects, todayKey });
    const bits = [
      q.assigneeName && `${q.assigneeName}`,
      q.dueDate && `prazo ${formatDate(q.dueDate)}`,
      q.priority && `prioridade ${priorityOf(q.priority)?.label.toLowerCase()}`,
      q.project && `${q.project.name}`,
    ].filter(Boolean);
    box.textContent = bits.join(' · ');
  };

  main.addEventListener('input', (e) => {
    if (/** @type {HTMLElement} */ (e.target).matches('[data-quick] [name="q"]')) preview();
  }, { signal: ctx.signal });

  main.addEventListener('submit', async (e) => {
    const form = /** @type {HTMLFormElement} */ (e.target);
    if (!form.matches('[data-quick]')) return;
    e.preventDefault();
    const input = /** @type {HTMLInputElement} */ (form.querySelector('[name="q"]'));
    const q = parseQuickTask(input.value, { members: ctx.members, projects, todayKey });
    if (q.title.length < 2) return toast('Escreva o que precisa ser feito.', 'info');
    const projectId = scope.projectPageId ? { kind: 'internal', id: scope.projectPageId } : q.project;
    const input_ = {
      title: q.title, status: 'todo', assigneeId: q.assigneeId, dueDate: q.dueDate, priority: q.priority, description: '', position: 0,
      productId: projectId?.kind === 'client' ? projectId.id : null,
      pageId: projectId?.kind === 'internal' ? projectId.id : null,
    };
    try {
      const id = await data.tasks.save(ctx.org.id, /** @type {any} */ (input_));
      ctx.tasks.unshift(/** @type {any} */ ({ ...input_, id, assigneeName: q.assigneeName ?? '', projectName: '', pageTitle: '', doneAt: null, createdAt: new Date().toISOString() }));
      input.value = '';
      draw();
      /** @type {HTMLInputElement | null} */ (main.querySelector('[data-quick] [name="q"]'))?.focus();
    } catch (error) {
      toastError(error);
    }
  }, { signal: ctx.signal });

  main.addEventListener('click', async (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    const seg = /** @type {HTMLElement | null} */ (el.closest('[data-seg]'));
    if (seg) {
      remember('tasks', (view = String(seg.dataset.key)));
      return draw();
    }
    if (el.closest('[data-nt="mine"]')) {
      mine = !mine;
      remember('tasks.mine', mine ? '1' : '0');
      return draw();
    }
    if (el.closest('[data-nt="show-done"]')) {
      showDone = true;
      remember('tasks.done', '1');
      return draw();
    }
    if (el.closest('[data-nt="dictate"]')) {
      try {
        const { dictate } = await import('./dictate.js');
        const text = await dictate({ title: 'Ditar tarefa', hint: 'Ex.: "Revisar o layout pra Bia até sexta, prioridade alta".' });
        const input = /** @type {HTMLInputElement | null} */ (main.querySelector('[data-quick] [name="q"]'));
        if (!text || !input) return;
        input.value = spokenToQuick(text, ctx.members);
        preview();
        input.focus();
      } catch (error) {
        toastError(error);
      }
      return;
    }
    const monthBtn = /** @type {HTMLElement | null} */ (el.closest('[data-month]'));
    if (monthBtn) {
      const step = Number(monthBtn.dataset.month);
      if (!step) month = today().slice(0, 7);
      else {
        const [y, m] = month.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1 + step, 1));
        month = d.toISOString().slice(0, 7);
      }
      return draw();
    }
    const done = /** @type {HTMLElement | null} */ (el.closest('[data-done]'));
    if (done) {
      const t = ctx.tasks.find((x) => x.id === done.dataset.done);
      if (!t) return;
      try {
        await saveTask(t, { status: t.status === 'done' ? 'todo' : 'done' });
        draw();
      } catch (error) {
        toastError(error);
      }
      return;
    }
    const open = /** @type {HTMLElement | null} */ (el.closest('[data-open]'));
    if (open) {
      const t = ctx.tasks.find((x) => x.id === open.dataset.open);
      if (t) taskPanel(t, ctx, { save: saveTask, onChange: draw, projectOfTask: (x) => projectOfTask(x, ctx) });
    }
  }, { signal: ctx.signal });

  main.addEventListener('change', async (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (el.matches('[data-nt="done"]')) {
      showDone = el.checked;
      remember('tasks.done', showDone ? '1' : '0');
      return draw();
    }
    if (el.dataset.filter) {
      if (el.dataset.filter === 'project') project = el.value;
      if (el.dataset.filter === 'who') who = el.value;
      if (el.dataset.filter === 'prio') prio = el.value;
      return draw();
    }
    if (el.dataset.field && el.dataset.id) {
      const t = ctx.tasks.find((x) => x.id === el.dataset.id);
      if (!t) return;
      try {
        await saveTask(t, { [el.dataset.field]: el.value || null });
        if (el.dataset.field === 'status') draw();
      } catch (error) {
        toastError(error);
        draw();
      }
    }
  }, { signal: ctx.signal });

  boardDrag(main, ctx.signal, 'task', async (id, col) => {
    const t = ctx.tasks.find((x) => x.id === id);
    if (!t || t.status === col) return draw();
    try {
      await saveTask(t, { status: col });
    } catch (error) {
      toastError(error);
    }
    draw();
  });
  draw();
}

/**
 * Painel lateral (como o "peek" do Notion): edita a tarefa e salva a cada mudança.
 * @param {Task} t @param {ViewCtx} ctx
 * @param {{ save: (t: Task, changes: Record<string, any>) => Promise<void>, onChange: () => void, projectOfTask: (t: Task) => { kind: string, id: string, name: string } | null }} opts
 */
export function taskPanel(t, ctx, opts) {
  document.querySelector('.tp')?.remove();
  const p = opts.projectOfTask(t);
  const page = t.pageId ? ctx.byId.get(t.pageId) : null;
  const dis = ctx.canTasks ? '' : html`disabled`;
  const panel = createElement(html`<aside class="tp" role="dialog" aria-label="Tarefa" tabindex="-1">
    <header class="tp__head">
      <button type="button" class="icon-btn" data-tp="close" aria-label="Fechar">${icon('x')}</button>
      ${ctx.canTasks
        ? html`<span class="tp__tools">
            <button type="button" class="btn btn--ghost btn--sm" data-tp="split" title="A IA divide em tarefas menores">${icon('sparkles')}<span>Dividir em partes</span></button>
            <button type="button" class="icon-btn" data-tp="delete" aria-label="Excluir tarefa" title="Excluir">${icon('trash')}</button>
          </span>`
        : ''}
    </header>
    <textarea class="tp__title" name="title" rows="1" maxlength="200" ${dis}>${t.title}</textarea>
    <dl class="props">
      <div><dt>${icon('checkCircle')}Status</dt><dd><select class="input input--sm" name="status" ${dis}>${TASK_STATUS.map((s) => html`<option value="${s.key}" ${t.status === s.key ? html`selected` : ''}>${s.label}</option>`)}</select></dd></div>
      <div><dt>${icon('flag')}Prioridade</dt><dd><select class="input input--sm" name="priority" ${dis}><option value="">—</option>${PRIORITIES.map((x) => html`<option value="${x.key}" ${t.priority === x.key ? html`selected` : ''}>${x.label}</option>`)}</select></dd></div>
      <div><dt>${icon('user')}Responsável</dt><dd><select class="input input--sm" name="assigneeId" ${dis}><option value="">—</option>${ctx.members.map((m) => html`<option value="${m.userId}" ${t.assigneeId === m.userId ? html`selected` : ''}>${m.name}</option>`)}</select></dd></div>
      <div><dt>${icon('calendar')}Prazo</dt><dd><input class="input input--sm" type="date" name="dueDate" value="${t.dueDate ?? ''}" ${dis}></dd></div>
      <div><dt>${icon('folder')}Projeto</dt><dd>${p ? html`<a class="nt-link" href="${p.kind === 'client' ? `#/projects/${p.id}` : `#/workspace/${p.id}`}">${p.name}</a>` : html`<span class="muted">Sem projeto</span>`}</dd></div>
      ${page && page.kind !== 'project' ? html`<div><dt>${icon('fileText')}Origem</dt><dd><a class="nt-link" href="#/workspace/${page.id}">${pageIconHtml(page)}<span>${title(page)}</span></a></dd></div>` : ''}
      <div><dt>${icon('clock')}Criada</dt><dd class="muted" title="${formatDateTime(t.createdAt)}">${formatRelative(t.createdAt)}</dd></div>
    </dl>
    <label class="field tp__desc"><span class="field__label">Descrição</span><textarea class="input" name="description" rows="8" maxlength="5000" placeholder="Detalhes, links, como fazer…" ${dis}>${t.description ?? ''}</textarea></label>
    <p class="tp__status muted" data-tp-status></p>
  </aside>`);
  document.body.append(panel);
  requestAnimationFrame(() => panel.classList.add('is-open'));
  panel.focus();
  const status = /** @type {HTMLElement} */ (panel.querySelector('[data-tp-status]'));
  const ac = new AbortController();
  const close = () => {
    ac.abort();
    panel.classList.remove('is-open');
    setTimeout(() => panel.remove(), 180);
    opts.onChange();
  };
  const save = async (/** @type {Record<string, any>} */ changes) => {
    status.textContent = 'Salvando…';
    try {
      await opts.save(t, changes);
      status.textContent = 'Salvo';
    } catch (error) {
      status.textContent = '';
      toastError(error);
    }
  };
  /** A IA propõe os passos; a pessoa revisa e cada linha vira uma tarefa do mesmo projeto. */
  const splitTask = async () => {
    const text = await aiWrite(splitTaskMessages(t.title, t.description ?? ''), { title: 'Dividir em partes', useLabel: 'Criar as tarefas', maxTokens: 350 });
    if (!text) return;
    const steps = parseSteps(text);
    if (!steps.length) return toast('Não achei passos no texto. Deixe um por linha.', 'info');
    try {
      for (const [i, stepTitle] of steps.entries()) {
        const input = {
          title: stepTitle, status: 'todo', assigneeId: t.assigneeId ?? null, dueDate: t.dueDate ?? null, priority: t.priority ?? null,
          description: `Parte de “${t.title}”.`, position: i, productId: t.productId ?? null, pageId: t.pageId ?? null,
        };
        const id = await data.tasks.save(ctx.org.id, /** @type {any} */ (input));
        ctx.tasks.push(/** @type {any} */ ({ ...input, id, assigneeName: t.assigneeName, projectName: t.projectName, pageTitle: t.pageTitle, doneAt: null, createdAt: new Date().toISOString() }));
      }
      toast(`${steps.length} tarefas criadas a partir de “${t.title}”.`, 'success');
      close();
    } catch (error) {
      toastError(error);
    }
  };
  let titleTimer = 0;
  panel.addEventListener('change', (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (!el.name || el.name === 'title' || el.name === 'description') return;
    save({ [el.name]: el.value || null });
  }, { signal: ac.signal });
  panel.addEventListener('input', (e) => {
    const el = /** @type {HTMLTextAreaElement} */ (e.target);
    if (el.name !== 'title' && el.name !== 'description') return;
    clearTimeout(titleTimer);
    titleTimer = window.setTimeout(() => {
      const value = el.value.replace(el.name === 'title' ? /\s+/g : /\r/g, el.name === 'title' ? ' ' : '').trim();
      if (el.name === 'title' && value.length < 2) return;
      save({ [el.name]: value });
    }, 600);
  }, { signal: ac.signal });
  panel.addEventListener('click', async (e) => {
    const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-tp]'));
    if (!btn) return;
    if (btn.dataset.tp === 'close') return close();
    if (btn.dataset.tp === 'split') return splitTask();
    if (btn.dataset.tp === 'delete' && (await confirmDialog({ title: 'Excluir tarefa?', message: `“${t.title}” sai de todas as listas.`, confirmLabel: 'Excluir', danger: true }))) {
      try {
        await data.tasks.remove(ctx.org.id, t.id);
        const i = ctx.tasks.findIndex((x) => x.id === t.id);
        if (i >= 0) ctx.tasks.splice(i, 1);
        toast('Tarefa excluída.', 'success');
        close();
      } catch (error) {
        toastError(error);
      }
    }
  }, { signal: ac.signal });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !document.querySelector('dialog[open]') && close(), { signal: ac.signal });
  document.addEventListener('pointerdown', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!panel.contains(target) && !target.closest('dialog, [data-open]')) close();
  }, { signal: ac.signal, capture: true });
  window.addEventListener('hashchange', close, { signal: ac.signal });
}

// Reuniões ---------------------------------------------------------------------------------------------
/** @param {HTMLElement} main @param {ViewCtx} ctx */
export function renderMeetings(main, ctx) {
  let view = views('meetings') ?? 'list';
  let month = today().slice(0, 7);
  const draw = () => {
    const meetings = ctx.pages.filter((p) => p.kind === 'meeting' && !p.archivedAt).sort((a, b) => (b.meetingDate ?? b.createdAt).localeCompare(a.meetingDate ?? a.createdAt));
    const projectName = (/** @type {PageMeta} */ m) => {
      if (m.productId) return ctx.products.find((p) => p.id === m.productId)?.name ?? '';
      const p = projectPageOf(m.parentId, ctx.byId);
      return p ? title(p) : '';
    };
    const [y, mo] = month.split('-').map(Number);
    const todayKey = today();
    setHtml(
      main,
      html`<header class="page-head">
          <div><h1 class="page-title nt-title">${icon('mic')}<span>Reuniões</span></h1><p class="page-sub">Gravadas, transcritas e com ata — tudo no seu computador</p></div>
          ${ctx.manage ? html`<div class="page-actions"><button type="button" class="btn btn--primary" data-nt="new-meeting">${icon('plus')}<span>Nova reunião</span></button></div>` : ''}
        </header>
        <div class="nt-bar">${segmented('view', [{ key: 'list', label: 'Lista', icon: 'list' }, { key: 'calendar', label: 'Calendário', icon: 'calendar' }], view)}<span class="muted nt-count">${meetings.length} reuniõe${meetings.length === 1 ? 'ão' : 's'}</span></div>
        ${!meetings.length
          ? emptyState({ title: 'Nenhuma reunião ainda', text: 'Grave, envie um áudio ou cole a transcrição: a ata e as tarefas saem sozinhas.', compact: true })
          : view === 'list'
            ? html`<div class="table-wrap"><table class="nt-table">
                <thead><tr><th>Data</th><th>Reunião</th><th class="hide-mobile">Projeto</th><th>Tarefas abertas</th><th class="hide-mobile">Editada</th></tr></thead>
                <tbody>${meetings.map((m) => {
                  const open = ctx.tasks.filter((t) => t.pageId === m.id && t.status !== 'done').length;
                  return html`<tr>
                    <td class="mono">${m.meetingDate ? formatDate(m.meetingDate) : formatDate(m.createdAt.slice(0, 10))}</td>
                    <td><a class="nt-link" href="#/workspace/${m.id}">${pageIconHtml(m)}<span>${title(m)}</span></a></td>
                    <td class="hide-mobile">${projectName(m) ? html`<span class="nt-chip">${projectName(m)}</span>` : html`<span class="muted">—</span>`}</td>
                    <td>${open ? html`<span class="nt-chip nt-chip--warn">${open}</span>` : html`<span class="muted">—</span>`}</td>
                    <td class="hide-mobile muted">${formatRelative(m.updatedAt)}</td>
                  </tr>`;
                })}</tbody></table></div>`
            : html`<div class="cal">
                <header class="cal__head">
                  <button type="button" class="icon-btn" data-month="-1" aria-label="Mês anterior">${icon('arrowLeft')}</button>
                  <strong>${monthName.format(new Date(Date.UTC(y, mo - 1, 1)))}</strong>
                  <button type="button" class="icon-btn" data-month="1" aria-label="Próximo mês">${icon('arrowRight')}</button>
                  <button type="button" class="btn btn--ghost btn--sm" data-month="0">Hoje</button>
                </header>
                <div class="cal__grid">${WEEK.map((d) => html`<div class="cal__dow">${d}</div>`)}
                  ${monthGrid(y, mo).flat().map((d) => html`<div class="cal__day ${d.inMonth ? '' : 'is-out'} ${d.date === todayKey ? 'is-today' : ''}"><span class="cal__num">${Number(d.date.slice(8))}</span>
                    ${meetings.filter((m) => (m.meetingDate ?? m.createdAt.slice(0, 10)) === d.date).map((m) => html`<a class="cal__item cal__item--meeting" href="#/workspace/${m.id}">${icon('mic')}<span>${title(m)}</span></a>`)}</div>`)}
                </div></div>`}`,
    );
  };
  main.addEventListener('click', async (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    const seg = /** @type {HTMLElement | null} */ (el.closest('[data-seg]'));
    if (seg) {
      remember('meetings', (view = String(seg.dataset.key)));
      return draw();
    }
    const monthBtn = /** @type {HTMLElement | null} */ (el.closest('[data-month]'));
    if (monthBtn) {
      const step = Number(monthBtn.dataset.month);
      const [y, m] = month.split('-').map(Number);
      month = step ? new Date(Date.UTC(y, m - 1 + step, 1)).toISOString().slice(0, 7) : today().slice(0, 7);
      return draw();
    }
    if (el.closest('[data-nt="new-meeting"]')) await ctx.create({ templateId: 'meeting' });
  }, { signal: ctx.signal });
  draw();
}

// Documentos -------------------------------------------------------------------------------------------
/** @param {HTMLElement} main @param {ViewCtx} ctx @param {{ id: string, title: string, docType?: string | null }[]} templates */
export function renderDocs(main, ctx, templates) {
  let type = views('docs.type') ?? '';
  let query = '';
  const draw = () => {
    const docs = ctx.pages
      .filter((p) => p.kind === 'page' && !p.archivedAt)
      .filter((p) => !type || (p.props?.docType ?? 'note') === type)
      .filter((p) => !query || normalize(p.title).includes(normalize(query)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const projectName = (/** @type {PageMeta} */ d) => {
      if (d.productId) return ctx.products.find((p) => p.id === d.productId)?.name ?? '';
      const p = projectPageOf(d.parentId, ctx.byId);
      return p ? title(p) : '';
    };
    setHtml(
      main,
      html`<header class="page-head">
          <div><h1 class="page-title nt-title">${icon('book')}<span>Documentos</span></h1><p class="page-sub">Processos, guias, briefings e notas da equipe</p></div>
          ${ctx.manage
            ? html`<div class="page-actions nt-new">
                ${templates.filter((t) => t.docType).map((t) => html`<button type="button" class="btn btn--secondary btn--sm" data-tpl="${t.id}">${t.title}</button>`)}
                <button type="button" class="btn btn--primary" data-tpl="blank">${icon('plus')}<span>Novo documento</span></button>
              </div>`
            : ''}
        </header>
        <div class="nt-bar">
          ${segmented('type', [{ key: '', label: 'Todos' }, ...DOC_TYPES.map((t) => ({ key: t.key, label: t.label }))], type)}
          <label class="search-field">${icon('search')}<span class="sr-only">Buscar documento</span><input class="input input--bare" type="search" placeholder="Buscar pelo título" data-doc-search value="${query}"></label>
        </div>
        ${!docs.length
          ? emptyState({ title: 'Nenhum documento aqui', text: ctx.manage ? 'Comece com um modelo acima.' : '', compact: true })
          : html`<div class="table-wrap"><table class="nt-table">
              <thead><tr><th>Documento</th><th>Tipo</th><th class="hide-mobile">Projeto</th><th>Editado</th><th class="hide-mobile">Por</th></tr></thead>
              <tbody>${docs.map((d) => html`<tr>
                <td><a class="nt-link" href="#/workspace/${d.id}">${pageIconHtml(d)}<span>${title(d)}</span></a></td>
                <td><span class="nt-chip">${DOC_TYPES.find((t) => t.key === (d.props?.docType ?? 'note'))?.label ?? 'Nota'}</span></td>
                <td class="hide-mobile">${projectName(d) ? html`<span class="nt-chip">${projectName(d)}</span>` : html`<span class="muted">—</span>`}</td>
                <td class="muted" title="${formatDateTime(d.updatedAt)}">${formatRelative(d.updatedAt)}</td>
                <td class="hide-mobile">${d.editorName || html`<span class="muted">—</span>`}</td>
              </tr>`)}</tbody></table></div>`}`,
    );
  };
  main.addEventListener('click', async (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    const seg = /** @type {HTMLElement | null} */ (el.closest('[data-seg]'));
    if (seg) {
      remember('docs.type', (type = String(seg.dataset.key)));
      return draw();
    }
    const tpl = /** @type {HTMLElement | null} */ (el.closest('[data-tpl]'));
    if (tpl) await ctx.create({ templateId: tpl.dataset.tpl });
  }, { signal: ctx.signal });
  let timer = 0;
  main.addEventListener('input', (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    if (!el.matches('[data-doc-search]')) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      query = el.value;
      draw();
      const input = /** @type {HTMLInputElement | null} */ (main.querySelector('[data-doc-search]'));
      input?.focus();
      input?.setSelectionRange(query.length, query.length);
    }, 200);
  }, { signal: ctx.signal });
  draw();
}
