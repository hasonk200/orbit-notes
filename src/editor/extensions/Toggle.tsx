import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

function ToggleView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const open = node.attrs.open !== false;
  const titleAttr = (node.attrs.title as string) ?? '';
  const [title, setTitle] = useState(titleAttr);
  const focused = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused.current) setTitle(titleAttr);
  }, [titleAttr]);

  const focusBody = () => {
    if (!open) updateAttributes({ open: true });
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

  return (
    <NodeViewWrapper className={`toggle-block${open ? ' is-open' : ' is-closed'}`} data-toggle="">
      <div className="toggle-head" contentEditable={false}>
        <button
          type="button"
          className="toggle-caret"
          aria-expanded={open}
          title={open ? 'Collapse' : 'Expand'}
          onClick={() => updateAttributes({ open: !open })}
        >
          <ChevronRight size={15} />
        </button>
        <input
          ref={inputRef}
          className="toggle-title"
          value={title}
          placeholder="Toggle heading…"
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
            if (e.key === 'Enter') {
              e.preventDefault();
              focusBody();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              focusBody();
            }
          }}
        />
      </div>
      <div className="toggle-body-wrap" hidden={!open}>
        <NodeViewContent className="toggle-body" />
      </div>
    </NodeViewWrapper>
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      insertToggle: (attrs?: { title?: string; open?: boolean }) => ReturnType;
    };
  }
}

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-open') !== 'false',
        renderHTML: (a) => ({ 'data-open': a.open ? 'true' : 'false' }),
      },
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-title') || '',
        renderHTML: (a) => ({ 'data-title': a.title || '' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-toggle]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-toggle': '' }, HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },

  addCommands() {
    return {
      insertToggle:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { title: attrs?.title ?? '', open: attrs?.open ?? true },
            content: [{ type: 'paragraph' }],
          }),
    };
  },
});
