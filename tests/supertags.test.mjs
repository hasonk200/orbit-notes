import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());
const { collectTaggedItems, runLiveQuery, posAtPath, supertagTypes, normalizeTagName } = await vite.ssrLoadModule('/src/lib/supertags.ts');

const tag = (name) => ({ type: 'tag', attrs: { name } });
const para = (...content) => ({ type: 'paragraph', content });
const bill = { id: 'bill-type', name: '帳單', tag: '帳單', icon: '🏷️', color: '#000', order: 0, properties: [
  { key: 'amount', name: '金額', kind: 'number' },
  { key: 'status', name: '狀態', kind: 'select', options: ['未付', '已付'] },
] };
const note = {
  id: 'n1', typeId: 'page', title: '財務', props: {}, tags: ['帳單'], createdAt: 0, updatedAt: 0,
  content: { type: 'doc', content: [
    para({ type: 'text', text: '前言 ' }, tag('帳單')),
    { type: 'bulletList', content: [
      { type: 'listItem', attrs: { fields: { 'bill-type': { amount: 142.56, status: '未付' } } }, content: [
        para({ type: 'text', text: 'PC 帳單 ' }, tag('帳單')),
        { type: 'bulletList', content: [{ type: 'listItem', content: [para({ type: 'text', text: '子項目 ' }, tag('其他'))] }] },
      ] },
      { type: 'listItem', attrs: { fields: { 'bill-type': { amount: 17.58, status: '已付' } } }, content: [para({ type: 'text', text: 'BMO ' }, tag('帳單'))] },
    ] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true, fields: { 'bill-type': { amount: 422.62, status: '未付' } } }, content: [para({ type: 'text', text: 'Rogers ' }, tag('帳單'))] }] },
  ] },
};

test('collects tagged items with their fields, path and done state, including nested items', () => {
  const items = collectTaggedItems([note, { ...note, id: 'gone', deletedAt: 1 }]);
  assert.deepEqual(items.map((i) => i.text), ['前言', 'PC 帳單', '子項目', 'BMO', 'Rogers']);
  assert.deepEqual(items[1].path, [1, 0]);
  assert.deepEqual(items[2].path, [1, 0, 1, 0]);
  assert.equal(items[4].done, true);
  assert.equal(items[1].done, null);
  assert.equal(items[1].fields['bill-type'].amount, 142.56);
});

test('live query filters by tag, text, field value and done, and sorts by a field', () => {
  const items = collectTaggedItems([note]);
  const run = (q) => runLiveQuery(items, q, bill, () => '財務').map((i) => i.text);
  assert.deepEqual(run({ tag: '#帳單' }), ['前言', 'PC 帳單', 'BMO', 'Rogers']);
  assert.deepEqual(run({ tag: '帳單', field: 'status', value: '未付' }), ['PC 帳單', 'Rogers']);
  assert.deepEqual(run({ tag: '帳單', field: 'status', value: '未付', hideDone: true }), ['PC 帳單']);
  assert.deepEqual(run({ tag: '帳單', text: 'bm' }), ['BMO']);
  assert.deepEqual(run({ tag: '帳單', sort: 'amount', desc: true }), ['Rogers', 'PC 帳單', 'BMO', '前言']);
  assert.deepEqual(run({ tag: '帳單', field: 'amount', value: '∅' }), ['前言']);
  assert.deepEqual(run({ tag: '' }), []);
});

test('supertag lookup and tag normalising', () => {
  assert.deepEqual(supertagTypes([bill, { ...bill, id: 'x', tag: null }], ['帳單']).map((t) => t.id), ['bill-type']);
  assert.equal(normalizeTagName('  #Bill Due '), 'bill-due');
});

test('posAtPath finds the document position of a nested block', () => {
  const node = (size, kids = []) => ({ nodeSize: size, childCount: kids.length, child: (i) => kids[i] });
  const inner = node(10);
  const list = node(14, [node(2), inner]);
  const doc = node(0, [node(5), list]);
  assert.equal(posAtPath(doc, [1]), 5);
  assert.equal(posAtPath(doc, [1, 1]), 8);
  assert.equal(posAtPath(doc, [3]), null);
});
