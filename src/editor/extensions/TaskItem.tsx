import { TaskItem as BaseTaskItem } from '@tiptap/extension-task-item';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { useRef } from 'react';
import { uid } from '../../db/schema';
import { shortDate, todayISO } from '../../lib/dates';
import { useOpen } from '../../store/pane';

function TaskItemView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const checked = !!node.attrs.checked;
  const due = node.attrs.due as string | null;
  const dateRef = useRef<HTMLInputElement>(null);
  const open = useOpen();
  const overdue = !!due && !checked && due < todayISO();
  const isToday = !!due && due === todayISO();
  const set = (attrs: Record<string, any>) => updateAttributes(attrs as any);

  return (
    <NodeViewWrapper as="div" className="task-item" data-checked={checked ? 'true' : 'false'}>
      <label className="task-check" contentEditable={false}>
        <input
          type="checkbox"
          checked={checked}
          disabled={!editor.isEditable}
          onChange={(e) => set({ checked: e.target.checked })}
        />
        <span className="task-box" />
      </label>
      <NodeViewContent className="task-content" />
      <span className="task-meta" contentEditable={false}>
        {due ? (
          <span className={`due-chip${overdue ? ' overdue' : ''}${isToday ? ' today' : ''}`}>
            <button
              type="button"
              className="due-chip-label"
              title="Change due date (Alt+Click opens the day)"
              onClick={(e) => {
                if (e.altKey) return open(`/calendar?mode=day&date=${due}`, e);
                dateRef.current?.showPicker?.();
              }}
            >
              ◷ {shortDate(due)}
            </button>
            <button type="button" className="due-chip-x" title="Remove date" onClick={() => set({ due: null })}>
              ×
            </button>
          </span>
        ) : (
          <button type="button" className="due-add" title="Add due date (or type @today)" onClick={() => dateRef.current?.showPicker?.()}>
            ◷
          </button>
        )}
        <input
          ref={dateRef}
          className="hidden-date"
          type="date"
          value={due ?? ''}
          tabIndex={-1}
          onChange={(e) => set({ due: e.target.value || null })}
        />
      </span>
    </NodeViewWrapper>
  );
}

/** TaskItem with a stable UUID (taskId) and a due date. */
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
