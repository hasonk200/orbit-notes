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

const { planNote, planRecord, parseRemote, emptyRemote, blobFile, splitKey } = await vite.ssrLoadModule('/src/sync/webdavPlan.ts');
const { basicAuth, folderUrl } = await vite.ssrLoadModule('/src/sync/webdavHttp.ts');

test('notes: three-way check keeps both edits', () => {
  const rec = (hash) => ({ ts: 1, hash, json: '{}' });
  assert.equal(planNote('a', undefined, undefined), 'upload'); // new here
  assert.equal(planNote(null, rec('a'), undefined), 'download'); // new there
  assert.equal(planNote('a', rec('a'), undefined), 'same');
  assert.equal(planNote('b', rec('a'), { local: 'a', cloud: 'a' }), 'upload'); // edited here
  assert.equal(planNote('a', rec('b'), { local: 'a', cloud: 'a' }), 'download'); // edited there
  assert.equal(planNote('b', rec('c'), { local: 'a', cloud: 'a' }), 'conflict'); // edited on both
  assert.equal(planNote('a', undefined, undefined), 'upload');
  assert.equal(planNote(null, { ts: 2, deleted: true }, { local: 'a', cloud: 'a' }), 'same'); // deleted on both
  assert.equal(planNote(null, rec('a'), { local: 'a', cloud: 'a' }), 'upload'); // deleted here → tombstone
  assert.equal(planNote('a', { ts: 2, deleted: true }, { local: 'a', cloud: 'a' }), 'download'); // deleted there
  assert.equal(planNote('b', { ts: 2, deleted: true }, { local: 'a', cloud: 'a' }), 'conflict'); // edited here, deleted there: keep a copy
});

test('other records: newer wins, deletions travel as tombstones', () => {
  assert.equal(planRecord(5, undefined, undefined), 'upload');
  assert.equal(planRecord(5, { ts: 3, json: '{}' }, 3), 'upload');
  assert.equal(planRecord(3, { ts: 5, json: '{}' }, 3), 'download');
  assert.equal(planRecord(5, { ts: 5, json: '{}' }, 5), 'none');
  assert.equal(planRecord(5, { ts: 9, deleted: true }, 5), 'delete-local');
  assert.equal(planRecord(9, { ts: 5, deleted: true }, 5), 'upload'); // edited after the other device deleted it
  assert.equal(planRecord(null, { ts: 5, json: '{}' }, 5), 'upload-tombstone'); // deleted here
  assert.equal(planRecord(null, { ts: 7, json: '{}' }, 5), 'download'); // deleted here, but changed there since
  assert.equal(planRecord(null, { ts: 5, json: '{}' }, undefined), 'download'); // new there
  assert.equal(planRecord(null, { ts: 5, deleted: true }, undefined), 'none');
});

test('data file, names and credentials', () => {
  assert.deepEqual(parseRemote(null), emptyRemote());
  assert.throws(() => parseRemote('{"hello":1}'), /isn’t Orbit sync data/);
  assert.equal(parseRemote(JSON.stringify({ ...emptyRemote(), records: { 'objects/a': { ts: 1 } } })).records['objects/a'].ts, 1);
  assert.equal(folderUrl('https://dav.jianguoyun.com/dav/', 'Orbit'), 'https://dav.jianguoyun.com/dav/Orbit/');
  assert.equal(folderUrl('https://dav.jianguoyun.com/dav', '/我的笔记/Orbit/'), 'https://dav.jianguoyun.com/dav/%E6%88%91%E7%9A%84%E7%AC%94%E8%AE%B0/Orbit/');
  assert.equal(blobFile('img 1/2'), 'blob-img%201%2F2.txt');
  assert.deepEqual(splitKey('meta/routine-a/b'), ['meta', 'routine-a/b']);
  assert.equal(basicAuth('me@例子.com', 'pässword'), `Basic ${Buffer.from('me@例子.com:pässword').toString('base64')}`);
});
