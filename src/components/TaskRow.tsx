import type { TaskPriority, TaskRec } from '../db/schema';
import { updateTask } from '../db/indexers';
import { displayTitle, useObject, useTypeMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { shortDate, todayISO } from '../lib/dates';

const NEXT_PRIO: Record<string, TaskPriority | null> = {
  '': 'high',
  high: 'medium',
  medium: 'low',
  low: null,
};

export function TaskRow({ task, showSource = true }: { task: TaskRec; showSource?: boolean }) {
  const src = useObject(task.objectId);
  const typeMap = useTypeMap();
  const open = useOpen();
  const t = src ? typeMap.get(src.typeId) : undefined;
  const overdue = !!task.due && !task.done && task.due < todayISO();
  const prio = task.priority ?? null;

  const cyclePrio = () => {
    void updateTask(task.id, { priority: NEXT_PRIO[prio ?? ''] ?? null });
  };

  return (
    <div className={`task-row${task.done ? ' done' : ''}`}>
      <label className="task-check">
        <input type="checkbox" checked={task.done} onChange={(e) => updateTask(task.id, { checked: e.target.checked })} />
        <span className="task-box" />
      </label>
      <div className="task-row-main">
        <div className="task-row-text">{task.text || <span className="muted">Empty task</span>}</div>
        {showSource && src && (
          <button type="button" className="task-src" onClick={(e) => open(objPath(src.id), e)}>
            {src.icon || t?.icon} {displayTitle(src)}
          </button>
        )}
      </div>
      <button
        type="button"
        className={`prio-chip${prio ? ` prio-${prio}` : ' prio-none'}`}
        onClick={cyclePrio}
        title="Click to cycle priority (P1 High → P2 Med → P3 Low → None)"
      >
        {prio === 'high' ? 'P1' : prio === 'medium' ? 'P2' : prio === 'low' ? 'P3' : 'P—'}
      </button>
      <label className={`task-due${overdue ? ' overdue' : ''}${task.due === todayISO() ? ' today' : ''}`} title="Due date">
        <span>{task.due ? shortDate(task.due) : 'No date'}</span>
        <input type="date" value={task.due ?? ''} onChange={(e) => updateTask(task.id, { due: e.target.value || null })} />
      </label>
    </div>
  );
}
