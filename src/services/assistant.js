// DUM AI — respostas do assistente. Lê pela mesma camada de dados das telas: no Supabase,
// a RLS do banco decide o que cada pessoa enxerga; aqui ainda conferimos o papel para
// explicar quando a área não é permitida. Nada sai do sistema (sem IA externa).

import { data } from './data.js';
import { canDo } from './auth.js';
import { getState } from '../core/state.js';
import { parseQuestion, nameMatches, EXAMPLES } from '../core/assistant.js';
import { statusLabel as customerStatus, formatDocument, CUSTOMER_KINDS } from '../core/customers.js';
import { PROPOSAL_STATUS, proposalNumber } from '../core/proposals.js';
import { isOverdue } from '../core/projects.js';
import { PRODUCT_STATUS } from '../core/catalog.js';
import { ASSET_KINDS, monthlyCost, daysUntil } from '../core/infra.js';
import { AUTOMATIONS } from '../core/automations.js';
import { ROLES, roleName } from '../core/permissions.js';
import { labelOf, today } from '../core/validate.js';
import { formatMoney, formatDate, formatRelative, normalize, formatInteger } from '../shared/utils/format.js';
import { describeAudit } from '../shared/utils/audit-text.js';
import { errorMessage } from '../shared/components/feedback.js';

/**
 * @typedef {Object} ReplyItem
 * @property {string} label
 * @property {string} [sub]
 * @property {string} [href]
 * @property {'ok' | 'warn' | 'danger' | 'info'} [tone]
 */

/**
 * @typedef {Object} Reply
 * @property {string} text
 * @property {ReplyItem[]} [items]
 * @property {string[]} [suggestions]
 */

/** @typedef {import('../core/assistant.js').ParsedQuestion} Q */

const MAX = 8;
const orgId = () => getState().org?.id ?? '';
const orgName = () => getState().org?.name ?? 'a organização';
const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) => `${n} ${n === 1 ? one : many}`;
const more = (/** @type {number} */ n) => (n > MAX ? ` Mostrando ${MAX} de ${n}.` : '');
/** @param {string} area @returns {Reply} */
const denied = (area) => ({ text: `Seu papel em ${orgName()} não inclui ${area}. Quem administra a organização pode mudar isso.` });

/**
 * Responde uma pergunta em português sobre os dados do sistema.
 * @param {string} question
 * @returns {Promise<Reply>}
 */
export async function answer(question) {
  const q = parseQuestion(question);
  try {
    switch (q.intent) {
      case 'help':
        return help();
      case 'summary':
        return await summary();
      case 'customers':
        return await customers(q);
      case 'proposals':
        return await proposals(q);
      case 'projects':
        return await projects(q);
      case 'tasks':
        return await tasks(q);
      case 'products':
        return await products(q);
      case 'infra':
        return await infra(q);
      case 'members':
        return await members(q);
      case 'activity':
        return await activity(q);
      case 'notifications':
        return await notifications();
      case 'automations':
        return await automations();
      case 'documents':
        return await documents(q);
      case 'analytics':
        return await analytics();
      case 'finance':
        return await finance();
      case 'vault':
        return {
          text: 'Eu não leio o cofre: senhas e chaves só aparecem no DUM Vault, depois da frase-mestra, e cada abertura fica registrada na auditoria.',
          items: [{ label: 'Abrir o DUM Vault', href: '#/vault' }],
        };
      default:
        return (await extraIntent(q)) ?? (await search(q, question));
    }
  } catch (error) {
    return { text: `Não consegui consultar agora: ${errorMessage(error)}` };
  }
}

/** Assuntos dos módulos que respondem por conta própria (Workspace, Analytics, Financeiro). */
/** @type {Record<string, (q: Q) => Promise<Reply>>} */
export const EXTRA_INTENTS = {};
/** @param {Q} q */
const extraIntent = async (q) => (EXTRA_INTENTS[q.intent] ? EXTRA_INTENTS[q.intent](q) : null);

/** @returns {Reply} */
function help() {
  return {
    text: 'Sou o DUM AI, o assistente do Master. Funciono por regras, aqui mesmo: respondo com os dados que o seu papel pode ver, sem IA paga e sem mandar nada para fora. Pergunte do jeito que falaria — por exemplo:',
    suggestions: EXAMPLES,
  };
}

/** @returns {Promise<Reply>} */
async function summary() {
  const id = orgId();
  const todayKey = today();
  /** @type {ReplyItem[]} */
  const items = [];
  if (canDo('customers.view')) {
    const list = await data.customers.list(id);
    const active = list.filter((c) => c.status === 'active').length;
    const leads = list.filter((c) => c.status === 'lead').length;
    items.push({ label: `Clientes: ${active} ativo${active === 1 ? '' : 's'} · ${plural(leads, 'lead', 'leads')}`, sub: `${plural(list.length, 'cliente', 'clientes')} na carteira`, href: '#/customers' });
  }
  if (canDo('proposals.view')) {
    const open = (await data.proposals.list(id)).filter((p) => p.status === 'draft' || p.status === 'sent');
    const once = open.reduce((s, p) => s + p.totalOnce, 0);
    const monthly = open.reduce((s, p) => s + p.totalMonthly, 0);
    items.push({ label: `Propostas em aberto: ${open.length}`, sub: open.length ? `${formatMoney(once)} único + ${formatMoney(monthly)}/mês em negociação` : 'nenhuma em negociação', href: '#/proposals' });
  }
  if (canDo('products.view')) {
    const [projectList, taskList] = await Promise.all([data.products.list(id), canDo('projects.view') ? data.tasks.list(id) : []]);
    const open = taskList.filter((t) => t.status !== 'done');
    const late = open.filter((t) => isOverdue(t, todayKey)).length;
    const live = projectList.filter((p) => p.status === 'live').length;
    const building = projectList.filter((p) => p.status === 'building').length;
    items.push({ label: `Projetos: ${live} publicado${live === 1 ? '' : 's'}, ${building} em construção`, sub: `${plural(open.length, 'tarefa aberta', 'tarefas abertas')}${late ? `, ${late} atrasada${late > 1 ? 's' : ''}` : ''}`, href: '#/projects', tone: late ? 'warn' : undefined });
  }
  if (canDo('infra.view')) {
    const assets = (await data.assets.list(id)).filter((a) => a.status === 'active');
    const due = assets.filter((a) => (daysUntil(a.renewsAt, todayKey) ?? 99) <= 30).length;
    const down = (await data.monitors.list(id).catch(() => [])).filter((m) => m.enabled && m.state === 'down').length;
    items.push({
      label: `Serviços: ${formatMoney(assets.reduce((s, a) => s + monthlyCost(a), 0))}/mês`,
      sub: `${plural(due, 'serviço vencendo', 'serviços vencendo')} em 30 dias${down ? ` · ${down} fora do ar` : ''}`,
      href: '#/infrastructure',
      tone: down ? 'danger' : due ? 'warn' : undefined,
    });
  }
  const unread = (await data.notifications.list()).filter((n) => !n.readAt).length;
  if (unread) items.push({ label: `${plural(unread, 'aviso não lido', 'avisos não lidos')}`, sub: 'no sino, no topo da tela' });
  return {
    text: items.length ? `Resumo de ${orgName()} agora:` : 'Seu papel ainda não inclui as áreas do resumo.',
    items,
    suggestions: ['Tarefas atrasadas', 'Propostas abertas', 'O que vence este mês?'],
  };
}

/** @param {Q} q */
/** @returns {Promise<Reply>} */
async function customers(q) {
  if (!canDo('customers.view')) return denied('os clientes');
  const list = await data.customers.list(orgId());
  if (!list.length) return { text: 'Nenhum cliente cadastrado ainda.', items: [{ label: 'Cadastrar o primeiro cliente', href: '#/customers' }] };
  const digits = q.terms.replace(/\D/g, '');
  const found = q.terms ? list.filter((c) => nameMatches(c.name, q.terms, q.text) || (digits.length >= 4 && (c.document ?? '').includes(digits))) : [];
  if (found.length === 1) return customerDetail(found[0]);

  const status = q.flags.has('lead') ? 'lead' : q.flags.has('inactive') ? 'inactive' : q.flags.has('active') ? 'active' : null;
  const rows = (found.length ? found : status ? list.filter((c) => c.status === status) : list).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const count = (/** @type {string} */ s) => list.filter((c) => c.status === s).length;
  const text = found.length
    ? `Encontrei ${found.length} clientes com “${q.terms}”:`
    : status
      ? `${plural(rows.length, 'cliente', 'clientes')} com situação ${customerStatus(status).toLowerCase()}.${more(rows.length)}`
      : `${orgName()} tem ${plural(list.length, 'cliente', 'clientes')}: ${count('active')} ativos, ${count('lead')} leads e ${count('inactive')} inativos.${more(rows.length)}`;
  return {
    text,
    items: rows.slice(0, MAX).map((c) => ({ label: c.name, sub: [customerStatus(c.status), c.city, c.ownerName].filter(Boolean).join(' · '), href: '#/customers' })),
    suggestions: ['Clientes ativos', 'Leads', 'Propostas abertas'],
  };
}

/** @param {import('./data.js').Customer} c */
/** @returns {Promise<Reply>} */
async function customerDetail(c) {
  const id = orgId();
  /** @type {ReplyItem[]} */
  const items = [];
  if (canDo('products.view')) {
    for (const l of await data.customerProducts.list(id, { customerId: c.id })) {
      if (l.status !== 'cancelled') items.push({ label: `Projeto: ${l.productName}`, sub: l.status === 'pending' ? 'combinado, ainda não cobra' : `paga desde ${formatDate(l.since)}`, href: `#/projects/${l.productId}` });
    }
  }
  if (canDo('proposals.view')) {
    for (const p of (await data.proposals.list(id)).filter((x) => x.customerId === c.id).slice(0, 4)) {
      items.push({ label: `${proposalNumber(p.number)} · ${p.title}`, sub: `${labelOf(PROPOSAL_STATUS, p.status)} · ${proposalValue(p)}`, href: `#/proposals/${p.id}` });
    }
  }
  const kind = labelOf(CUSTOMER_KINDS, c.kind);
  const contact = [c.email, c.phone].filter(Boolean).join(' · ');
  return {
    text: `${c.name} — ${kind}${c.document ? ` (${formatDocument(c.document)})` : ''}, situação ${customerStatus(c.status).toLowerCase()}${c.city ? `, em ${c.city}` : ''}.` +
      `${contact ? ` Contato: ${contact}.` : ''}${c.ownerName ? ` Responsável: ${c.ownerName}.` : ''}${items.length ? '' : ' Ainda sem propostas, projetos ou produtos ligados.'}`,
    items: [...items, { label: 'Abrir a carteira de clientes', href: '#/customers' }],
  };
}

/** @param {import('./data.js').Proposal} p */
const proposalValue = (p) => [p.totalOnce ? formatMoney(p.totalOnce) : '', p.totalMonthly ? `${formatMoney(p.totalMonthly)}/mês` : ''].filter(Boolean).join(' + ') || 'sem valor';

/** @param {Q} q */
/** @returns {Promise<Reply>} */
async function proposals(q) {
  if (!canDo('proposals.view')) return denied('as propostas');
  const list = await data.proposals.list(orgId());
  if (!list.length) return { text: 'Nenhuma proposta ainda.', items: [{ label: 'Montar a primeira proposta', href: '#/proposals/new' }] };
  const number = q.text.match(/\bp-?0*(\d{1,6})\b/) ?? q.text.match(/\bproposta (?:n(?:umero)? )?0*(\d{1,6})\b/);
  const byNumber = number ? list.find((p) => p.number === Number(number[1])) : null;
  if (byNumber) return proposalDetail(byNumber);
  const byTitle = q.terms ? list.filter((p) => nameMatches(p.title, q.terms, q.text)) : [];
  if (byTitle.length === 1) return proposalDetail(byTitle[0]);
  const byCustomer = q.terms ? list.filter((p) => nameMatches(p.customerName, q.terms, q.text)) : [];

  /** @type {string[]} */
  let statuses = [];
  if (q.flags.has('open')) statuses = ['draft', 'sent'];
  for (const s of /** @type {const} */ (['draft', 'sent', 'accepted', 'rejected'])) if (q.flags.has(s)) statuses.push(s);
  let rows = byTitle.length ? byTitle : byCustomer.length ? byCustomer : list;
  if (statuses.length) rows = rows.filter((p) => statuses.includes(p.status));
  const once = rows.reduce((s, p) => s + p.totalOnce, 0);
  const monthly = rows.reduce((s, p) => s + p.totalMonthly, 0);
  const scope = byCustomer.length && !byTitle.length ? ` de ${byCustomer[0].customerName}` : '';
  const what = statuses.length ? ` (${statuses.map((s) => labelOf(PROPOSAL_STATUS, s).toLowerCase()).join(' ou ')})` : '';
  return {
    text: rows.length
      ? `${plural(rows.length, 'proposta', 'propostas')}${scope}${what}: ${formatMoney(once)} único e ${formatMoney(monthly)}/mês no total.${more(rows.length)}`
      : `Nenhuma proposta${scope}${what}.`,
    items: rows.slice(0, MAX).map((p) => ({
      label: `${proposalNumber(p.number)} · ${p.title}`,
      sub: `${p.customerName} · ${labelOf(PROPOSAL_STATUS, p.status)} · ${proposalValue(p)}`,
      href: `#/proposals/${p.id}`,
      tone: p.status === 'sent' && p.validUntil && p.validUntil < today() ? 'warn' : undefined,
    })),
    suggestions: ['Propostas enviadas', 'Propostas aceitas', 'Resumo da empresa'],
  };
}

/** @param {import('./data.js').Proposal} p */
/** @returns {Promise<Reply>} */
async function proposalDetail(p) {
  const items = await data.proposals.items(orgId(), p.id);
  return {
    text: `${proposalNumber(p.number)} · ${p.title}, para ${p.customerName}: ${labelOf(PROPOSAL_STATUS, p.status).toLowerCase()}, ${proposalValue(p)}.` +
      `${p.validUntil ? ` Válida até ${formatDate(p.validUntil)}.` : ''}${p.productId && p.status === 'accepted' ? ' Aceita: o projeto está em andamento.' : ''}`,
    items: [
      ...items.slice(0, MAX).map((i) => ({ label: i.description, sub: `${String(i.quantity).replace('.', ',')} × ${formatMoney(i.unitPrice)}${i.recurring ? '/mês' : ''}` })),
      { label: 'Abrir a proposta', href: `#/proposals/${p.id}` },
      ...(p.productId ? [{ label: 'Abrir o projeto', href: `#/projects/${p.productId}` }] : []),
    ],
  };
}

/** @param {Q} q */
/** @returns {Promise<Reply>} */
async function projects(q) {
  if (!canDo('products.view')) return denied('os projetos');
  const [list, taskList, subs] = await Promise.all([data.products.list(orgId()), canDo('projects.view') ? data.tasks.list(orgId()) : [], data.customerProducts.list(orgId())]);
  if (!list.length) return { text: 'Nenhum projeto ainda. Use “Novo projeto” para começar.', items: [{ label: 'Novo projeto', href: '#/projects/novo' }] };
  const todayKey = today();
  const customerOf = (/** @type {string} */ id) => subs.filter((x) => x.productId === id && x.status !== 'cancelled').map((x) => x.customerName).join(', ');
  const byName = q.terms ? list.filter((p) => nameMatches(p.name, q.terms, q.text)) : [];
  if (byName.length === 1) {
    const p = byName[0];
    const open = taskList.filter((t) => t.productId === p.id && t.status !== 'done');
    const late = open.filter((t) => isOverdue(t, todayKey));
    const who = customerOf(p.id);
    return {
      text: `${p.name}${who ? ` (${who})` : ''}: ${labelOf(PRODUCT_STATUS, p.status).toLowerCase()}${p.dueDate ? `, prazo ${formatDate(p.dueDate)}` : ''}${p.ownerName ? `, responsável ${p.ownerName}` : ''}. ` +
        `${plural(open.length, 'tarefa aberta', 'tarefas abertas')}${late.length ? `, ${late.length} atrasada${late.length > 1 ? 's' : ''}` : ''}.`,
      items: [...open.slice(0, MAX).map((t) => taskItem(t, todayKey)), { label: 'Abrir o projeto', href: `#/projects/${p.id}` }],
    };
  }
  const byCustomer = q.terms ? list.filter((p) => nameMatches(customerOf(p.id), q.terms, q.text)) : [];
  const status = q.flags.has('done') ? 'live' : q.flags.has('active') || q.flags.has('open') ? 'building' : null;
  let rows = byName.length ? byName : byCustomer.length ? byCustomer : list;
  if (status) rows = rows.filter((p) => p.status === status);
  return {
    text: rows.length
      ? `${plural(rows.length, 'projeto', 'projetos')}${status ? ` ${labelOf(PRODUCT_STATUS, status).toLowerCase()}` : ''}${byCustomer.length && !byName.length ? ` de ${customerOf(byCustomer[0].id)}` : ''}.${more(rows.length)}`
      : 'Nenhum projeto com esse filtro.',
    items: rows.slice(0, MAX).map((p) => {
      const late = taskList.filter((t) => t.productId === p.id && isOverdue(t, todayKey)).length;
      return {
        label: p.name,
        sub: [labelOf(PRODUCT_STATUS, p.status), customerOf(p.id), p.dueDate ? `prazo ${formatDate(p.dueDate)}` : '', late ? `${late} tarefa(s) atrasada(s)` : ''].filter(Boolean).join(' · '),
        href: `#/projects/${p.id}`,
        tone: late ? 'warn' : undefined,
      };
    }),
    suggestions: ['Tarefas atrasadas', 'Minhas tarefas'],
  };
}

/** @param {import('./data.js').Task} t @param {string} todayKey @returns {ReplyItem} */
const taskItem = (t, todayKey) => ({
  label: t.title,
  sub: [t.projectName, t.assigneeName || 'sem responsável', t.dueDate ? `prazo ${formatDate(t.dueDate)}` : 'sem prazo'].join(' · '),
  href: `#/projects/${t.productId}`,
  tone: isOverdue(t, todayKey) ? 'danger' : undefined,
});

/** @param {Q} q */
/** @returns {Promise<Reply>} */
async function tasks(q) {
  if (!canDo('projects.view')) return denied('os projetos e tarefas');
  const todayKey = today();
  const all = await data.tasks.list(orgId());
  const me = getState().user?.id;
  let rows = all.filter((t) => (q.flags.has('done') ? t.status === 'done' : t.status !== 'done'));
  /** @type {string[]} */
  const filters = [];
  if (q.flags.has('mine')) {
    rows = rows.filter((t) => t.assigneeId === me);
    filters.push('suas');
  }
  if (q.flags.has('late')) {
    rows = rows.filter((t) => isOverdue(t, todayKey));
    filters.push('atrasadas');
  } else if (q.flags.has('today')) {
    rows = rows.filter((t) => t.dueDate && t.dueDate <= todayKey);
    filters.push('para hoje (e atrasadas)');
  } else if (q.flags.has('week')) {
    const limit = new Date(Date.parse(`${todayKey}T00:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10);
    rows = rows.filter((t) => t.dueDate && t.dueDate <= limit);
    filters.push('dos próximos 7 dias');
  }
  if (q.terms) {
    const byPerson = rows.filter((t) => nameMatches(t.assigneeName, q.terms, q.text));
    const byProject = rows.filter((t) => nameMatches(t.projectName, q.terms, q.text));
    if (byPerson.length) {
      rows = byPerson;
      filters.push(`de ${byPerson[0].assigneeName}`);
    } else if (byProject.length) {
      rows = byProject;
      filters.push(`do projeto ${byProject[0].projectName}`);
    }
  }
  rows.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const late = rows.filter((t) => isOverdue(t, todayKey)).length;
  const kind = q.flags.has('done') ? 'concluída' : 'aberta';
  return {
    text: rows.length
      ? `${plural(rows.length, `tarefa ${kind}`, `tarefas ${kind}s`)}${filters.length ? ` (${filters.join(', ')})` : ''}${late && !q.flags.has('late') ? `, ${late} atrasada${late > 1 ? 's' : ''}` : ''}.${more(rows.length)}`
      : `Nenhuma tarefa ${kind}${filters.length ? ` (${filters.join(', ')})` : ''}. ${q.flags.has('late') ? 'Tudo em dia.' : ''}`.trim(),
    items: rows.slice(0, MAX).map((t) => taskItem(t, todayKey)),
    suggestions: q.flags.has('mine') ? ['Tarefas atrasadas', 'Tarefas da semana'] : ['Minhas tarefas', 'Tarefas atrasadas'],
  };
}

/** @param {Q} q */
/** @returns {Promise<Reply>} */
async function products(q) {
  return projects(q);
}

/** @param {Q} q */
/** @returns {Promise<Reply>} */
async function infra(q) {
  if (!canDo('infra.view')) return denied('a infraestrutura');
  const todayKey = today();
  const [list, monitors] = await Promise.all([
    data.assets.list(orgId()).then((l) => l.filter((a) => a.status === 'active')),
    data.monitors.list(orgId()).catch(() => []),
  ]);
  if (!list.length) return { text: 'Nenhum serviço cadastrado ainda.', items: [{ label: 'Abrir Serviços', href: '#/infrastructure' }] };
  const monOf = (/** @type {import('./data.js').Asset} */ a) => monitors.find((m) => m.assetId === a.id && m.enabled);
  const asItem = (/** @type {import('./data.js').Asset} */ a) => {
    const days = daysUntil(a.renewsAt, todayKey);
    return {
      label: a.name,
      sub: [labelOf(ASSET_KINDS, a.kind), a.renewsAt ? `vence ${formatDate(a.renewsAt)}${days !== null && days <= 30 ? ` (${days < 0 ? 'vencido' : `em ${days} dia${days === 1 ? '' : 's'}`})` : ''}` : '', monOf(a) ? ({ down: 'FORA DO AR', up: 'no ar', slow: 'lento', unstable: 'instável' }[monOf(a)?.state ?? ''] ?? 'aguardando verificação') : '']
        .filter(Boolean).join(' · '),
      href: '#/infrastructure',
      tone: /** @type {ReplyItem['tone']} */ (monOf(a)?.state === 'down' || (days !== null && days < 0) ? 'danger' : days !== null && days <= 30 ? 'warn' : undefined),
    };
  };
  const found = q.terms ? list.filter((a) => nameMatches(a.name, q.terms, q.text) || nameMatches(a.provider ?? '', q.terms, q.text)) : [];
  if (found.length) return { text: `Encontrei ${plural(found.length, 'serviço', 'serviços')}:`, items: found.slice(0, MAX).map(asItem) };
  if (q.flags.has('down')) {
    const down = monitors.filter((m) => m.enabled && m.state === 'down');
    return {
      text: down.length ? `${plural(down.length, 'endereço está fora do ar', 'endereços estão fora do ar')} agora:` : 'Nada do que é verificado está fora do ar agora.',
      items: down.map((m) => ({ label: m.label, sub: m.target ?? '', href: m.productId ? `#/projects/${m.productId}` : '#/infrastructure', tone: /** @type {ReplyItem['tone']} */ ('danger') })),
    };
  }
  if (q.flags.has('renewals') || q.flags.has('month') || q.flags.has('week')) {
    const window = q.flags.has('week') ? 7 : 30;
    const due = list.filter((a) => (daysUntil(a.renewsAt, todayKey) ?? 999) <= window).sort((a, b) => (a.renewsAt ?? '').localeCompare(b.renewsAt ?? ''));
    return { text: due.length ? `${plural(due.length, 'serviço vence', 'serviços vencem')} nos próximos ${window} dias (ou já venceram):` : `Nada vence nos próximos ${window} dias.`, items: due.map(asItem) };
  }
  const total = list.reduce((s, a) => s + monthlyCost(a), 0);
  const byCost = [...list].filter((a) => monthlyCost(a) > 0).sort((a, b) => monthlyCost(b) - monthlyCost(a));
  if (q.flags.has('cost')) {
    return {
      text: `Custo mensal estimado da infraestrutura: ${formatMoney(total)} (anuais divididos por 12; pagamentos únicos não entram).`,
      items: byCost.slice(0, MAX).map((a) => ({ label: a.name, sub: `${formatMoney(monthlyCost(a))}/mês`, href: '#/infrastructure' })),
    };
  }
  return {
    text: `${plural(list.length, 'serviço ativo', 'serviços ativos')} · custo mensal estimado ${formatMoney(total)}.${more(list.length)}`,
    items: list.slice(0, MAX).map(asItem),
    suggestions: ['O que vence este mês?', 'Tem algo fora do ar?', 'Quanto custa a infraestrutura?'],
  };
}

/** @param {Q} q */
/** @returns {Promise<Reply>} */
async function members(q) {
  if (!canDo('members.view')) return denied('a lista de membros');
  if (q.text.includes('convite')) {
    const invites = await data.invites.list(orgId());
    return {
      text: invites.length ? `${plural(invites.length, 'convite pendente', 'convites pendentes')}:` : 'Nenhum convite pendente.',
      items: invites.map((i) => ({ label: i.email, sub: `${roleName(i.role)} · expira ${formatRelative(i.expiresAt)}`, href: '#/settings/members' })),
    };
  }
  const list = await data.members.list(orgId());
  const role = ROLES.find((r) => q.text.includes(normalize(r.name).slice(0, 6)));
  const found = q.terms ? list.filter((m) => nameMatches(m.name, q.terms, q.text) || nameMatches(m.email, q.terms, q.text)) : [];
  const rows = found.length ? found : role ? list.filter((m) => m.role === role.key) : list;
  return {
    text: found.length
      ? `Encontrei ${plural(found.length, 'pessoa', 'pessoas')}:`
      : `${role ? `${plural(rows.length, 'pessoa', 'pessoas')} com o papel ${role.name}` : `${orgName()} tem ${plural(list.length, 'membro', 'membros')}`}.${more(rows.length)}`,
    items: rows.slice(0, MAX).map((m) => ({ label: m.name || m.email, sub: `${roleName(m.role)} · ${m.email}`, href: '#/settings/members' })),
    suggestions: ['Convites pendentes', 'Quem é administrador?'],
  };
}

/** @param {Q} q */
/** @returns {Promise<Reply>} */
async function activity(q) {
  if (!canDo('audit.view')) return denied('a trilha de auditoria');
  let rows = await data.audit.list(orgId(), { limit: 60 });
  const todayKey = today();
  if (q.flags.has('today')) rows = rows.filter((e) => new Date(e.createdAt).toLocaleDateString('sv-SE') === todayKey);
  if (q.terms) {
    const byPerson = rows.filter((e) => nameMatches(e.actorLabel, q.terms, q.text));
    if (byPerson.length) rows = byPerson;
  }
  return {
    text: rows.length ? `Últimas ações${q.flags.has('today') ? ' de hoje' : ''}:` : 'Nenhuma ação registrada nesse período.',
    items: rows.slice(0, MAX).map((e) => ({ label: `${e.actorLabel} ${describeAudit(e)}`, sub: formatRelative(e.createdAt) })),
    suggestions: ['Abrir auditoria completa'],
  };
}

/** @returns {Promise<Reply>} */
async function notifications() {
  const list = await data.notifications.list();
  const unread = list.filter((n) => !n.readAt);
  return {
    text: unread.length ? `Você tem ${plural(unread.length, 'aviso não lido', 'avisos não lidos')}:` : 'Nenhum aviso novo. Os últimos:',
    items: (unread.length ? unread : list).slice(0, MAX).map((n) => ({ label: n.title, sub: [n.body, formatRelative(n.createdAt)].filter(Boolean).join(' · '), href: n.link ?? undefined })),
  };
}

/** @returns {Promise<Reply>} */
async function automations() {
  if (!canDo('automations.view')) return denied('as automações');
  const states = await data.automations.list(orgId());
  return {
    text: 'Rotinas automáticas desta organização:',
    items: AUTOMATIONS.map((a) => {
      const s = states.find((x) => x.key === a.key);
      return { label: `${a.name}: ${s?.enabled ? 'ligada' : 'desligada'}`, sub: s?.lastRunAt ? `última execução ${formatRelative(s.lastRunAt)} — ${s.lastResult}` : 'ainda não rodou', href: '#/automation', tone: s?.enabled ? 'ok' : undefined };
    }),
  };
}

/** @returns {Promise<Reply>} */
async function analytics() {
  if (!canDo('analytics.view')) return denied('o uso dos produtos');
  const [daily, top, productList] = await Promise.all([data.analytics.daily(orgId(), 30), data.analytics.top(orgId(), 30), data.products.list(orgId()).catch(() => [])]);
  const total = daily.reduce((s, d) => s + d.events, 0);
  const name = (/** @type {string} */ id) => productList.find((p) => p.id === id)?.name ?? 'produto';
  return {
    text: total ? `${plural(total, 'evento', 'eventos')} de uso nos últimos 30 dias. Os mais frequentes:` : 'Nenhum evento de uso nos últimos 30 dias. Crie uma chave de coleta para o produto em DUM Analytics.',
    items: top.slice(0, MAX).map((t) => ({ label: `${t.event} · ${name(t.productId)}`, sub: `${formatInteger(t.total)} vez(es) · último ${formatRelative(t.lastAt)}`, href: '#/analytics' })),
  };
}

/** @returns {Promise<Reply>} */
async function finance() {
  /** @type {ReplyItem[]} */
  const items = [];
  let text = '';
  if (canDo('finance.view')) {
    try {
      const s = await data.finance.summary(orgId());
      text = `FinanceSolux (${s.account}), mês atual: receita ${formatMoney(s.revenue)}, despesa ${formatMoney(s.expenses)}, resultado ${formatMoney(s.net)}. Saldo em caixa: ${formatMoney(s.balance)}.`;
      for (const x of s.months.slice(0, MAX)) items.push({ label: x.month, sub: `receita ${formatMoney(x.revenue)} · despesa ${formatMoney(x.expenses)}` });
    } catch (error) {
      text = `Não consegui ler o FinanceSolux: ${errorMessage(error)}`;
    }
  } else {
    text = 'Seu papel não inclui os números do FinanceSolux.';
  }
  if (canDo('proposals.view')) {
    const accepted = (await data.proposals.list(orgId())).filter((p) => p.status === 'accepted');
    const mrr = accepted.reduce((s, p) => s + p.totalMonthly, 0);
    items.push({ label: `Receita recorrente contratada: ${formatMoney(mrr)}/mês`, sub: `${plural(accepted.length, 'proposta aceita', 'propostas aceitas')} no Master`, href: '#/finance' });
  }
  return { text, items };
}

/** @param {Q} q @returns {Promise<Reply>} */
async function documents(q) {
  if (!canDo('workspace.view')) return denied('o Caderno');
  const list = (await data.pages.list(orgId())).filter((p) => !p.archivedAt);
  const words = q.terms.split(' ').filter((w) => w.length > 2);
  // Título na hora; conteúdo (inclusive transcrição das reuniões) pela busca do servidor.
  const found = words.length ? await data.pages.search(orgId(), q.terms).catch(() => []) : [];
  const ids = new Set(found.map((f) => f.id));
  const rows = words.length ? list.filter((d) => ids.has(d.id) || words.every((w) => normalize(d.title).includes(w))) : list.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    text: rows.length
      ? `${plural(rows.length, 'página', 'páginas')}${words.length ? ` com “${q.terms}”` : ' no Caderno'}.${more(rows.length)}`
      : `Nenhuma página com “${q.terms}”.`,
    items: rows.slice(0, MAX).map((d) => ({ label: d.title || 'Sem título', sub: `${d.kind === 'meeting' ? 'reunião · ' : ''}editada ${formatRelative(d.updatedAt)}${d.editorName ? ` por ${d.editorName}` : ''}`, href: `#/workspace/${d.id}` })),
  };
}

/** Sem assunto reconhecido: procura o nome em tudo que o papel pode ver. @param {Q} q @param {string} question */
/** @returns {Promise<Reply>} */
async function search(q, question) {
  const id = orgId();
  /** @type {ReplyItem[]} */
  const items = [];
  if (q.terms) {
    const tries = [
      canDo('customers.view') && data.customers.list(id).then((l) => l.filter((c) => nameMatches(c.name, q.terms, q.text)).map((c) => ({ label: c.name, sub: `Cliente · ${customerStatus(c.status)}`, href: '#/customers' }))),
      canDo('products.view') && data.products.list(id).then((l) => l.filter((p) => nameMatches(p.name, q.terms, q.text)).map((p) => ({ label: p.name, sub: `Projeto · ${labelOf(PRODUCT_STATUS, p.status)}`, href: `#/projects/${p.id}` }))),
      canDo('proposals.view') && data.proposals.list(id).then((l) => l.filter((p) => nameMatches(p.title, q.terms, q.text)).map((p) => ({ label: `${proposalNumber(p.number)} · ${p.title}`, sub: `Proposta · ${p.customerName}`, href: `#/proposals/${p.id}` }))),
      canDo('infra.view') && data.assets.list(id).then((l) => l.filter((a) => nameMatches(a.name, q.terms, q.text)).map((a) => ({ label: a.name, sub: `Serviço · ${labelOf(ASSET_KINDS, a.kind)}`, href: '#/infrastructure' }))),
      canDo('members.view') && data.members.list(id).then((l) => l.filter((m) => nameMatches(m.name, q.terms, q.text)).map((m) => ({ label: m.name, sub: `Membro · ${roleName(m.role)}`, href: '#/settings/members' }))),
    ].filter(Boolean);
    for (const found of await Promise.all(tries)) items.push(...found);
  }
  if (items.length) return { text: `Encontrei ${plural(items.length, 'resultado', 'resultados')} para “${q.terms}”:`, items: items.slice(0, MAX) };
  return {
    text: `Não entendi “${question.trim()}”. Eu respondo sobre clientes, propostas, projetos, tarefas, produtos, infraestrutura, equipe, avisos e atividade. Tente uma destas:`,
    suggestions: EXAMPLES.slice(0, 6),
  };
}
