import type { TaskPriority, TaskRec } from '../db/schema';
import { PRIO_RANK } from './tasks';

export interface TaskBundle {
  kind: 'bundle';
  key: string;
  objectId: string;
  groupId: string;
  title: string;
  tasks: TaskRec[];
  doneCount: number;
  totalCount: number;
  pct: number;
  earliestDue: string | null;
  highestPrio: TaskPriority | null;
}

export type TaskListEntry = { kind: 'single'; task: TaskRec } | TaskBundle;

/**
 * Collapse tasks belonging to the same `blockGroup` (`groupId`) into one expandable bundle card,
 * preserving first-appearance ordering. Progress counts come from `allTasksPool` when given so
 * filtered tabs (e.g. Today / Open) still show accurate overall completion.
 */
export function collapseTaskGroups(visibleTasks: TaskRec[], allTasksPool?: TaskRec[]): TaskListEntry[] {
  const poolStats = new Map<string, { doneCount: number; totalCount: number; title: string }>();
  for (const t of allTasksPool ?? visibleTasks) {
    if (!t.groupId) continue;
    const key = `${t.objectId}:${t.groupId}`;
    const entry = poolStats.get(key) ?? { doneCount: 0, totalCount: 0, title: '' };
    entry.totalCount++;
    if (t.done) entry.doneCount++;
    if (!entry.title && t.groupTitle) entry.title = t.groupTitle;
    poolStats.set(key, entry);
  }

  const out: TaskListEntry[] = [];
  const bundles = new Map<string, TaskBundle>();

  for (const t of visibleTasks) {
    if (!t.groupId) {
      out.push({ kind: 'single', task: t });
      continue;
    }
    const key = `${t.objectId}:${t.groupId}`;
    let bundle = bundles.get(key);
    if (!bundle) {
      const stats = poolStats.get(key);
      const doneCount = stats?.doneCount ?? (t.done ? 1 : 0);
      const totalCount = stats?.totalCount ?? 1;
      bundle = {
        kind: 'bundle',
        key,
        objectId: t.objectId,
        groupId: t.groupId,
        title: t.groupTitle || stats?.title || '',
        tasks: [],
        doneCount,
        totalCount,
        pct: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0,
        earliestDue: null,
        highestPrio: null,
      };
      bundles.set(key, bundle);
      out.push(bundle);
    }
    bundle.tasks.push(t);
    if (!bundle.title && t.groupTitle) bundle.title = t.groupTitle;
    if (!t.done && t.due && (!bundle.earliestDue || t.due < bundle.earliestDue)) {
      bundle.earliestDue = t.due;
    }
    if (!t.done && t.priority) {
      const curRank = bundle.highestPrio ? (PRIO_RANK[bundle.highestPrio] ?? 3) : 3;
      const nextRank = PRIO_RANK[t.priority] ?? 3;
      if (nextRank < curRank) bundle.highestPrio = t.priority;
    }
  }

  return out;
}

/** Count visible list entries after collapsing grouped tasks (10 grouped tasks -> 1). */
export function countCollapsedEntries(tasks: TaskRec[]): number {
  const seenGroups = new Set<string>();
  let count = 0;
  for (const t of tasks) {
    if (!t.groupId) {
      count++;
    } else {
      const key = `${t.objectId}:${t.groupId}`;
      if (!seenGroups.has(key)) {
        seenGroups.add(key);
        count++;
      }
    }
  }
  return count;
}
