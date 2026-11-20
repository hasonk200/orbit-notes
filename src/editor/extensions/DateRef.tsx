import { mergeAttributes, Node, type Editor, type Range } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { addDays } from 'date-fns';
import { dailyTitle, parseQuickDate, shortDate, toISODate } from '../../lib/dates';
import { useOpen } from '../../store/pane';
import { runItem, suggestRender, type SuggestItem } from '../suggestStore';

function DateRefView({ node, selected }: ReactNodeViewProps) {
  const open = useOpen();
  const date = node.attrs.date as string;
  return (
    <NodeViewWrapper
      as="span"
      className={`date-chip${selected ? ' is-selected' : ''}`}
      title={dailyTitle(date)}
      onClick={(e: React.MouseEvent) => open(`/calendar?mode=day&date=${date}`, e)}
    >
      ◷ {shortDate(date)}
    </NodeViewWrapper>
  );
}

/** Find the task item that contains the selection, if any. */
function enclosingTask(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'taskItem') return { pos: $from.before(d), node: n };
  }
  return null;
}

function applyDate(date: string) {
  return (editor: Editor, range: Range) => {
    const task = enclosingTask(editor);
    if (task) {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .command(({ tr }) => {
          const n = tr.doc.nodeAt(task.pos);
          if (n?.type.name === 'taskItem') tr.setNodeMarkup(task.pos, undefined, { ...n.attrs, due: date });
          return true;
        })
        .run();
    } else {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: 'dateRef', attrs: { date } },
          { type: 'text', text: ' ' },
        ])
        .run();
    }
  };
}

const dateItems = ({ query, editor }: { query: string; editor: Editor }): SuggestItem[] => {
  const inTask = !!enclosingTask(editor);
  const section = inTask ? 'Set due date' : 'Insert date';
  const now = new Date();
  const base: [string, string][] = [
    ['Today', toISODate(now)],
    ['Tomorrow', toISODate(addDays(now, 1))],
    ['Next week', toISODate(addDays(now, 7))],
    ['Yesterday', toISODate(addDays(now, -1))],
  ];
  const q = query.trim().toLowerCase();
  const parsed = parseQuickDate(q);
  const items: SuggestItem[] = [];
  if (parsed && !base.some(([, d]) => d === parsed)) {
    items.push({ key: 'p' + parsed, label: dailyTitle(parsed), icon: '◷', section, run: applyDate(parsed) });
  }
  for (const [label, d] of base) {
    if (!q || label.toLowerCase().startsWith(q) || d === parsed) {
      items.push({ key: label, label, hint: dailyTitle(d), icon: '◷', section, run: applyDate(d) });
    }
  }
  return items;
};

export const DateRef = Node.create({
  name: 'dateRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { date: { default: null, parseHTML: (el) => el.getAttribute('data-date'), renderHTML: (a) => ({ 'data-date': a.date }) } };
  },
  parseHTML() {
    return [{ tag: 'span[data-date]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes), node.attrs.date];
  },
  renderText({ node }) {
    return node.attrs.date;
  },
  addNodeView() {
    return ReactNodeViewRenderer(DateRefView, { as: 'span' });
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestItem, SuggestItem>({
        editor: this.editor,
        pluginKey: new PluginKey('dateSuggest'),
        char: '@',
        allowSpaces: false,
        items: dateItems,
        render: suggestRender('Date'),
        command: runItem,
      }),
    ];
  },
});
