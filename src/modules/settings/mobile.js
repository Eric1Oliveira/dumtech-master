// Ajustes › App no celular: liga um celular pelo QR (uso único, 10 minutos), lista os aparelhos
// ligados, desliga e muda o limite (só o proprietário). O celular só vê, não edita: ele fala com a
// Edge Function `mobile`, nunca com o banco direto. Quem confere o limite e o QR é o servidor.

import { html, setHtml, $, bindActions, trusted } from '../../shared/utils/dom.js';
import { formatDateTime, formatRelative } from '../../shared/utils/format.js';
import { getState } from '../../core/state.js';
import { data } from '../../services/data.js';
import { dataTable } from '../../shared/components/table.js';
import { openDialog, confirmDialog } from '../../shared/components/dialog.js';
import { emptyState, loadError, toast, toastError } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';
import qrcode from '../../../assets/js/vendor/qrcode.mjs';

const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** Endereço do app do celular com o código (o "#" não vai para servidor nenhum). @param {string} code */
export const pairUrl = (code) => new URL(`m/#/parear/${code}`, location.href.split('#')[0]).href;

/** QR preto no branco (com a margem que as câmeras pedem), em SVG. @param {string} text */
function qrSvg(text) {
  const qr = /** @type {any} */ (qrcode)(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return trusted(`<svg class="pair__qr" viewBox="-4 -4 ${n + 8} ${n + 8}" shape-rendering="crispEdges" role="img" aria-label="QR code para ligar o celular"><rect x="-4" y="-4" width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${d}" fill="#111"/></svg>`);
}

/** @param {import('../index.js').ModuleContext} ctx */
export async function render({ root, signal }) {
  const { org } = getState();
  /** @type {import('../../services/data.js').MobileDevices} */
  let state;
  try {
    state = await data.mobile.devices(org.id);
  } catch (error) {
    if (!signal.aborted) setHtml(root, loadError(error));
    return;
  }
  if (signal.aborted) return;

  setHtml(
    root,
    html`<section class="panel" aria-labelledby="mobile-title">
        <header class="panel__head">
          <div><h2 class="panel__title" id="mobile-title">App no celular</h2>
            <p class="panel__hint">Acompanhe pelo Android como um app: abre com a digital e mostra os avisos na tela do celular.</p></div>
          <div class="panel__tools"><button type="button" class="btn btn--primary btn--sm" data-action="pair">${icon('phone')}<span>Ligar um celular</span></button></div>
        </header>
        <ul class="vault-points">
          <li>${icon('eye')}<span><strong>Só para ver.</strong> Hoje, No ar, Dinheiro, Projetos e Clientes. O celular não edita nada; o servidor nem tem por onde receber mudança dele.</span></li>
          <li>${icon('lock')}<span><strong>Digital ou PIN</strong> toda vez que abrir. Bloqueia sozinho depois de 5 minutos fora da tela; 5 PINs errados desligam o celular.</span></li>
          <li>${icon('bell')}<span><strong>Avisos</strong> com o app fechado: site fora do ar, lento ou instável, cobranças, pagamentos, propostas respondidas e um resumo às 8h. Cada um escolhe quais no próprio celular.</span></li>
        </ul>
        ${LOCAL ? html`<p class="notice notice--warn">Este endereço é do seu computador e o celular não chega nele. Para ligar um celular, abra o sistema publicado e gere o QR por lá.</p>` : ''}
      </section>
      <section class="panel" aria-labelledby="devices-title">
        <header class="panel__head">
          <div><h2 class="panel__title" id="devices-title">Celulares ligados</h2><p class="panel__hint" data-count></p></div>
          <div class="panel__tools" data-limit></div>
        </header>
        <div data-devices></div>
      </section>`,
  );

  const draw = () => {
    const s = state;
    /** @type {HTMLElement} */ ($('[data-count]', root)).textContent =
      `${s.active} de ${s.limit} ${s.limit === 1 ? 'permitido' : 'permitidos'} nesta organização${s.active > s.limit ? ' (acima do limite: só sai, não entra)' : ''}`;
    setHtml(
      /** @type {HTMLElement} */ ($('[data-limit]', root)),
      s.owner
        ? html`<label class="inline-field"><span>Limite</span>
            <select class="input input--sm" data-limit-select aria-label="Quantos celulares podem ficar ligados">
              ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => html`<option value="${n}" ${n === s.limit ? html`selected` : ''}>${n} ${n === 1 ? 'celular' : 'celulares'}</option>`)}
            </select></label>`
        : html`<span class="muted">Só o proprietário muda o limite</span>`,
    );
    /** @type {HTMLElement} */ ($('[data-devices]', root)).replaceChildren(
      dataTable({
        label: 'Celulares ligados',
        rows: s.devices,
        sort: { key: 'seen', dir: 'desc' },
        empty: emptyState({ title: 'Nenhum celular ligado', text: 'Toque em “Ligar um celular” e leia o QR com a câmera do Android.', compact: true }),
        columns: [
          {
            key: 'name',
            label: 'Celular',
            sortValue: (d) => d.name,
            render: (d) => html`<span class="person"><strong>${d.name}</strong><small>${d.mine ? 'seu' : d.person}</small></span>`,
          },
          {
            key: 'lock',
            label: 'Abre com',
            hideOnMobile: true,
            render: (d) => (d.bio ? html`<span class="status-pill status-pill--ok">Digital ou PIN</span>` : html`<span class="status-pill status-pill--muted">PIN</span>`),
          },
          {
            key: 'push',
            label: 'Avisos',
            hideOnMobile: true,
            render: (d) => (d.push ? html`<span class="avail"><span class="status-dot status-dot--ok" aria-hidden="true"></span>Ligados</span>` : html`<span class="muted">Desligados</span>`),
          },
          {
            key: 'seen',
            label: 'Último uso',
            sortValue: (d) => d.lastSeenAt ?? d.createdAt,
            render: (d) => html`<span title="Ligado em ${formatDateTime(d.createdAt)}">${d.lastSeenAt ? formatRelative(d.lastSeenAt) : 'ainda não abriu'}</span>`,
          },
          {
            key: 'actions',
            label: 'Ações',
            align: 'end',
            render: (d) => html`<button type="button" class="btn btn--ghost btn--sm" data-action="revoke" data-id="${d.id}">Desligar</button>`,
          },
        ],
      }),
    );
  };
  draw();

  const refresh = async () => {
    state = await data.mobile.devices(org.id);
    if (!signal.aborted) draw();
  };

  root.addEventListener('change', async (event) => {
    const select = /** @type {HTMLSelectElement} */ (event.target);
    if (!select.matches('[data-limit-select]')) return;
    try {
      await data.mobile.setLimit(org.id, Number(select.value));
      toast(`Limite: ${select.value} ${select.value === '1' ? 'celular' : 'celulares'}.`, 'success');
      await refresh();
    } catch (error) {
      toastError(error);
      select.value = String(state.limit);
    }
  }, { signal });

  /** QR na tela até o celular ligar (confere a cada 3 s) ou o código vencer. */
  async function openPairing() {
    let pairing;
    try {
      pairing = await data.mobile.pairStart(org.id);
    } catch (error) {
      return toastError(error);
    }
    const url = pairUrl(pairing.code);
    const before = new Set(state.devices.map((d) => d.id));
    const done = openDialog({
      title: 'Ligar um celular',
      description: 'O código vale uma vez só e por 10 minutos.',
      submitLabel: null,
      cancelLabel: 'Fechar',
      wide: true,
      body: html`<div class="pair" data-pair>
        <div class="pair__code">${qrSvg(url)}</div>
        <div class="pair__steps">
          <ol class="steps">
            <li>Abra a <strong>câmera do Android</strong> e aponte para o código.</li>
            <li>Toque no link que aparecer: abre no Chrome.</li>
            <li>Dê um nome ao celular, crie o <strong>PIN</strong> e cadastre a <strong>digital</strong>.</li>
            <li>Toque em <strong>Instalar</strong> e em <strong>Ligar avisos</strong>.</li>
          </ol>
          <p class="pair__timer" data-timer aria-live="polite"></p>
          <button type="button" class="btn btn--ghost btn--sm" data-copy>${icon('copy')}<span>Copiar o link</span></button>
        </div>
      </div>`,
    });
    const box = /** @type {HTMLElement} */ (document.querySelector('[data-pair]'));
    const timer = /** @type {HTMLElement} */ ($('[data-timer]', box));
    const ends = Date.parse(pairing.expiresAt);
    let finished = false;
    const tick = () => {
      const left = Math.max(0, Math.round((ends - Date.now()) / 1000));
      timer.textContent = left ? `Vale por mais ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'O código venceu. Feche e gere outro.';
      if (!left) box.classList.add('is-expired');
    };
    tick();
    const clock = setInterval(tick, 1000);
    const poll = setInterval(async () => {
      if (finished || Date.now() > ends) return;
      try {
        const next = await data.mobile.devices(org.id);
        const fresh = next.devices.find((d) => !before.has(d.id) && d.mine);
        if (!fresh) return;
        finished = true;
        state = next;
        if (!signal.aborted) draw();
        setHtml(box, html`<div class="pair__done">${icon('checkCircle')}<div><strong>${fresh.name} está ligado.</strong>
          <p>No celular, termine instalando o app e ligando os avisos.</p></div></div>`);
      } catch {
        /* tenta de novo em 3 s */
      }
    }, 3000);
    $('[data-copy]', box)?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copiado. Abra no Chrome do celular.', 'success');
      } catch {
        toast(url, 'info');
      }
    });
    await done;
    clearInterval(clock);
    clearInterval(poll);
  }

  bindActions(root, {
    pair: () => openPairing(),
    revoke: async (el) => {
      const d = state.devices.find((x) => x.id === el.dataset.id);
      if (!d) return;
      const ok = await confirmDialog({
        title: `Desligar ${d.name}?`,
        message: 'Ele para de ver o sistema e de receber avisos na hora. Para usar de novo, é só ligar outra vez pelo QR.',
        confirmLabel: 'Desligar',
        danger: true,
      });
      if (!ok) return;
      try {
        await data.mobile.revoke(org.id, d.id);
        toast(`${d.name} foi desligado.`, 'success');
        await refresh();
      } catch (error) {
        toastError(error);
      }
    },
  }, signal);
}
