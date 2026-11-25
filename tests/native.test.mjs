import test from 'node:test';
import assert from 'node:assert/strict';
import { isCapacitor, isNativeApp, isTauri, openExternalUrl, openLocalFile } from '../src/lib/native.ts';

test('native detection returns false outside Tauri and Capacitor shells', () => {
  assert.equal(isTauri(), false);
  assert.equal(isCapacitor(), false);
  assert.equal(isNativeApp(), false);
});

test('openLocalFile and openExternalUrl safely return false in non-native environments', async () => {
  assert.equal(await openLocalFile('file:///C:/Users/Dicky/Documents/notes.txt'), false);
  assert.equal(await openExternalUrl('https://github.com/hasonk200/orbit-notes'), false);
});
