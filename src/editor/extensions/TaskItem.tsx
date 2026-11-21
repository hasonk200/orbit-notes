import { useT } from '../../store/uiStore';
import { TaskItem as BaseTaskItem } from '@tiptap/extension-task-item';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { addDays } from 'date-fns';
import { useRef, useState } from 'react';
import { uid, type TaskPriority } from '../../db/schema';
import { shortDate, todayISO, toISODate } from '../../lib/dates';
import { useOpen } from '../../store/pane';
import { Popover } from '../../components/Popover';

const PRIORITIES: { id: TaskPriority; label: string; short: string }[] = [
  { id: 'high', label: 'High', short: 'P1' },
  { id: 'medium', label: 'Medium', short: 'P2' },
  { id: 'low', label: 'Low', short: 'P3' },
];

function TaskItemView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const tr = useT();
  const checked = !!node.attrs.checked;
  const due = node.attrs.due as string | null;
  const priority = (node.attrs.priority as TaskPriority | null) ?? null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const open = useOpen();
  const overdue = !!due && !checked && due < todayISO();
  const isToday = !!due && due === todayISO();
  const set = (attrs: Record<string, any>) => updateAttributes(attrs as any);

  const today = todayISO();
  const tomorrow = toISODate(addDays(new Date(), 1));
  const nextWeek = toISODate(addDays(new Date(), 7));

  return (
    <NodeViewWrapper as="div" className="task-item" data-checked={checked ? 'true' : 'false'}>
      <label className="task-check" contentEditable={false}>
        <input
          type="checkbox"
          aria-label={tr(checked ? 'Mark task incomplete' : 'Mark task complete')}
          checked={checked}
          disabled={!editor.isEditable}
          onChange={(e) => set({ checked: e.target.checked })}
        />
        <span className="task-box" />
      </label>
      <NodeViewContent className="task-content" />
      <span className="task-meta" contentEditable={false}>
        {priority && (
          <button
            type="button"
            className={`prio-chip prio-${priority}`}
            title={tr('Change priority or due date')}
            onClick={() => editor.isEditable && setPickerOpen((v) => !v)}
          >
            {priority === 'high' ? 'P1' : priority === 'medium' ? 'P2' : 'P3'}
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
              {PRIORITIES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`prio-chip prio-${p.id}${priority === p.id ? ' active' : ''}`}
                  onClick={() => {
                    set({ priority: priority === p.id ? null : p.id });
                    setPickerOpen(false);
                  }}
                >
                  {p.short} {tr(p.label)}
                </button>
              ))}
            </div>
          </Popover>
        )}
      </span>
    </NodeViewWrapper>
  );
}

/** TaskItem with a stable UUID (taskId), due date, and priority. */
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
