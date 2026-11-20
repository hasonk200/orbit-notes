import type { Editor } from '@tiptap/react';
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Popover } from '../components/Popover';

interface HoveredBlock {
  index: number;
  top: number;
}

interface DropIndicator {
  index: number; // target insertion index (0..childCount)
  top: number;
}

function topLevelBlocks(editor: Editor) {
  const blocks: { pos: number; size: number; index: number }[] = [];
  let pos = 0;
  for (let i = 0; i < editor.state.doc.childCount; i++) {
    const child = editor.state.doc.child(i);
    blocks.push({ pos, size: child.nodeSize, index: i });
    pos += child.nodeSize;
  }
  return blocks;
}

function moveTopLevelBlock(editor: Editor, fromIdx: number, toInsertIdx: number) {
  const blocks = topLevelBlocks(editor);
  if (fromIdx < 0 || fromIdx >= blocks.length) return;
  if (toInsertIdx === fromIdx || toInsertIdx === fromIdx + 1) return;

  const src = blocks[fromIdx];
  const node = editor.state.doc.child(fromIdx);
  const tr = editor.state.tr;

  if (toInsertIdx > fromIdx) {
    const targetPos = toInsertIdx >= blocks.length ? editor.state.doc.content.size : blocks[toInsertIdx].pos;
    tr.insert(targetPos, node);
    tr.delete(src.pos, src.pos + src.size);
  } else {
    const targetPos = blocks[toInsertIdx].pos;
    tr.delete(src.pos, src.pos + src.size);
    tr.insert(targetPos, node);
  }
  editor.view.dispatch(tr.scrollIntoView());
}

export function BlockDragHandle({
  editor,
  containerRef,
}: {
  editor: Editor | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [hovered, setHovered] = useState<HoveredBlock | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dropInd, setDropInd] = useState<DropIndicator | null>(null);
  const gripRef = useRef<HTMLButtonElement>(null);
  const draggingRef = useRef<number | null>(null);
  const hideTimer = useRef<number>(0);

  const getPmChildren = useCallback((): HTMLElement[] => {
    const pm = containerRef.current?.querySelector('.ProseMirror') as HTMLElement | null;
    if (!pm) return [];
    return Array.from(pm.children) as HTMLElement[];
  }, [containerRef]);

  useEffect(() => {
    const wrap = containerRef.current;
    if (!wrap || !editor || !editor.isEditable) return;

    const onMouseMove = (e: MouseEvent) => {
      if (draggingRef.current !== null || menuOpen) return;
      const kids = getPmChildren();
      if (!kids.length) return;
      const wrapRect = wrap.getBoundingClientRect();
      const y = e.clientY;
      let matchIdx = -1;
      for (let i = 0; i < kids.length; i++) {
        const r = kids[i].getBoundingClientRect();
        if (y >= r.top - 4 && y <= r.bottom + 4) {
          matchIdx = i;
          break;
        }
      }
      if (matchIdx >= 0) {
        window.clearTimeout(hideTimer.current);
        const r = kids[matchIdx].getBoundingClientRect();
        setHovered({ index: matchIdx, top: r.top - wrapRect.top + 3 });
      }
    };

    const onMouseLeave = () => {
      if (draggingRef.current !== null || menuOpen) return;
      hideTimer.current = window.setTimeout(() => setHovered(null), 180);
    };

    const onDragOver = (e: DragEvent) => {
      if (draggingRef.current === null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const kids = getPmChildren();
      if (!kids.length) return;
      const wrapRect = wrap.getBoundingClientRect();
      const y = e.clientY;

      let insertIdx = kids.length;
      let lineTop = kids[kids.length - 1].getBoundingClientRect().bottom - wrapRect.top + 2;
      for (let i = 0; i < kids.length; i++) {
        const r = kids[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          insertIdx = i;
          lineTop = r.top - wrapRect.top - 2;
          break;
        }
      }
      setDropInd({ index: insertIdx, top: lineTop });
    };

    const onDrop = (e: DragEvent) => {
      if (draggingRef.current === null) return;
      e.preventDefault();
      e.stopPropagation();
      const from = draggingRef.current;
      const kids = getPmChildren();
      const y = e.clientY;
      let insertIdx = kids.length;
      for (let i = 0; i < kids.length; i++) {
        const r = kids[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          insertIdx = i;
          break;
        }
      }
      draggingRef.current = null;
      setDraggingIdx(null);
      setDropInd(null);
      moveTopLevelBlock(editor, from, insertIdx);
    };

    wrap.addEventListener('mousemove', onMouseMove);
    wrap.addEventListener('mouseleave', onMouseLeave);
    wrap.addEventListener('dragover', onDragOver);
    wrap.addEventListener('drop', onDrop, true);
    return () => {
      window.clearTimeout(hideTimer.current);
      wrap.removeEventListener('mousemove', onMouseMove);
      wrap.removeEventListener('mouseleave', onMouseLeave);
      wrap.removeEventListener('dragover', onDragOver);
      wrap.removeEventListener('drop', onDrop, true);
    };
  }, [containerRef, editor, getPmChildren, menuOpen]);

  if (!editor || !editor.isEditable) return null;

  const insertBelow = () => {
    if (!hovered) return;
    const blocks = topLevelBlocks(editor);
    const blk = blocks[hovered.index];
    if (!blk) return;
    const insertPos = blk.pos + blk.size;
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, { type: 'paragraph' })
      .setTextSelection(insertPos + 1)
      .insertContent('/')
      .run();
  };

  const duplicateBlock = () => {
    if (!hovered) return;
    const blocks = topLevelBlocks(editor);
    const blk = blocks[hovered.index];
    if (!blk) return;
    const node = editor.state.doc.child(hovered.index);
    const tr = editor.state.tr.insert(blk.pos + blk.size, node.copy(node.content));
    editor.view.dispatch(tr);
    setMenuOpen(false);
  };

  const deleteBlock = () => {
    if (!hovered) return;
    const blocks = topLevelBlocks(editor);
    const blk = blocks[hovered.index];
    if (!blk) return;
    if (blocks.length === 1) {
      editor.chain().focus().clearContent().run();
    } else {
      editor.view.dispatch(editor.state.tr.delete(blk.pos, blk.pos + blk.size));
    }
    setMenuOpen(false);
    setHovered(null);
  };

  const total = editor.state.doc.childCount;

  return (
    <>
      {hovered && (
        <div
          className={`block-gutter${draggingIdx !== null ? ' is-dragging' : ''}`}
          style={{ top: hovered.top }}
          onMouseEnter={() => window.clearTimeout(hideTimer.current)}
        >
          <button type="button" className="gutter-btn" title="Insert block below (/)" onClick={insertBelow}>
            <Plus size={14} />
          </button>
          <button
            ref={gripRef}
            type="button"
            className="gutter-btn gutter-grip"
            draggable
            title="Drag to reorder · Click for block actions"
            onDragStart={(e) => {
              draggingRef.current = hovered.index;
              setDraggingIdx(hovered.index);
              setMenuOpen(false);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/orbit-block', String(hovered.index));
            }}
            onDragEnd={() => {
              draggingRef.current = null;
              setDraggingIdx(null);
              setDropInd(null);
            }}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <GripVertical size={14} />
          </button>
        </div>
      )}
      {dropInd && <div className="block-drop-line" style={{ top: dropInd.top }} />}
      {menuOpen && hovered && (
        <Popover anchor={gripRef.current} onClose={() => setMenuOpen(false)} className="block-menu">
          <button
            type="button"
            disabled={hovered.index <= 0}
            onClick={() => {
              moveTopLevelBlock(editor, hovered.index, hovered.index - 1);
              setMenuOpen(false);
            }}
          >
            <ArrowUp size={14} /> Move up
          </button>
          <button
            type="button"
            disabled={hovered.index >= total - 1}
            onClick={() => {
              moveTopLevelBlock(editor, hovered.index, hovered.index + 2);
              setMenuOpen(false);
            }}
          >
            <ArrowDown size={14} /> Move down
          </button>
          <button type="button" onClick={duplicateBlock}>
            <Copy size={14} /> Duplicate
          </button>
          <button type="button" className="danger" onClick={deleteBlock}>
            <Trash size={14} /> Delete
          </button>
        </Popover>
      )}
    </>
  );
}
