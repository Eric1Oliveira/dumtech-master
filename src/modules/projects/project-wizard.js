// Novo projeto (#/projects/novo): 4 passos — Cliente, Projeto, O que inclui, Valores.
// Marcar um serviço já define custo (com o rateio) e preço; tudo é criado numa transação.

import { html, setHtml, $, $$, bindActions } from '../../shared/utils/dom.js';
import { formatMoney, formatDate } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { normalizeProduct, PRODUCT_KINDS } from '../../core/catalog.js';
import { normalizeAsset, COST_PERIODS, ASSET_KINDS } from '../../core/infra.js';
import { normalizeTerms } from '../../core/billing.js';
import { serviceCosts } from '../../core/costs.js';
import { suggestKit, proposalLines, marginOf } from '../../core/kit.js';
import { registrableDomain, lookupExpiration } from '../../core/rdap.js';
import { money as parseMoney, today } from '../../core/validate.js';
import { data } from '../../services/data.js';
import { canDo } from '../../services/auth.js';
import { fieldsHtml, readForm } from '../../shared/components/record-form.js';
import { loadError, toast } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';

/** @typedef {import('../../shared/components/record-form.js').Field} Field */

const STEPS = ['Cliente', 'Projeto', 'O que inclui', 'Valores'];
const periods = COST_PERIODS.map((p) => ({ value: p.key, label: p.label }));
const periodShort = (/** @type {string | null} */ p) => (p === 'yearly' ? '/ano' : p === 'once' ? ' único' : '/mês');
const iconOf = (/** @type {string} */ kind) => /** @type {any} */ (ASSET_KINDS.find((k) => k.key === kind)?.icon ?? 'package');

/** Exclusivos do passo 3 (campos com prefixo do grupo: domain.cost…). */
const OWN = /** @type {const} */ ([
  {
    key: 'domain',
    label: 'Domínio próprio',
    glyph: 'globe',
    hint: 'O vencimento é buscado sozinho no registro (.br e .com).',
    fields: /** @type {Field[]} */ ([
      { name: 'name', label: 'Domínio', maxlength: 120, placeholder: 'pizzariabella.com.br' },
      { name: 'renewsAt', label: 'Vence em', type: 'date' },
      { name: 'cost', label: 'Você paga (R$)', type: 'money' },
      { name: 'costPeriod', label: 'Período', type: 'select', options: periods },
      { name: 'price', label: 'Cobra do cliente (R$)', type: 'money' },
      { name: 'pricePeriod', label: 'Período', type: 'select', options: periods },
      { name: 'provider', label: 'Onde está registrado', maxlength: 80, placeholder: 'Registro.br', full: true },
    ]),
  },
  {
    key: 'database',
    label: 'Banco próprio',
    glyph: 'database',
    hint: 'O projeto do Supabase deste cliente. O servidor verifica se ele responde.',
    fields: /** @type {Field[]} */ ([
      { name: 'url', label: 'Endereço do projeto', type: 'url', placeholder: 'https://xxxx.supabase.co', full: true },
      { name: 'cost', label: 'Você paga (R$)', type: 'money', hint: 'Vazio se entra no plano compartilhado' },
      { name: 'costPeriod', label: 'Período', type: 'select', options: periods },
      { name: 'price', label: 'Cobra do cliente (R$)', type: 'money' },
      { name: 'pricePeriod', label: 'Período', type: 'select', options: periods },
    ]),
  },
  {
    key: 'other',
    label: 'Outro serviço só dele',
    glyph: 'package',
    hint: 'E-mail, servidor, plugin pago…',
    fields: /** @type {Field[]} */ ([
      { name: 'name', label: 'Nome', maxlength: 120, placeholder: 'E-mail profissional', full: true },
      { name: 'kind', label: 'Tipo', type: 'select', options: ASSET_KINDS.filter((k) => k.key !== 'domain' && k.key !== 'database').map((k) => ({ value: k.key, label: k.label })) },
      { name: 'provider', label: 'Fornecedor', maxlength: 80 },
      { name: 'cost', label: 'Você paga (R$)', type: 'money' },
      { name: 'costPeriod', label: 'Período', type: 'select', options: periods },
      { name: 'price', label: 'Cobra do cliente (R$)', type: 'money' },
      { name: 'pricePeriod', label: 'Período', type: 'select', options: periods },
    ]),
  },
]);
const prefixed = (/** @type {string} */ group, /** @type {Field[]} */ fields) => fields.map((f) => ({ ...f, name: `${group}.${f.name}` }));
const host = (/** @type {string} */ url) => url.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');

/** @param {import('../index.js').ModuleContext} ctx */
export async function renderProjectWizard({ root, route, signal }) {
  const { org } = getState();
  if (!canDo('products.manage')) {
    location.hash = '#/projects';
    return;
  }
  const infra = canDo('infra.manage');
  const newCustomers = canDo('customers.manage');
  setHtml(root, html`<div class="skeleton"></div>`);
  let customers;
  let assets;
  let links;
  let products;
  let items;
  try {
    [customers, assets, links, products, items] = await Promise.all([
      canDo('customers.view') ? data.customers.list(org.id) : [],
      canDo('infra.view') ? data.assets.list(org.id) : [],
      data.assetLinks.list(org.id).catch(() => []),
      data.products.list(org.id),
      data.saleItems.list(org.id).catch(() => []),
    ]);
  } catch (error) {
    if (!signal.aborted) setHtml(root, loadError(error));
    return;
  }
  if (signal.aborted) return;
  customers.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const shared = assets.filter((a) => a.shared && a.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const catalog = items.filter((i) => i.active).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'));
  const costs = serviceCosts({ assets, links, projects: products });
  const preset = route.params.get('customer');
  const who = preset || customers.length ? 'existing' : newCustomers ? 'new' : 'none';
  let step = 0;
  /** valores digitados à mão no passo 4 (não são mais sugeridos) */
  const edited = new Set();

  const ownFields = OWN.flatMap((g) => [...prefixed(g.key, g.fields), { name: `${g.key}.enabled`, label: '', type: /** @type {const} */ ('checkbox') }]);
  /** @type {Field[]} */
  const projectFields = [
    { name: 'name', label: 'Nome do projeto', required: true, maxlength: 120, full: true, placeholder: 'Ex.: Site da Pizzaria Bella' },
    { name: 'url', label: 'Endereço', type: 'url', placeholder: 'https://pizzariabella.com.br', hint: 'Pode deixar para depois' },
    { name: 'kind', label: 'Tipo', type: 'select', options: PRODUCT_KINDS.map((k) => ({ value: k.key, label: k.label })) },
    { name: 'description', label: 'O que é (opcional)', type: 'textarea' },
  ];
  /** @type {Field[]} */
  const valueFields = [
    { name: 'setup', label: 'Implantação (R$)', type: 'money', hint: 'Valor único' },
    { name: 'monthly', label: 'Mensalidade (R$)', type: 'money' },
    { name: 'billingDay', label: 'Dia de vencimento', maxlength: 2, placeholder: '1 a 28' },
  ];

  setHtml(
    root,
    html`<header class="page-head">
        <div>
          <p class="eyebrow"><a class="back-link" href="#/projects">${icon('arrowLeft')}Projetos</a></p>
          <h1 class="page-title">Novo projeto</h1>
          <p class="page-sub">Quem é o cliente, o que é, o que inclui e quanto custa. Os valores saem do que você marcar.</p>
        </div>
      </header>
      <ol class="stepper" aria-label="Passos">
        ${STEPS.map((label, i) => html`<li class="stepper__item" data-step-label="${i}"><span class="stepper__num">${i + 1}</span><span class="stepper__label">${label}</span></li>`)}
      </ol>
      <form class="panel wizard" id="project-wizard" novalidate>
        <fieldset class="wizard__step" data-step="0">
          <legend class="sr-only">${STEPS[0]}</legend>
          <div class="choice-row" role="radiogroup" aria-label="Cliente">
            ${customers.length ? html`<label class="choice"><input type="radio" name="who" value="existing" ${who === 'existing' ? html`checked` : ''}><span><strong>Cliente que já tenho</strong><small>Escolha na lista</small></span></label>` : ''}
            ${newCustomers ? html`<label class="choice"><input type="radio" name="who" value="new" ${who === 'new' ? html`checked` : ''}><span><strong>Cliente novo</strong><small>Só o nome e o WhatsApp agora</small></span></label>` : ''}
            <label class="choice"><input type="radio" name="who" value="none" ${who === 'none' ? html`checked` : ''}><span><strong>Sistema próprio</strong><small>Sem cliente por enquanto</small></span></label>
          </div>
          <div data-who="existing" ${who === 'existing' ? '' : html`hidden`}>
            ${fieldsHtml([{ name: 'customerId', label: 'Cliente', type: 'select', full: true, options: [{ value: '', label: 'Escolha o cliente' }, ...customers.map((c) => ({ value: c.id, label: c.name }))] }], { customerId: preset ?? '' })}
          </div>
          <div data-who="new" ${who === 'new' ? '' : html`hidden`}>
            ${fieldsHtml([
              { name: 'newName', label: 'Nome do cliente', maxlength: 160, placeholder: 'Pizzaria Bella' },
              { name: 'newPhone', label: 'WhatsApp', type: 'tel', maxlength: 30, placeholder: '(41) 99999-0000' },
              { name: 'newKind', label: 'Tipo', type: 'select', options: [{ value: 'company', label: 'Empresa' }, { value: 'person', label: 'Pessoa física' }] },
            ])}
          </div>
        </fieldset>

        <fieldset class="wizard__step" data-step="1" hidden>
          <legend class="sr-only">${STEPS[1]}</legend>
          ${fieldsHtml(projectFields, { kind: 'site' })}
        </fieldset>

        <fieldset class="wizard__step" data-step="2" hidden>
          <legend class="sr-only">${STEPS[2]}</legend>
          <section class="kit-section">
            <h2 class="subhead">Serviços compartilhados</h2>
            <p class="kit-section__hint">Marque o que este projeto vai usar. A parte do custo já conta com ele entrando.</p>
            ${shared.length
              ? html`<div class="kit-grid">${shared.map(
                  (a) => html`<label class="kit-card">
                    <input type="checkbox" name="shared" value="${a.id}">
                    <span class="kit-card__icon" aria-hidden="true">${icon(iconOf(a.kind))}</span>
                    <span class="kit-card__body"><strong>${a.name}</strong>
                      <small>${a.split === 'company' ? 'custo da empresa' : `parte dele: ${formatMoney(costs.shareOf(a, 1))}/mês`}${a.price ? ` · cobra ${formatMoney(a.price)}${periodShort(a.pricePeriod)}` : ''}</small></span>
                  </label>`,
                )}</div>`
              : html`<p class="notice">Nenhum compartilhado cadastrado ainda.${canDo('infra.manage') ? html` Cadastre GitHub, Supabase, HostGator… em <a href="#/infrastructure">Serviços</a> e eles aparecem aqui.` : ''}</p>`}
          </section>
          <section class="kit-section">
            <h2 class="subhead">Só deste projeto</h2>
            ${infra
              ? OWN.map(
                  (g) => html`<section class="wizard__group" data-group="${g.key}">
                    <label class="wizard__toggle">
                      <input type="checkbox" name="${g.key}.enabled">
                      <span class="wizard__toggle-icon" aria-hidden="true">${icon(g.glyph)}</span>
                      <span class="person"><strong>${g.label}</strong><small>${g.hint}</small></span>
                    </label>
                    <div class="wizard__fields" hidden>${fieldsHtml(prefixed(g.key, g.fields), { [`${g.key}.costPeriod`]: g.key === 'domain' ? 'yearly' : 'monthly', [`${g.key}.pricePeriod`]: g.key === 'domain' ? 'yearly' : 'monthly', 'other.kind': 'service' })}
                      ${g.key === 'domain' ? html`<p class="field__hint" data-rdap aria-live="polite"></p>` : ''}</div>
                  </section>`,
                )
              : html`<p class="notice notice--warn">Seu papel não cadastra serviços. Quem administra pode incluir domínio e banco depois.</p>`}
          </section>
          <section class="kit-section">
            <h2 class="subhead">Da tabela de preços</h2>
            ${catalog.length
              ? html`<div class="kit-grid">${catalog.map(
                  (i) => html`<label class="kit-card">
                    <input type="checkbox" name="item" value="${i.id}">
                    <span class="kit-card__icon" aria-hidden="true">${icon(i.recurring ? 'refresh' : 'zap')}</span>
                    <span class="kit-card__body"><strong>${i.name}</strong><small>${formatMoney(i.price)}${i.recurring ? '/mês' : ' único'}</small></span>
                  </label>`,
                )}</div>`
              : html`<p class="notice">Monte sua tabela (criação do site, manutenção, logo…) em <a href="#/settings/prices">Ajustes › Tabela de preços</a>.</p>`}
          </section>
        </fieldset>

        <fieldset class="wizard__step" data-step="3" hidden>
          <legend class="sr-only">${STEPS[3]}</legend>
          <div data-lines></div>
          ${fieldsHtml(valueFields, { billingDay: String(Math.min(Number(today().slice(8, 10)), 28)) })}
          <h2 class="subhead">Como começa</h2>
          <div class="choice-row" role="radiogroup" aria-label="Como começa">
            <label class="choice" data-needs-customer><input type="radio" name="finish" value="proposal"><span><strong>Proposta</strong><small>Gera o documento para enviar</small></span></label>
            <label class="choice"><input type="radio" name="finish" value="closed"><span><strong>Já fechado</strong><small>Começa a construção com o checklist</small></span></label>
            <label class="choice"><input type="radio" name="finish" value="live"><span><strong>Já publicado</strong><small>Site no ar; cobra a partir da data</small></span></label>
          </div>
          <div data-since hidden>${fieldsHtml([{ name: 'since', label: 'Cobrando desde', type: 'date' }], { since: today() })}</div>
        </fieldset>

        <div class="kit-total" data-total hidden></div>
        <p class="form-error" role="alert" hidden data-error></p>
        <footer class="wizard__foot">
          <button type="button" class="btn btn--ghost" data-action="back">${icon('arrowLeft')}<span>Voltar</span></button>
          <button type="button" class="btn btn--primary" data-action="next"><span>Avançar</span>${icon('arrowRight')}</button>
          <button type="submit" class="btn btn--primary" data-submit>${icon('check')}<span>Criar projeto</span></button>
        </footer>
      </form>`,
  );

  const form = /** @type {HTMLFormElement} */ ($('#project-wizard', root));
  const errorBox = /** @type {HTMLElement} */ ($('[data-error]', root));
  const allFields = [
    { name: 'customerId', label: '', type: /** @type {const} */ ('select') },
    { name: 'newName', label: '' },
    { name: 'newPhone', label: '' },
    { name: 'newKind', label: '' },
    ...projectFields,
    ...ownFields,
    ...valueFields,
    { name: 'since', label: '', type: /** @type {const} */ ('date') },
  ];
  const fd = () => new FormData(form);
  const values = () => readForm(fd(), allFields);
  const group = (/** @type {string} */ key) => Object.fromEntries(Object.entries(values()).filter(([k]) => k.startsWith(`${key}.`)).map(([k, v]) => [k.slice(key.length + 1), v]));
  const input = (/** @type {string} */ name) => /** @type {HTMLInputElement | null} */ (form.elements.namedItem(name));
  const setIfEmpty = (/** @type {string} */ name, /** @type {string} */ value) => {
    const el = input(name);
    if (el && !el.value) el.value = value;
  };
  const whoValue = () => String(fd().get('who') ?? 'none');
  const customerName = () => {
    const w = whoValue();
    if (w === 'existing') return customers.find((c) => c.id === values().customerId)?.name ?? '';
    if (w === 'new') return String(values().newName ?? '').trim();
    return '';
  };

  /** Exclusivos marcados, validados com as regras de Serviços. */
  const ownInputs = () => {
    if (!infra) return [];
    const projectName = String(values().name ?? '').trim();
    return OWN.filter((g) => group(g.key).enabled).map((g) => {
      const v = group(g.key);
      const name = g.key === 'domain' ? v.name || registrableDomain(values().url) || '' : g.key === 'database' ? `Banco · ${projectName}` : v.name;
      const kind = g.key === 'other' ? v.kind : g.key;
      return normalizeAsset({ ...v, name, kind, shared: false, status: 'active', renewsAuto: g.key === 'domain' && form.dataset.rdap === 'auto' });
    });
  };

  /** Kit atual: marcados + sugestão de valores. */
  const kit = () => {
    const form_ = fd();
    const sharedIds = new Set(form_.getAll('shared').map(String));
    const itemIds = new Set(form_.getAll('item').map(String));
    let own = [];
    try {
      own = ownInputs();
    } catch {
      own = [];
    }
    return {
      sharedIds: [...sharedIds],
      own,
      ...suggestKit({
        shared: shared.filter((a) => sharedIds.has(a.id)),
        exclusive: own.map((a) => ({ ...a, name: a.kind === 'domain' ? `Domínio ${a.name}` : a.kind === 'database' ? 'Banco de dados' : a.name })),
        items: catalog.filter((i) => itemIds.has(i.id)),
        shareOf: costs.shareOf,
      }),
    };
  };

  const chosenValues = () => {
    const v = values();
    const k = kit();
    const monthly = parseMoney(v.monthly, 'Mensalidade') ?? 0;
    const setup = parseMoney(v.setup, 'Implantação') ?? 0;
    return { k, monthly, setup };
  };

  const drawTotal = () => {
    const box = /** @type {HTMLElement} */ ($('[data-total]', root));
    box.hidden = step < 2;
    if (step < 2) return;
    let monthly = 0;
    let setup = 0;
    let cost = 0;
    try {
      const c = chosenValues();
      monthly = step === 3 ? c.monthly : c.k.monthly;
      setup = step === 3 ? c.setup : c.k.setup;
      cost = c.k.cost;
    } catch {
      /* valor inválido no campo: mostra o que der */
    }
    const { profit, margin } = marginOf(monthly, cost);
    setHtml(
      box,
      html`<dl class="kit-total__grid">
        <div><dt>Mensalidade</dt><dd class="mono">${formatMoney(monthly)}</dd></div>
        <div><dt>Implantação</dt><dd class="mono">${formatMoney(setup)}</dd></div>
        <div><dt>Custo/mês</dt><dd class="mono">${formatMoney(cost)}</dd></div>
        <div><dt>Lucro/mês</dt><dd class="mono ${profit < 0 ? 'is-overdue' : ''}">${formatMoney(profit)}${margin !== null ? html` <small>(${margin}%)</small>` : ''}</dd></div>
      </dl>`,
    );
  };

  /** Passo 4: sugere os valores (se não foram mudados à mão) e mostra as linhas. */
  const fillValues = () => {
    const k = kit();
    const money2 = (/** @type {number} */ n) => (n ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
    const monthlyEl = input('monthly');
    const setupEl = input('setup');
    if (monthlyEl && !edited.has('monthly')) monthlyEl.value = money2(k.monthly);
    if (setupEl && !edited.has('setup')) setupEl.value = money2(k.setup);
    setHtml(
      /** @type {HTMLElement} */ ($('[data-lines]', root)),
      k.lines.length
        ? html`<h2 class="subhead">O que você marcou</h2>
          <ul class="kit-lines">${k.lines.map((l) => html`<li><span>${l.description}</span><span class="mono">${formatMoney(l.unitPrice)}${l.recurring ? '/mês' : ''}</span></li>`)}</ul>`
        : html`<p class="notice">Nada com preço foi marcado. Digite a implantação e a mensalidade combinadas.</p>`,
    );
    const proposal = /** @type {HTMLElement} */ ($('[data-needs-customer]', root));
    const radio = /** @type {HTMLInputElement} */ (proposal.querySelector('input'));
    radio.disabled = whoValue() === 'none';
    proposal.classList.toggle('is-disabled', radio.disabled);
    if (!fd().get('finish')) /** @type {HTMLInputElement} */ ($(`input[name="finish"][value="${radio.disabled ? 'closed' : 'proposal'}"]`, root)).checked = true;
    syncFinish();
  };

  const syncFinish = () => {
    /** @type {HTMLElement} */ ($('[data-since]', root)).hidden = fd().get('finish') !== 'live';
    const label = { proposal: 'Criar e montar a proposta', closed: 'Criar e começar a construção', live: 'Criar projeto publicado' }[String(fd().get('finish') ?? 'closed')];
    setHtml(/** @type {HTMLElement} */ ($('[data-submit]', root)), html`${icon('check')}<span>${label ?? 'Criar projeto'}</span>`);
  };

  const show = () => {
    for (const fs of $$('[data-step]', root)) /** @type {HTMLElement} */ (fs).hidden = Number(/** @type {HTMLElement} */ (fs).dataset.step) !== step;
    for (const li of $$('[data-step-label]', root)) {
      const i = Number(/** @type {HTMLElement} */ (li).dataset.stepLabel);
      li.classList.toggle('is-current', i === step);
      li.classList.toggle('is-done', i < step);
      if (i === step) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    }
    /** @type {HTMLElement} */ ($('[data-action="back"]', root)).hidden = step === 0;
    /** @type {HTMLElement} */ ($('[data-action="next"]', root)).hidden = step === STEPS.length - 1;
    /** @type {HTMLElement} */ ($('[data-submit]', root)).hidden = step !== STEPS.length - 1;
    errorBox.hidden = true;
    if (step === 3) fillValues();
    drawTotal();
    /** @type {HTMLElement | null} */ ($(`[data-step="${step}"] input:not([type=radio]):not([type=checkbox]), [data-step="${step}"] select`, root))?.focus();
  };

  const fail = (/** @type {unknown} */ error) => {
    errorBox.textContent = error instanceof Error ? error.message : String(error);
    errorBox.hidden = false;
  };

  /** Valida o passo antes de avançar. */
  const check = () => {
    const v = values();
    if (step === 0) {
      const w = whoValue();
      if (w === 'existing' && !v.customerId) throw new Error('Escolha o cliente.');
      if (w === 'new' && String(v.newName ?? '').trim().length < 2) throw new Error('Digite o nome do cliente.');
    }
    if (step === 1) normalizeProduct({ name: v.name, url: v.url, kind: v.kind, description: v.description });
    if (step === 2) ownInputs();
  };

  /** Vencimento do domínio direto do registro público. */
  const lookupDomain = async () => {
    const hint = $('[data-rdap]', root);
    const domain = registrableDomain(input('domain.name')?.value || values().url);
    if (!hint || !domain) return;
    setHtml(hint, html`Buscando o vencimento de ${domain}…`);
    const expires = await lookupExpiration(domain);
    if (signal.aborted) return;
    if (expires) {
      const el = input('domain.renewsAt');
      if (el) el.value = expires;
      form.dataset.rdap = 'auto';
      setHtml(hint, html`${icon('check')} Vence em ${formatDate(expires)} (do registro de ${domain}). Atualiza sozinho.`);
    } else {
      form.dataset.rdap = '';
      setHtml(hint, html`Não achei a data de ${domain} no registro. Digite o vencimento.`);
    }
  };

  // getAttribute: num <form>, form.name devolveria o campo chamado "name", não um texto.
  const nameOf = (/** @type {EventTarget | null} */ target) => (target instanceof Element ? target.getAttribute('name') ?? '' : '');
  form.addEventListener('change', (event) => {
    const el = /** @type {HTMLInputElement} */ (event.target);
    const name = nameOf(el);
    if (name === 'who') {
      for (const box of $$('[data-who]', root)) /** @type {HTMLElement} */ (box).hidden = /** @type {HTMLElement} */ (box).dataset.who !== el.value;
    }
    if (name.endsWith('.enabled')) {
      /** @type {HTMLElement} */ (el.closest('.wizard__group')?.querySelector('.wizard__fields')).hidden = !el.checked;
      if (name === 'domain.enabled' && el.checked) {
        setIfEmpty('domain.name', registrableDomain(values().url) ?? '');
        lookupDomain();
      }
    }
    if (name === 'domain.name') lookupDomain();
    if (name === 'domain.renewsAt') form.dataset.rdap = '';
    if (name === 'finish') syncFinish();
    drawTotal();
  }, { signal });
  form.addEventListener('input', (event) => {
    const name = nameOf(event.target);
    if (name === 'monthly' || name === 'setup') edited.add(name);
    if (step >= 2) drawTotal();
  }, { signal });

  bindActions(root, {
    back: () => {
      step = Math.max(0, step - 1);
      show();
    },
    next: () => {
      try {
        check();
      } catch (error) {
        return fail(error);
      }
      if (step === 0) {
        const name = customerName();
        if (name) setIfEmpty('name', `Site ${name}`);
      }
      if (step === 1) {
        const url = String(values().url ?? '');
        if (url) setIfEmpty('domain.name', registrableDomain(url) ?? host(url));
      }
      step += 1;
      show();
    },
  }, signal);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = /** @type {HTMLButtonElement} */ ($('[data-submit]', root));
    try {
      const v = values();
      const { k, monthly, setup } = chosenValues();
      const finish = /** @type {'proposal' | 'closed' | 'live'} */ (String(fd().get('finish') ?? 'closed'));
      const terms = normalizeTerms({ monthlyAmount: v.monthly, billingDay: v.billingDay });
      const lines = proposalLines(k.lines, { monthly, setup });
      if (finish === 'proposal' && !lines.length) throw new Error('Para a proposta, marque algo com preço ou digite a implantação/mensalidade.');
      const w = whoValue();
      submit.disabled = true;
      const id = await data.products.create(org.id, {
        finish,
        since: String(v.since || today()),
        customer: w === 'existing' ? { id: String(v.customerId) } : w === 'new' ? { new: { name: String(v.newName).trim(), phone: String(v.newPhone ?? ''), kind: String(v.newKind ?? 'company') } } : null,
        project: { name: String(v.name).trim(), url: String(v.url ?? '') || null, kind: String(v.kind ?? 'site'), description: String(v.description ?? '') },
        shared: k.sharedIds,
        exclusive: k.own,
        values: { monthly: terms.monthlyAmount, setup: setup || null, billingDay: terms.billingDay },
        lines,
      });
      toast(finish === 'proposal' ? 'Projeto criado com a proposta.' : finish === 'live' ? 'Projeto publicado cadastrado.' : 'Projeto criado. Boa construção!', 'success');
      location.hash = `#/projects/${id}`;
    } catch (error) {
      submit.disabled = false;
      fail(error);
    }
  }, { signal });

  show();
}
