import { Flag, Trash2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { TaskRec, TaskStatus } from '../db/schema';
import { deleteTask, updateTask } from '../db/indexers';
import { displayTitle, useObject, useTypeMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useT } from '../store/uiStore';
import { shortDate, todayISO } from '../lib/dates';
import { classifyTaskKind, NEXT_PRIO, PRIO_MAP, resolveTaskStatus, STATUS_MAP, TASK_STATUSES } from '../lib/tasks';
import { Popover } from './Popover';

export function TaskRow({
  task,
  showSource = true,
  showStatus = true,
  showKindBadge = false,
  extraActions,
}: {
  task: TaskRec;
  showSource?: boolean;
  showStatus?: boolean;
  showKindBadge?: boolean;
  extraActions?: ReactNode;
}) {
  const tr = useT();
  const srcObj = useObject(task.objectId);
  const ctxObj = useObject(task.contextId || task.objectId);
  const typeMap = useTypeMap();
  const open = useOpen();

  const effectiveKind =
    task.kind ??
    classifyTaskKind({
      explicitKind: task.explicitKind,
      status: task.status,
      contextId: task.contextId,
      sourceTypeId: srcObj?.typeId,
    });

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
            title={tr('Double-click to edit')}
          >
            {task.text || <span className="muted">{tr('Empty task')}</span>}
          </div>
        )}
        {showSource && ctxObj && (
          <button
            type="button"
            className="task-src"
            style={{ ['--type-color' as any]: t?.color }}
            onClick={(e) => open(objPath(ctxObj.id), e)}
          >
            {ctxObj.icon || t?.icon} {displayTitle(ctxObj, tr)}
          </button>
        )}
      </div>

      {showKindBadge && (
        <span className={`kind-pill kind-${effectiveKind}`}>
          {effectiveKind === 'task' ? tr('Task') : tr('To-do')}
        </span>
      )}

      {showStatus && (!showKindBadge || effectiveKind === 'task') && statusDef && (
        <button
          ref={statusRef}
          type="button"
          className={`status-pill tone-${statusDef.tone} compact`}
          title={tr('Change status')}
          onClick={() => setStatusOpen((v) => !v)}
        >
          {tr(statusDef.label)}
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
              {tr(s.label)}
            </button>
          ))}
        </Popover>
      )}

      <button
        type="button"
        className={`prio-chip${prioDef ? ` prio-${prioDef.id}` : ' prio-none'}`}
        onClick={cyclePrio}
        title={tr('Click to cycle priority (P1 High → P2 Med → P3 Low → None)')}
      >
        {prioDef ? prioDef.bang : <Flag size={11} />}
      </button>

      <label className={`task-due${overdue ? ' overdue' : ''}${task.due === todayISO() ? ' today' : ''}`} title={tr('Due date')}>
        <span>{task.due ? shortDate(task.due, tr) : tr('No date')}</span>
        <input type="date" value={task.due ?? ''} onChange={(e) => void updateTask(task.id, { due: e.target.value || null })} />
      </label>

      {extraActions}

      <button
        type="button"
        className="icon-btn tiny danger task-row-del"
        title={tr('Delete')}
        onClick={() => void deleteTask(task.id)}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
