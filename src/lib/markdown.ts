import MarkdownIt, { type Token } from 'markdown-it';
import cjkFriendly from 'markdown-it-cjk-friendly';
import type { JSONContent } from '../db/schema';

/**
 * Markdown → Orbit editor JSON, shared by the editor (paste) and the AI API.
 *
 * Parsing is done by markdown-it (CommonMark + GFM tables and strikethrough) with the
 * CJK-friendly emphasis rule, so `這是一份**「…」的手冊**。` is bold like in other apps.
 * This file only translates its tokens into Orbit nodes, plus a few note-taking habits:
 * - every line is its own line (no merging of neighbouring lines into one paragraph)
 * - `•` bullets and `☐` / `☑` boxes become lists and to-dos
 * - `---` is always a divider, a plain line after a list or quote is not swallowed by it,
 *   and a numbered line like `2.` starts a list even right after text
 * - bare https://, file:// and mailto: addresses become links (not `name.md` file names)
 * - a blank line between ordinary blocks is kept as one empty line, since Orbit
 *   paragraphs have no spacing of their own
 */

type Mark = { type: string; attrs?: Record<string, unknown> };

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.use(cjkFriendly);
// Notes link to files on the computer too; only script-like schemes are refused.
md.validateLink = (url) => !/^\s*(?:javascript|vbscript|data):/i.test(url);

// ---------- Bare links ----------

const URL_START = /(?:https?:\/\/|file:\/\/\/?|mailto:)/giu;
const URL_BODY = /^[^\s<>"'`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]+/u;

/** Find bare addresses in plain text, stopping before CJK text, trailing punctuation or an unmatched `)`. */
export function findUrls(text: string): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  URL_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_START.exec(text))) {
    const start = m.index;
    if (start > 0 && /[\p{L}\p{N}_/]/u.test(text[start - 1]) && !/[\p{Script=Han}]/u.test(text[start - 1])) continue;
    const body = text.slice(start).match(URL_BODY)?.[0] ?? '';
    let url = body;
    for (;;) {
      const last = url[url.length - 1];
      if (/[.,;:!?*_~]/.test(last)) url = url.slice(0, -1);
      else if (last === ')' && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) url = url.slice(0, -1);
      else break;
    }
    if (url.length <= m[0].length) continue;
    found.push({ start, end: start + url.length });
    URL_START.lastIndex = start + url.length;
  }
  return found;
}

function textNodes(text: string, marks: Mark[], out: JSONContent[]) {
  if (!text) return;
  const node = (t: string, ms: Mark[]) => out.push(ms.length ? { type: 'text', text: t, marks: ms.map((x) => ({ ...x })) } : { type: 'text', text: t });
  if (marks.some((x) => x.type === 'link' || x.type === 'code')) return node(text, marks);
  let at = 0;
  for (const u of findUrls(text)) {
    if (u.start > at) node(text.slice(at, u.start), marks);
    const href = text.slice(u.start, u.end);
    node(href, [...marks, { type: 'link', attrs: { href } }]);
    at = u.end;
  }
  if (at < text.length) node(text.slice(at), marks);
}

// ---------- Inline ----------

const BREAK: JSONContent = { type: '__break' };

/** Inline tokens → text nodes; line breaks come back as BREAK markers. */
function inlineNodes(tokens: Token[]): JSONContent[] {
  const out: JSONContent[] = [];
  const marks: Mark[] = [];
  const close = (type: string) => {
    const i = marks.map((x) => x.type).lastIndexOf(type);
    if (i >= 0) marks.splice(i, 1);
  };
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
      case 'text_special':
        textNodes(t.content, marks, out);
        break;
      case 'strong_open':
        marks.push({ type: 'bold' });
        break;
      case 'strong_close':
        close('bold');
        break;
      case 'em_open':
        marks.push({ type: 'italic' });
        break;
      case 'em_close':
        close('italic');
        break;
      case 's_open':
        marks.push({ type: 'strike' });
        break;
      case 's_close':
        close('strike');
        break;
      case 'link_open':
        marks.push({ type: 'link', attrs: { href: String(t.attrGet('href') ?? '') } });
        break;
      case 'link_close':
        close('link');
        break;
      case 'code_inline': {
        // A code span holding nothing but an address is meant to be opened, so make it a link.
        const url = findUrls(t.content)[0];
        const linked = marks.find((x) => x.type === 'link');
        if (!linked && url && url.start === 0 && url.end === t.content.length) out.push({ type: 'text', text: t.content, marks: [{ type: 'link', attrs: { href: t.content } }] });
        else if (t.content) out.push({ type: 'text', text: t.content, marks: [...(linked ? [{ ...linked }] : []), { type: 'code' }] });
        break;
      }
      case 'image': {
        // Orbit stores pictures as attachments, so a Markdown image becomes a link to it.
        const src = String(t.attrGet('src') ?? '');
        const alt = t.content || src;
        out.push(src ? { type: 'text', text: alt, marks: [{ type: 'link', attrs: { href: src } }] } : { type: 'text', text: alt });
        break;
      }
      case 'softbreak':
      case 'hardbreak':
        out.push(BREAK);
        break;
      default:
        if (t.content) textNodes(t.content, marks, out);
    }
  }
  return out;
}

const toParagraph = (content: JSONContent[]): JSONContent => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });

/** Split inline content at line breaks: each written line is its own paragraph. */
function splitLines(nodes: JSONContent[]): JSONContent[][] {
  const lines: JSONContent[][] = [[]];
  for (const n of nodes) {
    if (n === BREAK) lines.push([]);
    else lines[lines.length - 1].push(n);
  }
  return lines;
}

const joinLines = (nodes: JSONContent[]) => nodes.map((n) => (n === BREAK ? { type: 'text', text: ' ' } : n));

/** Inline Markdown → text nodes with marks (line breaks become spaces). */
export function parseInline(src: string): JSONContent[] {
  const tokens = md.parseInline(src, {})[0]?.children ?? [];
  return joinLines(inlineNodes(tokens));
}

// ---------- Note-taking habits, applied to the source lines ----------

interface Prepared {
  text: string;
  /** Line numbers of blank lines added here, which do not count as gaps the writer left. */
  synthetic: Set<number>;
}

const QUOTE_PREFIX = /^((?: {0,3}>[ ]?)*)(.*)$/;
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

function prepare(markdown: string): Prepared {
  const input = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const synthetic = new Set<number>();
  let fence: string | null = null;
  let prev = null as { depth: number; text: string; inList: boolean } | null;
  const blank = (prefix: string) => {
    synthetic.add(out.length);
    out.push(prefix.trimEnd());
  };
  for (const raw of input) {
    if (fence) {
      out.push(raw);
      if (raw.replace(QUOTE_PREFIX, '$2').trim().startsWith(fence)) fence = null;
      continue;
    }
    const [, prefix, rest0] = raw.match(QUOTE_PREFIX)!;
    const depth = (prefix.match(/>/g) ?? []).length;
    const indent = rest0.length - rest0.trimStart().length;
    let rest = rest0;
    let body = rest0.trimStart();
    // Symbols people type for bullets and boxes.
    const sym = body.match(/^([•·▪●◦‣]|[☐□]|[☑☒])\s+/);
    if (sym) {
      const repl = /[☐□]/.test(sym[1]) ? '- [ ] ' : /[☑☒]/.test(sym[1]) ? '- [x] ' : '- ';
      body = repl + body.slice(sym[0].length);
      rest = rest0.slice(0, indent) + body;
    }
    const fenceOpen = body.match(FENCE_OPEN);
    const isBlank = body.trim() === '';
    const isList = LIST_MARKER.test(body);
    if (prev && !isBlank && prev.text.trim() !== '') {
      const sameLevel = depth === prev.depth;
      const lazyAfterQuote = depth < prev.depth;
      const lazyAfterList = sameLevel && prev.inList && indent === 0 && !isList;
      const dividerAfterText = sameLevel && /^ {0,3}(?:-[ \t]*){3,}$/.test(body) && !prev.inList;
      const numberAfterText = sameLevel && indent === 0 && /^\d{1,9}[.)]\s/.test(body) && !/^1[.)]/.test(body) && !prev.inList;
      const tableAfterText = sameLevel && /^\|/.test(body) && !/^\|/.test(prev.text.trim());
      if (lazyAfterQuote || lazyAfterList || dividerAfterText || numberAfterText || tableAfterText) blank(prefix);
    }
    out.push(prefix + rest);
    if (fenceOpen) fence = fenceOpen[1];
    const inList: boolean = isBlank ? false : isList || (!!prev?.inList && indent > 0 && depth === prev.depth);
    prev = { depth, text: body, inList };
  }
  return { text: out.join('\n'), synthetic };
}

// ---------- Blocks ----------

type Group = { nodes: JSONContent[]; map: [number, number] | null };

const SPACED = new Set(['heading', 'horizontalRule', 'table', 'codeBlock']);

class Converter {
  constructor(private tokens: Token[], private lines: string[], private synthetic: Set<number>) {}

  /** Was there a blank line the writer left just before line `line`? */
  private gapBefore(line: number, floor: number) {
    for (let k = line - 1; k >= floor; k--) {
      const content = this.lines[k]?.replace(QUOTE_PREFIX, '$2') ?? '';
      if (content.trim() !== '') return false;
      if (!this.synthetic.has(k)) return true;
    }
    return false;
  }

  /** Parse blocks until `end` (a closing token type) and return them, keeping written gaps when asked. */
  blocks(i: number, end: string | null, keepGaps: boolean): [JSONContent[], number] {
    const groups: Group[] = [];
    while (i < this.tokens.length) {
      const t = this.tokens[i];
      if (end && t.type === end) {
        i += 1;
        break;
      }
      const [nodes, next] = this.block(i);
      if (nodes.length) groups.push({ nodes, map: t.map ? [t.map[0], t.map[1]] : null });
      i = next;
    }
    const out: JSONContent[] = [];
    groups.forEach((g, n) => {
      const prev = groups[n - 1];
      if (keepGaps && prev && g.map && prev.map && this.gapBefore(g.map[0], prev.map[0])) {
        const a = prev.nodes[prev.nodes.length - 1];
        const b = g.nodes[0];
        if (!SPACED.has(a.type ?? '') && !SPACED.has(b.type ?? '')) out.push({ type: 'paragraph' });
      }
      out.push(...g.nodes);
    });
    return [out, i];
  }

  private block(i: number): [JSONContent[], number] {
    const t = this.tokens[i];
    switch (t.type) {
      case 'paragraph_open': {
        const inline = this.tokens[i + 1];
        return [splitLines(inlineNodes(inline.children ?? [])).map(toParagraph), i + 3];
      }
      case 'heading_open': {
        const content = joinLines(inlineNodes(this.tokens[i + 1].children ?? []));
        const level = Math.min(Number(t.tag.slice(1)) || 1, 3);
        return [[{ type: 'heading', attrs: { level }, ...(content.length ? { content } : {}) }], i + 3];
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const close = t.type === 'bullet_list_open' ? 'bullet_list_close' : 'ordered_list_close';
        const [items, next] = this.blocks(i + 1, close, false);
        const start = Number(t.attrGet('start') ?? 1);
        return [this.lists(items, t.type === 'ordered_list_open', start), next];
      }
      case 'list_item_open': {
        const [kids, next] = this.blocks(i + 1, 'list_item_close', false);
        return [[this.item(kids)], next];
      }
      case 'blockquote_open': {
        const [kids, next] = this.blocks(i + 1, 'blockquote_close', true);
        return [[{ type: 'blockquote', content: kids.length ? kids : [{ type: 'paragraph' }] }], next];
      }
      case 'fence':
      case 'code_block': {
        const code = t.content.replace(/\n$/, '');
        const language = t.info.trim().split(/\s+/)[0] || null;
        return [[{ type: 'codeBlock', attrs: { language }, ...(code ? { content: [{ type: 'text', text: code }] } : {}) }], i + 1];
      }
      case 'hr':
        return [[{ type: 'horizontalRule' }], i + 1];
      case 'table_open':
        return this.table(i);
      default:
        return [[], i + 1];
    }
  }

  /** A list item; `[ ]` / `[x]` at its start makes it a to-do. */
  private item(kids: JSONContent[]): JSONContent {
    const content = kids.length ? kids : [{ type: 'paragraph' }];
    const first = content[0];
    const lead = first.type === 'paragraph' ? first.content?.[0] : undefined;
    const box = lead?.type === 'text' && !lead.marks ? lead.text!.match(/^\[([ xX])\](?:\s+|$)/) : null;
    if (!box) return { type: 'listItem', content };
    const rest = lead!.text!.slice(box[0].length);
    const firstContent = [...(rest ? [{ ...lead!, text: rest }] : []), ...first.content!.slice(1)];
    const checked = box[1] !== ' ';
    return {
      type: 'taskItem',
      attrs: { checked, ...(checked ? { status: 'done', completedAt: Date.now() } : {}) },
      content: [toParagraph(firstContent), ...content.slice(1)],
    };
  }

  /** Group items into lists: runs of to-dos become task lists. */
  private lists(items: JSONContent[], ordered: boolean, start: number): JSONContent[] {
    const out: JSONContent[] = [];
    for (const item of items) {
      const type = item.type === 'taskItem' ? 'taskList' : ordered ? 'orderedList' : 'bulletList';
      const last = out[out.length - 1];
      if (last?.type === type) last.content!.push(item);
      else out.push({ type, content: [item] });
    }
    const firstOrdered = out.find((l) => l.type === 'orderedList');
    if (firstOrdered && start !== 1) firstOrdered.attrs = { start };
    return out;
  }

  private table(i: number): [JSONContent[], number] {
    const rows: JSONContent[] = [];
    let row: JSONContent[] | null = null;
    while (i < this.tokens.length && this.tokens[i].type !== 'table_close') {
      const t = this.tokens[i];
      if (t.type === 'tr_open') row = [];
      else if (t.type === 'tr_close' && row) {
        rows.push({ type: 'tableRow', content: row });
        row = null;
      } else if ((t.type === 'th_open' || t.type === 'td_open') && row) {
        const content = joinLines(inlineNodes(this.tokens[i + 1].children ?? []));
        row.push({ type: t.type === 'th_open' ? 'tableHeader' : 'tableCell', content: [toParagraph(content)] });
        i += 2;
      }
      i += 1;
    }
    return [rows.length ? [{ type: 'table', content: rows }] : [], i + 1];
  }
}

/** Convert Markdown (or plain text) to the editor's block nodes. Empty input gives []. */
export function markdownToBlocks(markdown: string): JSONContent[] {
  if (!markdown.trim()) return [];
  const { text, synthetic } = prepare(markdown);
  const tokens = md.parse(text, {});
  return new Converter(tokens, text.split('\n'), synthetic).blocks(0, null, true)[0];
}

// ---------- Paste detection ----------

const LOOKS = [
  /^#{1,6}\s+\S/, // heading
  /^(```|~~~)/, // code fence
  /^(?:[-*+]\s+\[[ xX]\]|[☐□☑☒])\s+/, // to-do
  /^[-*+•]\s+\S/, // bullet
  /^\d{1,3}[.)]\s+\S/, // numbered
  /^>\s?/, // quote
  /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/, // table rule
];

/** True when text uses Markdown block or link syntax, so pasting it should keep that structure. */
export function looksLikeMarkdown(text: string) {
  return text.split(/\r?\n/).some((raw) => {
    const line = raw.trim();
    return LOOKS.some((re) => re.test(line)) || /\[[^\]\n]+\]\([^)\s]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`/.test(line);
  });
}
