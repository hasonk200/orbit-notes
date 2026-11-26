import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());
const { diffLines, diffHunks, diffCounts } = await vite.ssrLoadModule('/src/lib/textDiff.ts');

const kinds = (lines) => lines.map((l) => (l ? `${l.kind[0]}:${l.text}` : '…'));

test('finds changed, added and removed lines between two versions', () => {
  const lines = diffLines('買菜\n回覆 email\n跑步', '買菜\n回覆 email 給老闆\n跑步\n繳電話費');
  assert.deepEqual(kinds(lines), ['s:買菜', 'r:回覆 email', 'a:回覆 email 給老闆', 's:跑步', 'a:繳電話費']);
  assert.deepEqual(diffCounts(lines), { removed: 1, added: 2 });
  assert.deepEqual(diffCounts(diffLines('同一段', '同一段')), { removed: 0, added: 0 });
});

test('keeps only changes with one line of context, folding the rest', () => {
  const a = ['1', '2', '3', '4', '5', '6', '7', '8'].join('\n');
  const b = ['1', '2', '3', '4', '5', '6', 'seven', '8'].join('\n');
  assert.deepEqual(kinds(diffHunks(diffLines(a, b))), ['…', 's:6', 'r:7', 'a:seven', 's:8']);
});

test('very long texts fall back to a simple comparison instead of freezing', () => {
  const lines = diffLines('a\nb\nc', 'a\nx\nc', 0);
  assert.deepEqual(kinds(lines), ['s:a', 'r:b', 'a:x', 's:c']);
});
