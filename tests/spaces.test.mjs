import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());
const spaces = await vite.ssrLoadModule('/src/lib/spaces.ts');
const { extractTasks, docText } = await vite.ssrLoadModule('/src/lib/content.ts');
const { BUILTIN_TYPES } = await vite.ssrLoadModule('/src/db/seed.ts');
const { objectFingerprint } = await vite.ssrLoadModule('/src/sync/objectVersions.ts');
const { translators } = await vite.ssrLoadModule('/src/lib/i18n.ts');

const note = (id, extra = {}) => ({ id, typeId: 'page', title: id, props: {}, tags: [], content: { type: 'doc' }, createdAt: 1, updatedAt: 1, ...extra });

test('notes without a space mark belong to my space, so older data needs no move', () => {
  assert.equal(spaces.spaceOf(note('old')), 'me');
  assert.equal(spaces.spaceOf(note('x', { space: 'me' })), 'me');
  assert.equal(spaces.spaceOf(note('x', { space: 'ai' })), 'ai');
  assert.equal(spaces.spaceOf(note('x', { space: 'something else' })), 'me');
  assert.equal(spaces.spaceOf(undefined), 'me');
  assert.deepEqual(spaces.spaceMark('me'), { space: undefined });
  assert.deepEqual(spaces.spaceMark('ai'), { space: 'ai' });
  assert.equal(spaces.otherSpace('me'), 'ai');
  assert.equal(spaces.parseSpace('ai'), 'ai');
  assert.equal(spaces.parseSpace(undefined), 'me');
});

test('the space mark leaves the fingerprint of older notes unchanged, so nothing re-uploads', async () => {
  const old = note('n1');
  const marked = { ...old, ...spaces.spaceMark('me') };
  assert.equal(await objectFingerprint(marked), await objectFingerprint(old));
  assert.notEqual(await objectFingerprint({ ...old, space: 'ai' }), await objectFingerprint(old));
});

test('filters notes and tasks by space; trashed notes are left out', () => {
  const objects = [note('mine'), note('ai-doc', { space: 'ai' }), note('gone', { space: 'ai', deletedAt: 5 })];
  assert.deepEqual(spaces.objectsInSpace(objects, 'me').map((o) => o.id), ['mine']);
  assert.deepEqual(spaces.objectsInSpace(objects, 'ai').map((o) => o.id), ['ai-doc']);
  assert.deepEqual(spaces.objectsInSpace(objects, 'all').map((o) => o.id), ['mine', 'ai-doc']);

  const objMap = new Map(objects.map((o) => [o.id, o]));
  const tasks = [{ id: 't1', objectId: 'mine' }, { id: 't2', objectId: 'ai-doc' }, { id: 't3', objectId: 'missing' }];
  assert.deepEqual(spaces.tasksInSpace(tasks, objMap, 'me').map((t) => t.id), ['t1', 't3']);
  assert.deepEqual(spaces.tasksInSpace(tasks, objMap, 'ai').map((t) => t.id), ['t2']);
});

test('my space lists the same types as before; the AI workspace lists its own types first', () => {
  const before = BUILTIN_TYPES.filter((t) => t.space !== 'ai').map((t) => t.id);
  assert.deepEqual(before, ['page', 'daily', 'person', 'project', 'book', 'idea', 'meeting']);
  assert.deepEqual(spaces.typesForSpace(BUILTIN_TYPES, [], 'me').map((t) => t.id), before);
  assert.deepEqual(spaces.typesForSpace(BUILTIN_TYPES, [], 'ai').map((t) => t.id), ['ai-log', 'ai-doc', 'page']);
  const objects = [note('p', { typeId: 'person', space: 'ai' }), note('b', { typeId: 'book' })];
  assert.deepEqual(spaces.typesForSpace(BUILTIN_TYPES, objects, 'ai').map((t) => t.id), ['ai-log', 'ai-doc', 'page', 'person']);
  assert.deepEqual(spaces.creatableTypes(BUILTIN_TYPES, [], 'ai').map((t) => t.id), ['ai-doc', 'page']);
  assert.ok(!spaces.creatableTypes(BUILTIN_TYPES, [], 'me').some((t) => t.id === 'daily' || t.space === 'ai'));
});

test('AI logs have one id per day and a dated title in both languages', () => {
  assert.equal(spaces.aiLogId('2026-11-26'), 'ai-log-2026-11-26');
  assert.ok(spaces.isAiLogId('ai-log-2026-11-26'));
  assert.ok(!spaces.isAiLogId('ai-log-today'));
  assert.equal(spaces.aiLogTitle('2026-11-26'), 'AI 日誌 · 2026-11-26（四）');
  assert.equal(spaces.aiLogTitle('2026-11-25'), 'AI 日誌 · 2026-11-25（三）');
  assert.equal(spaces.aiLogTitle('2026-11-29', translators.en), 'AI log · 2026-11-29 (Sun)');
  assert.equal(spaces.aiDocTitle('Notion 全面掃描報告', '2026-11-25'), 'Notion 全面掃描報告（2026-11-25）');
  assert.equal(spaces.aiDocTitle('Notion 全面掃描報告（2026-11-20）', '2026-11-25'), 'Notion 全面掃描報告（2026-11-25）');
});

test('a work entry has a fixed layout, links the changed notes and turns open items into AI to-dos', () => {
  let n = 0;
  const newId = () => `task-${++n}`;
  const entry = {
    time: '14:30', by: 'Claude', title: '整理財務筆記', done: '把三個帳戶的數字對齊', date: '2026-11-26',
    notes: ['fin', 'sites', 'fin'],
    open: ['補上 10 月的帳單'], confirm: ['新版數字請核對'],
  };
  const doc = spaces.appendAiWork({ type: 'doc', content: [{ type: 'paragraph' }] }, entry, newId);
  assert.equal(doc.content[0].type, 'heading');
  assert.equal(docText(doc, (id) => `[[${id}]]`).split('\n')[0], '14:30 · Claude · 整理財務筆記');
  const text = docText(doc, (id) => `[[${id}]]`);
  assert.match(text, /做了什麼：把三個帳戶的數字對齊/);
  assert.match(text, /改了哪些筆記：\[\[fin\]\]、\[\[sites\]\]/);
  assert.match(text, /還沒完成：/);
  assert.match(text, /需要你確認：/);

  const tasks = extractTasks(doc);
  assert.deepEqual(tasks.map((t) => [t.text, t.aiTodo.kind, t.explicitKind]), [['補上 10 月的帳單', 'next', 'todo'], ['新版數字請核對', 'confirm', 'todo']]);
  assert.deepEqual(tasks[1].aiTodo, { kind: 'confirm', at: '2026-11-26', notes: ['fin', 'sites'] });

  // A second entry is added after the first; the log keeps both.
  const second = spaces.appendAiWork(doc, { ...entry, time: '16:05', title: '第二段', open: [], confirm: [], notes: [] }, newId);
  assert.deepEqual(spaces.aiLogEntries(second).map((e) => [e.time, e.by, e.title]), [['14:30', 'Claude', '整理財務筆記'], ['16:05', 'Claude', '第二段']]);
  assert.equal(extractTasks(second).length, 2);
  assert.match(docText(second), /改了哪些筆記：（沒有）/);
});

test('AI to-dos waiting over 14 days are marked, and bad marks are ignored', () => {
  assert.equal(spaces.daysSince('2026-11-12', '2026-11-26'), 14);
  assert.equal(spaces.isStaleAiTodo({ at: '2026-11-12' }, '2026-11-26'), false);
  assert.equal(spaces.isStaleAiTodo({ at: '2026-11-11' }, '2026-11-26'), true);
  assert.equal(spaces.daysSince('2026-10-25', '2026-11-01'), 7); // across the daylight-saving change
  assert.equal(spaces.parseAiTodo({ kind: 'other', at: '2026-11-26' }), null);
  assert.equal(spaces.parseAiTodo({ kind: 'next', at: 'yesterday' }), null);
  assert.deepEqual(spaces.parseAiTodo({ kind: 'next', at: '2026-11-26', notes: ['a', 3] }), { kind: 'next', at: '2026-11-26', notes: ['a'] });
});

test('AI documents default to Draft and keep known statuses', () => {
  assert.equal(spaces.aiDocStatus({ props: {} }), 'Draft');
  assert.equal(spaces.aiDocStatus({ props: { status: 'Adopted' } }), 'Adopted');
  assert.equal(spaces.aiDocStatus({ props: { status: '亂寫' } }), 'Draft');
});
