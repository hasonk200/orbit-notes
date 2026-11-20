import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import JSZip from 'jszip';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => vite.close());
const { readBackupZip } = await vite.ssrLoadModule('/src/db/backup.ts');
const { chooseObjectSync, objectFingerprint, DELETED_OBJECT } = await vite.ssrLoadModule('/src/sync/objectVersions.ts');
const { registerDraft, flushDrafts } = await vite.ssrLoadModule('/src/db/drafts.ts');
const { compareCollections } = await vite.ssrLoadModule('/src/sync/collections.ts');

const note = { id: 'note-1', title: 'Journal', typeId: 'page', props: {}, content: { type: 'doc' }, tags: [], createdAt: 1, updatedAt: 2 };
const blob = { id: 'picture-1', file: 'media/picture-1.png', mimeType: 'image/png', size: 3, createdAt: 1 };

async function archive(overrides, media = {}) {
  const zip = new JSZip();
  zip.file('data.json', JSON.stringify({ app: 'orbit', objects: [note], ...overrides }));
  for (const [path, bytes] of Object.entries(media)) zip.file(path, Uint8Array.from(bytes));
  return new Blob([await zip.generateAsync({ type: 'uint8array' })]);
}

test('reads a legacy ZIP and preserves collection and attachment data', async () => {
  const legacy = await readBackupZip(await archive({}));
  assert.deepEqual(legacy.objects, [note]);
  assert.deepEqual(legacy.collections, []);

  const collection = { id: 'col', name: 'Trips', typeId: 'page', createdAt: 1, order: 0 };
  const result = await readBackupZip(await archive({
    schemaVersion: 2, collections: [collection], objects: [{ ...note, cover: blob.id }], blobs: [blob],
  }, { [blob.file]: [1, 2, 3] }));
  assert.deepEqual(result.collections, [collection]);
  assert.deepEqual(new Uint8Array(await result.blobs[0].data.arrayBuffer()), Uint8Array.of(1, 2, 3));
});

test('rejects backups with missing, truncated, or undeclared images', async () => {
  await assert.rejects(readBackupZip(await archive({ blobs: [blob] })), /missing image picture-1/);
  await assert.rejects(readBackupZip(await archive({ blobs: [blob] }, { [blob.file]: [1] })), /incomplete image/);
  await assert.rejects(readBackupZip(await archive({ objects: [{ ...note, cover: blob.id }] })), /missing referenced image/);
  await assert.rejects(readBackupZip(await archive({ objects: [note, note] })), /duplicate objects/);
});

test('recognizes two offline edits and a single-device change using the previous synced version', async () => {
  const baseHash = await objectFingerprint(note);
  const base = { local: baseHash, cloud: baseHash };
  const phone = await objectFingerprint({ ...note, title: 'New title', updatedAt: 5 });
  const desktop = await objectFingerprint({ ...note, content: { type: 'doc', content: [{ type: 'paragraph' }] }, updatedAt: 6 });
  assert.equal(chooseObjectSync(phone, baseHash, base), 'upload');
  assert.equal(chooseObjectSync(baseHash, desktop, base), 'download');
  assert.equal(chooseObjectSync(phone, desktop, base), 'conflict');
  assert.equal(chooseObjectSync(phone, phone, base), 'same');
});

test('handles new devices, timestamps, and edits that race with deletion', async () => {
  const a = await objectFingerprint({ ...note, props: { b: 2, a: 1 } });
  const b = await objectFingerprint({ ...note, updatedAt: 30, props: { a: 1, b: 2 } });
  const base = { local: a, cloud: a };
  assert.equal(a, b);
  assert.equal(chooseObjectSync(null, b), 'download');
  assert.equal(chooseObjectSync(a, null), 'upload');
  assert.equal(chooseObjectSync('local edit', b), 'conflict');
  assert.equal(chooseObjectSync(null, b, base), 'upload');
  assert.equal(chooseObjectSync('local edit', DELETED_OBJECT, base), 'conflict');
  assert.equal(chooseObjectSync(null, 'remote edit', base), 'download');
  assert.equal(chooseObjectSync(null, DELETED_OBJECT, base), 'same');
});

test('waits for both draft fields before syncing the current note', async () => {
  const saved = [];
  const releaseTitle = registerDraft('note-1', async () => { saved.push('title'); });
  const releaseContent = registerDraft('note-1', async () => { saved.push('body'); });
  const releaseOther = registerDraft('note-2', async () => { saved.push('other'); });
  await flushDrafts('note-1');
  assert.deepEqual(saved, ['title', 'body']);
  releaseTitle();
  releaseContent();
  releaseOther();
  await flushDrafts('note-1');
  assert.deepEqual(saved, ['title', 'body']);
});

test('sync picks collection renames and persistent deletions on older data', () => {
  const old = { id: 'saved', name: 'Trips', typeId: 'page', order: 0, createdAt: 1 };
  const renamed = { ...old, name: 'Travel', updatedAt: 2 };
  const deleted = { ...renamed, deletedAt: 2 };
  assert.ok(compareCollections(renamed, old) > 0);
  assert.ok(compareCollections(deleted, renamed) > 0);
  assert.ok(compareCollections(old, deleted) < 0);
  assert.equal(compareCollections(deleted, { ...deleted }), 0);
});
