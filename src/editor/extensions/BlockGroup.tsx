import { isComposing } from '../../lib/keyboard';
import { uid } from '../../lib/uid';
import { useT } from '../../store/uiStore';
import { mergeAttributes, Node, type Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { canJoin } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { ChevronRight, Layers, ListChecks, Ungroup } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const CONTAINER_TYPES = new Set(['doc', 'toggle', 'callout', 'blockquote', 'blockGroup']);
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

export interface BlockGroupAttrs {
  groupId?: string;
  title?: string;
  collapsed?: boolean;
  groupTasks?: boolean;
}

export interface SelectableTarget {
  from: number;
  to: number;
  isListItem: boolean;
  listPos?: number;
  itemIndex?: number;
}

export interface MarqueeState {
  targets: SelectableTarget[];
}

export const marqueeKey = new PluginKey<MarqueeState>('orbitMarqueeBlockSelect');

/** Collect top-level selectable blocks in document order, splitting lists into individual item targets. */
export function collectSelectableTargets(doc: PMNode): SelectableTarget[] {
  const targets: SelectableTarget[] = [];
  doc.forEach((child, offset) => {
    if (LIST_TYPES.has(child.type.name)) {
      child.forEach((item, itemOffset, itemIndex) => {
        const from = offset + 1 + itemOffset;
        targets.push({
          from,
          to: from + item.nodeSize,
          isListItem: true,
          listPos: offset,
          itemIndex,
        });
      });
    } else {
      targets.push({ from: offset, to: offset + child.nodeSize, isListItem: false });
    }
  });
  return targets;
}

export function getMarqueeTargets(state: EditorState): SelectableTarget[] {
  return marqueeKey.getState(state)?.targets ?? [];
}

export function setMarqueeTargets(editor: Editor, targets: SelectableTarget[]) {
  const tr = editor.state.tr.setMeta(marqueeKey, { targets });
  editor.view.dispatch(tr);
}

export function clearMarqueeTargets(editor: Editor) {
  if (!getMarqueeTargets(editor.state).length) return;
  const tr = editor.state.tr.setMeta(marqueeKey, { targets: [] });
  editor.view.dispatch(tr);
}

function partitionTargets(doc: PMNode, targets: SelectableTarget[]) {
  const first = targets[0];
  const last = targets[targets.length - 1];
  const topStart = first.isListItem ? first.listPos! : first.from;
  const lastList = last.isListItem ? doc.nodeAt(last.listPos!)! : null;
  const topEnd = last.isListItem ? last.listPos! + lastList!.nodeSize : last.to;

  const outerBefore: PMNode[] = [];
  const innerNodes: PMNode[] = [];
  const outerAfter: PMNode[] = [];

  if (first.isListItem && last.isListItem && first.listPos === last.listPos) {
    const listNode = doc.nodeAt(first.listPos!)!;
    const sIdx = first.itemIndex!;
    const eIdx = last.itemIndex!;
    const beforeItems: PMNode[] = [];
    const midItems: PMNode[] = [];
    const afterItems: PMNode[] = [];
    for (let i = 0; i < listNode.childCount; i++) {
      const c = listNode.child(i);
      if (i < sIdx) beforeItems.push(c);
      else if (i <= eIdx) midItems.push(c);
      else afterItems.push(c);
    }
    if (beforeItems.length) outerBefore.push(listNode.copy(Fragment.from(beforeItems)));
    if (midItems.length) innerNodes.push(listNode.copy(Fragment.from(midItems)));
    if (afterItems.length) outerAfter.push(listNode.copy(Fragment.from(afterItems)));
    return { topStart, topEnd, outerBefore, innerNodes, outerAfter };
  }

  let curPos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const childEnd = curPos + child.nodeSize;
    if (curPos >= topStart && childEnd <= topEnd) {
      if (first.isListItem && curPos === first.listPos) {
        const beforeItems: PMNode[] = [];
        const midItems: PMNode[] = [];
        for (let k = 0; k < child.childCount; k++) {
          if (k < first.itemIndex!) beforeItems.push(child.child(k));
          else midItems.push(child.child(k));
        }
        if (beforeItems.length) outerBefore.push(child.copy(Fragment.from(beforeItems)));
        if (midItems.length) innerNodes.push(child.copy(Fragment.from(midItems)));
      } else if (last.isListItem && curPos === last.listPos) {
        const midItems: PMNode[] = [];
        const afterItems: PMNode[] = [];
        for (let k = 0; k < child.childCount; k++) {
          if (k <= last.itemIndex!) midItems.push(child.child(k));
          else afterItems.push(child.child(k));
        }
        if (midItems.length) innerNodes.push(child.copy(Fragment.from(midItems)));
        if (afterItems.length) outerAfter.push(child.copy(Fragment.from(afterItems)));
      } else {
        innerNodes.push(child);
      }
    }
    curPos = childEnd;
  }

  return { topStart, topEnd, outerBefore, innerNodes, outerAfter };
}

/** Wrap marquee-selected targets into a single `blockGroup`, cleanly splitting partial lists. */
export function wrapMarqueeTargets(editor: Editor, targets: SelectableTarget[], attrs?: BlockGroupAttrs): boolean {
  if (!targets.length) return false;
  return editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      const blockGroupType = tr.doc.type.schema.nodes.blockGroup;
      if (!blockGroupType) return false;
      const { topStart, topEnd, outerBefore, innerNodes, outerAfter } = partitionTargets(tr.doc, targets);
      if (!innerNodes.length) return false;
      if (innerNodes.length === 1 && innerNodes[0].type.name === 'blockGroup') return false;
      const groupNode = blockGroupType.create(
        {
          groupId: attrs?.groupId || uid(),
          title: attrs?.title ?? '',
          collapsed: !!attrs?.collapsed,
          groupTasks: attrs?.groupTasks !== false,
        },
        Fragment.from(innerNodes),
      );
      const parts = [...outerBefore, groupNode, ...outerAfter];
      const beforeSize = outerBefore.reduce((n, p) => n + p.nodeSize, 0);
      tr.replaceWith(topStart, topEnd, Fragment.from(parts));
      tr.setMeta(marqueeKey, { targets: [] });
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(topStart + beforeSize + 1, tr.doc.content.size))));
      tr.scrollIntoView();
      if (dispatch) dispatch(tr);
      return true;
    })
    .run();
}

/** Duplicate marquee-selected targets right after the selection. */
export function duplicateMarqueeTargets(editor: Editor, targets: SelectableTarget[]): boolean {
  if (!targets.length) return false;
  return editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      const { topStart, topEnd, outerBefore, innerNodes, outerAfter } = partitionTargets(tr.doc, targets);
      if (!innerNodes.length) return false;
      const cloned = innerNodes.map((n) => n.copy(n.content));
      const parts = [...outerBefore, ...innerNodes, ...cloned, ...outerAfter];
      const beforeSize = outerBefore.reduce((n, p) => n + p.nodeSize, 0);
      const innerSize = innerNodes.reduce((n, p) => n + p.nodeSize, 0);
      tr.replaceWith(topStart, topEnd, Fragment.from(parts));
      const joinMid = topStart + beforeSize + innerSize;
      if (joinMid > 0 && joinMid < tr.doc.content.size && canJoin(tr.doc, joinMid)) tr.join(joinMid);
      tr.setMeta(marqueeKey, { targets: [] });
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(joinMid + 1, tr.doc.content.size))));
      tr.scrollIntoView();
      if (dispatch) dispatch(tr);
      return true;
    })
    .run();
}

/** Delete marquee-selected targets cleanly, keeping document non-empty. */
export function deleteMarqueeTargets(editor: Editor, targets: SelectableTarget[]): boolean {
  if (!targets.length) return false;
  return editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      const { topStart, topEnd, outerBefore, outerAfter } = partitionTargets(tr.doc, targets);
      const parts = [...outerBefore, ...outerAfter];
      if (!parts.length && topStart === 0 && topEnd === tr.doc.content.size) {
        const para = tr.doc.type.schema.nodes.paragraph?.create();
        if (para) parts.push(para);
      }
      tr.replaceWith(topStart, topEnd, Fragment.from(parts));
      if (outerBefore.length && outerAfter.length) {
        const joinAt = topStart + outerBefore.reduce((n, p) => n + p.nodeSize, 0);
        if (joinAt > 0 && joinAt < tr.doc.content.size && canJoin(tr.doc, joinAt)) tr.join(joinAt);
      }
      tr.setMeta(marqueeKey, { targets: [] });
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(topStart, tr.doc.content.size))));
      tr.scrollIntoView();
      if (dispatch) dispatch(tr);
      return true;
    })
    .run();
}

/** Find the innermost `blockGroup` enclosing a selection's head, if any. */
export function findEnclosingBlockGroupInSelection(selection: Selection): { pos: number; node: PMNode } | null {
  const { $from } = selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'blockGroup') return { pos: $from.before(d), node: n };
  }
  return null;
}

/** Find the innermost `blockGroup` enclosing the selection head, if any. */
export function findEnclosingBlockGroup(state: EditorState): { pos: number; node: PMNode } | null {
  return findEnclosingBlockGroupInSelection(state.selection);
}

/** True when a non-empty selection crosses more than one textblock (e.g. multiple items or blocks). */
export function spansMultipleBlocks(state: EditorState): boolean {
  const { selection } = state;
  if (selection.empty) return false;
  return !selection.$from.sameParent(selection.$to);
}

/**
 * Mutate `tr` to wrap the current selection (or current block, or a subset of list/task items)
 * into a single collapsible `blockGroup` superblock. Safe to compose in TipTap chains.
 */
function applyWrapInBlockGroup(tr: Transaction, attrs?: BlockGroupAttrs): boolean {
  const blockGroupType = tr.doc.type.schema.nodes.blockGroup;
  if (!blockGroupType) return false;
  const { selection } = tr;
  const { $from, $to } = selection;
  const groupAttrs = {
    groupId: attrs?.groupId || uid(),
    title: attrs?.title ?? '',
    collapsed: !!attrs?.collapsed,
    groupTasks: attrs?.groupTasks !== false,
  };

  // Subcase A: non-empty selection covering a proper subset of a single list -> split list cleanly
  if (!selection.empty) {
    const maxDepth = Math.min($from.depth, $to.depth);
    for (let d = maxDepth; d >= 1; d--) {
      const listNode = $from.node(d);
      if (listNode === $to.node(d) && LIST_TYPES.has(listNode.type.name) && CONTAINER_TYPES.has($from.node(d - 1).type.name)) {
        const listPos = $from.before(d);
        let firstIdx = -1;
        let lastIdx = -1;
        listNode.forEach((child, offset, idx) => {
          const cs = listPos + 1 + offset;
          const ce = cs + child.nodeSize;
          if (ce > selection.from && cs < selection.to) {
            if (firstIdx < 0) firstIdx = idx;
            lastIdx = idx;
          }
        });
        if (firstIdx >= 0 && lastIdx >= firstIdx && (firstIdx > 0 || lastIdx < listNode.childCount - 1)) {
          const beforeItems: PMNode[] = [];
          const midItems: PMNode[] = [];
          const afterItems: PMNode[] = [];
          for (let i = 0; i < listNode.childCount; i++) {
            const c = listNode.child(i);
            if (i < firstIdx) beforeItems.push(c);
            else if (i <= lastIdx) midItems.push(c);
            else afterItems.push(c);
          }
          const parts: PMNode[] = [];
          let groupOffset = 0;
          if (beforeItems.length) {
            const beforeList = listNode.copy(Fragment.from(beforeItems));
            groupOffset = beforeList.nodeSize;
            parts.push(beforeList);
          }
          const wrappedList = listNode.copy(Fragment.from(midItems));
          parts.push(blockGroupType.create(groupAttrs, wrappedList));
          if (afterItems.length) parts.push(listNode.copy(Fragment.from(afterItems)));

          tr.replaceWith(listPos, listPos + listNode.nodeSize, Fragment.from(parts));
          const targetPos = Math.min(listPos + groupOffset + 2, tr.doc.content.size);
          tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos)));
          tr.scrollIntoView();
          return true;
        }
        break;
      }
    }
  }

  // Subcase B: wrap one or more sibling blocks inside the deepest common block container
  let containerDepth = -1;
  for (let d = Math.min($from.depth, $to.depth); d >= 0; d--) {
    if ($from.node(d) === $to.node(d) && CONTAINER_TYPES.has($from.node(d).type.name)) {
      containerDepth = d;
      break;
    }
  }
  if (containerDepth < 0) return false;

  const container = $from.node(containerDepth);
  const containerStart = containerDepth === 0 ? 0 : $from.start(containerDepth);
  let firstIdx = -1;
  let lastIdx = -1;
  let fromPos = 0;
  let toPos = 0;
  const children: PMNode[] = [];

  if (selection.empty) {
    const idx = $from.index(containerDepth);
    if (idx < 0 || idx >= container.childCount) return false;
    let off = 0;
    for (let i = 0; i < idx; i++) off += container.child(i).nodeSize;
    const child = container.child(idx);
    firstIdx = lastIdx = idx;
    fromPos = containerStart + off;
    toPos = fromPos + child.nodeSize;
    children.push(child);
  } else {
    container.forEach((child, offset, idx) => {
      const cs = containerStart + offset;
      const ce = cs + child.nodeSize;
      if (ce > selection.from && cs < selection.to) {
        if (firstIdx < 0) {
          firstIdx = idx;
          fromPos = cs;
        }
        lastIdx = idx;
        toPos = ce;
        children.push(child);
      }
    });
  }

  if (!children.length) return false;
  if (children.length === 1 && children[0].type.name === 'blockGroup') return false;

  const groupNode = blockGroupType.create(groupAttrs, Fragment.from(children));
  tr.replaceWith(fromPos, toPos, groupNode);
  const selPos = Math.min(fromPos + 1, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(selPos)));
  tr.scrollIntoView();
  return true;
}

/** Mutate `tr` to unwrap the `blockGroup` at `pos` back into separate blocks, rejoining split adjacent lists. */
function applyUnwrapBlockGroup(tr: Transaction, pos: number): boolean {
  const node = tr.doc.nodeAt(pos);
  if (!node || node.type.name !== 'blockGroup') return false;
  const innerSize = node.content.size;
  tr.replaceWith(pos, pos + node.nodeSize, node.content);
  const afterPos = pos + innerSize;
  if (afterPos > 0 && afterPos < tr.doc.content.size && canJoin(tr.doc, afterPos)) {
    tr.join(afterPos);
  }
  if (pos > 0 && pos < tr.doc.content.size && canJoin(tr.doc, pos)) {
    tr.join(pos);
  }
  const selPos = Math.min(pos + 1, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(selPos)));
  tr.scrollIntoView();
  return true;
}

export function wrapSelectionInBlockGroup(editor: Editor, attrs?: BlockGroupAttrs): boolean {
  return editor.commands.wrapInBlockGroup(attrs);
}

/** Unwrap the `blockGroup` at `pos` back into separate blocks, rejoining split adjacent lists. */
export function unwrapBlockGroupAt(editor: Editor, pos: number): boolean {
  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      const ok = applyUnwrapBlockGroup(tr, pos);
      if (ok && dispatch) dispatch(tr);
      return ok;
    })
    .run();
}

function summarizeBlockGroup(node: PMNode): { done: number; total: number; preview: string } {
  let done = 0;
  let total = 0;
  let heading = '';
  let fallback = '';
  node.descendants((n) => {
    if (n.type.name === 'taskItem') {
      total++;
      if (n.attrs.checked || n.attrs.status === 'done') done++;
    } else if (!heading && n.type.name === 'heading') {
      const t = n.textContent.trim();
      if (t) heading = t;
    } else if (!fallback && n.type.name === 'paragraph') {
      const t = n.textContent.trim();
      if (t) fallback = t;
    }
    return true;
  });
  const raw = heading || fallback;
  const preview = raw.length > 48 ? raw.slice(0, 47) + '…' : raw;
  return { done, total, preview };
}

function BlockGroupView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const tr = useT();
  const collapsed = !!node.attrs.collapsed;
  const groupTasks = node.attrs.groupTasks !== false;
  const titleAttr = (node.attrs.title as string) ?? '';
  const [title, setTitle] = useState(titleAttr);
  const focused = useRef(false);
  const { done, total, preview } = summarizeBlockGroup(node);

  useEffect(() => {
    if (!focused.current) setTitle(titleAttr);
  }, [titleAttr]);

  const focusBody = () => {
    if (collapsed) updateAttributes({ collapsed: false });
    requestAnimationFrame(() => {
      try {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (typeof pos === 'number') {
          editor.chain().focus().setTextSelection(pos + 2).run();
        }
      } catch {
        editor.commands.focus();
      }
    });
  };

  const handleUngroup = () => {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (typeof pos === 'number') {
      editor
        .chain()
        .focus()
        .command(({ tr, dispatch }) => {
          const ok = applyUnwrapBlockGroup(tr, pos);
          if (ok && dispatch) dispatch(tr);
          return ok;
        })
        .run();
    }
  };

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <NodeViewWrapper
      className={`block-group-node${collapsed ? ' is-collapsed' : ' is-open'}`}
      data-block-group=""
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className="bg-head" contentEditable={false}>
        <button
          type="button"
          className="toggle-caret bg-caret"
          aria-expanded={!collapsed}
          title={collapsed ? tr('Expand') : tr('Collapse')}
          onClick={() => updateAttributes({ collapsed: !collapsed })}
        >
          <ChevronRight size={15} />
        </button>
        <Layers size={14} className="bg-icon" />
        <input
          className="bg-title"
          value={title}
          placeholder={collapsed && preview ? preview : tr('Block title (optional)…')}
          disabled={!editor.isEditable}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            if (title !== titleAttr) updateAttributes({ title });
          }}
          onChange={(e) => {
            setTitle(e.target.value);
            updateAttributes({ title: e.target.value });
          }}
          onKeyDown={(e) => {
            if (isComposing(e.nativeEvent)) return;
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
              e.preventDefault();
              focusBody();
            }
          }}
        />
        {total > 0 ? (
          <div className={`bg-progress${done === total ? ' is-done' : ''}`} title={`${done}/${total} (${pct}%)`}>
            <div className="bg-progress-bar">
              <div className="bg-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="bg-progress-label">
              {done}/{total}
            </span>
          </div>
        ) : (
          collapsed && <span className="bg-count-pill">{tr('{count} blocks', { count: node.childCount })}</span>
        )}
        {editor.isEditable && (
          <div className="bg-actions">
            {total > 0 && (
              <button
                type="button"
                className={`bg-act-btn${groupTasks ? ' is-grouped' : ''}`}
                title={
                  groupTasks
                    ? tr('Grouped as 1 card in To-do & Tasks (click to split)')
                    : tr('Shown individually in To-do & Tasks (click to group)')
                }
                onClick={() => updateAttributes({ groupTasks: !groupTasks })}
              >
                <ListChecks size={13} />
              </button>
            )}
            <button
              type="button"
              className="bg-act-btn"
              title={tr('Ungroup into separate blocks')}
              onClick={handleUngroup}
            >
              <Ungroup size={13} />
              <span>{tr('Ungroup')}</span>
            </button>
          </div>
        )}
      </div>
      <div className="bg-body-wrap" hidden={collapsed}>
        <NodeViewContent className="bg-body" />
      </div>
    </NodeViewWrapper>
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockGroup: {
      insertBlockGroup: (attrs?: BlockGroupAttrs) => ReturnType;
      wrapInBlockGroup: (attrs?: BlockGroupAttrs) => ReturnType;
      unwrapBlockGroup: () => ReturnType;
    };
  }
}

export const BlockGroup = Node.create({
  name: 'blockGroup',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      groupId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-group-id') || '',
        renderHTML: (a) => (a.groupId ? { 'data-group-id': a.groupId } : {}),
      },
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-title') || '',
        renderHTML: (a) => (a.title ? { 'data-title': a.title } : {}),
      },
      collapsed: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-collapsed') === 'true',
        renderHTML: (a) => ({ 'data-collapsed': a.collapsed ? 'true' : 'false' }),
      },
      groupTasks: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-group-tasks') !== 'false',
        renderHTML: (a) => ({ 'data-group-tasks': a.groupTasks === false ? 'false' : 'true' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-block-group]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-block-group': '' }, HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockGroupView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockGroupIdEnsure'),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const seen = new Set<string>();
          const tr = newState.tr;
          let changed = false;
          newState.doc.descendants((node, pos) => {
            if (node.type.name === 'blockGroup') {
              const id = String(node.attrs.groupId || '');
              if (!id || seen.has(id)) {
                const nextId = uid();
                seen.add(nextId);
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, groupId: nextId });
                changed = true;
              } else {
                seen.add(id);
              }
            }
            return true;
          });
          return changed ? tr : null;
        },
      }),
      new Plugin<MarqueeState>({
        key: marqueeKey,
        state: {
          init: () => ({ targets: [] }),
          apply(tr, prev) {
            const meta = tr.getMeta(marqueeKey) as MarqueeState | undefined;
            if (meta) return { targets: meta.targets };
            if (tr.docChanged || tr.selectionSet) return prev.targets.length ? { targets: [] } : prev;
            return prev;
          },
        },
        props: {
          decorations(state) {
            const targets = marqueeKey.getState(state)?.targets;
            if (!targets?.length) return DecorationSet.empty;
            const decos: Decoration[] = [];
            for (const t of targets) {
              if (t.from >= 0 && t.to <= state.doc.content.size && t.from < t.to) {
                decos.push(Decoration.node(t.from, t.to, { class: 'pm-block-selected' }));
              }
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertBlockGroup:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              groupId: attrs?.groupId || uid(),
              title: attrs?.title ?? '',
              collapsed: !!attrs?.collapsed,
              groupTasks: attrs?.groupTasks !== false,
            },
            content: [{ type: 'paragraph' }],
          }),
      wrapInBlockGroup:
        (attrs) =>
        ({ tr, dispatch }) => {
          const ok = applyWrapInBlockGroup(tr, attrs);
          if (ok && dispatch) dispatch(tr);
          return ok;
        },
      unwrapBlockGroup:
        () =>
        ({ tr, dispatch }) => {
          const hit = findEnclosingBlockGroupInSelection(tr.selection);
          if (!hit) return false;
          const ok = applyUnwrapBlockGroup(tr, hit.pos);
          if (ok && dispatch) dispatch(tr);
          return ok;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-g': () => {
        if (!this.editor.isEditable) return false;
        const { state } = this.editor;
        if (state.selection.empty && findEnclosingBlockGroup(state)) {
          return this.editor.commands.unwrapBlockGroup();
        }
        return this.editor.commands.wrapInBlockGroup();
      },
    };
  },
});
