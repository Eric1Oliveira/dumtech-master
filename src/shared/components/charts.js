// Gráficos do "No ar" em HTML/SVG próprio (a CSP só permite scripts locais; nada de biblioteca).
// Faixa de 24 h (estado por bloco, com texto em cada bloco — nunca só cor) e linha do tempo de
// resposta (uma série; 7/30 dias com faixa até o p95), com cruz e dica ao passar o mouse.

import { html, setHtml } from '../utils/dom.js';

/** @typedef {{ start: number, end: number, state: 'none' | 'ok' | 'slow' | 'fail', checks: number, fails: number }} Block */

const BLOCK_TEXT = {
  none: () => 'sem verificação',
  ok: (/** @type {Block} */ b) => `no ar · ${b.checks} verificaç${b.checks === 1 ? 'ão' : 'ões'}`,
  slow: (/** @type {Block} */ b) => `lento · ${b.checks} verificaç${b.checks === 1 ? 'ão' : 'ões'}`,
  fail: (/** @type {Block} */ b) => `${b.fails} falha${b.fails === 1 ? '' : 's'} em ${b.checks}`,
};

/**
 * Faixa de blocos (o mais antigo à esquerda).
 * @param {Block[]} list @param {(t: number) => string} time
 */
export function uptimeStrip(list, time) {
  const fails = list.filter((b) => b.state === 'fail').length;
  const slow = list.filter((b) => b.state === 'slow').length;
  const label = `Últimas 24 horas: ${fails ? `${fails} período(s) com falha` : 'sem falhas'}${slow ? `, ${slow} lento(s)` : ''}.`;
  return html`<div class="ustrip" role="img" aria-label="${label}">
    ${list.map((b) => html`<span class="ustrip__b ustrip__b--${b.state}" title="${time(b.start)}–${time(b.end)} · ${BLOCK_TEXT[b.state](b)}"></span>`)}
  </div>
  <div class="ustrip__axis" aria-hidden="true"><span>24 h atrás</span><span>agora</span></div>`;
}

/** Topo "redondo" do eixo (250, 500, 1.000, 2.000 ms…). @param {number} v */
function niceMax(v) {
  const steps = [100, 250, 500, 1000, 2000, 3000, 5000, 10000, 20000];
  return steps.find((s) => s >= v * 1.1) ?? Math.ceil(v / 10000) * 10000;
}
const msText = (/** @type {number} */ v) => (v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : `${Math.round(v)} ms`);

/**
 * Desenha o tempo de resposta no slot e liga a dica do mouse.
 * @param {HTMLElement} slot
 * @param {{ t: number, value: number, high?: number }[]} points
 * @param {{ label: string, time: (t: number) => string, slowMs?: number }} options
 */
export function drawLineChart(slot, points, { label, time, slowMs }) {
  if (points.length < 2) {
    setHtml(slot, html`<p class="chart-empty">${points.length ? 'Uma verificação só até agora. O gráfico aparece com mais pontos.' : 'Sem verificações neste período.'}</p>`);
    return;
  }
  const W = Math.max(280, Math.round(slot.clientWidth || 600));
  const H = 168;
  const L = 48;
  const R = 10;
  const T = 10;
  const B = 22;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const peak = Math.max(...points.map((p) => p.high ?? p.value));
  const max = niceMax(slowMs && slowMs < peak * 1.6 ? Math.max(peak, slowMs) : peak);
  const x = (/** @type {number} */ t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = (/** @type {number} */ v) => T + (1 - Math.min(v, max) / max) * (H - T - B);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const band = points.some((p) => p.high !== undefined)
    ? `${points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.high ?? p.value).toFixed(1)}`).join('')}${[...points].reverse().map((p) => `L${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join('')}Z`
    : '';
  const grid = [0, max / 2, max];
  const slow = slowMs && slowMs <= max ? y(slowMs) : null;

  setHtml(
    slot,
    html`<svg class="chart__svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}">
        ${grid.map((v) => html`<line class="chart__grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"></line>
          <text class="chart__tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${msText(v)}</text>`)}
        ${slow !== null ? html`<line class="chart__slow" x1="${L}" x2="${W - R}" y1="${slow}" y2="${slow}"></line>
          <text class="chart__tick chart__tick--slow" x="${W - R}" y="${slow - 4}" text-anchor="end">lento</text>` : ''}
        ${band ? html`<path class="chart__band" d="${band}"></path>` : ''}
        <path class="chart__line" d="${line}"></path>
        <text class="chart__tick" x="${L}" y="${H - 6}">${time(t0)}</text>
        <text class="chart__tick" x="${W - R}" y="${H - 6}" text-anchor="end">${time(t1)}</text>
        <line class="chart__cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"></line>
        <circle class="chart__dot" r="4" cx="0" cy="0" visibility="hidden"></circle>
        <rect class="chart__hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"></rect>
      </svg>
      <div class="chart__tip" role="status" hidden></div>`,
  );

  const svg = /** @type {SVGSVGElement} */ (slot.querySelector('svg'));
  const cross = /** @type {SVGLineElement} */ (svg.querySelector('.chart__cross'));
  const dot = /** @type {SVGCircleElement} */ (svg.querySelector('.chart__dot'));
  const tip = /** @type {HTMLElement} */ (slot.querySelector('.chart__tip'));
  const hit = /** @type {SVGRectElement} */ (svg.querySelector('.chart__hit'));
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  hit.addEventListener('pointermove', (event) => {
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const t = t0 + ((px - L) / (W - L - R)) * (t1 - t0);
    let lo = 0;
    let hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t < t) lo = mid;
      else hi = mid;
    }
    const p = Math.abs(points[lo].t - t) <= Math.abs(points[hi].t - t) ? points[lo] : points[hi];
    const cx = x(p.t);
    cross.setAttribute('x1', String(cx));
    cross.setAttribute('x2', String(cx));
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(y(p.value)));
    dot.setAttribute('visibility', 'visible');
    tip.textContent = `${time(p.t)} · ${msText(p.value)}${p.high !== undefined ? ` (p95 ${msText(p.high)})` : ''}`;
    tip.hidden = false;
    const left = (cx / W) * box.width;
    tip.style.left = `${Math.min(Math.max(left, 70), box.width - 70)}px`;
  });
  hit.addEventListener('pointerleave', hide);
}
