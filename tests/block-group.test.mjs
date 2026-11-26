import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => vite.close());

const { extractTasks, ungroupBlockInDoc, blockGroupTitle } = await vite.ssrLoadModule('/src/lib/content.ts');
const { collapseTaskGroups, countCollapsedEntries } = await vite.ssrLoadModule('/src/lib/taskGroups.ts');

test('extractTasks captures groupId and derived/explicit groupTitle only when groupTasks !== false', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'blockGroup',
        attrs: { groupId: 'grp-1', title: '', collapsed: false, groupTasks: true },
        content: [
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '階段 0：今日 3 件小事' }] },
          {
            type: 'taskList',
            content: [
              { type: 'taskItem', attrs: { taskId: 't1', checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '0.1 交 HKBN' }] }] },
              { type: 'taskItem', attrs: { taskId: 't2', checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '0.2 TG 覆訊息' }] }] },
            ],
          },
        ],
      },
      {
        type: 'blockGroup',
        attrs: { groupId: 'grp-2', title: '不收合群組', collapsed: false, groupTasks: false },
        content: [
          {
            type: 'taskList',
            content: [
              { type: 'taskItem', attrs: { taskId: 't3', checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '獨立待辦' }] }] },
            ],
          },
        ],
      },
    ],
  };

  assert.equal(blockGroupTitle(doc.content[0]), '階段 0：今日 3 件小事');
  const tasks = extractTasks(doc);
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].groupId, 'grp-1');
  assert.equal(tasks[0].groupTitle, '階段 0：今日 3 件小事');
  assert.equal(tasks[1].groupId, 'grp-1');
  assert.equal(tasks[2].groupId, null);
  assert.equal(tasks[2].groupTitle, null);
});

test('ungroupBlockInDoc unwraps blockGroup in place and preserves tasks', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      {
        type: 'blockGroup',
        attrs: { groupId: 'grp-1', title: '階段 0' },
        content: [
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '細項' }] },
          {
            type: 'taskList',
            content: [
              { type: 'taskItem', attrs: { taskId: 't1', checked: false, due: '2026-11-27' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 1' }] }] },
            ],
          },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
    ],
  };

  const unwrapped = ungroupBlockInDoc(doc, 'grp-1');
  assert.ok(unwrapped);
  assert.deepEqual(
    unwrapped.content.map((b) => b.type),
    ['paragraph', 'heading', 'taskList', 'paragraph'],
  );
  const extracted = extractTasks(unwrapped);
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].id, 't1');
  assert.equal(extracted[0].due, '2026-11-27');
  assert.equal(extracted[0].groupId, null);
});

test('collapseTaskGroups bundles grouped tasks into 1 entry with accurate progress, earliest due, and highest priority', () => {
  const allPool = [
    { id: 't1', objectId: 'note-1', text: 'Step 1', done: true, status: 'done', kind: 'todo', due: '2026-11-28', priority: 'low', groupId: 'g1', groupTitle: 'HKBN 清算', createdAt: 1, updatedAt: 1 },
    { id: 't2', objectId: 'note-1', text: 'Step 2', done: false, status: 'open', kind: 'todo', due: '2026-11-26', priority: 'high', groupId: 'g1', groupTitle: 'HKBN 清算', createdAt: 2, updatedAt: 2 },
    { id: 't3', objectId: 'note-1', text: 'Step 3', done: false, status: 'open', kind: 'todo', due: '2026-11-29', priority: 'medium', groupId: 'g1', groupTitle: 'HKBN 清算', createdAt: 3, updatedAt: 3 },
    { id: 's1', objectId: 'note-1', text: 'Standalone', done: false, status: 'open', kind: 'todo', due: '2026-11-26', priority: null, createdAt: 4, updatedAt: 4 },
  ];

  // Filtered view only showing open tasks due today (t2) + standalone (s1)
  const visible = [allPool[1], allPool[3]];
  const entries = collapseTaskGroups(visible, allPool);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, 'bundle');
  assert.equal(entries[0].title, 'HKBN 清算');
  assert.equal(entries[0].doneCount, 1);
  assert.equal(entries[0].totalCount, 3);
  assert.equal(entries[0].pct, 33);
  assert.equal(entries[0].earliestDue, '2026-11-26');
  assert.equal(entries[0].highestPrio, 'high');
  assert.equal(entries[1].kind, 'single');
  assert.equal(entries[1].task.id, 's1');

  assert.equal(countCollapsedEntries(allPool), 2);
});
