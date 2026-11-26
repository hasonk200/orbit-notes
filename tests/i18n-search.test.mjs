import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Render with a Chinese browser preference, without opening an IndexedDB database.
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['zh-HK'] } });
const vite = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
after(async () => {
  await vite.close();
  if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
  else delete globalThis.navigator;
});

const { buildNoteSearch } = await vite.ssrLoadModule('/src/lib/search.ts');
const { resolveLanguage, translators } = await vite.ssrLoadModule('/src/lib/i18n.ts');
const { dailyTitle, parseQuickDate } = await vite.ssrLoadModule('/src/lib/dates.ts');
const { parseTaskInput, appendTask } = await vite.ssrLoadModule('/src/lib/taskInput.ts');
const { docText, extractLinkIds, extractTasks, patchTaskInDoc } = await vite.ssrLoadModule('/src/lib/content.ts');
const { defaultTemplate, optionLabel, propertyLabel, typeLabel } = await vite.ssrLoadModule('/src/lib/typeLabels.ts');
const { BUILTIN_TYPES } = await vite.ssrLoadModule('/src/db/seed.ts');
const { displayTitle } = await vite.ssrLoadModule('/src/store/dataStore.ts');
const { isComposing } = await vite.ssrLoadModule('/src/lib/keyboard.ts');
const zh = translators['zh-Hant'];

test('finds unspaced Chinese text, title hits, tags, and mixed-language phrases', () => {
  const search = buildNoteSearch([
    { id: 'body', title: '日記', props: '', body: '今晚上班前去跑步半小時 Toronto', tags: '運動' },
    { id: 'title', title: '跑步計劃', props: '狀態 進行中', body: '每週三次', tags: '' },
    { id: 'finance', title: 'Funds', props: 'QQQ', body: 'Toronto 投資清單', tags: '' },
  ]);
  const ids = (query) => search(query).map((r) => r.id);
  assert.deepEqual(ids('跑步'), ['title', 'body']);
  assert.deepEqual(ids('步半'), ['body']);
  assert.deepEqual(ids('運動'), ['body']);
  assert.deepEqual(ids('進行中'), ['title']);
  assert.deepEqual(ids('跑步Toronto'), ['body']);
  assert.deepEqual(ids('跑步 投資'), []);
  assert.deepEqual(ids('ＱＱＱ'), ['finance']);
  assert.deepEqual(ids('fun'), ['finance']);
  assert.equal(search('跑步', 1).length, 1);
});

test('keeps language choice explicit and translates only built-in names and templates', () => {
  assert.equal(resolveLanguage(null, ['zh-HK', 'en']), 'zh-Hant');
  assert.equal(resolveLanguage(null, ['en-CA', 'zh-HK']), 'en');
  assert.equal(resolveLanguage('en', ['zh-HK']), 'en');
  assert.equal(resolveLanguage('zh-Hant', ['en']), 'zh-Hant');
  assert.equal(zh('New {type}: “{title}”', { type: '筆記', title: 'MY_TITLE' }), '新增筆記「MY_TITLE」');
  assert.equal(translators.en('Tasks'), 'Tasks');
  const project = BUILTIN_TYPES.find(({ id }) => id === 'project');
  const status = project.properties.find(({ key }) => key === 'status');
  assert.equal(typeLabel(project, zh), '專案');
  assert.equal(typeLabel({ ...project, id: 'mine', builtin: false }, zh), 'Project');
  assert.equal(propertyLabel(project, status, zh), '狀態');
  assert.equal(propertyLabel(project, { ...status, name: 'My status' }, zh), 'My status');
  assert.equal(optionLabel(project, status, 'Active', zh), '進行中');
  assert.match(docText(defaultTemplate(project, zh)), /下一步/);
  assert.match(docText(project.defaultTemplate), /Next steps/);
  const custom = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Goal' }] }] };
  assert.equal(defaultTemplate({ ...project, defaultTemplate: custom }, zh), custom);
});

test('accepts Chinese dates while keeping generated daily titles and custom titles distinct', () => {
  const now = new Date(2026, 10, 20, 12);
  assert.equal(parseQuickDate('聽日', now), '2026-11-21');
  assert.equal(parseQuickDate('星期一', now), '2026-11-23');
  assert.equal(parseQuickDate('next week', now), '2026-11-27');
  assert.equal(parseQuickDate('２０２６年１２月２４日', now), '2026-12-24');
  assert.equal(parseQuickDate('2026年2月30日', now), null);
  const dailyDate = '2026-11-20';
  assert.equal(displayTitle({ dailyDate, title: dailyTitle(dailyDate) }, zh), '2026年11月20日 星期五');
  assert.equal(displayTitle({ dailyDate, title: '自訂日記標題' }, zh), '自訂日記標題');
});

test('adds and updates a timed task inside its note without removing existing text or links', () => {
  const date = new Date(2026, 10, 20, 12);
  const entry = parseTaskInput('交租＠明天 !p1', date);
  assert.deepEqual(entry, { text: '交租', due: '2026-11-21', priority: 'high' });
  assert.deepEqual(parseTaskInput('Call Alex @next week', date), { text: 'Call Alex', due: '2026-11-27', priority: null });
  assert.equal(parseTaskInput('Email a@example.com', date).text, 'Email a@example.com');
  const note = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '現有內容' }, { type: 'objectLink', attrs: { id: 'daily-2026-11-20' } }] }] };
  const saved = appendTask(note, 'task-1', entry.text, entry.due, entry.priority);
  const twice = appendTask(saved, 'task-2', '另一項待辦', null, null);
  assert.equal(note.content.length, 1);
  assert.equal(twice.content.length, 2);
  assert.deepEqual(extractLinkIds(twice), ['daily-2026-11-20']);
  assert.match(docText(twice), /現有內容/);
  const completed = patchTaskInDoc(twice, 'task-1', { checked: true });
  assert.deepEqual(extractTasks(completed).map(({ id, done, due }) => [id, done, due]), [['task-1', true, '2026-11-21'], ['task-2', false, null]]);
});

test('guards keyboard shortcuts during common Chinese IME composition events', () => {
  assert.equal(isComposing({ isComposing: true, keyCode: 13 }), true);
  assert.equal(isComposing({ isComposing: false, keyCode: 229 }), true);
  assert.equal(isComposing({ isComposing: false, keyCode: 13 }), false);
});

test('adds spaces at CJK/Latin interpolation boundaries and translates filter labels', () => {
  assert.equal(zh('New {type}', { type: 'AI 文件' }), '新增 AI 文件');
  assert.equal(zh('New {type}', { type: '筆記' }), '新增筆記');
  assert.equal(zh('All {type}', { type: 'AI 日誌' }), '全部 AI 日誌');
  assert.equal(zh('Filter tasks'), '篩選任務');
});

test('renders the main screens in Traditional Chinese and handles an invalid calendar link', async () => {
  const pages = [
    ['Settings', '繁體中文', '備份與還原'],
    ['HomeView', '探索', '快速建立'],
    ['TodosView', '待辦', '隨時', '已完成紀錄'],
    ['RoutinesView', '例行任務', '每天'],
    ['TasksView', '專案任務', '狀態', '進行中'],
    ['CalendarView', '今', '未來 7 天'],
    ['TagsView', '標籤', '還沒有標籤'],
    ['TrashView', '垃圾桶', '垃圾桶沒有內容'],
  ];
  for (const [component, ...expected] of pages) {
    const module = await vite.ssrLoadModule(`/src/views/${component}.tsx`);
    const props = component === 'CalendarView' ? { mode: 'day', date: 'invalid' } : {};
    const markup = renderToStaticMarkup(createElement(module[component], props));
    for (const text of expected) assert.ok(markup.includes(text), `${component} should render ${text}`);
  }
});
