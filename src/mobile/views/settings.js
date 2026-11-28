// Ajustes deste celular: avisos (quais e de manhã), segurança, tema e desligar o celular.
// "Celular ligado" (logo depois de parear): instalar o app e ligar os avisos.
// As escolhas de aviso têm os mesmos nomes de supabase/functions/mobile/push-rules.js.

import { html } from '../../shared/utils/dom.js';
import { icon } from '../../shared/components/icons.js';
import { section } from '../ui.js';
import { pushSupported } from '../device.js';

/** Escolhas de aviso (as chaves são as do servidor). */
export const PREFS = /** @type {const} */ ([
  { key: 'down', label: 'Site fora do ar e de volta', hint: 'Na hora em que cai e quando volta, com quanto tempo ficou fora.' },
  { key: 'unstable', label: 'Site lento ou instável', hint: 'Antes de cair: no máximo um aviso por hora para cada site.' },
  { key: 'payment', label: 'Pagamento registrado', hint: 'Quando alguém da equipe marca uma mensalidade como paga.' },
  { key: 'proposal', label: 'Proposta respondida', hint: 'Quando alguém da equipe registra o aceite ou a recusa.' },
  { key: 'other', label: 'Tarefas e equipe', hint: 'Tarefa nova para você, celular ligado, senha compartilhada.' },
]);
export const MORNING = /** @type {const} */ ([
  { key: 'summary', label: 'Resumo num aviso só', hint: 'Às 8h: fora do ar, cobranças, vencimentos e suas tarefas.' },
  { key: 'each', label: 'Um aviso por rotina', hint: 'Cobranças do dia, vencimentos e tarefas, cada um separado.' },
  { key: 'off', label: 'Nada de manhã', hint: '' },
]);

// Tema: a mesma chave que o assets/js/theme-boot.js lê antes da primeira pintura.
const getTheme = () => {
  try {
    const t = localStorage.getItem('dum.theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
};
/** @param {'light' | 'dark' | 'system'} pref */
function setTheme(pref) {
  if (pref === 'system') localStorage.removeItem('dum.theme');
  else localStorage.setItem('dum.theme', pref);
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

const THEMES = [{ key: 'system', label: 'Automático' }, { key: 'light', label: 'Claro' }, { key: 'dark', label: 'Escuro' }];

/** @param {any} prefs */
const prefsOf = (prefs) => ({ down: true, unstable: true, payment: true, proposal: true, other: true, morning: 'summary', ...(prefs ?? {}) });

/** @param {import('../model.js').Model} m */
function pushBlock(m) {
  const p = prefsOf(m.device?.prefs);
  const on = Boolean(m.device?.push);
  if (!pushSupported()) {
    return html`<p class="m-hint">Este navegador não recebe avisos. Abra o link pelo Chrome do Android e instale o app.</p>`;
  }
  return html`<div class="m-toggle-head">
      <span><strong>Avisos na tela do celular</strong><small data-push-status>${on ? 'Ligados neste celular' : 'Desligados neste celular'}</small></span>
      ${on ? html`<button type="button" class="m-btn" data-act="push-off">Desligar</button>` : html`<button type="button" class="m-btn m-btn--primary" data-act="push-on">Ligar avisos</button>`}
    </div>
    <fieldset class="m-prefs" ${on ? '' : html`disabled`}>
      <legend class="sr-only">Quais avisos</legend>
      ${PREFS.map((x) => html`<label class="m-switch"><span><strong>${x.label}</strong><small>${x.hint}</small></span>
        <input type="checkbox" role="switch" name="${x.key}" ${p[x.key] !== false ? html`checked` : ''}></label>`)}
      <p class="m-prefs__label">De manhã (8h)</p>
      ${MORNING.map((x) => html`<label class="m-radio"><input type="radio" name="morning" value="${x.key}" ${p.morning === x.key ? html`checked` : ''}>
        <span><strong>${x.label}</strong>${x.hint ? html`<small>${x.hint}</small>` : ''}</span></label>`)}
    </fieldset>
    ${on ? html`<button type="button" class="m-btn m-btn--block" data-act="push-test">${icon('send')}<span>Enviar um aviso de teste</span></button>` : ''}`;
}

/** Liga os botões: cada ação mostra o erro na hora, sem sair da tela. @param {HTMLElement} el @param {any} ctx */
function bindPush(el, ctx) {
  el.addEventListener('click', async (event) => {
    const button = /** @type {HTMLButtonElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('[data-act]'));
    if (!button || button.disabled) return;
    const act = button.dataset.act;
    button.disabled = true;
    try {
      if (act === 'push-on') {
        await ctx.enablePush();
        ctx.toast('Avisos ligados neste celular.');
      } else if (act === 'push-off') {
        await ctx.disablePush();
        ctx.toast('Avisos desligados neste celular.');
      } else if (act === 'push-test') {
        await ctx.testPush();
        ctx.toast('Aviso de teste enviado. Ele chega em alguns segundos.');
      } else if (act === 'install') {
        await ctx.install();
      } else if (act === 'lock') {
        return ctx.lock();
      } else if (act === 'forget') {
        if (!(await ctx.confirm('Desligar este celular?', 'Ele para de ver o sistema e de receber avisos. Para usar de novo, gere outro QR no computador.'))) return;
        return ctx.forget();
      } else {
        return;
      }
      ctx.rerender();
    } catch (error) {
      ctx.toast(error instanceof Error ? error.message : 'Não deu certo. Tente de novo.', 'error');
    } finally {
      button.disabled = false;
    }
  });
  el.addEventListener('change', async (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (input.name === 'theme') {
      setTheme(/** @type {any} */ (input.value));
      return ctx.rerender();
    }
    const form = input.closest('.m-prefs');
    if (!form) return;
    const prefs = Object.fromEntries(PREFS.map((x) => [x.key, /** @type {HTMLInputElement} */ (form.querySelector(`[name="${x.key}"]`)).checked]));
    const morning = /** @type {HTMLInputElement | null} */ (form.querySelector('[name="morning"]:checked'));
    try {
      await ctx.savePrefs({ ...prefs, morning: morning?.value ?? 'summary' });
      ctx.toast('Escolha salva.');
    } catch (error) {
      ctx.toast(error instanceof Error ? error.message : 'Não salvou. Tente de novo.', 'error');
    }
  });
}

export default {
  title: () => 'Ajustes',
  back: () => '#/hoje',
  /** @param {import('../model.js').Model} m */
  render(m) {
    const theme = getTheme();
    return html`
      ${section('Avisos', pushBlock(m))}
      ${section('Segurança', html`<dl class="m-ledger">
          <div><dt>Abre com</dt><dd>${m.device?.bio ? 'Digital ou PIN' : 'PIN'}</dd></div>
          <div><dt>Bloqueia sozinho</dt><dd>5 min fora da tela</dd></div>
        </dl>
        <button type="button" class="m-btn m-btn--block" data-act="lock">${icon('lock')}<span>Bloquear agora</span></button>`)}
      ${section('Tema', html`<div class="m-segment" role="radiogroup" aria-label="Tema">${THEMES.map((t) => html`<label><input type="radio" name="theme" value="${t.key}" ${theme === t.key ? html`checked` : ''}><span>${t.label}</span></label>`)}</div>`)}
      ${section('Este celular', html`<dl class="m-ledger">
          <div><dt>Nome</dt><dd>${m.device?.name ?? '—'}</dd></div>
          <div><dt>Conta</dt><dd>${m.me.name}</dd></div>
          <div><dt>Organização</dt><dd>${m.org.name}</dd></div>
        </dl>
        <button type="button" class="m-btn m-btn--danger m-btn--block" data-act="forget">Desligar este celular</button>`)}
      <p class="m-foot">Só para ver: nada é editado por aqui. Os dados vêm do DUM Master na hora e não ficam guardados neste celular.</p>`;
  },
  /** @param {HTMLElement} el @param {any} _m @param {any} ctx */
  mount: (el, _m, ctx) => bindPush(el, ctx),
};

export const ready = {
  title: () => 'Celular ligado',
  /** @param {import('../model.js').Model} m @param {any} _r @param {any} ctx */
  render(m, _r, ctx) {
    const installed = ctx.standalone();
    return html`<div class="m-done">
      <p class="m-done__title">${icon('checkCircle')}<span>${m.device?.name ?? 'Este celular'} está ligado à ${m.org.name}.</span></p>
      <ol class="m-steps">
        <li class="${installed ? 'is-done' : ''}"><strong>Instale o app</strong>
          <span>${installed ? 'Pronto: ele já abre como app.' : ctx.canInstall() ? 'Ganha ícone na tela inicial e abre sem a barra do Chrome.' : 'No Chrome, toque no menu ⋮ e em “Instalar app” (ou “Adicionar à tela inicial”).'}</span>
          ${!installed && ctx.canInstall() ? html`<button type="button" class="m-btn m-btn--primary" data-act="install">${icon('download')}<span>Instalar</span></button>` : ''}</li>
        <li class="${m.device?.push ? 'is-done' : ''}"><strong>Ligue os avisos</strong>
          <span>${m.device?.push ? 'Ligados: o teste está em Ajustes.' : 'Site fora do ar, cobranças, pagamentos e o resumo das 8h, mesmo com o app fechado.'}</span>
          ${m.device?.push || !pushSupported() ? '' : html`<button type="button" class="m-btn m-btn--primary" data-act="push-on">${icon('bell')}<span>Ligar avisos</span></button>`}</li>
      </ol>
      <a class="m-btn m-btn--block" href="#/hoje">Abrir o Hoje</a>
    </div>`;
  },
  /** @param {HTMLElement} el @param {any} _m @param {any} ctx */
  mount: (el, _m, ctx) => bindPush(el, ctx),
};
