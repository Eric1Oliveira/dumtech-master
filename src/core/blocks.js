// Conteúdo das páginas do Caderno: lista PLANA de blocos. O recuo (indent) faz a hierarquia:
// os filhos de um "alternar" são os blocos seguintes com recuo maior. Texto rico = lista de
// trechos (runs) com marcas — nunca HTML. Tudo passa por normalizeBlocks antes de salvar.

/**
 * @typedef {Object} Mention
 * @property {'user' | 'project' | 'customer' | 'page'} k
 * @property {string} id
 * @property {string} label
 */
/**
 * Trecho de texto. t = texto; b/i/u/s/c = negrito, itálico, sublinhado, riscado, código;
 * a = link (http, https, mailto ou #/); m = menção (o texto é o rótulo, ex.: "@Bia").
 * @typedef {{ t: string, b?: 1, i?: 1, u?: 1, s?: 1, c?: 1, a?: string, m?: Mention }} Run
 */
/**
 * @typedef {Object} Block
 * @property {string} id
 * @property {BlockType} type
 * @property {Run[]} [text]
 * @property {number} [indent]      0–4
 * @property {boolean} [checked]    tarefa simples (sem taskId)
 * @property {string} [taskId]      tarefa de verdade (tabela tasks)
 * @property {boolean} [open]       alternar aberto
 * @property {string} [emoji]       destaque
 * @property {{ path: string, name: string, mime: string | null, size: number }} [file]   imagem/arquivo (Storage)
 * @property {string} [pageId]      link para página
 * @property {string[][]} [rows]    tabela (texto simples)
 */
/** @typedef {'p' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'todo' | 'toggle' | 'quote' | 'callout' | 'code' | 'divider' | 'table' | 'image' | 'file' | 'page'} BlockType */

/** Menu "/" — ordem de exibição. md = atalho digitado no começo do bloco + espaço. */
export const BLOCK_TYPES = /** @type {const} */ ([
  { type: 'p', label: 'Texto', hint: 'Parágrafo comum', icon: 'T', keys: 'texto paragrafo' },
  { type: 'h1', label: 'Título 1', hint: 'Seção grande', icon: 'H1', md: '#', keys: 'titulo grande h1 cabecalho' },
  { type: 'h2', label: 'Título 2', hint: 'Seção média', icon: 'H2', md: '##', keys: 'titulo medio h2 subtitulo' },
  { type: 'h3', label: 'Título 3', hint: 'Seção pequena', icon: 'H3', md: '###', keys: 'titulo pequeno h3' },
  { type: 'ul', label: 'Lista', hint: 'Lista com marcadores', icon: '•', md: '-', keys: 'lista marcadores topicos bullet' },
  { type: 'ol', label: 'Lista numerada', hint: '1, 2, 3…', icon: '1.', md: '1.', keys: 'lista numerada numeros' },
  { type: 'todo', label: 'Tarefa', hint: 'Caixa de marcar; pode ter responsável e prazo', icon: '☐', md: '[]', keys: 'tarefa checklist todo caixa pendencia' },
  { type: 'toggle', label: 'Alternar', hint: 'Esconde o que está dentro', icon: '▸', md: '>>', keys: 'alternar toggle recolher esconder' },
  { type: 'quote', label: 'Citação', hint: 'Trecho em destaque lateral', icon: '❝', md: '>', keys: 'citacao frase' },
  { type: 'callout', label: 'Destaque', hint: 'Caixa com ícone', icon: '💡', keys: 'destaque aviso callout nota importante' },
  { type: 'code', label: 'Código', hint: 'Texto em fonte fixa', icon: '</>', md: '```', keys: 'codigo script' },
  { type: 'divider', label: 'Divisória', hint: 'Linha separadora', icon: '—', md: '---', keys: 'divisoria linha separador' },
  { type: 'table', label: 'Tabela', hint: 'Linhas e colunas', icon: '▦', keys: 'tabela planilha grade' },
  { type: 'image', label: 'Imagem', hint: 'Enviar uma imagem', icon: '🖼', keys: 'imagem foto print figura' },
  { type: 'file', label: 'Arquivo', hint: 'Anexar um arquivo', icon: '📎', keys: 'arquivo anexo pdf documento' },
  { type: 'page', label: 'Página', hint: 'Nova página dentro desta', icon: '📄', keys: 'subpagina pagina nova' },
]);

const TYPE_SET = new Set(BLOCK_TYPES.map((t) => t.type));
/** Blocos que têm texto editável. */
export const TEXT_TYPES = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'toggle', 'quote', 'callout', 'code']);
export const MAX_INDENT = 4;
const MAX_BLOCKS = 5000;
const MAX_TEXT = 20000;
const MARKS = /** @type {const} */ (['b', 'i', 'u', 's', 'c']);

/** Id curto e único o bastante para blocos. */
export const newBlockId = () => `b${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

/** Só links seguros: http(s), mailto e rotas internas (#/). @param {unknown} url */
export function safeHref(url) {
  const v = String(url ?? '').trim();
  if (!v) return null;
  if (/^#\//.test(v)) return v.slice(0, 500);
  if (/^mailto:[^\s]+$/i.test(v)) return v.slice(0, 500);
  if (/^https?:\/\/[^\s]+$/i.test(v)) return v.slice(0, 2000);
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`.slice(0, 2000);
  return null;
}

/** @param {Run} a @param {Run} b */
const sameMarks = (a, b) => !a.m && !b.m && MARKS.every((k) => Boolean(a[k]) === Boolean(b[k])) && (a.a ?? '') === (b.a ?? '');

/** Limpa e junta trechos vizinhos com as mesmas marcas. @param {unknown} input @returns {Run[]} */
export function cleanRuns(input) {
  /** @type {Run[]} */
  const out = [];
  let total = 0;
  for (const raw of Array.isArray(input) ? input : []) {
    if (!raw || typeof raw !== 'object') continue;
    let t = String(/** @type {any} */ (raw).t ?? '');
    if (!t) continue;
    if (total + t.length > MAX_TEXT) t = t.slice(0, MAX_TEXT - total);
    if (!t) break;
    /** @type {Run} */
    const run = { t };
    const r = /** @type {any} */ (raw);
    if (r.m && typeof r.m === 'object' && ['user', 'project', 'customer', 'page'].includes(r.m.k) && r.m.id) {
      run.m = { k: r.m.k, id: String(r.m.id).slice(0, 64), label: String(r.m.label ?? t).slice(0, 120) };
    } else {
      for (const k of MARKS) if (r[k]) run[k] = 1;
      const href = r.a ? safeHref(r.a) : null;
      if (href) run.a = href;
    }
    const last = out[out.length - 1];
    if (last && sameMarks(last, run)) last.t += run.t;
    else out.push(run);
    total += t.length;
  }
  return out;
}

/** @param {Run[]} runs */
export const runsLength = (runs) => runs.reduce((n, r) => n + r.t.length, 0);
/** @param {Run[] | undefined} runs */
export const runsText = (runs) => (runs ?? []).map((r) => r.t).join('');
/** @param {string} text @returns {Run[]} */
export const plainRuns = (text) => (text ? [{ t: text }] : []);

/**
 * Divide no deslocamento (em caracteres). Menção nunca é cortada: vai inteira para o lado mais perto.
 * @param {Run[]} runs @param {number} offset @returns {[Run[], Run[]]}
 */
export function splitRuns(runs, offset) {
  /** @type {Run[]} */
  const left = [];
  /** @type {Run[]} */
  const right = [];
  let pos = 0;
  for (const r of runs) {
    const end = pos + r.t.length;
    if (end <= offset) left.push({ ...r });
    else if (pos >= offset) right.push({ ...r });
    else if (r.m) (offset - pos < end - offset ? right : left).push({ ...r });
    else {
      left.push({ ...r, t: r.t.slice(0, offset - pos) });
      right.push({ ...r, t: r.t.slice(offset - pos) });
    }
    pos = end;
  }
  return [cleanRuns(left), cleanRuns(right)];
}

/** @param {Run[]} a @param {Run[]} b */
export const concatRuns = (a, b) => cleanRuns([...a, ...b]);

/** Recorta [start, end). @param {Run[]} runs @param {number} start @param {number} end */
export function sliceRuns(runs, start, end) {
  return splitRuns(splitRuns(runs, end)[0], start)[1];
}

/**
 * Liga/desliga uma marca no intervalo. Se todo o intervalo já tem a marca, tira; senão, põe.
 * mark 'a' recebe o endereço em value (null tira o link).
 * @param {Run[]} runs @param {number} start @param {number} end
 * @param {'b' | 'i' | 'u' | 's' | 'c' | 'a'} mark @param {string | null} [value]
 */
export function toggleMark(runs, start, end, mark, value) {
  if (end <= start) return runs;
  const [before, rest] = splitRuns(runs, start);
  const [middle, after] = splitRuns(rest, end - start);
  const textRuns = middle.filter((r) => !r.m);
  const all = textRuns.length > 0 && textRuns.every((r) => (mark === 'a' ? r.a : r[mark]));
  const changed = middle.map((r) => {
    if (r.m) return r;
    const copy = { ...r };
    if (mark === 'a') {
      const href = value ? safeHref(value) : null;
      if (href) copy.a = href;
      else delete copy.a;
    } else if (all) delete copy[mark];
    else copy[mark] = 1;
    return copy;
  });
  return cleanRuns([...before, ...changed, ...after]);
}

/** Marcas ativas em todo o intervalo (para a barra de formatação). @param {Run[]} runs @param {number} start @param {number} end */
export function marksIn(runs, start, end) {
  const part = sliceRuns(runs, start, end).filter((r) => !r.m);
  /** @type {Record<string, boolean>} */
  const on = {};
  for (const k of [...MARKS, 'a']) on[k] = part.length > 0 && part.every((r) => Boolean(/** @type {any} */ (r)[k]));
  return on;
}

/** Troca texto em [start, end) por outro (mantém as marcas de onde começa). @param {Run[]} runs @param {number} start @param {number} end @param {Run[]} insert */
export function replaceRange(runs, start, end, insert) {
  const [before, rest] = splitRuns(runs, start);
  const after = splitRuns(rest, end - start)[1];
  return cleanRuns([...before, ...insert, ...after]);
}

/** @param {BlockType} type @param {Run[]} [text] @param {Partial<Block>} [extra] @returns {Block} */
export function makeBlock(type, text = [], extra = {}) {
  /** @type {Block} */
  const b = { id: newBlockId(), type, ...extra };
  if (TEXT_TYPES.has(type)) b.text = text;
  if (type === 'toggle' && b.open === undefined) b.open = true;
  if (type === 'callout' && !b.emoji) b.emoji = '💡';
  if (type === 'table' && !b.rows) b.rows = [['', ''], ['', '']];
  return b;
}

/**
 * Valida o que vai para o banco: tipos conhecidos, ids únicos, textos limpos, links seguros.
 * @param {unknown} input @returns {Block[]}
 */
export function normalizeBlocks(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  /** @type {Block[]} */
  const out = [];
  for (const raw of input.slice(0, MAX_BLOCKS)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = /** @type {any} */ (raw);
    if (!TYPE_SET.has(r.type)) continue;
    let id = typeof r.id === 'string' && /^[\w-]{3,40}$/.test(r.id) ? r.id : newBlockId();
    while (seen.has(id)) id = newBlockId();
    seen.add(id);
    /** @type {Block} */
    const b = { id, type: r.type };
    const indent = Math.max(0, Math.min(MAX_INDENT, Math.trunc(Number(r.indent) || 0)));
    if (indent) b.indent = indent;
    if (TEXT_TYPES.has(b.type)) b.text = cleanRuns(r.text);
    if (b.type === 'todo') {
      if (r.checked) b.checked = true;
      if (typeof r.taskId === 'string' && /^[0-9a-f-]{36}$/i.test(r.taskId)) b.taskId = r.taskId;
    }
    if (b.type === 'toggle') b.open = r.open !== false;
    if (b.type === 'callout') b.emoji = String(r.emoji || '💡').slice(0, 8);
    if ((b.type === 'image' || b.type === 'file') && r.file && typeof r.file.path === 'string') {
      b.file = { path: r.file.path.slice(0, 400), name: String(r.file.name ?? 'arquivo').slice(0, 200), mime: r.file.mime ? String(r.file.mime).slice(0, 120) : null, size: Math.max(0, Number(r.file.size) || 0) };
    }
    if (b.type === 'page' && typeof r.pageId === 'string' && /^[0-9a-f-]{36}$/i.test(r.pageId)) b.pageId = r.pageId;
    if (b.type === 'table') {
      const rows = Array.isArray(r.rows) ? r.rows.slice(0, 100) : [];
      const cols = Math.max(1, Math.min(12, ...rows.map((/** @type {any} */ row) => (Array.isArray(row) ? row.length : 0))));
      b.rows = rows.length ? rows.map((/** @type {any} */ row) => Array.from({ length: cols }, (_, i) => String((Array.isArray(row) ? row[i] : '') ?? '').slice(0, 2000))) : [['', ''], ['', '']];
    }
    if ((b.type === 'image' || b.type === 'file') && !b.file) continue;
    if (b.type === 'page' && !b.pageId) continue;
    out.push(b);
  }
  return out;
}

/** Texto simples das páginas (busca e DUM AI). @param {Block[]} blocks */
export function blocksToText(blocks) {
  return blocks
    .map((b) => {
      if (TEXT_TYPES.has(b.type)) return runsText(b.text);
      if (b.type === 'table') return (b.rows ?? []).map((r) => r.join(' ')).join('\n');
      if (b.file) return b.file.name;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/** Número de cada item de lista numerada (conta os vizinhos no mesmo recuo). @param {Block[]} blocks */
export function listNumbers(blocks) {
  /** @type {Map<string, number>} */
  const numbers = new Map();
  /** @type {number[]} */
  const counter = [];
  for (const b of blocks) {
    const level = b.indent ?? 0;
    counter.length = level + 1;
    if (b.type === 'ol') {
      counter[level] = (counter[level] ?? 0) + 1;
      numbers.set(b.id, counter[level]);
    } else {
      counter[level] = 0;
    }
  }
  return numbers;
}

/** Ids escondidos por um "alternar" fechado. @param {Block[]} blocks */
export function hiddenIds(blocks) {
  const hidden = new Set();
  /** @type {number | null} */
  let closedAt = null;
  for (const b of blocks) {
    const level = b.indent ?? 0;
    if (closedAt !== null && level > closedAt) {
      hidden.add(b.id);
      continue;
    }
    closedAt = b.type === 'toggle' && !b.open ? level : null;
  }
  return hidden;
}

/** O bloco e os que estão "dentro" dele (recuo maior logo depois). @param {Block[]} blocks @param {number} index */
export function blockSpan(blocks, index) {
  const level = blocks[index]?.indent ?? 0;
  let end = index + 1;
  while (end < blocks.length && (blocks[end].indent ?? 0) > level) end += 1;
  return end - index;
}

/** @param {Run[] | undefined} runs */
const runsMarkdown = (runs) =>
  (runs ?? [])
    .map((r) => {
      let t = r.t;
      if (r.m) return t;
      if (r.c) t = `\`${t}\``;
      if (r.b) t = `**${t}**`;
      if (r.i) t = `*${t}*`;
      if (r.s) t = `~~${t}~~`;
      if (r.a) t = `[${t}](${r.a})`;
      return t;
    })
    .join('');

/** Exporta em Markdown. @param {Block[]} blocks @param {string} title */
export function blocksToMarkdown(blocks, title) {
  const numbers = listNumbers(blocks);
  const lines = title ? [`# ${title}`, ''] : [];
  for (const b of blocks) {
    const pad = '  '.repeat(b.indent ?? 0);
    const text = runsMarkdown(b.text);
    switch (b.type) {
      case 'h1': lines.push('', `## ${text}`); break;
      case 'h2': lines.push('', `### ${text}`); break;
      case 'h3': lines.push('', `#### ${text}`); break;
      case 'ul': lines.push(`${pad}- ${text}`); break;
      case 'ol': lines.push(`${pad}${numbers.get(b.id) ?? 1}. ${text}`); break;
      case 'todo': lines.push(`${pad}- [${b.checked ? 'x' : ' '}] ${text}`); break;
      case 'toggle': lines.push(`${pad}- ${text}`); break;
      case 'quote': lines.push(`> ${text}`); break;
      case 'callout': lines.push(`> ${b.emoji ?? ''} ${text}`); break;
      case 'code': lines.push('```', runsText(b.text), '```'); break;
      case 'divider': lines.push('', '---', ''); break;
      case 'table': {
        const rows = b.rows ?? [];
        if (rows.length) {
          lines.push('', `| ${rows[0].join(' | ')} |`, `|${rows[0].map(() => ' --- ').join('|')}|`);
          for (const row of rows.slice(1)) lines.push(`| ${row.join(' | ')} |`);
          lines.push('');
        }
        break;
      }
      case 'image': case 'file': lines.push(`${pad}[${b.file?.name ?? 'arquivo'}]`); break;
      case 'page': lines.push(`${pad}[página]`); break;
      default: lines.push(pad + text);
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/**
 * Texto colado (várias linhas) → blocos, entendendo marcadores comuns.
 * @param {string} text @returns {Block[]}
 */
export function textToBlocks(text) {
  /** @type {Block[]} */
  const out = [];
  for (const raw of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\t/g, '  ');
    if (!line.trim()) continue;
    const indent = Math.min(MAX_INDENT, Math.floor((line.match(/^ */)?.[0].length ?? 0) / 2));
    const t = line.trim();
    /** @type {[RegExp, BlockType, Partial<Block>?][]} */
    const rules = [
      [/^#\s+/, 'h1'], [/^##\s+/, 'h2'], [/^###+\s+/, 'h3'],
      [/^[-*•]\s+\[[xX]\]\s+/, 'todo', { checked: true }], [/^[-*•]?\s*\[\s?\]\s+/, 'todo'],
      [/^[-*•]\s+/, 'ul'], [/^\d+[.)]\s+/, 'ol'], [/^>\s+/, 'quote'],
    ];
    const hit = rules.find(([re]) => re.test(t));
    if (hit) out.push(makeBlock(hit[1], plainRuns(t.replace(hit[0], '')), { ...(hit[2] ?? {}), ...(indent ? { indent } : {}) }));
    else if (/^-{3,}$/.test(t)) out.push(makeBlock('divider'));
    else out.push(makeBlock('p', plainRuns(t), indent ? { indent } : {}));
  }
  return out;
}

/** @param {string} text */
const h2 = (text) => makeBlock('h2', plainRuns(text));
/** @param {string} text @param {BlockType} [type] */
const line = (text, type = 'p') => makeBlock(type, plainRuns(text));
/** @param {string} text */
const todo = (text) => makeBlock('todo', plainRuns(text));

/** Modelos prontos. blocks() gera ids novos a cada uso. */
export const TEMPLATES = [
  {
    id: 'meeting', title: 'Ata de reunião', icon: '🎙️', kind: /** @type {const} */ ('meeting'), hint: 'Grave ou cole a conversa; a ata e as tarefas saem sozinhas',
    blocks: () => [],
  },
  {
    id: 'briefing', title: 'Briefing de projeto', icon: '🧭', kind: /** @type {const} */ ('page'), hint: 'Objetivo, público, referências e entregas',
    blocks: () => [
      makeBlock('callout', plainRuns('Preencha com o cliente na primeira conversa. O que estiver vago vira pergunta.'), { emoji: '🧭' }),
      h2('Sobre o cliente'), line('Empresa, ramo e o que vende.'),
      h2('Objetivo'), line('O que o site/sistema precisa resolver?', 'ul'),
      h2('Público'), line('Quem vai usar? De onde vem?', 'ul'),
      h2('Referências'), line('Sites que o cliente gosta (e por quê).', 'ul'),
      h2('Páginas e funções'), todo('Início'), todo('Sobre'), todo('Contato com WhatsApp'),
      h2('Prazos e valores'), line('Implantação, mensalidade e data de entrega.'),
      h2('Dúvidas em aberto'), line('', 'ul'),
    ],
  },
  {
    id: 'launch', title: 'Checklist de publicação', icon: '🚀', kind: /** @type {const} */ ('page'), hint: 'Tudo o que conferir antes de pôr no ar',
    blocks: () => [
      h2('Conteúdo'), todo('Textos revisados (ortografia e telefones)'), todo('Imagens leves e com texto alternativo'), todo('Política de privacidade'),
      h2('Técnico'), todo('Domínio apontado e HTTPS ativo'), todo('Formulários testados de ponta a ponta'), todo('Abre bem no celular'), todo('Google Search Console e Analytics'),
      h2('Entrega'), todo('Acessos guardados em Senhas'), todo('Cliente treinado'), todo('Mensalidade ativa em Clientes'),
    ],
  },
  {
    id: 'onboarding', title: 'Onboarding de cliente', icon: '🤝', kind: /** @type {const} */ ('page'), hint: 'Primeiros passos depois do fechamento',
    blocks: () => [
      h2('Boas-vindas'), todo('Mensagem de boas-vindas no WhatsApp'), todo('Grupo ou canal de contato combinado'),
      h2('Acessos que o cliente envia'), todo('Logo em boa resolução'), todo('Acesso ao domínio'), todo('Fotos e textos'),
      h2('Combinados'), line('Horário de atendimento, prazo de resposta, forma de pagamento.'),
    ],
  },
  {
    id: 'blank', title: 'Página em branco', icon: '📄', kind: /** @type {const} */ ('page'), hint: 'Comece do zero',
    blocks: () => [],
  },
];
