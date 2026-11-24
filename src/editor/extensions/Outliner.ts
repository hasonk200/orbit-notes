import { Extension, type Editor } from '@tiptap/react';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Workflowy-style outliner behaviour shared by bullet and task items:
 * - Mod+Shift+↑/↓ (or Alt+Shift+↑/↓) moves the current item, children included, past its neighbour
 * - Mod+↑ / Mod+↓ collapses / expands the current item
 * - Zoom: show one item and its children only (click its bullet, or Mod+] / Mod+[)
 */

const ITEMS = new Set(['listItem', 'taskItem']);
const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

export const zoomKey = new PluginKey<{ pos: number | null }>('orbitZoom');

export const zoomedPos = (state: EditorState) => zoomKey.getState(state)?.pos ?? null;

function validZoom(state: EditorState['doc'], pos: number | null) {
  if (pos == null || pos < 0 || pos >= state.content.size) return null;
  const node = state.nodeAt(pos);
  return node && ITEMS.has(node.type.name) && node.childCount > 0 ? pos : null;
}

/** Depth of the innermost list or task item around the selection, or -1. */
function itemDepth(state: EditorState) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if (ITEMS.has($from.node(d).type.name)) return d;
  return -1;
}

/** Zoom into the item at `pos` (or out to the whole note with null). */
export function zoomTo(editor: Editor, pos: number | null) {
  const { state, view } = editor;
  const tr = state.tr;
  const target = validZoom(state.doc, pos);
  if (target != null) {
    // A zoomed item always shows its children, so open it and anything folded above it.
    const $p = state.doc.resolve(target);
    const open = (at: number) => {
      const n = tr.doc.nodeAt(at);
      if (n?.attrs.collapsed) tr.setNodeMarkup(at, undefined, { ...n.attrs, collapsed: false });
    };
    open(target);
    for (let d = $p.depth; d > 0; d--) if (ITEMS.has($p.node(d).type.name)) open($p.before(d));
    const node = tr.doc.nodeAt(target)!;
    tr.setSelection(TextSelection.near(tr.doc.resolve(target + node.child(0).nodeSize)));
  }
  tr.setMeta(zoomKey, { pos: target });
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

export interface ZoomCrumb {
  pos: number;
  text: string;
}

/** The zoomed item and the items above it, outermost first. */
export function zoomTrail(state: EditorState): ZoomCrumb[] {
  const pos = zoomedPos(state);
  if (pos == null) return [];
  const $p = state.doc.resolve(pos);
  const trail: ZoomCrumb[] = [];
  for (let d = 1; d <= $p.depth; d++) {
    const n = $p.node(d);
    if (ITEMS.has(n.type.name)) trail.push({ pos: $p.before(d), text: n.child(0).textContent.trim() });
  }
  trail.push({ pos, text: state.doc.nodeAt(pos)!.child(0).textContent.trim() });
  return trail;
}

function zoomDecorations(state: EditorState) {
  const pos = zoomedPos(state);
  if (pos == null) return DecorationSet.empty;
  const { doc } = state;
  const $p = doc.resolve(pos);
  const decos: Decoration[] = [];
  for (let d = 0; d <= $p.depth; d++) {
    const parent = $p.node(d);
    const start = d === 0 ? 0 : $p.start(d);
    const keep = $p.index(d);
    parent.forEach((child, offset, i) => {
      if (i !== keep) decos.push(Decoration.node(start + offset, start + offset + child.nodeSize, { class: 'zoom-hidden' }));
    });
    if (d > 0) decos.push(Decoration.node($p.before(d), $p.after(d), { class: 'zoom-ancestor' }));
  }
  const node = doc.nodeAt(pos)!;
  decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'zoom-root' }));
  return DecorationSet.create(doc, decos);
}

function moveItem(editor: Editor, dir: -1 | 1) {
  const { state, view } = editor;
  const { $from } = state.selection;
  if ($from.depth < 1) return false;
  let d = itemDepth(state);
  if (d < 0) d = 1;
  const from = $from.before(d);
  if (zoomedPos(state) === from) return true;
  const parent = $from.node(d - 1);
  const index = $from.index(d - 1);
  const node = $from.node(d);
  const j = index + dir;
  if (j < 0 || j >= parent.childCount) return true;
  const sibling = parent.child(j);
  const shift = dir < 0 ? -sibling.nodeSize : sibling.nodeSize;
  const tr = state.tr.delete(from, from + node.nodeSize);
  tr.insert(dir < 0 ? from - sibling.nodeSize : from + sibling.nodeSize, node);
  const { anchor, head } = state.selection;
  tr.setSelection(TextSelection.create(tr.doc, anchor + shift, head + shift));
  view.dispatch(tr.scrollIntoView());
  return true;
}

function setFolded(editor: Editor, collapsed: boolean) {
  const { state, view } = editor;
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'listItem' && n.childCount > 1) {
      if (!!n.attrs.collapsed === collapsed) return true;
      view.dispatch(state.tr.setNodeMarkup($from.before(d), undefined, { ...n.attrs, collapsed }));
      return true;
    }
  }
  return false;
}

/** True when the selection sits in the zoomed item's own first line. */
function inZoomTitle(state: EditorState) {
  const pos = zoomedPos(state);
  const { $from } = state.selection;
  return pos != null && $from.depth >= 1 && $from.before($from.depth) === pos + 1;
}

/** Enter on the zoomed item's title starts its first child, like Workflowy, instead of a hidden sibling. */
function enterInZoomTitle(editor: Editor) {
  const { state, view } = editor;
  if (!inZoomTitle(state)) return false;
  const pos = zoomedPos(state)!;
  const { schema } = state;
  const tr = state.tr;
  if (!state.selection.empty) tr.deleteSelection();
  const cut = tr.selection.from;
  const titleEnd = pos + tr.doc.nodeAt(pos)!.child(0).nodeSize;
  const rest = tr.doc.slice(cut, titleEnd).content;
  tr.delete(cut, titleEnd);
  const root = tr.doc.nodeAt(pos)!;
  const afterTitle = pos + 1 + root.child(0).nodeSize;
  const item = schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, rest));
  const firstList = root.childCount > 1 ? root.child(1) : null;
  if (firstList && (firstList.type.name === 'bulletList' || firstList.type.name === 'orderedList')) tr.insert(afterTitle + 1, item);
  else tr.insert(afterTitle, schema.nodes.bulletList.create(null, item));
  tr.setSelection(TextSelection.create(tr.doc, afterTitle + 3));
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const Outliner = Extension.create({
  name: 'orbitOutliner',
  priority: 1000,

  addKeyboardShortcuts() {
    const editor = this.editor as unknown as Editor;
    return {
      'Mod-Shift-ArrowUp': () => moveItem(editor, -1),
      'Mod-Shift-ArrowDown': () => moveItem(editor, 1),
      'Alt-Shift-ArrowUp': () => moveItem(editor, -1),
      'Alt-Shift-ArrowDown': () => moveItem(editor, 1),
      'Mod-ArrowUp': () => setFolded(editor, true),
      'Mod-ArrowDown': () => setFolded(editor, false),
      'Mod-]': () => {
        const d = itemDepth(editor.state);
        if (d < 0) return false;
        zoomTo(editor, editor.state.selection.$from.before(d));
        return true;
      },
      'Mod-[': () => {
        const trail = zoomTrail(editor.state);
        if (!trail.length) return false;
        zoomTo(editor, trail.length > 1 ? trail[trail.length - 2].pos : null);
        return true;
      },
      Enter: () => enterInZoomTitle(editor),
      Backspace: () => {
        const { state } = editor;
        return inZoomTitle(state) && state.selection.empty && state.selection.$from.parentOffset === 0;
      },
      Tab: () => inZoomTitle(editor.state),
      'Shift-Tab': () => {
        // Outdenting a direct child of the zoomed item would move it out of view.
        const { state } = editor;
        const pos = zoomedPos(state);
        if (pos == null) return false;
        if (inZoomTitle(state)) return true;
        const d = itemDepth(state);
        return d >= 3 && LISTS.has(state.selection.$from.node(d - 1).type.name) && state.selection.$from.before(d - 2) === pos;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: zoomKey,
        state: {
          init: (): { pos: number | null } => ({ pos: null }),
          apply(tr, value, _old, next) {
            const meta = tr.getMeta(zoomKey) as { pos: number | null } | undefined;
            if (meta) return { pos: validZoom(next.doc, meta.pos) };
            if (value.pos == null || !tr.docChanged) return value;
            // Edits inside the item (or to its attributes) keep the zoom; removing the item ends it.
            const mapped = tr.mapping.mapResult(value.pos, -1);
            return { pos: mapped.deletedAcross ? null : validZoom(next.doc, mapped.pos) };
          },
        },
        props: {
          decorations: zoomDecorations,
        },
      }),
    ];
  },
});
