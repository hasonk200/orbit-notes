import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { LiveSearchTable } from '../../components/LiveSearchTable';
import type { LiveQuery } from '../../lib/supertags';

function LiveSearchView({ node, updateAttributes, editor, selected }: ReactNodeViewProps) {
  const query = (node.attrs.query as LiveQuery | null) ?? { tag: '' };
  return (
    <NodeViewWrapper className={`live-search-block${selected ? ' is-selected' : ''}`} contentEditable={false} data-drag-handle="">
      <LiveSearchTable query={query} onChange={(q) => updateAttributes({ query: q })} editable={editor.isEditable} startEditing={!query.tag} />
    </NodeViewWrapper>
  );
}

/** A block that lists every item with a given tag, across all notes, and stays up to date. */
export const LiveSearch = Node.create({
  name: 'liveSearch',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      query: {
        default: { tag: '' },
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-query') ?? '') as LiveQuery;
          } catch {
            return { tag: '' };
          }
        },
        renderHTML: (a: Record<string, any>) => ({ 'data-query': JSON.stringify(a.query ?? { tag: '' }) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-live-search]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-live-search': '' }, HTMLAttributes)];
  },
  renderText({ node }) {
    const tag = (node.attrs.query as LiveQuery | null)?.tag;
    return tag ? `🔍 #${tag}` : '';
  },
  addNodeView() {
    return ReactNodeViewRenderer(LiveSearchView);
  },
});
