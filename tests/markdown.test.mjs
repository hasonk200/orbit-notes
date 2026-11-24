import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());
const { markdownToBlocks, parseInline, looksLikeMarkdown } = await vite.ssrLoadModule('/src/lib/markdown.ts');
const { extractTasks, docText } = await vite.ssrLoadModule('/src/lib/content.ts');
const { insertMarkdown } = await vite.ssrLoadModule('/src/lib/insertMarkdown.ts');

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
  assert.deepEqual(blocks.map((b) => b.type), ['table', 'blockquote', 'codeBlock', 'horizontalRule']);
  assert.equal(blocks[0].content[0].content[0].type, 'tableHeader');
  assert.equal(docText({ type: 'doc', content: [blocks[0]] }), '卡 | 欠\nRogers | $422.62');
  assert.equal(blocks[2].content[0].text, 'const a = 1;');
});

test('plain text stays plain and only Markdown-looking text is detected', () => {
  assert.deepEqual(markdownToBlocks('第一行\n第二行').map((b) => b.content[0].text), ['第一行', '第二行']);
  assert.equal(looksLikeMarkdown('今天天氣很好\n明天再說'), false);
  assert.equal(looksLikeMarkdown('## 標題\n內容'), true);
  assert.equal(looksLikeMarkdown('- [ ] 買牛奶'), true);
  assert.equal(markdownToBlocks('').length, 0);
});

test('a code span holding only a URL becomes a link; other code stays code', () => {
  const nodes = parseInline('網址：`file:///C:/Users/Dicky/index.html` 檔案：`finance-data.js`');
  assert.deepEqual(nodes.filter((n) => n.marks).map((n) => n.marks[0].type), ['link', 'code']);
  assert.equal(nodes[1].marks[0].attrs.href, 'file:///C:/Users/Dicky/index.html');
});

test('blank lines next to rules, tables and code blocks add no extra empty line', () => {
  const blocks = markdownToBlocks('前言\n\n---\n\n## 標題\n- 項目\n\n```\ncode\n```\n\n段落');
  assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'horizontalRule', 'heading', 'bulletList', 'codeBlock', 'paragraph']);
});

const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const texts = (doc) => doc.content.map((b) => b.type + ':' + (b.content?.[0]?.text ?? b.content?.map((i) => i.content[0].content[0].text).join('|') ?? ''));

test('insertMarkdown puts new lines right after or before the anchor line, leaving the rest alone', () => {
  const doc = { type: 'doc', content: [p('⚡ 一鍵打開'), p('🛵 外送 → a'), p('💳 刷卡 → c'), p('（說明）')] };
  const after = insertMarkdown(doc, '💳 刷卡', '💊 用藥 → [打開](file:///C:/x/index.html)');
  assert.deepEqual(texts(after), ['paragraph:⚡ 一鍵打開', 'paragraph:🛵 外送 → a', 'paragraph:💳 刷卡 → c', 'paragraph:💊 用藥 → ', 'paragraph:（說明）']);
  assert.equal(after.content[3].content[1].marks[0].attrs.href, 'file:///C:/x/index.html');
  assert.equal(doc.content.length, 4, 'the original document is not changed');
  const before = insertMarkdown(doc, '一鍵打開', '## 標題', 'before');
  assert.equal(before.content[0].type, 'heading');
});

test('insertMarkdown joins list items to the anchor item’s list, and places other blocks beside the list', () => {
  const item = (text) => ({ type: 'listItem', content: [p(text)] });
  const doc = { type: 'doc', content: [{ type: 'bulletList', content: [item('一'), item('二'), item('三')] }, p('後記')] };
  const joined = insertMarkdown(doc, '二', '- 二點五\n- 二點六');
  assert.deepEqual(texts(joined), ['bulletList:一|二|二點五|二點六|三', 'paragraph:後記']);
  const beside = insertMarkdown(doc, '二', '一段文字');
  assert.deepEqual(texts(beside), ['bulletList:一|二|三', 'paragraph:一段文字', 'paragraph:後記']);
  const tasks = insertMarkdown({ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('付帳單')] }] }] }, '付帳單', '- [ ] 交房租', 'before');
  assert.equal(tasks.content[0].content.length, 2);
  assert.equal(tasks.content[0].content[0].content[0].content[0].text, '交房租');
});

test('insertMarkdown refuses missing, repeated or empty input', () => {
  const doc = { type: 'doc', content: [p('甲 重複'), p('乙 重複')] };
  assert.throws(() => insertMarkdown(doc, '丙', 'x'), /not-found/);
  assert.throws(() => insertMarkdown(doc, '重複', 'x'), /ambiguous/);
  assert.throws(() => insertMarkdown(doc, '甲', '   '), /empty/);
});
