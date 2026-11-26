import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());
const { markdownToBlocks, blocksToMarkdown, parseInline, looksLikeMarkdown, isAllowedLinkUrl, MARKDOWN_LINK_INPUT_RE } = await vite.ssrLoadModule('/src/lib/markdown.ts');
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

test('emphasis markers inside code spans do not close bold or italic', () => {
  const nodes = parseInline('**不要在 `**` 的內側留空格**。`** 文字 **` 不會變粗體，*斜體 `*` 也是*');
  const view = nodes.map((n) => (n.marks ?? []).map((m) => m.type).join('+') + ':' + n.text);
  assert.deepEqual(view, ['bold:不要在 ', 'code:**', 'bold: 的內側留空格', ':。', 'code:** 文字 **', ': 不會變粗體，', 'italic:斜體 ', 'code:*', 'italic: 也是']);
});

// ---------- markdown-it based converter: cases that broke the hand-written one ----------
const marked = (nodes, type) => nodes.filter((n) => n.marks?.some((m) => m.type === type)).map((n) => n.text);
const hrefs = (nodes) => nodes.flatMap((n) => (n.marks ?? []).filter((m) => m.type === 'link').map((m) => m.attrs.href));
const blockTypes = (blocks) => blocks.map((b) => b.type);

test('bold next to Chinese punctuation works (CJK-friendly emphasis)', () => {
  const nodes = parseInline('這是一份**「這個網站是怎麼運作的？」的說明手冊**。把**「截圖」＋「data.js」**丟給 AI。');
  assert.deepEqual(marked(nodes, 'bold'), ['「這個網站是怎麼運作的？」的說明手冊', '「截圖」＋「data.js」']);
});

test('bold wrapping code keeps the code; addresses with brackets stay whole', () => {
  assert.deepEqual(marked(parseInline('**`index.html`** 和 **核心資料檔**（所有數字）'), 'code'), ['index.html']);
  const nodes = parseInline('[維基](https://en.wikipedia.org/wiki/Foo_(bar)) 和 https://en.wikipedia.org/wiki/Foo_(bar) 還有（https://example.com）(see https://example.org/a)');
  assert.deepEqual(hrefs(nodes), ['https://en.wikipedia.org/wiki/Foo_(bar)', 'https://en.wikipedia.org/wiki/Foo_(bar)', 'https://example.com', 'https://example.org/a']);
});

test('file names are not mistaken for web addresses, and unsafe links are refused', () => {
  assert.deepEqual(hrefs(parseInline('dicky-finance-tracker.md 和 update.bat、www.example.com')), []);
  assert.deepEqual(hrefs(parseInline('[x](javascript:alert(1))')), []);
  assert.deepEqual(hrefs(parseInline('[x](data:text/html,hi) [y](ftp://example.com)')), []);
  assert.deepEqual(hrefs(parseInline('![截圖](https://example.com/a.png)')), ['https://example.com/a.png']);
});

test('isAllowedLinkUrl and live link input rule enforce http/https/mailto/file allowlist', () => {
  assert.equal(isAllowedLinkUrl('https://google.com'), true);
  assert.equal(isAllowedLinkUrl('http://localhost:5175'), true);
  assert.equal(isAllowedLinkUrl('mailto:a@b.com'), true);
  assert.equal(isAllowedLinkUrl('file:///C:/Users/Dicky/notes.md'), true);
  assert.equal(isAllowedLinkUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedLinkUrl('data:text/html,<script>'), false);
  assert.equal(isAllowedLinkUrl('vbscript:msgbox(1)'), false);
  assert.equal(isAllowedLinkUrl('ftp://example.com/a'), false);
  assert.equal(isAllowedLinkUrl('example.com'), false);

  const matchUrl = (s) => s.match(MARKDOWN_LINK_INPUT_RE)?.slice(1, 3) ?? null;
  assert.deepEqual(matchUrl('看 [Google](https://google.com) '), ['Google', 'https://google.com']);
  assert.deepEqual(matchUrl('[Wiki](https://en.wikipedia.org/wiki/Foo_(bar)) '), ['Wiki', 'https://en.wikipedia.org/wiki/Foo_(bar)']);
  assert.deepEqual(matchUrl('[檔](file:///C:/a.md) '), ['檔', 'file:///C:/a.md']);
  assert.deepEqual(matchUrl('[信](mailto:a@b.com) '), ['信', 'mailto:a@b.com']);
  assert.equal(matchUrl('[bad](javascript:alert(1)) '), null);
});

test('nested lists keep their levels, and to-dos split into their own list', () => {
  const blocks = markdownToBlocks('- 一\n  - 二\n    - 三\n  1. 甲\n  2. 乙\n- [ ] 待辦\n  - 子項目');
  assert.deepEqual(blockTypes(blocks), ['bulletList', 'taskList']);
  const one = blocks[0].content[0];
  assert.deepEqual(blockTypes(one.content), ['paragraph', 'bulletList', 'orderedList']);
  assert.equal(one.content[1].content[0].content[1].content[0].content[0].content[0].text, '三');
  assert.equal(blocks[1].content[0].content[1].type, 'bulletList');
});

test('note habits: lines stay lines, and text after a list or quote is not swallowed', () => {
  assert.deepEqual(blockTypes(markdownToBlocks('- 甲\n說明文字')), ['bulletList', 'paragraph']);
  assert.deepEqual(blockTypes(markdownToBlocks('> 引用\n下一行')), ['blockquote', 'paragraph']);
  assert.deepEqual(blockTypes(markdownToBlocks('前言\n---')), ['paragraph', 'horizontalRule']);
  const numbered = markdownToBlocks('規則：\n2. 第二點');
  assert.deepEqual(blockTypes(numbered), ['paragraph', 'orderedList']);
  assert.equal(numbered[1].attrs.start, 2);
  assert.equal(markdownToBlocks('- 第一行\n  第二行')[0].content[0].content.length, 2);
  const quote = markdownToBlocks('> 你負責更新。  \n> 規則：  \n> 1. 只改數字');
  assert.deepEqual(blockTypes(quote[0].content), ['paragraph', 'paragraph', 'orderedList']);
  assert.deepEqual(blockTypes(markdownToBlocks('• 甲\n• 乙')), ['bulletList']);
  assert.deepEqual(blockTypes(markdownToBlocks('✅ 已經裝好')), ['paragraph']);
});

test('a full manual-style document converts block by block', async () => {
  const { readFile } = await import('node:fs/promises');
  const blocks = markdownToBlocks(await readFile(new URL('./fixtures/manual-style.md', import.meta.url), 'utf8'));
  assert.deepEqual(blockTypes(blocks), [
    'paragraph', 'horizontalRule', 'heading', 'blockquote', 'horizontalRule',
    'heading', 'bulletList', 'horizontalRule',
    'heading', 'paragraph', 'table', 'heading', 'orderedList', 'horizontalRule',
    'heading', 'codeBlock', 'orderedList', 'horizontalRule',
    'heading', 'blockquote', 'heading', 'taskList',
  ]);
  assert.deepEqual(marked(blocks[0].content, 'bold'), ['「這個網站是怎麼運作的？我之後要怎麼維護它？」的說明手冊']);
  assert.deepEqual(hrefs(blocks[6].content.flatMap((i) => i.content[0].content)), ['file:///C:/Users/Demo/Documents/My%20Site/index.html', 'https://en.wikipedia.org/wiki/Foo_(bar)']);
  const table = blocks[10];
  assert.equal(table.content.length, 4);
  assert.deepEqual(table.content[1].content[0].content[0].content.map((n) => n.marks?.[0]?.type), ['code']);
  const prompt = blocks[19].content;
  assert.deepEqual(blockTypes(prompt), ['paragraph', 'paragraph', 'paragraph', 'paragraph', 'orderedList']);
  assert.deepEqual(blocks[21].content.map((t) => t.attrs.checked), [false, true]);
  assert.equal(blocks[16].content[1].content[1].content[0].content[0].content[0].marks[0].type, 'italic');
});

test('blocksToMarkdown round-trips headings, tasks, links, code blocks, and tables cleanly', () => {
  const src = [
    '# 本地 Markdown 測試',
    '',
    '普通段落包含 **粗體**、`code`、[網站](https://example.com) 同 [本地檔](file:///C:/notes/a.md)。',
    '',
    '- [ ] 未完成事項',
    '- [x] 已完成事項',
    '',
    '```ts',
    'const x = 1;',
    '```',
    '',
    '| 欄A | 欄B |',
    '| --- | --- |',
    '| 1 | 2 |',
  ].join('\n');
  const blocks = markdownToBlocks(src);
  const out = blocksToMarkdown(blocks);
  const blocksAgain = markdownToBlocks(out);
  assert.deepEqual(blockTypes(blocksAgain), blockTypes(blocks));
  assert.deepEqual(
    hrefs(blocksAgain[1].content),
    ['https://example.com', 'file:///C:/notes/a.md'],
  );
  assert.deepEqual(blocksAgain[3].content.map((t) => t.attrs.checked), [false, true]);
  assert.match(out, /```ts\nconst x = 1;\n```/);
  assert.match(out, /\| 欄A \| 欄B \|/);
});

test('loose bold markers with inner spaces render cleanly while code spans stay untouched', () => {
  const line1 = parseInline('**0.1 交 HKBN 欠單 ** HK$327.28');
  assert.deepEqual(marked(line1, 'bold'), ['0.1 交 HKBN 欠單']);

  const line2 = parseInline('2026/11/30 ** 截止**');
  assert.deepEqual(marked(line2, 'bold'), ['截止']);

  const line3 = parseInline('**1.1 私訊 ** moon');
  assert.deepEqual(marked(line3, 'bold'), ['1.1 私訊']);

  const line4 = parseInline('sadfeiching ** 同 Kenj 按日拆 $46.16 / $109.84 )**');
  assert.deepEqual(marked(line4, 'bold'), ['同 Kenj 按日拆 $46.16 / $109.84 )']);

  // Inline code spans containing ** with spaces must not be altered
  const codeSafe = parseInline('**不要在 `**` 的內側留空格**。`** 文字 **` 保留原樣');
  assert.deepEqual(marked(codeSafe, 'code'), ['**', '** 文字 **']);

  const taskBlocks = markdownToBlocks('- [ ] **0.1 交 HKBN 欠單 ** HK$327.28\n- [ ] **0.2 TG 先覆一句 **');
  assert.equal(taskBlocks[0].type, 'taskList');
  assert.deepEqual(marked(taskBlocks[0].content[0].content[0].content, 'bold'), ['0.1 交 HKBN 欠單']);
});

test(':::block superblock parses and round-trips with flags, title, and nested tasks', () => {
  const src = [
    ':::block [collapsed] 階段 0：今日只做呢 3 件小事',
    '',
    '### 細項',
    '',
    '- [ ] **0.1 交 HKBN 欠單 ** HK$327.28',
    '- [x] 0.2 TG 先覆一句',
    ':::',
    '',
    ':::block [ungrouped] 不合併待辦的群組',
    '- [ ] 獨立顯示',
    ':::',
  ].join('\n');

  const blocks = markdownToBlocks(src);
  assert.deepEqual(blockTypes(blocks), ['blockGroup', 'blockGroup']);
  assert.equal(blocks[0].attrs.title, '階段 0：今日只做呢 3 件小事');
  assert.equal(blocks[0].attrs.collapsed, true);
  assert.equal(blocks[0].attrs.groupTasks, true);
  assert.ok(blocks[0].attrs.groupId);
  assert.equal(blocks[1].attrs.collapsed, false);
  assert.equal(blocks[1].attrs.groupTasks, false);

  const out = blocksToMarkdown(blocks);
  assert.match(out, /^:::block \[collapsed\] 階段 0：今日只做呢 3 件小事/m);
  assert.match(out, /^:::block \[ungrouped\] 不合併待辦的群組/m);

  const again = markdownToBlocks(out);
  assert.deepEqual(blockTypes(again), ['blockGroup', 'blockGroup']);
  assert.equal(again[0].attrs.title, '階段 0：今日只做呢 3 件小事');
  assert.equal(again[0].attrs.collapsed, true);
  assert.equal(again[1].attrs.groupTasks, false);
});
