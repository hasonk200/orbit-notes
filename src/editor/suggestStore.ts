import { create } from 'zustand';
import type { Editor, Range } from '@tiptap/core';
import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';

export interface SuggestItem {
  key: string;
  label: string;
  icon?: string; // emoji or short glyph
  hint?: string;
  section?: string;
  run: (editor: Editor, range: Range) => void;
}

interface SuggestState {
  open: boolean;
  items: SuggestItem[];
  index: number;
  rect: DOMRect | null;
  title: string;
  select: ((item: SuggestItem) => void) | null;
}

export const useSuggest = create<SuggestState>(() => ({ open: false, items: [], index: 0, rect: null, title: '', select: null }));

/** Shared render() for every suggestion trigger. The popup itself is <SuggestPopup/>. */
export function suggestRender(title: string): SuggestionOptions<SuggestItem, SuggestItem>['render'] {
  return () => {
    const sync = (p: SuggestionProps<SuggestItem, SuggestItem>, reset: boolean) => {
      const rect = p.clientRect?.() ?? null;
      const prev = useSuggest.getState();
      useSuggest.setState({
        open: true,
        items: p.items,
        index: reset ? 0 : Math.min(prev.index, Math.max(0, p.items.length - 1)),
        rect,
        title,
        select: (item) => p.command(item),
      });
    };
    return {
      onStart: (p) => sync(p, true),
      onUpdate: (p) => sync(p, true),
      onExit: () => useSuggest.setState({ open: false, items: [], select: null }),
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        const s = useSuggest.getState();
        if (!s.open) return false;
        if (event.key === 'Escape') {
          useSuggest.setState({ open: false });
          return true;
        }
        if (!s.items.length) return false;
        if (event.key === 'ArrowDown') {
          useSuggest.setState({ index: (s.index + 1) % s.items.length });
          return true;
        }
        if (event.key === 'ArrowUp') {
          useSuggest.setState({ index: (s.index - 1 + s.items.length) % s.items.length });
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = s.items[s.index];
          if (item && s.select) s.select(item);
          return true;
        }
        return false;
      },
    };
  };
}

export const runItem: SuggestionOptions<SuggestItem, SuggestItem>['command'] = ({ editor, range, props }) => props.run(editor, range);
