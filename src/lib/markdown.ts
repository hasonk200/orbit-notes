import type { JSONContent } from '../db/schema';

/**
 * Small Markdown → Orbit editor JSON converter, shared by the editor (paste) and the AI API.
 * Covers what people and AI tools actually write in notes: headings, bullet / numbered / task
 * lists (nested by indentation), quotes, code blocks, tables, horizontal rules, and inline
 * bold, italic, strike, code and links. Anything else stays as plain text.
 */

type Mark = { type: string; attrs?: Record<string, unknown> };

const URL_RE = /^(?:https?:\/\/|file:\/\/\/?|mailto:)[^\s<>()\p{Script=Han}　-〿＀-￯]*[^\s<>().,;:!?'"\p{Script=Han}　-〿＀-￯]/iu;

function textNode(text: string, marks: Mark[]): JSONContent {
  return marks.length ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text };
}

/** Inline Markdown → text nodes with marks. */
export function parseInline(src: string, marks: Mark[] = []): JSONContent[] {
  const out: JSONContent[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push(textNode(buf, marks));
    buf = '';
  };
  const withMark = (mark: Mark) => [...marks.filter((m) => m.type !== mark.type), mark];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!~|>]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const m = rest.match(/^(`+)([\s\S]*?[^`])\1(?!`)/);
      if (m) {
        flush();
        out.push(textNode(m[2].replace(/^ (.*) $/, '$1'), [...marks.filter((x) => x.type === 'link'), { type: 'code' }]));
        i += m[0].length;
        continue;
      }
    }
    if (ch === '[') {
      const m = rest.match(/^\[([^\]\n]+)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/);
      if (m) {
        flush();
        out.push(...parseInline(m[1], withMark({ type: 'link', attrs: { href: m[2] } })));
        i += m[0].length;
        continue;
      }
    }
    if (ch === '<') {
      const m = rest.match(/^<((?:https?|file|mailto):[^>\s]+)>/i);
      if (m) {
        flush();
        out.push(textNode(m[1], withMark({ type: 'link', attrs: { href: m[1] } })));
        i += m[0].length;
        continue;
      }
    }
    if (!marks.some((m) => m.type === 'link') && /[hfmHFM]/.test(ch) && (i === 0 || !/[\w/]/.test(src[i - 1]))) {
      const m = rest.match(URL_RE);
      if (m) {
        flush();
        out.push(textNode(m[0], withMark({ type: 'link', attrs: { href: m[0] } })));
        i += m[0].length;
        continue;
      }
    }
    const run = /[*_~]/.test(ch) ? rest.match(/^(\*\*|__|~~|\*|_)/)?.[1] : undefined;
    if (run) {
      const prev = i > 0 ? src[i - 1] : ' ';
      // `_` inside words (snake_case, file_names) is not emphasis.
      const opens = run[0] !== '_' || !/[\p{L}\p{N}]/u.test(prev);
      if (opens && rest.length > run.length && !/\s/.test(rest[run.length])) {
        const close = findClose(src, i + run.length, run);
        if (close > i + run.length) {
          const type = run === '~~' ? 'strike' : run.length === 2 ? 'bold' : 'italic';
          flush();
          out.push(...parseInline(src.slice(i + run.length, close), withMark({ type })));
          i = close + run.length;
          continue;
        }
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

function findClose(src: string, from: number, run: string) {
  let j = from;
  while ((j = src.indexOf(run, j)) !== -1) {
    const before = src[j - 1];
    const after = src[j + run.length] ?? ' ';
    if (before && !/\s/.test(before) && (run.length === 2 || after !== run[0])) {
      if (run[0] !== '_' || !/[\p{L}\p{N}]/u.test(after)) return j;
    }
    j += run.length;
  }
  return -1;
}

const paragraph = (text: string): JSONContent => {
  const content = parseInline(text);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
};

interface Line { indent: number; text: string }

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^(```+|~~~+)\s*([\w+-]*)\s*$/;
const HR = /^(?:-{3,}|\*{3,}|_{3,}|(?:- ){2,}-|(?:\* ){2,}\*)\s*$/;
const QUOTE = /^>\s?(.*)$/;
const TASK = /^(?:[-*+]\s+\[([ xX])\]|\[([ xX])\]|([☐□☑☒✅✔]))\s+(.*)$/;
const BULLET = /^[-*+•·▪●]\s+(.*)$/;
const ORDERED = /^(\d{1,9})[.)]\s+(.*)$/;
const TABLE_ROW = /^\|.*\|\s*$/;
const TABLE_RULE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function listKind(text: string): 'task' | 'bullet' | 'ordered' | null {
  if (TASK.test(text)) return 'task';
  if (BULLET.test(text)) return 'bullet';
  if (ORDERED.test(text)) return 'ordered';
  return null;
}

function measure(raw: string): Line {
  const expanded = raw.replace(/\t/g, '    ');
  const text = expanded.trimStart();
  return { indent: expanded.length - text.length, text: text.trimEnd() };
}

function splitRow(row: string) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/** Parse list lines (already known to start a list) into nested list nodes. */
function parseList(lines: Line[], start: number): [JSONContent, number] {
  const baseIndent = lines[start].indent;
  const kind = listKind(lines[start].text)!;
  const listType = kind === 'task' ? 'taskList' : kind === 'ordered' ? 'orderedList' : 'bulletList';
  const items: JSONContent[] = [];
  let i = start;
  let orderStart = 1;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.text || line.indent < baseIndent || line.indent > baseIndent) break;
    const k = listKind(line.text);
    if (k !== kind) break;
    let body: string;
    let attrs: Record<string, unknown> | undefined;
    if (k === 'task') {
      const m = line.text.match(TASK)!;
      const mark = m[1] ?? m[2] ?? m[3];
      const checked = /[xX☑☒✅✔]/.test(mark);
      attrs = { checked, ...(checked ? { status: 'done', completedAt: Date.now() } : {}) };
      body = m[4];
    } else if (k === 'ordered') {
      const m = line.text.match(ORDERED)!;
      if (!items.length) orderStart = Number(m[1]);
      body = m[2];
    } else {
      body = line.text.match(BULLET)![1];
    }
    const content: JSONContent[] = [paragraph(body)];
    i += 1;
    // Continuation lines and nested lists, indented deeper than this item.
    while (i < lines.length && lines[i].text && lines[i].indent > baseIndent) {
      if (listKind(lines[i].text)) {
        const [nested, next] = parseList(lines, i);
        content.push(nested);
        i = next;
      } else {
        content.push(paragraph(lines[i].text));
        i += 1;
      }
    }
    items.push({ type: k === 'task' ? 'taskItem' : 'listItem', ...(attrs ? { attrs } : {}), content });
  }
  const list: JSONContent = { type: listType, content: items };
  if (listType === 'orderedList' && orderStart !== 1) list.attrs = { start: orderStart };
  return [list, i];
}

/** Convert Markdown (or plain text) to the editor's block nodes. Empty input gives []. */
export function markdownToBlocks(markdown: string): JSONContent[] {
  const raw = markdown.replace(/\r\n?/g, '\n').split('\n');
  const lines = raw.map(measure);
  const blocks: JSONContent[] = [];
  let pendingBlank = false;
  const push = (node: JSONContent) => {
    const prev = blocks.at(-1);
    // Paragraphs have no margins in Orbit, so keep one empty line where the text had a gap
    // between ordinary blocks. Headings already carry their own spacing.
    if (pendingBlank && prev && prev.type !== 'heading' && node.type !== 'heading') blocks.push({ type: 'paragraph' });
    pendingBlank = false;
    blocks.push(node);
  };
  let i = 0;
  while (i < lines.length) {
    const { text } = lines[i];
    if (!text) {
      pendingBlank = true;
      i += 1;
      continue;
    }
    const fence = text.match(FENCE);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !raw[i].trim().startsWith(fence[1])) body.push(raw[i++]);
      i += 1;
      const code = body.join('\n');
      push({ type: 'codeBlock', attrs: { language: fence[2] || null }, ...(code ? { content: [{ type: 'text', text: code }] } : {}) });
      continue;
    }
    const heading = text.match(HEADING);
    if (heading) {
      const content = parseInline(heading[2]);
      push({ type: 'heading', attrs: { level: Math.min(heading[1].length, 3) }, ...(content.length ? { content } : {}) });
      i += 1;
      continue;
    }
    if (HR.test(text)) {
      push({ type: 'horizontalRule' });
      i += 1;
      continue;
    }
    if (TABLE_ROW.test(text) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1].text)) {
      const header = splitRow(text);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i].text)) rows.push(splitRow(lines[i++].text));
      const width = header.length;
      const cell = (type: string, value: string) => ({ type, content: [paragraph(value)] });
      push({
        type: 'table',
        content: [
          { type: 'tableRow', content: header.map((h) => cell('tableHeader', h)) },
          ...rows.map((r) => ({ type: 'tableRow', content: Array.from({ length: width }, (_, c) => cell('tableCell', r[c] ?? '')) })),
        ],
      });
      continue;
    }
    if (QUOTE.test(text)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i].text)) body.push(lines[i++].text.match(QUOTE)![1]);
      const inner = markdownToBlocks(body.join('\n'));
      push({ type: 'blockquote', content: inner.length ? inner : [{ type: 'paragraph' }] });
      continue;
    }
    if (listKind(text)) {
      const [list, next] = parseList(lines, i);
      push(list);
      i = next;
      continue;
    }
    push(paragraph(text));
    i += 1;
  }
  return blocks;
}

/** True when text uses Markdown block or link syntax, so pasting it should keep that structure. */
export function looksLikeMarkdown(text: string) {
  const lines = text.split(/\r?\n/);
  let hits = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (HEADING.test(line) || FENCE.test(line) || TASK.test(line) || /^[-*+•]\s+\S/.test(line) || /^\d{1,3}[.)]\s+\S/.test(line)
      || QUOTE.test(line) || (TABLE_RULE.test(line) && line.includes('-') && line.includes('|'))) hits += 1;
    if (/\[[^\]\n]+\]\([^)\s]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`/.test(line)) hits += 1;
  }
  return hits > 0;
}
