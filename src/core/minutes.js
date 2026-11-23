// Reuniões: transcrição (trechos com tempo e quem falou), ata por regras e o que o modelo local
// (WebLLM) recebe e devolve. Tudo puro — testado em tests/core.test.js. Nada sai do navegador.

import { makeBlock, plainRuns } from './blocks.js';

/** @typedef {{ s: number | null, e?: number | null, who: string | null, text: string }} Segment */
/** @typedef {{ title: string, who: string | null, due: string | null }} MinutesTask */
/** @typedef {{ summary: string[], decisions: string[], tasks: MinutesTask[] }} Minutes */
/** @typedef {{ userId: string, name: string, email?: string }} Member */

/** Tira acentos e caixa. @param {string} text */
export const fold = (text) => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** 75 → "01:15"; 3700 → "1:01:40". @param {number | null | undefined} sec */
export function formatClock(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "01:02:03", "02:03", "02:03.500" → segundos. @param {string} text */
function clockToSec(text) {
  const parts = text.split(':').map((p) => Number(p.replace(',', '.')));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((t, n) => t * 60 + n, 0);
}

/**
 * Transcrição colada (Meet, Zoom, Teams, VTT ou texto livre) → trechos.
 * Entende "[00:12] Nome: texto", "00:12:03 Nome: texto", "Nome (00:12): texto", "Nome: texto",
 * VTT ("00:00:01.000 --> 00:00:04.000" + "<v Nome>texto") e linhas soltas.
 * @param {string} text @returns {Segment[]}
 */
export function parseTranscriptText(text) {
  /** @type {Segment[]} */
  const out = [];
  /** @type {number | null} */
  let pendingTime = null;
  /** @type {string | null} */
  let pendingWho = null;
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw.trim();
    if (!line || /^WEBVTT/i.test(line) || /^NOTE\b/.test(line) || /^\d+$/.test(line)) continue;
    const cue = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\s*-->\s*\S+/);
    if (cue) {
      pendingTime = clockToSec(cue[1]);
      continue;
    }
    let s = pendingTime;
    let who = null;
    const vtt = line.match(/^<v\s+([^>]+)>(.*?)(?:<\/v>)?$/i);
    if (vtt) {
      who = vtt[1].trim();
      line = vtt[2].trim();
    }
    const lead = line.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+(.*)$/);
    if (lead) {
      s = clockToSec(lead[1]);
      line = lead[2];
    }
    const named = line.match(/^([A-ZÀ-Ýa-zà-ý][\wÀ-ÿ.' -]{0,40}?)\s*(?:\((\d{1,2}:\d{2}(?::\d{2})?)\))?\s*:\s+(.+)$/);
    if (named && !/^https?$/i.test(named[1])) {
      who = named[1].trim();
      if (named[2]) s = clockToSec(named[2]);
      line = named[3].trim();
    }
    // Teams/Zoom às vezes põem o nome numa linha e a fala na seguinte
    if (!who && !lead && !named && /^[A-ZÀ-Ý][\wÀ-ÿ.' -]{1,40}$/.test(line) && line.split(' ').length <= 4 && !/[.!?]$/.test(line)) {
      pendingWho = line;
      continue;
    }
    if (!who && pendingWho) who = pendingWho;
    pendingWho = null;
    pendingTime = null;
    const clean = line.replace(/<[^>]+>/g, '').trim();
    if (clean) out.push({ s, who, text: clean });
  }
  return out;
}

/** Frases que o Whisper inventa no silêncio. */
const HALLUCINATIONS = [
  'legendas pela comunidade amara.org', 'obrigado por assistir', 'inscreva-se no canal', 'legenda adriana zanotto',
  'transcricao e legendas', 'tradutor', 'sous-titres', 'subtitles by',
];

/** Tira alucinações e repetições seguidas. @param {Segment[]} segments */
export function cleanSegments(segments) {
  /** @type {Segment[]} */
  const out = [];
  for (const seg of segments) {
    const text = String(seg.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text || /^[\s.,!?…-]*$/.test(text)) continue;
    const f = fold(text);
    if (HALLUCINATIONS.some((h) => f.includes(h))) continue;
    const prev = out[out.length - 1];
    if (prev && fold(prev.text) === f) continue;
    out.push({ ...seg, text });
  }
  return out;
}

/** Texto corrido da transcrição ("Nome: fala"). @param {Segment[]} segments */
export const transcriptText = (segments) => segments.map((s) => (s.who ? `${s.who}: ${s.text}` : s.text)).join('\n');

/** Pedaços de até maxChars para o modelo local (contexto pequeno). @param {Segment[]} segments @param {number} [maxChars] */
export function chunkTranscript(segments, maxChars = 6000) {
  /** @type {string[]} */
  const chunks = [];
  let current = '';
  for (const line of transcriptText(segments).split('\n')) {
    if (current && current.length + line.length + 1 > maxChars) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n${line}` : line.slice(0, maxChars);
  }
  if (current) chunks.push(current);
  return chunks;
}

const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** @param {string} key "YYYY-MM-DD" @param {number} days */
const addDays = (key, days) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Prazo falado → data. Entende hoje, amanhã, depois de amanhã, dia da semana (próximo),
 * "semana que vem", "fim do mês", "dia 28", "28/11", "28/11/2026", "28 de novembro", "em 3 dias", ISO.
 * @param {string | null | undefined} text @param {string} todayKey @returns {string | null}
 */
export function parseDue(text, todayKey) {
  const t = fold(text ?? '');
  if (!t.trim()) return null;
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const year = Number(todayKey.slice(0, 4));
  const month = Number(todayKey.slice(5, 7));
  const day = Number(todayKey.slice(8, 10));
  /** Data no futuro mais próximo (vira o ano se já passou). @param {number} d @param {number} m @param {number} [y] */
  const pick = (d, m, y) => {
    if (d < 1 || d > 31 || m < 1 || m > 12) return null;
    let yy = y ?? year;
    if (yy < 100) yy += 2000;
    let key = `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!y && key < todayKey) key = `${yy + 1}${key.slice(4)}`;
    return Number.isNaN(Date.parse(`${key}T00:00:00Z`)) ? null : key;
  };
  const dm = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dm) return pick(Number(dm[1]), Number(dm[2]), dm[3] ? Number(dm[3]) : undefined);
  const named = t.match(/\b(\d{1,2}) de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
  if (named) return pick(Number(named[1]), MONTHS.indexOf(named[2]) + 1);
  if (/\bdepois de amanha\b/.test(t)) return addDays(todayKey, 2);
  if (/\bamanha\b/.test(t)) return addDays(todayKey, 1);
  if (/\bhoje\b/.test(t)) return todayKey;
  const inDays = t.match(/\bem (\d{1,2}) dias?\b/);
  if (inDays) return addDays(todayKey, Number(inDays[1]));
  if (/\b(semana que vem|proxima semana)\b/.test(t)) {
    const dow = new Date(`${todayKey}T12:00:00Z`).getUTCDay();
    return addDays(todayKey, ((8 - dow) % 7) || 7);
  }
  if (/\b(fim|final) do mes\b/.test(t)) return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}(-feira)?\\b`).test(t));
  if (wd >= 0) {
    const dow = new Date(`${todayKey}T12:00:00Z`).getUTCDay();
    return addDays(todayKey, ((wd - dow + 7) % 7) || 7);
  }
  const dia = t.match(/\bdia (\d{1,2})\b/);
  if (dia) {
    const d = Number(dia[1]);
    return d >= day ? pick(d, month) : pick(d, month === 12 ? 1 : month + 1, month === 12 ? year + 1 : year);
  }
  return null;
}

/**
 * Nome falado → membro da equipe (nome completo, primeiro nome ou começo do e-mail; só se for único).
 * @param {string | null | undefined} name @param {Member[]} members @returns {Member | null}
 */
export function matchMember(name, members) {
  const n = fold(name ?? '').replace(/^@/, '').trim();
  if (!n || n.length < 2) return null;
  const exact = members.filter((m) => fold(m.name) === n);
  if (exact.length === 1) return exact[0];
  const first = members.filter((m) => {
    const parts = fold(m.name).split(/\s+/);
    return parts[0] === n || parts[0] === n.split(/\s+/)[0] || fold(m.email ?? '').split('@')[0] === n;
  });
  return first.length === 1 ? first[0] : null;
}

/** Frases de uma fala. @param {string} text */
const sentences = (text) => String(text).split(/(?<=[.!?…])\s+|\s*;\s*/).map((s) => s.trim()).filter((s) => s.length > 3);

const DECISION = /\b(decidimos|decidido|decidiu|ficou (decidido|definido|combinado|acertado|fechado)|esta (decidido|definido|combinado|fechado)|combinamos|fechamos|definimos|aprovad[oa]s?|vamos (seguir|fechar|usar|manter|ficar) com)\b/;
const TASK_VERB = /\b(vai|vou|vamos|fica (de|com|responsavel)|ficou (de|com|responsavel)|precisa|precisamos|tem que|temos que|deve|devemos|pode (fazer|mandar|enviar|ver|criar)|responsavel|encarregad[oa]|pendente|acao|tarefa|to-?do)\b/;
const NOT_TASK = /\b(acho que|sera que|talvez|se (a gente|voce)|quem sabe|nao (vai|precisa|tem que))\b/;
const DUE_HINT = /\b((ate|para|pra|antes de|no dia|na|no)\s+(hoje|amanha|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|a? ?semana que vem|a? ?proxima semana|o? ?fim do mes|o? ?final do mes|dia \d{1,2}|\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d{1,2} de \w+)(-feira)?|depois de amanha|amanha|hoje|semana que vem|\d{1,2}\/\d{1,2}(\/\d{2,4})?)\b/;
/** "A Bia vai fazer o layout" → "fazer o layout"; "Eu vou mandar" → "mandar". */
const SUBJECT = /^(?:(?:a|o|e|entao)\s+)?(?:(?:eu|ela|ele|a gente|nos|voce|vc|[A-ZÀ-Ý][\wÀ-ÿ]+)\s+)?(?:vai|vou|vamos|fica de|fica com|ficou de|ficou com|precisa|precisamos|tem que|temos que|deve|devemos|pode)\s+/i;
const KEYWORDS = /\b(cliente|site|sistema|prazo|valor|preco|proposta|projeto|entrega|layout|pagamento|mensalidade|implantacao|dominio|hospedagem|reuniao|apresenta|contrato|lancamento|publicar|teste|ajuste|problema|objetivo|meta)\b/;

/** Tira o prazo e enfeites do texto da tarefa. @param {string} text */
function taskTitle(text) {
  let t = text
    .replace(/^(entao|e|ok|beleza|certo|perfeito|combinado)[,!.]?\s+/i, '')
    .replace(/\s*\b(at[eé]|para|pra|antes de)\s+(hoje|amanh[aã]|depois de amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|a semana que vem|semana que vem|a pr[oó]xima semana|pr[oó]xima semana|o fim do m[eê]s|fim do m[eê]s|o final do m[eê]s|dia \d{1,2}|\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d{1,2} de \w+)(-feira)?(?=$|[\s,.!?;])\.?/gi, '')
    .replace(/\s+(hoje|amanh[aã]|depois de amanh[aã]|semana que vem)(?=$|[\s,.!?;])/gi, '')
    .replace(/[.!…]+$/, '')
    .trim();
  const short = t.replace(SUBJECT, '');
  if (short.length >= 6 && short !== t) t = short;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.slice(0, 200);
}

/**
 * Ata por regras (sem modelo de IA): decisões, tarefas com responsável e prazo, e um resumo
 * com as frases mais informativas. Bom ponto de partida — a tela sempre deixa revisar.
 * @param {Segment[]} segments
 * @param {{ members: Member[], todayKey: string }} context
 * @returns {Minutes}
 */
export function extractMinutes(segments, { members, todayKey }) {
  /** @type {string[]} */
  const decisions = [];
  /** @type {MinutesTask[]} */
  const tasks = [];
  /** @type {{ text: string, score: number, i: number }[]} */
  const scored = [];
  let index = 0;
  for (const seg of segments) {
    for (const sentence of sentences(seg.text)) {
      index += 1;
      const f = fold(sentence);
      if (DECISION.test(f)) {
        decisions.push(sentence.replace(/[.!…]+$/, ''));
        continue;
      }
      if (TASK_VERB.test(f) && !NOT_TASK.test(f) && !/\?$/.test(sentence)) {
        /** @type {string | null} */
        let who = null;
        const at = sentence.match(/@([\wÀ-ÿ.]+)/);
        const named = members.find((m) => {
          const first = fold(m.name).split(/\s+/)[0];
          return first.length > 2 && new RegExp(`(^|\\s)${first}\\b(?=\\s+(vai|fica|ficou|precisa|tem|deve|pode|manda|envia|faz|cria|ve|cuida|entrega))`).test(f);
        });
        if (at) who = at[1];
        else if (named) who = named.name;
        else if (/^(eu\s+)?(vou|fico|faco|mando|envio|crio|preparo|reviso)\b/.test(f) && seg.who) who = seg.who;
        else if (/\b(responsavel|encarregad[oa])\s*:?\s*([\wÀ-ÿ]+)/.test(f)) who = /** @type {RegExpMatchArray} */ (sentence.match(/respons[aá]vel\s*:?\s*([\wÀ-ÿ]+)|encarregad[oa]\s*:?\s*([\wÀ-ÿ]+)/i))?.slice(1).find(Boolean) ?? null;
        if (who === 'eu' && seg.who) who = seg.who;
        const dueMatch = f.match(DUE_HINT);
        const due = dueMatch ? parseDue(dueMatch[0], todayKey) : null;
        const title = taskTitle(sentence);
        if (title.length >= 6 && (who || due || /\b(acao|tarefa|pendente|to-?do|responsavel)\b/.test(f) || /^(vou|vamos|precisamos|temos que)\b/.test(f))) {
          tasks.push({ title, who, due });
          continue;
        }
      }
      const words = sentence.split(/\s+/).length;
      if (words >= 6) scored.push({ text: sentence, score: (KEYWORDS.test(f) ? 3 : 0) + Math.min(words, 30) / 10 + (/\d/.test(f) ? 1 : 0), i: index });
    }
  }
  const summary = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .sort((a, b) => a.i - b.i)
    .map((s) => s.text.replace(/[.!…]+$/, ''));
  return {
    summary,
    decisions: dedupe(decisions),
    tasks: dedupeTasks(tasks).map((t) => ({ ...t, who: t.who ? (matchMember(t.who, members)?.name ?? t.who) : null })),
  };
}

/** @param {string[]} list */
function dedupe(list) {
  const seen = new Set();
  return list.filter((x) => {
    const k = fold(x).replace(/\W+/g, ' ').trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** @param {MinutesTask[]} list */
function dedupeTasks(list) {
  const seen = new Set();
  return list.filter((t) => {
    const k = fold(t.title).replace(/\W+/g, ' ').trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Junta as partes (um pedaço da transcrição por vez) sem repetir. @param {Minutes[]} parts @returns {Minutes} */
export function mergeMinutes(parts) {
  return {
    summary: dedupe(parts.flatMap((p) => p.summary)),
    decisions: dedupe(parts.flatMap((p) => p.decisions)),
    tasks: dedupeTasks(parts.flatMap((p) => p.tasks)),
  };
}

/** Formato que o modelo local precisa devolver (JSON com esquema). */
export const MINUTES_SCHEMA = {
  type: 'object',
  properties: {
    resumo: { type: 'array', items: { type: 'string' } },
    decisoes: { type: 'array', items: { type: 'string' } },
    tarefas: {
      type: 'array',
      items: {
        type: 'object',
        properties: { acao: { type: 'string' }, responsavel: { type: 'string' }, prazo: { type: 'string' } },
        required: ['acao', 'responsavel', 'prazo'],
      },
    },
  },
  required: ['resumo', 'decisoes', 'tarefas'],
};

export const MINUTES_SYSTEM =
  'Você é secretário de reuniões de uma pequena empresa de tecnologia no Brasil. Leia o trecho da transcrição e devolva SOMENTE JSON. ' +
  'resumo: de 2 a 5 frases curtas com o que foi tratado (fatos, números, nomes). decisoes: o que foi decidido ou combinado (vazio se nada). ' +
  'tarefas: cada compromisso concreto. Em "acao" vai O QUE será feito (verbo no infinitivo, ex.: "Fazer o layout do site") — nunca o nome da pessoa; ' +
  'em "responsavel" vai QUEM faz (nome citado, ou "" se ninguém foi citado); em "prazo" vai QUANDO, como foi dito (ex.: "sexta", "dia 28", "amanhã") ou "". ' +
  'Exemplo: "A Bia vai fazer o layout até sexta" vira {"acao": "Fazer o layout", "responsavel": "Bia", "prazo": "sexta"}. ' +
  'Não invente nada que não esteja no texto. Escreva em português do Brasil.';

/**
 * @param {string} chunk @param {{ title: string, date: string, team: string[], part: number, parts: number }} ctx
 */
export const minutesPrompt = (chunk, { title, date, team, part, parts }) =>
  `Reunião: ${title} (${date}). Equipe da empresa: ${team.join(', ') || 'não informada'}.` +
  `${parts > 1 ? ` Trecho ${part} de ${parts}.` : ''}\n\nTranscrição:\n${chunk}`;

/** Resumo final quando há muitos itens (vários trechos). @param {string[]} bullets */
export const condensePrompt = (bullets) =>
  `Junte estes pontos de uma mesma reunião em no máximo 6 frases curtas, sem repetir e sem inventar. Devolva JSON {"resumo": [...], "decisoes": [], "tarefas": []}.\n\n${bullets.map((b) => `- ${b}`).join('\n')}`;

/**
 * Resposta do modelo → Minutes (tolerante: tira <think>, cercas de código e lixo em volta do JSON).
 * @param {string} text @param {{ members: Member[], todayKey: string }} ctx @returns {Minutes}
 */
export function parseLlmMinutes(text, { members, todayKey }) {
  const clean = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('O modelo não devolveu a ata no formato esperado.');
  const data = JSON.parse(clean.slice(start, end + 1));
  const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim().replace(/^(decis[aã]o|resumo|tarefa)\s*:\s*/i, '')).filter((x) => x.length > 2).slice(0, 30) : []);
  const people = new Set(members.flatMap((m) => [fold(m.name), fold(m.name).split(/\s+/)[0]]));
  /** @type {MinutesTask[]} */
  const tasks = (Array.isArray(data.tarefas) ? data.tarefas : [])
    .map((/** @type {any} */ t) => {
      const title = String(t?.acao ?? t?.o_que ?? t?.tarefa ?? '').trim().replace(/[.!]+$/, '');
      const quem = String(t?.responsavel ?? t?.quem ?? '').trim();
      const prazo = String(t?.prazo ?? '').trim();
      const member = matchMember(quem, members);
      return { title: title.charAt(0).toUpperCase() + title.slice(1, 200), who: member ? member.name : quem && !/^(ninguem|nao|n\/a|-)$/i.test(fold(quem)) ? quem.slice(0, 80) : null, due: parseDue(prazo, todayKey) };
    })
    // Modelo pequeno às vezes põe o nome no lugar da ação: isso não é tarefa.
    .filter((/** @type {MinutesTask} */ t) => t.title.length > 3 && t.title.trim().includes(' ') && !people.has(fold(t.title)) && fold(t.title) !== fold(t.who ?? ''));
  return { summary: list(data.resumo), decisions: list(data.decisoes), tasks: dedupeTasks(tasks) };
}

/**
 * Ata → blocos da página. taskIds: título da tarefa → id da tarefa criada (vira tarefa de verdade).
 * @param {Minutes & { tasks: (MinutesTask & { taskId?: string })[] }} minutes
 * @param {{ participants: string[], engine: 'ai' | 'rules' }} ctx
 */
export function minutesToBlocks(minutes, { participants, engine }) {
  const blocks = [
    makeBlock('callout', plainRuns(engine === 'ai'
      ? 'Ata montada pela IA local a partir da transcrição. Revise antes de mandar para alguém.'
      : 'Ata montada por regras a partir da transcrição. Revise e complete o que faltar.'), { emoji: '🤖' }),
  ];
  if (participants.length) blocks.push(makeBlock('p', [{ t: 'Participantes: ', b: 1 }, { t: participants.join(', ') }]));
  blocks.push(makeBlock('h2', plainRuns('Resumo')));
  for (const s of minutes.summary.length ? minutes.summary : ['(nada destacado)']) blocks.push(makeBlock('ul', plainRuns(s)));
  blocks.push(makeBlock('h2', plainRuns('Decisões')));
  for (const d of minutes.decisions.length ? minutes.decisions : ['Nenhuma decisão registrada']) blocks.push(makeBlock('ul', plainRuns(d)));
  blocks.push(makeBlock('h2', plainRuns('Quem faz o quê')));
  if (!minutes.tasks.length) blocks.push(makeBlock('p', plainRuns('Nenhuma tarefa encontrada.')));
  for (const t of minutes.tasks) {
    const extra = t.taskId ? { taskId: t.taskId } : {};
    const suffix = !t.taskId && (t.who || t.due) ? ` — ${[t.who, t.due ? `até ${t.due.split('-').reverse().slice(0, 2).join('/')}` : ''].filter(Boolean).join(', ')}` : '';
    blocks.push(makeBlock('todo', plainRuns(`${t.title}${suffix}`), extra));
  }
  return blocks;
}
