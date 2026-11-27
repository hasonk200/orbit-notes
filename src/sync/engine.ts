/**
 * Two-way sync between the local Dexie database and Firestore.
 *
 * Layout: users/{uid}/{objects|types|collections|blobs|meta}/{id}
 * Notes use a last-synced version to detect conflicting edits. Other records
 * resolve by updatedAt. TipTap documents are stored as JSON strings.
 * Links, tasks and tags are derived data: they are rebuilt locally, never synced.
 */
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, doc, onSnapshot, writeBatch, type Unsubscribe } from 'firebase/firestore';
import { db, type BlobRec, type ObjType } from '../db/schema';
import { fb, firebaseConfigured } from './firebase';
import { syncObject } from './objects';
import { syncCollection } from './collections';
import { isRoutineMetaKey, type RoutineRec } from '../lib/routines';

type BatchedCollection = 'types' | 'blobs' | 'meta';
type Coll = 'objects' | 'collections' | BatchedCollection;
const COLLS: Coll[] = ['types', 'collections', 'blobs', 'meta', 'objects'];
const MAX_BLOB_BYTES = 700 * 1024; // base64 must fit in a 1 MiB Firestore document

import { useSync, type SyncState, type SyncStatus } from './state';
export { useSync, type SyncStatus };


const remote = new Map<string, { ts: number; deleted: boolean }>();
const pending = new Set<string>();
let uid: string | null = null;
let unsubs: Unsubscribe[] = [];
let flushTimer = 0;
let flushing = false;
let ready = false;
let session = 0;

const key = (c: Coll, id: string) => `${c}/${id}`;
const split = (k: string) => k.split(/\/(.*)/s).slice(0, 2) as [Coll, string];

function setStatus(s: Partial<SyncState>) {
  useSync.setState(s);
}

// ---------- local record helpers ----------

async function readLocal(c: BatchedCollection, id: string, full = true): Promise<{ ts: number; payload: Record<string, any> } | null> {
  if (c === 'types') {
    const t = await db.types.get(id);
    return t ? { ts: t.updatedAt ?? 0, payload: { json: JSON.stringify(t) } } : null;
  }
  if (c === 'blobs') {
    const b = await db.blobs.get(id);
    if (!b) return null;
    const { data, ...meta } = b;
    if (!full) return { ts: b.createdAt, payload: { size: data.size } };
    return { ts: b.createdAt, payload: { json: JSON.stringify(meta), data: await blobToBase64(data), size: data.size } };
  }
  // meta: pinned list + recurring routines (`routine-*`) are synced
  if (isRoutineMetaKey(id)) {
    const row = await db.meta.get(id);
    const rec = row?.value as RoutineRec | undefined;
    return rec ? { ts: rec.updatedAt ?? 0, payload: { json: JSON.stringify(rec) } } : null;
  }
  if (id !== 'pinned') return null;
  const [pinned, ts] = await Promise.all([db.meta.get('pinned'), db.meta.get('pinnedUpdatedAt')]);
  if (!pinned) return null;
  return { ts: (ts?.value as number) ?? 0, payload: { json: JSON.stringify(pinned.value ?? []) } };
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

function base64ToBlob(b64: string, type: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// ---------- push ----------

export function schedule(c: Coll, id: string) {
  if (!uid) return;
  pending.add(key(c, id));
  if (!ready || flushing || !navigator.onLine) return;
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flush(), 800);
}

async function flush() {
  if (!uid || !ready || flushing || !navigator.onLine) return;
  flushing = true;
  window.clearTimeout(flushTimer);
  const keys = [...pending];
  pending.clear();
  const { fs } = fb();
  const userUid = uid;
  const currentSession = session;
  const isCurrent = () => session === currentSession;
  let retryDelay = 800;
  try {
    let batch = writeBatch(fs);
    let n = 0;
    let bytes = 0;
    const committed: [string, { ts: number; deleted: boolean }][] = [];
    const skipped = new Set(useSync.getState().skipped);
    const commit = async () => {
      if (!n) return;
      await batch.commit();
      if (!isCurrent()) return;
      for (const [k, v] of committed) remote.set(k, v);
      committed.length = 0;
      batch = writeBatch(fs);
      n = 0;
      bytes = 0;
    };
    for (const k of keys) {
      const [c, id] = split(k);
      if (c === 'objects' || c === 'collections') continue;
      let local = await readLocal(c, id, false);
      if (!isCurrent()) return;
      const r = remote.get(k);
      const ref = doc(fs, 'users', userUid, c, id);
      if (!local) {
        // deleted locally → tombstone, unless the cloud already has it deleted
        if (r && !r.deleted) {
          if (n >= 400) await commit();
          if (!isCurrent()) return;
          const ts = Date.now();
          batch.set(ref, { deleted: true, updatedAt: ts });
          committed.push([k, { ts, deleted: true }]);
          n++;
        }
      } else if (!r || local.ts > r.ts) {
        if (c === 'blobs') {
          if ((local.payload.size as number) > MAX_BLOB_BYTES) {
            skipped.add(k);
            continue;
          }
          local = await readLocal(c, id, true);
          if (!local || !isCurrent()) continue;
          skipped.delete(k);
        }
        const size = String(local.payload.json).length + String(local.payload.data ?? '').length;
        if (n >= 400 || bytes + size > 8 * 1024 * 1024) await commit();
        if (!isCurrent()) return;
        batch.set(ref, { ...local.payload, updatedAt: local.ts, deleted: false });
        committed.push([k, { ts: local.ts, deleted: false }]);
        n++;
        bytes += size;
      }
    }
    if (!isCurrent()) return;
    await commit();
    if (!isCurrent()) return;

    const records = keys.filter((k) => k.startsWith('objects/') || k.startsWith('collections/'));
    let failure: string | null = null;
    for (let i = 0; i < records.length && isCurrent(); i += 8) {
      const group = records.slice(i, i + 8);
      const results = await Promise.allSettled(group.map((k) => {
        const [collection, id] = split(k);
        const sync = collection === 'objects' ? syncObject : syncCollection;
        return sync(fs, userUid, id, isCurrent);
      }));
      if (!isCurrent()) return;
      results.forEach((result, j) => {
        if (result.status === 'rejected') {
          pending.add(group[j]);
          failure ??= result.reason?.message ?? String(result.reason);
        }
      });
    }
    if (!isCurrent()) return;
    if (failure) retryDelay = 15000;
    setStatus({
      skipped: [...skipped], lastSyncAt: Date.now(), error: failure,
      status: !navigator.onLine ? 'offline' : failure ? 'error' : pending.size ? 'syncing' : 'synced',
    });
  } catch (e: any) {
    if (!isCurrent()) return;
    // put keys back so the next attempt retries them
    keys.forEach((k) => pending.add(k));
    setStatus({ status: navigator.onLine ? 'error' : 'offline', error: e?.message ?? String(e) });
    retryDelay = 15000;
  } finally {
    flushing = false;
    if (ready && pending.size && navigator.onLine) {
      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => void flush(), retryDelay);
    }
  }
}

// ---------- pull ----------

async function applyRemote(c: BatchedCollection, changes: { id: string; data: any }[], isCurrent: () => boolean) {
  for (const { id, data } of changes) {
    if (!isCurrent()) return;
    const ts = Number(data.updatedAt ?? 0);
    const deleted = !!data.deleted;
    remote.set(key(c, id), { ts, deleted });
    const local = await readLocal(c, id, false);
    if (!isCurrent()) return;
    if (deleted) {
      if (!local || local.ts > ts) continue;
      if (c === 'types') await db.types.delete(id);
      else if (c === 'blobs') await db.blobs.delete(id);
      else if (c === 'meta' && isRoutineMetaKey(id)) await db.meta.delete(id);
      continue;
    }
    if (local && local.ts >= ts) continue;
    try {
      if (c === 'types') await db.types.put(JSON.parse(data.json) as ObjType);
      else if (c === 'blobs') {
        const meta = JSON.parse(data.json);
        await db.blobs.put({ ...meta, data: base64ToBlob(data.data ?? '', meta.mimeType) } as BlobRec);
      } else if (c === 'meta' && id === 'pinned') {
        await db.meta.bulkPut([
          { key: 'pinned', value: JSON.parse(data.json) },
          { key: 'pinnedUpdatedAt', value: ts },
        ]);
      } else if (c === 'meta' && isRoutineMetaKey(id)) {
        await db.meta.put({ key: id, value: JSON.parse(data.json) as RoutineRec });
      }
    } catch (e) {
      console.warn('Orbit sync: could not apply', c, id, e);
    }
  }
}

async function reconcileAll() {
  const account = uid;
  const currentSession = session;
  if (!account) return;
  const [objs, types, collections, blobs, bases, metaKeys] = await Promise.all([
    db.objects.toCollection().primaryKeys(), db.types.toCollection().primaryKeys(),
    db.collections.toCollection().primaryKeys(), db.blobs.toCollection().primaryKeys(),
    db.objectSyncBases.where('account').equals(account).toArray(),
    db.meta.toCollection().primaryKeys(),
  ]);
  if (session !== currentSession) return;
  objs.forEach((id) => pending.add(key('objects', String(id))));
  // A locally removed note can still need a tombstone after an offline restart.
  bases.filter((base) => base.local !== null).forEach((base) => pending.add(key('objects', base.objectId)));
  types.forEach((id) => pending.add(key('types', String(id))));
  collections.forEach((id) => pending.add(key('collections', String(id))));
  blobs.forEach((id) => pending.add(key('blobs', String(id))));
  metaKeys.filter((k) => isRoutineMetaKey(k)).forEach((k) => pending.add(key('meta', String(k))));
  pending.add(key('meta', 'pinned'));
  await flush();
}

function start(user: User) {
  stop();
  uid = user.uid;
  const currentSession = session;
  const isCurrent = () => currentSession === session;
  ready = false;
  remote.clear();
  setStatus({
    status: 'connecting',
    error: null,
    skipped: [],
    lastSyncAt: null,
    user: { uid: user.uid, email: user.email, name: user.displayName, photo: user.photoURL },
  });
  const { fs } = fb();
  const firstSeen = new Set<Coll>();
  // apply snapshots one at a time so local writes never interleave
  let chain = Promise.resolve();
  for (const c of COLLS) {
    const unsub = onSnapshot(
      collection(fs, 'users', user.uid, c),
      { includeMetadataChanges: true },
      (snap) => {
        if (!isCurrent()) return;
        if (snap.metadata.fromCache) {
          if (!navigator.onLine) setStatus({ status: 'offline' });
          return;
        }
        chain = chain.then(async () => {
          if (!isCurrent()) return;
          const initial = !firstSeen.has(c);
          const changes = initial ? snap.docs.map((doc) => ({ doc, type: 'added' })) : snap.docChanges();
          const committed = changes.filter(({ doc }) => !doc.metadata.hasPendingWrites);
          if (c === 'objects' || c === 'collections') {
            committed.forEach(({ doc }) => schedule(c, doc.id));
          } else {
            await applyRemote(c, committed.filter((change) => change.type !== 'removed').map(({ doc }) => ({ id: doc.id, data: doc.data() })), isCurrent);
          }
          if (!isCurrent()) return;
          if (!firstSeen.has(c)) {
            firstSeen.add(c);
            if (firstSeen.size === COLLS.length) {
              ready = true;
              setStatus({ status: 'syncing' });
              void reconcileAll().catch(reportError);
            }
          }
        }).catch(reportError);
      },
      reportError,
    );
    unsubs.push(unsub);
  }
  function reportError(error: unknown) {
    if (isCurrent()) setStatus({ status: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}

function stop() {
  session++;
  unsubs.forEach((u) => u());
  unsubs = [];
  uid = null;
  ready = false;
  pending.clear();
  window.clearTimeout(flushTimer);
}

let installed = false;

/** Call once at startup. Hooks local writes and follows the Firebase sign-in state. */
export function initSync() {
  if (installed || !firebaseConfigured) return;
  installed = true;

  const watch = (c: Coll, table: any) => {
    table.hook('creating', (pk: any) => void schedule(c, String(pk)));
    table.hook('updating', (_mods: any, pk: any) => void schedule(c, String(pk)));
    table.hook('deleting', (pk: any) => void schedule(c, String(pk)));
  };
  watch('objects', db.objects);
  watch('types', db.types);
  watch('collections', db.collections);
  watch('blobs', db.blobs);
  const metaHook = (pk: any) => {
    if (pk === 'pinned' || pk === 'pinnedUpdatedAt' || isRoutineMetaKey(pk)) schedule('meta', String(pk));
  };
  db.meta.hook('creating', metaHook);
  db.meta.hook('updating', (_m: any, pk: any) => metaHook(pk));
  db.meta.hook('deleting', (pk: any) => metaHook(pk));

  window.addEventListener('online', () => {
    if (uid) {
      setStatus({ status: 'syncing' });
      void flush();
    }
  });
  window.addEventListener('offline', () => uid && setStatus({ status: 'offline' }));

  onAuthStateChanged(fb().auth, (user) => {
    if (user) start(user);
    else {
      stop();
      setStatus({ status: 'signed-out', user: null });
    }
  });
}

/** Re-push everything (manual "Sync now"). */
export async function syncNow() {
  if (!uid) return;
  setStatus({ status: 'syncing' });
  await reconcileAll();
}
