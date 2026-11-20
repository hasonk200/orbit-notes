import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { runItem, suggestRender, type SuggestItem } from './suggestStore';
import { pickImage } from './extensions/BlobImage';
import { todayISO } from '../lib/dates';

const ITEMS: Omit<SuggestItem, 'key'>[] = [
  { label: 'Text', icon: '¶', hint: 'Plain paragraph', section: 'Basic', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { label: 'Heading 1', icon: 'H1', section: 'Basic', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { label: 'Heading 2', icon: 'H2', section: 'Basic', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { label: 'Heading 3', icon: 'H3', section: 'Basic', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { label: 'Task', icon: '☑', hint: 'To-do & priority', section: 'Lists', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { label: 'Bullet outliner', icon: '•', hint: 'Nested toggle points', section: 'Lists', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { label: 'Numbered list', icon: '1.', section: 'Lists', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { label: 'Toggle', icon: '▸', hint: 'Collapsible section', section: 'Blocks', run: (e, r) => e.chain().focus().deleteRange(r).insertToggle().run() },
  { label: 'Callout', icon: '💡', hint: 'Highlighted note box', section: 'Blocks', run: (e, r) => e.chain().focus().deleteRange(r).insertCallout().run() },
  { label: 'Table', icon: '⊞', hint: '3×3 table', section: 'Blocks', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { label: 'Quote', icon: '❝', section: 'Blocks', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { label: 'Code block', icon: '</>', section: 'Blocks', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { label: 'Divider', icon: '—', section: 'Blocks', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  {
    label: 'Image',
    icon: '🖼',
    hint: 'Upload (or paste / drop)',
    section: 'Media',
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      pickImage(e);
    },
  },
  { label: 'Link object', icon: '↗', hint: 'Type [[', section: 'Links', run: (e, r) => e.chain().focus().deleteRange(r).insertContent('[[').run() },
  { label: 'Tag', icon: '#', section: 'Links', run: (e, r) => e.chain().focus().deleteRange(r).insertContent('#').run() },
  {
    label: 'Today’s date',
    icon: '◷',
    hint: 'Or type @',
    section: 'Links',
    run: (e, r) =>
      e
        .chain()
        .focus()
        .insertContentAt(r, [
          { type: 'dateRef', attrs: { date: todayISO() } },
          { type: 'text', text: ' ' },
        ])
        .run(),
  },
];

export const SlashMenu = Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestItem, SuggestItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slashMenu'),
        char: '/',
        items: ({ query }) => {
          const q = query.toLowerCase();
          return ITEMS.filter((i) => !q || i.label.toLowerCase().includes(q) || (i.section ?? '').toLowerCase().includes(q)).map((i) => ({
            ...i,
            key: i.label,
          }));
        },
        render: suggestRender('Insert'),
        command: runItem,
        allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== 'codeBlock',
      }),
    ];
  },
});
