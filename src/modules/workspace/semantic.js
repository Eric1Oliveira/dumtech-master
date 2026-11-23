// Busca pelo sentido no Caderno: acha páginas e reuniões mesmo sem a palavra exata
// ("aquela reunião sobre preço"). Vetores calculados no navegador (paraphrase-multilingual-MiniLM, WASM:
// funciona sem placa de vídeo) e guardados na memória da aba. Nada sai do computador.

import { data } from '../../services/data.js';
import { blocksToText } from '../../core/blocks.js';
import { transcriptText } from '../../core/minutes.js';
import { confirmDialog } from '../../shared/components/dialog.js';
import { embedder, accepted, accept, aiLevel } from './ai.js';

/** @typedef {{ id: string, stamp: string, title: string, text: string }} Doc */

/** @type {Map<string, Doc>} */
const texts = new Map();
/** Vetores de cada página, um por trecho (o modelo lê ~100 palavras por vez). @type {Map<string, { stamp: string, vecs: number[][] }>} */
const vectors = new Map();
const CHUNK = 450;
const MAX_CHUNKS = 12;

/** Trechos de até ~450 letras, cortados entre palavras; o título abre o primeiro. @param {Doc} d @returns {string[]} */
function chunks(d) {
  /** @type {string[]} */
  const out = [];
  let cur = d.title.trim();
  for (const word of d.text.split(/\s+/)) {
    if (!word) continue;
    if (cur && cur.length + word.length + 1 > CHUNK) {
      out.push(cur);
      cur = '';
      if (out.length === MAX_CHUNKS) return out;
    }
    cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) out.push(cur);
  return out.length ? out : ['Sem título'];
}

/** Texto das páginas (busca no servidor só o que mudou). @param {string} orgId @param {{ id: string, updatedAt: string }[]} metas @returns {Promise<Doc[]>} */
export async function pageTexts(orgId, metas) {
  const todo = metas.filter((m) => texts.get(m.id)?.stamp !== m.updatedAt).slice(0, 120);
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(
      todo.slice(i, i + 6).map(async (m) => {
        const p = await data.pages.get(orgId, m.id).catch(() => null);
        if (!p) return;
        const transcript = p.meeting?.transcript?.length ? `\n${transcriptText(p.meeting.transcript)}` : '';
        texts.set(m.id, { id: m.id, stamp: m.updatedAt, title: p.title.trim() || 'Sem título', text: `${blocksToText(p.content)}${transcript}` });
      }),
    );
  }
  return metas.map((m) => texts.get(m.id)).filter((d) => d !== undefined);
}

/** Pode usar (pergunta uma vez antes de baixar ~120 MB)? */
export async function semanticAllowed() {
  if (aiLevel() === 'off') return false;
  if (accepted('embed')) return true;
  if (sessionStorage.getItem('dum.embed.no')) return false;
  const ok = await confirmDialog({
    title: 'Ligar a busca pelo sentido?',
    message: 'Na primeira vez o Master baixa um modelo pequeno (cerca de 120 MB) que entende o sentido do texto. Ele roda aqui no navegador, até sem placa de vídeo.',
    confirmLabel: 'Baixar e buscar',
  });
  if (ok) accept('embed');
  else sessionStorage.setItem('dum.embed.no', '1');
  return ok;
}

const dot = (/** @type {number[]} */ a, /** @type {number[]} */ b) => {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
};

/**
 * Ordena pelo sentido: nota de 0 a 1 do trecho mais parecido da página (acima de ~0,33 já é do assunto).
 * @param {string} query @param {Doc[]} docs @param {(text: string, pct: number | null) => void} [onStatus]
 */
export async function semanticRank(query, docs, onStatus) {
  await embedder.load(onStatus ?? (() => {}));
  const missing = docs.filter((d) => vectors.get(d.id)?.stamp !== d.stamp);
  if (missing.length) {
    onStatus?.(`Lendo ${missing.length} página${missing.length === 1 ? '' : 's'}…`, null);
    const parts = missing.map(chunks);
    const vecs = await embedder.embed(parts.flat());
    let at = 0;
    missing.forEach((d, i) => {
      vectors.set(d.id, { stamp: d.stamp, vecs: vecs.slice(at, at + parts[i].length) });
      at += parts[i].length;
    });
  }
  const [q] = await embedder.embed([query]);
  return docs
    .map((d) => {
      const vecs = vectors.get(d.id)?.vecs ?? [];
      return { ...d, score: vecs.length ? Math.max(...vecs.map((v) => dot(q, v))) : 0 };
    })
    .sort((a, b) => b.score - a.score);
}
