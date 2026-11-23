// Regras do cadastro de clientes. Espelho das constraints da migration 0007
// (o banco confere de novo). Usadas pelo formulário e pelo dublê dos testes.

/** @typedef {import('../services/data.js').CustomerInput} CustomerInput */

export const CUSTOMER_STATUS = /** @type {const} */ ([
  { key: 'lead', label: 'Lead', tone: 'info' },
  { key: 'active', label: 'Ativo', tone: 'ok' },
  { key: 'inactive', label: 'Inativo', tone: 'muted' },
]);

export const CUSTOMER_KINDS = /** @type {const} */ ([
  { key: 'company', label: 'Empresa', document: 'CNPJ' },
  { key: 'person', label: 'Pessoa física', document: 'CPF' },
]);

/** @param {string} key */
export const statusLabel = (key) => CUSTOMER_STATUS.find((s) => s.key === key)?.label ?? key;

/** Mantém só letras e números, em maiúsculas (o CNPJ pode ser alfanumérico desde 2026). */
export const cleanDocument = (/** @type {unknown} */ value) => String(value ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/** @param {string} cpf 11 dígitos */
export function isValidCpf(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (/** @type {number} */ length) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/**
 * CNPJ numérico ou alfanumérico (IN RFB 2.229/2024): cada caractere vale o código ASCII − 48.
 * @param {string} cnpj 14 caracteres
 */
export function isValidCnpj(cnpj) {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const value = (/** @type {string} */ c) => c.charCodeAt(0) - 48;
  const digit = (/** @type {number} */ length) => {
    let sum = 0;
    let weight = length - 7;
    for (let i = 0; i < length; i++) {
      sum += value(cnpj[i]) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
}

/** @param {string | null | undefined} doc */
export function formatDocument(doc) {
  if (!doc) return '';
  if (doc.length === 11) return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (doc.length === 14) return doc.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5');
  return doc;
}

const optional = (/** @type {unknown} */ value) => {
  const text = String(value ?? '').trim();
  return text ? text : null;
};

/**
 * Valida e limpa o que veio do formulário. Lança Error com a mensagem para o usuário.
 * @param {Partial<CustomerInput>} input
 * @returns {CustomerInput}
 */
export function normalizeCustomer(input) {
  const kind = input.kind === 'person' ? 'person' : 'company';
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) throw new Error('O nome precisa ter entre 2 e 120 caracteres.');

  const document = cleanDocument(input.document) || null;
  if (document) {
    if (kind === 'person' && !isValidCpf(document)) throw new Error('CPF inválido. Confira os 11 dígitos.');
    if (kind === 'company' && !isValidCnpj(document)) throw new Error('CNPJ inválido. Confira os 14 caracteres.');
  }

  const email = optional(input.email)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido.');
  const phone = optional(input.phone);
  if (phone && phone.length > 30) throw new Error('Telefone muito longo.');
  const city = optional(input.city);
  if (city && city.length > 80) throw new Error('Cidade muito longa.');
  const notes = String(input.notes ?? '').trim();
  if (notes.length > 4000) throw new Error('As observações passam de 4.000 caracteres.');
  const status = CUSTOMER_STATUS.some((s) => s.key === input.status) ? input.status : 'lead';

  return { kind, name, document, email, phone, city, status, ownerId: optional(input.ownerId), notes, tags: normalizeTags(input.tags) };
}

/**
 * Etiquetas: aceita lista ou texto separado por vírgula. Sem repetir (ignora maiúsculas),
 * até 12, cada uma com até 30 caracteres. Espelho da coluna customers.tags.
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeTags(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  /** @type {string[]} */
  const tags = [];
  for (const item of raw) {
    const tag = String(item ?? '').trim().replace(/\s+/g, ' ').replace(/,/g, '');
    if (!tag) continue;
    if (tag.length > 30) throw new Error(`A etiqueta “${tag.slice(0, 20)}…” passa de 30 caracteres.`);
    if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  if (tags.length > 12) throw new Error('Use no máximo 12 etiquetas por cliente.');
  return tags;
}

/**
 * @typedef {Object} ContactInput
 * @property {string} customerId
 * @property {string} name
 * @property {string | null} role
 * @property {string | null} phone
 * @property {string | null} email
 * @property {boolean} isPrimary
 */

/** Pessoa de contato do cliente (espelho de customer_contacts). @param {Record<string, any>} input @returns {ContactInput} */
export function normalizeContact(input) {
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) throw new Error('O nome do contato precisa ter entre 2 e 120 caracteres.');
  const email = optional(input.email)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido.');
  const phone = optional(input.phone);
  if (phone && phone.length > 30) throw new Error('Telefone muito longo.');
  const role = optional(input.role);
  if (role && role.length > 80) throw new Error('Cargo muito longo.');
  if (!input.customerId) throw new Error('Escolha o cliente.');
  return { customerId: String(input.customerId), name, role, phone, email, isPrimary: input.isPrimary === true || input.isPrimary === 'on' || input.isPrimary === 'true' };
}

/** Link do WhatsApp a partir de um telefone brasileiro (sem DDI, assume 55). */
export function whatsappLink(/** @type {string | null} */ phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`;
}

/**
 * Telefone para falar com o cliente: o do contato principal, senão o de outro contato, senão o da ficha.
 * @param {{ id: string, phone: string | null }} customer
 * @param {{ customerId: string, isPrimary: boolean, phone: string | null }[]} contacts
 */
export function primaryPhone(customer, contacts) {
  const mine = contacts.filter((c) => c.customerId === customer.id && c.phone);
  return mine.find((c) => c.isPrimary)?.phone ?? mine[0]?.phone ?? customer.phone ?? null;
}
