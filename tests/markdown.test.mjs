import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());
const { markdownToBlocks, parseInline, looksLikeMarkdown } = await vite.ssrLoadModule('/src/lib/markdown.ts');
const { extractTasks, docText } = await vite.ssrLoadModule('/src/lib/content.ts');

test('headings, bullets, numbered lists and paragraphs', () => {
  const blocks = markdownToBlocks('# 財務進度\n\n- 第一點\n- 第二點\n  - 子項目\n\n1. 一\n2. 二\n\n普通段落');
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'bulletList', 'paragraph', 'orderedList', 'paragraph', 'paragraph']);
  assert.equal(blocks[0].attrs.level, 1);
  assert.equal(blocks[1].content.length, 2);
  assert.equal(blocks[1].content[1].content[1].type, 'bulletList');
  assert.equal(blocks[1].content[0].type, 'listItem');
});

test('to-dos become real tasks, including ☐ and ☑ symbols', () => {
  const blocks = markdownToBlocks('- [ ] PC 帳單 $142.56\n- [x] 已付房租\n☐ BMO 到期\n☑ 完成');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'taskList');
  assert.deepEqual(blocks[0].content.map((t) => t.attrs.checked), [false, true, false, true]);
  const doc = { type: 'doc', content: blocks };
  blocks[0].content.forEach((t, i) => { t.attrs.taskId = 't' + i; });
  assert.deepEqual(extractTasks(doc).map((t) => t.text), ['PC 帳單 $142.56', '已付房租', 'BMO 到期', '完成']);
});

test('inline bold, italic, code, strike and links', () => {
  const nodes = parseInline('**粗體** 和 *斜體* `code` ~~刪除~~ [網站](https://example.com) file_name_here');
  const marked = (type) => nodes.filter((n) => n.marks?.some((m) => m.type === type)).map((n) => n.text);
  assert.deepEqual(marked('bold'), ['粗體']);
  assert.deepEqual(marked('italic'), ['斜體']);
  assert.deepEqual(marked('code'), ['code']);
  assert.deepEqual(marked('strike'), ['刪除']);
  assert.deepEqual(marked('link'), ['網站']);
  assert.ok(nodes.at(-1).text.endsWith('file_name_here'));
});

test('bare https and file URLs become links, without trailing punctuation', () => {
  const nodes = parseInline('打開：file:///C:/Users/Dicky/Claude%20outputs/index.html。看 https://example.com/a.');
  const links = nodes.filter((n) => n.marks?.[0]?.type === 'link').map((n) => n.marks[0].attrs.href);
  assert.deepEqual(links, ['file:///C:/Users/Dicky/Claude%20outputs/index.html', 'https://example.com/a']);
});

test('tables, quotes, code blocks and rules', () => {
  const blocks = markdownToBlocks('| 卡 | 欠 |\n|---|---|\n| Rogers | $422.62 |\n\n> 提醒\n\n```js\nconst a = 1;\n```\n\n---');
  assert.deepEqual(blocks.map((b) => b.type), ['table', 'paragraph', 'blockquote', 'paragraph', 'codeBlock', 'paragraph', 'horizontalRule']);
  assert.equal(blocks[0].content[0].content[0].type, 'tableHeader');
  assert.equal(docText({ type: 'doc', content: [blocks[0]] }), '卡 | 欠\nRogers | $422.62');
  assert.equal(blocks[4].content[0].text, 'const a = 1;');
});

test('plain text stays plain and only Markdown-looking text is detected', () => {
  assert.deepEqual(markdownToBlocks('第一行\n第二行').map((b) => b.content[0].text), ['第一行', '第二行']);
  assert.equal(looksLikeMarkdown('今天天氣很好\n明天再說'), false);
  assert.equal(looksLikeMarkdown('## 標題\n內容'), true);
  assert.equal(looksLikeMarkdown('- [ ] 買牛奶'), true);
  assert.equal(markdownToBlocks('').length, 0);
});
