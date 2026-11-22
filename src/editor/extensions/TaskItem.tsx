import { TaskItem as BaseTaskItem } from '@tiptap/extension-task-item';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { addDays } from 'date-fns';
import { useRef, useState } from 'react';
import { uid, type TaskPriority, type TaskStatus } from '../../db/schema';
import { shortDate, todayISO, toISODate } from '../../lib/dates';
import { PRIO_MAP, resolveTaskStatus, STATUS_MAP, TASK_PRIORITIES, TASK_STATUSES } from '../../lib/tasks';
import { displayTitle, useActiveObjects, useData } from '../../store/dataStore';
import { objPath, useOpen } from '../../store/pane';
import { Popover } from '../../components/Popover';

function TaskItemView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const checked = !!node.attrs.checked || node.attrs.status === 'done';
  const status = resolveTaskStatus(checked, node.attrs.status);
  const due = node.attrs.due as string | null;
  const priority = (node.attrs.priority as TaskPriority | null) ?? null;
  const contextId = (node.attrs.contextId as string | null) ?? null;

  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const open = useOpen();
  const activeObjects = useActiveObjects();
  const types = useData((s) => s.types);

  const overdue = !!due && !checked && due < todayISO();
  const isToday = !!due && due === todayISO();
  const set = (attrs: Record<string, any>) => updateAttributes(attrs as any);

  const setChecked = (nextChecked: boolean) => {
    set({
      checked: nextChecked,
      status: nextChecked ? 'done' : status === 'done' ? 'open' : status,
      completedAt: nextChecked ? Date.now() : null,
    });
  };

  const setStatus = (nextStatus: TaskStatus) => {
    const isDone = nextStatus === 'done';
    set({
      status: nextStatus,
      checked: isDone,
      completedAt: isDone ? Date.now() : null,
    });
  };

  const statusDef = STATUS_MAP.get(status);
  const prioDef = priority ? PRIO_MAP.get(priority) : null;
  const ctxObj = contextId ? activeObjects.find((o) => o.id === contextId) : null;
  const ctxType = ctxObj ? types.find((t) => t.id === ctxObj.typeId) : null;

  const today = todayISO();
  const tomorrow = toISODate(addDays(new Date(), 1));
  const nextWeek = toISODate(addDays(new Date(), 7));

  return (
    <NodeViewWrapper as="div" className="task-item" data-checked={checked ? 'true' : 'false'}>
      <label className="task-check" contentEditable={false}>
        <input
          type="checkbox"
          checked={checked}
          disabled={!editor.isEditable}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span className="task-box round" />
      </label>
      <NodeViewContent className="task-content" />
      <span className="task-meta" contentEditable={false}>
        {status !== 'open' && status !== 'done' && statusDef && (
          <button
            type="button"
            className={`status-pill tone-${statusDef.tone} compact`}
            title="Change task status, date or priority"
            onClick={() => editor.isEditable && setPickerOpen((v) => !v)}
          >
            {statusDef.label}
          </button>
        )}
        {prioDef && (
          <button
            type="button"
            className={`prio-chip prio-${prioDef.id}`}
            title={`Priority: ${prioDef.label}`}
            onClick={() => editor.isEditable && setPickerOpen((v) => !v)}
          >
            {prioDef.bang}
          </button>
        )}
        {ctxObj && (
          <button
            type="button"
            className="ctx-mini-chip"
            style={{ ['--type-color' as any]: ctxType?.color }}
            title={`Context: ${displayTitle(ctxObj)}`}
            onClick={(e) => open(objPath(ctxObj.id), e)}
          >
            {ctxObj.icon || ctxType?.icon} {displayTitle(ctxObj)}
          </button>
        )}
        {due ? (
          <span className={`due-chip${overdue ? ' overdue' : ''}${isToday ? ' today' : ''}`}>
            <button
              ref={triggerRef}
              type="button"
              className="due-chip-label"
              title="Change due date, status or priority (Alt+Click opens the day)"
              onClick={(e) => {
                if (e.altKey) return open(`/calendar?mode=day&date=${due}`, e);
                if (editor.isEditable) setPickerOpen((v) => !v);
              }}
            >
              ◷ {shortDate(due)}
            </button>
            {editor.isEditable && (
              <button type="button" className="due-chip-x" title="Remove date" onClick={() => set({ due: null })}>
                ×
              </button>
            )}
          </span>
        ) : (
          editor.isEditable && (
            <button
              ref={triggerRef}
              type="button"
              className="due-add"
              title="Set status, due date, priority or context (or type @today)"
              onClick={() => setPickerOpen((v) => !v)}
            >
              ◷
            </button>
          )
        )}
        {pickerOpen && (
          <Popover anchor={triggerRef.current} onClose={() => setPickerOpen(false)} className="task-popover">
            <div className="tp-section">Status</div>
            <div className="tp-statuses">
              {TASK_STATUSES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`status-pill tone-${s.tone}${status === s.id ? ' active' : ''}`}
                  onClick={() => {
                    setStatus(s.id);
                    setPickerOpen(false);
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="tp-section">Scheduled date</div>
            <div className="tp-quick">
              <button
                type="button"
                className={due === today ? 'active' : ''}
                onClick={() => {
                  set({ due: today });
                  setPickerOpen(false);
                }}
              >
                Today
              </button>
              <button
                type="button"
                className={due === tomorrow ? 'active' : ''}
                onClick={() => {
                  set({ due: tomorrow });
                  setPickerOpen(false);
                }}
              >
                Tomorrow
              </button>
              <button
                type="button"
                className={due === nextWeek ? 'active' : ''}
                onClick={() => {
                  set({ due: nextWeek });
                  setPickerOpen(false);
                }}
              >
                Next week
              </button>
            </div>
            <input
              type="date"
              className="tp-date"
              value={due ?? ''}
              onChange={(e) => {
                set({ due: e.target.value || null });
                setPickerOpen(false);
              }}
            />
            {due && (
              <button
                type="button"
                className="tp-clear"
                onClick={() => {
                  set({ due: null });
                  setPickerOpen(false);
                }}
              >
                Clear date
              </button>
            )}
            <div className="tp-section">Priority</div>
            <div className="tp-prios">
              {TASK_PRIORITIES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`prio-chip prio-${p.id}${priority === p.id ? ' active' : ''}`}
                  onClick={() => {
                    set({ priority: priority === p.id ? null : p.id });
                    setPickerOpen(false);
                  }}
                >
                  {p.bang} {p.label}
                </button>
              ))}
            </div>
            <div className="tp-section">Context</div>
            <select
              className="tp-select"
              value={contextId ?? ''}
              onChange={(e) => {
                set({ contextId: e.target.value || null });
                setPickerOpen(false);
              }}
            >
              <option value="">This note (default)</option>
              {activeObjects
                .filter((o) => o.typeId !== 'daily')
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, 40)
                .map((o) => {
                  const tp = types.find((t) => t.id === o.typeId);
                  return (
                    <option key={o.id} value={o.id}>
                      {o.icon || tp?.icon || '📄'} {displayTitle(o)}
                    </option>
                  );
                })}
            </select>
          </Popover>
        )}
      </span>
    </NodeViewWrapper>
  );
}

/** TaskItem with stable UUID (taskId), status, scheduled date, priority, contextId & completedAt. */
export const OrbitTaskItem = BaseTaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      taskId: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-task-id'),
        renderHTML: (a: Record<string, any>) => (a.taskId ? { 'data-task-id': a.taskId } : {}),
      },
      status: {
        default: 'open',
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-status') || 'open',
        renderHTML: (a: Record<string, any>) => (a.status && a.status !== 'open' ? { 'data-status': a.status } : {}),
      },
      due: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-due'),
        renderHTML: (a: Record<string, any>) => (a.due ? { 'data-due': a.due } : {}),
      },
      priority: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-priority'),
        renderHTML: (a: Record<string, any>) => (a.priority ? { 'data-priority': a.priority } : {}),
      },
      contextId: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-context-id'),
        renderHTML: (a: Record<string, any>) => (a.contextId ? { 'data-context-id': a.contextId } : {}),
      },
      completedAt: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('data-completed-at');
          return v ? Number(v) : null;
        },
        renderHTML: (a: Record<string, any>) => (a.completedAt ? { 'data-completed-at': String(a.completedAt) } : {}),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView, { as: 'li', className: 'task-li' });
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey('taskIds'),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null;
          const seen = new Set<string>();
          let tr: Transaction | null = null;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'taskItem') return true;
            let id = node.attrs.taskId as string | null;
            if (!id || seen.has(id)) {
              id = uid();
              tr = tr ?? state.tr;
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, taskId: id });
            }
            seen.add(id);
            return true;
          });
          return tr;
        },
      }),
    ];
  },
}).configure({ nested: true });
