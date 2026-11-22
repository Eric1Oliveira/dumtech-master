// "No ar" na tela: estado, causa em português, disponibilidade, faixa de 24 h e tempo de resposta.
// Regras puras (o banco decide o estado em monitor_record; aqui só se resume o histórico).

/** @typedef {{ checkedAt: string, ok: boolean, code: number | null, msTotal: number | null, msConnect?: number | null, cause: string | null }} Check */
/** @typedef {{ hour: string, checks: number, ok: number, slow: number, msAvg: number | null, msP95: number | null, msMax: number | null }} Hourly */

export const STATE = /** @type {const} */ ({
  unknown: { label: 'Aguardando', tone: 'info' },
  up: { label: 'No ar', tone: 'ok' },
  slow: { label: 'Lento', tone: 'warn' },
  unstable: { label: 'Instável', tone: 'warn' },
  down: { label: 'Fora do ar', tone: 'error' },
});

/** Igual a public.monitor_cause_text. @param {string | null} cause @param {number | null} [code] */
export function causeText(cause, code = null) {
  switch (cause) {
    case 'timeout': return 'Não respondeu em 10 segundos';
    case 'dns': return 'Endereço não encontrado (DNS)';
    case 'refused': return 'Conexão recusada pelo servidor';
    case 'tls': return 'Problema no HTTPS (certificado)';
    case 'redirects': return 'Redirecionamento em excesso';
    case 'no_response': return 'Sem resposta';
    case 'http':
      if (code !== null && code >= 500 && code <= 599) return `Erro do servidor (HTTP ${code})`;
      if (code === 404) return 'Página não encontrada (HTTP 404)';
      return `Resposta inesperada (HTTP ${code ?? '?'})`;
    default: return 'Falha na verificação';
  }
}

/** Igual a public.duration_text. @param {number} ms */
export function durationText(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
  const days = Math.floor(min / 1440);
  return `${days} dia${days >= 2 ? 's' : ''}`;
}

/**
 * Disponibilidade (% de verificações ok) numa janela. Até 24 h usa o bruto; acima, soma as horas
 * agregadas e completa com o bruto das horas que ainda não foram agregadas.
 * @param {{ checks: Check[], hourly: Hourly[] }} history @param {number} hours @param {number} [now]
 * @returns {{ pct: number | null, total: number, ok: number }}
 */
export function uptime({ checks, hourly }, hours, now = Date.now()) {
  const from = now - hours * 3600e3;
  let total = 0;
  let ok = 0;
  let rawFrom = from;
  if (hours > 24) {
    const rows = hourly.filter((h) => Date.parse(h.hour) >= from);
    for (const h of rows) {
      total += h.checks;
      ok += h.ok;
    }
    const last = rows.reduce((max, h) => Math.max(max, Date.parse(h.hour) + 3600e3), from);
    rawFrom = last;
  }
  for (const c of checks) {
    const t = Date.parse(c.checkedAt);
    if (t >= rawFrom && t <= now) {
      total += 1;
      if (c.ok) ok += 1;
    }
  }
  return { pct: total ? Math.floor((ok / total) * 10000) / 100 : null, total, ok };
}

/** "99,95%" — sem casas quando é inteiro. @param {number | null} pct */
export const pctText = (pct) => (pct === null ? '—' : `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, '').replace('.', ',')}%`);

/**
 * Faixa de 24 h: blocos de 15 min com o pior resultado do bloco.
 * @param {Check[]} checks @param {number} slowMs @param {number} [now] @param {number} [count] @param {number} [size] ms por bloco
 * @returns {{ start: number, end: number, state: 'none' | 'ok' | 'slow' | 'fail', checks: number, fails: number }[]}
 */
export function blocks(checks, slowMs, now = Date.now(), count = 96, size = 15 * 60e3) {
  const end = Math.ceil(now / size) * size;
  const start = end - count * size;
  const out = Array.from({ length: count }, (_, i) => ({ start: start + i * size, end: start + (i + 1) * size, state: /** @type {'none' | 'ok' | 'slow' | 'fail'} */ ('none'), checks: 0, fails: 0 }));
  for (const c of checks) {
    const i = Math.floor((Date.parse(c.checkedAt) - start) / size);
    const b = out[i];
    if (!b) continue;
    b.checks += 1;
    if (!c.ok) {
      b.fails += 1;
      b.state = 'fail';
    } else if (b.state !== 'fail' && c.msTotal !== null && c.msTotal > slowMs) b.state = 'slow';
    else if (b.state === 'none') b.state = 'ok';
  }
  return out;
}

/** Média, p95, mínimo e máximo de uma lista de ms. @param {number[]} values */
export function msStats(values) {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return { avg: null, p95: null, min: null, max: null, count: 0 };
  const p95 = list[Math.min(list.length - 1, Math.ceil(list.length * 0.95) - 1)];
  return { avg: Math.round(list.reduce((s, v) => s + v, 0) / list.length), p95, min: list[0], max: list[list.length - 1], count: list.length };
}

/**
 * Pontos do gráfico de tempo de resposta.
 * 24 h: cada verificação ok (ms total). 7 d/30 d: média e p95 por hora.
 * @param {{ checks: Check[], hourly: Hourly[] }} history @param {'24h' | '7d' | '30d'} range @param {number} [now]
 * @returns {{ t: number, value: number, high?: number }[]}
 */
export function responseSeries({ checks, hourly }, range, now = Date.now()) {
  if (range === '24h') {
    const from = now - 24 * 3600e3;
    return checks
      .filter((c) => c.ok && c.msTotal !== null && Date.parse(c.checkedAt) >= from)
      .map((c) => ({ t: Date.parse(c.checkedAt), value: /** @type {number} */ (c.msTotal) }))
      .sort((a, b) => a.t - b.t);
  }
  const from = now - (range === '7d' ? 7 : 30) * 24 * 3600e3;
  return hourly
    .filter((h) => h.msAvg !== null && Date.parse(h.hour) >= from)
    .map((h) => ({ t: Date.parse(h.hour), value: /** @type {number} */ (h.msAvg), high: h.msP95 ?? undefined }))
    .sort((a, b) => a.t - b.t);
}
