import { addDays, format, parseISO } from 'date-fns';
import { Calendar, CheckCircle2, ExternalLink, Flag, FolderOpen, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { TaskRec, TaskStatus } from '../db/schema';
import { deleteTask, updateTask } from '../db/indexers';
import { dateLabel, todayISO, toISODate } from '../lib/dates';
import { NEXT_PRIO, PRIO_MAP, resolveTaskStatus, TASK_STATUSES } from '../lib/tasks';
import { displayTitle, useActiveObjects, useObject, useTypeMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useT } from '../store/uiStore';
import { Popover } from './Popover';

export function TaskCard({
  task,
  onDragStart,
  onDragEnd,
}: {
  task: TaskRec;
  onDragStart?: (taskId: string) => void;
  onDragEnd?: () => void;
}) {
  const tr = useT();
  const ctxObj = useObject(task.contextId || task.objectId);
  const srcObj = useObject(task.objectId);
  const activeObjects = useActiveObjects();
  const typeMap = useTypeMap();
  const open = useOpen();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const [dateOpen, setDateOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
  const dateBtnRef = useRef<HTMLButtonElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const ctxBtnRef = useRef<HTMLButtonElement>(null);

  const status: TaskStatus = resolveTaskStatus(task.done, task.status);
  const prioDef = task.priority ? PRIO_MAP.get(task.priority) : null;
  const ctxType = ctxObj ? typeMap.get(ctxObj.typeId) : undefined;
  const overdue = !!task.due && !task.done && task.due < todayISO();
  const isToday = !!task.due && task.due === todayISO();

  const today = todayISO();
  const tomorrow = toISODate(addDays(new Date(), 1));
  const yesterday = toISODate(addDays(new Date(), -1));
  const nextWeek = toISODate(addDays(new Date(), 7));

  const formatCardDate = (iso: string) => {
    if (iso === today) return tr('Today');
    if (iso === tomorrow) return tr('Tomorrow');
    if (iso === yesterday) return tr('Yesterday');
    try {
      const d = parseISO(iso);
      return dateLabel(d, tr, 'MMMM d, yyyy', 'yyyy年M月d日');
    } catch {
      return format(new Date(), 'MMMM d, yyyy');
    }
  };

  const commitTitle = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== task.text) void updateTask(task.id, { text: trimmed });
    else setDraft(task.text);
  };

  const cyclePriority = () => {
    const next = NEXT_PRIO[task.priority ?? ''] ?? null;
    void updateTask(task.id, { priority: next });
  };

  return (
    <div
      className={`tcard${task.done ? ' is-done' : ''}`}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/orbit-task', task.id);
        onDragStart?.(task.id);
      }}
      onDragEnd={() => onDragEnd?.()}
    >
      <div className="tcard-top">
        <span className="tcard-badge">
          <CheckCircle2 size={11} /> {tr('Task')}
        </span>
        <button
          ref={menuBtnRef}
          type="button"
          className="tcard-more"
          title={tr('Task actions')}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      <div className="tcard-main">
        <label className="task-check">
          <input
            type="checkbox"
            checked={task.done}
            onChange={(e) => void updateTask(task.id, { checked: e.target.checked })}
          />
          <span className="task-box round" />
        </label>
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
            className="tcard-title"
            onDoubleClick={() => {
              setDraft(task.text);
              setEditing(true);
            }}
            title={tr('Double-click to edit')}
          >
            {task.text}
          </div>
        )}
      </div>

      <div className="tcard-meta">
        <button
          ref={dateBtnRef}
          type="button"
          className={`tcard-meta-btn${task.due ? ' has-date' : ''}${overdue ? ' overdue' : ''}${isToday ? ' today' : ''}`}
          title={task.due ? task.due : tr('Due date')}
          onClick={() => setDateOpen((v) => !v)}
        >
          {task.due && <span>{formatCardDate(task.due)}</span>}
          <Calendar size={13} />
        </button>

        <button
          type="button"
          className={`tcard-meta-btn${prioDef ? ` has-prio prio-${prioDef.id}` : ''}`}
          title={tr('Click to cycle priority (P1 High → P2 Med → P3 Low → None)')}
          onClick={cyclePriority}
        >
          {prioDef ? <span className="tcard-bang">{prioDef.bang}</span> : <Flag size={13} />}
        </button>
      </div>

      {ctxObj && (
        <div className="tcard-ctx-row">
          <button
            ref={ctxBtnRef}
            type="button"
            className="tcard-ctx"
            style={{ ['--type-color' as any]: ctxType?.color ?? '#8b8a86' }}
            title={displayTitle(ctxObj, tr)}
            onClick={(e) => open(objPath(ctxObj.id), e)}
          >
            <span className="tcard-ctx-icon">{ctxObj.icon || ctxType?.icon || '📄'}</span>
            <span className="tcard-ctx-name">{displayTitle(ctxObj, tr)}</span>
          </button>
        </div>
      )}

      {dateOpen && (
        <Popover anchor={dateBtnRef.current} onClose={() => setDateOpen(false)} className="task-popover">
          <div className="tp-section">{tr('Due date')}</div>
          <div className="tp-quick">
            <button
              type="button"
              className={task.due === today ? 'active' : ''}
              onClick={() => {
                void updateTask(task.id, { due: today });
                setDateOpen(false);
              }}
            >
              {tr('Today')}
            </button>
            <button
              type="button"
              className={task.due === tomorrow ? 'active' : ''}
              onClick={() => {
                void updateTask(task.id, { due: tomorrow });
                setDateOpen(false);
              }}
            >
              {tr('Tomorrow')}
            </button>
            <button
              type="button"
              className={task.due === nextWeek ? 'active' : ''}
              onClick={() => {
                void updateTask(task.id, { due: nextWeek });
                setDateOpen(false);
              }}
            >
              {tr('Next week')}
            </button>
          </div>
          <input
            type="date"
            className="tp-date"
            value={task.due ?? ''}
            onChange={(e) => {
              void updateTask(task.id, { due: e.target.value || null });
              setDateOpen(false);
            }}
          />
          {task.due && (
            <button
              type="button"
              className="tp-clear"
              onClick={() => {
                void updateTask(task.id, { due: null });
                setDateOpen(false);
              }}
            >
              {tr('Clear date')}
            </button>
          )}
        </Popover>
      )}

      {menuOpen && (
        <Popover anchor={menuBtnRef.current} onClose={() => setMenuOpen(false)} className="block-menu tcard-menu">
          <button
            type="button"
            onClick={() => {
              setDraft(task.text);
              setEditing(true);
              setMenuOpen(false);
            }}
          >
            <Pencil size={13} /> {tr('Edit title')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setCtxOpen(true);
            }}
          >
            <FolderOpen size={13} /> {tr('Change context')}
          </button>
          {srcObj && (
            <button
              type="button"
              onClick={(e) => {
                setMenuOpen(false);
                open(objPath(srcObj.id), e);
              }}
            >
              <ExternalLink size={13} /> {tr('Open source note')}
            </button>
          )}
          <div className="tcard-menu-sep" />
          <div className="tcard-menu-statuses">
            {TASK_STATUSES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`status-pill tone-${s.tone}${status === s.id ? ' active' : ''}`}
                onClick={() => {
                  void updateTask(task.id, { status: s.id });
                  setMenuOpen(false);
                }}
              >
                {tr(s.label)}
              </button>
            ))}
          </div>
          <div className="tcard-menu-sep" />
          <button
            type="button"
            className="danger"
            onClick={() => {
              setMenuOpen(false);
              void deleteTask(task.id);
            }}
          >
            <Trash2 size={13} /> {tr('Delete')}
          </button>
        </Popover>
      )}

      {ctxOpen && (
        <Popover anchor={ctxBtnRef.current || menuBtnRef.current} onClose={() => setCtxOpen(false)} className="task-popover">
          <div className="tp-section">{tr('Context')}</div>
          <select
            className="tp-select"
            autoFocus
            value={task.contextId ?? ''}
            onChange={(e) => {
              void updateTask(task.id, { contextId: e.target.value || null });
              setCtxOpen(false);
            }}
          >
            <option value="">{srcObj ? displayTitle(srcObj, tr) : tr('Default')}</option>
            {activeObjects
              .filter((o) => o.typeId !== 'daily')
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, 50)
              .map((o) => {
                const tp = typeMap.get(o.typeId);
                return (
                  <option key={o.id} value={o.id}>
                    {o.icon || tp?.icon || '📄'} {displayTitle(o, tr)}
                  </option>
                );
              })}
          </select>
        </Popover>
      )}
    </div>
  );
}
