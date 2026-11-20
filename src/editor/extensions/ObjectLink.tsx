import { typeLabel } from '../../lib/typeLabels';
import { includesText, normalizeText } from '../../lib/search';
import { getT, useT } from '../../store/uiStore';
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { useRef, useState } from 'react';
import { displayTitle, useData, useObject } from '../../store/dataStore';
import { objPath, useOpen } from '../../store/pane';
import { createObject } from '../../db/indexers';
import { firstText } from '../../lib/content';
import { runItem, suggestRender, type SuggestItem } from '../suggestStore';
import { LinkPreview } from '../../components/LinkPreview';

function ObjectLinkView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const tr = useT();
  const id = node.attrs.id as string;
  const display = (node.attrs.display as string) === 'card' ? 'card' : 'inline';
  const obj = useObject(id);
  const objects = useData((s) => s.objects);
  const type = useData((s) => s.types.find((t) => t.id === obj?.typeId));
  const open = useOpen();
  const ref = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const timer = useRef<number>(0);
  const gone = !obj || !!obj.deletedAt;
  const titleOf = (oid: string) => displayTitle(objects.find((x) => x.id === oid));

  const enter = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHover(true), 350);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHover(false), 200);
  };
  const click = (e: React.MouseEvent) => {
    e.preventDefault();
    if (gone) return;
    open(objPath(id), e);
  };

  const icon = obj?.icon || type?.icon || '📄';
  return (
    <NodeViewWrapper
      as="span"
      ref={ref}
      className={`olink olink-mode-${display}${gone ? ' olink-gone' : ''}${selected ? ' is-selected' : ''}`}
      style={{ ['--type-color' as any]: type?.color ?? '#8b8a86' }}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onClick={click}
      data-drag-handle
    >
      {display === 'card' && !gone ? (
        <span className="olink-card" contentEditable={false}>
          <span className="olink-card-icon">{icon}</span>
          <span className="olink-card-body">
            <span className="olink-card-title">{displayTitle(obj, tr)}</span>
            <span className="olink-card-meta">{type && typeLabel(type, tr)}</span>
            <span className="olink-card-snippet">{firstText(obj!.content, 120, titleOf)}</span>
          </span>
        </span>
      ) : (
        <span className="olink-pill" contentEditable={false}>
          <span className="olink-icon">{gone ? '⊘' : icon}</span>
          <span className="olink-title">{gone ? tr('Deleted object') : displayTitle(obj, tr)}</span>
        </span>
      )}
      {hover && !gone && (
        <LinkPreview
          anchor={ref.current}
          objectId={id}
          display={display}
          onToggleDisplay={() => updateAttributes({ display: display === 'card' ? 'inline' : 'card' } as any)}
          onEnter={() => window.clearTimeout(timer.current)}
          onLeave={leave}
        />
      )}
    </NodeViewWrapper>
  );
}

const linkItems = async ({ query }: { query: string }): Promise<SuggestItem[]> => {
  const tr = getT();
  const q = normalizeText(query.trim());
  const { objects, types } = useData.getState();
  const typeOf = new Map(types.map((t) => [t.id, t]));
  const matches = objects
    .filter((o) => !o.deletedAt && includesText(displayTitle(o, tr), q))
    .sort((a, b) => {
      const at = normalizeText(displayTitle(a, tr)).startsWith(q) ? 0 : 1;
      const bt = normalizeText(displayTitle(b, tr)).startsWith(q) ? 0 : 1;
      return at - bt || b.updatedAt - a.updatedAt;
    })
    .slice(0, 8);
  const insert = (id: string) => (editor: any, range: any) =>
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        { type: 'objectLink', attrs: { id, display: 'inline' } },
        { type: 'text', text: ' ' },
      ])
      .run();
  const items: SuggestItem[] = matches.map((o) => ({
    key: o.id,
    label: displayTitle(o, tr),
    icon: o.icon || typeOf.get(o.typeId)?.icon,
    hint: typeLabel(typeOf.get(o.typeId), tr),
    section: 'Link to',
    run: insert(o.id),
  }));
  if (q) {
    const exact = objects.some((o) => !o.deletedAt && normalizeText(displayTitle(o, tr)) === q);
    if (!exact) {
      for (const t of types.filter((t) => t.id !== 'daily').slice(0, 6)) {
        items.push({
          key: 'new-' + t.id,
          label: tr('New {type}: “{title}”', { type: typeLabel(t, tr), title: query.trim() }),
          icon: t.icon,
          section: 'Create',
          run: (editor, range) => {
            void createObject(t.id, { title: query.trim() }).then((o) => insert(o.id)(editor, range));
          },
        });
      }
    }
  }
  return items;
};

export const ObjectLink = Node.create({
  name: 'objectLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-id'), renderHTML: (a) => ({ 'data-id': a.id }) },
      display: {
        default: 'inline',
        parseHTML: (el) => el.getAttribute('data-display') || 'inline',
        renderHTML: (a) => ({ 'data-display': a.display }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-object-link]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const o = useData.getState().objects.find((x) => x.id === node.attrs.id);
    return ['span', mergeAttributes({ 'data-object-link': '' }, HTMLAttributes), `[[${displayTitle(o, getT())}]]`];
  },
  renderText({ node }) {
    const o = useData.getState().objects.find((x) => x.id === node.attrs.id);
    return `[[${displayTitle(o, getT())}]]`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(ObjectLinkView, { as: 'span' });
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestItem, SuggestItem>({
        editor: this.editor,
        pluginKey: new PluginKey('objectLinkSuggest'),
        char: '[[',
        allowSpaces: true,
        allowedPrefixes: null,
        items: linkItems,
        render: suggestRender('Link an object'),
        command: runItem,
      }),
    ];
  },
});
