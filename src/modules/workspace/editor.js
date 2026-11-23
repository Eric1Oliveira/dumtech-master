// Editor de blocos do Caderno (estilo Notion), sem biblioteca: um contenteditable por bloco.
// O modelo é a lista de blocos (src/core/blocks.js); o DOM é só a vista. Digitar texto passa pelo
// navegador e é relido do DOM; todo o resto (Enter, Backspace, recuo, formatação, menus, colar,
// arrastar, desfazer) muda o modelo e redesenha. Texto rico nunca vira HTML salvo.

import { escapeHtml } from '../../shared/utils/dom.js';
import { icon } from '../../shared/components/icons.js';
import { pageIconName } from '../../core/notebook.js';
import {
  BLOCK_TYPES, CALLOUT_TONES, TEXT_TYPES, MAX_INDENT, makeBlock, cleanRuns, splitRuns, concatRuns, replaceRange, toggleMark, marksIn,
  runsText, runsLength, plainRuns, listNumbers, hiddenIds, blockSpan, textToBlocks, safeHref, normalizeBlocks,
} from '../../core/blocks.js';
import { fold } from '../../core/minutes.js';
import { formatBytes } from '../../core/workspace.js';
import { formatDate } from '../../shared/utils/format.js';

/** @typedef {import('../../core/blocks.js').Block} Block */
/** @typedef {import('../../core/blocks.js').Run} Run */
/**
 * @typedef {Object} EditorContext
 * @property {(query: string) => { k: 'user' | 'project' | 'customer' | 'page', id: string, label: string, sub?: string }[]} mentionItems
 * @property {(path: string) => Promise<string>} fileUrl
 * @property {(file: File) => Promise<{ path: string, name: string, mime: string | null, size: number } | null>} upload
 * @property {(file: { path: string, name: string }) => void} openFile
 * @property {(id: string) => { title: string, icon: string } | null} pageInfo
 * @property {() => Promise<string | null>} newSubpage
 * @property {(taskId: string) => { status: string, assigneeName: string, dueDate: string | null } | null} taskInfo
 * @property {(taskId: string, done: boolean) => Promise<void>} setTaskDone
 * @property {(block: Block) => Promise<string | null>} editTask   cria/edita a tarefa de verdade; devolve o id
 * @property {(current: string | null) => Promise<string | null | undefined>} askLink   undefined = cancelou
 * @property {boolean} canTasks
 * @property {() => void} onSave   Ctrl+S
 */

const esc = escapeHtml;
const PLACEHOLDER = /** @type {Record<string, string>} */ ({
  p: "Digite '/' para blocos, '@' para mencionar", h1: 'Título 1', h2: 'Título 2', h3: 'Título 3', ul: 'Item', ol: 'Item',
  todo: 'Tarefa', toggle: 'Alternar', quote: 'Citação', callout: 'Escreva algo em destaque', code: 'Código',
});
const MD = /** @type {[string, import('../../core/blocks.js').BlockType, Partial<Block>?][]} */ ([
  ['###', 'h3'], ['##', 'h2'], ['#', 'h1'], ['-', 'ul'], ['*', 'ul'], ['•', 'ul'], ['1.', 'ol'], ['[]', 'todo'], ['[ ]', 'todo'],
  ['[x]', 'todo', { checked: true }], ['>>', 'toggle'], ['>', 'quote'], ['```', 'code'],
]);
/** Ícone de linha como texto (o editor monta HTML em string). @param {any} name */
const svg = (name) => String(icon(name));
const MENTION_ICON = /** @type {Record<string, string>} */ ({ user: 'user', project: 'folder', customer: 'building', page: 'fileText' });

/** Trechos → HTML seguro (tudo escapado; links passam por safeHref). @param {Run[] | undefined} runs */
function runsHtml(runs) {
  const list = runs ?? [];
  const out = list
    .map((r) => {
      if (r.m) return `<span class="mention mention--${r.m.k}" contenteditable="false" data-k="${r.m.k}" data-id="${esc(r.m.id)}" data-label="${esc(r.m.label)}">${esc(r.t)}</span>`;
      let s = esc(r.t);
      if (r.c) s = `<code>${s}</code>`;
      if (r.b) s = `<strong>${s}</strong>`;
      if (r.i) s = `<em>${s}</em>`;
      if (r.u) s = `<u>${s}</u>`;
      if (r.s) s = `<s>${s}</s>`;
      if (r.a) s = `<a href="${esc(r.a)}" target="_blank" rel="noopener noreferrer">${s}</a>`;
      return s;
    })
    .join('');
  // Quebra no fim não aparece sem um <br> de enchimento.
  return runsText(list).endsWith('\n') ? `${out}<br data-fill="1">` : out;
}

/** DOM do bloco → trechos. @param {Element} el @returns {Run[]} */
function parseRuns(el) {
  /** @type {any[]} */
  const out = [];
  /** @param {Node} node @param {Record<string, any>} marks */
  const walk = (node, marks) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = /** @type {Text} */ (child).data.replace(/ /g, ' ').replace(/​/g, '');
        if (t) out.push({ t, ...marks });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const e = /** @type {HTMLElement} */ (child);
      if (e.tagName === 'BR') {
        if (!e.dataset.fill) out.push({ t: '\n', ...marks });
        continue;
      }
      if (e.classList.contains('mention')) {
        out.push({ t: e.textContent ?? '', m: { k: e.dataset.k, id: e.dataset.id, label: e.dataset.label } });
        continue;
      }
      const m = { ...marks };
      const tag = e.tagName;
      if (tag === 'B' || tag === 'STRONG' || Number(e.style.fontWeight) >= 600 || e.style.fontWeight === 'bold') m.b = 1;
      if (tag === 'I' || tag === 'EM' || e.style.fontStyle === 'italic') m.i = 1;
      if (tag === 'U' || e.style.textDecorationLine?.includes('underline')) m.u = 1;
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || e.style.textDecorationLine?.includes('line-through')) m.s = 1;
      if (tag === 'CODE') m.c = 1;
      if (tag === 'A') {
        const href = safeHref(e.getAttribute('href'));
        if (href) m.a = href;
      }
      if ((tag === 'DIV' || tag === 'P') && out.length && !String(out[out.length - 1].t).endsWith('\n')) out.push({ t: '\n', ...marks });
      walk(e, m);
    }
  };
  walk(el, {});
  return cleanRuns(out);
}

/** Posição do cursor (em caracteres do modelo) dentro de el. @param {Element} el */
function selectionIn(el) {
  const sel = getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  pre.setEnd(r.endContainer, r.endOffset);
  return { start, end: pre.toString().length, collapsed: r.collapsed };
}

/** Ponto do DOM para um deslocamento (pula para fora das menções). @param {Element} el @param {number} offset */
function pointAt(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let left = Math.max(0, offset);
  /** @type {Node | null} */
  let node;
  while ((node = walker.nextNode())) {
    const len = /** @type {Text} */ (node).data.length;
    const chip = /** @type {Element} */ (node.parentNode)?.closest?.('.mention');
    if (left <= len) {
      if (chip && el.contains(chip)) {
        const r = document.createRange();
        if (left === 0) r.setStartBefore(chip);
        else r.setStartAfter(chip);
        return { node: r.startContainer, offset: r.startOffset };
      }
      return { node, offset: left };
    }
    left -= len;
  }
  return { node: el, offset: el.childNodes.length - (el.lastChild && /** @type {HTMLElement} */ (el.lastChild).dataset?.fill ? 1 : 0) };
}

/** @param {Element} el @param {number} start @param {number} [end] */
function setSelection(el, start, end = start) {
  const sel = getSelection();
  if (!sel) return;
  const a = pointAt(el, start);
  const b = end === start ? a : pointAt(el, end);
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Retângulo do cursor (para posicionar menus). */
function caretRect() {
  const sel = getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0).cloneRange();
  const rects = r.getClientRects();
  if (rects.length) return rects[rects.length - 1];
  const node = r.startContainer.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (r.startContainer) : r.startContainer.parentElement;
  return node?.getBoundingClientRect() ?? null;
}

/**
 * @param {HTMLElement} host
 * @param {{ blocks: Block[], readOnly?: boolean, ctx: EditorContext, onChange: (blocks: Block[]) => void }} options
 */
export function createEditor(host, { blocks: initial, readOnly = false, ctx, onChange }) {
  /** @type {Block[]} */
  let blocks = normalizeBlocks(initial);
  let ro = readOnly;
  /** @type {string[]} */
  const past = [];
  /** @type {string[]} */
  const future = [];
  let stable = JSON.stringify(blocks);
  let lastTyping = 0;
  let composing = false;
  /** @type {{ el: HTMLElement, kind: 'slash' | 'mention' | 'block', items: any[], index: number, blockId: string, query: string, noSlash?: boolean } | null} */
  let menu = null;
  /** @type {HTMLElement | null} */
  let toolbar = null;
  /** @type {string | null} */
  let dragId = null;
  const urlCache = new Map();
  const ac = new AbortController();
  const on = (/** @type {EventTarget} */ target, /** @type {string} */ type, /** @type {any} */ fn) => target.addEventListener(type, fn, { signal: ac.signal });

  host.classList.add('ed');
  if (!blocks.length && !ro) blocks = [makeBlock('p')];

  const indexOf = (/** @type {string} */ id) => blocks.findIndex((b) => b.id === id);
  const blockEl = (/** @type {string} */ id) => /** @type {HTMLElement | null} */ (host.querySelector(`.ed-b[data-id="${id}"]`));
  const textEl = (/** @type {string} */ id) => /** @type {HTMLElement | null} */ (blockEl(id)?.querySelector('.ed-text') ?? null);
  const visibleTextBlocks = () => {
    const hidden = hiddenIds(blocks);
    return blocks.filter((b) => TEXT_TYPES.has(b.type) && !hidden.has(b.id));
  };

  // Desenho -----------------------------------------------------------------------------------
  /** @param {Block} b @param {Map<string, number>} numbers @param {Set<string>} hidden */
  function blockHtml(b, numbers, hidden) {
    const indent = b.indent ?? 0;
    const editable = ro ? 'false' : 'true';
    const gutter = ro
      ? ''
      : `<div class="ed-gutter" contenteditable="false"><button type="button" class="ed-gbtn" data-ed="add" tabindex="-1" title="Adicionar bloco abaixo" aria-label="Adicionar bloco abaixo">+</button><button type="button" class="ed-gbtn ed-grip" data-ed="menu" draggable="true" tabindex="-1" title="Arraste para mover · clique para opções" aria-label="Opções do bloco">⠿</button></div>`;
    let prefix = '';
    let body = '';
    let suffix = '';
    if (TEXT_TYPES.has(b.type)) {
      body = `<div class="ed-text${b.type === 'code' ? ' ed-code' : ''}" contenteditable="${editable}" spellcheck="${b.type === 'code' ? 'false' : 'true'}" data-ph="${esc(PLACEHOLDER[b.type] ?? '')}">${runsHtml(b.text)}</div>`;
    }
    if (b.type === 'ul') prefix = `<span class="ed-bullet" aria-hidden="true"></span>`;
    if (b.type === 'ol') prefix = `<span class="ed-num" aria-hidden="true">${numbers.get(b.id) ?? 1}.</span>`;
    if (b.type === 'todo') {
      const info = b.taskId ? ctx.taskInfo(b.taskId) : null;
      const done = b.taskId ? info?.status === 'done' : Boolean(b.checked);
      prefix = `<button type="button" class="ed-check${done ? ' is-on' : ''}" data-ed="check" role="checkbox" aria-checked="${done}" aria-label="Concluída" ${ro && !b.taskId ? 'disabled' : ''}></button>`;
      if (b.taskId) {
        const who = info?.assigneeName || 'Sem responsável';
        const due = info?.dueDate ? ` · ${formatDate(info.dueDate).slice(0, 5)}` : '';
        suffix = info
          ? `<button type="button" class="ed-task${info.dueDate && info.status !== 'done' && info.dueDate < new Date().toISOString().slice(0, 10) ? ' is-late' : ''}" data-ed="task" contenteditable="false" ${ro ? 'disabled' : ''}>${esc(who)}${esc(due)}</button>`
          : `<span class="ed-task is-gone" contenteditable="false">tarefa apagada</span>`;
      } else if (ctx.canTasks && !ro) {
        suffix = `<button type="button" class="ed-task ed-task--add" data-ed="task" contenteditable="false" title="Virar tarefa com responsável e prazo">+ Responsável</button>`;
      }
    }
    if (b.type === 'toggle') prefix = `<button type="button" class="ed-arrow${b.open ? ' is-open' : ''}" data-ed="toggle" aria-expanded="${Boolean(b.open)}" aria-label="Abrir ou fechar"></button>`;
    if (b.type === 'callout') {
      const tone = CALLOUT_TONES.find((t) => t.key === b.tone) ?? CALLOUT_TONES[0];
      prefix = `<button type="button" class="ed-tone" data-ed="tone" ${ro ? 'disabled' : ''} aria-label="Tipo do destaque: ${tone.label}" title="${tone.label}">${svg(tone.icon)}</button>`;
    }
    if (b.type === 'divider') body = `<hr class="ed-hr">`;
    if (b.type === 'image' && b.file) body = `<figure class="ed-img"><img alt="${esc(b.file.name)}" data-path="${esc(b.file.path)}"><figcaption>${esc(b.file.name)}</figcaption></figure>`;
    if (b.type === 'file' && b.file) body = `<button type="button" class="ed-file" data-ed="open-file">${svg('paperclip')}<span>${esc(b.file.name)}</span><small>${formatBytes(b.file.size)}</small></button>`;
    if (b.type === 'page' && b.pageId) {
      const info = ctx.pageInfo(b.pageId);
      body = `<a class="ed-page" href="#/workspace/${esc(b.pageId)}">${svg(pageIconName({ icon: info?.icon, kind: 'page' }))}<span>${esc(info ? info.title || 'Sem título' : 'Página removida')}</span></a>`;
    }
    if (b.type === 'table') {
      const rows = b.rows ?? [['']];
      body = `<div class="ed-table-wrap"><table class="ed-table"><tbody>${rows
        .map((row, r) => `<tr>${row.map((cell, c) => `<td contenteditable="${editable}" data-r="${r}" data-c="${c}">${esc(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>${ro ? '' : `<div class="ed-table-tools" contenteditable="false"><button type="button" data-ed="row-add">+ linha</button><button type="button" data-ed="col-add">+ coluna</button>${rows.length > 1 ? '<button type="button" data-ed="row-del">− linha</button>' : ''}${rows[0].length > 1 ? '<button type="button" data-ed="col-del">− coluna</button>' : ''}</div>`}</div>`;
    }
    return `<div class="ed-b ed-b--${b.type}" data-id="${b.id}" data-indent="${indent}"${b.type === 'callout' ? ` data-tone="${esc(b.tone ?? 'note')}"` : ''}${hidden.has(b.id) ? ' hidden' : ''}>${gutter}${prefix}<div class="ed-main">${body}</div>${suffix}</div>`;
  }

  function render() {
    const numbers = listNumbers(blocks);
    const hidden = hiddenIds(blocks);
    host.innerHTML = blocks.map((b) => blockHtml(b, numbers, hidden)).join('') || (ro ? '<p class="ed-empty">Página vazia.</p>' : '');
    for (const img of /** @type {HTMLImageElement[]} */ ([...host.querySelectorAll('img[data-path]')])) {
      const path = String(img.dataset.path);
      const cached = urlCache.get(path);
      if (cached && cached.at > Date.now() - 90_000) img.src = cached.url;
      else ctx.fileUrl(path).then((url) => {
        urlCache.set(path, { url, at: Date.now() });
        img.src = url;
      }).catch(() => img.replaceWith(Object.assign(document.createElement('span'), { className: 'ed-img-error', textContent: 'Imagem indisponível' })));
    }
  }

  /** @param {string} id @param {number | 'end' | 'start'} [where] @param {number} [end] */
  function focusBlock(id, where = 'end', end) {
    const el = textEl(id);
    if (!el) {
      blockEl(id)?.querySelector('td')?.focus();
      return;
    }
    el.focus();
    const len = runsLength(blocks[indexOf(id)]?.text ?? []);
    const start = where === 'end' ? len : where === 'start' ? 0 : Math.min(where, len);
    setSelection(el, start, end ?? start);
  }

  // Histórico e mudanças ------------------------------------------------------------------------
  const caretNow = () => {
    const el = /** @type {HTMLElement | null} */ (document.activeElement?.closest?.('.ed-b') ?? null);
    const id = el?.dataset.id ?? null;
    const text = id ? textEl(id) : null;
    return { id, offset: text ? selectionIn(text)?.start ?? 0 : 0 };
  };
  const remember = () => {
    past.push(JSON.stringify({ blocks: JSON.parse(stable), caret: caretNow() }));
    if (past.length > 100) past.shift();
    future.length = 0;
  };
  const changed = () => {
    stable = JSON.stringify(blocks);
    onChange(blocks);
  };
  /** Mudança de estrutura: guarda o antes, aplica, redesenha e põe o cursor. @param {() => ({ id: string, at?: number | 'end' | 'start' } | void)} fn */
  function structural(fn) {
    remember();
    const focus = fn();
    render();
    changed();
    if (focus) focusBlock(focus.id, focus.at ?? 'end');
  }
  /** @param {string[]} from @param {string[]} to */
  function travel(from, to) {
    const entry = from.pop();
    if (!entry) return;
    to.push(JSON.stringify({ blocks: JSON.parse(stable), caret: caretNow() }));
    const state = JSON.parse(entry);
    blocks = state.blocks;
    render();
    changed();
    if (state.caret?.id && indexOf(state.caret.id) >= 0) focusBlock(state.caret.id, state.caret.offset);
  }

  // Menus (/, @, opções do bloco) -----------------------------------------------------------------
  function closeMenu() {
    menu?.el.remove();
    menu = null;
  }
  /** @param {'slash' | 'mention' | 'block'} kind @param {any[]} items @param {string} blockId @param {string} query @param {DOMRect | null} rect */
  function openMenu(kind, items, blockId, query, rect, noSlash = false) {
    closeMenu();
    const el = document.createElement('div');
    el.className = 'ed-menu';
    el.setAttribute('role', 'listbox');
    document.body.append(el);
    menu = { el, kind, items, index: 0, blockId, query, noSlash };
    drawMenu();
    const r = rect ?? blockEl(blockId)?.getBoundingClientRect();
    if (r) {
      const below = r.bottom + 6;
      const tooLow = below + 320 > innerHeight;
      el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 300))}px`;
      el.style.top = tooLow ? `${Math.max(8, r.top - Math.min(320, el.offsetHeight) - 6)}px` : `${below}px`;
    }
  }
  function drawMenu() {
    if (!menu) return;
    const m = menu;
    if (!m.items.length) {
      m.el.innerHTML = `<p class="ed-menu__empty">${m.kind === 'mention' ? 'Ninguém encontrado' : 'Nenhum bloco com esse nome'}</p>`;
      return;
    }
    m.el.innerHTML = m.items
      .map((it, i) => {
        if (it.sep) return `<p class="ed-menu__sep">${esc(it.sep)}</p>`;
        const mark = it.glyph ? esc(it.glyph) : it.icon ? svg(it.icon) : '';
        const box = mark ? `<span class="ed-menu__icon" aria-hidden="true">${mark}</span>` : '';
        return `<button type="button" class="ed-menu__item${i === m.index ? ' is-active' : ''}" data-i="${i}" role="option" aria-selected="${i === m.index}">${box}<span class="ed-menu__text"><strong>${esc(it.label)}</strong>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`;
      })
      .join('');
    m.el.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }
  /** @param {number} delta */
  function moveMenu(delta) {
    if (!menu || !menu.items.length) return;
    let i = menu.index;
    do i = (i + delta + menu.items.length) % menu.items.length;
    while (menu.items[i].sep);
    menu.index = i;
    drawMenu();
  }

  /** Texto antes do cursor no bloco em foco. @param {Block} b @param {number} caret */
  const before = (b, caret) => runsText(b.text).slice(0, caret);

  /** Abre/atualiza/fecha os menus "/" e "@" conforme o que foi digitado. @param {Block} b @param {HTMLElement} el */
  function watchTriggers(b, el) {
    const sel = selectionIn(el);
    if (!sel || !sel.collapsed) return closeMenu();
    const text = before(b, sel.start);
    const slash = text.match(/(^|\s)\/([\p{L}\d ]{0,24})$/u);
    const at = text.match(/(^|\s)@([\p{L}\d.]{0,30})$/u);
    if (slash && b.type !== 'code') {
      const q = fold(slash[2]).trim();
      const items = BLOCK_TYPES.filter((t) => !q || fold(`${t.label} ${t.keys}`).includes(q)).map((t) => ({ ...t, sub: t.hint }));
      if (!items.length && slash[2].length > 8) return closeMenu();
      if (menu?.kind === 'slash' && menu.blockId === b.id) {
        menu.items = items;
        menu.query = slash[2];
        menu.index = 0;
        drawMenu();
      } else openMenu('slash', items, b.id, slash[2], caretRect());
      return;
    }
    if (at && b.type !== 'code') {
      const items = ctx.mentionItems(at[2]).slice(0, 12).map((it) => ({ ...it, icon: MENTION_ICON[it.k] }));
      if (menu?.kind === 'mention' && menu.blockId === b.id) {
        menu.items = items;
        menu.query = at[2];
        menu.index = 0;
        drawMenu();
      } else openMenu('mention', items, b.id, at[2], caretRect());
      return;
    }
    if (menu && menu.kind !== 'block') closeMenu();
  }

  /** @param {number} i */
  async function chooseMenu(i) {
    if (!menu) return;
    const m = menu;
    const item = m.items[i];
    if (!item || item.sep) return;
    closeMenu();
    if (m.kind === 'block') return item.run();
    const idx = indexOf(m.blockId);
    const b = blocks[idx];
    if (!b) return;
    const el = textEl(b.id);
    const caret = el ? selectionIn(el)?.start ?? runsLength(b.text ?? []) : runsLength(b.text ?? []);
    const cut = m.noSlash ? 0 : m.query.length + 1;
    if (m.kind === 'mention') {
      structural(() => {
        const mention = { t: `@${item.label}`, m: { k: item.k, id: item.id, label: item.label } };
        b.text = replaceRange(b.text ?? [], caret - cut, caret, [mention, { t: ' ' }]);
        return { id: b.id, at: caret - cut + mention.t.length + 1 };
      });
      return;
    }
    await applyType(idx, item.type, caret - cut, caret);
  }

  /** Aplica o tipo escolhido no menu "/". @param {number} idx @param {import('../../core/blocks.js').BlockType} type @param {number} from @param {number} to */
  async function applyType(idx, type, from, to) {
    const b = blocks[idx];
    const rest = replaceRange(b.text ?? [], from, to, []);
    const empty = !runsText(rest).trim();
    if (TEXT_TYPES.has(type)) {
      structural(() => {
        if (empty || b.type === 'p') {
          b.text = rest;
          convert(b, type);
          return { id: b.id, at: from };
        }
        b.text = rest;
        const nb = makeBlock(type, [], b.indent ? { indent: b.indent } : {});
        blocks.splice(idx + 1, 0, nb);
        return { id: nb.id, at: 'start' };
      });
      return;
    }
    if (type === 'divider' || type === 'table') {
      structural(() => {
        b.text = rest;
        const nb = makeBlock(type);
        const after = makeBlock('p');
        if (empty && b.type === 'p') blocks.splice(idx, 1, nb, after);
        else blocks.splice(idx + 1, 0, nb, after);
        return { id: after.id, at: 'start' };
      });
      return;
    }
    // imagem, arquivo, página: assíncronos
    structural(() => {
      b.text = rest;
      return { id: b.id, at: from };
    });
    if (type === 'page') {
      const pageId = await ctx.newSubpage();
      if (pageId) insertAfter(b.id, [makeBlock('page', [], { pageId })], empty && b.type === 'p');
      return;
    }
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: type === 'image' ? 'image/*' : '' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const meta = await ctx.upload(file);
      if (meta) insertAfter(b.id, [makeBlock(type, [], { file: meta })], empty && b.type === 'p');
    });
    input.click();
  }

  /** @param {string} afterId @param {Block[]} list @param {boolean} [replace] substitui o bloco (vazio) */
  function insertAfter(afterId, list, replace = false) {
    structural(() => {
      const idx = indexOf(afterId);
      const at = idx < 0 ? blocks.length : idx + 1;
      if (replace && idx >= 0) blocks.splice(idx, 1, ...list);
      else blocks.splice(at, 0, ...list);
      const lastText = [...list].reverse().find((x) => TEXT_TYPES.has(x.type));
      if (lastText) return { id: lastText.id, at: 'end' };
      const next = makeBlock('p');
      blocks.splice((replace ? idx : at) + list.length, 0, next);
      return { id: next.id, at: 'start' };
    });
  }

  /** Troca o tipo mantendo o texto. @param {Block} b @param {import('../../core/blocks.js').BlockType} type */
  function convert(b, type) {
    b.type = type;
    if (!TEXT_TYPES.has(type)) delete b.text;
    else b.text ??= [];
    if (type !== 'todo') {
      delete b.checked;
      delete b.taskId;
    }
    if (type === 'toggle') b.open = true;
    else delete b.open;
    if (type === 'callout') b.tone ??= 'note';
    else delete b.tone;
  }

  /** Menu de opções do bloco (clique no ⠿). @param {string} id */
  function blockMenu(id) {
    const idx = indexOf(id);
    const b = blocks[idx];
    if (!b) return;
    /** @type {any[]} */
    const items = [];
    if (TEXT_TYPES.has(b.type)) {
      items.push({ sep: 'Transformar em' });
      for (const t of BLOCK_TYPES.filter((x) => TEXT_TYPES.has(x.type) && x.type !== b.type)) {
        items.push({ label: t.label, icon: /** @type {any} */ (t).icon, glyph: /** @type {any} */ (t).glyph, run: () => structural(() => (convert(b, t.type), { id: b.id })) });
      }
    }
    items.push({ sep: 'Bloco' });
    if (b.type === 'todo' && ctx.canTasks) items.push({ label: b.taskId ? 'Editar responsável e prazo' : 'Virar tarefa com responsável', icon: 'user', run: () => taskFor(b) });
    items.push({ label: 'Duplicar', icon: 'copy', run: () => structural(() => {
      const span = blockSpan(blocks, idx);
      const copies = normalizeBlocks(JSON.parse(JSON.stringify(blocks.slice(idx, idx + span)))).map((c) => ({ ...c, id: makeBlock('p').id, taskId: undefined }));
      blocks.splice(idx + span, 0, ...copies);
      return TEXT_TYPES.has(copies[0].type) ? { id: copies[0].id } : undefined;
    }) });
    if (idx > 0) items.push({ label: 'Mover para cima', icon: 'arrowUp', run: () => move(id, -1) });
    if (idx < blocks.length - 1) items.push({ label: 'Mover para baixo', icon: 'arrowDown', run: () => move(id, 1) });
    items.push({ label: 'Excluir', icon: 'trash', run: () => remove(id) });
    openMenu('block', items, id, '', blockEl(id)?.querySelector('.ed-grip')?.getBoundingClientRect() ?? null);
    if (menu) menu.index = items.findIndex((x) => !x.sep);
    drawMenu();
  }

  /** @param {string} id @param {number} dir */
  function move(id, dir) {
    structural(() => {
      const idx = indexOf(id);
      const span = blockSpan(blocks, idx);
      const chunk = blocks.splice(idx, span);
      let target = idx;
      if (dir < 0) {
        target = idx - 1;
        while (target > 0 && hiddenIds(blocks).has(blocks[target].id)) target -= 1;
      } else {
        target = idx + (blocks[idx] ? blockSpan(blocks, idx) : 0);
      }
      blocks.splice(Math.max(0, Math.min(blocks.length, target)), 0, ...chunk);
      return TEXT_TYPES.has(chunk[0].type) ? { id: chunk[0].id } : undefined;
    });
  }

  /** @param {string} id */
  function remove(id) {
    structural(() => {
      const idx = indexOf(id);
      blocks.splice(idx, 1);
      if (!blocks.length) blocks.push(makeBlock('p'));
      const near = blocks[Math.max(0, idx - 1)];
      return TEXT_TYPES.has(near.type) ? { id: near.id } : undefined;
    });
  }

  /** Tarefa de verdade (responsável e prazo). @param {Block} b */
  async function taskFor(b) {
    const taskId = await ctx.editTask(b);
    if (taskId && taskId !== b.taskId) {
      structural(() => {
        b.taskId = taskId;
        delete b.checked;
        return { id: b.id };
      });
    } else render();
  }

  // Barra de formatação (seleção) ------------------------------------------------------------------
  function hideToolbar() {
    toolbar?.remove();
    toolbar = null;
  }
  function showToolbar() {
    if (ro) return;
    const sel = getSelection();
    const el = /** @type {HTMLElement | null} */ (sel?.anchorNode ? (sel.anchorNode.nodeType === 1 ? /** @type {Element} */ (sel.anchorNode) : sel.anchorNode.parentElement)?.closest('.ed-text') ?? null : null);
    if (!sel || sel.isCollapsed || !el || !host.contains(el) || el.classList.contains('ed-code')) return hideToolbar();
    const range = selectionIn(el);
    if (!range || range.collapsed) return hideToolbar();
    const id = /** @type {HTMLElement} */ (el.closest('.ed-b')).dataset.id ?? '';
    const b = blocks[indexOf(id)];
    if (!b) return hideToolbar();
    const on = marksIn(b.text ?? [], range.start, range.end);
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'ed-toolbar';
      toolbar.setAttribute('role', 'toolbar');
      document.body.append(toolbar);
      toolbar.addEventListener('mousedown', (e) => e.preventDefault());
      toolbar.addEventListener('click', (e) => {
        const btn = /** @type {HTMLElement} */ (e.target).closest('button');
        if (btn) format(/** @type {any} */ (btn.dataset.mark));
      });
    }
    const btn = (/** @type {string} */ mark, /** @type {string} */ label, /** @type {string} */ title) => `<button type="button" data-mark="${mark}" class="${on[mark] ? 'is-on' : ''}" title="${title}" aria-pressed="${Boolean(on[mark])}">${label}</button>`;
    toolbar.innerHTML = btn('b', '<strong>N</strong>', 'Negrito (Ctrl+B)') + btn('i', '<em>I</em>', 'Itálico (Ctrl+I)') + btn('u', '<u>S</u>', 'Sublinhado (Ctrl+U)') + btn('s', '<s>R</s>', 'Riscado (Ctrl+Shift+X)') + btn('c', '&lt;/&gt;', 'Código (Ctrl+E)') + btn('a', 'Link', 'Link (Ctrl+K)');
    const rect = /** @type {Range} */ (sel.getRangeAt(0)).getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - toolbar.offsetWidth / 2, innerWidth - toolbar.offsetWidth - 8))}px`;
    toolbar.style.top = `${Math.max(8, rect.top - toolbar.offsetHeight - 8)}px`;
  }

  /** @param {'b' | 'i' | 'u' | 's' | 'c' | 'a'} mark */
  async function format(mark) {
    const anchor = getSelection()?.anchorNode ?? null;
    const el = /** @type {HTMLElement | null} */ ((anchor?.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (anchor) : anchor?.parentElement)?.closest('.ed-text') ?? null);
    if (!el || !host.contains(el)) return;
    const id = /** @type {HTMLElement} */ (el.closest('.ed-b')).dataset.id ?? '';
    const b = blocks[indexOf(id)];
    const range = selectionIn(el);
    if (!b || !range || range.collapsed) return;
    let value = null;
    if (mark === 'a') {
      const current = marksIn(b.text ?? [], range.start, range.end).a ? (b.text ?? []).find((r) => r.a)?.a ?? null : null;
      const answer = await ctx.askLink(current);
      if (answer === undefined) return;
      value = answer;
    }
    remember();
    b.text = toggleMark(b.text ?? [], range.start, range.end, mark, value);
    const t = textEl(id);
    if (t) {
      t.innerHTML = runsHtml(b.text);
      t.focus();
      setSelection(t, range.start, range.end);
    }
    changed();
    showToolbar();
  }

  // Teclado -----------------------------------------------------------------------------------
  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    const target = /** @type {HTMLElement} */ (e.target);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      ctx.onSave();
      return;
    }
    if (ro) return;
    if (mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      closeMenu();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) travel(future, past);
      else travel(past, future);
      return;
    }
    if (menu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveMenu(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (e.key === 'Enter' || (e.key === 'Tab' && menu.kind !== 'block')) {
        e.preventDefault();
        chooseMenu(menu.index);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
        return;
      }
    }
    const td = /** @type {HTMLElement | null} */ (target.closest('td'));
    if (td) return tableKey(e, td);
    const el = /** @type {HTMLElement | null} */ (target.closest('.ed-text'));
    if (!el || composing || e.isComposing) return;
    const id = /** @type {HTMLElement} */ (el.closest('.ed-b')).dataset.id ?? '';
    const idx = indexOf(id);
    const b = blocks[idx];
    if (!b) return;
    const sel = selectionIn(el);
    if (!sel) return;
    const len = runsLength(b.text ?? []);

    if (mod && !e.shiftKey && ['b', 'i', 'u', 'e', 'k'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      if (!sel.collapsed) format(/** @type {any} */ ({ b: 'b', i: 'i', u: 'u', e: 'c', k: 'a' })[e.key.toLowerCase()]);
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      if (!sel.collapsed) format('s');
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      structural(() => {
        const span = blockSpan(blocks, idx);
        const delta = e.shiftKey ? -1 : 1;
        if (!e.shiftKey && idx === 0) return { id, at: sel.start };
        for (let i = idx; i < idx + span; i += 1) blocks[i].indent = Math.max(0, Math.min(MAX_INDENT, (blocks[i].indent ?? 0) + delta));
        return { id, at: sel.start };
      });
      return;
    }
    if (e.key === 'Enter' && (e.shiftKey || (b.type === 'code' && !mod && !runsText(b.text).endsWith('\n\n')))) {
      e.preventDefault();
      structural(() => {
        b.text = replaceRange(b.text ?? [], sel.start, sel.end, [{ t: '\n' }]);
        return { id, at: sel.start + 1 };
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (b.type === 'code') b.text = cleanRuns(plainRuns(runsText(b.text).replace(/\n+$/, '')));
      const text = runsText(b.text);
      if (!text && ['ul', 'ol', 'todo', 'quote', 'callout', 'toggle', 'h1', 'h2', 'h3'].includes(b.type)) {
        structural(() => {
          if ((b.indent ?? 0) > 0 && ['ul', 'ol', 'todo'].includes(b.type)) b.indent = (b.indent ?? 0) - 1;
          else convert(b, 'p');
          return { id, at: 'start' };
        });
        return;
      }
      structural(() => {
        const [left, right] = splitRuns(b.text ?? [], sel.start);
        const rightOnly = splitRuns(right, sel.end - sel.start)[1];
        const sameType = ['ul', 'ol', 'todo'].includes(b.type);
        const childOfToggle = b.type === 'toggle' && b.open;
        if (sel.start === 0 && text) {
          const nb = makeBlock(sameType ? b.type : 'p', [], b.indent ? { indent: b.indent } : {});
          blocks.splice(idx, 0, nb);
          return { id, at: 'start' };
        }
        b.text = left;
        const indent = (b.indent ?? 0) + (childOfToggle ? 1 : 0);
        const nb = makeBlock(sameType ? b.type : 'p', rightOnly, indent ? { indent: Math.min(MAX_INDENT, indent) } : {});
        blocks.splice(idx + (childOfToggle ? 1 : blockSpan(blocks, idx)), 0, nb);
        return { id: nb.id, at: 'start' };
      });
      return;
    }
    if (e.key === 'Backspace' && sel.collapsed && sel.start === 0) {
      e.preventDefault();
      if (b.type !== 'p') {
        structural(() => (convert(b, 'p'), { id, at: 'start' }));
        return;
      }
      if ((b.indent ?? 0) > 0) {
        structural(() => ((b.indent = (b.indent ?? 0) - 1), { id, at: 'start' }));
        return;
      }
      const visible = visibleTextBlocks();
      const pos = visible.findIndex((x) => x.id === id);
      const prevAny = blocks[idx - 1];
      if (prevAny && !TEXT_TYPES.has(prevAny.type)) {
        if (!len) remove(id);
        else structural(() => (blocks.splice(idx - 1, 1), { id, at: 'start' }));
        return;
      }
      const prev = visible[pos - 1];
      if (!prev) return;
      structural(() => {
        const at = runsLength(prev.text ?? []);
        prev.text = concatRuns(prev.text ?? [], b.text ?? []);
        blocks.splice(indexOf(id), 1);
        return { id: prev.id, at };
      });
      return;
    }
    if (e.key === 'Delete' && sel.collapsed && sel.start === len) {
      const next = blocks[idx + 1];
      if (next && TEXT_TYPES.has(next.type)) {
        e.preventDefault();
        structural(() => {
          b.text = concatRuns(b.text ?? [], next.text ?? []);
          blocks.splice(idx + 1, 1);
          return { id, at: len };
        });
      }
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && sel.collapsed && !e.shiftKey) {
      const rect = caretRect();
      const box = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      const atEdge = e.key === 'ArrowUp' ? (!rect || rect.top - box.top < lh * 0.8 || sel.start === 0) : (!rect || box.bottom - rect.bottom < lh * 0.8 || sel.start === len);
      if (!atEdge) return;
      const visible = visibleTextBlocks();
      const pos = visible.findIndex((x) => x.id === id);
      const other = visible[pos + (e.key === 'ArrowUp' ? -1 : 1)];
      if (other) {
        e.preventDefault();
        focusBlock(other.id, e.key === 'ArrowUp' ? 'end' : 'start');
      }
    }
  }

  /** @param {KeyboardEvent} e @param {HTMLElement} td */
  function tableKey(e, td) {
    const id = /** @type {HTMLElement} */ (td.closest('.ed-b')).dataset.id ?? '';
    const b = blocks[indexOf(id)];
    if (!b?.rows) return;
    const r = Number(td.dataset.r);
    const c = Number(td.dataset.c);
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const below = blockEl(id)?.querySelector(`td[data-r="${r + 1}"][data-c="${c}"]`);
      if (below) /** @type {HTMLElement} */ (below).focus();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const cols = b.rows[0].length;
      let nr = r;
      let nc = c + (e.shiftKey ? -1 : 1);
      if (nc >= cols) [nr, nc] = [r + 1, 0];
      if (nc < 0) [nr, nc] = [r - 1, cols - 1];
      if (nr >= b.rows.length) {
        structural(() => {
          b.rows?.push(Array.from({ length: cols }, () => ''));
        });
      }
      /** @type {HTMLElement | null} */ (blockEl(id)?.querySelector(`td[data-r="${nr}"][data-c="${nc}"]`) ?? null)?.focus();
    }
  }

  // Digitação ----------------------------------------------------------------------------------
  /** @param {Event} e */
  function onInput(e) {
    const target = /** @type {HTMLElement} */ (e.target);
    const td = /** @type {HTMLElement | null} */ (target.closest('td'));
    if (td) {
      const id = /** @type {HTMLElement} */ (td.closest('.ed-b')).dataset.id ?? '';
      const b = blocks[indexOf(id)];
      if (b?.rows) {
        if (Date.now() - lastTyping > 1000) remember();
        lastTyping = Date.now();
        b.rows[Number(td.dataset.r)][Number(td.dataset.c)] = (td.textContent ?? '').slice(0, 2000);
        changed();
      }
      return;
    }
    const el = /** @type {HTMLElement | null} */ (target.closest('.ed-text'));
    if (!el || composing) return;
    const id = /** @type {HTMLElement} */ (el.closest('.ed-b')).dataset.id ?? '';
    const b = blocks[indexOf(id)];
    if (!b) return;
    if (Date.now() - lastTyping > 1000) remember();
    lastTyping = Date.now();
    b.text = parseRuns(el);
    if (!b.text.length && el.innerHTML) el.innerHTML = '';
    // Atalhos no começo do bloco: "# ", "- ", "[] ", "> ", "```"...
    if (b.type === 'p') {
      const text = runsText(b.text);
      if (text === '---') {
        structural(() => {
          const idx = indexOf(id);
          const after = makeBlock('p');
          blocks.splice(idx, 1, makeBlock('divider'), after);
          return { id: after.id, at: 'start' };
        });
        return;
      }
      const sel = selectionIn(el);
      for (const [md, type, extra] of MD) {
        if (text.startsWith(`${md} `) && sel?.start === md.length + 1) {
          structural(() => {
            b.text = splitRuns(b.text ?? [], md.length + 1)[1];
            convert(b, type);
            Object.assign(b, extra ?? {});
            return { id, at: 'start' };
          });
          return;
        }
      }
    }
    changed();
    watchTriggers(b, el);
  }

  /** @param {ClipboardEvent} e */
  async function onPaste(e) {
    if (ro) return;
    const target = /** @type {HTMLElement} */ (e.target);
    const files = [...(e.clipboardData?.files ?? [])];
    const td = target.closest('td');
    const el = /** @type {HTMLElement | null} */ (target.closest('.ed-text'));
    if (!el && !td) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    e.preventDefault();
    if (td) {
      document.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' '));
      return;
    }
    if (!el) return;
    const id = /** @type {HTMLElement} */ (el.closest('.ed-b')).dataset.id ?? '';
    const idx = indexOf(id);
    const b = blocks[idx];
    if (files.length && !text) {
      for (const file of files.slice(0, 5)) {
        const meta = await ctx.upload(file);
        if (meta) insertAfter(id, [makeBlock(file.type.startsWith('image/') ? 'image' : 'file', [], { file: meta })]);
      }
      return;
    }
    const sel = selectionIn(el) ?? { start: runsLength(b.text ?? []), end: runsLength(b.text ?? []) };
    const clean = text.replace(/\r\n?/g, '\n');
    if (b.type === 'code' || !clean.includes('\n')) {
      structural(() => {
        b.text = replaceRange(b.text ?? [], sel.start, sel.end, plainRuns(b.type === 'code' ? clean : clean.replace(/\n/g, ' ')));
        return { id, at: sel.start + (b.type === 'code' ? clean.length : clean.length) };
      });
      return;
    }
    const pasted = textToBlocks(clean);
    if (!pasted.length) return;
    structural(() => {
      const [left, right] = splitRuns(b.text ?? [], sel.start);
      const rightOnly = splitRuns(right, sel.end - sel.start)[1];
      b.text = left;
      const tail = makeBlock(b.type === 'p' || !TEXT_TYPES.has(b.type) ? 'p' : b.type, rightOnly);
      const list = runsText(rightOnly) ? [...pasted, tail] : pasted;
      const removeEmpty = !runsText(left) && b.type === 'p';
      blocks.splice(idx + (removeEmpty ? 0 : 1), removeEmpty ? 1 : 0, ...list);
      const last = pasted[pasted.length - 1];
      return { id: last.id, at: 'end' };
    });
  }

  /** @param {MouseEvent} e */
  async function onClick(e) {
    const target = /** @type {HTMLElement} */ (e.target);
    const menuItem = /** @type {HTMLElement | null} */ (target.closest('.ed-menu__item'));
    if (menuItem && menu?.el.contains(menuItem)) {
      e.preventDefault();
      chooseMenu(Number(menuItem.dataset.i));
      return;
    }
    const btn = /** @type {HTMLElement | null} */ (target.closest('[data-ed]'));
    if (!btn || !host.contains(btn)) return;
    const id = /** @type {HTMLElement} */ (btn.closest('.ed-b')).dataset.id ?? '';
    const idx = indexOf(id);
    const b = blocks[idx];
    if (!b) return;
    const action = btn.dataset.ed;
    if (action === 'check') {
      if (b.taskId) {
        const info = ctx.taskInfo(b.taskId);
        if (!info) return;
        btn.classList.toggle('is-on');
        await ctx.setTaskDone(b.taskId, info.status !== 'done').catch(() => btn.classList.toggle('is-on'));
        render();
        return;
      }
      if (ro) return;
      structural(() => {
        b.checked = !b.checked;
      });
      return;
    }
    if (action === 'toggle') {
      b.open = !b.open;
      render();
      changed();
      return;
    }
    if (ro) {
      if (action === 'open-file' && b.file) ctx.openFile(b.file);
      return;
    }
    if (action === 'add') {
      const nb = makeBlock('p', [], b.indent ? { indent: b.indent } : {});
      structural(() => {
        blocks.splice(idx + blockSpan(blocks, idx), 0, nb);
        return { id: nb.id, at: 'start' };
      });
      openMenu('slash', BLOCK_TYPES.map((t) => ({ ...t, sub: t.hint })), nb.id, '', blockEl(nb.id)?.getBoundingClientRect() ?? null, true);
      return;
    }
    if (action === 'menu') return blockMenu(id);
    if (action === 'task') return taskFor(b);
    if (action === 'open-file' && b.file) return ctx.openFile(b.file);
    if (action === 'tone') {
      const items = CALLOUT_TONES.map((t) => ({ label: t.label, icon: t.icon, run: () => structural(() => ((b.tone = t.key), { id })) }));
      openMenu('block', items, id, '', btn.getBoundingClientRect());
      return;
    }
    if (b.rows && ['row-add', 'col-add', 'row-del', 'col-del'].includes(String(action))) {
      structural(() => {
        const rows = /** @type {string[][]} */ (b.rows);
        if (action === 'row-add') rows.push(rows[0].map(() => ''));
        if (action === 'col-add' && rows[0].length < 12) rows.forEach((r) => r.push(''));
        if (action === 'row-del' && rows.length > 1) rows.pop();
        if (action === 'col-del' && rows[0].length > 1) rows.forEach((r) => r.pop());
      });
    }
  }

  // Arrastar para reordenar --------------------------------------------------------------------
  /** @param {DragEvent} e */
  function onDragStart(e) {
    const grip = /** @type {HTMLElement} */ (e.target).closest?.('.ed-grip');
    if (!grip || ro) return;
    dragId = /** @type {HTMLElement} */ (grip.closest('.ed-b')).dataset.id ?? null;
    e.dataTransfer?.setData('text/plain', '');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    blockEl(String(dragId))?.classList.add('is-dragging');
  }
  /** @param {DragEvent} e */
  function onDragOver(e) {
    if (!dragId) return;
    e.preventDefault();
    host.querySelectorAll('.is-drop-before, .is-drop-after').forEach((x) => x.classList.remove('is-drop-before', 'is-drop-after'));
    const over = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest?.('.ed-b'));
    if (!over || over.dataset.id === dragId) return;
    const r = over.getBoundingClientRect();
    over.classList.add(e.clientY < r.top + r.height / 2 ? 'is-drop-before' : 'is-drop-after');
  }
  /** @param {DragEvent} e */
  function onDrop(e) {
    if (!dragId) return;
    e.preventDefault();
    const over = /** @type {HTMLElement | null} */ (host.querySelector('.is-drop-before, .is-drop-after'));
    const from = dragId;
    dragId = null;
    if (!over) return render();
    const after = over.classList.contains('is-drop-after');
    const targetId = over.dataset.id ?? '';
    structural(() => {
      const idx = indexOf(from);
      const chunk = blocks.splice(idx, blockSpan(blocks, idx));
      let t = indexOf(targetId);
      if (t < 0) t = blocks.length;
      else if (after) t += blockSpan(blocks, t);
      blocks.splice(t, 0, ...chunk);
      return TEXT_TYPES.has(chunk[0].type) ? { id: chunk[0].id } : undefined;
    });
  }

  on(host, 'keydown', onKeydown);
  on(host, 'input', onInput);
  on(host, 'paste', onPaste);
  on(host, 'click', onClick);
  on(host, 'dragstart', onDragStart);
  on(host, 'dragover', onDragOver);
  on(host, 'drop', onDrop);
  on(host, 'dragend', () => {
    dragId = null;
    render();
  });
  on(host, 'compositionstart', () => (composing = true));
  on(host, 'compositionend', (/** @type {Event} */ e) => {
    composing = false;
    onInput(e);
  });
  on(document, 'click', (/** @type {MouseEvent} */ e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (menu && menu.el.contains(t)) return onClick(e);
    if (menu && !t.closest?.('[data-ed="menu"], [data-ed="add"], [data-ed="tone"]')) closeMenu();
  });
  on(document, 'mousedown', (/** @type {MouseEvent} */ e) => {
    if (menu?.el.contains(/** @type {Node} */ (e.target))) e.preventDefault();
  });
  on(document, 'selectionchange', () => requestAnimationFrame(showToolbar));
  on(window, 'scroll', () => {
    hideToolbar();
    if (menu?.kind !== 'block') closeMenu();
  });

  render();

  return {
    getBlocks: () => normalizeBlocks(blocks),
    /** @param {Block[]} next */
    setBlocks(next) {
      remember();
      blocks = normalizeBlocks(next);
      if (!blocks.length && !ro) blocks = [makeBlock('p')];
      render();
      changed();
    },
    /** @param {Block[]} list */
    append(list) {
      structural(() => {
        if (blocks.length === 1 && blocks[0].type === 'p' && !runsText(blocks[0].text)) blocks = [];
        blocks.push(...normalizeBlocks(list));
      });
    },
    /** @param {boolean} value */
    setReadOnly(value) {
      ro = value;
      render();
    },
    refresh: () => render(),
    focusStart() {
      const first = blocks.find((b) => TEXT_TYPES.has(b.type));
      if (first) focusBlock(first.id, 'start');
    },
    destroy() {
      ac.abort();
      closeMenu();
      hideToolbar();
    },
  };
}
