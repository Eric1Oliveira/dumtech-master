// No ar no celular: cada site, banco e serviço vigiado (problemas primeiro), tempo da última
// resposta, disponibilidade em 24 h e 30 dias, e as quedas dos últimos 30 dias.

import { html } from '../../shared/utils/dom.js';
import { formatRelative, formatDateTime } from '../../shared/utils/format.js';
import { causeText, durationText, pctText } from '../../core/monitor.js';
import { pct } from '../model.js';
import { empty, section, list, row, monitorPill, monitorTone, dot, host } from '../ui.js';

const ORDER = /** @type {Record<string, number>} */ ({ down: 0, unstable: 1, slow: 2, unknown: 3, up: 4 });

export default {
  title: () => 'No ar',
  /** @param {import('../model.js').Model} m */
  render(m) {
    if (!m.can('infra.view') && !m.can('products.view')) return empty('Sem acesso ao No ar', 'Seu papel nesta organização não inclui o monitoramento.');
    if (!m.monitors.length) return empty('Nada sendo verificado', 'No computador, ligue o “No ar” no projeto ou no serviço.');
    const on = m.monitors.filter((x) => x.enabled).sort((a, b) => (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3) || a.name.localeCompare(b.name, 'pt-BR'));
    const paused = m.monitors.filter((x) => !x.enabled);
    const down = on.filter((x) => x.state === 'down').length;
    const shaky = on.filter((x) => x.state === 'slow' || x.state === 'unstable').length;
    const up = on.filter((x) => x.state === 'up').length;
    const lead = down ? `${down} fora do ar` : shaky ? `${shaky} oscilando` : 'Tudo no ar';
    const nameOf = new Map(m.monitors.map((x) => [x.id, x.name]));

    const item = (/** @type {any} */ x) => {
      const u = m.uptime.get(x.id);
      const day = u ? pct(Number(u.dayOk), Number(u.dayChecks)) : null;
      const month = u ? pct(Number(u.monthOk), Number(u.monthChecks)) : null;
      return row({
        href: x.productId ? `#/projetos/${x.productId}` : null,
        lead: dot(monitorTone(x)),
        title: x.name,
        sub: html`${host(x.target) || 'sem endereço'}<br>24 h ${pctText(day)} · 30 dias ${pctText(month)}`,
        end: monitorPill(x),
        endSub: x.lastCheckAt ? html`${x.lastMs ? `${x.lastMs} ms · ` : ''}${formatRelative(x.lastCheckAt)}` : 'aguardando',
      });
    };

    return html`
      <div class="m-verdict m-verdict--${down ? 'error' : shaky ? 'warn' : 'ok'}">
        <p class="m-verdict__eyebrow">${on.length} ${on.length === 1 ? 'endereço verificado' : 'endereços verificados'} pelo servidor</p>
        <p class="m-verdict__text">${lead}${!down && !shaky ? '.' : html`<span class="m-verdict__rest"> · ${up} no ar</span>`}</p>
      </div>
      ${section('Agora', list(on.map(item)))}
      ${paused.length ? section('Pausados', list(paused.map(item))) : ''}
      ${section('Quedas nos últimos 30 dias', m.incidents.length
        ? list(m.incidents.map((i) => row({
            lead: dot(i.endedAt ? 'muted' : 'error'),
            title: nameOf.get(i.monitorId) ?? 'Monitor',
            sub: `${formatDateTime(i.startedAt)} · ${causeText(i.cause, i.code)}`,
            end: i.endedAt ? durationText(Date.parse(i.endedAt) - Date.parse(i.startedAt)) : 'ainda fora',
            t: i.endedAt ? '' : 'error',
          })))
        : empty('Nenhuma queda', 'Nenhum site ou serviço ficou fora do ar nos últimos 30 dias.'))}`;
  },
};
