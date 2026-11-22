// Ajustes › Sistema: a saúde do servidor e as cópias de segurança (semanal automática + baixar quando quiser).

import { html, setHtml, $, bindActions } from '../../shared/utils/dom.js';
import { formatDateTime } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { getSupabaseConfig } from '../../services/supabase.js';
import { dataTable } from '../../shared/components/table.js';
import { emptyState, loadError, toast, toastError } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';

const APP_VERSION = '1.0.0';
const sizeText = (/** @type {number} */ bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

/** Baixa um objeto como arquivo .json. @param {unknown} value @param {string} name */
function download(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, signal }) {
  const { org } = getState();
  const { url } = getSupabaseConfig();
  const admin = canDo('org.update');
  let schema = 'verificando…';
  /** @type {{ schemaVersion: string, scheduler: boolean, httpChecks: boolean, monitor?: boolean, storage: boolean } | null} */
  let info = null;
  try {
    info = await data.health.info();
    schema = info.schemaVersion;
  } catch {
    schema = 'sem resposta: as migrations foram aplicadas?';
  }
  if (signal.aborted) return;
  const yes = (/** @type {boolean | undefined} */ v, /** @type {string} */ on, /** @type {string} */ off) =>
    html`<span class="avail"><span class="status-dot status-dot--${v ? 'ok' : 'warn'}" aria-hidden="true"></span>${v ? on : off}</span>`;

  setHtml(
    root,
    html`${admin
        ? html`<section class="panel" aria-labelledby="backup-title">
            <header class="panel__head">
              <div><h2 class="panel__title" id="backup-title">Cópias de segurança</h2>
                <p class="panel__hint">Toda segunda, às 3h, o servidor guarda uma cópia de tudo (menos as senhas do cofre). Baixe de vez em quando e guarde fora do sistema.</p></div>
              <button type="button" class="btn btn--primary btn--sm" data-action="backup">${icon('refresh')}<span>Fazer cópia agora</span></button>
            </header>
            <div data-backups><div class="skeleton"></div></div>
          </section>`
        : ''}
      <section class="panel" aria-labelledby="sys-title">
        <header class="panel__head"><h2 class="panel__title" id="sys-title">Servidor</h2></header>
        <dl class="facts facts--grid">
          <div><dt>Projeto Supabase</dt><dd class="mono">${url ? new URL(url).host : 'não configurado'}</dd></div>
          <div><dt>Versão do banco</dt><dd class="mono">${schema}</dd></div>
          <div><dt>Versão do app</dt><dd class="mono">${APP_VERSION}</dd></div>
          <div><dt>Endereço</dt><dd class="mono">${location.host}</dd></div>
          ${info
            ? html`<div><dt>Rotinas das 8h</dt><dd>${yes(info.scheduler, 'Agendadas no servidor', 'Desligadas: só rodam à mão')}</dd></div>
              <div><dt>“No ar”</dt><dd>${yes(info.monitor, 'Verificando a cada minuto', 'Desligado: falta publicar a função monitor')}</dd></div>
              <div><dt>Arquivos</dt><dd>${yes(info.storage, 'Guardados no Supabase (privado)', 'Indisponível')}</dd></div>`
            : ''}
        </dl>
      </section>`,
  );

  /** @type {{ id: string, kind: 'weekly' | 'manual', size: number, createdAt: string }[]} */
  let backups = [];
  const drawBackups = async () => {
    const slot = $('[data-backups]', root);
    if (!slot) return;
    try {
      backups = await data.backups.list(org.id);
    } catch (error) {
      if (!signal.aborted) setHtml(/** @type {HTMLElement} */ (slot), loadError(error));
      return;
    }
    if (signal.aborted) return;
    slot.replaceChildren(
      dataTable({
        label: 'Cópias de segurança',
        rows: backups,
        sort: { key: 'when', dir: 'desc' },
        empty: emptyState({ title: 'Nenhuma cópia ainda', text: 'A primeira semanal sai na segunda-feira. Faça uma agora para já ter uma.', compact: true }),
        columns: [
          { key: 'when', label: 'Quando', sortValue: (b) => b.createdAt, render: (b) => html`<span class="mono">${formatDateTime(b.createdAt)}</span>` },
          { key: 'kind', label: 'Tipo', sortValue: (b) => b.kind, render: (b) => (b.kind === 'weekly' ? 'Semanal (automática)' : 'Feita à mão') },
          { key: 'size', label: 'Tamanho', align: 'end', sortValue: (b) => b.size, render: (b) => html`<span class="mono">${sizeText(b.size)}</span>` },
          {
            key: 'actions',
            label: 'Ações',
            align: /** @type {const} */ ('end'),
            render: (b) => html`<button type="button" class="btn btn--secondary btn--sm" data-action="download" data-id="${b.id}">Baixar</button>`,
          },
        ],
      }),
    );
  };

  bindActions(root, {
    backup: async (el) => {
      const button = /** @type {HTMLButtonElement} */ (el);
      button.disabled = true;
      try {
        await data.backups.create(org.id);
        toast('Cópia feita. Baixe para guardar fora do sistema.', 'success');
        await drawBackups();
      } catch (error) {
        toastError(error);
      } finally {
        button.disabled = false;
      }
    },
    download: async (el) => {
      const b = backups.find((x) => x.id === el.dataset.id);
      if (!b) return;
      try {
        download(await data.backups.get(org.id, b.id), `dumtech-master-${org.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${b.createdAt.slice(0, 10)}.json`);
      } catch (error) {
        toastError(error);
      }
    },
  }, signal);

  await drawBackups();
}
