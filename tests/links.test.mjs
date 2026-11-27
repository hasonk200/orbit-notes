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

const { noteWebUrl } = await vite.ssrLoadModule('/src/mobile/copyLink.ts');

test('copied note links open on the Orbit website, also from the desktop and phone apps', () => {
  // The apps run from an internal address that nobody else can open.
  assert.equal(noteWebUrl('abc', true, 'https://localhost', '/'), 'https://hasonk200.github.io/orbit-notes/o/abc');
  assert.equal(noteWebUrl('daily-2026-11-26', true, 'tauri://localhost', '/'), 'https://hasonk200.github.io/orbit-notes/calendar?mode=day&date=2026-11-26');
  // The website keeps its own address (and the dev server its own).
  assert.equal(noteWebUrl('abc', false, 'https://hasonk200.github.io', '/orbit-notes/'), 'https://hasonk200.github.io/orbit-notes/o/abc');
  assert.equal(noteWebUrl('abc', false, 'http://localhost:5173', '/'), 'http://localhost:5173/o/abc');
});
