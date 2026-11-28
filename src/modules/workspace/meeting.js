// Painel da reunião (página do tipo "meeting"): gravar (microfone e, se quiser, a aba do Meet/Zoom),
// enviar áudio ou colar a transcrição; o Whisper local transcreve enquanto grava. "Montar ata" usa o
// modelo local (ou regras) e abre a revisão: só depois de confirmar as tarefas viram tarefas de verdade.

import { html, setHtml } from '../../shared/utils/dom.js';
import { formatDate } from '../../shared/utils/format.js';
import { today } from '../../core/validate.js';
import {
  parseTranscriptText, cleanSegments, transcriptText, formatClock, extractMinutes, mergeMinutes, chunkTranscript,
  minutesPrompt, condensePrompt, parseLlmMinutes, minutesToBlocks, matchMember, MINUTES_SCHEMA, MINUTES_SYSTEM, fold,
} from '../../core/minutes.js';
import { openDialog, confirmDialog } from '../../shared/components/dialog.js';
import { toast, toastError, errorMessage } from '../../shared/components/feedback.js';
import { icon } from '../../shared/components/icons.js';
import { aiLevel, gpu, accepted, accept, transcriber, minutesModel } from './ai.js';
import { startRecording, decodeAudioFile, findCallDevice, isOpera } from './recorder.js';

/** @typedef {import('../../services/data.js').Meeting} Meeting */
/** @typedef {import('../../core/minutes.js').Segment} Segment */
/** @typedef {import('../../core/minutes.js').Minutes} Minutes */
/** @typedef {{ userId: string, name: string, email?: string }} Member */

/**
 * @param {HTMLElement} slot
 * @param {{
 *   title: () => string,
 *   manage: boolean,
 *   canTasks: boolean,
 *   members: Member[],
 *   me: { id: string, name: string },
 *   products: { id: string, name: string }[],
 *   productId: string | null,
 *   pageId: string,
 *   meeting: Meeting,
 *   save: (meeting: Meeting) => void,
 *   hasContent: () => boolean,
 *   applyMinutes: (blocks: import('../../core/blocks.js').Block[], mode: 'append' | 'replace') => void,
 *   createTask: (input: { title: string, assigneeId: string | null, dueDate: string | null, productId: string | null }) => Promise<string>,
 * }} opts
 */
export function mountMeeting(slot, opts) {
  /** @type {Meeting} */
  const meeting = {
    date: opts.meeting?.date || today(),
    durationS: Number(opts.meeting?.durationS) || 0,
    participants: Array.isArray(opts.meeting?.participants) ? opts.meeting.participants.slice(0, 40) : [],
    transcript: Array.isArray(opts.meeting?.transcript) ? opts.meeting.transcript : [],
  };
  /** @type {Awaited<ReturnType<typeof startRecording>> | null} */
  let rec = null;
  /** @type {{ audio: Float32Array, offset: number, who: string | null }[]} */
  const queue = [];
  let queued = 0;
  let transcribed = 0;
  let busy = false;
  let building = false;
  let status = '';
  /** @type {number | null} */
  let pct = null;
  let level = 0;
  let audioUrl = '';
  let showAll = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  const ac = new AbortController();

  const speaker = (/** @type {string | null} */ who) => (who === 'me' ? opts.me.name || 'Você' : who === 'others' ? 'Outros' : who ?? '');
  const persist = () => opts.save({ ...meeting, transcript: meeting.transcript.slice(0, 20000) });

  function draw() {
    const lines = meeting.transcript;
    const visible = showAll ? lines : lines.slice(-60);
    const recording = Boolean(rec);
    setHtml(
      slot,
      html`<section class="mt" aria-label="Reunião">
        <div class="mt-meta">
          <label class="mt-field">${icon('calendar')}<span class="sr-only">Data</span>
            <input class="input input--sm" type="date" name="mt-date" value="${meeting.date}" ${opts.manage ? '' : html`disabled`}></label>
          <span class="mt-chip">${icon('clock')}<span>${meeting.durationS ? `${Math.max(1, Math.round(meeting.durationS / 60))} min` : 'sem gravação'}</span></span>
          <div class="mt-people" aria-label="Participantes">
            ${meeting.participants.map((p, i) => html`<span class="mt-person">${p}${opts.manage ? html`<button type="button" data-mt="rm-person" data-i="${i}" aria-label="Tirar ${p}">×</button>` : ''}</span>`)}
            ${opts.manage
              ? html`<input class="input input--sm mt-add-person" list="mt-members" name="mt-person" placeholder="+ participante" autocomplete="off">
                <datalist id="mt-members">${opts.members.map((m) => html`<option value="${m.name}"></option>`)}</datalist>`
              : ''}
          </div>
        </div>
        ${opts.manage
          ? html`<div class="mt-actions">
              ${recording
                ? html`<button type="button" class="btn btn--danger" data-mt="stop">${icon('check')}<span>Parar gravação</span></button>
                  <span class="mt-rec" aria-live="off"><span class="mt-rec__dot" aria-hidden="true"></span><span data-mt-time>${formatClock(rec?.elapsed() ?? 0)}</span>
                    <span class="mt-level" aria-hidden="true"><span data-mt-level></span></span></span>`
                : html`<button type="button" class="btn btn--primary" data-mt="record-tab" title="Grava você e o que os outros falam no Meet, Zoom ou Teams">${icon('monitor')}<span>Gravar reunião</span></button>
                  <button type="button" class="btn btn--secondary" data-mt="record" title="Só microfone — para reuniões presenciais">${icon('message')}<span>Gravar presencial</span></button>
                  <label class="btn btn--secondary file-pick">${icon('send')}<span>Enviar áudio</span><input type="file" accept="audio/*,video/webm,video/mp4" class="sr-only" data-mt-file></label>
                  <button type="button" class="btn btn--secondary" data-mt="paste">${icon('edit')}<span>Colar transcrição</span></button>`}
              <span class="mt-actions__gap"></span>
              <button type="button" class="btn btn--primary mt-build" data-mt="build" ${!lines.length || building || recording ? html`disabled` : ''}>✨ <span>${building ? 'Montando a ata…' : 'Montar ata'}</span></button>
            </div>`
          : ''}
        ${status || busy || queue.length
          ? html`<div class="mt-status" role="status">
              <span>${status || (busy ? `Transcrevendo… ${transcribed} de ${queued} pedaço(s)` : '')}</span>
              ${pct !== null ? html`<span class="progress"><span class="mt-progress" data-pct="${Math.round(pct * 100)}"></span></span>` : ''}
            </div>`
          : ''}
        ${audioUrl ? html`<p class="mt-note">${icon('lock')} O áudio ficou só neste computador. <a class="link-action" href="${audioUrl}" download="reuniao-${meeting.date}.webm">Baixar o áudio</a></p>` : ''}
        <details class="mt-transcript" ${lines.length && lines.length < 40 ? html`open` : ''}>
          <summary><span>Transcrição</span><small>${lines.length ? `${lines.length} fala(s)` : 'vazia'}</small></summary>
          ${lines.length
            ? html`${!showAll && lines.length > visible.length ? html`<button type="button" class="link-action mt-more" data-mt="all">Mostrar as ${lines.length} falas</button>` : ''}
              <ol class="mt-lines">${visible.map((s) => html`<li>${s.s !== null && s.s !== undefined ? html`<time>${formatClock(s.s)}</time>` : ""}${s.who ? html`<strong>${speaker(s.who)}</strong>` : ''}<span>${s.text}</span></li>`)}</ol>
              ${opts.manage ? html`<div class="mt-lines__tools"><button type="button" class="btn btn--ghost btn--sm" data-mt="edit">${icon('edit')}<span>Corrigir transcrição</span></button></div>` : ''}`
            : html`<p class="mt-empty">${opts.manage ? 'Grave a reunião, envie um áudio ou cole a transcrição do Meet, Zoom ou Teams. Tudo é transcrito aqui no seu computador.' : 'Sem transcrição.'}</p>`}
        </details>
      </section>`,
    );
    const bar = /** @type {HTMLElement | null} */ (slot.querySelector('.mt-progress'));
    if (bar) bar.style.width = `${bar.dataset.pct}%`;
  }

  /** @param {string} text @param {number | null} [p] */
  const setStatus = (text, p = null) => {
    status = text;
    pct = p;
    draw();
  };

  /** Pergunta (uma vez) antes de baixar o Whisper. */
  async function okToDownloadWhisper() {
    if (aiLevel() === 'off') {
      toast('A IA local está desligada. Ligue em Caderno › IA local ou cole a transcrição.', 'info');
      return false;
    }
    if (accepted('whisper')) return true;
    const g = await gpu();
    const size = !g.webgpu ? 'cerca de 80 MB' : aiLevel() === 'light' ? 'cerca de 250 MB' : 'cerca de 600 MB';
    const ok = await confirmDialog({
      title: 'Baixar o modelo de transcrição?',
      message: `Na primeira vez o Caderno baixa o Whisper (${size}). Ele fica guardado neste navegador e roda aqui: o áudio da reunião não vai para nenhum servidor.${g.webgpu ? '' : ' Este navegador não tem WebGPU: a transcrição vai ser mais lenta.'}`,
      confirmLabel: 'Baixar e continuar',
    });
    if (ok) accept('whisper');
    return ok;
  }

  /** Fila de transcrição (um pedaço por vez, enquanto grava). */
  async function pump() {
    if (busy) return;
    busy = true;
    draw();
    try {
      await transcriber.load((text, p) => setStatus(text, p));
      status = '';
      pct = null;
      while (queue.length) {
        const job = /** @type {typeof queue[number]} */ (queue.shift());
        draw();
        const segs = await transcriber.run(job.audio, job.offset, job.who);
        transcribed += 1;
        meeting.transcript = cleanSegments([...meeting.transcript, ...segs].sort((a, b) => (a.s ?? 0) - (b.s ?? 0)));
        persist();
      }
      if (!rec) setStatus(meeting.transcript.length ? 'Transcrição pronta. Confira e clique em Montar ata.' : 'Não encontrei fala no áudio.');
    } catch (error) {
      queue.length = 0;
      setStatus(`Transcrição parou: ${errorMessage(error)}`);
    } finally {
      busy = false;
      draw();
    }
  }

  /** @param {{ audio: Float32Array, offset: number, who: string | null }} job */
  const enqueue = (job) => {
    queue.push(job);
    queued += 1;
    pump();
  };

  /** @param {boolean} withCall */
  async function record(withCall) {
    if (!(await okToDownloadWhisper())) return;
    /** @type {'tab' | { deviceId: string } | null} */
    let call = null;
    if (withCall) {
      const deviceId = await findCallDevice();
      if (deviceId) call = { deviceId };
      else if (isOpera()) {
        const ok = await confirmDialog({
          title: 'O Opera não grava o som da chamada',
          message: 'O Opera GX fecha sozinho quando um site pede para compartilhar a aba. Para gravar o que os outros falam, abra o DUM no Edge ou no Chrome e grave por lá (ou ative a "Mixagem estéreo" do Windows). Aqui no Opera dá para gravar só o seu microfone.',
          confirmLabel: 'Gravar só o microfone',
        });
        if (!ok) return;
      } else call = 'tab';
    }
    try {
      // Quem já estava antes desta gravação: a próxima continua no tempo certo.
      const base = meeting.durationS;
      rec = await startRecording({
        call,
        onChunk: (c) => enqueue({ ...c, offset: c.offset + base }),
        onLevel: (v) => {
          level = v;
          const el = /** @type {HTMLElement | null} */ (slot.querySelector('[data-mt-level]'));
          if (el) el.style.transform = `scaleX(${Math.max(0.04, level)})`;
        },
        onCallEnded: () => {
          if (rec) setStatus('O som da chamada parou de ser compartilhado. Continuo gravando só o seu microfone.');
        },
      });
      if (!meeting.participants.some((p) => fold(p) === fold(opts.me.name))) meeting.participants.push(opts.me.name);
      status = call ? 'Gravando você e o som da chamada (todos os participantes). A transcrição sai a cada 30 s.' : 'Gravando o microfone. A transcrição sai a cada 30 s.';
      draw();
      timer = setInterval(() => {
        const el = slot.querySelector('[data-mt-time]');
        if (el && rec) el.textContent = formatClock(rec.elapsed());
      }, 1000);
    } catch (error) {
      rec = null;
      if (call === 'tab' && /** @type {Error} */ (error).message?.includes('cancelada')) {
        const fallback = await confirmDialog({
          title: 'Aba não compartilhada',
          message: 'Para gravar o que os outros falam, escolha a aba da chamada com "Compartilhar áudio da guia" ligado (ou "Tela inteira" com "Compartilhar áudio do sistema", se a reunião estiver no app do Zoom/Teams). Quer gravar só o seu microfone?',
          confirmLabel: 'Gravar só microfone',
        });
        if (fallback) record(false);
        return;
      }
      toastError(error);
    }
  }

  async function stop() {
    if (!rec) return;
    const current = rec;
    if (timer) clearInterval(timer);
    status = 'Finalizando a gravação…';
    draw();
    const { blob, durationS } = await current.stop();
    rec = null;
    meeting.durationS += durationS;
    if (blob) {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(blob);
    }
    persist();
    status = queue.length || busy ? '' : 'Gravação encerrada.';
    draw();
  }

  /** @param {File} file */
  async function upload(file) {
    if (!(await okToDownloadWhisper())) return;
    try {
      setStatus('Lendo o áudio…');
      const { chunks, durationS } = await decodeAudioFile(file);
      const base = meeting.durationS;
      meeting.durationS += durationS;
      persist();
      if (!chunks.length) return setStatus('Não encontrei fala neste áudio.');
      status = '';
      for (const c of chunks) enqueue({ ...c, offset: c.offset + base, who: null });
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  /** @param {'paste' | 'edit'} mode */
  async function pasteOrEdit(mode) {
    const current = mode === 'edit' ? meeting.transcript.map((s) => `${s.s !== null && s.s !== undefined ? `[${formatClock(s.s)}] ` : ''}${s.who ? `${speaker(s.who)}: ` : ''}${s.text}`).join('\n') : '';
    await openDialog({
      title: mode === 'edit' ? 'Corrigir transcrição' : 'Colar transcrição',
      description: mode === 'edit' ? 'Uma fala por linha. Pode corrigir nomes e palavras.' : 'Cole o texto do Meet, Zoom, Teams (ou .vtt). Formato livre: "Nome: fala" em cada linha funciona melhor.',
      wide: true,
      body: html`<label class="field"><span class="field__label">Transcrição</span><textarea class="input mt-textarea" name="text" rows="14" maxlength="400000" required>${current}</textarea></label>`,
      submitLabel: mode === 'edit' ? 'Salvar' : 'Usar este texto',
      onSubmit: (form) => {
        const segs = cleanSegments(parseTranscriptText(String(form.get('text') ?? '')));
        if (!segs.length) throw new Error('Não achei falas neste texto.');
        meeting.transcript = mode === 'edit' ? segs : [...meeting.transcript, ...segs];
        for (const who of new Set(segs.map((s) => s.who).filter(Boolean))) {
          const name = matchMember(who, opts.members)?.name ?? who;
          if (name && !['me', 'others'].includes(String(who)) && !meeting.participants.some((p) => fold(p) === fold(String(name)))) meeting.participants.push(String(name));
        }
        persist();
        status = 'Transcrição pronta. Clique em Montar ata.';
        draw();
      },
    });
  }

  /** Monta a ata (IA local ou regras) e abre a revisão. */
  async function build() {
    if (!meeting.transcript.length) return toast('Grave, envie o áudio ou cole a transcrição primeiro.', 'info');
    building = true;
    draw();
    const ctx = { members: opts.members, todayKey: meeting.date || today() };
    /** @type {Minutes | null} */
    let minutes = null;
    /** @type {'ai' | 'rules'} */
    let engine = 'rules';
    try {
      const g = await gpu();
      if (aiLevel() !== 'off' && g.webgpu) {
        let ok = accepted('llm');
        if (!ok) {
          ok = await confirmDialog({
            title: 'Baixar o modelo da ata?',
            message: `Na primeira vez o Caderno baixa um modelo de IA (${aiLevel() === 'light' ? 'cerca de 1,4 GB' : 'cerca de 2,4 GB'}). Ele roda aqui no navegador: a conversa não vai para nenhum servidor. Sem baixar, a ata sai por regras.`,
            confirmLabel: 'Baixar e montar',
          });
          if (ok) accept('llm');
        }
        if (ok) {
          try {
            await minutesModel.load((text, p) => setStatus(text, p));
            const chunks = chunkTranscript(meeting.transcript, 6000);
            const team = [...new Set([...opts.members.map((m) => m.name), ...meeting.participants])];
            /** @type {Minutes[]} */
            const parts = [];
            for (let i = 0; i < chunks.length; i += 1) {
              setStatus(`Montando a ata: parte ${i + 1} de ${chunks.length}…`, i / chunks.length);
              const text = await minutesModel.chat([
                { role: 'system', content: MINUTES_SYSTEM },
                { role: 'user', content: minutesPrompt(chunks[i], { title: opts.title(), date: formatDate(meeting.date), team, part: i + 1, parts: chunks.length }) },
              ], MINUTES_SCHEMA);
              parts.push(parseLlmMinutes(text, ctx));
            }
            minutes = mergeMinutes(parts);
            if (minutes.summary.length > 7) {
              setStatus('Juntando o resumo…', 0.95);
              const joined = parseLlmMinutes(await minutesModel.chat([{ role: 'system', content: MINUTES_SYSTEM }, { role: 'user', content: condensePrompt(minutes.summary) }], MINUTES_SCHEMA), ctx);
              if (joined.summary.length) minutes.summary = joined.summary;
            }
            // Modelo pequeno às vezes não acha as tarefas: as regras completam.
            if (!minutes.tasks.length) minutes.tasks = extractMinutes(meeting.transcript, ctx).tasks;
            engine = 'ai';
          } catch (error) {
            toast(`A IA local não conseguiu (${errorMessage(error)}). Montei por regras.`, 'info');
          }
        }
      }
      minutes ??= extractMinutes(meeting.transcript, ctx);
      status = '';
      pct = null;
      building = false;
      draw();
      await review(minutes, engine);
    } catch (error) {
      toastError(error);
    } finally {
      building = false;
      status = '';
      pct = null;
      draw();
    }
  }

  /** Revisão: resumo, decisões e "quem faz o quê" editáveis antes de entrar na página. @param {Minutes} minutes @param {'ai' | 'rules'} engine */
  async function review(minutes, engine) {
    let rows = minutes.tasks.map((t) => ({ ...t, member: matchMember(t.who, opts.members) }));
    const memberOptions = (/** @type {any} */ row) => html`<option value="">Sem responsável</option>
      ${opts.members.map((m) => html`<option value="${m.userId}" ${row.member?.userId === m.userId ? html`selected` : ''}>${m.name}</option>`)}
      ${row.who && !row.member ? html`<option value="ext:${row.who}" selected>${row.who} (fora da equipe)</option>` : ''}`;
    const rowHtml = (/** @type {any} */ row, /** @type {number} */ i) => html`<div class="mr-task" data-row="${i}">
        <input class="input" name="t-title-${i}" value="${row.title}" maxlength="200" aria-label="O que fazer" required>
        <select class="input" name="t-who-${i}" aria-label="Responsável">${memberOptions(row)}</select>
        <input class="input" type="date" name="t-due-${i}" value="${row.due ?? ''}" aria-label="Prazo">
        <button type="button" class="icon-btn icon-btn--sm" data-mr="del" data-i="${i}" aria-label="Tirar tarefa">${icon('x')}</button>
      </div>`;
    const done = openDialog({
      title: engine === 'ai' ? 'Ata montada pela IA local' : 'Ata montada por regras',
      description: 'Revise. As tarefas com alguém da equipe viram tarefas de verdade (aparecem no Hoje da pessoa).',
      wide: true,
      body: html`<label class="field"><span class="field__label">Resumo (uma frase por linha)</span><textarea class="input" name="summary" rows="5">${minutes.summary.join('\n')}</textarea></label>
        <label class="field"><span class="field__label">Decisões (uma por linha)</span><textarea class="input" name="decisions" rows="3">${minutes.decisions.join('\n')}</textarea></label>
        <div class="field"><span class="field__label">Quem faz o quê</span>
          <div class="mr-tasks" data-mr-list>${rows.map(rowHtml)}</div>
          <button type="button" class="btn btn--ghost btn--sm mr-add" data-mr="add">${icon('plus')}<span>Adicionar tarefa</span></button></div>
        <div class="form-grid">
          ${opts.canTasks
            ? html`<label class="field"><span class="field__label">Projeto das tarefas</span><select class="input" name="project"><option value="">Nenhum (só a reunião)</option>
                ${opts.products.map((p) => html`<option value="${p.id}" ${p.id === opts.productId ? html`selected` : ''}>${p.name}</option>`)}</select></label>`
            : ''}
          ${opts.hasContent()
            ? html`<label class="field"><span class="field__label">Na página</span><select class="input" name="mode"><option value="append">Adicionar a ata no fim</option><option value="replace">Trocar o conteúdo pela ata</option></select></label>`
            : ''}
        </div>`,
      submitLabel: 'Inserir ata na página',
      onSubmit: async (form) => {
        const lines = (/** @type {string} */ name) => String(form.get(name) ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
        const productId = String(form.get('project') ?? '') || null;
        /** @type {(import('../../core/minutes.js').MinutesTask & { taskId?: string })[]} */
        const tasks = [];
        for (const el of /** @type {HTMLElement[]} */ ([...(document.querySelector('dialog[open] [data-mr-list]')?.querySelectorAll('[data-row]') ?? [])])) {
          const i = el.dataset.row;
          const title = String(form.get(`t-title-${i}`) ?? '').trim();
          if (title.length < 2) continue;
          const who = String(form.get(`t-who-${i}`) ?? '');
          const due = String(form.get(`t-due-${i}`) ?? '') || null;
          const member = opts.members.find((m) => m.userId === who) ?? null;
          /** @type {import('../../core/minutes.js').MinutesTask & { taskId?: string }} */
          const task = { title, who: member ? member.name : who.startsWith('ext:') ? who.slice(4) : null, due };
          if (member && opts.canTasks) task.taskId = await opts.createTask({ title, assigneeId: member.userId, dueDate: due, productId });
          tasks.push(task);
        }
        const blocks = minutesToBlocks({ summary: lines('summary'), decisions: lines('decisions'), tasks }, { participants: meeting.participants, engine });
        opts.applyMinutes(blocks, /** @type {'append' | 'replace'} */ (String(form.get('mode') ?? 'append')));
      },
    });
    const dialog = /** @type {HTMLElement | null} */ (document.querySelector('dialog[open]'));
    const list = dialog?.querySelector('[data-mr-list]');
    dialog?.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('[data-mr]');
      if (!btn || !list) return;
      if (/** @type {HTMLElement} */ (btn).dataset.mr === 'add') {
        const i = rows.length;
        rows = [...rows, { title: '', who: null, due: null, member: null }];
        list.insertAdjacentHTML('beforeend', String(rowHtml(rows[i], i)));
        /** @type {HTMLInputElement | null} */ (list.querySelector(`[name="t-title-${i}"]`))?.focus();
      } else {
        list.querySelector(`[data-row="${/** @type {HTMLElement} */ (btn).dataset.i}"]`)?.remove();
      }
    });
    if (await done) toast('Ata inserida na página.', 'success');
  }

  slot.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('[data-mt]');
    if (!btn) return;
    const action = /** @type {HTMLElement} */ (btn).dataset.mt;
    if (action === 'record') record(false);
    if (action === 'record-tab') record(true);
    if (action === 'stop') stop();
    if (action === 'paste') pasteOrEdit('paste');
    if (action === 'edit') pasteOrEdit('edit');
    if (action === 'build') build();
    if (action === 'all') {
      showAll = true;
      draw();
    }
    if (action === 'rm-person') {
      meeting.participants.splice(Number(/** @type {HTMLElement} */ (btn).dataset.i), 1);
      persist();
      draw();
    }
  }, { signal: ac.signal });
  slot.addEventListener('change', (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    if (target.name === 'mt-date' && target.value) {
      meeting.date = target.value;
      persist();
    }
    if (target.name === 'mt-person') {
      const name = target.value.trim().slice(0, 80);
      if (name && !meeting.participants.some((p) => fold(p) === fold(name))) {
        meeting.participants.push(name);
        persist();
      }
      draw();
      /** @type {HTMLInputElement | null} */ (slot.querySelector('[name="mt-person"]'))?.focus();
    }
    if (target.matches('[data-mt-file]') && target.files?.[0]) upload(target.files[0]);
  }, { signal: ac.signal });

  draw();
  return {
    /** Gravando ou transcrevendo? (a página avisa antes de sair) */
    busy: () => Boolean(rec) || busy || queue.length > 0,
    destroy() {
      ac.abort();
      if (timer) clearInterval(timer);
      rec?.stop();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
  };
}
