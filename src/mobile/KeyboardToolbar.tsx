import { useEffect, useState } from 'react';
import { AtSign, ChevronDown, Hash, IndentDecrease, IndentIncrease, Keyboard, Link2, List, ListChecks, ListOrdered, Pilcrow, Plus } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { useT } from '../store/uiStore';
import { useActiveEditor } from './activeEditor';

/** Distance between the bottom of the layout viewport and the top of the on-screen keyboard. */
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

/** Type a trigger character (like # or @) so its suggestion menu opens, adding a space if it would touch a word. */
function typeTrigger(editor: Editor, text: string) {
  const { $from } = editor.state.selection;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, '\n', ' ');
  const space = before && !/\s/.test(before) ? ' ' : '';
  editor.chain().focus().insertContent(space + text).run();
}

function indent(editor: Editor, deeper: boolean) {
  const chain = () => editor.chain().focus();
  for (const type of ['listItem', 'taskItem']) {
    const ok = deeper ? chain().sinkListItem(type).run() : chain().liftListItem(type).run();
    if (ok) return;
  }
}

type ListKind = 'bullet' | 'ordered' | 'task' | 'text';

function currentList(editor: Editor): ListKind {
  if (editor.isActive('taskList')) return 'task';
  if (editor.isActive('orderedList')) return 'ordered';
  if (editor.isActive('bulletList')) return 'bullet';
  return 'text';
}

function setList(editor: Editor, kind: ListKind) {
  const now = currentList(editor);
  if (now === kind) return;
  const c = editor.chain().focus();
  if (kind === 'bullet') c.toggleBulletList().run();
  else if (kind === 'ordered') c.toggleOrderedList().run();
  else if (kind === 'task') c.toggleTaskList().run();
  else if (now === 'task') c.toggleTaskList().run();
  else if (now === 'ordered') c.toggleOrderedList().run();
  else c.toggleBulletList().run();
}

/**
 * The toolbar that sits on top of the phone keyboard while writing: indent, tag, commands,
 * dates, links and list type, plus a button that puts the keyboard away.
 */
export function KeyboardToolbar() {
  const tr = useT();
  const editor = useActiveEditor((s) => s.editor);
  const inset = useKeyboardInset();
  const [listMenu, setListMenu] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    if (!editor) return setListMenu(false);
    const refresh = () => force((n) => n + 1);
    editor.on('selectionUpdate', refresh);
    editor.on('transaction', refresh);
    return () => {
      editor.off('selectionUpdate', refresh);
      editor.off('transaction', refresh);
    };
  }, [editor]);

  if (!editor || editor.isDestroyed || !editor.isEditable) return null;
  const kind = currentList(editor);
  // Keep the editor focused (and the keyboard up) while tapping the toolbar.
  const hold = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();
  const btn = (label: string, icon: React.ReactNode, run: () => void, extra?: string) => (
    <button type="button" className={`kb-btn${extra ? ' ' + extra : ''}`} aria-label={label} title={label} onPointerDown={hold} onMouseDown={hold} onClick={run}>
      {icon}
    </button>
  );
  const lists: [ListKind, string, React.ReactNode][] = [
    ['bullet', tr('Bullet list'), <List size={18} />],
    ['ordered', tr('Numbered list'), <ListOrdered size={18} />],
    ['task', tr('To-do list'), <ListChecks size={18} />],
    ['text', tr('Plain text'), <Pilcrow size={18} />],
  ];
  const kindIcon = lists.find(([k]) => k === kind)![2];

  return (
    <div className="kb-bar" style={{ bottom: `calc(${inset}px + 8px)` }} role="toolbar" aria-label={tr('Writing tools')}>
      {listMenu && (
        <div className="kb-menu" role="menu" aria-label={tr('List')}>
          <div className="kb-menu-head">{tr('List')}</div>
          {lists.map(([k, label, icon]) => (
            <button
              key={k}
              type="button"
              role="menuitemradio"
              aria-checked={kind === k}
              className={`kb-menu-item${kind === k ? ' is-active' : ''}`}
              onPointerDown={hold}
              onMouseDown={hold}
              onClick={() => {
                setList(editor, k);
                setListMenu(false);
              }}
            >
              <span className="kb-menu-icon">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="kb-pill">
        {btn(tr('Outdent'), <IndentDecrease size={19} />, () => indent(editor, false))}
        {btn(tr('Indent'), <IndentIncrease size={19} />, () => indent(editor, true))}
        {btn(tr('Tag'), <Hash size={18} />, () => typeTrigger(editor, '#'))}
        {btn(tr('Insert'), <Plus size={20} />, () => typeTrigger(editor, '/'))}
        {btn(tr('Date'), <AtSign size={18} />, () => typeTrigger(editor, '@'))}
        {btn(tr('Link'), <Link2 size={18} />, () => typeTrigger(editor, '[['))}
        {btn(
          tr('List'),
          <>
            {kindIcon}
            <ChevronDown size={13} />
          </>,
          () => setListMenu((v) => !v),
          `is-list${listMenu ? ' is-open' : ''}`,
        )}
      </div>
      <div className="kb-pill kb-done">
        {btn(tr('Hide keyboard'), <Keyboard size={19} />, () => {
          setListMenu(false);
          editor.commands.blur();
          (document.activeElement as HTMLElement | null)?.blur?.();
          useActiveEditor.setState({ editor: null });
        })}
      </div>
    </div>
  );
}
