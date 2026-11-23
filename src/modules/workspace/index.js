// Caderno (#/workspace) — o "Notion" da DUMTech: Projetos, Tarefas, Reuniões e Documentos, páginas em
// árvore com editor de blocos, reuniões com transcrição e ata no navegador (IA local), tarefas de verdade,
// favoritos, lixeira, histórico e arquivos. Ícones de linha com cor, nada de emoji.
// Rotas: #/workspace · /projetos · /tarefas · /reunioes · /documentos · /<id> · /arquivos · /lixeira

import { html, setHtml, $, bindActions, createElement } from '../../shared/utils/dom.js';
import { formatRelative, formatDateTime, formatDate, normalize } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { FILE_MAX_BYTES, formatBytes } from '../../core/workspace.js';
import { TEMPLATES, TEXT_TYPES, blocksToText, blocksToMarkdown, runsText } from '../../core/blocks.js';
import { transcriptText } from '../../core/minutes.js';
import { today } from '../../core/validate.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { openDialog, confirmDialog } from '../../shared/components/dialog.js';
import { dataTable } from '../../shared/components/table.js';
import { emptyState, loadError, toast, toastError, errorMessage } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';
import { togglePopover } from '../../shared/components/popover.js';
import { createEditor } from './editor.js';
import { mountMeeting } from './meeting.js';
import { newPage } from './new-page.js';
import { AI_LEVELS, aiLevel, setAiLevel, gpu, clearModels, storageUsed } from './ai.js';
import { renderProjects, renderTasks, renderMeetings, renderDocs, pageIconHtml } from './views.js';
import { aiWrite, aiRun } from '../../shared/components/ai-write.js';
import { REWRITE, rewriteMessages, draftMessages, pageMessages, scorePages, askMessages } from '../../core/ai-prompts.js';
import { textToBlocks } from '../../core/blocks.js';
import { PAGE_ICONS, ICON_COLORS, COLOR_LABEL, PROJECT_STATUS, DOC_TYPES, normalizeProps, pageIconName, progressOf } from '../../core/notebook.js';

/** @typedef {import('../../modules/index.js').ModuleContext} Ctx */
/** @typedef {import('../../services/data.js').PageMeta} PageMeta */
/** @typedef {import('../../services/data.js').Page} Page */
/** @typedef {import('../../services/data.js').Task} Task */
/** @typedef {import('../../services/data.js').WorkspaceFile} WorkspaceFile */

const EXPANDED_KEY = 'dum.caderno.expanded';
const FAV_KEY = 'caderno.favorites';
const LOCK_MS = 70_000;
/** Seções do Caderno (como o menu lateral do Notion). */
const SECTIONS = /** @type {const} */ ([
  { key: 'projetos', label: 'Projetos', icon: 'folder' },
  { key: 'tarefas', label: 'Tarefas', icon: 'listChecks' },
  { key: 'reunioes', label: 'Reuniões', icon: 'mic' },
  { key: 'documentos', label: 'Documentos', icon: 'book' },
]);

const pageIcon = (/** @type {{ icon?: string, kind?: string, iconColor?: string }} */ p) => pageIconHtml(p);
const pageTitle = (/** @type {{ title: string, kind?: string }} */ p) => p.title.trim() || 'Sem título';
const readExpanded = () => {
  try {
    return new Set(/** @type {string[]} */ (JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]')));
  } catch {
    return new Set();
  }
};

/** @param {Ctx} ctx */
export async function render(ctx) {
  const { root, route, signal } = ctx;
  const { org, user } = getState();
  const manage = canDo('workspace.manage');
  const section = route.section ?? '';
  const view = section === 'arquivos' ? 'files' : section === 'lixeira' ? 'trash' : SECTIONS.some((s) => s.key === section) ? section : section ? 'page' : 'home';

  setHtml(
    root,
    html`<div class="cad">
      <aside class="cad-nav" aria-label="Páginas do Caderno">
        <div class="cad-nav__top">
          <label class="search-field cad-search">${icon('search')}<span class="sr-only">Buscar no Caderno</span>
            <input class="input input--bare" type="search" placeholder="Buscar no Caderno" data-search autocomplete="off"></label>
          ${manage
            ? html`<div class="cad-nav__new">
                <button type="button" class="btn btn--secondary btn--sm" data-action="new-page">${icon('plus')}<span>Página</span></button>
                <button type="button" class="btn btn--secondary btn--sm" data-action="new-meeting">${icon('mic')}<span>Reunião</span></button>
              </div>`
            : ''}
        </div>
        <nav class="cad-tree" data-tree><div class="skeleton"></div></nav>
        <div class="cad-nav__foot">
          <a class="cad-link ${view === 'files' ? 'is-active' : ''}" href="#/workspace/arquivos">${icon('paperclip')}<span>Arquivos</span></a>
          <a class="cad-link ${view === 'trash' ? 'is-active' : ''}" href="#/workspace/lixeira">${icon('trash')}<span>Lixeira</span><small data-trash-count></small></a>
          <button type="button" class="cad-link" data-action="ai-settings">${icon('zap')}<span>IA local</span><small>${AI_LEVELS.find((l) => l.key === aiLevel())?.label ?? ''}</small></button>
        </div>
      </aside>
      <div class="cad-main" data-main><div class="skeleton"></div></div>
    </div>`,
  );
  const tree = /** @type {HTMLElement} */ ($('[data-tree]', root));
  const main = /** @type {HTMLElement} */ ($('[data-main]', root));

  /** @type {PageMeta[]} */
  let pages = [];
  /** @type {Task[]} */
  let tasks = [];
  /** @type {{ userId: string, name: string, email: string }[]} */
  let members = [];
  /** @type {import('../../services/data.js').Product[]} */
  let products = [];
  /** @type {{ id: string, name: string }[]} */
  let customers = [];
  /** @type {string[]} */
  let favorites = [];
  const expanded = readExpanded();
  const currentId = view === 'page' ? section : null;

  try {
    [pages, tasks, members, products, customers, favorites] = await Promise.all([
      data.pages.list(org.id),
      canDo('projects.view') ? data.tasks.list(org.id).catch(() => []) : Promise.resolve([]),
      data.members.list(org.id).then((list) => list.map((m) => ({ userId: m.userId, name: m.name || m.email, email: m.email }))).catch(() => []),
      canDo('products.view') ? data.products.list(org.id).catch(() => []) : Promise.resolve([]),
      canDo('customers.view') ? data.customers.list(org.id).then((l) => l.map((c) => ({ id: c.id, name: c.name }))).catch(() => []) : Promise.resolve([]),
      data.prefs.get(org.id, FAV_KEY).then((v) => (Array.isArray(v) ? v : [])).catch(() => []),
    ]);
  } catch (error) {
    if (!signal.aborted) {
      setHtml(main, loadError(error));
      setHtml(tree, html``);
    }
    return;
  }
  if (signal.aborted) return;

  const byId = new Map(pages.map((p) => [p.id, p]));
  const alive = () => pages.filter((p) => !p.archivedAt);
  const childrenOf = (/** @type {string | null} */ id) => alive().filter((p) => p.parentId === id).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  const ancestors = (/** @type {string} */ id) => {
    const list = [];
    let cur = byId.get(id);
    const seen = new Set();
    while (cur?.parentId && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      cur = byId.get(cur.parentId);
      if (cur) list.unshift(cur);
    }
    return list;
  };
  if (currentId) for (const a of ancestors(currentId)) expanded.add(a.id);
  const saveExpanded = () => localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded].slice(-300)));

  // Árvore ------------------------------------------------------------------------------------
  /** @param {PageMeta} p @param {number} depth @returns {any} */
  const item = (p, depth) => {
    const kids = childrenOf(p.id);
    const open = expanded.has(p.id);
    return html`<div class="cad-item ${p.id === currentId ? 'is-active' : ''}" data-depth="${Math.min(depth, 6)}">
        ${kids.length
          ? html`<button type="button" class="cad-caret ${open ? 'is-open' : ''}" data-action="expand" data-id="${p.id}" aria-expanded="${open}" aria-label="${open ? 'Fechar' : 'Abrir'} ${pageTitle(p)}"></button>`
          : html`<span class="cad-caret cad-caret--none" aria-hidden="true"></span>`}
        <a class="cad-item__link" href="#/workspace/${p.id}" ${p.id === currentId ? html`aria-current="page"` : ''}>${pageIcon(p)}<span class="cad-item__title">${pageTitle(p)}</span></a>
        ${manage ? html`<button type="button" class="cad-item__add" data-action="new-child" data-id="${p.id}" aria-label="Nova página dentro de ${pageTitle(p)}" title="Nova página dentro">+</button>` : ''}
      </div>
      ${open ? kids.map((k) => item(k, depth + 1)) : ''}`;
  };

  function drawTree() {
    const roots = childrenOf(null);
    const docs = roots.filter((p) => p.kind === 'page');
    const projects = roots.filter((p) => p.kind === 'project');
    const favs = favorites.map((id) => byId.get(id)).filter((p) => p && !p.archivedAt);
    const open = tasks.filter((t) => t.status !== 'done' && t.assigneeId === user?.id).length;
    setHtml(
      tree,
      html`<a class="cad-link ${view === 'home' ? 'is-active' : ''}" href="#/workspace">${icon('home')}<span>Início</span></a>
        ${SECTIONS.map((s) => html`<a class="cad-link ${view === s.key ? 'is-active' : ''}" href="#/workspace/${s.key}">${icon(s.icon)}<span>${s.label}</span>${s.key === 'tarefas' && open ? html`<small>${open}</small>` : ''}</a>`)}
        ${favs.length ? html`<p class="cad-group">Favoritos</p>${favs.map((p) => item(/** @type {PageMeta} */ (p), 0))}` : ''}
        ${projects.length ? html`<p class="cad-group">Projetos internos</p>${projects.map((p) => item(p, 0))}` : ''}
        <p class="cad-group">Páginas</p>
        ${docs.length ? docs.map((p) => item(p, 0)) : html`<p class="cad-none">Nenhuma página ainda</p>`}`,
    );
    const trash = pages.filter((p) => p.archivedAt).length;
    const count = $('[data-trash-count]', root);
    if (count) count.textContent = trash ? String(trash) : '';
  }
  drawTree();

  // Busca
  let searchTimer = 0;
  $('[data-search]', root)?.addEventListener('input', (event) => {
    const q = /** @type {HTMLInputElement} */ (event.target).value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) return drawTree();
    searchTimer = window.setTimeout(async () => {
      const local = alive().filter((p) => normalize(p.title).includes(normalize(q)));
      const remote = await data.pages.search(org.id, q).catch(() => []);
      if (signal.aborted) return;
      const ids = new Set(local.map((p) => p.id));
      const found = [...local, ...remote.filter((r) => !ids.has(r.id)).map((r) => byId.get(r.id)).filter(Boolean)];
      setHtml(
        tree,
        html`<p class="cad-group">Resultados para “${q}”</p>
          ${found.length
            ? found.map((p) => html`<div class="cad-item" data-depth="0"><span class="cad-caret cad-caret--none"></span><a class="cad-item__link" href="#/workspace/${/** @type {PageMeta} */ (p).id}">${pageIcon(/** @type {PageMeta} */ (p))}<span class="cad-item__title">${pageTitle(/** @type {PageMeta} */ (p))}</span></a></div>`)
            : html`<p class="cad-none">Nada encontrado</p>`}`,
      );
    }, 250);
  }, { signal });

  // Criação -----------------------------------------------------------------------------------
  /** @param {Parameters<typeof newPage>[1]} options */
  async function create(options) {
    try {
      const id = await newPage(org.id, options);
      if (options?.parentId) {
        expanded.add(options.parentId);
        saveExpanded();
      }
      location.hash = `#/workspace/${id}`;
    } catch (error) {
      toastError(error);
    }
  }

  const memberName = (/** @type {string | null} */ id) => members.find((m) => m.userId === id)?.name ?? '';

  bindActions(root, {
    'new-page': () => create({ templateId: 'blank' }),
    'new-meeting': () => create({ templateId: 'meeting' }),
    'new-child': (el) => create({ templateId: 'blank', parentId: el.dataset.id ?? null }),
    template: (el) => create({ templateId: el.dataset.id }),
    expand: (el) => {
      const id = String(el.dataset.id);
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      saveExpanded();
      drawTree();
    },
    'ai-settings': () => aiSettings(),
    'ask-notebook': () => askNotebook(),
    'task-done': async (el) => {
      const t = tasks.find((x) => x.id === el.dataset.id);
      if (!t) return;
      try {
        await data.tasks.save(org.id, /** @type {any} */ ({ ...t, status: 'done' }), t.id);
        t.status = 'done';
        toast('Tarefa concluída.', 'success');
        if (view === 'home') drawHome();
      } catch (error) {
        toastError(error);
      }
    },
  }, signal);

  // Perguntar ao Caderno: acha as páginas ligadas, a IA responde citando [1], [2] -----------------------
  async function askNotebook() {
    /** @type {{ id: string, title: string, text: string }[]} */
    let sources = [];
    let question = '';
    /** @type {string | null} */
    let answer = null;
    await openDialog({
      title: 'Perguntar ao Caderno',
      description: 'A IA local lê as páginas e atas mais ligadas à pergunta e responde com as fontes.',
      body: html`<label class="field"><span class="field__label">Pergunta</span><input class="input" name="q" required maxlength="300" placeholder="Ex.: o que ficou combinado com a Padaria Sol?" autocomplete="off"></label>`,
      submitLabel: 'Perguntar',
      onSubmit: async (form) => {
        question = String(form.get('q') ?? '').trim();
        if (question.length < 4) throw new Error('Escreva a pergunta.');
        const found = await data.pages.search(org.id, question.split(/\s+/).sort((a, b) => b.length - a.length)[0]).catch(() => []);
        const ids = new Set([...found.map((f) => f.id), ...alive().map((p) => p.id)]);
        const loaded = await Promise.all([...ids].slice(0, 40).map((id) => data.pages.get(org.id, id).catch(() => null)));
        const all = loaded.filter(Boolean).map((p) => ({ id: /** @type {any} */ (p).id, title: pageTitle(/** @type {any} */ (p)), text: `${blocksToText(/** @type {any} */ (p).content)}${/** @type {any} */ (p).meeting?.transcript?.length ? `\n${transcriptText(/** @type {any} */ (p).meeting.transcript)}` : ''}` }));
        sources = scorePages(question, all).slice(0, 4);
        if (!sources.length) throw new Error('Não achei páginas sobre isso no Caderno.');
      },
    });
    if (!sources.length) return;
    answer = await aiWrite(askMessages(question, sources), {
      title: question, useLabel: 'Fechar', readOnly: true, maxTokens: 600,
      extra: () => html`<p class="field__label aiw__src">Fontes</p><ol class="aiw__sources">${sources.map((s) => html`<li><a class="nt-link" href="#/workspace/${s.id}">${s.title}</a></li>`)}</ol>`,
    });
    return answer;
  }

  // Início ------------------------------------------------------------------------------------
  function drawHome() {
    const recent = alive().slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
    const meetings = alive().filter((p) => p.kind === 'meeting').sort((a, b) => (b.meetingDate ?? b.createdAt).localeCompare(a.meetingDate ?? a.createdAt)).slice(0, 5);
    const mine = tasks.filter((t) => t.status !== 'done' && t.assigneeId === user?.id).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')).slice(0, 12);
    const todayKey = today();
    setHtml(
      main,
      html`<header class="page-head">
          <div><h1 class="page-title nt-title">${icon('book')}<span>Caderno</span></h1><p class="page-sub">Projetos, tarefas, reuniões e documentos de ${org.name}</p></div>
          ${manage
            ? html`<div class="page-actions">
                <button type="button" class="btn btn--secondary" data-action="new-meeting">${icon('mic')}<span>Nova reunião</span></button>
                <button type="button" class="btn btn--secondary" data-action="ask-notebook">${icon('sparkles')}<span>Perguntar ao Caderno</span></button>
                <button type="button" class="btn btn--primary" data-action="new-page">${icon('plus')}<span>Nova página</span></button>
              </div>`
            : ''}
        </header>
        ${manage
          ? html`<section class="cad-templates" aria-label="Começar com um modelo">
              ${TEMPLATES.map((t) => html`<button type="button" class="cad-tpl" data-action="template" data-id="${t.id}"><span class="cad-tpl__icon" aria-hidden="true">${icon(/** @type {any} */ (t.icon))}</span><strong>${t.title}</strong><small>${t.hint}</small></button>`)}
            </section>`
          : ''}
        <div class="cad-home">
          <section class="panel" aria-labelledby="mine-title">
            <header class="panel__head"><div><h2 class="panel__title" id="mine-title">Minhas pendências</h2><p class="panel__hint">Tarefas abertas com você como responsável</p></div><a class="link-action" href="#/workspace/tarefas">Ver todas →</a></header>
            ${mine.length
              ? html`<ul class="cad-tasks">${mine.map((t) => html`<li class="cad-task">
                  <button type="button" class="ed-check" data-action="task-done" data-id="${t.id}" aria-label="Concluir ${t.title}"></button>
                  <a href="${t.pageId ? `#/workspace/${t.pageId}` : t.productId ? `#/projects/${t.productId}` : '#/workspace/tarefas'}"><strong>${t.title}</strong><small>${[t.pageTitle, t.projectName].filter(Boolean).join(' · ') || 'Tarefa'}</small></a>
                  ${t.dueDate ? html`<span class="cad-due ${t.dueDate < todayKey ? 'is-late' : t.dueDate === todayKey ? 'is-today' : ''}">${t.dueDate === todayKey ? 'hoje' : formatDate(t.dueDate)}</span>` : ''}
                </li>`)}</ul>`
              : emptyState({ title: 'Nada pendente com você', text: 'Tarefas com você como responsável aparecem aqui e no Hoje.', compact: true })}
          </section>
          <section class="panel" aria-labelledby="recent-title">
            <header class="panel__head"><h2 class="panel__title" id="recent-title">Editadas por último</h2></header>
            ${recent.length
              ? html`<ul class="nb-list">${recent.map((p) => html`<li><a class="nb-list__link" href="#/workspace/${p.id}">${pageIcon(p)}<span class="nb-list__title">${pageTitle(p)}</span><small title="${formatDateTime(p.updatedAt)}">${formatRelative(p.updatedAt)}${p.editorName ? ` · ${p.editorName}` : ''}</small></a></li>`)}</ul>`
              : emptyState({ title: 'Caderno vazio', text: manage ? 'Comece com um modelo acima ou crie uma página.' : 'Quando a equipe criar páginas, elas aparecem aqui.', compact: true })}
          </section>
        </div>
        ${meetings.length
          ? html`<section class="panel" aria-labelledby="meet-title">
              <header class="panel__head"><h2 class="panel__title" id="meet-title">Reuniões recentes</h2></header>
              <ul class="nb-list">${meetings.map((p) => html`<li><a class="nb-list__link" href="#/workspace/${p.id}">${pageIcon(p)}<span class="nb-list__title">${pageTitle(p)}</span><small>${p.meetingDate ? formatDate(p.meetingDate) : formatRelative(p.createdAt)}</small></a></li>`)}</ul>
            </section>`
          : ''}`,
    );
  }

  // Lixeira -----------------------------------------------------------------------------------
  function drawTrash() {
    const archived = pages.filter((p) => p.archivedAt).sort((a, b) => String(b.archivedAt).localeCompare(String(a.archivedAt)));
    setHtml(
      main,
      html`<header class="page-head"><div><h1 class="page-title">Lixeira</h1><p class="page-sub">Páginas tiradas do Caderno. Restaure ou apague de vez.</p></div></header>
        <section class="panel">${archived.length
          ? html`<ul class="nb-list">${archived.map((p) => html`<li class="nb-list__row">${pageIcon(p)}<span class="nb-list__title">${pageTitle(p)}</span><small>na lixeira ${formatRelative(String(p.archivedAt))}</small>
              ${manage ? html`<span class="row-actions"><button type="button" class="btn btn--ghost btn--sm" data-trash="restore" data-id="${p.id}">Restaurar</button><button type="button" class="btn btn--ghost btn--sm" data-trash="delete" data-id="${p.id}">Apagar de vez</button></span>` : ''}</li>`)}</ul>`
          : emptyState({ title: 'Lixeira vazia', compact: true })}</section>`,
    );
  }
  main.addEventListener('click', async (e) => {
    const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-trash]'));
    if (!btn) return;
    const p = byId.get(String(btn.dataset.id));
    if (!p) return;
    try {
      if (btn.dataset.trash === 'restore') {
        await data.pages.archive(org.id, p.id, false);
        p.archivedAt = null;
        toast('Página restaurada.', 'success');
      } else {
        const kids = pages.filter((x) => x.parentId === p.id).length;
        const ok = await confirmDialog({ title: 'Apagar de vez?', message: `“${pageTitle(p)}”${kids ? ' e as páginas dentro dela' : ''} saem para sempre (com o histórico). Tarefas só desta página também.`, confirmLabel: 'Apagar de vez', danger: true });
        if (!ok) return;
        await data.pages.remove(org.id, p.id);
        pages = pages.filter((x) => x.id !== p.id && x.parentId !== p.id);
        toast('Página apagada.', 'success');
      }
      drawTree();
      drawTrash();
    } catch (error) {
      toastError(error);
    }
  }, { signal });

  // Arquivos ----------------------------------------------------------------------------------
  async function drawFiles() {
    const info = await data.health.info().catch(() => ({ storage: false }));
    if (signal.aborted) return;
    setHtml(
      main,
      html`<header class="page-head"><div><h1 class="page-title">Arquivos</h1><p class="page-sub">Contratos, logos e anexos da equipe. Até 10 MB cada, em pasta privada.</p></div>
          ${manage && info.storage ? html`<div class="page-actions"><label class="btn btn--primary file-pick">${icon('plus')}<span>Enviar arquivo</span><input type="file" data-upload class="sr-only" multiple></label></div>` : ''}
        </header>
        <section class="panel">${info.storage ? html`<div data-files><div class="skeleton"></div></div>` : html`<p class="notice notice--warn">Arquivos ficam no Supabase Storage, que não respondeu neste projeto.</p>`}</section>`,
    );
    if (!info.storage) return;
    /** @type {WorkspaceFile[]} */
    let files = [];
    const slot = /** @type {HTMLElement} */ ($('[data-files]', main));
    const draw = () =>
      slot.replaceChildren(
        dataTable({
          label: 'Arquivos',
          rows: files,
          sort: { key: 'date', dir: 'desc' },
          empty: emptyState({ title: 'Nenhum arquivo enviado', compact: true }),
          columns: [
            { key: 'name', label: 'Arquivo', sortValue: (f) => f.name, render: (f) => html`<button type="button" class="link-strong" data-file="download" data-id="${f.id}">${f.name}</button>` },
            { key: 'size', label: 'Tamanho', sortValue: (f) => f.size, render: (f) => html`<span class="mono">${formatBytes(f.size)}</span>` },
            { key: 'by', label: 'Enviado por', hideOnMobile: true, sortValue: (f) => f.uploaderName, render: (f) => f.uploaderName || '—' },
            { key: 'date', label: 'Quando', hideOnMobile: true, sortValue: (f) => f.createdAt, render: (f) => html`<span class="mono" title="${formatDateTime(f.createdAt)}">${formatRelative(f.createdAt)}</span>` },
            ...(manage
              ? [{ key: 'actions', label: 'Ações', align: /** @type {const} */ ('end'), render: (/** @type {WorkspaceFile} */ f) => html`<button type="button" class="icon-btn icon-btn--sm" data-file="remove" data-id="${f.id}" aria-label="Excluir ${f.name}" title="Excluir">${icon('trash')}</button>` }]
              : []),
          ],
        }),
      );
    const load = async () => {
      try {
        files = await data.files.list(org.id);
        if (!signal.aborted) draw();
      } catch (error) {
        if (!signal.aborted) setHtml(slot, loadError(error));
      }
    };
    await load();
    $('[data-upload]', main)?.addEventListener('change', async (event) => {
      const input = /** @type {HTMLInputElement} */ (event.target);
      const list = [...(input.files ?? [])];
      input.value = '';
      for (const file of list) {
        if (file.size > FILE_MAX_BYTES) {
          toast(`${file.name}: maior que 10 MB.`, 'danger');
          continue;
        }
        try {
          toast(`Enviando ${file.name}…`, 'info');
          await data.files.upload(org.id, file);
        } catch (error) {
          toastError(error);
        }
      }
      load();
    }, { signal });
    main.addEventListener('click', async (e) => {
      const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-file]'));
      if (!btn) return;
      const f = files.find((x) => x.id === btn.dataset.id);
      if (!f) return;
      try {
        if (btn.dataset.file === 'download') window.open(await data.files.link(org.id, f), '_blank', 'noopener');
        else if (await confirmDialog({ title: 'Excluir arquivo?', message: `“${f.name}” sai do Storage e não pode ser recuperado.`, confirmLabel: 'Excluir', danger: true })) {
          await data.files.remove(org.id, f);
          toast('Arquivo excluído.', 'success');
          load();
        }
      } catch (error) {
        toastError(error);
      }
    }, { signal });
  }

  // IA local (ajustes deste computador) --------------------------------------------------------
  async function aiSettings() {
    const g = await gpu();
    const used = await storageUsed();
    const current = aiLevel();
    await openDialog({
      title: 'IA local do Caderno',
      description: 'Transcrição e ata rodam neste computador. Nada da reunião vai para servidor nenhum.',
      body: html`<div class="choice-row" role="radiogroup" aria-label="Nível da IA local">
          ${AI_LEVELS.map((l) => html`<label class="choice"><input type="radio" name="level" value="${l.key}" ${l.key === current ? html`checked` : ''}><span><strong>${l.label}</strong><small>${l.hint}</small></span></label>`)}
        </div>
        <dl class="facts facts--stack">
          <div><dt>Placa de vídeo (WebGPU)</dt><dd>${g.webgpu ? `disponível${g.f16 ? ' (meia precisão)' : ''}` : 'não disponível: transcrição mais lenta e ata por regras'}</dd></div>
          <div><dt>Espaço usado pelo site</dt><dd>${used ? formatBytes(used) : '—'}</dd></div>
        </dl>
        <button type="button" class="btn btn--ghost btn--sm" data-ai-clear>${icon('trash')}<span>Apagar modelos baixados</span></button>`,
      submitLabel: 'Salvar',
      onSubmit: (form) => {
        setAiLevel(/** @type {any} */ (String(form.get('level') ?? 'full')));
        toast('IA local ajustada.', 'success');
      },
    });
  }
  document.addEventListener('click', async (e) => {
    if (!/** @type {HTMLElement} */ (e.target).closest?.('[data-ai-clear]')) return;
    try {
      await clearModels();
      toast('Modelos apagados. Na próxima vez eles são baixados de novo.', 'success');
    } catch (error) {
      toastError(error);
    }
  }, { signal });

  /** Contexto das telas Projetos/Tarefas/Reuniões/Documentos. @type {import('./views.js').ViewCtx} */
  const viewCtx = {
    org, user, manage, canTasks: manage && canDo('projects.manage'), pages, byId, tasks, members, products, signal,
    create: (/** @type {any} */ options) => create(options),
    refreshNav: () => drawTree(),
  };
  if (view === 'home') return drawHome();
  if (view === 'trash') return drawTrash();
  if (view === 'files') return drawFiles();
  if (view === 'projetos') return renderProjects(main, viewCtx);
  if (view === 'tarefas') return renderTasks(main, viewCtx);
  if (view === 'reunioes') return renderMeetings(main, viewCtx);
  if (view === 'documentos') return renderDocs(main, viewCtx, TEMPLATES);
  return renderPage();

  // Página ------------------------------------------------------------------------------------
  async function renderPage() {
    const id = /** @type {string} */ (currentId);
    setHtml(main, html`<div class="skeleton"></div>`);
    /** @type {Page | null} */
    let page;
    try {
      page = await data.pages.get(org.id, id);
    } catch (error) {
      if (!signal.aborted) setHtml(main, loadError(error));
      return;
    }
    if (signal.aborted) return;
    if (!page) {
      setHtml(main, emptyState({ title: 'Página não encontrada', text: 'Ela pode ter sido apagada.', action: { label: 'Voltar ao Caderno', href: '#/workspace' } }));
      return;
    }
    const p = /** @type {Page} */ (page);
    document.title = `${pageTitle(p)} · Caderno — DUMTech Master`;
    const lockedBy = p.editingBy && p.editingBy !== user?.id && p.editingAt && Date.now() - Date.parse(p.editingAt) < LOCK_MS ? p.editingName || 'Outra pessoa' : null;
    let readOnly = !manage || Boolean(lockedBy) || Boolean(p.archivedAt);
    let updatedAt = p.updatedAt;
    let dirty = false;
    let saving = false;
    let saveTimer = 0;
    /** @type {import('../../services/data.js').Meeting | null} */
    let meeting = p.meeting;
    let title = p.title;
    let iconValue = p.icon;
    let iconColor = p.iconColor ?? '';
    /** @type {Record<string, any>} */
    let props = { ...(p.props ?? {}) };
    const taskMap = new Map(tasks.filter((t) => t.pageId === p.id).map((t) => [t.id, t]));
    const crumbs = ancestors(p.id);
    const isFav = () => favorites.includes(p.id);

    setHtml(
      main,
      html`<article class="pg pg--${p.kind}">
        <div class="pg-bar">
          <nav class="pg-crumbs" aria-label="Caminho"><a href="#/workspace">Caderno</a>${crumbs.map((c) => html`<span aria-hidden="true">/</span><a href="#/workspace/${c.id}">${pageIcon(c)}<span>${pageTitle(c)}</span></a>`)}</nav>
          <div class="pg-bar__tools">
            <span class="pg-status" data-status role="status">${readOnly ? (p.archivedAt ? 'Na lixeira' : 'Só leitura') : 'Salvo'}</span>
            <button type="button" class="icon-btn pg-fav ${isFav() ? 'is-on' : ''}" data-page="fav" aria-pressed="${isFav()}" title="${isFav() ? 'Tirar dos favoritos' : 'Favoritar'}" aria-label="Favoritar">${icon('star')}</button>
            <button type="button" class="icon-btn" data-page="history" title="Histórico de versões" aria-label="Histórico">${icon('clock')}</button>
            <button type="button" class="icon-btn" data-page="more" title="Mais opções" aria-label="Mais opções" aria-expanded="false">${icon('moreH')}</button>
          </div>
        </div>
        ${p.archivedAt ? html`<p class="notice notice--warn pg-notice">Esta página está na lixeira. ${manage ? html`<button type="button" class="link-action" data-page="restore">Restaurar</button>` : ''}</p>` : ''}
        ${lockedBy ? html`<p class="notice notice--warn pg-notice" data-lock><strong>${lockedBy} está editando agora.</strong> Você vê só para leitura para não sobrescrever. ${manage ? html`<button type="button" class="link-action" data-page="unlock">Editar mesmo assim</button>` : ''}</p>` : ''}
        <header class="pg-head">
          <button type="button" class="pg-icon" data-page="icon" ${readOnly ? html`disabled` : ''} aria-label="Escolher ícone e cor" title="Ícone e cor">${pageIcon({ icon: iconValue, kind: p.kind, iconColor })}</button>
          <h1 class="pg-title" data-title contenteditable="${readOnly ? 'false' : 'true'}" spellcheck="true" data-ph="Sem título">${title}</h1>
          <div class="pg-meta" data-meta></div>
          <dl class="props pg-props" data-props></dl>
        </header>
        <div data-meeting></div>
        <div class="pg-body" data-editor></div>
        <div data-project-tasks></div>
        <div data-below></div>
      </article>`,
    );
    const status = /** @type {HTMLElement} */ ($('[data-status]', main));
    const titleEl = /** @type {HTMLElement} */ ($('[data-title]', main));
    const meta = /** @type {HTMLElement} */ ($('[data-meta]', main));
    const below = /** @type {HTMLElement} */ ($('[data-below]', main));

    const drawMeta = () => {
      const project = products.find((x) => x.id === p.productId);
      const customer = customers.find((x) => x.id === p.customerId);
      setHtml(
        meta,
        html`${project ? html`<a class="pg-chip" href="#/projects/${project.id}">${icon('package')}<span>${project.name}</span></a>` : ''}
          ${customer ? html`<a class="pg-chip" href="#/customers/${customer.id}">${icon('building')}<span>${customer.name}</span></a>` : ''}
          <span class="pg-edited" title="${formatDateTime(updatedAt)}">editada ${formatRelative(updatedAt)}${p.editorName ? ` por ${p.editorName}` : ''}</span>`,
      );
    };
    drawMeta();

    const propsEl = /** @type {HTMLElement} */ ($('[data-props]', main));
    const dis = readOnly ? html`disabled` : '';
    const drawProps = () => {
      if (p.kind === 'project') {
        const own = tasks.filter((t) => t.pageId && (t.pageId === p.id || ancestors(t.pageId).some((a) => a.id === p.id)));
        const prog = progressOf(own);
        setHtml(propsEl, html`<div><dt>${icon('target')}Status</dt><dd><select class="input input--sm" name="status" ${dis}>${PROJECT_STATUS.map((s) => html`<option value="${s.key}" ${props.status === s.key ? html`selected` : ''}>${s.label}</option>`)}</select></dd></div>
          <div><dt>${icon('user')}Responsável</dt><dd><select class="input input--sm" name="ownerId" ${dis}><option value="">—</option>${members.map((m) => html`<option value="${m.userId}" ${props.ownerId === m.userId ? html`selected` : ''}>${m.name}</option>`)}</select></dd></div>
          <div><dt>${icon('calendar')}Início</dt><dd><input class="input input--sm" type="date" name="startDate" value="${props.startDate ?? ''}" ${dis}></dd></div>
          <div><dt>${icon('flag')}Prazo</dt><dd><input class="input input--sm" type="date" name="dueDate" value="${props.dueDate ?? ''}" ${dis}></dd></div>
          <div><dt>${icon('checkCircle')}Progresso</dt><dd>${prog.total ? html`<span class="nt-progress"><span class="pbar"><span class="pbar__fill" data-pct="${prog.pct}"></span></span><small class="mono">${prog.done} de ${prog.total}</small></span>` : html`<span class="muted">sem tarefas</span>`}</dd></div>`);
        propsEl.querySelectorAll('.pbar__fill').forEach((el) => (/** @type {HTMLElement} */ (el).style.width = `${/** @type {HTMLElement} */ (el).dataset.pct}%`));
      } else if (p.kind === 'page') {
        setHtml(propsEl, html`<div><dt>${icon('bookmark')}Tipo</dt><dd><select class="input input--sm" name="docType" ${dis}>${DOC_TYPES.map((t) => html`<option value="${t.key}" ${(props.docType ?? 'note') === t.key ? html`selected` : ''}>${t.label}</option>`)}</select></dd></div>`);
      } else propsEl.remove();
    };
    drawProps();
    propsEl.addEventListener('change', async (e) => {
      const el = /** @type {HTMLInputElement} */ (e.target);
      if (!el.name) return;
      try {
        const next = normalizeProps(p.kind, { ...props, [el.name]: el.value || null });
        await data.pages.save(org.id, p.id, { props: next });
        props = next;
        const meta_ = byId.get(p.id);
        if (meta_) meta_.props = next;
        setStatus('Salvo');
      } catch (error) {
        toastError(error);
        drawProps();
      }
    }, { signal });

    // Projeto interno: as tarefas dele (tabela) e o que fica dentro (reuniões e documentos)
    if (p.kind === 'project') {
      const slot = /** @type {HTMLElement} */ ($('[data-project-tasks]', main));
      setHtml(slot, html`<section class="pg-section"><header class="pg-section__head"><h2 class="pg-section__title">${icon('listChecks')}Tarefas do projeto</h2></header><div data-scoped></div></section>`);
      renderTasks(/** @type {HTMLElement} */ ($('[data-scoped]', slot)), { org, user, manage, canTasks: manage && canDo('projects.manage'), pages, byId, tasks, members, products, signal, create: (o) => create(o), refreshNav: () => drawTree() }, { projectPageId: p.id });
    }

    const drawBelow = () => {
      const kids = childrenOf(p.id);
      const pageTasks = [...taskMap.values()];
      setHtml(
        below,
        html`${kids.length
            ? html`<section class="pg-section"><h2 class="pg-section__title">${p.kind === 'project' ? 'Reuniões e documentos do projeto' : 'Dentro desta página'}</h2><ul class="nb-list">${kids.map((k) => html`<li><a class="nb-list__link" href="#/workspace/${k.id}">${pageIcon(k)}<span class="nb-list__title">${pageTitle(k)}</span><small>${k.kind === 'meeting' && k.meetingDate ? formatDate(k.meetingDate) : formatRelative(k.updatedAt)}</small></a></li>`)}</ul></section>`
            : ''}
          ${p.kind === 'project' && manage && !readOnly
            ? html`<div class="pg-add"><button type="button" class="btn btn--secondary btn--sm" data-page="child-meeting">${icon('mic')}<span>Nova reunião do projeto</span></button><button type="button" class="btn btn--secondary btn--sm" data-page="child-doc">${icon('fileText')}<span>Novo documento do projeto</span></button></div>`
            : ''}
          ${pageTasks.length && p.kind !== 'project'
            ? html`<section class="pg-section"><h2 class="pg-section__title">Tarefas desta página</h2><ul class="cad-tasks">${pageTasks.map((t) => html`<li class="cad-task ${t.status === 'done' ? 'is-done' : ''}">
                <span class="ed-check ${t.status === 'done' ? 'is-on' : ''}" aria-hidden="true"></span>
                <span><strong>${t.title}</strong><small>${[t.assigneeName || 'sem responsável', t.projectName].filter(Boolean).join(' · ')}</small></span>
                ${t.dueDate ? html`<span class="cad-due ${t.status !== 'done' && t.dueDate < today() ? 'is-late' : ''}">${formatDate(t.dueDate)}</span>` : ''}
              </li>`)}</ul></section>`
            : ''}`,
      );
    };
    drawBelow();

    // Salvar ----------------------------------------------------------------------------------
    const setStatus = (/** @type {string} */ text, tone = '') => {
      status.textContent = text;
      status.dataset.tone = tone;
    };
    const searchText = () => `${title}\n${blocksToText(editor.getBlocks())}${meeting?.transcript?.length ? `\n${transcriptText(meeting.transcript)}` : ''}`.slice(0, 300000);
    /** Atualiza o título das tarefas quando o texto do bloco muda. */
    const syncTaskTitles = () => {
      for (const b of editor.getBlocks()) {
        if (b.type !== 'todo' || !b.taskId) continue;
        const t = taskMap.get(b.taskId);
        const text = runsText(b.text).trim().slice(0, 200);
        if (t && text.length >= 2 && text !== t.title) {
          t.title = text;
          data.tasks.save(org.id, /** @type {any} */ ({ ...t }), t.id).catch(() => {});
        }
      }
    };

    async function save(force = false) {
      clearTimeout(saveTimer);
      if (readOnly || (!dirty && !force) || saving) return;
      saving = true;
      dirty = false;
      setStatus('Salvando…');
      try {
        const res = await data.pages.save(org.id, p.id, { title, icon: iconValue, iconColor, content: editor.getBlocks(), meeting, searchText: searchText() }, updatedAt);
        updatedAt = res.updatedAt;
        const meta_ = byId.get(p.id);
        const renamed = meta_ && meta_.title !== title;
        if (meta_) Object.assign(meta_, { title, icon: iconValue, iconColor, updatedAt });
        if (renamed) drawTree();
        setStatus('Salvo');
        syncTaskTitles();
      } catch (error) {
        dirty = true;
        if (/** @type {any} */ (error)?.code === 'conflict') return conflict();
        setStatus('Não salvou', 'error');
        toast(`Não salvou: ${errorMessage(error)}`, 'danger');
      } finally {
        saving = false;
      }
      if (dirty) schedule();
    }
    function schedule() {
      dirty = true;
      setStatus('Editando…');
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => save(), 900);
    }
    async function conflict() {
      setStatus('Conflito', 'error');
      const keep = await confirmDialog({
        title: 'Outra pessoa salvou esta página',
        message: 'Enquanto você editava, alguém salvou uma versão mais nova. Salvar a sua por cima? (A versão da outra pessoa fica no histórico.) Se preferir, cancele e recarregue a página.',
        confirmLabel: 'Salvar a minha por cima',
        danger: true,
      });
      if (keep) {
        const fresh = await data.pages.get(org.id, p.id).catch(() => null);
        if (fresh) updatedAt = fresh.updatedAt;
        dirty = true;
        save(true);
      } else setStatus('Não salvo — recarregue', 'error');
    }

    // Editor ----------------------------------------------------------------------------------
    const mentionPool = () => [
      ...members.map((m) => ({ k: /** @type {const} */ ('user'), id: m.userId, label: m.name, sub: 'Pessoa' })),
      ...products.map((x) => ({ k: /** @type {const} */ ('project'), id: x.id, label: x.name, sub: 'Projeto' })),
      ...customers.map((x) => ({ k: /** @type {const} */ ('customer'), id: x.id, label: x.name, sub: 'Cliente' })),
      ...alive().filter((x) => x.id !== p.id).map((x) => ({ k: /** @type {const} */ ('page'), id: x.id, label: pageTitle(x), sub: 'Página' })),
    ];
    /** @type {ReturnType<typeof createEditor>} */
    const editor = createEditor(/** @type {HTMLElement} */ ($('[data-editor]', main)), {
      blocks: p.content,
      readOnly,
      onChange: () => schedule(),
      ctx: {
        mentionItems: (q) => {
          const n = normalize(q);
          return mentionPool().filter((x) => !n || normalize(x.label).includes(n)).slice(0, 12);
        },
        fileUrl: (path) => data.files.link(org.id, /** @type {any} */ ({ path, name: path.split('/').pop() ?? 'arquivo' })),
        upload: async (file) => {
          if (file.size > FILE_MAX_BYTES) {
            toast('Arquivo maior que 10 MB.', 'danger');
            return null;
          }
          try {
            toast(`Enviando ${file.name}…`, 'info');
            const f = await data.files.upload(org.id, file, p.productId);
            return { path: f.path, name: f.name, mime: f.mime, size: f.size };
          } catch (error) {
            toastError(error);
            return null;
          }
        },
        openFile: async (f) => {
          try {
            window.open(await data.files.link(org.id, /** @type {any} */ (f)), '_blank', 'noopener');
          } catch (error) {
            toastError(error);
          }
        },
        pageInfo: (pid) => {
          const x = byId.get(pid);
          return x ? { title: pageTitle(x), icon: pageIconName(x) } : null;
        },
        newSubpage: async () => {
          try {
            await save(true);
            const id = await newPage(org.id, { templateId: 'blank', parentId: p.id, productId: p.productId });
            const meta_ = { id, parentId: p.id, kind: /** @type {const} */ ('page'), title: '', icon: '', iconColor: '', props: { docType: 'note' }, productId: p.productId, customerId: null, position: Date.now() / 1000, archivedAt: null, editingBy: null, editingAt: null, editingName: '', meetingDate: null, editorName: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            pages.push(meta_);
            byId.set(id, meta_);
            expanded.add(p.id);
            saveExpanded();
            drawTree();
            drawBelow();
            return id;
          } catch (error) {
            toastError(error);
            return null;
          }
        },
        taskInfo: (taskId) => {
          const t = taskMap.get(taskId);
          return t ? { status: t.status, assigneeName: t.assigneeName, dueDate: t.dueDate } : null;
        },
        setTaskDone: async (taskId, done) => {
          const t = taskMap.get(taskId);
          if (!t) return;
          await data.tasks.save(org.id, /** @type {any} */ ({ ...t, status: done ? 'done' : 'todo' }), t.id).catch((e) => {
            toastError(e);
            throw e;
          });
          t.status = done ? 'done' : 'todo';
          drawBelow();
        },
        editTask: (block) => editTask(block),
        askLink: async (currentHref) => {
          /** @type {string | null | undefined} */
          let answer;
          const ok = await openDialog({
            title: 'Link',
            body: html`<label class="field"><span class="field__label">Endereço</span><input class="input" name="href" value="${currentHref ?? ''}" placeholder="https://… ou deixe vazio para tirar" autocomplete="off"></label>`,
            submitLabel: 'Aplicar',
            onSubmit: (form) => {
              answer = String(form.get('href') ?? '').trim() || null;
            },
          });
          return ok ? answer : undefined;
        },
        canTasks: manage && canDo('projects.manage'),
        onSave: () => save(true),
        aiRewrite: readOnly ? null : async (text) => {
          let key = '';
          const ok = await openDialog({
            title: 'Escrever com IA',
            description: `“${text.slice(0, 80)}${text.length > 80 ? '…' : ''}”`,
            body: html`<div class="pick-list">${REWRITE.map((r, i) => html`<label class="pick"><input type="radio" name="op" value="${r.key}" ${i === 0 ? html`checked` : ''}><span class="pick__body"><strong>${r.label}</strong></span></label>`)}</div>`,
            submitLabel: 'Gerar',
            onSubmit: (form) => { key = String(form.get('op')); },
          });
          if (!ok) return null;
          return aiWrite(rewriteMessages(key, text), { title: REWRITE.find((r) => r.key === key)?.label ?? 'IA' });
        },
      },
    });

    /** Tarefa de verdade a partir de um bloco "tarefa". @param {import('../../core/blocks.js').Block} block */
    async function editTask(block) {
      const t = block.taskId ? taskMap.get(block.taskId) : null;
      const text = runsText(block.text).trim();
      if (text.length < 2) {
        toast('Escreva a tarefa primeiro.', 'info');
        return null;
      }
      /** @type {string | null} */
      let id = t?.id ?? null;
      await openDialog({
        title: t ? 'Responsável e prazo' : 'Virar tarefa de verdade',
        description: t ? text : 'A tarefa aparece no Hoje de quem vai fazer e, se tiver projeto, no projeto.',
        body: html`<div class="form-grid">
            <label class="field"><span class="field__label">Responsável</span><select class="input" name="assigneeId"><option value="">Sem responsável</option>
              ${members.map((m) => html`<option value="${m.userId}" ${t?.assigneeId === m.userId ? html`selected` : ''}>${m.name}</option>`)}</select></label>
            <label class="field"><span class="field__label">Prazo</span><input class="input" type="date" name="dueDate" value="${t?.dueDate ?? ''}"></label>
            <label class="field form-grid__full"><span class="field__label">Projeto</span><select class="input" name="productId" ${t ? html`disabled` : ''}><option value="">Nenhum</option>
              ${products.map((x) => html`<option value="${x.id}" ${(t ? t.productId : p.productId) === x.id ? html`selected` : ''}>${x.name}</option>`)}</select></label>
          </div>`,
        submitLabel: t ? 'Salvar' : 'Criar tarefa',
        onSubmit: async (form) => {
          const assigneeId = String(form.get('assigneeId') ?? '') || null;
          const dueDate = String(form.get('dueDate') ?? '') || null;
          if (t) {
            await data.tasks.save(org.id, /** @type {any} */ ({ ...t, title: text.slice(0, 200), assigneeId, dueDate }), t.id);
            Object.assign(t, { assigneeId, dueDate, assigneeName: memberName(assigneeId) });
          } else {
            const productId = String(form.get('productId') ?? '') || null;
            id = await data.tasks.save(org.id, /** @type {any} */ ({ pageId: p.id, productId, title: text.slice(0, 200), status: block.checked ? 'done' : 'todo', assigneeId, dueDate, position: 0 }));
            taskMap.set(/** @type {string} */ (id), /** @type {any} */ ({ id, pageId: p.id, productId, title: text.slice(0, 200), status: block.checked ? 'done' : 'todo', assigneeId, dueDate, assigneeName: memberName(assigneeId), projectName: products.find((x) => x.id === productId)?.name ?? '', pageTitle: title, position: 0, doneAt: null, createdAt: new Date().toISOString() }));
          }
        },
      }).catch((e) => (toastError(e), false));
      drawBelow();
      return id;
    }

    // Reunião -------------------------------------------------------------------------------------
    /** @type {ReturnType<typeof mountMeeting> | null} */
    let meetingPanel = null;
    if (p.kind === 'meeting') {
      meeting ??= { date: today(), durationS: 0, participants: [], transcript: [] };
      meetingPanel = mountMeeting(/** @type {HTMLElement} */ ($('[data-meeting]', main)), {
        title: () => pageTitle({ title }),
        manage: !readOnly,
        canTasks: !readOnly && canDo('projects.manage'),
        members,
        me: { id: user?.id ?? '', name: memberName(user?.id ?? null) || user?.name || 'Você' },
        products,
        productId: p.productId,
        pageId: p.id,
        meeting,
        save: (m) => {
          meeting = m;
          schedule();
        },
        hasContent: () => editor.getBlocks().some((b) => !TEXT_TYPES.has(b.type) || runsText(b.text).trim()),
        applyMinutes: (blocks, mode) => {
          if (mode === 'replace') editor.setBlocks(blocks);
          else editor.append(blocks);
          save(true);
        },
        createTask: async ({ title: t, assigneeId, dueDate, productId }) => {
          const id = await data.tasks.save(org.id, /** @type {any} */ ({ pageId: p.id, productId, title: t, status: 'todo', assigneeId, dueDate, position: 0 }));
          taskMap.set(id, /** @type {any} */ ({ id, pageId: p.id, productId, title: t, status: 'todo', assigneeId, dueDate, assigneeName: memberName(assigneeId), projectName: products.find((x) => x.id === productId)?.name ?? '', pageTitle: title, position: 0, doneAt: null, createdAt: new Date().toISOString() }));
          drawBelow();
          return id;
        },
      });
    }

    // Título e ícone ----------------------------------------------------------------------------
    titleEl.addEventListener('input', () => {
      title = (titleEl.textContent ?? '').replace(/\s+/g, ' ').slice(0, 200);
      schedule();
    }, { signal });
    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        editor.focusStart();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save(true);
      }
    }, { signal });
    titleEl.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' '));
    }, { signal });
    if (!readOnly && !title && !editor.getBlocks().some((b) => runsText(b.text).trim())) titleEl.focus();

    // "Fulano está editando" (aviso leve) ---------------------------------------------------------
    let beat = 0;
    const heartbeat = (/** @type {boolean} */ onFlag) => data.pages.heartbeat(org.id, p.id, onFlag).catch(() => {});
    if (!readOnly) {
      heartbeat(true);
      beat = window.setInterval(() => heartbeat(true), 30_000);
    }

    // Barra de cima -------------------------------------------------------------------------------
    main.addEventListener('click', async (e) => {
      const btn = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-page]'));
      if (!btn) return;
      const action = btn.dataset.page;
      try {
        if (action === 'fav') {
          favorites = isFav() ? favorites.filter((x) => x !== p.id) : [...favorites, p.id];
          await data.prefs.set(org.id, FAV_KEY, favorites);
          btn.classList.toggle('is-on', isFav());
          btn.setAttribute('aria-pressed', String(isFav()));
          drawTree();
        }
        if (action === 'unlock') {
          readOnly = false;
          editor.setReadOnly(false);
          titleEl.contentEditable = 'true';
          /** @type {HTMLButtonElement} */ ($('[data-page="icon"]', main)).disabled = false;
          $('[data-lock]', main)?.remove();
          setStatus('Salvo');
          heartbeat(true);
          beat = window.setInterval(() => heartbeat(true), 30_000);
        }
        if (action === 'restore') {
          await data.pages.archive(org.id, p.id, false);
          toast('Página restaurada.', 'success');
          location.reload();
        }
        if (action === 'icon') pickIcon(btn);
        if (action === 'child-meeting') await create({ templateId: 'meeting', parentId: p.id, productId: p.productId });
        if (action === 'child-doc') await create({ templateId: 'blank', parentId: p.id, productId: p.productId });
        if (action === 'history') history();
        if (action === 'more') more(btn);
      } catch (error) {
        toastError(error);
      }
    }, { signal });

    /** @param {HTMLElement} anchor */
    function pickIcon(anchor) {
      const panel = createElement(html`<div class="cad-icons" role="menu" aria-label="Ícone e cor">
        <div class="cad-icons__colors">${ICON_COLORS.map((c) => html`<button type="button" class="cad-color pi--${c || 'default'} ${c === iconColor ? 'is-on' : ''}" data-color="${c}" title="${COLOR_LABEL[c]}" aria-label="Cor ${COLOR_LABEL[c]}"></button>`)}</div>
        <div class="cad-icons__grid">${PAGE_ICONS.map((ic) => html`<button type="button" class="pi--${iconColor || 'default'} ${ic === pageIconName({ icon: iconValue, kind: p.kind }) ? 'is-on' : ''}" data-icon="${ic}" role="menuitem" aria-label="${ic}">${icon(/** @type {any} */ (ic))}</button>`)}</div>
      </div>`);
      const close = togglePopover(anchor, panel);
      const apply = () => {
        setHtml(anchor, pageIcon({ icon: iconValue, kind: p.kind, iconColor }));
        schedule();
        const meta_ = byId.get(p.id);
        if (meta_) Object.assign(meta_, { icon: iconValue, iconColor });
        drawTree();
      };
      panel.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        const color = /** @type {HTMLElement | null} */ (target.closest('[data-color]'));
        if (color) {
          iconColor = color.dataset.color ?? '';
          panel.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('is-on', b === color));
          panel.querySelectorAll('[data-icon]').forEach((b) => (b.className = `pi--${iconColor || 'default'} ${b.classList.contains('is-on') ? 'is-on' : ''}`));
          return apply();
        }
        const b = /** @type {HTMLElement | null} */ (target.closest('[data-icon]'));
        if (!b) return;
        iconValue = b.dataset.icon ?? '';
        close?.();
        apply();
      });
    }

    /** @param {HTMLElement} anchor */
    function more(anchor) {
      const items = [
        manage && !readOnly ? ['duplicate', 'Duplicar'] : null,
        manage && !readOnly ? ['move', 'Mover para…'] : null,
        manage && !readOnly ? ['link', 'Ligar a projeto ou cliente'] : null,
        manage && !readOnly ? ['ai-summary', 'IA: resumir a página'] : null,
        manage && !readOnly ? ['ai-tasks', 'IA: achar as tarefas'] : null,
        manage && !readOnly ? ['ai-draft', 'IA: escrever rascunho pelo título'] : null,
        ['markdown', 'Baixar como Markdown'],
        ['copy', 'Copiar link'],
        manage && !p.archivedAt ? ['trash', 'Mover para a lixeira'] : null,
      ].filter(Boolean);
      const panel = createElement(html`<div class="menu" role="menu">${items.map((it) => html`<button type="button" class="menu__item" role="menuitem" data-more="${/** @type {string[]} */ (it)[0]}">${/** @type {string[]} */ (it)[1]}</button>`)}</div>`);
      const close = togglePopover(anchor, panel, { align: 'end' });
      panel.addEventListener('click', async (e) => {
        const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-more]'));
        if (!b) return;
        close?.();
        try {
          await moreAction(String(b.dataset.more));
        } catch (error) {
          toastError(error);
        }
      });
    }

    /** @param {string} action */
    async function moreAction(action) {
      if (action === 'ai-summary' || action === 'ai-tasks' || action === 'ai-draft') {
        const body = blocksToText(editor.getBlocks());
        if (action !== 'ai-draft' && body.trim().length < 20) return toast('A página ainda tem pouco texto.', 'info');
        if (action === 'ai-draft' && pageTitle({ title }) === 'Sem título') return toast('Dê um título à página primeiro.', 'info');
        const msgs = action === 'ai-draft' ? draftMessages(pageTitle({ title }), body) : pageMessages(action === 'ai-tasks' ? 'tasks' : 'summary', pageTitle({ title }), body);
        const out = await aiWrite(msgs, { title: action === 'ai-draft' ? 'Rascunho da página' : action === 'ai-tasks' ? 'Tarefas da página' : 'Resumo da página', useLabel: 'Inserir na página', maxTokens: 900 });
        if (!out) return;
        const head = action === 'ai-summary' ? [textToBlocks('## Resumo')[0]] : action === 'ai-tasks' ? [textToBlocks('## Tarefas')[0]] : [];
        editor.append([...head, ...textToBlocks(out)]);
        save(true);
        toast('Texto da IA inserido.', 'success');
      }
      if (action === 'markdown') {
        const blob = new Blob([blocksToMarkdown(editor.getBlocks(), pageTitle({ title }))], { type: 'text/markdown;charset=utf-8' });
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${normalize(pageTitle({ title })).replace(/[^\w]+/g, '-').slice(0, 60) || 'pagina'}.md` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
      if (action === 'copy') {
        await navigator.clipboard.writeText(`${location.origin}${location.pathname}#/workspace/${p.id}`);
        toast('Link copiado.', 'success');
      }
      if (action === 'duplicate') {
        await save(true);
        const { id } = await data.pages.create(org.id, { kind: p.kind, parentId: p.parentId, title: `${pageTitle({ title })} (cópia)`, icon: iconValue, iconColor, props, content: editor.getBlocks().map((b) => ({ ...b, taskId: undefined })), meeting: p.kind === 'meeting' ? meeting : null, productId: p.productId, customerId: p.customerId, position: p.position + 0.001, searchText: searchText() });
        toast('Página duplicada.', 'success');
        location.hash = `#/workspace/${id}`;
      }
      if (action === 'move') {
        const blocked = new Set([p.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const x of pages) if (x.parentId && blocked.has(x.parentId) && !blocked.has(x.id)) {
            blocked.add(x.id);
            grew = true;
          }
        }
        const options = alive().filter((x) => !blocked.has(x.id)).sort((a, b) => pageTitle(a).localeCompare(pageTitle(b), 'pt-BR'));
        await openDialog({
          title: 'Mover para…',
          body: html`<label class="field"><span class="field__label">Dentro de</span><select class="input" name="parent"><option value="">Raiz do Caderno</option>
            ${options.map((x) => html`<option value="${x.id}" ${x.id === p.parentId ? html`selected` : ''}>${x.kind === 'project' ? 'Projeto: ' : ''}${pageTitle(x)}</option>`)}</select></label>`,
          submitLabel: 'Mover',
          onSubmit: async (form) => {
            const parentId = String(form.get('parent') ?? '') || null;
            await data.pages.save(org.id, p.id, { parentId, position: Date.now() / 1000 });
            p.parentId = parentId;
            const meta_ = byId.get(p.id);
            if (meta_) meta_.parentId = parentId;
            if (parentId) {
              expanded.add(parentId);
              saveExpanded();
            }
            drawTree();
            toast('Página movida.', 'success');
          },
        });
      }
      if (action === 'link') {
        await openDialog({
          title: 'Ligar a projeto ou cliente',
          description: 'A página aparece no Caderno do projeto e as tarefas novas já vêm com ele.',
          body: html`<div class="form-grid">
              <label class="field"><span class="field__label">Projeto</span><select class="input" name="productId"><option value="">Nenhum</option>${products.map((x) => html`<option value="${x.id}" ${x.id === p.productId ? html`selected` : ''}>${x.name}</option>`)}</select></label>
              <label class="field"><span class="field__label">Cliente</span><select class="input" name="customerId"><option value="">Nenhum</option>${customers.map((x) => html`<option value="${x.id}" ${x.id === p.customerId ? html`selected` : ''}>${x.name}</option>`)}</select></label>
            </div>`,
          submitLabel: 'Salvar',
          onSubmit: async (form) => {
            const productId = String(form.get('productId') ?? '') || null;
            const customerId = String(form.get('customerId') ?? '') || null;
            await data.pages.save(org.id, p.id, { productId, customerId });
            p.productId = productId;
            p.customerId = customerId;
            drawMeta();
          },
        });
      }
      if (action === 'trash') {
        const ok = await confirmDialog({ title: 'Mover para a lixeira?', message: `“${pageTitle({ title })}” sai do Caderno (as páginas dentro dela também). Dá para restaurar na Lixeira.`, confirmLabel: 'Mover para a lixeira', danger: true });
        if (!ok) return;
        await save(true);
        await data.pages.archive(org.id, p.id, true);
        toast('Página na lixeira.', 'success');
        location.hash = p.parentId ? `#/workspace/${p.parentId}` : '#/workspace';
      }
    }

    async function history() {
      const list = await data.pages.versions(org.id, p.id);
      if (!list.length) return toast('Ainda não há versões antigas. Elas são guardadas a cada 10 minutos de edição.', 'info');
      /** @type {string | null} */
      let chosen = null;
      const ok = await openDialog({
        title: 'Histórico de versões',
        description: 'Guardadas a cada 10 min de edição ou quando outra pessoa edita. Voltar uma versão guarda a atual no histórico.',
        body: html`<div class="pick-list">${list.map((v, i) => html`<label class="pick"><input type="radio" name="version" value="${v.id}" ${i === 0 ? html`checked` : ''}><span class="pick__body"><strong>${formatDateTime(v.createdAt)}</strong><small>${v.authorName || '—'} · ${v.title || 'Sem título'}</small></span></label>`)}</div>`,
        submitLabel: readOnly ? null : 'Voltar para esta versão',
        onSubmit: (form) => {
          chosen = String(form.get('version') ?? '') || null;
        },
      });
      if (!ok || !chosen || readOnly) return;
      const v = await data.pages.version(org.id, chosen);
      title = v.title;
      titleEl.textContent = v.title;
      editor.setBlocks(v.content);
      await save(true);
      toast('Versão restaurada.', 'success');
    }

    // Sair da página: salva o que faltou e libera o aviso de edição -------------------------------------
    const beforeUnload = (/** @type {BeforeUnloadEvent} */ e) => {
      if (dirty || meetingPanel?.busy()) e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    signal.addEventListener('abort', () => {
      window.removeEventListener('beforeunload', beforeUnload);
      clearInterval(beat);
      if (dirty && !readOnly) save(true);
      if (!readOnly) heartbeat(false);
      editor.destroy();
      meetingPanel?.destroy();
    });
  }
}
