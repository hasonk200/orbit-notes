import type { JSONContent, TaskKind, TaskPriority, TaskStatus } from '../db/schema';
import { parseQuickDate } from './dates';

export function parseTaskInput(raw: string, now?: Date) {
  let text = raw.trim();
  let priority: TaskPriority | null = null;
  const priorityMatch = text.match(/(?:^|\s)!(high|p1|med|medium|p2|low|p3)(?=\s|$)/i);
  if (priorityMatch?.index != null) {
    const flag = priorityMatch[1].toLowerCase();
    priority = flag === 'high' || flag === 'p1' ? 'high' : flag === 'low' || flag === 'p3' ? 'low' : 'medium';
    text = (text.slice(0, priorityMatch.index) + ' ' + text.slice(priorityMatch.index + priorityMatch[0].length)).trim();
  }
  const dateMatch = text.match(/(?:\s|(?<=\p{Script=Han}))[@＠]([^@＠]+)$/u);
  const due = dateMatch ? parseQuickDate(dateMatch[1], now) : null;
  if (due && dateMatch?.index != null) text = text.slice(0, dateMatch.index).trimEnd();
  return { text, due, priority };
}

export interface AppendTaskOptions {
  kind?: TaskKind | null;
  status?: TaskStatus;
  contextId?: string | null;
}

export function appendTask(
  doc: JSONContent,
  taskId: string,
  text: string,
  due: string | null,
  priority: TaskPriority | null,
  opts?: AppendTaskOptions,
): JSONContent {
  const content = [...(doc.content ?? [])];
  const status = opts?.status ?? 'open';
  const checked = status === 'done';
  const attrs: Record<string, any> = {
    checked,
    taskId,
    due,
    priority,
    ...(status !== 'open' ? { status } : {}),
    ...(opts?.kind ? { kind: opts.kind } : {}),
    ...(opts?.contextId ? { contextId: opts.contextId } : {}),
    ...(checked ? { completedAt: Date.now() } : {}),
  };
  const item = {
    type: 'taskItem',
    attrs,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
  const last = content.at(-1);
  if (last?.type === 'taskList') content[content.length - 1] = { ...last, content: [...(last.content ?? []), item] };
  else {
    if (last?.type === 'paragraph' && !last.content?.length) content.pop();
    content.push({ type: 'taskList', content: [item] });
  }
  return { ...doc, content };
}
