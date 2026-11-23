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

// Horário do "No ar" -------------------------------------------------------------------------
// Dias: 0 = domingo … 6 = sábado. Sem faixa (from/to nulos) = o dia inteiro. Faixa que passa da
// meia-noite (18h às 2h) vale para o dia em que começa. Igual a public.monitor_in_window (Brasília).

/** @typedef {{ checkDays?: number[] | null, checkFrom?: string | null, checkTo?: string | null }} Schedule */

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Horários prontos para escolher na tela. */
export const SCHEDULE_PRESETS = [
  { id: 'always', label: 'O dia todo, todo dia', checkDays: ALL_DAYS, checkFrom: null, checkTo: null },
  { id: 'business', label: 'Comercial: seg a sex, 8h às 18h', checkDays: [1, 2, 3, 4, 5], checkFrom: '08:00', checkTo: '18:00' },
  { id: 'shop', label: 'Comércio: seg a sáb, 8h às 22h', checkDays: [1, 2, 3, 4, 5, 6], checkFrom: '08:00', checkTo: '22:00' },
  { id: 'night', label: 'Noite (restaurante): todo dia, 17h às 2h', checkDays: ALL_DAYS, checkFrom: '17:00', checkTo: '02:00' },
];

/** "08:00:00" → "08:00"; vazio → null. @param {unknown} v */
const hhmm = (v) => {
  const m = String(v ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
};
/** @param {string} t "HH:MM" */
const minutesOf = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Valida o horário do formulário. @param {Record<string, any>} input @returns {{ checkDays: number[], checkFrom: string | null, checkTo: string | null }} */
export function normalizeSchedule(input) {
  const raw = Array.isArray(input.checkDays) ? input.checkDays : ALL_DAYS;
  const days = [...new Set(raw.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (!days.length) throw new Error('Escolha pelo menos um dia da semana.');
  const from = hhmm(input.checkFrom);
  const to = hhmm(input.checkTo);
  if (Boolean(from) !== Boolean(to)) throw new Error('Informe o início e o fim do horário (ou deixe os dois vazios para o dia todo).');
  if (from && from === to) throw new Error('O início e o fim do horário não podem ser iguais.');
  return { checkDays: days, checkFrom: from, checkTo: to };
}

/** @param {Schedule} s */
const daysOf = (s) => (Array.isArray(s.checkDays) && s.checkDays.length ? s.checkDays : ALL_DAYS);

/** Dia da semana e minuto do dia em Brasília. @param {number} now */
function brasilia(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), min: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** O servidor está verificando agora? @param {Schedule} s @param {number} [now] */
export function inWindow(s, now = Date.now()) {
  const days = daysOf(s);
  const { dow, min } = brasilia(now);
  const from = hhmm(s.checkFrom);
  const to = hhmm(s.checkTo);
  if (!from || !to) return days.includes(dow);
  const a = minutesOf(from);
  const b = minutesOf(to);
  if (a < b) return days.includes(dow) && min >= a && min < b;
  return (days.includes(dow) && min >= a) || (days.includes((dow + 6) % 7) && min < b);
}

/** "08:00" → "8h"; "08:30" → "8h30". @param {string} t */
const hourText = (t) => `${Number(t.slice(0, 2))}h${t.slice(3, 5) === '00' ? '' : t.slice(3, 5)}`;

/** Horário em português: "todo dia, 24 h", "seg a sex, 8h às 18h", "seg, qua, sex, 9h às 12h". @param {Schedule} s */
export function scheduleText(s) {
  const days = daysOf(s);
  const from = hhmm(s.checkFrom);
  const to = hhmm(s.checkTo);
  let d;
  if (days.length === 7) d = 'todo dia';
  else {
    const sorted = [...days].sort();
    const run = sorted.every((x, i) => i === 0 || x === sorted[i - 1] + 1);
    d = run && sorted.length > 2 ? `${WEEKDAYS[sorted[0]].toLowerCase()} a ${WEEKDAYS[sorted[sorted.length - 1]].toLowerCase()}` : sorted.map((x) => WEEKDAYS[x].toLowerCase()).join(', ');
  }
  return from && to ? `${d}, ${hourText(from)} às ${hourText(to)}` : `${d}, 24 h`;
}

/** Verificações por mês (1 por minuto) — para mostrar a economia. @param {Schedule} s */
export function checksPerMonth(s) {
  const days = daysOf(s).length;
  const from = hhmm(s.checkFrom);
  const to = hhmm(s.checkTo);
  const perDay = from && to ? (minutesOf(to) - minutesOf(from) + 1440) % 1440 : 1440;
  return Math.round(((days * perDay) / 7) * 30.44);
}
