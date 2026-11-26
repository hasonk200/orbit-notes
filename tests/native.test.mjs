import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureMarkdownExt,
  fileNameFromPath,
  isCapacitor,
  isNativeApp,
  isTauri,
  openExternalUrl,
  openLocalFile,
  parseDesktopAuthParams,
  suggestCopyPath,
} from '../src/lib/native.ts';

test('native detection returns false outside Tauri and Capacitor shells', () => {
  assert.equal(isTauri(), false);
  assert.equal(isCapacitor(), false);
  assert.equal(isNativeApp(), false);
});

test('openLocalFile and openExternalUrl safely return false in non-native environments', async () => {
  assert.equal(await openLocalFile('file:///C:/Users/Dicky/Documents/notes.txt'), false);
  assert.equal(await openExternalUrl('https://github.com/hasonk200/orbit-notes'), false);
});

test('parseDesktopAuthParams validates loopback port and hex state token', () => {
  assert.deepEqual(
    parseDesktopAuthParams('?port=54321&state=0123456789abcdef0123456789abcdef'),
    { port: 54321, state: '0123456789abcdef0123456789abcdef' },
  );
  assert.equal(parseDesktopAuthParams('?port=80&state=0123456789abcdef0123456789abcdef'), null);
  assert.equal(parseDesktopAuthParams('?port=70000&state=0123456789abcdef0123456789abcdef'), null);
  assert.equal(parseDesktopAuthParams('?port=54321&state=short'), null);
  assert.equal(parseDesktopAuthParams('?port=54321&state=zzzzzzzzzzzzzzzz'), null);
});

test('fileNameFromPath, suggestCopyPath, and ensureMarkdownExt handle Windows/Unix paths', () => {
  assert.equal(fileNameFromPath('C:\\Users\\Dicky\\Docs\\notes.md'), 'notes.md');
  assert.equal(fileNameFromPath('/home/dicky/readme.markdown'), 'readme.markdown');
  assert.equal(suggestCopyPath('C:\\Docs\\notes.md'), 'C:\\Docs\\notes-copy.md');
  assert.equal(suggestCopyPath('C:\\Docs\\notes.markdown'), 'C:\\Docs\\notes-copy.markdown');
  assert.equal(ensureMarkdownExt('C:\\Docs\\draft'), 'C:\\Docs\\draft.md');
  assert.equal(ensureMarkdownExt('C:\\Docs\\draft.md'), 'C:\\Docs\\draft.md');
});
