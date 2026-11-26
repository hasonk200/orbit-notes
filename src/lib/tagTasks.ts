import type { JSONContent, TaskKind } from '../db/schema';

/**
 * Tag a line #待辦 (or #todo) to make it a to-do, or #專案任務 / #任務 (or #task) to make it a project task,
 * without turning it into a checkbox: the line keeps its bullet and everything under it.
 * The tag itself carries the task's state (done, status, due date, priority, project), like a task item does.
 */
const NAMES: Record<string, TaskKind> = { '待辦': 'todo', todo: 'todo', '專案任務': 'task', '任務': 'task', task: 'task' };

const norm = (name: unknown) => String(name ?? '').trim().replace(/^#/, '').toLowerCase();

/** The kind of task a tag name stands for, or null for an ordinary tag. */
export const tagTaskKind = (name: unknown): TaskKind | null => NAMES[norm(name)] ?? null;

export const isTaskTag = (n: JSONContent | undefined): boolean => n?.type === 'tag' && tagTaskKind(n.attrs?.name) !== null;

/** The tag to write for a kind, in the same language as the tag it replaces (English when it was English). */
export function tagTaskName(kind: TaskKind, like?: string): string {
  const english = like ? /^[a-z]+$/i.test(norm(like)) : false;
  if (english) return kind === 'task' ? 'task' : 'todo';
  return kind === 'task' ? '專案任務' : '待辦';
}

const TEXT_BLOCKS = new Set(['paragraph', 'heading']);

/** The first task tag directly inside a line (paragraph or heading). Lines inside a checkbox task are skipped: they are tasks already. */
export function taskTagOf(block: JSONContent, parent?: JSONContent): JSONContent | null {
  if (!TEXT_BLOCKS.has(block.type ?? '') || parent?.type === 'taskItem') return null;
  return block.content?.find(isTaskTag) ?? null;
}

/** Visit every line that carries a task tag: the line, its task tag, and the line's parent. */
export function eachTaggedLine(doc: JSONContent | undefined, fn: (line: JSONContent, tag: JSONContent, parent?: JSONContent) => void) {
  const visit = (node: JSONContent, parent?: JSONContent) => {
    const tag = taskTagOf(node, parent);
    if (tag) fn(node, tag, parent);
    node.content?.forEach((c) => visit(c, node));
  };
  if (doc) visit(doc);
}

/** The first date written in a line (an @date), which is the task's due date. */
export const lineDate = (line: JSONContent): string | null => line.content?.find((c) => c.type === 'dateRef' && c.attrs?.date)?.attrs?.date ?? null;

/** Change the due date: rewrite the line's @date if it has one, otherwise keep it on the tag. */
export function setLineDue(line: JSONContent, tag: JSONContent, due: string | null) {
  const ref = line.content?.find((c) => c.type === 'dateRef');
  if (ref) {
    if (due) ref.attrs = { ...ref.attrs, date: due };
    else line.content = line.content!.filter((c) => c !== ref);
    tag.attrs = { ...tag.attrs, due: null };
  } else tag.attrs = { ...tag.attrs, due };
}

/** Replace the words of a line, keeping its links, dates and tags (in their order) after the new words. */
export function setLineText(line: JSONContent, text: string) {
  const kept = (line.content ?? []).filter((c) => c.type !== 'text' && c.type !== 'hardBreak');
  const parts: JSONContent[] = [];
  if (text) parts.push({ type: 'text', text: text + (kept.length ? ' ' : '') });
  kept.forEach((c, i) => {
    if (i) parts.push({ type: 'text', text: ' ' });
    parts.push(c);
  });
  line.content = parts;
}
