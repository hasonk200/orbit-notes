import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { toHans } from '../scripts/zh-hans.mjs';

const vite = await createServer({
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => vite.close());

const { resolveLanguage, translators, zhHant } = await vite.ssrLoadModule('/src/lib/i18n.ts');
const { zhHans } = await vite.ssrLoadModule('/src/lib/i18n.zh-Hans.ts');
const { dailyTitle } = await vite.ssrLoadModule('/src/lib/dates.ts');

test('picks Simplified Chinese for mainland and Singapore browsers, Traditional for the rest', () => {
  assert.equal(resolveLanguage(null, ['zh-CN']), 'zh-Hans');
  assert.equal(resolveLanguage(null, ['zh-Hans-CN', 'en']), 'zh-Hans');
  assert.equal(resolveLanguage(null, ['zh-SG']), 'zh-Hans');
  assert.equal(resolveLanguage(null, ['zh-TW']), 'zh-Hant');
  assert.equal(resolveLanguage(null, ['zh-HK']), 'zh-Hant');
  assert.equal(resolveLanguage(null, ['zh']), 'zh-Hant');
  assert.equal(resolveLanguage('zh-Hans', ['en']), 'zh-Hans');
});

test('the Simplified table is generated from the Traditional one and up to date (run npm run i18n:hans)', () => {
  assert.deepEqual(Object.keys(zhHans).sort(), Object.keys(zhHant).sort());
  for (const [key, value] of Object.entries(zhHant)) assert.equal(zhHans[key], toHans(value), key);
});

test('uses mainland wording and punctuation', () => {
  const zh = translators['zh-Hans'];
  assert.equal(zh('Settings'), '设置');
  assert.equal(zh('Tasks'), '项目任务');
  assert.equal(zh('Export .zip'), '导出 ZIP');
  assert.equal(zh('Sign in with Google'), '使用 Google 登录');
  assert.equal(toHans('用「資料夾」甚麼'), '用“文件夹”什么');
  assert.equal(dailyTitle('2026-11-26', zh), '2026年11月26日 星期四');
});
