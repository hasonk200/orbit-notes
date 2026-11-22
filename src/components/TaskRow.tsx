import { Flag, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { TaskRec, TaskStatus } from '../db/schema';
import { deleteTask, updateTask } from '../db/indexers';
import { displayTitle, useObject, useTypeMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { shortDate, todayISO } from '../lib/dates';
import { NEXT_PRIO, PRIO_MAP, resolveTaskStatus, STATUS_MAP, TASK_STATUSES } from '../lib/tasks';
import { Popover } from './Popover';

export function TaskRow({ task, showSource = true }: { task: TaskRec; showSource?: boolean }) {
  const ctxObj = useObject(task.contextId || task.objectId);
  const typeMap = useTypeMap();
  const open = useOpen();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLButtonElement>(null);

  const t = ctxObj ? typeMap.get(ctxObj.typeId) : undefined;
  const overdue = !!task.due && !task.done && task.due < todayISO();
  const prioDef = task.priority ? PRIO_MAP.get(task.priority) : null;
  const status: TaskStatus = resolveTaskStatus(task.done, task.status);
  const statusDef = STATUS_MAP.get(status);

  const cyclePrio = () => {
    void updateTask(task.id, { priority: NEXT_PRIO[task.priority ?? ''] ?? null });
  };

  const commitTitle = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== task.text) void updateTask(task.id, { text: trimmed });
    else setDraft(task.text);
  };

  return (
    <div className={`task-row${task.done ? ' done' : ''}`}>
      <label className="task-check">
        <input
          type="checkbox"
          checked={task.done}
          onChange={(e) => void updateTask(task.id, { checked: e.target.checked })}
        />
        <span className="task-box round" />
      </label>
      <div className="task-row-main">
        {editing ? (
          <input
            className="tcard-edit"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') {
                setDraft(task.text);
                setEditing(false);
              }
            }}
          />
        ) : (
          <div
            className="task-row-text"
            onDoubleClick={() => {
              setDraft(task.text);
              setEditing(true);
            }}
            title="Double-click to edit"
          >
            {task.text || <span className="muted">Empty task</span>}
          </div>
        )}
        {showSource && ctxObj && (
          <button
            type="button"
            className="task-src"
            style={{ ['--type-color' as any]: t?.color }}
            onClick={(e) => open(objPath(ctxObj.id), e)}
          >
            {ctxObj.icon || t?.icon} {displayTitle(ctxObj)}
          </button>
        )}
      </div>

      {statusDef && (
        <button
          ref={statusRef}
          type="button"
          className={`status-pill tone-${statusDef.tone} compact`}
          title="Change status"
          onClick={() => setStatusOpen((v) => !v)}
        >
          {statusDef.label}
        </button>
      )}
      {statusOpen && (
        <Popover anchor={statusRef.current} onClose={() => setStatusOpen(false)} className="status-pop">
          {TASK_STATUSES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`status-pill tone-${s.tone}${status === s.id ? ' active' : ''}`}
              onClick={() => {
                void updateTask(task.id, { status: s.id });
                setStatusOpen(false);
              }}
            >
              {s.label}
            </button>
          ))}
        </Popover>
      )}

      <button
        type="button"
        className={`prio-chip${prioDef ? ` prio-${prioDef.id}` : ' prio-none'}`}
        onClick={cyclePrio}
        title={prioDef ? `Priority: ${prioDef.label} (click to cycle)` : 'Set priority'}
      >
        {prioDef ? prioDef.bang : <Flag size={11} />}
      </button>

      <label className={`task-due${overdue ? ' overdue' : ''}${task.due === todayISO() ? ' today' : ''}`} title="Scheduled date">
        <span>{task.due ? shortDate(task.due) : 'No date'}</span>
        <input type="date" value={task.due ?? ''} onChange={(e) => void updateTask(task.id, { due: e.target.value || null })} />
      </label>

      <button
        type="button"
        className="icon-btn tiny danger task-row-del"
        title="Delete task"
        onClick={() => void deleteTask(task.id)}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
