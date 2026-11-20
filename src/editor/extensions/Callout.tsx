import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { useRef, useState } from 'react';
import { Popover } from '../../components/Popover';

export type CalloutTone = 'info' | 'tip' | 'warn' | 'danger' | 'neutral';

const TONES: { id: CalloutTone; label: string; emoji: string }[] = [
  { id: 'info', label: 'Info', emoji: '💡' },
  { id: 'tip', label: 'Tip', emoji: '✅' },
  { id: 'warn', label: 'Warning', emoji: '⚠️' },
  { id: 'danger', label: 'Alert', emoji: '🚨' },
  { id: 'neutral', label: 'Note', emoji: '📌' },
];

const QUICK_EMOJIS = ['💡', '📌', '📝', '✅', '⚠️', '🚨', '🔥', '✨', '🎯', '🧠', '💬', '📎'];

function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const tone = (node.attrs.tone as CalloutTone) || 'info';
  const emoji = (node.attrs.emoji as string) || '💡';
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <NodeViewWrapper className={`callout callout-${tone}`} data-callout="" data-tone={tone}>
      <button
        ref={btnRef}
        type="button"
        className="callout-icon"
        contentEditable={false}
        disabled={!editor.isEditable}
        title="Change callout icon or colour"
        onClick={() => setMenuOpen((v) => !v)}
      >
        {emoji}
      </button>
      <NodeViewContent className="callout-body" />
      {editor.isEditable && (
        <div className="callout-tones" contentEditable={false}>
          {TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`callout-dot tone-${t.id}${tone === t.id ? ' active' : ''}`}
              title={t.label}
              onClick={() => updateAttributes({ tone: t.id })}
            />
          ))}
        </div>
      )}
      {menuOpen && (
        <Popover anchor={btnRef.current} onClose={() => setMenuOpen(false)} className="callout-picker">
          <div className="callout-picker-row">
            {QUICK_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                className={em === emoji ? 'active' : ''}
                onClick={() => {
                  updateAttributes({ emoji: em });
                  setMenuOpen(false);
                }}
              >
                {em}
              </button>
            ))}
          </div>
          <div className="callout-picker-tones">
            {TONES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`btn small${tone === t.id ? ' primary' : ''}`}
                onClick={() => {
                  updateAttributes({ tone: t.id, emoji: t.emoji });
                  setMenuOpen(false);
                }}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </NodeViewWrapper>
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      insertCallout: (attrs?: { tone?: CalloutTone; emoji?: string }) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      tone: {
        default: 'info',
        parseHTML: (el) => el.getAttribute('data-tone') || 'info',
        renderHTML: (a) => ({ 'data-tone': a.tone }),
      },
      emoji: {
        default: '💡',
        parseHTML: (el) => el.getAttribute('data-emoji') || '💡',
        renderHTML: (a) => ({ 'data-emoji': a.emoji }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-callout': '' }, HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addCommands() {
    return {
      insertCallout:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { tone: attrs?.tone ?? 'info', emoji: attrs?.emoji ?? '💡' },
            content: [{ type: 'paragraph' }],
          }),
    };
  },
});
