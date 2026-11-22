// Regras do DUM Analytics (espelho de track_event na migration 0011).

export const EVENT_NAME = /^[a-z0-9_.:-]{1,64}$/;
export const PERIODS = /** @type {const} */ ([
  { key: '7', label: '7 dias' },
  { key: '30', label: '30 dias' },
  { key: '90', label: '90 dias' },
]);

/** Valida um evento como o banco faz. @param {string} event @param {unknown} props */
export function checkEvent(event, props) {
  const name = String(event ?? '').trim().toLowerCase();
  if (!EVENT_NAME.test(name)) throw new Error('Nome de evento inválido: use letras minúsculas, números, _ . : - (até 64).');
  const bag = props && typeof props === 'object' && !Array.isArray(props) ? props : {};
  if (JSON.stringify(bag).length > 2048) throw new Error('Propriedades do evento passam de 2 KB.');
  return { name, props: bag };
}

/** Data local (AAAA-MM-DD) de um instante. @param {string | number | Date} value */
export const localDay = (value) => new Date(value).toLocaleDateString('sv-SE');

/**
 * Série diária completa (dias sem evento entram com zero), somando os produtos.
 * @param {{ day: string, events: number }[]} rows
 * @param {number} days
 * @param {number} [now]
 */
export function dailySeries(rows, days, now = Date.now()) {
  /** @type {Map<string, number>} */
  const byDay = new Map();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.events);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = localDay(now - i * 864e5);
    out.push({ day, events: byDay.get(day) ?? 0 });
  }
  return out;
}

/**
 * Trecho de código para colar no produto que vai enviar eventos.
 * @param {{ url: string, anonKey: string, key: string }} o
 */
export const trackingSnippet = ({ url, anonKey, key }) => `// Envia um evento de uso para o DUM Analytics (sem bibliotecas).
function dumTrack(evento, propriedades = {}, clienteId = null) {
  return fetch('${url}/rest/v1/rpc/track_event', {
    method: 'POST',
    headers: { apikey: '${anonKey}', 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: '${key}', p_event: evento, p_props: propriedades, p_client: clienteId }),
  }).catch(() => {}); // nunca atrapalhar o produto se a coleta falhar
}

dumTrack('login', { plano: 'pro' }, 'id-anonimo-do-usuario');`;
