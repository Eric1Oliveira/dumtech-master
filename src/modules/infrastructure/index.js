// Serviços — o que os projetos usam: compartilhados (GitHub, Supabase, HostGator: cadastrados uma vez,
// custo dividido entre os projetos) e exclusivos (o domínio, o banco do cliente). Quanto custa, quanto
// se cobra, quando vence e se está no ar (verificação feita pelo servidor, nunca simulada).

import { html, setHtml, $, $$, bindActions } from '../../shared/utils/dom.js';
import { formatDate, formatMoney, formatDateTime } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { ASSET_KINDS, COST_PERIODS, SPLIT_RULES, daysUntil, isPublicHttps, normalizeAsset } from '../../core/infra.js';
import { serviceCosts } from '../../core/costs.js';
import { registrableDomain, lookupExpiration } from '../../core/rdap.js';
import { labelOf } from '../../core/validate.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { listPage } from '../../shared/components/list-page.js';
import { fieldsHtml, readForm, memberOptions } from '../../shared/components/record-form.js';
import { openDialog, confirmDialog } from '../../shared/components/dialog.js';
import { toast, toastError } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';

/** @typedef {import('../../services/data.js').Asset} Asset */
/** @typedef {import('../../services/data.js').Monitor} Monitor */
/** @typedef {import('../../shared/components/record-form.js').Field} Field */

const muted = (/** @type {string} */ text = '—') => html`<span class="muted">${text}</span>`;
const periodShort = (/** @type {string | null} */ p) => (p === 'yearly' ? '/ano' : p === 'once' ? ' único' : '/mês');
const periods = COST_PERIODS.map((p) => ({ value: p.key, label: p.label }));

/** Selo de vencimento: vencido, perto (≤ 30 dias) ou só a data. @param {string | null} date */
export function renewalBadge(date) {
  const days = daysUntil(date);
  if (days === null) return muted();
  const label = days < 0 ? `vencido há ${-days} dia${days < -1 ? 's' : ''}` : days === 0 ? 'vence hoje' : `em ${days} dia${days > 1 ? 's' : ''}`;
  const tone = days < 0 ? 'danger' : days <= 30 ? 'warn' : null;
  return html`<span class="person"><span class="mono">${formatDate(date)}</span>${tone ? html`<small class="status-text status-text--${tone}">${label}</small>` : html`<small>${label}</small>`}</span>`;
}

const MONITOR_STATE = /** @type {Record<string, [string, string]>} */ ({
  unknown: ['info', 'Aguardando'],
  up: ['ok', 'No ar'],
  slow: ['warn', 'Lento'],
  unstable: ['warn', 'Instável'],
  down: ['error', 'Fora do ar'],
});

/** Estado do "No ar" de um monitor (com o tempo de resposta quando houver). @param {Monitor} m */
export function monitorBadge(m) {
  if (!m.enabled) return muted('desligado');
  const [tone, label] = MONITOR_STATE[m.state] ?? MONITOR_STATE.unknown;
  return html`<span class="avail" title="${m.lastCheckAt ? `Última verificação: ${formatDateTime(m.lastCheckAt)}` : 'Aguardando a primeira verificação do servidor'}">
    <span class="status-dot status-dot--${tone}" aria-hidden="true"></span>${label}${m.lastMs ? html` <small class="muted">${m.lastMs} ms</small>` : ''}</span>`;
}

/**
 * Cadastro/edição de serviço, em camadas: tipo e nome → usado por → quanto paga (e como divide) →
 * quanto cobra → vencimento e endereço → mais detalhes. `preset` preenche um novo (ex.: vindo do projeto).
 * @param {Asset | null} current @param {Record<string, any>} [preset]
 */
export async function editAsset(current, preset = {}) {
  const { org } = getState();
  const [members, products, monitors] = await Promise.all([
    data.members.list(org.id).catch(() => []),
    data.products.list(org.id).catch(() => []),
    data.monitors.list(org.id).catch(() => []),
  ]);
  const monitor = current ? monitors.find((m) => m.assetId === current.id) ?? null : null;
  /** @type {Record<string, any>} */
  const v = current ?? { kind: 'hosting', status: 'active', shared: !preset.productId, split: 'equal', costPeriod: 'monthly', pricePeriod: 'monthly', ...preset };
  const projectOptions = products.filter((p) => p.status !== 'ended' || p.id === v.productId).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((p) => ({ value: p.id, label: p.name }));

  /** @type {Field[]} */
  const top = [
    { name: 'kind', label: 'Tipo', type: 'select', options: ASSET_KINDS.map((k) => ({ value: k.key, label: k.label })) },
    { name: 'name', label: 'Nome', required: true, maxlength: 120, placeholder: 'Ex.: Supabase Pro, pizzariabella.com.br' },
  ];
  /** @type {Field[]} */
  const ownFields = [{ name: 'productId', label: 'Projeto', type: 'select', full: true, options: [{ value: '', label: 'Escolha o projeto' }, ...projectOptions] }];
  /** @type {Field[]} */
  const costFields = [
    { name: 'cost', label: 'Você paga (R$)', type: 'money' },
    { name: 'costPeriod', label: 'Período', type: 'select', options: periods },
  ];
  /** @type {Field[]} */
  const splitFields = [
    { name: 'split', label: 'Como entra no custo de cada projeto', type: 'select', options: SPLIT_RULES.map((r) => ({ value: r.key, label: r.label })) },
    { name: 'fixedShare', label: 'Valor fixo por projeto (R$/mês)', type: 'money' },
  ];
  /** @type {Field[]} */
  const priceFields = [
    { name: 'price', label: 'Cobra do cliente (R$)', type: 'money', hint: 'Entra na mensalidade sugerida' },
    { name: 'pricePeriod', label: 'Período', type: 'select', options: periods },
  ];
  /** @type {Field[]} */
  const whenFields = [
    { name: 'renewsAt', label: 'Vence em', type: 'date' },
    { name: 'url', label: 'Endereço', type: 'url', placeholder: 'https://', hint: 'Banco: o endereço do projeto (https://xxxx.supabase.co)' },
  ];
  /** @type {Field[]} */
  const moreFields = [
    { name: 'provider', label: 'Fornecedor', maxlength: 80, placeholder: 'Registro.br, Supabase, HostGator…' },
    { name: 'status', label: 'Situação', type: 'select', options: [{ value: 'active', label: 'Ativo' }, { value: 'inactive', label: 'Desativado' }] },
    { name: 'ownerId', label: 'Responsável', type: 'select', options: memberOptions(members) },
    { name: 'notes', label: 'Observações', type: 'textarea' },
  ];
  const fields = [...top, ...ownFields, ...costFields, ...splitFields, ...priceFields, ...whenFields, ...moreFields];

  const pending = openDialog({
    title: current ? 'Editar serviço' : 'Novo serviço',
    wide: true,
    body: html`${fieldsHtml(top, v)}
      <div class="choice-row" role="radiogroup" aria-label="Usado por">
        <label class="choice"><input type="radio" name="scope" value="shared" ${v.shared ? html`checked` : ''}><span><strong>Vários projetos</strong><small>Compartilhado: GitHub, Supabase Pro, HostGator</small></span></label>
        <label class="choice"><input type="radio" name="scope" value="own" ${v.shared ? '' : html`checked`}><span><strong>Um projeto só</strong><small>Exclusivo: o domínio, o banco do cliente</small></span></label>
      </div>
      <div data-scope="own">${fieldsHtml(ownFields, v)}</div>
      ${fieldsHtml(costFields, v)}
      <div data-scope="shared">${fieldsHtml(splitFields, v)}<p class="field__hint" data-split-hint></p></div>
      ${fieldsHtml(priceFields, v)}
      ${fieldsHtml(whenFields, v)}
      <p class="field__hint" data-rdap aria-live="polite">${v.renewsAuto ? 'Vencimento buscado no registro do domínio.' : ''}</p>
      <label class="checkbox" data-monitor-box><input type="checkbox" name="monitor" ${monitor?.enabled ? html`checked` : ''}> <span>Verificar se está no ar (o servidor confere o endereço; só https público)</span></label>
      <details class="more"><summary>Mais detalhes</summary>${fieldsHtml(moreFields, v)}</details>
      <input type="hidden" name="renewsAuto" value="${v.renewsAuto ? 'true' : ''}">`,
    submitLabel: current ? 'Salvar alterações' : 'Cadastrar serviço',
    onSubmit: async (form) => {
      const values = readForm(form, fields);
      const input = { ...values, shared: form.get('scope') === 'shared', renewsAuto: form.get('renewsAuto') === 'true' };
      const clean = normalizeAsset(input);
      if (!clean.shared && !clean.productId && !current) throw new Error('Escolha o projeto deste serviço (ou marque “Vários projetos”).');
      const id = await data.assets.save(org.id, /** @type {any} */ (input), current?.id);
      if (current?.shared && !clean.shared) {
        for (const link of (await data.assetLinks.list(org.id)).filter((l) => l.assetId === id)) await data.assetLinks.remove(org.id, id, link.productId);
      }
      const wantMonitor = form.get('monitor') === 'on';
      if (wantMonitor && !isPublicHttps(clean.url)) throw new Error('Para verificar se está no ar, informe um endereço https público.');
      if (wantMonitor && !monitor) {
        await data.monitors.save(org.id, { assetId: id, productId: clean.productId, kind: clean.kind === 'database' ? 'database' : 'service', label: clean.name, enabled: true });
      } else if (monitor && monitor.enabled !== wantMonitor) {
        await data.monitors.save(org.id, { ...monitor, enabled: wantMonitor }, monitor.id);
      }
    },
  });

  // Mostra só o que vale para a escolha atual.
  const dialog = /** @type {HTMLDialogElement} */ ([...document.querySelectorAll('dialog.dialog')].at(-1));
  const form = /** @type {HTMLFormElement} */ (dialog.querySelector('form'));
  const field = (/** @type {string} */ name) => /** @type {HTMLInputElement | null} */ (form.elements.namedItem(name));
  const sync = () => {
    const scope = String(new FormData(form).get('scope'));
    for (const box of $$('[data-scope]', form)) /** @type {HTMLElement} */ (box).hidden = /** @type {HTMLElement} */ (box).dataset.scope !== scope;
    const split = field('split')?.value;
    const fixed = /** @type {HTMLElement | null} */ (field('fixedShare')?.closest('.field') ?? null);
    if (fixed) fixed.hidden = split !== 'fixed';
    const hint = $('[data-split-hint]', form);
    if (hint) hint.textContent = { equal: 'O custo se divide igual entre os projetos que usam (em construção ou publicados).', fixed: 'Cada projeto que usa paga este valor por mês.', company: 'Não entra no custo dos projetos; fica como custo da empresa.' }[split ?? 'equal'] ?? '';
    const kind = field('kind')?.value;
    /** @type {HTMLElement} */ ($('[data-monitor-box]', form)).hidden = kind === 'domain' || kind === 'repository';
  };
  const lookup = async () => {
    if (field('kind')?.value !== 'domain') return;
    const domain = registrableDomain(field('name')?.value);
    const hint = $('[data-rdap]', form);
    if (!domain || !hint) return;
    hint.textContent = `Buscando o vencimento de ${domain}…`;
    const expires = await lookupExpiration(domain);
    const renews = field('renewsAt');
    const auto = /** @type {HTMLInputElement} */ (form.elements.namedItem('renewsAuto'));
    if (expires && renews) {
      renews.value = expires;
      auto.value = 'true';
      hint.textContent = `Vence em ${formatDate(expires)}, segundo o registro de ${domain}. A data se atualiza sozinha.`;
    } else {
      auto.value = '';
      hint.textContent = `Não achei a data de ${domain} no registro. Digite o vencimento.`;
    }
  };
  form.addEventListener('change', (event) => {
    const name = event.target instanceof Element ? event.target.getAttribute('name') ?? '' : '';
    if (name === 'name' || name === 'kind') lookup();
    if (name === 'renewsAt') /** @type {HTMLInputElement} */ (form.elements.namedItem('renewsAuto')).value = '';
    sync();
  });
  sync();
  return pending;
}

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, module, signal }) {
  const { org } = getState();
  const manage = canDo('infra.manage');
  const info = await data.health.info().catch(() => ({ schemaVersion: '', scheduler: false, httpChecks: false, monitor: false, storage: false }));
  /** @type {Asset[]} */
  let assets = [];
  /** @type {Monitor[]} */
  let monitors = [];
  /** @type {ReturnType<typeof serviceCosts>} */
  let costs = serviceCosts({ assets: [], links: [], projects: [] });
  /** @type {Map<string, string>} */
  let projectNames = new Map();

  const usersOf = (/** @type {Asset} */ a) => costs.projectsOf(a.id).map((id) => projectNames.get(id) ?? '').filter(Boolean);

  const page = listPage(/** @type {import('../../shared/components/list-page.js').ListPageOptions<Asset>} */ ({
    root,
    module,
    signal,
    title: 'Serviços',
    sub: 'O que os projetos usam: quanto custa, quanto você cobra, quando vence e se está no ar',
    newLabel: manage ? 'Novo serviço' : null,
    statuses: [
      { key: 'shared', label: 'Compartilhados' },
      { key: 'own', label: 'Exclusivos' },
      { key: 'inactive', label: 'Desativados' },
    ],
    statusOf: (a) => (a.status === 'inactive' ? 'inactive' : a.shared ? 'shared' : 'own'),
    searchOf: (a) => `${a.name} ${a.provider ?? ''} ${a.productName} ${usersOf(a).join(' ')} ${a.url ?? ''}`,
    searchLabel: 'Nome, fornecedor, projeto ou endereço',
    sort: { key: 'name', dir: 'asc' },
    empty: {
      title: 'Nenhum serviço cadastrado',
      text: manage ? 'Comece pelos compartilhados (GitHub, Supabase, HostGator): cadastrados uma vez, eles aparecem para marcar em cada projeto novo.' : 'Quando a equipe cadastrar serviços, eles aparecem aqui.',
    },
    columns: [
      {
        key: 'name',
        label: 'Serviço',
        sortValue: (a) => a.name,
        render: (a) => html`<span class="person">
          ${manage ? html`<button type="button" class="link-strong" data-action="edit" data-id="${a.id}">${a.name}</button>` : html`<strong>${a.name}</strong>`}
          <small>${labelOf(ASSET_KINDS, a.kind)}${a.provider ? ` · ${a.provider}` : ''}</small>
        </span>`,
      },
      {
        key: 'used',
        label: 'Usado por',
        hideOnMobile: true,
        sortValue: (a) => (a.shared ? usersOf(a).length : a.productName),
        render: (a) => {
          if (!a.shared) return a.productId ? html`<a href="#/projects/${a.productId}">${a.productName}</a>` : muted('sem projeto');
          const names = usersOf(a);
          return names.length ? html`<span class="person"><span>${names.length} projeto${names.length > 1 ? 's' : ''}</span><small>${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}</small></span>` : muted('nenhum projeto ainda');
        },
      },
      {
        key: 'cost',
        label: 'Custo',
        align: 'end',
        sortValue: (a) => costs.coverage(a).monthly,
        render: (a) => {
          if (a.cost === null) return muted();
          const c = costs.coverage(a);
          const note = !a.shared
            ? a.costPeriod !== 'monthly' ? `${formatMoney(c.monthly)}/mês` : ''
            : a.split === 'company'
              ? 'custo da empresa'
              : a.split === 'fixed'
                ? c.gap > 0 ? `projetos cobrem ${formatMoney(c.covered)} · falta ${formatMoney(c.gap)}` : `projetos cobrem ${formatMoney(c.covered)}`
                : c.users ? `${formatMoney(costs.shareOf(a))} por projeto (÷ ${c.users})` : 'nenhum projeto pagando';
          return html`<span class="person person--end"><span class="mono">${formatMoney(a.cost)}${periodShort(a.costPeriod)}</span>${note ? html`<small class="${a.shared && a.split === 'fixed' && c.gap > 0 ? 'status-text status-text--warn' : ''}">${note}</small>` : ''}</span>`;
        },
      },
      { key: 'price', label: 'Cobra', align: 'end', hideOnMobile: true, sortValue: (a) => a.price ?? 0, render: (a) => (a.price ? html`<span class="mono">${formatMoney(a.price)}</span><small class="muted">${periodShort(a.pricePeriod)}${a.shared ? ' por projeto' : ''}</small>` : muted()) },
      { key: 'renews', label: 'Vence', sortValue: (a) => a.renewsAt ?? '9999', render: (a) => renewalBadge(a.renewsAt) },
      {
        key: 'up',
        label: 'No ar',
        hideOnMobile: true,
        sortValue: (a) => monitors.find((m) => m.assetId === a.id)?.state ?? 'zz',
        render: (a) => {
          const m = monitors.find((x) => x.assetId === a.id);
          return m ? monitorBadge(m) : muted();
        },
      },
      ...(manage
        ? [{
            key: 'actions',
            label: 'Ações',
            align: /** @type {const} */ ('end'),
            render: (/** @type {Asset} */ a) => html`<button type="button" class="icon-btn icon-btn--sm" data-action="remove" data-id="${a.id}" aria-label="Excluir ${a.name}" title="Excluir">${icon('trash')}</button>`,
          }]
        : []),
    ],
  }));

  // Resumo logo abaixo do título.
  const summary = document.createElement('div');
  summary.className = 'infra-summary';
  $('.page-head', root)?.after(summary);
  if (info.monitor) {
    $('.page-actions', root)?.insertAdjacentHTML('afterbegin', '<button type="button" class="btn btn--secondary" data-action="check"><span>Verificar agora</span></button>');
  }

  const drawSummary = () => {
    const due = assets.filter((a) => a.status === 'active' && (daysUntil(a.renewsAt) ?? 99) <= 30).length;
    const down = monitors.filter((m) => m.enabled && m.state === 'down').length;
    summary.replaceChildren();
    summary.insertAdjacentHTML(
      'beforeend',
      html`<dl class="stat-strip">
        <div><dt>Custo mensal</dt><dd class="mono">${formatMoney(costs.total)}</dd><span class="stat-note">anual ÷ 12; único não entra</span></div>
        <div><dt>Compartilhados</dt><dd class="mono">${formatMoney(costs.shared)}</dd><span class="stat-note">divididos entre os projetos</span></div>
        <div><dt>Exclusivos</dt><dd class="mono">${formatMoney(costs.exclusive)}</dd><span class="stat-note">de um projeto cada</span></div>
        <div><dt>Atenção</dt><dd class="mono ${due || down ? 'status-text--warn' : ''}">${due + down}</dd><span class="stat-note">${down ? `${down} fora do ar · ` : ''}${due} vencendo em 30 dias</span></div>
      </dl>
      ${monitors.some((m) => m.enabled) && !info.monitor
        ? html`<p class="notice notice--warn">O “No ar” ainda não está ligado neste projeto: falta o endereço do projeto no agendamento ou publicar a função monitor. Veja Ajustes › Sistema.</p>`
        : ''}`.value,
    );
  };

  const load = async () => {
    try {
      const [list, links, products, mons] = await Promise.all([
        data.assets.list(org.id),
        data.assetLinks.list(org.id).catch(() => []),
        data.products.list(org.id).catch(() => []),
        data.monitors.list(org.id).catch(() => []),
      ]);
      assets = list;
      monitors = mons;
      projectNames = new Map(products.map((p) => /** @type {[string, string]} */ ([p.id, p.name])));
      costs = serviceCosts({ assets, links, projects: products });
      if (signal.aborted) return;
      drawSummary();
      page.show(assets);
    } catch (error) {
      if (!signal.aborted) page.fail(error);
    }
  };

  bindActions(root, {
    new: async () => {
      if (await editAsset(null).catch((error) => (toastError(error), false))) {
        toast('Serviço cadastrado.', 'success');
        load();
      }
    },
    edit: async (el) => {
      const a = assets.find((x) => x.id === el.dataset.id);
      if (a && (await editAsset(a).catch((error) => (toastError(error), false)))) {
        toast('Serviço atualizado.', 'success');
        load();
      }
    },
    remove: async (el) => {
      const a = assets.find((x) => x.id === el.dataset.id);
      if (!a) return;
      const used = a.shared ? usersOf(a).length : 0;
      const ok = await confirmDialog({
        title: 'Excluir serviço?',
        message: `“${a.name}” sai da lista${used ? ` e de ${used} projeto${used > 1 ? 's' : ''} (o custo deles muda)` : ''}, junto com o histórico de verificações.`,
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!ok) return;
      try {
        await data.assets.remove(org.id, a.id);
        toast('Serviço excluído.', 'success');
        load();
      } catch (error) {
        toastError(error);
      }
    },
    check: async (el) => {
      const button = /** @type {HTMLButtonElement} */ (el);
      button.disabled = true;
      try {
        const sent = await data.monitoring.checkNow(org.id);
        if (!sent) {
          toast('Acabou de ser verificado. Tente de novo em alguns segundos.', 'info');
          return;
        }
        await load();
        toast(`${sent} endereço(s) verificado(s) agora.`, 'success');
      } catch (error) {
        toastError(error);
      } finally {
        button.disabled = false;
      }
    },
  }, signal);

  await load();
}
