// DUM Workspace — documentos da equipe e arquivos (Supabase Storage, bucket privado).
// #/workspace (documentos + arquivos) · #/workspace/<id> (editor do documento)

import { html, setHtml, $, bindActions } from '../../shared/utils/dom.js';
import { formatRelative, formatDateTime, normalize } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { FILE_MAX_BYTES, formatBytes } from '../../core/workspace.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { openDialog, confirmDialog } from '../../shared/components/dialog.js';
import { dataTable } from '../../shared/components/table.js';
import { emptyState, loadError, toast, toastError, errorMessage } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';

/** @typedef {import('../../modules/index.js').ModuleContext} Ctx */
/** @typedef {import('../../services/data.js').Doc} Doc */
/** @typedef {import('../../services/data.js').WorkspaceFile} WorkspaceFile */

const excerpt = (/** @type {string} */ body) => body.replace(/\s+/g, ' ').trim().slice(0, 140);

/** @param {Ctx} ctx */
export async function render(ctx) {
  if (ctx.route.section) return renderEditor(ctx, ctx.route.section);
  return renderHome(ctx);
}

/** @param {Ctx} ctx */
async function renderHome({ root, module, signal }) {
  const { org } = getState();
  const manage = canDo('workspace.manage');
  const info = await data.health.info().catch(() => ({ storage: false }));
  /** @type {Doc[]} */
  let docs = [];
  /** @type {WorkspaceFile[]} */
  let files = [];
  let query = '';

  setHtml(
    root,
    html`<header class="page-head">
        <div>
          <h1 class="page-title">Workspace</h1>
          <p class="page-sub">Documentos e arquivos de ${org.name}</p>
        </div>
        ${manage ? html`<div class="page-actions"><button type="button" class="btn btn--primary" data-action="new-doc">${icon('plus')}<span>Novo documento</span></button></div>` : ''}
      </header>
      <section class="panel" aria-labelledby="docs-title">
        <header class="panel__head">
          <h2 class="panel__title" id="docs-title">Documentos</h2>
          <label class="search-field">${icon('search')}<span class="sr-only">Buscar documentos</span>
            <input class="input input--bare" type="search" placeholder="Título ou conteúdo" data-search></label>
        </header>
        <div data-docs><div class="skeleton"></div></div>
      </section>
      <section class="panel" aria-labelledby="files-title">
        <header class="panel__head">
          <h2 class="panel__title" id="files-title">Arquivos</h2>
          ${manage && info.storage
            ? html`<label class="btn btn--secondary btn--sm file-pick">${icon('plus')}<span>Enviar arquivo</span>
                <input type="file" data-upload class="sr-only"></label>`
            : ''}
        </header>
        ${info.storage
          ? html`<p class="panel__hint files-hint">Até 10 MB por arquivo. Guardados em bucket privado; o download usa um link que vale 2 minutos.</p><div data-files></div>`
          : html`<p class="notice notice--warn">Arquivos ficam no Supabase Storage, que não respondeu neste projeto.</p>`}
      </section>`,
  );
  const docsSlot = /** @type {HTMLElement} */ ($('[data-docs]', root));
  const filesSlot = $('[data-files]', root);

  const drawDocs = () => {
    const terms = normalize(query);
    const rows = docs
      .filter((d) => normalize(`${d.title} ${d.body}`).includes(terms))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    if (!docs.length) {
      setHtml(docsSlot, emptyState({ title: 'Nenhum documento ainda', text: manage ? 'Processos, atas, roteiros de implantação: crie o primeiro documento da equipe.' : 'Quando a equipe criar documentos, eles aparecem aqui.', compact: true }));
      return;
    }
    setHtml(
      docsSlot,
      rows.length
        ? html`<ul class="doc-list">${rows.map(
            (d) => html`<li class="doc-list__item">
              <a class="doc-list__link" href="#/workspace/${d.id}">
                <span class="doc-list__title">${d.pinned ? html`<span class="status-pill status-pill--info">fixado</span> ` : ''}${d.title}</span>
                <span class="doc-list__excerpt">${excerpt(d.body) || 'Documento vazio'}</span>
                <span class="doc-list__meta" title="${formatDateTime(d.updatedAt)}">editado ${formatRelative(d.updatedAt)}${d.editorName ? ` por ${d.editorName}` : ''}</span>
              </a>
            </li>`,
          )}</ul>`
        : emptyState({ title: 'Nada encontrado', text: `Nenhum documento com “${query}”.`, compact: true }),
    );
  };

  const drawFiles = () => {
    if (!filesSlot) return;
    filesSlot.replaceChildren(
      dataTable({
        label: 'Arquivos',
        rows: files,
        sort: { key: 'date', dir: 'desc' },
        empty: emptyState({ title: 'Nenhum arquivo enviado', compact: true }),
        columns: [
          { key: 'name', label: 'Arquivo', sortValue: (f) => f.name, render: (f) => html`<button type="button" class="link-strong" data-action="download" data-id="${f.id}">${f.name}</button>` },
          { key: 'size', label: 'Tamanho', sortValue: (f) => f.size, render: (f) => html`<span class="mono">${formatBytes(f.size)}</span>` },
          { key: 'by', label: 'Enviado por', hideOnMobile: true, sortValue: (f) => f.uploaderName, render: (f) => f.uploaderName || '—' },
          { key: 'date', label: 'Quando', hideOnMobile: true, sortValue: (f) => f.createdAt, render: (f) => html`<span class="mono" title="${formatDateTime(f.createdAt)}">${formatRelative(f.createdAt)}</span>` },
          ...(manage
            ? [{
                key: 'actions',
                label: 'Ações',
                align: /** @type {const} */ ('end'),
                render: (/** @type {WorkspaceFile} */ f) => html`<button type="button" class="icon-btn icon-btn--sm" data-action="remove-file" data-id="${f.id}" aria-label="Excluir ${f.name}" title="Excluir">${icon('trash')}</button>`,
              }]
            : []),
        ],
      }),
    );
  };

  const load = async () => {
    try {
      [docs, files] = await Promise.all([data.documents.list(org.id), info.storage ? data.files.list(org.id) : Promise.resolve([])]);
      if (signal.aborted) return;
      drawDocs();
      drawFiles();
    } catch (error) {
      if (!signal.aborted) setHtml(docsSlot, loadError(error));
    }
  };

  $('[data-search]', root).addEventListener('input', (event) => {
    query = /** @type {HTMLInputElement} */ (event.target).value;
    drawDocs();
  }, { signal });

  $('[data-upload]', root)?.addEventListener('change', async (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > FILE_MAX_BYTES) return toast('Arquivo maior que 10 MB.', 'danger');
    toast(`Enviando ${file.name}…`, 'info');
    try {
      await data.files.upload(org.id, file);
      toast('Arquivo enviado.', 'success');
      load();
    } catch (error) {
      toastError(error);
    }
  }, { signal });

  bindActions(root, {
    'new-doc': async () => {
      let id = '';
      const ok = await openDialog({
        title: 'Novo documento',
        body: html`<label class="field"><span class="field__label">Título</span><input class="input" name="title" required maxlength="160" autocomplete="off" placeholder="Ex.: Roteiro de implantação"></label>`,
        submitLabel: 'Criar e abrir',
        onSubmit: async (form) => {
          id = await data.documents.save(org.id, { title: String(form.get('title')), body: '', pinned: false });
        },
      });
      if (ok) location.hash = `#/workspace/${id}`;
    },
    download: async (el) => {
      try {
        const url = await data.files.link(org.id, files.find((f) => f.id === el.dataset.id));
        window.open(url, '_blank', 'noopener');
      } catch (error) {
        toastError(error);
      }
    },
    'remove-file': async (el) => {
      const file = files.find((f) => f.id === el.dataset.id);
      const ok = await confirmDialog({ title: 'Excluir arquivo?', message: `“${file.name}” será apagado do Storage.`, confirmLabel: 'Excluir', danger: true });
      if (!ok) return;
      try {
        await data.files.remove(org.id, file);
        toast('Arquivo excluído.', 'success');
        load();
      } catch (error) {
        toastError(error);
      }
    },
  }, signal);

  await load();
}

/** @param {Ctx} ctx @param {string} id */
async function renderEditor({ root, module, signal }, id) {
  const { org } = getState();
  const manage = canDo('workspace.manage');
  setHtml(root, html`<div class="skeleton"></div>`);
  /** @type {Doc | undefined} */
  let doc;
  try {
    doc = (await data.documents.list(org.id)).find((d) => d.id === id);
  } catch (error) {
    if (!signal.aborted) setHtml(root, loadError(error));
    return;
  }
  if (signal.aborted) return;
  if (!doc) {
    setHtml(root, emptyState({ title: 'Documento não encontrado', text: 'Ele pode ter sido excluído.', action: { label: 'Voltar ao Workspace', href: '#/workspace' } }));
    return;
  }
  document.title = `${doc.title} · ${module.name} — DUMTech Master`;
  const d = doc;

  if (!manage) {
    setHtml(
      root,
      html`<header class="page-head"><div>
          <p class="eyebrow"><a class="back-link" href="#/workspace">${icon('arrowLeft')}Workspace</a></p>
          <h1 class="page-title">${d.title}</h1>
          <p class="page-sub">Editado ${formatRelative(d.updatedAt)}${d.editorName ? ` por ${d.editorName}` : ''}</p>
        </div></header>
        <article class="panel"><p class="prewrap doc-read">${d.body || 'Documento vazio.'}</p></article>`,
    );
    return;
  }

  setHtml(
    root,
    html`<header class="page-head">
        <div>
          <p class="eyebrow"><a class="back-link" href="#/workspace">${icon('arrowLeft')}Workspace</a></p>
          <p class="page-sub" data-status>Salvo · editado ${formatRelative(d.updatedAt)}${d.editorName ? ` por ${d.editorName}` : ''}</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn--ghost" data-action="remove">${icon('trash')}<span>Excluir</span></button>
          <label class="check"><input type="checkbox" name="pinned" form="doc-form" ${d.pinned ? html`checked` : ''}><span>Fixar no topo</span></label>
          <button type="submit" class="btn btn--primary" form="doc-form">Salvar</button>
        </div>
      </header>
      <form class="panel doc-editor" id="doc-form" novalidate>
        <label class="sr-only" for="doc-title">Título</label>
        <input class="doc-editor__title" id="doc-title" name="title" required maxlength="160" value="${d.title}" autocomplete="off">
        <label class="sr-only" for="doc-body">Conteúdo</label>
        <textarea class="doc-editor__body" id="doc-body" name="body" maxlength="100000" placeholder="Escreva aqui. Ctrl+S salva.">${d.body}</textarea>
        <p class="form-error" role="alert" hidden></p>
      </form>`,
  );
  const form = /** @type {HTMLFormElement} */ ($('#doc-form', root));
  const status = /** @type {HTMLElement} */ ($('[data-status]', root));
  let dirty = false;

  const save = async () => {
    const errorBox = /** @type {HTMLElement} */ ($('.form-error', form));
    errorBox.hidden = true;
    const values = new FormData(form);
    try {
      await data.documents.save(org.id, { title: String(values.get('title')), body: String(values.get('body')), pinned: values.has('pinned') }, d.id);
      dirty = false;
      status.textContent = 'Salvo agora';
    } catch (error) {
      errorBox.textContent = errorMessage(error);
      errorBox.hidden = false;
    }
  };

  form.addEventListener('input', () => {
    dirty = true;
    status.textContent = 'Alterações não salvas';
  }, { signal });
  root.addEventListener('change', (event) => {
    if (/** @type {HTMLInputElement} */ (event.target).name === 'pinned') {
      dirty = true;
      status.textContent = 'Alterações não salvas';
    }
  }, { signal });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save();
  }, { signal });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  }, { signal });
  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  }, { signal });

  bindActions(root, {
    remove: async () => {
      const ok = await confirmDialog({ title: 'Excluir documento?', message: `“${d.title}” será apagado. A exclusão fica na auditoria.`, confirmLabel: 'Excluir', danger: true });
      if (!ok) return;
      try {
        await data.documents.remove(org.id, d.id);
        dirty = false;
        toast('Documento excluído.', 'success');
        location.hash = '#/workspace';
      } catch (error) {
        toastError(error);
      }
    },
  }, signal);
}
