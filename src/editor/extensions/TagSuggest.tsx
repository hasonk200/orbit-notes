import { getT, useT } from '../../store/uiStore';
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Check } from 'lucide-react';
import { uid } from '../../db/schema';
import { shortDate } from '../../lib/dates';
import { tagTaskKind, tagTaskName } from '../../lib/tagTasks';
import Suggestion from '@tiptap/suggestion';
import { useData } from '../../store/dataStore';
import { normalizeTagName } from '../../lib/supertags';
import { useOpen } from '../../store/pane';
import { runItem, suggestRender, type SuggestItem } from '../suggestStore';

export const normTag = normalizeTagName;

/** #待辦 / #專案任務: the tag is the task's tick box. */
function TaskTagView({ node, selected, updateAttributes, editor }: ReactNodeViewProps) {
  const tr = useT();
  const open = useOpen();
  const name = node.attrs.name as string;
  const kind = tagTaskKind(name)!;
  const status = node.attrs.status as string | null;
  const done = !!node.attrs.checked || status === 'done';
  const due = node.attrs.due as string | null;
  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!editor.isEditable) return;
    const next = !done;
    updateAttributes({ checked: next, status: next ? 'done' : status === 'done' ? 'open' : status, completedAt: next ? Date.now() : null });
  };
  return (
    <NodeViewWrapper as="span" className={`tag-chip tag-task is-${kind}${done ? ' is-done' : ''}${selected ? ' is-selected' : ''}`}>
      <button type="button" className="tag-task-box" contentEditable={false} aria-pressed={done} title={tr(done ? 'Mark as not done' : 'Mark as done')} onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
        {done && <Check size={11} strokeWidth={3} />}
      </button>
      <span className="tag-task-name" onClick={(e: React.MouseEvent) => open(`/tags/${encodeURIComponent(name)}`, e)}>
        #{name}
      </span>
      {due && <span className="tag-task-due">◷ {shortDate(due, tr)}</span>}
    </NodeViewWrapper>
  );
}

function TagView(props: ReactNodeViewProps) {
  const { node, selected } = props;
  const open = useOpen();
  const name = node.attrs.name as string;
  if (tagTaskKind(name)) return <TaskTagView {...props} />;
  return (
    <NodeViewWrapper
      as="span"
      className={`tag-chip${selected ? ' is-selected' : ''}`}
      onClick={(e: React.MouseEvent) => open(`/tags/${encodeURIComponent(name)}`, e)}
    >
      #{name}
    </NodeViewWrapper>
  );
}

const tagItems = ({ query }: { query: string }): SuggestItem[] => {
  const q = normTag(query);
  const counts = new Map<string, number>();
  for (const o of useData.getState().objects) {
    if (o.deletedAt) continue;
    for (const t of o.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const insert = (name: string) => (editor: any, range: any) =>
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        { type: 'tag', attrs: { name } },
        { type: 'text', text: ' ' },
      ])
      .run();
  // The two task tags come first: they turn the line into a to-do or a project task.
  const t = getT();
  const taskItems: SuggestItem[] = (['todo', 'task'] as const)
    .map((kind) => {
      const name = tagTaskName(kind, t.language === 'en' ? kind : undefined);
      const aliases = kind === 'todo' ? ['待辦', 'todo', t('To-do')] : ['專案任務', '任務', 'task', t('Tasks')];
      return { kind, name, match: !q || aliases.some((a) => normTag(a).includes(q)) };
    })
    .filter((x) => x.match)
    .map(({ kind, name }) => ({
      key: 'task:' + kind,
      label: '#' + name,
      icon: kind === 'todo' ? '☐' : '☑',
      hint: t(kind === 'todo' ? 'Make this line a to-do' : 'Make this line a project task'),
      section: 'To-do',
      run: insert(name),
    }));
  const items: SuggestItem[] = [...counts.entries()]
    .filter(([t]) => !tagTaskKind(t))
    .filter(([t]) => !q || t.includes(q))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t, n]) => ({ key: t, label: '#' + t, hint: `${n}`, section: 'Tags', run: insert(t) }));
  if (q && !counts.has(q) && !tagTaskKind(q)) items.unshift({ key: 'new:' + q, label: getT()('Create #{tag}', { tag: q }), icon: '＋', section: 'Tags', run: insert(q) });
  return [...taskItems, ...items];
};

export const Tag = Node.create({
  name: 'tag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    // A task tag keeps the same state a task item does. In HTML it travels as one JSON attribute.
    const taskAttr = (key: string) => ({
      default: null,
      keepOnSplit: false,
      parseHTML: (el: HTMLElement) => {
        try {
          return JSON.parse(el.getAttribute('data-task') ?? '{}')[key] ?? null;
        } catch {
          return null;
        }
      },
      renderHTML: (a: Record<string, any>) => {
        if (key !== 'taskId' || !a.taskId) return {};
        const { name: _name, ...task } = a;
        return { 'data-task': JSON.stringify(task) };
      },
    });
    return {
      name: { default: '', parseHTML: (el) => el.getAttribute('data-tag'), renderHTML: (a) => ({ 'data-tag': a.name }) },
      taskId: taskAttr('taskId'),
      checked: taskAttr('checked'),
      status: taskAttr('status'),
      due: taskAttr('due'),
      priority: taskAttr('priority'),
      contextId: taskAttr('contextId'),
      completedAt: taskAttr('completedAt'),
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-tag]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes), `#${node.attrs.name}`];
  },
  renderText({ node }) {
    return `#${node.attrs.name}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(TagView, { as: 'span' });
  },
  addProseMirrorPlugins() {
    return [
      // Every task tag gets its own stable id (pasted copies get a new one), like task items do.
      new Plugin({
        key: new PluginKey('taskTagIds'),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null;
          const seen = new Set<string>();
          let tr: Transaction | null = null;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'tag' || !tagTaskKind(node.attrs.name)) return true;
            let id = node.attrs.taskId as string | null;
            if (!id || seen.has(id)) {
              id = uid();
              tr = tr ?? state.tr;
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, taskId: id, checked: false, status: null, completedAt: null });
            }
            seen.add(id);
            return true;
          });
          return tr;
        },
      }),
      Suggestion<SuggestItem, SuggestItem>({
        editor: this.editor,
        pluginKey: new PluginKey('tagSuggest'),
        char: '#',
        items: tagItems,
        render: suggestRender('Tag'),
        command: runItem,
        // headings markdown shortcut "# " still works because a space ends the query with no match
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          return $from.parent.type.name !== 'codeBlock';
        },
      }),
    ];
  },
});
