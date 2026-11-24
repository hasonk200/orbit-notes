import { getT } from '../../store/uiStore';
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { useData } from '../../store/dataStore';
import { normalizeTagName } from '../../lib/supertags';
import { useOpen } from '../../store/pane';
import { runItem, suggestRender, type SuggestItem } from '../suggestStore';

export const normTag = normalizeTagName;

function TagView({ node, selected }: ReactNodeViewProps) {
  const open = useOpen();
  const name = node.attrs.name as string;
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
  const items: SuggestItem[] = [...counts.entries()]
    .filter(([t]) => !q || t.includes(q))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t, n]) => ({ key: t, label: '#' + t, hint: `${n}`, section: 'Tags', run: insert(t) }));
  if (q && !counts.has(q)) items.unshift({ key: 'new:' + q, label: getT()('Create #{tag}', { tag: q }), icon: '＋', section: 'Tags', run: insert(q) });
  return items;
};

export const Tag = Node.create({
  name: 'tag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { name: { default: '', parseHTML: (el) => el.getAttribute('data-tag'), renderHTML: (a) => ({ 'data-tag': a.name }) } };
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
