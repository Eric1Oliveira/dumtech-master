// Pedidos (prompts) da IA local para escrever: Caderno (perguntar, reescrever, rascunho), proposta,
// mensagem de cobrança, resumo da semana e "explicar" do DUM AI. Os números vêm sempre do sistema;
// a IA só escreve o texto em volta. Tudo puro — testado em tests/core.test.js.

import { fold } from './minutes.js';

/** @typedef {{ role: 'system' | 'user', content: string }} Msg */

const BASE = 'Você escreve em português do Brasil para a DUMTech, uma pequena empresa de sites e sistemas. '
  + 'Seja claro, direto e natural. Não invente fatos, números, nomes ou datas que não estejam no texto dado. '
  + 'Responda só com o texto pedido, sem introdução nem comentários.';

/** Tira "pensamento", cercas de código e aspas em volta. @param {unknown} text */
export const cleanAi = (text) =>
  String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*```[a-z]*\s*\n?|\n?```\s*$/gi, '')
    .trim()
    .replace(/^"([\s\S]*)"$/, '$1')
    .trim();

/** O que dá para pedir sobre um texto selecionado. */
export const REWRITE = [
  { key: 'improve', label: 'Melhorar a escrita', ask: 'Reescreva o texto melhorando clareza, ortografia e fluidez, sem mudar o sentido.' },
  { key: 'shorter', label: 'Resumir', ask: 'Resuma o texto em poucas frases, mantendo o essencial.' },
  { key: 'longer', label: 'Desenvolver mais', ask: 'Desenvolva o texto com mais detalhes úteis, sem inventar fatos.' },
  { key: 'formal', label: 'Deixar mais formal', ask: 'Reescreva o texto em tom profissional e formal.' },
  { key: 'friendly', label: 'Deixar mais simpático', ask: 'Reescreva o texto em tom simpático e próximo, sem gírias.' },
  { key: 'tasks', label: 'Virar lista de tarefas', ask: 'Transforme o texto em uma lista de tarefas, uma por linha, cada linha começando com "[] " e um verbo no infinitivo.' },
  { key: 'english', label: 'Traduzir para inglês', ask: 'Traduza o texto para o inglês.' },
  { key: 'continue', label: 'Continuar escrevendo', ask: 'Continue o texto com mais um ou dois parágrafos no mesmo tom. Devolva só a continuação.' },
];

/** @param {string} key @param {string} text @returns {Msg[]} */
export function rewriteMessages(key, text) {
  const r = REWRITE.find((x) => x.key === key) ?? REWRITE[0];
  return [{ role: 'system', content: BASE }, { role: 'user', content: `${r.ask}\n\nTexto:\n${text.slice(0, 6000)}` }];
}

/** Rascunho de página a partir do título. @param {string} title @param {string} [context] @returns {Msg[]} */
export function draftMessages(title, context = '') {
  return [
    { role: 'system', content: BASE },
    {
      role: 'user',
      content: `Escreva o rascunho de uma página interna chamada "${title}". Use seções com títulos começando por "## ", `
        + 'listas com "- " e tarefas com "[] " quando fizer sentido. Deixe lacunas como "(preencher)" onde faltar informação. '
        + `Máximo de 30 linhas.${context ? `\n\nO que já está na página:\n${context.slice(0, 3000)}` : ''}`,
    },
  ];
}

/** Resumo ou tarefas de uma página inteira. @param {'summary' | 'tasks'} mode @param {string} title @param {string} text @returns {Msg[]} */
export function pageMessages(mode, title, text) {
  const ask = mode === 'tasks'
    ? 'Liste as tarefas concretas que aparecem nesta página, uma por linha, começando com "[] ". Se tiver responsável ou prazo, inclua no fim da linha.'
    : 'Resuma esta página em até 5 tópicos curtos, cada um começando com "- ".';
  return [{ role: 'system', content: BASE }, { role: 'user', content: `${ask}\n\nPágina "${title}":\n${text.slice(0, 7000)}` }];
}

/**
 * Páginas mais ligadas à pergunta (palavras que aparecem no título valem mais).
 * @template {{ id: string, title: string, text: string }} T
 * @param {string} question @param {T[]} pages @returns {T[]}
 */
export function scorePages(question, pages) {
  const STOP = new Set(['que', 'qual', 'quais', 'como', 'quando', 'onde', 'para', 'com', 'sobre', 'ficou', 'foi', 'uma', 'umas', 'uns', 'dos', 'das', 'nos', 'nas', 'pelo', 'pela', 'isso', 'esse', 'essa', 'tem', 'ter']);
  const words = [...new Set(fold(question).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)))];
  return pages
    .map((p) => {
      const t = fold(p.title);
      const body = fold(p.text);
      const score = words.reduce((s, w) => s + (t.includes(w) ? 3 : 0) + Math.min(5, body.split(w).length - 1), 0);
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
}

/** Pergunta ao Caderno com as fontes. @param {string} question @param {{ title: string, text: string }[]} sources @returns {Msg[]} */
export function askMessages(question, sources) {
  const ctx = sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.text.slice(0, 2200)}`).join('\n\n');
  return [
    { role: 'system', content: `${BASE} Responda usando só as páginas dadas. Cite a fonte como [1], [2]. Se a resposta não estiver nas páginas, diga que não encontrou.` },
    { role: 'user', content: `Pergunta: ${question}\n\nPáginas do Caderno:\n${ctx}` },
  ];
}

/** Texto das observações da proposta. @param {{ customer: string, title: string, notes: string, items: string[] }} p @returns {Msg[]} */
export function proposalMessages({ customer, title, notes, items }) {
  return [
    { role: 'system', content: BASE },
    {
      role: 'user',
      content: `Escreva as "Observações e condições" de uma proposta comercial de ${title || 'site/sistema'} para ${customer || 'o cliente'}. `
        + 'Inclua: o que será entregue, prazo estimado (só se aparecer nas anotações), forma de pagamento (só se aparecer), o que não está incluso e próximos passos. '
        + `Até 12 linhas, tom profissional e simpático.\n\nItens da proposta: ${items.join(', ') || 'ainda sem itens'}\n\nAnotações da conversa:\n${notes.slice(0, 5000)}`,
    },
  ];
}

export const PROPOSAL_ITEMS_SCHEMA = { type: 'object', properties: { itens: { type: 'array', items: { type: 'string' } } }, required: ['itens'] };

/** Itens da tabela de preços que combinam com a conversa. @param {string} notes @param {string[]} catalog @returns {Msg[]} */
export function proposalItemsMessages(notes, catalog) {
  return [
    { role: 'system', content: 'Devolva SOMENTE JSON {"itens": [...]} com nomes copiados exatamente da lista dada. Não invente itens.' },
    { role: 'user', content: `Tabela de preços: ${catalog.join(' | ')}\n\nQuais itens combinam com esta conversa?\n${notes.slice(0, 4000)}` },
  ];
}

/** Nomes que a IA devolveu → itens da tabela (só os que existem). @template {{ name: string }} T @param {string} text @param {T[]} catalog @returns {T[]} */
export function pickCatalog(text, catalog) {
  let names = [];
  try {
    const clean = cleanAi(text);
    names = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1)).itens ?? [];
  } catch {
    return [];
  }
  const seen = new Set();
  return names
    .map((n) => catalog.find((c) => fold(c.name) === fold(String(n))))
    .filter((c) => c && !seen.has(c.name) && seen.add(c.name));
}

export const BILLING_TONES = [
  { value: 'gentle', label: 'Lembrete gentil (antes de vencer)' },
  { value: 'due', label: 'Vence hoje' },
  { value: 'late', label: 'Atrasado (firme e educado)' },
  { value: 'last', label: 'Último aviso antes de suspender' },
];

/** Mensagem de WhatsApp de cobrança. @param {{ cliente: string, projeto: string, valor: string, vencimento: string, diasAtraso: number, pix?: string | null, tom: string }} b @returns {Msg[]} */
export function billingMessages({ cliente, projeto, valor, vencimento, diasAtraso, pix, tom }) {
  const tone = BILLING_TONES.find((t) => t.value === tom)?.label ?? BILLING_TONES[0].label;
  return [
    { role: 'system', content: `${BASE} Escreva mensagens curtas de WhatsApp (até 5 linhas), sem emojis.` },
    {
      role: 'user',
      content: `Escreva uma mensagem de cobrança da mensalidade. Tom: ${tone}.\nCliente: ${cliente}\nServiço: ${projeto}\nValor: ${valor}\nVencimento: ${vencimento}`
        + `${diasAtraso > 0 ? `\nDias de atraso: ${diasAtraso}` : ''}${pix ? `\nChave Pix: ${pix}` : ''}\nAssine como "Equipe DUMTech".`,
    },
  ];
}

/** Resumo da semana a partir de fatos já calculados. @param {string[]} facts @returns {Msg[]} */
export function weekMessages(facts) {
  return [
    { role: 'system', content: `${BASE} Use os números exatamente como vieram.` },
    { role: 'user', content: `Escreva um resumo da semana da empresa em 1 parágrafo curto e depois até 4 tópicos "- " com o que fazer primeiro.\n\nFatos:\n${facts.map((f) => `- ${f}`).join('\n')}` },
  ];
}

/** "Explicar com IA" no DUM AI. @param {string} question @param {string[]} facts @returns {Msg[]} */
export function explainMessages(question, facts) {
  return [
    { role: 'system', content: `${BASE} Explique em até 6 linhas, usando só os dados dados e os números exatamente como vieram. Sugira o próximo passo.` },
    { role: 'user', content: `Pergunta: ${question}\n\nDados do sistema:\n${facts.map((f) => `- ${f}`).join('\n') || '- (nenhum dado)'}` },
  ];
}
