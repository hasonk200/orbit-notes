import { useCallback, useEffect, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { Placeholder } from '@tiptap/extension-placeholder';
import { OrbitTaskItem } from './extensions/TaskItem';
import { ObjectLink } from './extensions/ObjectLink';
import { Tag } from './extensions/TagSuggest';
import { DateRef } from './extensions/DateRef';
import { BlobImage } from './extensions/BlobImage';
import { SlashMenu } from './SlashMenu';
import type { JSONContent, Obj } from '../db/schema';
import { saveObject } from '../db/indexers';

export function buildExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: true, autolink: true, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } },
    }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : placeholder),
      showOnlyCurrent: true,
    }),
    TaskList,
    OrbitTaskItem,
    ObjectLink,
    Tag,
    DateRef,
    BlobImage,
    SlashMenu,
  ];
}

interface RichEditorProps {
  docKey: string;
  content: JSONContent;
  onChange: (json: JSONContent) => void;
  placeholder?: string;
  editable?: boolean;
  autofocus?: boolean;
  className?: string;
  onReady?: (e: Editor) => void;
}

/** Generic editor. Re-created when docKey changes. */
export function RichEditor({ docKey, content, onChange, placeholder, editable = true, autofocus, className, onReady }: RichEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editor = useEditor(
    {
      extensions: buildExtensions(placeholder ?? 'Write something, or type / for commands, [[ to link, # to tag, @ for dates'),
      content,
      editable,
      autofocus: autofocus ? 'end' : false,
      editorProps: { attributes: { class: `prose ${className ?? ''}`, spellcheck: 'true' } },
      onUpdate: ({ editor }) => onChangeRef.current(editor.getJSON() as JSONContent),
    },
    [docKey],
  );
  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);
  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editor, editable]);
  return <EditorContent editor={editor} className="editor-root" />;
}

/**
 * Editor bound to an object: debounced autosave, flush on leave,
 * and live reload when the object is changed elsewhere (Tasks view, split pane).
 */
export function ObjectEditor({ obj, autofocus, placeholder }: { obj: Obj; autofocus?: boolean; placeholder?: string }) {
  const editorRef = useRef<Editor | null>(null);
  const lastSaved = useRef(JSON.stringify(obj.content));
  const pending = useRef<JSONContent | null>(null);
  const timer = useRef<number>(0);
  const id = obj.id;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const c = pending.current;
    if (!c) return;
    pending.current = null;
    lastSaved.current = JSON.stringify(c);
    void saveObject(id, { content: c });
  }, [id]);

  const onChange = useCallback(
    (json: JSONContent) => {
      pending.current = json;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 400);
    },
    [flush],
  );

  // flush when leaving the object / closing the tab
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onHide);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush]);

  // apply changes made elsewhere
  useEffect(() => {
    const s = JSON.stringify(obj.content);
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    if (s !== lastSaved.current && !pending.current) {
      lastSaved.current = s;
      const { from, to } = ed.state.selection;
      ed.commands.setContent(obj.content, { emitUpdate: false });
      try {
        const max = ed.state.doc.content.size;
        ed.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
      } catch {
        /* ignore */
      }
    }
  }, [obj.content]);

  const onReady = useCallback((e: Editor) => {
    editorRef.current = e;
  }, []);

  return (
    <RichEditor
      docKey={id}
      content={obj.content}
      onChange={onChange}
      autofocus={autofocus}
      placeholder={placeholder}
      editable={!obj.deletedAt}
      onReady={onReady}
    />
  );
}
