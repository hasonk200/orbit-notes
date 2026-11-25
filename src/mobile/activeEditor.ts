import { create } from 'zustand';
import type { Editor } from '@tiptap/react';

/** The editor currently being typed in, so the phone keyboard toolbar can act on it. */
export const useActiveEditor = create<{ editor: Editor | null }>(() => ({ editor: null }));

export function editorFocused(editor: Editor) {
  useActiveEditor.setState({ editor });
}

export function editorBlurred(editor: Editor, next: EventTarget | null) {
  // Tapping the toolbar itself must not count as leaving the editor.
  if (next instanceof Element && next.closest('.kb-bar')) return;
  if (useActiveEditor.getState().editor === editor) useActiveEditor.setState({ editor: null });
}
