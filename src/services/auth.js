// Sessão: usuário logado + organização ativa. Telas usam estas funções,
// nunca o backend de autenticação direto.

import { data } from './data.js';
import { getState, setState, uiPrefs } from '../core/state.js';
import { events } from '../core/events.js';
import { can } from '../core/permissions.js';

export async function restoreSession() {
  const user = await data.auth.getUser();
  setState({ user });
  return user;
}

/** @param {import('./data.js').SignInInput} input */
export async function signIn(input) {
  const { user } = await data.auth.signIn(input);
  setState({ user });
  events.emit('session:changed');
  return user;
}

/** @param {import('./data.js').SignInInput} input */
export async function signUp(input) {
  const result = await data.auth.signUp(input);
  if (result.user) {
    setState({ user: result.user });
    events.emit('session:changed');
  }
  return result;
}

export async function signOut() {
  await data.auth.signOut();
  setState({ user: null, orgs: [], org: null });
  events.emit('session:changed');
}

/** @param {string} email */
export const requestPasswordReset = (email) => data.auth.requestPasswordReset(email);

/** @param {string} password */
export const updatePassword = (password) => data.auth.updatePassword(password);

/** Carrega as organizações do usuário e escolhe a ativa (última usada neste navegador). */
export async function loadOrganizations() {
  const { user, org: current } = getState();
  const orgs = await data.orgs.listMine();
  const preferred = current?.id ?? uiPrefs.get(`org.${user?.id}`);
  setState({ orgs, org: orgs.find((o) => o.id === preferred) ?? orgs[0] ?? null });
  return orgs;
}

/** @param {string} orgId */
export function switchOrganization(orgId) {
  const { orgs, user } = getState();
  const org = orgs.find((o) => o.id === orgId);
  if (!org || org.id === getState().org?.id) return;
  uiPrefs.set(`org.${user?.id}`, org.id);
  setState({ org });
  events.emit('org:changed', org);
}

/** @param {string} name */
export async function createOrganization(name) {
  const created = await data.orgs.create(name);
  await loadOrganizations();
  switchOrganization(created.id);
  return created;
}

// Convites ---------------------------------------------------------------------------
// O link (#/convite/<código>) pode ser aberto antes de a pessoa ter conta. O código fica
// guardado nesta aba até o login; depois é aceito uma única vez e descartado.

const INVITE_KEY = 'dum.invite';
const INVITE_ROUTE = /^#\/convite\/([0-9a-f]{64})$/;

/** @param {string} token */
export const inviteLink = (token) => `${location.origin}${location.pathname}#/convite/${token}`;

export const isInviteUrl = () => INVITE_ROUTE.test(location.hash);

/** Guarda o código do link aberto e tira ele da barra de endereço. */
/** @type {string | null} sem sessionStorage, o convite vale só nesta carga da página */
let inviteInMemory = null;

export function captureInviteFromUrl() {
  const match = location.hash.match(INVITE_ROUTE);
  if (!match) return;
  inviteInMemory = match[1];
  try {
    sessionStorage.setItem(INVITE_KEY, match[1]);
  } catch {
    /* fica só na memória */
  }
  history.replaceState(null, '', `${location.pathname}${location.search}#/dashboard`);
}

export function pendingInvite() {
  try {
    return sessionStorage.getItem(INVITE_KEY) ?? inviteInMemory;
  } catch {
    return inviteInMemory;
  }
}

export function discardInvite() {
  inviteInMemory = null;
  try {
    sessionStorage.removeItem(INVITE_KEY);
  } catch {
    /* nada a limpar */
  }
}

/**
 * Aceita o convite pendente com a conta logada e torna a organização dele a ativa.
 * @returns {Promise<{ orgId: string, orgName: string } | null>}
 */
export async function acceptPendingInvite() {
  const token = pendingInvite();
  if (!token) return null;
  discardInvite();
  const joined = await data.invites.accept(token);
  uiPrefs.set(`org.${getState().user?.id}`, joined.orgId);
  setState({ org: null });
  return joined;
}

/** A pessoa logada pode fazer isto na organização ativa? */
export const canDo = (/** @type {string} */ permission) => can(getState().org?.role, permission);
