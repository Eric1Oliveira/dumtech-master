// Vencimento de domínio pelo RDAP (o registro público dos domínios): .br no Registro.br,
// .com/.net na Verisign. Os dois liberam CORS, então o navegador consulta direto ao digitar.

/** Domínio registrável a partir de um endereço (tira https://, www., caminho e subdomínio). @param {unknown} value */
export function registrableDomain(value) {
  const host = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#:].*$/, '')
    .replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  const labels = host.split('.');
  // .br de segundo nível (com.br, net.br, org.br, app.br…): o registrável tem 3 partes.
  const take = labels.at(-1) === 'br' && labels.length >= 3 && labels.at(-2).length <= 4 ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** @param {unknown} domain @returns {string | null} */
export function rdapUrl(domain) {
  const d = registrableDomain(domain);
  if (!d) return null;
  if (d.endsWith('.br')) return `https://rdap.registro.br/domain/${d}`;
  if (d.endsWith('.com')) return `https://rdap.verisign.com/com/v1/domain/${d}`;
  if (d.endsWith('.net')) return `https://rdap.verisign.com/net/v1/domain/${d}`;
  return null;
}

/** Data de expiração (AAAA-MM-DD) na resposta RDAP, ou null. @param {any} json */
export function rdapExpiration(json) {
  const event = (json?.events ?? []).find((/** @type {any} */ e) => e?.eventAction === 'expiration');
  return event?.eventDate ? String(event.eventDate).slice(0, 10) : null;
}

/**
 * Busca o vencimento. null = domínio sem suporte, não encontrado ou registro sem data.
 * @param {unknown} domain
 * @param {(url: string, init: RequestInit) => Promise<Response>} [fetcher]
 */
export async function lookupExpiration(domain, fetcher = (url, init) => fetch(url, init)) {
  const url = rdapUrl(domain);
  if (!url) return null;
  try {
    const res = await fetcher(url, { headers: { Accept: 'application/rdap+json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return rdapExpiration(await res.json());
  } catch {
    return null;
  }
}
