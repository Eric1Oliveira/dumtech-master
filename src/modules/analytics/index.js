// DUM Analytics — uso dos produtos DUMTech, enviado pelos próprios sistemas (sem rastreador
// de terceiros). Cada produto tem chaves de coleta; os eventos chegam por track_event.

import { html, setHtml, $, $$, bindActions } from '../../shared/utils/dom.js';
import { formatInteger, formatRelative, formatDateTime, formatDate } from '../../shared/utils/format.js';
import { getState, uiPrefs } from '../../core/state.js';
import { PERIODS, dailySeries, trackingSnippet } from '../../core/analytics.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { getSupabaseConfig } from '../../services/supabase.js';
import { dataTable } from '../../shared/components/table.js';
import { openDialog, confirmDialog } from '../../shared/components/dialog.js';
import { emptyState, loadError, toast, toastError } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';

/** @typedef {import('../../services/data.js').AnalyticsKey} AnalyticsKey */

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, module, signal }) {
  const { org } = getState();
  const manage = canDo('analytics.manage');
  let days = Number(uiPrefs.get('analytics.days') ?? 30);
  if (!PERIODS.some((p) => Number(p.key) === days)) days = 30;
  /** @type {AnalyticsKey[]} */
  let keys = [];
  /** @type {import('../../services/data.js').Product[]} */
  let products = [];

  setHtml(
    root,
    html`<header class="page-head">
        <div>
          <h1 class="page-title">Uso dos produtos</h1>
          <p class="page-sub">Eventos enviados pelos próprios sistemas DUMTech — sem rastreadores de terceiros</p>
        </div>
        <div class="page-actions"><div class="segmented" role="tablist" aria-label="Período" data-periods></div></div>
      </header>
      <div data-stats></div>
      <section class="panel" aria-labelledby="chart-title">
        <header class="panel__head"><h2 class="panel__title" id="chart-title">Eventos por dia</h2><p class="panel__hint" data-range></p></header>
        <div data-chart><div class="skeleton"></div></div>
      </section>
      <section class="panel" aria-labelledby="products-title">
        <header class="panel__head"><h2 class="panel__title" id="products-title">Por produto</h2></header>
        <div data-products></div>
      </section>
      <section class="panel" aria-labelledby="top-title">
        <header class="panel__head"><h2 class="panel__title" id="top-title">Eventos mais frequentes</h2></header>
        <div data-top></div>
      </section>
      <section class="panel" aria-labelledby="keys-title">
        <header class="panel__head">
          <h2 class="panel__title" id="keys-title">Chaves de coleta</h2>
          ${manage ? html`<button type="button" class="btn btn--secondary btn--sm" data-action="new-key">${icon('plus')}<span>Nova chave</span></button>` : ''}
        </header>
        <p class="panel__hint files-hint">Cada produto envia eventos com a própria chave. Ela aparece uma única vez, ao ser criada; revogue se vazar.</p>
        <div data-keys></div>
      </section>`,
  );

  const drawPeriods = () =>
    setHtml(
      /** @type {HTMLElement} */ ($('[data-periods]', root)),
      html`${PERIODS.map((p) => html`<button type="button" role="tab" class="segmented__item" aria-selected="${Number(p.key) === days}" data-days="${p.key}">${p.label}</button>`)}`,
    );

  const productName = (/** @type {string} */ id) => products.find((p) => p.id === id)?.name ?? 'Projeto excluído';

  const drawChart = (/** @type {{ day: string, events: number }[]} */ series) => {
    const slot = /** @type {HTMLElement} */ ($('[data-chart]', root));
    const max = Math.max(...series.map((s) => s.events), 0);
    /** @type {HTMLElement} */ ($('[data-range]', root)).textContent = `${formatDate(series[0].day)} a ${formatDate(series.at(-1).day)}`;
    if (!max) {
      setHtml(slot, emptyState({ title: 'Nenhum evento no período', text: 'Assim que um produto enviar eventos com uma chave de coleta, eles aparecem aqui.', compact: true }));
      return;
    }
    setHtml(
      slot,
      html`<div class="bar-chart">
        <div class="bar-chart__scale" aria-hidden="true"><span>${formatInteger(max)}</span><span>0</span></div>
        <div class="bar-chart__plot" aria-hidden="true">
          ${series.map((s) => html`<div class="bar-chart__col" data-tip="${formatDate(s.day)}: ${formatInteger(s.events)} evento${s.events === 1 ? '' : 's'}"><div class="bar-chart__bar ${s.events ? '' : 'is-zero'}"></div></div>`)}
        </div>
        <div class="bar-chart__axis" aria-hidden="true"><span>${formatDate(series[0].day)}</span><span>${formatDate(series.at(-1).day)}</span></div>
        <table class="sr-only"><caption>Eventos por dia</caption><thead><tr><th>Dia</th><th>Eventos</th></tr></thead>
          <tbody>${series.map((s) => html`<tr><td>${formatDate(s.day)}</td><td>${s.events}</td></tr>`)}</tbody></table>
      </div>`,
    );
    // Altura de cada barra pelo CSSOM (a CSP não permite style="" no HTML).
    $$('.bar-chart__bar', slot).forEach((bar, i) => {
      bar.style.height = series[i].events ? `${Math.max((series[i].events / max) * 100, 2)}%` : '2px';
    });
  };

  const drawKeys = () => {
    /** @type {HTMLElement} */ ($('[data-keys]', root)).replaceChildren(
      dataTable({
        label: 'Chaves de coleta',
        rows: keys,
        sort: { key: 'created', dir: 'desc' },
        empty: emptyState({ title: 'Nenhuma chave criada', text: manage ? 'Crie uma chave para o produto e cole o trecho de código nele.' : 'Quem administra a organização cria as chaves.', compact: true }),
        columns: [
          { key: 'label', label: 'Chave', sortValue: (k) => k.label, render: (k) => html`<span class="person"><strong>${k.label}</strong><small class="mono">${k.prefix}…</small></span>` },
          { key: 'product', label: 'Projeto', sortValue: (k) => k.productName, render: (k) => k.productName },
          { key: 'created', label: 'Criada', hideOnMobile: true, sortValue: (k) => k.createdAt, render: (k) => html`<span class="mono" title="${formatDateTime(k.createdAt)}">${formatRelative(k.createdAt)}</span>` },
          { key: 'state', label: 'Situação', render: (k) => (k.revokedAt ? html`<span class="status-pill status-pill--muted">Revogada</span>` : html`<span class="status-pill status-pill--ok">Ativa</span>`) },
          ...(manage
            ? [{
                key: 'actions',
                label: 'Ações',
                align: /** @type {const} */ ('end'),
                render: (/** @type {AnalyticsKey} */ k) => (k.revokedAt ? '' : html`<button type="button" class="btn btn--ghost btn--sm" data-action="revoke" data-id="${k.id}">Revogar</button>`),
              }]
            : []),
        ],
      }),
    );
  };

  const load = async () => {
    try {
      const [daily, top, keyList, productList] = await Promise.all([
        data.analytics.daily(org.id, days),
        data.analytics.top(org.id, days),
        data.analytics.keys(org.id),
        data.products.list(org.id).catch(() => []),
      ]);
      if (signal.aborted) return;
      keys = keyList;
      products = productList;
      const totalEvents = daily.reduce((s, d) => s + d.events, 0);
      const activeDays = new Set(daily.map((d) => d.day)).size;
      const usedProducts = new Set(daily.map((d) => d.productId)).size;
      setHtml(
        /** @type {HTMLElement} */ ($('[data-stats]', root)),
        html`<dl class="stat-strip stat-strip--spaced">
          <div><dt>Eventos no período</dt><dd class="mono">${formatInteger(totalEvents)}</dd></div>
          <div><dt>Dias com uso</dt><dd class="mono">${formatInteger(activeDays)} de ${days}</dd></div>
          <div><dt>Projetos com uso</dt><dd class="mono">${formatInteger(usedProducts)}</dd></div>
          <div><dt>Evento mais frequente</dt><dd class="mono">${top[0]?.event ?? '—'}</dd></div>
        </dl>`,
      );
      drawChart(dailySeries(daily, days));

      /** @type {Map<string, { events: number, clients: number }>} */
      const byProduct = new Map();
      for (const d of daily) {
        const p = byProduct.get(d.productId) ?? { events: 0, clients: 0 };
        p.events += d.events;
        p.clients = Math.max(p.clients, d.clients);
        byProduct.set(d.productId, p);
      }
      const productRows = [...byProduct.entries()].map(([productId, v]) => ({ productId, ...v, topEvent: top.find((t) => t.productId === productId) }));
      /** @type {HTMLElement} */ ($('[data-products]', root)).replaceChildren(
        dataTable({
          label: 'Uso por produto',
          rows: productRows,
          sort: { key: 'events', dir: 'desc' },
          empty: emptyState({ title: 'Nenhum produto enviou eventos no período', compact: true }),
          columns: [
            { key: 'name', label: 'Projeto', sortValue: (r) => productName(r.productId), render: (r) => html`<a href="#/projects/${r.productId}">${productName(r.productId)}</a>` },
            { key: 'events', label: 'Eventos', align: 'end', sortValue: (r) => r.events, render: (r) => html`<span class="mono">${formatInteger(r.events)}</span>` },
            { key: 'clients', label: 'Usuários/dia (máx.)', align: 'end', hideOnMobile: true, sortValue: (r) => r.clients, render: (r) => html`<span class="mono">${formatInteger(r.clients)}</span>` },
            { key: 'top', label: 'Evento principal', hideOnMobile: true, render: (r) => html`<span class="mono">${r.topEvent?.event ?? '—'}</span>` },
          ],
        }),
      );
      /** @type {HTMLElement} */ ($('[data-top]', root)).replaceChildren(
        dataTable({
          label: 'Eventos mais frequentes',
          rows: top.slice(0, 10),
          sort: { key: 'total', dir: 'desc' },
          empty: emptyState({ title: 'Sem eventos no período', compact: true }),
          columns: [
            { key: 'event', label: 'Evento', sortValue: (t) => t.event, render: (t) => html`<span class="mono">${t.event}</span>` },
            { key: 'product', label: 'Projeto', hideOnMobile: true, sortValue: (t) => productName(t.productId), render: (t) => productName(t.productId) },
            { key: 'total', label: 'Total', align: 'end', sortValue: (t) => t.total, render: (t) => html`<span class="mono">${formatInteger(t.total)}</span>` },
            { key: 'clients', label: 'Usuários', align: 'end', hideOnMobile: true, sortValue: (t) => t.clients, render: (t) => html`<span class="mono">${formatInteger(t.clients)}</span>` },
            { key: 'last', label: 'Último', hideOnMobile: true, sortValue: (t) => t.lastAt, render: (t) => html`<span class="mono" title="${formatDateTime(t.lastAt)}">${formatRelative(t.lastAt)}</span>` },
          ],
        }),
      );
      drawKeys();
    } catch (error) {
      if (!signal.aborted) setHtml(/** @type {HTMLElement} */ ($('[data-chart]', root)), loadError(error));
    }
  };

  /** Mostra a chave uma única vez, com o código pronto e um envio de teste real. @param {{ key: string }} created @param {string} product */
  const showKey = async (created, product) => {
    const { url, anonKey } = getSupabaseConfig();
    const snippet = trackingSnippet({ url: url || 'https://SEU-PROJETO.supabase.co', anonKey: anonKey || 'CHAVE_PUBLICA_DO_SUPABASE', key: created.key });
    let sentTest = false;
    await openDialog({
      title: `Chave de coleta: ${product}`,
      description: 'Copie agora: por segurança ela não aparece de novo. Cole o trecho no produto e chame dumTrack nos pontos que importam (login, venda, erro…).',
      wide: true,
      body: html`<label class="field"><span class="field__label">Chave</span><input class="input mono" value="${created.key}" readonly data-select-all></label>
        <label class="field"><span class="field__label">Trecho para o produto</span><textarea class="input mono code-block" rows="10" readonly data-select-all>${snippet}</textarea></label>
        <p class="field__hint">A chave pública do Supabase no trecho já é pública por natureza; quem protege a coleta é a chave do produto.</p>`,
      submitLabel: 'Enviar evento de teste',
      cancelLabel: 'Fechar',
      onSubmit: async () => {
        await data.analytics.track(created.key, 'teste.conexao', { origem: 'DUMTech Master' }, 'master');
        sentTest = true;
      },
    });
    if (sentTest) toast('Evento de teste recebido. Ele já aparece nos números.', 'success');
    load();
  };

  document.addEventListener('focusin', (event) => {
    const field = /** @type {HTMLInputElement} */ (event.target);
    if (field.matches?.('[data-select-all]')) field.select();
  }, { signal });

  root.addEventListener('click', (event) => {
    const tab = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('[data-days]'));
    if (!tab) return;
    days = Number(tab.dataset.days);
    uiPrefs.set('analytics.days', String(days));
    drawPeriods();
    load();
  }, { signal });

  bindActions(root, {
    'new-key': async () => {
      if (!products.length) return toast('Cadastre um produto antes de criar a chave de coleta.', 'info');
      /** @type {{ key: string } | null} */
      let created = null;
      let product = '';
      await openDialog({
        title: 'Nova chave de coleta',
        body: html`<label class="field"><span class="field__label">Projeto</span>
            <select class="input" name="product" required>${products.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></label>
          <label class="field"><span class="field__label">Nome da chave</span>
            <input class="input" name="label" required maxlength="80" placeholder="Ex.: Produção, App celular" autocomplete="off"></label>`,
        submitLabel: 'Criar chave',
        onSubmit: async (form) => {
          const productId = String(form.get('product'));
          created = await data.analytics.createKey(org.id, productId, String(form.get('label')));
          product = products.find((p) => p.id === productId)?.name ?? '';
        },
      });
      if (created) await showKey(created, product);
    },
    revoke: async (el) => {
      const key = keys.find((k) => k.id === el.dataset.id);
      const ok = await confirmDialog({ title: 'Revogar chave?', message: `O produto que usa “${key.label}” deixa de conseguir enviar eventos.`, confirmLabel: 'Revogar', danger: true });
      if (!ok) return;
      try {
        await data.analytics.revokeKey(org.id, key.id);
        toast('Chave revogada.', 'success');
        load();
      } catch (error) {
        toastError(error);
      }
    },
  }, signal);

  drawPeriods();
  await load();
}
