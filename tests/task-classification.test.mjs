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

const { classifyTaskKind } = await vite.ssrLoadModule('/src/lib/tasks.ts');
const { extractTasks, patchTasksInDoc, patchTaskInDoc } = await vite.ssrLoadModule('/src/lib/content.ts');
const { appendTask } = await vite.ssrLoadModule('/src/lib/taskInput.ts');

test('classifyTaskKind respects explicit kind over all heuristics', () => {
  assert.equal(classifyTaskKind({ explicitKind: 'todo', sourceTypeId: 'project', status: 'in_progress' }), 'todo');
  assert.equal(classifyTaskKind({ explicitKind: 'task', sourceTypeId: 'daily', status: 'open' }), 'task');
});

test('classifyTaskKind separates plain daily/page reminders from project-linked or workflow tasks', () => {
  // Plain daily note or page checkboxes → todo
  assert.equal(classifyTaskKind({ sourceTypeId: 'daily', status: 'open' }), 'todo');
  assert.equal(classifyTaskKind({ sourceTypeId: 'page', status: 'done' }), 'todo');
  assert.equal(classifyTaskKind({ sourceTypeId: 'daily', linkedTypes: ['person', 'page'] }), 'todo');
  assert.equal(classifyTaskKind({ sourceTypeId: 'daily', contextId: 'daily-2026-11-24' }), 'todo');

  // Linking to a Project inside a daily note → task (e.g. "Draft spec for [[Launch v2]]")
  assert.equal(classifyTaskKind({ sourceTypeId: 'daily', linkedTypes: ['project'] }), 'task');

  // Workflow status or explicit non-daily context → task
  assert.equal(classifyTaskKind({ sourceTypeId: 'daily', status: 'not_started' }), 'task');
  assert.equal(classifyTaskKind({ sourceTypeId: 'daily', status: 'next_up' }), 'task');
  assert.equal(classifyTaskKind({ sourceTypeId: 'daily', status: 'in_progress' }), 'task');
  assert.equal(classifyTaskKind({ sourceTypeId: 'daily', contextId: 'proj-launch-v2' }), 'task');

  // Authored inside Project, Book, Meeting, Person, or custom types → task
  assert.equal(classifyTaskKind({ sourceTypeId: 'project', status: 'open' }), 'task');
  assert.equal(classifyTaskKind({ sourceTypeId: 'meeting', status: 'open' }), 'task');
  assert.equal(classifyTaskKind({ sourceTypeId: 'book', status: 'open' }), 'task');
  assert.equal(classifyTaskKind({ sourceTypeId: 'custom-sprint', status: 'open' }), 'task');
});

test('extractTasks reads explicitKind without mutating legacy notes and extracts own inline linkIds', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { taskId: 't1', checked: false, due: '2026-11-24' },
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Draft spec for ' },
                  { type: 'objectLink', attrs: { id: 'proj-1' } },
                ],
              },
              {
                type: 'taskList',
                content: [
                  {
                    type: 'taskItem',
                    attrs: { taskId: 't2', checked: false, kind: 'todo' },
                    content: [
                      {
                        type: 'paragraph',
                        content: [
                          { type: 'text', text: 'Nested link ' },
                          { type: 'objectLink', attrs: { id: 'proj-nested' } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const titles = new Map([
    ['proj-1', 'Launch v2'],
    ['proj-nested', 'Other'],
  ]);
  const extracted = extractTasks(doc, (id) => titles.get(id) ?? '');
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].id, 't1');
  assert.equal(extracted[0].explicitKind, null);
  assert.deepEqual(extracted[0].linkIds, ['proj-1']);
  assert.equal(extracted[1].id, 't2');
  assert.equal(extracted[1].explicitKind, 'todo');
  assert.deepEqual(extracted[1].linkIds, ['proj-nested']);
  // Legacy node was never mutated
  assert.equal('kind' in doc.content[0].content[0].attrs, false);
});

test('patchTasksInDoc batches multiple task updates in one document and supports explicit kind toggle/clear', () => {
  const base = {
    type: 'doc',
    content: [
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { taskId: 'a', checked: false, due: '2026-11-20' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Overdue A' }] }] },
          { type: 'taskItem', attrs: { taskId: 'b', checked: false, due: '2026-11-21' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Overdue B' }] }] },
          { type: 'taskItem', attrs: { taskId: 'c', checked: false, due: '2026-11-28' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Future C' }] }] },
        ],
      },
    ],
  };

  const rescheduled = patchTasksInDoc(base, {
    a: { due: '2026-11-24' },
    b: { due: '2026-11-24', kind: 'task', contextId: 'proj-1' },
  });
  assert.ok(rescheduled);
  const items = extractTasks(rescheduled);
  assert.equal(items[0].due, '2026-11-24');
  assert.equal(items[0].explicitKind, null);
  assert.equal(items[1].due, '2026-11-24');
  assert.equal(items[1].explicitKind, 'task');
  assert.equal(items[1].contextId, 'proj-1');
  assert.equal(items[2].due, '2026-11-28');

  // Clearing explicit kind removes the attribute cleanly
  const cleared = patchTaskInDoc(rescheduled, 'b', { kind: null });
  assert.ok(cleared);
  assert.equal('kind' in cleared.content[0].content[1].attrs, false);
});

test('appendTask writes kind only when explicitly supplied', () => {
  const empty = { type: 'doc', content: [{ type: 'paragraph' }] };
  const autoDoc = appendTask(empty, 'id-1', 'Buy milk', '2026-11-24', null);
  assert.equal('kind' in autoDoc.content[0].content[0].attrs, false);

  const explicitDoc = appendTask(empty, 'id-2', 'Ship v2', '2026-11-24', 'high', { kind: 'task' });
  assert.equal(explicitDoc.content[0].content[0].attrs.kind, 'task');
});
