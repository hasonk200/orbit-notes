import type { TaskPriority, TaskStatus } from '../db/schema';
import { parseQuickDate } from './dates';

export interface StatusDef {
  id: TaskStatus;
  label: string;
  tone: 'neutral' | 'rose' | 'amber' | 'blue' | 'green';
}

export const TASK_STATUSES: StatusDef[] = [
  { id: 'open', label: 'Open', tone: 'neutral' },
  { id: 'not_started', label: 'Not Started', tone: 'rose' },
  { id: 'next_up', label: 'Next Up', tone: 'amber' },
  { id: 'in_progress', label: 'In Progress', tone: 'blue' },
  { id: 'done', label: 'Done', tone: 'green' },
];

export const STATUS_MAP = new Map<TaskStatus, StatusDef>(TASK_STATUSES.map((s) => [s.id, s]));

export const STATUS_RANK: Record<TaskStatus, number> = {
  in_progress: 0,
  next_up: 1,
  not_started: 2,
  open: 3,
  done: 4,
};

export interface PriorityDef {
  id: TaskPriority;
  label: string;
  bang: string;
  short: string;
}

export const TASK_PRIORITIES: PriorityDef[] = [
  { id: 'high', label: 'High', bang: '!!!', short: 'P1' },
  { id: 'medium', label: 'Medium', bang: '!!', short: 'P2' },
  { id: 'low', label: 'Low', bang: '!', short: 'P3' },
];

export const PRIO_MAP = new Map<TaskPriority, PriorityDef>(TASK_PRIORITIES.map((p) => [p.id, p]));

export const PRIO_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
  '': 3,
};

export const NEXT_PRIO: Record<string, TaskPriority | null> = {
  '': 'low',
  low: 'medium',
  medium: 'high',
  high: null,
};

/** Normalize status + checked so they never get out of sync. */
export function resolveTaskStatus(checked: boolean, rawStatus?: string | null): TaskStatus {
  if (checked) return 'done';
  if (rawStatus === 'not_started' || rawStatus === 'next_up' || rawStatus === 'in_progress' || rawStatus === 'open') {
    return rawStatus;
  }
  return 'open';
}

/** Parse quick inline tokens from a task input string: @tomorrow / @today / @2026-12-01 and !high / !p1 / !med / !p2 / !low / !p3. */
export function parseQuickTaskInput(raw: string): {
  text: string;
  due: string | null;
  priority: TaskPriority | null;
} {
  let text = raw.trim();
  let priority: TaskPriority | null = null;
  let due: string | null = null;

  const pm = text.match(/(?:^|\s)!(high|p1|med|medium|p2|low|p3|!{1,3})(?=\s|$)/i);
  if (pm) {
    const tok = pm[1].toLowerCase();
    if (tok === 'high' || tok === 'p1' || tok === '!!!') priority = 'high';
    else if (tok === 'low' || tok === 'p3' || tok === '!') priority = 'low';
    else priority = 'medium';
    text = (text.slice(0, pm.index) + ' ' + text.slice((pm.index ?? 0) + pm[0].length)).replace(/\s+/g, ' ').trim();
  }

  const dm = text.match(/(?:^|\s)@(\S+)(?=\s|$)/);
  if (dm) {
    const parsed = parseQuickDate(dm[1]);
    if (parsed) {
      due = parsed;
      text = (text.slice(0, dm.index) + ' ' + text.slice((dm.index ?? 0) + dm[0].length)).replace(/\s+/g, ' ').trim();
    }
  }

  return { text, due, priority };
}
