import type { JSONContent } from '../db/schema';
import { uid } from '../db/schema';

export const emptyDoc = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] });

export function walk(node: JSONContent | undefined, fn: (n: JSONContent, parent?: JSONContent) => void, parent?: JSONContent) {
  if (!node) return;
  fn(node, parent);
  node.content?.forEach((c) => walk(c, fn, node));
}

/** Plain text of a node; object links resolved through `titleOf` when given. */
export function nodeText(node: JSONContent | undefined, titleOf?: (id: string) => string): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'objectLink') return titleOf ? titleOf(node.attrs?.id) : '';
  if (node.type === 'tag') return '#' + (node.attrs?.name ?? '');
  if (node.type === 'dateRef') return node.attrs?.date ?? '';
  if (node.type === 'hardBreak') return ' ';
  const inner = (node.content ?? []).map((c) => nodeText(c, titleOf));
  const isBlockContainer = ['doc', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote'].includes(node.type ?? '');
  return inner.join(isBlockContainer ? '\n' : '');
}

export function docText(doc: JSONContent | undefined, titleOf?: (id: string) => string) {
  return nodeText(doc, titleOf).replace(/\n{2,}/g, '\n').trim();
}

export function extractLinkIds(doc: JSONContent | undefined): string[] {
  const ids = new Set<string>();
  walk(doc, (n) => {
    if (n.type === 'objectLink' && n.attrs?.id) ids.add(n.attrs.id);
  });
  return [...ids];
}

export function extractTags(doc: JSONContent | undefined): string[] {
  const tags = new Set<string>();
  walk(doc, (n) => {
    if (n.type === 'tag' && n.attrs?.name) tags.add(String(n.attrs.name).toLowerCase());
  });
  return [...tags];
}

export function extractBlobIds(doc: JSONContent | undefined): string[] {
  const ids = new Set<string>();
  walk(doc, (n) => {
    if (n.type === 'blobImage' && n.attrs?.blobId) ids.add(n.attrs.blobId);
  });
  return [...ids];
}

export interface ExtractedTask {
  id: string;
  text: string;
  done: boolean;
  due: string | null;
}

/** Text of a task item, without nested task lists. */
function taskOwnText(n: JSONContent, titleOf?: (id: string) => string) {
  return (n.content ?? [])
    .filter((c) => c.type !== 'taskList' && c.type !== 'bulletList' && c.type !== 'orderedList')
    .map((c) => nodeText(c, titleOf))
    .join(' ')
    .trim();
}

export function extractTasks(doc: JSONContent | undefined, titleOf?: (id: string) => string): ExtractedTask[] {
  const out: ExtractedTask[] = [];
  walk(doc, (n) => {
    if (n.type === 'taskItem' && n.attrs?.taskId) {
      out.push({
        id: n.attrs.taskId,
        text: taskOwnText(n, titleOf),
        done: !!n.attrs.checked,
        due: n.attrs.due || null,
      });
    }
  });
  return out;
}

/** Give every task item a unique id (deep copy). Used for templates and imports. */
export function assignTaskIds(doc: JSONContent, fresh = false): JSONContent {
  const copy: JSONContent = JSON.parse(JSON.stringify(doc ?? emptyDoc()));
  const seen = new Set<string>();
  walk(copy, (n) => {
    if (n.type === 'taskItem') {
      n.attrs = n.attrs ?? {};
      if (fresh || !n.attrs.taskId || seen.has(n.attrs.taskId)) n.attrs.taskId = uid();
      seen.add(n.attrs.taskId);
    }
  });
  return copy;
}

/** Update the attrs of the task node with this id. Returns a new doc, or null if not found. */
export function patchTaskInDoc(doc: JSONContent, taskId: string, patch: { checked?: boolean; due?: string | null }): JSONContent | null {
  const copy: JSONContent = JSON.parse(JSON.stringify(doc));
  let found = false;
  walk(copy, (n) => {
    if (n.type === 'taskItem' && n.attrs?.taskId === taskId) {
      n.attrs = { ...n.attrs, ...patch };
      found = true;
    }
  });
  return found ? copy : null;
}

/** For backlinks: the text of each block that mentions `targetId`. */
export function snippetsFor(doc: JSONContent | undefined, targetId: string, titleOf: (id: string) => string): string[] {
  const out: string[] = [];
  const visit = (n: JSONContent) => {
    const isTextBlock = ['paragraph', 'heading'].includes(n.type ?? '');
    if (isTextBlock) {
      let has = false;
      walk(n, (c) => {
        if (c.type === 'objectLink' && c.attrs?.id === targetId) has = true;
      });
      if (has) out.push(nodeText(n, titleOf).trim());
      return;
    }
    n.content?.forEach(visit);
  };
  if (doc) visit(doc);
  return out;
}

export function firstText(doc: JSONContent | undefined, max = 180, titleOf?: (id: string) => string) {
  const t = docText(doc, titleOf).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
