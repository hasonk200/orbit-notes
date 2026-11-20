import { db, getMeta, setMeta, SCHEMA_VERSION, type JSONContent, type ObjType } from './schema';

const h = (text: string, level = 2): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const p = (text?: string): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });
const bullets = (): JSONContent => ({ type: 'bulletList', content: [{ type: 'listItem', content: [p()] }] });
const tasks = (): JSONContent => ({
  type: 'taskList',
  content: [{ type: 'taskItem', attrs: { checked: false, taskId: null, due: null }, content: [p()] }],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

export const BUILTIN_TYPES: ObjType[] = [
  { id: 'page', name: 'Page', icon: '📄', color: '#8b8a86', order: 0, builtin: true, properties: [], defaultTemplate: null },
  { id: 'daily', name: 'Daily Note', icon: '📅', color: '#e0864a', order: 1, builtin: true, properties: [], defaultTemplate: null },
  {
    id: 'person', name: 'Person', icon: '🧑', color: '#3f9bd8', order: 2, builtin: true,
    properties: [
      { key: 'company', name: 'Company', kind: 'text' },
      { key: 'email', name: 'Email', kind: 'text' },
      { key: 'phone', name: 'Phone', kind: 'text' },
      { key: 'birthday', name: 'Birthday', kind: 'date' },
      { key: 'website', name: 'Website', kind: 'url' },
    ],
    defaultTemplate: doc(h('About'), p(), h('Notes'), p()),
  },
  {
    id: 'project', name: 'Project', icon: '🚀', color: '#6d5efc', order: 3, builtin: true,
    properties: [
      { key: 'status', name: 'Status', kind: 'select', options: ['Idea', 'Active', 'Paused', 'Done'] },
      { key: 'start', name: 'Start', kind: 'date' },
      { key: 'due', name: 'Due', kind: 'date' },
      { key: 'people', name: 'People', kind: 'relation', targetTypeId: 'person', multi: true },
    ],
    defaultTemplate: doc(h('Goal'), p(), h('Next steps'), tasks(), h('Notes'), p()),
  },
  {
    id: 'book', name: 'Book', icon: '📚', color: '#2fa57a', order: 4, builtin: true,
    properties: [
      { key: 'author', name: 'Author', kind: 'text' },
      { key: 'status', name: 'Status', kind: 'select', options: ['To read', 'Reading', 'Finished'] },
      { key: 'rating', name: 'Rating', kind: 'number' },
      { key: 'finished', name: 'Finished', kind: 'date' },
    ],
    defaultTemplate: doc(h('Key Takeaways'), bullets(), h('Quotes'), { type: 'blockquote', content: [p()] }),
  },
  {
    id: 'idea', name: 'Idea', icon: '💡', color: '#e5b12e', order: 5, builtin: true,
    properties: [{ key: 'stage', name: 'Stage', kind: 'select', options: ['Spark', 'Exploring', 'Ready', 'Shelved'] }],
    defaultTemplate: null,
  },
  {
    id: 'meeting', name: 'Meeting', icon: '🗓️', color: '#d9546e', order: 6, builtin: true,
    properties: [
      { key: 'date', name: 'Date', kind: 'date' },
      { key: 'attendees', name: 'Attendees', kind: 'relation', targetTypeId: 'person', multi: true },
      { key: 'project', name: 'Project', kind: 'relation', targetTypeId: 'project', multi: false },
    ],
    defaultTemplate: doc(h('Agenda'), bullets(), h('Notes'), p(), h('Action Items'), tasks()),
  },
];

export async function ensureSeed() {
  const version = await getMeta<number>('schemaVersion');
  if (version == null) {
    await db.transaction('rw', db.types, db.meta, async () => {
      const existing = await db.types.count();
      if (existing === 0) await db.types.bulkPut(BUILTIN_TYPES);
      await setMeta('schemaVersion', SCHEMA_VERSION);
    });
  }
}
