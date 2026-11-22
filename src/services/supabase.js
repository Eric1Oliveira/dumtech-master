// Backend SUPABASE. Usa só a chave pública (anon); quem protege os dados é o banco
// (RLS + funções das migrations). O SDK fica em assets/js/vendor e só é carregado
// quando o .env existe — o modo local não baixa nada.

import { normalizeCustomer } from '../core/customers.js';
import { normalizeProduct, normalizeSaleItem } from '../core/catalog.js';
import { normalizeContact } from '../core/customers.js';
import { normalizeTerms, normalizePayment } from '../core/billing.js';
import { normalizeEntry } from '../core/sites.js';
import { normalizeProposal } from '../core/proposals.js';
import { normalizeTask } from '../core/projects.js';
import { normalizeAsset, normalizeMonitor } from '../core/infra.js';
import { normalizeDocument, safeFileName, FILE_MAX_BYTES } from '../core/workspace.js';

/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */

const SDK_PATH = 'assets/js/vendor/supabase.js';

/** Configuração pública gerada pelo env.js (tools/env.js). */
export function getSupabaseConfig() {
  const env = /** @type {any} */ (globalThis).DUM_ENV ?? {};
  return { url: String(env.SUPABASE_URL ?? ''), anonKey: String(env.SUPABASE_ANON_KEY ?? '') };
}

export const isSupabaseConfigured = () => {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
};

/** @type {Promise<SupabaseClient> | null} */
let clientPromise = null;

/** @returns {Promise<SupabaseClient>} */
export function getClient() {
  clientPromise ??= loadSdk().then((sdk) => {
    const { url, anonKey } = getSupabaseConfig();
    return sdk.createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  });
  return clientPromise;
}

/** @returns {Promise<typeof import('@supabase/supabase-js')>} */
function loadSdk() {
  const w = /** @type {any} */ (window);
  if (w.supabase?.createClient) return Promise.resolve(w.supabase);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_PATH;
    script.onload = () => resolve(w.supabase);
    script.onerror = () => reject(new Error('Não foi possível carregar o SDK do Supabase.'));
    document.head.append(script);
  });
}

/** Mensagens do Supabase/Postgres → texto para o usuário. */
function toError(/** @type {{ message?: string }} */ error) {
  const message = error?.message || 'Erro inesperado.';
  if (/failed to fetch|networkerror|load failed/i.test(message)) return new Error('Sem conexão com o servidor. Verifique a internet.');
  if (/invalid login credentials/i.test(message)) return new Error('E-mail ou senha incorretos.');
  if (/email not confirmed/i.test(message)) {
    return new Error('Este e-mail ainda não foi confirmado. Use o link de confirmação enviado ou peça ao administrador para liberar a conta.');
  }
  if (/already registered|already been registered/i.test(message)) return new Error('Já existe uma conta com este e-mail. Use “Entrar” ou “Esqueci minha senha”.');
  if (/signups? not allowed|signup is disabled/i.test(message)) return new Error('Cadastro fechado. Peça um convite a quem administra a organização.');
  if (/rate limit|too many requests/i.test(message)) return new Error('Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.');
  if (/password should|weak password|password is known/i.test(message)) return new Error('Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.');
  if (/customers_org_document_idx|duplicate key.*document/i.test(message)) return new Error('Já existe um cliente com este documento.');
  if (/products_org_code_idx/i.test(message)) return new Error('Já existe um produto com esta sigla.');
  if (/proposals_customer_id_org_id_fkey/i.test(message)) return new Error('Este cliente tem propostas e não pode ser excluído.');
  if (/violates foreign key constraint/i.test(message)) return new Error('Este registro está ligado a outros e não pode ser excluído.');
  if (/row-level security|permission denied|unauthorized/i.test(message)) return new Error('Seu papel não permite esta ação.');
  if (/exceeded the maximum allowed size|payload too large/i.test(message)) return new Error('Arquivo maior que 10 MB.');
  return new Error(message);
}

/**
 * @template T
 * @param {{ data: T, error: any }} result
 * @returns {T}
 */
function unwrap({ data, error }) {
  if (error) throw toError(error);
  return data;
}

async function userId() {
  const sb = await getClient();
  const id = unwrap(await sb.auth.getSession()).session?.user.id;
  if (!id) throw new Error('Sessão expirada. Entre novamente.');
  return id;
}

const redirectUrl = () => `${location.origin}${location.pathname}`;

const CUSTOMER_COLUMNS = 'id, kind, name, document, email, phone, city, status, owner_id, notes, tags, created_at, updated_at, owner:profiles!customers_owner_id_fkey(full_name, email)';

/** @returns {import('./data.js').Customer} */
const fromCustomerRow = (/** @type {any} */ r) => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  document: r.document,
  email: r.email,
  phone: r.phone,
  city: r.city,
  status: r.status,
  ownerId: r.owner_id,
  ownerName: r.owner?.full_name || r.owner?.email || '',
  notes: r.notes ?? '',
  tags: r.tags ?? [],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// Tabelas da organização --------------------------------------------------------------
const toCamel = (/** @type {string} */ s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const toSnake = (/** @type {string} */ s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
/** @returns {any} */
const fromRow = (/** @type {Record<string, any>} */ row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v]));
const toRow = (/** @type {Record<string, any>} */ obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [toSnake(k), v]));
const personName = (/** @type {any} */ p) => p?.full_name || p?.email || '';
const num = (/** @type {any} */ v) => (v === null || v === undefined ? null : Number(v));

/**
 * Listar, salvar (criar/editar) e excluir numa tabela com org_id. Quem decide é a RLS:
 * escrita recusada volta sem linhas e vira a mensagem `denied`.
 * @param {string} table
 * @param {{ select: string, order: string, ascending?: boolean, normalize: (input: any) => Record<string, any>, map?: (row: any) => any, denied: string, fixed?: string[] }} spec
 *   fixed = colunas que não mudam depois de criadas (ficam fora do update)
 */
function orgTable(table, { select, order, ascending = true, normalize, map = (r) => r, denied, fixed = [] }) {
  return {
    async list(/** @type {string} */ orgId, /** @type {Record<string, string>} */ filter = {}) {
      const sb = await getClient();
      let query = sb.from(table).select(select).eq('org_id', orgId);
      for (const [key, value] of Object.entries(filter)) query = query.eq(toSnake(key), value);
      const rows = unwrap(await query.order(order, { ascending }));
      return /** @type {any[]} */ (rows).map((r) => map(fromRow(r)));
    },
    async save(/** @type {string} */ orgId, /** @type {any} */ input, /** @type {string | undefined} */ id) {
      const sb = await getClient();
      const row = toRow(normalize(input));
      if (id) {
        for (const column of fixed) delete row[column];
        const updated = unwrap(await sb.from(table).update(row).eq('id', id).eq('org_id', orgId).select('id'));
        if (!updated.length) throw new Error(denied);
        return id;
      }
      const [created] = unwrap(await sb.from(table).insert({ ...row, org_id: orgId }).select('id'));
      return created.id;
    },
    async remove(/** @type {string} */ orgId, /** @type {string} */ id) {
      const sb = await getClient();
      const removed = unwrap(await sb.from(table).delete().eq('id', id).eq('org_id', orgId).select('id'));
      if (!removed.length) throw new Error(denied);
    },
  };
}

/** @type {import('./data.js').Backend} */
export const supabaseBackend = {

  auth: {
    async getUser() {
      const sb = await getClient();
      const session = unwrap(await sb.auth.getSession()).session;
      if (!session) return null;
      const profile = unwrap(await sb.from('profiles').select('full_name, email').eq('id', session.user.id).maybeSingle());
      const email = profile?.email || session.user.email || '';
      return { id: session.user.id, email, name: profile?.full_name || session.user.user_metadata?.full_name || email };
    },

    async signIn({ email, password }) {
      const sb = await getClient();
      unwrap(await sb.auth.signInWithPassword({ email: email.trim(), password: password ?? '' }));
      return { user: await supabaseBackend.auth.getUser() };
    },

    async signUp({ email, password, name }) {
      const sb = await getClient();
      const result = unwrap(
        await sb.auth.signUp({
          email: email.trim(),
          password: password ?? '',
          options: { data: { full_name: String(name ?? '').trim() }, emailRedirectTo: redirectUrl() },
        }),
      );
      // E-mail já cadastrado: o Supabase devolve um usuário "vazio" (sem identidades) em vez de erro.
      if (!result.session && result.user && !result.user.identities?.length) {
        throw new Error('Já existe uma conta com este e-mail. Use “Entrar” ou “Esqueci minha senha”.');
      }
      if (!result.session) return { user: null, needsConfirmation: true };
      return { user: await supabaseBackend.auth.getUser() };
    },

    async signOut() {
      const sb = await getClient();
      const { error } = await sb.auth.signOut();
      if (error) throw toError(error);
    },

    async requestPasswordReset(email) {
      const sb = await getClient();
      unwrap(await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectUrl() }));
    },

    async updatePassword(password) {
      const sb = await getClient();
      unwrap(await sb.auth.updateUser({ password }));
    },

    onChange(handler) {
      let unsubscribe = () => {};
      getClient().then((sb) => {
        const { data } = sb.auth.onAuthStateChange((event) => handler(event));
        unsubscribe = () => data.subscription.unsubscribe();
      });
      return () => unsubscribe();
    },
  },

  orgs: {
    async listMine() {
      const sb = await getClient();
      const rows = unwrap(await sb.from('memberships').select('role_key, organizations(id, name)').eq('user_id', await userId()));
      return /** @type {any[]} */ (rows)
        .map((r) => ({ id: r.organizations.id, name: r.organizations.name, role: r.role_key }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    },

    async create(name) {
      const sb = await getClient();
      const org = unwrap(await sb.rpc('create_organization', { p_name: name }));
      return { id: org.id, name: org.name };
    },

    async rename(orgId, name) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('organizations').update({ name: name.trim() }).eq('id', orgId).select('id'));
      if (!rows.length) throw new Error('Seu papel não permite editar a organização.');
    },
  },

  members: {
    async list(orgId) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('memberships').select('user_id, role_key, created_at, profiles(full_name, email)').eq('org_id', orgId));
      return /** @type {any[]} */ (rows).map((r) => ({
        userId: r.user_id,
        name: r.profiles?.full_name ?? '',
        email: r.profiles?.email ?? '',
        role: r.role_key,
        createdAt: r.created_at,
      }));
    },

    async setRole(orgId, userIdValue, role) {
      const sb = await getClient();
      unwrap(await sb.rpc('set_member_role', { p_org: orgId, p_user: userIdValue, p_role: role }));
    },

    async remove(orgId, userIdValue) {
      const sb = await getClient();
      unwrap(await sb.rpc('remove_member', { p_org: orgId, p_user: userIdValue }));
    },
  },

  invites: {
    async list(orgId) {
      const sb = await getClient();
      const rows = unwrap(
        await sb
          .from('invitations')
          .select('id, email, role_key, created_at, expires_at, inviter:profiles!invitations_invited_by_fkey(full_name, email)')
          .eq('org_id', orgId)
          .is('accepted_at', null)
          .is('revoked_at', null)
          .order('created_at', { ascending: false }),
      );
      return /** @type {any[]} */ (rows).map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role_key,
        invitedBy: r.inviter?.full_name || r.inviter?.email || '',
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }));
    },

    async create(orgId, email, role) {
      const sb = await getClient();
      const result = unwrap(await sb.rpc('create_invitation', { p_org: orgId, p_email: email, p_role: role }));
      return { token: result.token, expiresAt: result.expires_at };
    },

    async revoke(_orgId, id) {
      const sb = await getClient();
      unwrap(await sb.rpc('revoke_invitation', { p_id: id }));
    },

    async preview(token) {
      const sb = await getClient();
      const result = unwrap(await sb.rpc('invitation_preview', { p_token: token }));
      return { status: result.status, email: result.email, role: result.role, orgName: result.org_name };
    },

    async accept(token) {
      const sb = await getClient();
      const result = unwrap(await sb.rpc('accept_invitation', { p_token: token }));
      return { orgId: result.org_id, orgName: result.org_name };
    },
  },

  customers: {
    async list(orgId) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('customers').select(CUSTOMER_COLUMNS).eq('org_id', orgId).order('name'));
      return /** @type {any[]} */ (rows).map(fromCustomerRow);
    },

    async save(orgId, input, id) {
      const sb = await getClient();
      const clean = normalizeCustomer(input);
      const row = {
        kind: clean.kind,
        name: clean.name,
        document: clean.document,
        email: clean.email,
        phone: clean.phone,
        city: clean.city,
        status: clean.status,
        owner_id: clean.ownerId,
        notes: clean.notes,
        tags: clean.tags,
      };
      if (id) {
        const updated = unwrap(await sb.from('customers').update(row).eq('id', id).eq('org_id', orgId).select('id'));
        if (!updated.length) throw new Error('Seu papel não permite editar clientes.');
      } else {
        unwrap(await sb.from('customers').insert({ ...row, org_id: orgId }));
      }
    },

    async remove(orgId, id) {
      const sb = await getClient();
      const removed = unwrap(await sb.from('customers').delete().eq('id', id).eq('org_id', orgId).select('id'));
      if (!removed.length) throw new Error('Seu papel não permite excluir clientes.');
    },
  },

  customerContacts: orgTable('customer_contacts', {
    select: 'id, customer_id, name, role, phone, email, is_primary, created_at, updated_at',
    order: 'name',
    normalize: normalizeContact,
    denied: 'Seu papel não permite editar clientes.',
    fixed: ['customer_id'],
  }),

  payments: orgTable('billing_payments', {
    select: 'id, subscription_id, month, amount, paid_on, note, created_at',
    order: 'month',
    ascending: false,
    normalize: normalizePayment,
    map: ({ amount, ...r }) => ({ ...r, amount: Number(amount) }),
    denied: 'Seu papel não permite registrar pagamentos.',
    fixed: ['subscription_id', 'month'],
  }),

  productEntries: orgTable('product_entries', {
    select: 'id, product_id, kind, description, amount, occurred_on, created_at, updated_at',
    order: 'occurred_on',
    ascending: false,
    normalize: normalizeEntry,
    map: ({ amount, ...r }) => ({ ...r, amount: Number(amount) }),
    denied: 'Seu papel não permite editar produtos.',
    fixed: ['product_id'],
  }),

  products: {
    ...orgTable('products', {
      select: '*, owner:profiles!products_owner_id_fkey(full_name, email)',
      order: 'name',
      normalize: normalizeProduct,
      map: ({ owner, price, monthlyPrice, setupAmount, ...r }) => ({ ...r, price: num(price), monthlyPrice: num(monthlyPrice), setupAmount: num(setupAmount), ownerName: personName(owner) }),
      denied: 'Seu papel não permite editar projetos.',
    }),
    async create(orgId, input) {
      const sb = await getClient();
      const lines = (input.lines ?? []).map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unitPrice, recurring: l.recurring }));
      return unwrap(await sb.rpc('project_create', { p_org: orgId, p_input: { ...input, lines } }));
    },
    async setStage(_orgId, id, stage, options = {}) {
      const sb = await getClient();
      unwrap(await sb.rpc('project_set_stage', { p_id: id, p_stage: stage, p_options: options }));
    },
  },

  assetLinks: {
    async list(orgId) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('asset_projects').select('asset_id, product_id').eq('org_id', orgId));
      return /** @type {any[]} */ (rows).map((r) => ({ assetId: r.asset_id, productId: r.product_id }));
    },
    async add(orgId, assetId, productId) {
      const sb = await getClient();
      const exists = unwrap(await sb.from('asset_projects').select('asset_id').eq('asset_id', assetId).eq('product_id', productId).maybeSingle());
      if (!exists) unwrap(await sb.from('asset_projects').insert({ org_id: orgId, asset_id: assetId, product_id: productId }));
    },
    async remove(orgId, assetId, productId) {
      const sb = await getClient();
      unwrap(await sb.from('asset_projects').delete().eq('org_id', orgId).eq('asset_id', assetId).eq('product_id', productId));
    },
  },

  saleItems: orgTable('sale_items', {
    select: 'id, name, price, recurring, active, position',
    order: 'position',
    normalize: normalizeSaleItem,
    map: ({ price, ...r }) => ({ ...r, price: Number(price) }),
    denied: 'Seu papel não permite editar a tabela de preços.',
  }),

  settings: {
    async get(orgId, key) {
      const sb = await getClient();
      return unwrap(await sb.from('org_settings').select('value').eq('org_id', orgId).eq('key', key).maybeSingle())?.value ?? null;
    },
    async set(orgId, key, value) {
      const sb = await getClient();
      unwrap(await sb.rpc('org_setting_set', { p_org: orgId, p_key: key, p_value: value }));
    },
  },

  monitors: {
    async list(orgId) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('monitors').select('*, product:products(url), asset:infra_assets(url)').eq('org_id', orgId).order('created_at'));
      return /** @type {any[]} */ (rows).map(({ product, asset, ...r }) => {
        const m = fromRow(r);
        return { ...m, target: m.url ?? (m.kind === 'site' ? product?.url : asset?.url) ?? null };
      });
    },
    async save(orgId, input, id) {
      const sb = await getClient();
      const row = toRow(normalizeMonitor(input));
      if (id) {
        delete row.product_id;
        delete row.asset_id;
        delete row.kind;
        const updated = unwrap(await sb.from('monitors').update(row).eq('id', id).eq('org_id', orgId).select('id'));
        if (!updated.length) throw new Error('Seu papel não permite mudar o monitoramento.');
        return id;
      }
      const [created] = unwrap(await sb.from('monitors').insert({ ...row, org_id: orgId }).select('id'));
      return created.id;
    },
    async remove(orgId, id) {
      const sb = await getClient();
      unwrap(await sb.from('monitors').delete().eq('id', id).eq('org_id', orgId));
    },
  },

  customerProducts: {
    async list(orgId, filter = {}) {
      const sb = await getClient();
      let query = sb.from('customer_products').select('id, customer_id, product_id, status, since, monthly_amount, billing_day, adjusted_on, customer:customers(name), product:products(name)').eq('org_id', orgId);
      if (filter.productId) query = query.eq('product_id', filter.productId);
      if (filter.customerId) query = query.eq('customer_id', filter.customerId);
      const rows = unwrap(await query.order('since', { ascending: false }));
      return /** @type {any[]} */ (rows).map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        customerName: r.customer?.name ?? '',
        productId: r.product_id,
        productName: r.product?.name ?? '',
        status: r.status,
        since: r.since,
        monthlyAmount: num(r.monthly_amount),
        billingDay: r.billing_day ?? null,
        adjustedOn: r.adjusted_on ?? null,
      }));
    },
    async link(orgId, customerId, productId, terms) {
      const sb = await getClient();
      const clean = terms ? normalizeTerms(terms) : null;
      const fields = { status: /** @type {any} */ (terms)?.status === 'pending' ? 'pending' : 'active', ...(clean ? { monthly_amount: clean.monthlyAmount, billing_day: clean.billingDay } : {}) };
      // Sem upsert: o ON CONFLICT DO UPDATE do PostgREST regrava org/cliente/produto, colunas sem
      // grant de update (de propósito) — o banco recusa com 403. Já vinculado = atualiza só os termos.
      const existing = unwrap(await sb.from('customer_products').select('id').eq('org_id', orgId).eq('customer_id', customerId).eq('product_id', productId).maybeSingle());
      if (!existing) {
        unwrap(await sb.from('customer_products').insert({ org_id: orgId, customer_id: customerId, product_id: productId, ...fields }));
        return;
      }
      const updated = unwrap(await sb.from('customer_products').update(fields).eq('id', existing.id).eq('org_id', orgId).select('id'));
      if (!updated.length) throw new Error('Seu papel não permite editar produtos.');
    },
    async update(orgId, id, changes) {
      const sb = await getClient();
      const clean = normalizeTerms(changes);
      const row = {
        monthly_amount: clean.monthlyAmount,
        billing_day: clean.billingDay,
        ...(changes.status ? { status: changes.status === 'cancelled' ? 'cancelled' : changes.status === 'pending' ? 'pending' : 'active' } : {}),
        ...(changes.adjustedOn ? { adjusted_on: changes.adjustedOn } : {}),
      };
      const updated = unwrap(await sb.from('customer_products').update(row).eq('id', id).eq('org_id', orgId).select('id'));
      if (!updated.length) throw new Error('Seu papel não permite editar produtos.');
    },
    async unlink(orgId, id) {
      const sb = await getClient();
      const removed = unwrap(await sb.from('customer_products').delete().eq('id', id).eq('org_id', orgId).select('id'));
      if (!removed.length) throw new Error('Seu papel não permite editar produtos.');
    },
  },

  proposals: {
    async list(orgId) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('proposals').select('*, customer:customers(name)').eq('org_id', orgId).order('number', { ascending: false }));
      return /** @type {any[]} */ (rows).map(({ customer, ...r }) => {
        const p = fromRow(r);
        return { ...p, customerName: customer?.name ?? '', totalOnce: Number(p.totalOnce), totalMonthly: Number(p.totalMonthly) };
      });
    },
    async items(orgId, proposalId) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('proposal_items').select('description, quantity, unit_price, recurring').eq('org_id', orgId).eq('proposal_id', proposalId).order('position'));
      return /** @type {any[]} */ (rows).map((r) => ({ productId: null, description: r.description, quantity: Number(r.quantity), unitPrice: Number(r.unit_price), recurring: r.recurring }));
    },
    async save(orgId, input, id) {
      const sb = await getClient();
      const p = normalizeProposal(input);
      return unwrap(
        await sb.rpc('save_proposal', {
          p_org: orgId,
          p_id: id ?? null,
          p_customer: p.customerId,
          p_title: p.title,
          p_valid_until: p.validUntil,
          p_notes: p.notes,
          p_items: p.items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price: i.unitPrice, recurring: i.recurring })),
          p_product: input.productId ?? null,
        }),
      );
    },
    async setStatus(_orgId, id, status) {
      const sb = await getClient();
      const result = unwrap(await sb.rpc('set_proposal_status', { p_id: id, p_status: status }));
      return { projectId: result?.project_id ?? null };
    },
    async remove(orgId, id) {
      const sb = await getClient();
      const removed = unwrap(await sb.from('proposals').delete().eq('id', id).eq('org_id', orgId).select('id'));
      if (!removed.length) throw new Error('Só rascunhos e propostas recusadas podem ser excluídos.');
    },
  },

  tasks: orgTable('tasks', {
    select: '*, assignee:profiles!tasks_assignee_id_fkey(full_name, email), product:products(name)',
    order: 'position',
    normalize: normalizeTask,
    map: ({ assignee, product, projectId: _legacy, ...r }) => ({ ...r, assigneeName: personName(assignee), projectName: product?.name ?? '' }),
    denied: 'Seu papel não permite editar tarefas.',
    fixed: ['product_id'],
  }),

  assets: orgTable('infra_assets', {
    select: '*, product:products(name), owner:profiles!infra_assets_owner_id_fkey(full_name, email)',
    order: 'name',
    normalize: normalizeAsset,
    map: ({ product, owner, cost, price, fixedShare, monitor: _m, lastCheckAt: _a, lastCheckOk: _b, lastCheckCode: _c, ...r }) => ({ ...r, cost: num(cost), price: num(price), fixedShare: num(fixedShare), productName: product?.name ?? '', ownerName: personName(owner) }),
    denied: 'Seu papel não permite editar a infraestrutura.',
  }),

  monitoring: {
    async checks(orgId, monitorId) {
      const sb = await getClient();
      let query = sb.from('monitor_checks').select('monitor_id, checked_at, ok, code, ms_total, ms_connect, cause, detail').eq('org_id', orgId)
        .gte('checked_at', new Date(Date.now() - 864e5).toISOString());
      if (monitorId) query = query.eq('monitor_id', monitorId);
      const rows = unwrap(await query.order('checked_at', { ascending: false }).limit(5000));
      return /** @type {any[]} */ (rows).map((r) => fromRow(r));
    },
    async history(orgId, monitorIds) {
      if (!monitorIds.length) return { checks: [], hourly: [], incidents: [] };
      const sb = await getClient();
      const day = new Date(Date.now() - 864e5).toISOString();
      const month = new Date(Date.now() - 30 * 864e5).toISOString();
      const [checks, hourly, incidents] = await Promise.all([
        sb.from('monitor_checks').select('monitor_id, checked_at, ok, code, ms_total, ms_connect, cause, detail').eq('org_id', orgId).in('monitor_id', monitorIds)
          .gte('checked_at', day).order('checked_at', { ascending: true }).limit(10000),
        sb.from('monitor_hourly').select('monitor_id, hour, checks, ok, slow, ms_avg, ms_p95, ms_max').eq('org_id', orgId).in('monitor_id', monitorIds)
          .gte('hour', month).order('hour', { ascending: true }).limit(5000),
        sb.from('monitor_incidents').select('id, monitor_id, started_at, ended_at, cause, code, failures').eq('org_id', orgId).in('monitor_id', monitorIds)
          .order('started_at', { ascending: false }).limit(50),
      ]);
      return {
        checks: /** @type {any[]} */ (unwrap(checks)).map((r) => fromRow(r)),
        hourly: /** @type {any[]} */ (unwrap(hourly)).map((r) => fromRow(r)),
        incidents: /** @type {any[]} */ (unwrap(incidents)).map((r) => fromRow(r)),
      };
    },
    async checkNow(orgId) {
      const sb = await getClient();
      const { data: result, error } = await sb.functions.invoke('monitor', { body: { mode: 'now', org: orgId } });
      if (error) throw new Error('A verificação não respondeu. Confira se a função "monitor" está publicada no Supabase.');
      return result?.checked ?? 0;
    },
    async collect() {
      return 0;
    },
  },

  automations: {
    async list(orgId) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('automations').select('key, enabled, last_run_at, last_result').eq('org_id', orgId));
      return /** @type {any[]} */ (rows).map((r) => ({ key: r.key, enabled: r.enabled, lastRunAt: r.last_run_at, lastResult: r.last_result }));
    },
    async set(orgId, key, enabled) {
      const sb = await getClient();
      unwrap(await sb.rpc('set_automation', { p_org: orgId, p_key: key, p_enabled: enabled }));
    },
    async run(orgId, key) {
      const sb = await getClient();
      return unwrap(await sb.rpc('run_automation_now', { p_org: orgId, p_key: key }));
    },
  },

  vault: {
    async settings(orgId) {
      const sb = await getClient();
      const row = unwrap(await sb.from('vault_settings').select('iterations, salt, check_iv, check_cipher, public_key, key_iv, key_cipher').eq('org_id', orgId).eq('user_id', await userId()).maybeSingle());
      return row ? { iterations: row.iterations, salt: row.salt, checkIv: row.check_iv, checkCipher: row.check_cipher, publicKey: row.public_key, keyIv: row.key_iv, keyCipher: row.key_cipher } : null;
    },
    async setup(orgId, s) {
      const sb = await getClient();
      unwrap(await sb.rpc('vault_setup', { p_org: orgId, p_iterations: s.iterations, p_salt: s.salt, p_check_iv: s.checkIv, p_check_cipher: s.checkCipher, p_public_key: s.publicKey ?? null, p_key_iv: s.keyIv ?? null, p_key_cipher: s.keyCipher ?? null }));
    },
    async setKeys(orgId, k) {
      const sb = await getClient();
      unwrap(await sb.rpc('vault_set_keys', { p_org: orgId, p_public_key: k.publicKey, p_key_iv: k.keyIv, p_key_cipher: k.keyCipher }));
    },
    async list(orgId) {
      const sb = await getClient();
      const me = await userId();
      const [rows, shares] = await Promise.all([
        sb.from('vault_items').select('id, title, kind, updated_at').eq('org_id', orgId).eq('owner_id', me).order('title'),
        sb.from('vault_shares').select('item_id, recipient:profiles!vault_shares_recipient_id_fkey(full_name, email)').eq('org_id', orgId).eq('owner_id', me),
      ]);
      const names = /** @type {any[]} */ (unwrap(shares));
      return /** @type {any[]} */ (unwrap(rows)).map((r) => ({ id: r.id, title: r.title, kind: r.kind, updatedAt: r.updated_at, sharedWith: names.filter((x) => x.item_id === r.id).map((x) => personName(x.recipient)) }));
    },
    async received(orgId) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('vault_shares').select('id, item_id, title, kind, updated_at, owner:profiles!vault_shares_owner_id_fkey(full_name, email)').eq('org_id', orgId).eq('recipient_id', await userId()).order('title'));
      return /** @type {any[]} */ (rows).map((r) => ({ id: r.id, itemId: r.item_id, title: r.title, kind: r.kind, updatedAt: r.updated_at, ownerName: personName(r.owner) }));
    },
    async open(_orgId, id) {
      const sb = await getClient();
      const box = unwrap(await sb.rpc('vault_open', { p_id: id }));
      return { iv: box.iv, cipher: box.cipher };
    },
    async openShared(_orgId, shareId) {
      const sb = await getClient();
      const box = unwrap(await sb.rpc('vault_open_shared', { p_share: shareId }));
      return { epk: box.epk, iv: box.iv, cipher: box.cipher };
    },
    async save(orgId, item) {
      const sb = await getClient();
      unwrap(await sb.rpc('vault_save', { p_org: orgId, p_id: item.id, p_title: item.title, p_kind: item.kind, p_iv: item.box.iv, p_cipher: item.box.cipher }));
    },
    async remove(orgId, id) {
      const sb = await getClient();
      const removed = unwrap(await sb.from('vault_items').delete().eq('id', id).eq('org_id', orgId).select('id'));
      if (!removed.length) throw new Error('Segredo não encontrado no seu cofre.');
    },
    async members(orgId) {
      const sb = await getClient();
      const rows = unwrap(await sb.rpc('vault_members', { p_org: orgId }));
      return /** @type {any[]} */ (rows ?? []).map((r) => ({ userId: r.user_id, name: r.name, email: r.email, publicKey: r.public_key }));
    },
    async sharesOf(_orgId, itemId) {
      const sb = await getClient();
      const rows = unwrap(await sb.rpc('vault_item_shares', { p_item: itemId }));
      return /** @type {any[]} */ (rows ?? []).map((r) => ({ shareId: r.share_id, recipientId: r.recipient_id, name: r.name, publicKey: r.public_key }));
    },
    async share(_orgId, itemId, recipientId, box) {
      const sb = await getClient();
      unwrap(await sb.rpc('vault_share', { p_item: itemId, p_recipient: recipientId, p_epk: box.epk, p_iv: box.iv, p_cipher: box.cipher }));
    },
    async unshare(_orgId, shareId) {
      const sb = await getClient();
      unwrap(await sb.rpc('vault_unshare', { p_share: shareId }));
    },
    async exportAll(orgId) {
      const sb = await getClient();
      return unwrap(await sb.rpc('vault_export', { p_org: orgId })) ?? [];
    },
    async rotate(orgId, s, items) {
      const sb = await getClient();
      unwrap(await sb.rpc('vault_rotate', { p_org: orgId, p_iterations: s.iterations, p_salt: s.salt, p_check_iv: s.checkIv, p_check_cipher: s.checkCipher, p_key_iv: s.keyIv ?? null, p_key_cipher: s.keyCipher ?? null, p_items: items }));
    },
  },

  backups: {
    async list(orgId) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('org_backups').select('id, kind, size_bytes, created_at').eq('org_id', orgId).order('created_at', { ascending: false }));
      return /** @type {any[]} */ (rows).map((r) => ({ id: r.id, kind: r.kind, size: r.size_bytes, createdAt: r.created_at }));
    },
    async create(orgId) {
      const sb = await getClient();
      return unwrap(await sb.rpc('backup_now', { p_org: orgId }));
    },
    async get(_orgId, id) {
      const sb = await getClient();
      return unwrap(await sb.rpc('backup_get', { p_id: id }));
    },
  },

  telegram: {
    async status(orgId) {
      const sb = await getClient();
      return unwrap(await sb.rpc('telegram_status', { p_org: orgId })) ?? { configured: false, chat: null };
    },
    async set(orgId, config) {
      const sb = await getClient();
      unwrap(await sb.rpc('telegram_set', { p_org: orgId, p_token: config?.token ?? null, p_chat: config?.chatId ?? null, p_chat_name: config?.chatName ?? null }));
    },
    async test(orgId) {
      const sb = await getClient();
      return Boolean(unwrap(await sb.rpc('telegram_test', { p_org: orgId })));
    },
  },

  documents: orgTable('documents', {
    select: 'id, title, body, pinned, created_at, updated_at, editor:profiles!documents_updated_by_fkey(full_name, email)',
    order: 'updated_at',
    ascending: false,
    normalize: normalizeDocument,
    map: ({ editor, ...r }) => ({ ...r, editorName: personName(editor) }),
    denied: 'Seu papel não permite editar documentos.',
  }),

  files: {
    async list(orgId) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('workspace_files').select('id, path, name, size, mime, product_id, created_at, uploader:profiles!workspace_files_uploaded_by_fkey(full_name, email)').eq('org_id', orgId).order('created_at', { ascending: false }));
      return /** @type {any[]} */ (rows).map((r) => ({ id: r.id, path: r.path, name: r.name, size: Number(r.size), mime: r.mime, productId: r.product_id ?? null, uploaderName: personName(r.uploader), createdAt: r.created_at }));
    },
    async upload(orgId, file, productId = null) {
      if (file.size > FILE_MAX_BYTES) throw new Error('Arquivo maior que 10 MB.');
      const sb = await getClient();
      const path = `${orgId}/${globalThis.crypto.randomUUID()}-${safeFileName(file.name)}`;
      const sent = await sb.storage.from('workspace').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (sent.error) throw toError(sent.error);
      const meta = await sb.from('workspace_files').insert({ org_id: orgId, path, name: file.name.slice(0, 200), size: file.size, mime: file.type || null, product_id: productId });
      if (meta.error) {
        await sb.storage.from('workspace').remove([path]);
        throw toError(meta.error);
      }
    },
    async link(_orgId, file) {
      const sb = await getClient();
      const { data: signed, error } = await sb.storage.from('workspace').createSignedUrl(file.path, 120, { download: file.name });
      if (error) throw toError(error);
      return signed.signedUrl;
    },
    async remove(orgId, file) {
      const sb = await getClient();
      const removed = unwrap(await sb.from('workspace_files').delete().eq('id', file.id).eq('org_id', orgId).select('id'));
      if (!removed.length) throw new Error('Seu papel não permite excluir arquivos.');
      await sb.storage.from('workspace').remove([file.path]);
    },
  },

  analytics: {
    async keys(orgId) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('analytics_keys').select('id, product_id, label, key_prefix, created_at, revoked_at, product:products(name)').eq('org_id', orgId).order('created_at', { ascending: false }));
      return /** @type {any[]} */ (rows).map((r) => ({ id: r.id, productId: r.product_id, productName: r.product?.name ?? '', label: r.label, prefix: r.key_prefix, createdAt: r.created_at, revokedAt: r.revoked_at }));
    },
    async createKey(orgId, productId, label) {
      const sb = await getClient();
      const r = unwrap(await sb.rpc('create_analytics_key', { p_org: orgId, p_product: productId, p_label: label }));
      return { id: r.id, key: r.key };
    },
    async revokeKey(_orgId, id) {
      const sb = await getClient();
      unwrap(await sb.rpc('revoke_analytics_key', { p_id: id }));
    },
    async track(key, event, props = {}, clientId = null) {
      const sb = await getClient();
      unwrap(await sb.rpc('track_event', { p_key: key, p_event: event, p_props: props, p_client: clientId }));
    },
    async daily(orgId, days) {
      const sb = await getClient();
      const rows = unwrap(await sb.rpc('analytics_daily', { p_org: orgId, p_days: days }));
      return /** @type {any[]} */ (rows).map((r) => ({ day: r.day, productId: r.product_id, events: Number(r.events), clients: Number(r.clients) }));
    },
    async top(orgId, days) {
      const sb = await getClient();
      const rows = unwrap(await sb.rpc('analytics_top', { p_org: orgId, p_days: days }));
      return /** @type {any[]} */ (rows).map((r) => ({ productId: r.product_id, event: r.event, total: Number(r.total), clients: Number(r.clients), lastAt: r.last_at }));
    },
  },

  finance: {
    async summary(orgId) {
      const sb = await getClient();
      const { data: summary, error } = await sb.functions.invoke('financesolux-summary', { body: { org_id: orgId } });
      if (!error) return summary;
      const response = /** @type {any} */ (error).context;
      let message = error.message;
      try {
        const body = await response?.json();
        if (body?.error) message = body.error;
      } catch {
        /* resposta sem JSON */
      }
      if (response?.status === 404 || /failed to send a request/i.test(message)) {
        message = 'A Edge Function financesolux-summary ainda não foi publicada neste projeto Supabase.';
      }
      throw new Error(message);
    },
  },

  audit: {
    async list(orgId, { limit = 100 } = {}) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('audit_log').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(limit));
      return /** @type {any[]} */ (rows).map((r) => ({
        id: r.id,
        actorLabel: r.actor_label,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        data: r.data ?? {},
        createdAt: r.created_at,
      }));
    },
  },

  notifications: {
    async list() {
      const sb = await getClient();
      const rows = unwrap(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50));
      return /** @type {any[]} */ (rows).map((r) => ({
        id: r.id,
        orgId: r.org_id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        link: r.link,
        readAt: r.read_at,
        createdAt: r.created_at,
      }));
    },

    async markRead(id) {
      const sb = await getClient();
      unwrap(await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null));
    },

    async markAllRead() {
      const sb = await getClient();
      unwrap(await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', await userId()).is('read_at', null));
    },

    subscribe(handler) {
      let stop = () => {};
      Promise.all([getClient(), userId()])
        .then(([sb, id]) => {
          const channel = sb
            .channel(`notifications:${id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${id}` }, () => handler())
            .subscribe();
          stop = () => sb.removeChannel(channel);
        })
        .catch(() => {});
      return () => stop();
    },
  },

  prefs: {
    async get(orgId, key) {
      const sb = await getClient();
      const row = unwrap(await sb.from('user_preferences').select('value').eq('org_id', orgId).eq('key', key).eq('user_id', await userId()).maybeSingle());
      return row?.value ?? null;
    },

    async set(orgId, key, value) {
      const sb = await getClient();
      unwrap(await sb.from('user_preferences').upsert({ user_id: await userId(), org_id: orgId, key, value, updated_at: new Date().toISOString() }));
    },
  },

  integrations: {
    async list(orgId) {
      const sb = await getClient();
      const rows = unwrap(await sb.from('integrations').select('provider, status, config, updated_at').eq('org_id', orgId));
      return /** @type {any[]} */ (rows).map((r) => ({ provider: r.provider, status: r.status, config: r.config ?? {}, updatedAt: r.updated_at }));
    },

    async saveConfig(orgId, provider, config) {
      const sb = await getClient();
      unwrap(await sb.rpc('save_integration_config', { p_org: orgId, p_provider: provider, p_config: config }));
    },
  },

  health: {
    async info() {
      const sb = await getClient();
      const info = unwrap(await sb.rpc('app_info'));
      return { schemaVersion: info?.schema_version ?? 'desconhecida', scheduler: Boolean(info?.scheduler), httpChecks: Boolean(info?.http_checks), monitor: Boolean(info?.monitor), storage: Boolean(info?.storage) };
    },
  },
};
