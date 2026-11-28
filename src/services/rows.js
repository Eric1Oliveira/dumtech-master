// Linha do banco (como a API do Supabase devolve, em snake_case e com os relacionamentos
// embutidos) → objeto das telas. Usado pelo supabase.js e pelo app do celular, que recebe as
// mesmas linhas pela função `mobile` (mobile_snapshot). Sem dependências.

export const toCamel = (/** @type {string} */ s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
export const toSnake = (/** @type {string} */ s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
/** @returns {any} */
export const fromRow = (/** @type {Record<string, any>} */ row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v]));
export const toRow = (/** @type {Record<string, any>} */ obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [toSnake(k), v]));
export const personName = (/** @type {any} */ p) => p?.full_name || p?.email || '';
export const num = (/** @type {any} */ v) => (v === null || v === undefined ? null : Number(v));

/** @returns {import('./data.js').Customer} */
export const fromCustomerRow = (/** @type {any} */ r) => ({
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

// Depois do fromRow (já em camelCase): o ajuste de cada tabela.
export const mapAmount = (/** @type {any} */ { amount, ...r }) => ({ ...r, amount: Number(amount) });
export const mapProduct = (/** @type {any} */ { owner, price, monthlyPrice, setupAmount, ...r }) =>
  ({ ...r, price: num(price), monthlyPrice: num(monthlyPrice), setupAmount: num(setupAmount), ownerName: personName(owner) });
export const mapTask = (/** @type {any} */ { assignee, product, page, projectId: _legacy, ...r }) =>
  ({ ...r, pageId: r.pageId ?? null, assigneeName: personName(assignee), projectName: product?.name ?? '', pageTitle: page?.title ?? '' });
export const mapAsset = (/** @type {any} */ { product, owner, cost, price, fixedShare, monitor: _m, lastCheckAt: _a, lastCheckOk: _b, lastCheckCode: _c, ...r }) =>
  ({ ...r, cost: num(cost), price: num(price), fixedShare: num(fixedShare), productName: product?.name ?? '', ownerName: personName(owner) });

/** Assinatura (customer_products com cliente e projeto). */
export const fromSubRow = (/** @type {any} */ r) => ({
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
});

/** Monitor com o endereço resolvido (o próprio, o do site do projeto ou o do serviço). */
export const fromMonitorRow = (/** @type {any} */ { product, asset, ...r }) => {
  const m = fromRow(r);
  return { ...m, target: m.url ?? (m.kind === 'site' ? product?.url : asset?.url) ?? null };
};

export const fromProposalRow = (/** @type {any} */ { customer, ...r }) => {
  const p = fromRow(r);
  return { ...p, customerName: customer?.name ?? '', totalOnce: Number(p.totalOnce), totalMonthly: Number(p.totalMonthly) };
};

export const fromLinkRow = (/** @type {any} */ r) => ({ assetId: r.asset_id, productId: r.product_id });

/** Cada lista do mobile_snapshot → os mesmos objetos que o computador usa. */
export const ROWS = {
  customers: fromCustomerRow,
  contacts: (/** @type {any} */ r) => fromRow(r),
  payments: (/** @type {any} */ r) => mapAmount(fromRow(r)),
  entries: (/** @type {any} */ r) => mapAmount(fromRow(r)),
  products: (/** @type {any} */ r) => mapProduct(fromRow(r)),
  subs: fromSubRow,
  monitors: fromMonitorRow,
  assets: (/** @type {any} */ r) => mapAsset(fromRow(r)),
  links: fromLinkRow,
  tasks: (/** @type {any} */ r) => mapTask(fromRow(r)),
  proposals: fromProposalRow,
  incidents: (/** @type {any} */ r) => fromRow(r),
  uptime: (/** @type {any} */ r) => fromRow(r),
  notifications: (/** @type {any} */ r) => fromRow(r),
};
