// Criptografia do cofre pessoal — Web Crypto nativa do navegador (sem algoritmo próprio, sem biblioteca).
//   Chave:  PBKDF2-SHA-256, 600 mil iterações (recomendação OWASP), sal aleatório de 16 bytes por cofre (pessoa)
//   Cifra:  AES-256-GCM, IV aleatório de 12 bytes por gravação
//   AAD:    organização + id do segredo — um cifrado não pode ser trocado de lugar com outro
// A frase-mestra e a chave derivada ficam só na memória desta aba; o servidor guarda sal,
// verificador e cifrados.

export const KDF_ITERATIONS = 600_000;
const CHECK = 'dum-vault-v1';
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

/** @param {ArrayBuffer | Uint8Array} bytes */
export function toB64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}
/** @param {string} text */
export const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const random = (/** @type {number} */ n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** @typedef {{ iv: string, cipher: string }} Box */
/** @typedef {{ iterations: number, salt: string, checkIv: string, checkCipher: string, publicKey?: string | null, keyIv?: string | null, keyCipher?: string | null }} VaultSettings */

export const checkAad = (/** @type {string} */ orgId) => `dum-vault-check:${orgId}`;
export const itemAad = (/** @type {string} */ orgId, /** @type {string} */ id) => `dum-vault-item:${orgId}:${id}`;

/**
 * @param {string} passphrase
 * @param {string} saltB64
 * @param {number} iterations
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKey(passphrase, saltB64, iterations) {
  const base = await subtle().importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** @param {CryptoKey} key @param {unknown} value @param {string} aad @returns {Promise<Box>} */
export async function seal(key, value, aad) {
  const iv = random(12);
  const cipher = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(value)));
  return { iv: toB64(iv), cipher: toB64(cipher) };
}

/** @param {CryptoKey} key @param {Box} box @param {string} aad @returns {Promise<any>} */
export async function unseal(key, box, aad) {
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(box.iv), additionalData: enc.encode(aad) }, key, fromB64(box.cipher));
  return JSON.parse(dec.decode(plain));
}

/** Regra mínima da frase-mestra. @param {string} passphrase @returns {string | null} erro */
export function passphraseProblem(passphrase) {
  const p = passphrase.trim();
  if (p.length < 12) return 'Use pelo menos 12 caracteres (uma frase com 4 ou mais palavras é ótima).';
  if (/^(.)\1+$/.test(p)) return 'Evite repetir o mesmo caractere.';
  return null;
}

/**
 * Cria o cofre: sal novo, chave e verificador (cifra de um texto conhecido).
 * @param {string} passphrase
 * @param {string} orgId
 * @returns {Promise<{ settings: VaultSettings, key: CryptoKey }>}
 */
export async function createVault(passphrase, orgId) {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new Error(problem);
  const salt = toB64(random(16));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
  const check = await seal(key, CHECK, checkAad(orgId));
  return { settings: { iterations: KDF_ITERATIONS, salt, checkIv: check.iv, checkCipher: check.cipher }, key };
}

/**
 * Abre o cofre: deriva a chave e confere no verificador.
 * @param {string} passphrase
 * @param {VaultSettings} settings
 * @param {string} orgId
 */
export async function unlockVault(passphrase, settings, orgId) {
  const key = await deriveKey(passphrase, settings.salt, settings.iterations);
  try {
    if ((await unseal(key, { iv: settings.checkIv, cipher: settings.checkCipher }, checkAad(orgId))) === CHECK) return key;
  } catch {
    /* frase errada: o GCM recusa */
  }
  throw new Error('Frase-mestra incorreta.');
}

/** Senha forte aleatória (20 caracteres, sem os ambíguos). */
export function strongPassword(length = 20) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_!@#%+=';
  const limit = 256 - (256 % chars.length);
  let out = '';
  while (out.length < length) {
    for (const b of random(length * 2)) {
      if (b < limit && out.length < length) out += chars[b % chars.length];
    }
  }
  return out;
}

// Compartilhamento entre cofres ------------------------------------------------------------------
// Cada cofre tem um par de chaves ECDH P-256. A pública fica aberta para a equipe; a privada fica
// cifrada pela chave do cofre (AES-256-GCM). Compartilhar = cifrar uma cópia para a pública de quem
// recebe: chave efêmera ECDH → HKDF-SHA-256 → AES-256-GCM, com AAD ligando cópia, segredo e pessoa.

const ECDH = /** @type {const} */ ({ name: 'ECDH', namedCurve: 'P-256' });
const SHARE_SALT = enc.encode('dum-vault-share-v1');

export const keyAad = (/** @type {string} */ orgId, /** @type {string} */ userId) => `dum-vault-key:${orgId}:${userId}`;
export const shareAad = (/** @type {string} */ orgId, /** @type {string} */ itemId, /** @type {string} */ recipientId) =>
  `dum-vault-share:${orgId}:${itemId}:${recipientId}`;

/** @typedef {{ publicKey: string, keyIv: string, keyCipher: string }} VaultKeys   pública (spki) + privada cifrada */
/** @typedef {{ epk: string, iv: string, cipher: string }} SharedBox */

/**
 * Par de chaves novo, com a privada cifrada pela chave do cofre.
 * @param {CryptoKey} vaultKey @param {string} orgId @param {string} userId
 * @returns {Promise<{ keys: VaultKeys, privateKey: CryptoKey }>}
 */
export async function createKeyPair(vaultKey, orgId, userId) {
  const pair = /** @type {CryptoKeyPair} */ (await subtle().generateKey(ECDH, true, ['deriveBits']));
  const publicKey = toB64(await subtle().exportKey('spki', pair.publicKey));
  const pkcs8 = toB64(await subtle().exportKey('pkcs8', pair.privateKey));
  const box = await seal(vaultKey, { pkcs8 }, keyAad(orgId, userId));
  return { keys: { publicKey, keyIv: box.iv, keyCipher: box.cipher }, privateKey: await importPrivate(pkcs8) };
}

/** @param {string} pkcs8 */
const importPrivate = (pkcs8) => subtle().importKey('pkcs8', fromB64(pkcs8), ECDH, false, ['deriveBits']);
/** @param {string} spki */
const importPublic = (spki) => subtle().importKey('spki', fromB64(spki), ECDH, false, []);

/**
 * Abre a chave privada do cofre (para ler o que foi compartilhado com a pessoa).
 * @param {CryptoKey} vaultKey @param {{ keyIv: string, keyCipher: string }} keys @param {string} orgId @param {string} userId
 */
export async function openPrivateKey(vaultKey, keys, orgId, userId) {
  const { pkcs8 } = await unseal(vaultKey, { iv: keys.keyIv, cipher: keys.keyCipher }, keyAad(orgId, userId));
  return importPrivate(pkcs8);
}

/** Troca de frase-mestra: recifra a chave privada com a chave nova (a pública não muda). */
export async function rewrapPrivateKey(/** @type {CryptoKey} */ oldKey, /** @type {CryptoKey} */ newKey, /** @type {{ keyIv: string, keyCipher: string }} */ keys, /** @type {string} */ orgId, /** @type {string} */ userId) {
  const value = await unseal(oldKey, { iv: keys.keyIv, cipher: keys.keyCipher }, keyAad(orgId, userId));
  const box = await seal(newKey, value, keyAad(orgId, userId));
  return { keyIv: box.iv, keyCipher: box.cipher };
}

/** Chave AES de uma cópia: ECDH entre as duas pontas → HKDF com o AAD como info. */
async function shareKey(/** @type {CryptoKey} */ privateKey, /** @type {CryptoKey} */ publicKey, /** @type {string} */ aad) {
  const bits = await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const base = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SHARE_SALT, info: enc.encode(aad) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * Cifra uma cópia para a chave pública de quem recebe (só a privada dele abre).
 * @param {string} recipientPublicKey spki em base64 @param {unknown} value @param {string} aad
 * @returns {Promise<SharedBox>}
 */
export async function sealFor(recipientPublicKey, value, aad) {
  const eph = /** @type {CryptoKeyPair} */ (await subtle().generateKey(ECDH, true, ['deriveBits']));
  const key = await shareKey(eph.privateKey, await importPublic(recipientPublicKey), aad);
  const box = await seal(key, value, aad);
  return { epk: toB64(await subtle().exportKey('spki', eph.publicKey)), ...box };
}

/** Abre uma cópia recebida com a chave privada do próprio cofre. @param {CryptoKey} privateKey @param {SharedBox} box @param {string} aad */
export async function openShared(privateKey, box, aad) {
  const key = await shareKey(privateKey, await importPublic(box.epk), aad);
  return unseal(key, { iv: box.iv, cipher: box.cipher }, aad);
}
