// O que fica neste celular: só a identidade do aparelho (id + segredo) e, enquanto aberto, a
// sessão. Nenhum dado da empresa é guardado aqui. Digital = WebAuthn com a chave no próprio
// celular; avisos = Web Push pelo sw.js.

const DEVICE_KEY = 'dum.mobile.device';
const SESSION_KEY = 'dum.mobile.session';
const PUSH_KEY = 'dum.mobile.push';

/** @typedef {{ id: string, secret: string, name: string, org: string, user: string, bio: boolean, credential: string | null }} Device */

/** @param {ArrayBuffer | Uint8Array} bytes */
export function b64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} text */
export function fromB64u(text) {
  const s = String(text).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** @returns {Device | null} */
export function loadDevice() {
  try {
    const d = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null');
    return d?.id && d?.secret ? d : null;
  } catch {
    return null;
  }
}
export const saveDevice = (/** @type {Device} */ d) => localStorage.setItem(DEVICE_KEY, JSON.stringify(d));
export function forgetDevice() {
  localStorage.removeItem(DEVICE_KEY);
  localStorage.removeItem(PUSH_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

export const getSession = () => sessionStorage.getItem(SESSION_KEY);
export const setSession = (/** @type {string} */ s) => sessionStorage.setItem(SESSION_KEY, s);
export const clearSession = () => sessionStorage.removeItem(SESSION_KEY);

/** Nome sugerido para o celular (o modelo, quando o Chrome conta). */
export async function suggestedName() {
  try {
    const ua = /** @type {any} */ (navigator).userAgentData;
    if (ua?.getHighEntropyValues) {
      const { model } = await ua.getHighEntropyValues(['model']);
      if (model) return String(model).slice(0, 60);
    }
  } catch {
    /* sem o modelo */
  }
  return /android/i.test(navigator.userAgent) ? 'Android' : /iphone|ipad/i.test(navigator.userAgent) ? 'iPhone' : 'Celular';
}

// Digital (WebAuthn) ------------------------------------------------------------------------------

/** O celular tem digital (ou outro desbloqueio do próprio aparelho) para o app usar? */
export async function bioAvailable() {
  try {
    const pk = /** @type {any} */ (window).PublicKeyCredential;
    return Boolean(pk && (await pk.isUserVerifyingPlatformAuthenticatorAvailable()));
  } catch {
    return false;
  }
}

/** Cadastra a digital: cria uma chave neste celular e devolve a parte pública. */
export async function createCredential(/** @type {string} */ label) {
  const cred = /** @type {any} */ (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'DUM Celular', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: label, displayName: label },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none',
      timeout: 60000,
    },
  }));
  const spki = cred?.response?.getPublicKey?.();
  if (!spki || cred.response.getPublicKeyAlgorithm?.() !== -7) throw new Error('Este celular não deixou usar a digital no app. Siga com o PIN.');
  return { id: b64u(cred.rawId), publicKey: b64u(spki) };
}

/** Pede a digital e devolve a assinatura do desafio do servidor. */
export async function signChallenge(/** @type {string} */ challenge, /** @type {string} */ credentialId) {
  const a = /** @type {any} */ (await navigator.credentials.get({
    publicKey: {
      challenge: fromB64u(challenge),
      allowCredentials: [{ type: 'public-key', id: fromB64u(credentialId), transports: ['internal'] }],
      userVerification: 'required',
      rpId: location.hostname,
      timeout: 60000,
    },
  }));
  return {
    authenticatorData: b64u(a.response.authenticatorData),
    clientDataJSON: b64u(a.response.clientDataJSON),
    signature: b64u(a.response.signature),
  };
}

// Avisos (Web Push) -------------------------------------------------------------------------------

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
/** O que a pessoa escolheu neste celular: 'on', 'off' ou null (ainda não escolheu). */
export const pushIntent = () => localStorage.getItem(PUSH_KEY);
export const setPushIntent = (/** @type {'on' | 'off'} */ v) => localStorage.setItem(PUSH_KEY, v);

/** Registro do sw.js (no máximo 4 s de espera: sem https não há worker). */
async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  return Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 4000))]);
}

export async function currentSubscription() {
  const reg = /** @type {ServiceWorkerRegistration | null} */ (await registration());
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Pede a permissão (precisa de um toque) e inscreve o celular. @param {string} vapidKey */
export async function subscribe(vapidKey) {
  const reg = /** @type {ServiceWorkerRegistration | null} */ (await registration());
  if (!reg) throw new Error('Este navegador não deixou instalar a parte que recebe os avisos. Abra pelo Chrome.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('O Android não deixou o DUM mostrar avisos. Em Configurações › Apps › Chrome (ou DUM Celular) › Notificações, permita e tente de novo.');
  }
  const key = fromB64u(vapidKey);
  let sub = await reg.pushManager.getSubscription();
  const same = sub?.options?.applicationServerKey && b64u(/** @type {ArrayBuffer} */ (sub.options.applicationServerKey)) === b64u(key);
  if (sub && !same) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return sub;
}

export async function unsubscribe() {
  const sub = await currentSubscription();
  if (sub) await sub.unsubscribe();
}

/** @param {PushSubscription} sub */
export function subscriptionPayload(sub) {
  const j = /** @type {any} */ (sub.toJSON());
  return { endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth };
}
