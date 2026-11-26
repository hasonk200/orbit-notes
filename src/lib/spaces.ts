import type { AiTodo, AiTodoKind, JSONContent, Obj, ObjType, Space, TaskRec } from '../db/schema';
import type { Translate } from './i18n';

/**
 * Orbit shows two spaces, "My space" and the "AI workspace". They are one database: every note
 * carries a `space` mark ('ai', or nothing for the user's own space, so older notes need no move).
 * Tasks follow the note they live in. Links work across both spaces.
 */
export const SPACES: Space[] = ['me', 'ai'];
export const AI_LOG_TYPE = 'ai-log';
export const AI_DOC_TYPE = 'ai-doc';
/** Days after which an unhandled AI to-do is marked as waiting too long. */
export const STALE_AI_TODO_DAYS = 14;
/** The AI workspace home lists logs from this many recent days; older ones are in the archive. */
export const RECENT_LOG_DAYS = 7;

export const spaceOf = (o: { space?: string | null } | null | undefined): Space => (o?.space === 'ai' ? 'ai' : 'me');
export const inSpace = (o: { space?: string | null } | null | undefined, space: Space) => spaceOf(o) === space;
export const otherSpace = (space: Space): Space => (space === 'ai' ? 'me' : 'ai');
/** The mark to store: the user's own space is the default and is left off. */
export const spaceMark = (space: Space): Pick<Obj, 'space'> => ({ space: space === 'ai' ? 'ai' : undefined });

export function parseSpace(value: unknown): Space {
  return value === 'ai' ? 'ai' : 'me';
}

/** Active notes in one space (or both). */
export function objectsInSpace<T extends Pick<Obj, 'space' | 'deletedAt'>>(objects: T[], space: Space | 'all'): T[] {
  return objects.filter((o) => !o.deletedAt && (space === 'all' || spaceOf(o) === space));
}

/** Tasks whose note is in this space. Tasks whose note is gone stay with the user's own space. */
export function tasksInSpace<T extends Pick<TaskRec, 'objectId'>>(tasks: T[], objMap: Map<string, Pick<Obj, 'space'>>, space: Space): T[] {
  return tasks.filter((t) => spaceOf(objMap.get(t.objectId)) === space);
}

/**
 * Object types listed in a space. My space lists every type except the AI workspace's own types,
 * exactly as before. The AI workspace lists its own types first, then any other type that has notes there.
 */
export function typesForSpace(types: ObjType[], objects: Pick<Obj, 'typeId' | 'space' | 'deletedAt'>[], space: Space): ObjType[] {
  if (space === 'me') return types.filter((t) => t.space !== 'ai');
  const used = new Set(objects.filter((o) => !o.deletedAt && spaceOf(o) === 'ai').map((o) => o.typeId));
  const own = types.filter((t) => t.space === 'ai');
  const others = types.filter((t) => t.space !== 'ai' && t.id !== 'daily' && (used.has(t.id) || t.id === 'page'));
  return [...own, ...others];
}

/** Types you can create from the New menu in a space (the day note has its own button). */
export function creatableTypes(types: ObjType[], objects: Pick<Obj, 'typeId' | 'space' | 'deletedAt'>[], space: Space): ObjType[] {
  return typesForSpace(types, objects, space).filter((t) => t.id !== 'daily' && t.id !== AI_LOG_TYPE);
}

// ---------- the AI workspace's own types ----------

export const AI_DOC_STATUSES = ['Draft', 'To review', 'Adopted', 'Archived'] as const;
export type AiDocStatus = (typeof AI_DOC_STATUSES)[number];

export const AI_TYPES: ObjType[] = [
  { id: AI_LOG_TYPE, name: 'AI log', icon: '🤖', color: '#0f9b8e', order: 100, builtin: true, space: 'ai', properties: [], defaultTemplate: null },
  {
    id: AI_DOC_TYPE, name: 'AI document', icon: '📄', color: '#1b8fb0', order: 101, builtin: true, space: 'ai',
    properties: [
      { key: 'source', name: 'Source AI', kind: 'text' },
      { key: 'date', name: 'Date', kind: 'date' },
      { key: 'status', name: 'Status', kind: 'select', options: [...AI_DOC_STATUSES] },
      { key: 'related', name: 'Related notes', kind: 'relation', targetTypeId: null, multi: true },
    ],
    defaultTemplate: null,
  },
];

export function aiDocStatus(o: Pick<Obj, 'props'>): AiDocStatus {
  const v = o.props?.status;
  return (AI_DOC_STATUSES as readonly string[]).includes(v) ? (v as AiDocStatus) : 'Draft';
}

// ---------- AI logs: one per day ----------

export const aiLogId = (date: string) => `ai-log-${date}`;
export const isAiLogId = (id: string) => /^ai-log-\d{4}-\d{2}-\d{2}$/.test(id);

const WEEKDAYS_ZH = '日一二三四五六';
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekday(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "AI 日誌 · 2026-11-26（三）", or "AI log · 2026-11-26 (Thu)" in English. */
export function aiLogTitle(date: string, t?: Pick<Translate, 'language'>) {
  const day = weekday(date);
  if (Number.isNaN(day)) return t?.language === 'en' ? `AI log · ${date}` : `AI 日誌 · ${date}`;
  return t?.language === 'en' ? `AI log · ${date} (${WEEKDAYS_EN[day]})` : `AI 日誌 · ${date}（${WEEKDAYS_ZH[day]}）`;
}

/** "Notion 全面掃描報告（2026-11-25）": AI documents are named topic plus date. */
export function aiDocTitle(topic: string, date: string) {
  const clean = topic.trim().replace(/\s*[（(]\d{4}-\d{2}-\d{2}[)）]\s*$/u, '');
  return `${clean}（${date}）`;
}

// ---------- one work entry in the log ----------

export interface AiWorkEntry {
  /** Local clock time, "14:30". */
  time: string;
  /** Which AI app did the work. */
  by: string;
  title: string;
  done: string;
  /** Ids of the notes that were changed. */
  notes: string[];
  /** Left unfinished: each becomes an "AI next time" to-do. */
  open?: string[];
  /** The user needs to check: each becomes a "Waiting for you" to-do. */
  confirm?: string[];
  /** Local calendar date of the log, for the to-dos. */
  date: string;
}

const text = (value: string): JSONContent => ({ type: 'text', text: value });
const para = (...content: JSONContent[]): JSONContent => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
const bullet = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });

export function aiTodoTask(taskId: string, kind: AiTodoKind, label: string, date: string, notes: string[]): JSONContent {
  const aiTodo: AiTodo = { kind, at: date, ...(notes.length ? { notes } : {}) };
  return {
    type: 'taskItem',
    attrs: { checked: false, taskId, due: null, priority: null, kind: 'todo', aiTodo },
    content: [para(text(label))],
  };
}

/**
 * The fixed layout of one piece of work:
 *   ## 14:30 · Claude · Tidy up the finance notes
 *   - 做了什麼：…
 *   - 改了哪些筆記：[[A]]、[[B]]
 *   - 還沒完成：  (each item is an "AI next time" to-do)
 *   - 需要你確認：(each item is a "Waiting for you" to-do)
 */
export function aiWorkBlocks(entry: AiWorkEntry, newId: () => string): JSONContent[] {
  const noteIds = [...new Set(entry.notes)];
  const links: JSONContent[] = [];
  noteIds.forEach((id, i) => {
    if (i) links.push(text('、'));
    links.push({ type: 'objectLink', attrs: { id, display: 'inline' } });
  });
  const items: JSONContent[] = [
    bullet(para(text('做了什麼：' + entry.done))),
    bullet(para(text('改了哪些筆記：'), ...(links.length ? links : [text('（沒有）')]))),
  ];
  const todoList = (kind: AiTodoKind, list?: string[]) =>
    list?.length ? [{ type: 'taskList', content: list.map((label) => aiTodoTask(newId(), kind, label, entry.date, noteIds)) }] : [];
  if (entry.open?.length) items.push(bullet(para(text('還沒完成：')), ...todoList('next', entry.open)));
  if (entry.confirm?.length) items.push(bullet(para(text('需要你確認：')), ...todoList('confirm', entry.confirm)));
  return [
    { type: 'heading', attrs: { level: 2 }, content: [text(`${entry.time} · ${entry.by} · ${entry.title}`)] },
    { type: 'bulletList', content: items },
  ];
}

/** Add an entry to a log body, replacing the empty first paragraph of a new log. */
export function appendAiWork(doc: JSONContent | undefined, entry: AiWorkEntry, newId: () => string): JSONContent {
  const blocks = doc?.content ?? [];
  const empty = blocks.length === 0 || (blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].content?.length);
  return { type: 'doc', ...(doc?.attrs ? { attrs: doc.attrs } : {}), content: [...(empty ? [] : blocks), ...aiWorkBlocks(entry, newId)] };
}

/** The work entries of a log: the "## time · AI · title" headings, in order. */
export function aiLogEntries(doc: JSONContent | undefined): { time: string; by: string; title: string; heading: string }[] {
  const out: { time: string; by: string; title: string; heading: string }[] = [];
  for (const block of doc?.content ?? []) {
    if (block.type !== 'heading' || block.attrs?.level !== 2) continue;
    const heading = (block.content ?? []).map((c) => c.text ?? '').join('').trim();
    const m = heading.match(/^(\d{1,2}:\d{2})\s*·\s*([^·]+?)\s*·\s*(.+)$/u);
    if (m) out.push({ time: m[1], by: m[2], title: m[3], heading });
  }
  return out;
}

const utcDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole days from one local calendar date to another. */
export function daysSince(date: string, today: string) {
  return Math.round((utcDay(today) - utcDay(date)) / 86400000);
}

export const isStaleAiTodo = (todo: Pick<AiTodo, 'at'>, today: string) => daysSince(todo.at, today) > STALE_AI_TODO_DAYS;

export function parseAiTodo(value: unknown): AiTodo | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if ((v.kind !== 'confirm' && v.kind !== 'next') || typeof v.at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.at)) return null;
  const notes = Array.isArray(v.notes) ? v.notes.filter((n): n is string => typeof n === 'string') : [];
  return { kind: v.kind, at: v.at, ...(notes.length ? { notes } : {}) };
}
