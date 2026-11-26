import type { AiTodo, JSONContent, TaskKind, TaskPriority, TaskStatus } from '../db/schema';
import { uid } from './uid';
import { resolveTaskStatus } from './tasks';
import { parseAiTodo } from './spaces';
import { eachTaggedLine, isTaskTag, lineDate, setLineDue, setLineText, tagTaskKind, tagTaskName } from './tagTasks';

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
  if (node.type === 'toggle') {
    const head = String(node.attrs?.title ?? '').trim();
    const body = inner.join('\n').trim();
    return [head, body].filter(Boolean).join('\n');
  }
  if (node.type === 'tableRow') return inner.join(' | ');
  const isBlockContainer = ['doc', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote', 'callout', 'table'].includes(node.type ?? '');
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
  status: TaskStatus;
  explicitKind: TaskKind | null;
  linkIds: string[];
  due: string | null;
  priority: TaskPriority | null;
  contextId: string | null;
  completedAt: number | null;
  aiTodo: AiTodo | null;
}

/** Text of a task item, without nested task lists. */
function taskOwnText(n: JSONContent, titleOf?: (id: string) => string) {
  return (n.content ?? [])
    .filter((c) => c.type !== 'taskList' && c.type !== 'bulletList' && c.type !== 'orderedList')
    .map((c) => nodeText(c, titleOf))
    .join(' ')
    .trim();
}

/** Inline objectLink IDs inside a task item's own content (excluding nested lists). */
function taskOwnLinkIds(n: JSONContent): string[] {
  const ids = new Set<string>();
  for (const child of n.content ?? []) {
    if (child.type === 'taskList' || child.type === 'bulletList' || child.type === 'orderedList') continue;
    walk(child, (c) => {
      if (c.type === 'objectLink' && c.attrs?.id) ids.add(c.attrs.id);
    });
  }
  return [...ids];
}

export function extractTasks(doc: JSONContent | undefined, titleOf?: (id: string) => string): ExtractedTask[] {
  const out: ExtractedTask[] = [];
  walk(doc, (n) => {
    if (n.type === 'taskItem' && n.attrs?.taskId) {
      const done = !!n.attrs.checked || n.attrs.status === 'done';
      const rawKind = n.attrs.kind;
      const explicitKind: TaskKind | null = rawKind === 'todo' || rawKind === 'task' ? rawKind : null;
      out.push({
        id: n.attrs.taskId,
        text: taskOwnText(n, titleOf),
        done,
        status: resolveTaskStatus(done, n.attrs.status),
        explicitKind,
        linkIds: taskOwnLinkIds(n),
        due: n.attrs.due || null,
        priority: (n.attrs.priority as TaskPriority) || null,
        contextId: n.attrs.contextId || null,
        completedAt: typeof n.attrs.completedAt === 'number' ? n.attrs.completedAt : null,
        aiTodo: parseAiTodo(n.attrs.aiTodo),
      });
    }
  });
  // Lines tagged #待辦 / #專案任務 are tasks too; the tag holds their state.
  eachTaggedLine(doc, (line, tag) => {
    const a = tag.attrs ?? {};
    if (!a.taskId) return;
    const done = !!a.checked || a.status === 'done';
    // The task's words: the line without its task tag and without the @date that is its due date.
    const dueRef = line.content?.find((c) => c.type === 'dateRef' && c.attrs?.date);
    const words = { ...line, content: (line.content ?? []).filter((c) => c !== tag && c !== dueRef) };
    const linkIds = new Set<string>();
    walk(words, (c) => {
      if (c.type === 'objectLink' && c.attrs?.id) linkIds.add(c.attrs.id);
    });
    out.push({
      id: a.taskId,
      text: nodeText(words, titleOf).replace(/\s+/g, ' ').trim(),
      done,
      status: resolveTaskStatus(done, a.status),
      explicitKind: tagTaskKind(a.name),
      linkIds: [...linkIds],
      due: lineDate(line) ?? a.due ?? null,
      priority: (a.priority as TaskPriority) || null,
      contextId: a.contextId || null,
      completedAt: typeof a.completedAt === 'number' ? a.completedAt : null,
      aiTodo: null,
    });
  });
  return out;
}

/** Give every task item a unique id (deep copy). Used for templates and imports. */
export function assignTaskIds(doc: JSONContent, fresh = false): JSONContent {
  const copy: JSONContent = JSON.parse(JSON.stringify(doc ?? emptyDoc()));
  const seen = new Set<string>();
  walk(copy, (n) => {
    if (n.type === 'taskItem' || isTaskTag(n)) {
      n.attrs = n.attrs ?? {};
      if (fresh || !n.attrs.taskId || seen.has(n.attrs.taskId)) n.attrs.taskId = uid();
      seen.add(n.attrs.taskId);
    }
  });
  return copy;
}

export interface TaskPatch {
  checked?: boolean;
  status?: TaskStatus;
  kind?: TaskKind | null;
  due?: string | null;
  priority?: TaskPriority | null;
  contextId?: string | null;
  text?: string;
}

function applyTaskPatch(n: JSONContent, patch: TaskPatch) {
  const attrs = { ...(n.attrs ?? {}) };
  if (patch.status !== undefined) {
    attrs.status = patch.status;
    if (patch.status === 'done') {
      attrs.checked = true;
      attrs.completedAt = attrs.completedAt ?? Date.now();
    } else {
      attrs.checked = false;
      attrs.completedAt = null;
    }
  }
  if (patch.checked !== undefined) {
    attrs.checked = patch.checked;
    if (patch.checked) {
      attrs.status = 'done';
      attrs.completedAt = Date.now();
    } else {
      if (attrs.status === 'done') attrs.status = 'open';
      attrs.completedAt = null;
    }
  }
  if (patch.kind !== undefined) {
    if (patch.kind === null) delete attrs.kind;
    else attrs.kind = patch.kind;
  }
  if (patch.due !== undefined) attrs.due = patch.due;
  if (patch.priority !== undefined) attrs.priority = patch.priority;
  if (patch.contextId !== undefined) attrs.contextId = patch.contextId;
  n.attrs = attrs;

  if (patch.text !== undefined) {
    const rest = (n.content ?? []).filter((c) => c.type === 'taskList' || c.type === 'bulletList' || c.type === 'orderedList');
    const trimmed = patch.text;
    n.content = [{ type: 'paragraph', content: trimmed ? [{ type: 'text', text: trimmed }] : [] }, ...rest];
  }
}

/** Update multiple task nodes inside one document in a single atomic copy. Returns null if none matched. */
export function patchTasksInDoc(doc: JSONContent, patches: Record<string, TaskPatch>): JSONContent | null {
  const copy: JSONContent = JSON.parse(JSON.stringify(doc));
  let found = false;
  walk(copy, (n) => {
    const id = n.attrs?.taskId;
    if (n.type === 'taskItem' && id && Object.prototype.hasOwnProperty.call(patches, id)) {
      applyTaskPatch(n, patches[id]);
      found = true;
    }
  });
  eachTaggedLine(copy, (line, tag) => {
    const id = tag.attrs?.taskId;
    if (!id || !Object.prototype.hasOwnProperty.call(patches, id)) return;
    const { kind, due, text, ...rest } = patches[id];
    applyTaskPatch(tag, rest);
    // The kind is the tag itself; a task tag cannot be "unset" to auto, so null keeps it as it is.
    if (kind) tag.attrs = { ...tag.attrs, name: tagTaskName(kind, tag.attrs?.name) };
    if (due !== undefined) setLineDue(line, tag, due);
    if (text !== undefined) setLineText(line, text);
    found = true;
  });
  return found ? copy : null;
}

/** Update the attrs (and optionally text) of the task node with this id. Returns a new doc, or null if not found. */
export function patchTaskInDoc(doc: JSONContent, taskId: string, patch: TaskPatch): JSONContent | null {
  return patchTasksInDoc(doc, { [taskId]: patch });
}

/** Remove the task node with this id from a TipTap document (also cleans up now-empty taskLists). */
export function removeTaskFromDoc(doc: JSONContent, taskId: string): JSONContent | null {
  const copy: JSONContent = JSON.parse(JSON.stringify(doc));
  let removed = false;
  const prune = (node: JSONContent): JSONContent[] | null => {
    if (!node.content) return null;
    const next: JSONContent[] = [];
    for (const child of node.content) {
      if (child.type === 'taskItem' && child.attrs?.taskId === taskId) {
        removed = true;
        continue;
      }
      // A tagged line stays; only its task tag goes.
      if (isTaskTag(child) && child.attrs?.taskId === taskId) {
        removed = true;
        continue;
      }
      const sub = prune(child);
      if (sub) child.content = sub;
      if (child.type === 'taskList' && (!child.content || child.content.length === 0)) continue;
      next.push(child);
    }
    return next;
  };
  const nextRoot = prune(copy);
  if (!removed) return null;
  copy.content = nextRoot && nextRoot.length ? nextRoot : [{ type: 'paragraph' }];
  return copy;
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
