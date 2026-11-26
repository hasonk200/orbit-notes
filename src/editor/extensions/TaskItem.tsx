import { TaskItem as BaseTaskItem } from '@tiptap/extension-task-item';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { addDays } from 'date-fns';
import { SupertagFields, useItemSupertags } from '../SupertagFields';
import { useRef, useState } from 'react';
import { uid, type TaskKind, type TaskPriority, type TaskStatus } from '../../db/schema';
import { shortDate, todayISO, toISODate } from '../../lib/dates';
import { PRIO_MAP, resolveTaskStatus, STATUS_MAP, TASK_PRIORITIES, TASK_STATUSES } from '../../lib/tasks';
import { displayTitle, useActiveObjects, useData } from '../../store/dataStore';
import { objPath, useOpen } from '../../store/pane';
import { useT } from '../../store/uiStore';
import { Popover } from '../../components/Popover';
import { MenuSelect } from '../../components/MenuSelect';
import { parseAiTodo } from '../../lib/spaces';

function TaskItemView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const tr = useT();
  const supertags = useItemSupertags(node);
  const checked = !!node.attrs.checked || node.attrs.status === 'done';
  const status = resolveTaskStatus(checked, node.attrs.status);
  const due = node.attrs.due as string | null;
  const priority = (node.attrs.priority as TaskPriority | null) ?? null;
  const contextId = (node.attrs.contextId as string | null) ?? null;
  const explicitKind = (node.attrs.kind === 'todo' || node.attrs.kind === 'task' ? node.attrs.kind : null) as TaskKind | null;
  const aiTodo = parseAiTodo(node.attrs.aiTodo);

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
    <NodeViewWrapper as="div" className={`task-item${supertags.length ? ' has-fields' : ''}`} data-checked={checked ? 'true' : 'false'}>
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
        {aiTodo && (
          <span className={`ai-todo-chip is-${aiTodo.kind}`} title={tr(aiTodo.kind === 'confirm' ? 'The AI needs you to check this' : 'Left for the next AI session')}>
            {tr(aiTodo.kind === 'confirm' ? 'Waiting for you' : 'AI next time')}
          </span>
        )}
        {status !== 'open' && status !== 'done' && statusDef && (
          <button
            type="button"
            className={`status-pill tone-${statusDef.tone} compact`}
            title={tr('Change due date or priority (Alt+Click opens the day)')}
            onClick={() => editor.isEditable && setPickerOpen((v) => !v)}
          >
            {tr(statusDef.label)}
          </button>
        )}
        {prioDef && (
          <button
            type="button"
            className={`prio-chip prio-${prioDef.id}`}
            title={tr('Change priority or due date')}
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
            title={displayTitle(ctxObj, tr)}
            onClick={(e) => open(objPath(ctxObj.id), e)}
          >
            {ctxObj.icon || ctxType?.icon} {displayTitle(ctxObj, tr)}
          </button>
        )}
        {due ? (
          <span className={`due-chip${overdue ? ' overdue' : ''}${isToday ? ' today' : ''}`}>
            <button
              ref={triggerRef}
              type="button"
              className="due-chip-label"
              title={tr('Change due date or priority (Alt+Click opens the day)')}
              onClick={(e) => {
                if (e.altKey) return open(`/calendar?mode=day&date=${due}`, e);
                if (editor.isEditable) setPickerOpen((v) => !v);
              }}
            >
              ◷ {shortDate(due, tr)}
            </button>
            {editor.isEditable && (
              <button type="button" className="due-chip-x" title={tr('Remove date')} onClick={() => set({ due: null })}>
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
              title={tr('Set due date or priority (or type @today)')}
              onClick={() => setPickerOpen((v) => !v)}
            >
              ◷
            </button>
          )
        )}
        {pickerOpen && (
          <Popover anchor={triggerRef.current} onClose={() => setPickerOpen(false)} className="task-popover">
            <div className="tp-section">{tr('Kind')}</div>
            <div className="tp-quick">
              <button
                type="button"
                className={explicitKind === 'todo' ? 'active' : ''}
                onClick={() => {
                  set({ kind: explicitKind === 'todo' ? null : 'todo' });
                  setPickerOpen(false);
                }}
              >
                {tr('To-do')}
              </button>
              <button
                type="button"
                className={explicitKind === 'task' ? 'active' : ''}
                onClick={() => {
                  set({ kind: explicitKind === 'task' ? null : 'task' });
                  setPickerOpen(false);
                }}
              >
                {tr('Project Task')}
              </button>
            </div>
            <div className="tp-section">{tr('Status')}</div>
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
                  {tr(s.label)}
                </button>
              ))}
            </div>
            <div className="tp-section">{tr('Due date')}</div>
            <div className="tp-quick">
              <button
                type="button"
                className={due === today ? 'active' : ''}
                onClick={() => {
                  set({ due: today });
                  setPickerOpen(false);
                }}
              >
                {tr('Today')}
              </button>
              <button
                type="button"
                className={due === tomorrow ? 'active' : ''}
                onClick={() => {
                  set({ due: tomorrow });
                  setPickerOpen(false);
                }}
              >
                {tr('Tomorrow')}
              </button>
              <button
                type="button"
                className={due === nextWeek ? 'active' : ''}
                onClick={() => {
                  set({ due: nextWeek });
                  setPickerOpen(false);
                }}
              >
                {tr('Next week')}
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
                {tr('Clear date')}
              </button>
            )}
            <div className="tp-section">{tr('Priority')}</div>
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
                  {p.bang} {tr(p.label)}
                </button>
              ))}
            </div>
            <div className="tp-section">{tr('Context')}</div>
            <MenuSelect
              look="field"
              className="tp-select"
              label={tr('Context')}
              value={contextId ?? ''}
              onChange={(v) => {
                set({ contextId: v || null });
                setPickerOpen(false);
              }}
              options={[
                { value: '', label: tr('This note (default)') },
                ...activeObjects
                  .filter((o) => o.typeId !== 'daily')
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .slice(0, 40)
                  .map((o) => ({ value: o.id, label: `${o.icon || types.find((t) => t.id === o.typeId)?.icon || '📄'} ${displayTitle(o, tr)}` })),
              ]}
            />
          </Popover>
        )}
      </span>
      {supertags.length > 0 && <SupertagFields node={node} types={supertags} updateAttributes={updateAttributes} editable={editor.isEditable} />}
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
      kind: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('data-kind');
          return v === 'todo' || v === 'task' ? v : null;
        },
        renderHTML: (a: Record<string, any>) => (a.kind === 'todo' || a.kind === 'task' ? { 'data-kind': a.kind } : {}),
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
      fields: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-fields') ?? 'null');
          } catch {
            return null;
          }
        },
        renderHTML: (a: Record<string, any>) => (a.fields ? { 'data-fields': JSON.stringify(a.fields) } : {}),
      },
      // The AI workspace's to-dos: { kind: 'confirm' | 'next', at, notes }.
      aiTodo: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-ai-todo') ?? 'null');
          } catch {
            return null;
          }
        },
        renderHTML: (a: Record<string, any>) => (a.aiTodo ? { 'data-ai-todo': JSON.stringify(a.aiTodo) } : {}),
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
