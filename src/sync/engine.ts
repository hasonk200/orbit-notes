/**
 * Two-way sync between the local Dexie database and Firestore.
 *
 * Layout: users/{uid}/{objects|types|blobs|meta}/{id} → { json, updatedAt, deleted?, data? }
 * Records are stored as JSON strings so TipTap documents never hit Firestore's
 * field restrictions. Conflicts resolve by last-write-wins on updatedAt.
 * Links, tasks and tags are derived data: they are rebuilt locally, never synced.
 */
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, doc, onSnapshot, writeBatch, type Unsubscribe } from 'firebase/firestore';
import { create } from 'zustand';
import { db, type BlobRec, type Obj, type ObjType } from '../db/schema';
import { reindexObjects } from '../db/indexers';
import { fb, firebaseConfigured } from './firebase';

type Coll = 'objects' | 'types' | 'blobs' | 'meta';
const COLLS: Coll[] = ['objects', 'types', 'blobs', 'meta'];
const MAX_BLOB_BYTES = 700 * 1024; // base64 must fit in a 1 MiB Firestore document

export type SyncStatus = 'unconfigured' | 'signed-out' | 'connecting' | 'syncing' | 'synced' | 'offline' | 'error';

interface SyncState {
  status: SyncStatus;
  user: { uid: string; email: string | null; name: string | null; photo: string | null } | null;
  error: string | null;
  lastSyncAt: number | null;
  skipped: string[]; // keys that could not be uploaded (e.g. images over the size limit)
}

export const useSync = create<SyncState>(() => ({
  status: firebaseConfigured ? 'signed-out' : 'unconfigured',
  user: null,
  error: null,
  lastSyncAt: null,
  skipped: [],
}));

const remote = new Map<string, { ts: number; deleted: boolean }>();
const pending = new Set<string>();
let uid: string | null = null;
let unsubs: Unsubscribe[] = [];
let flushTimer = 0;
let flushing = false;
let ready = false;

const key = (c: Coll, id: string) => `${c}/${id}`;
const split = (k: string) => k.split(/\/(.*)/s).slice(0, 2) as [Coll, string];

function setStatus(s: Partial<SyncState>) {
  useSync.setState(s);
}

// ---------- local record helpers ----------

async function readLocal(c: Coll, id: string, full = true): Promise<{ ts: number; payload: Record<string, any> } | null> {
  if (c === 'objects') {
    const o = await db.objects.get(id);
    return o ? { ts: o.updatedAt, payload: { json: JSON.stringify(o) } } : null;
  }
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
  // meta: only the pinned list is synced
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
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flush(), 800);
}

async function flush() {
  if (!uid || !ready || flushing) {
    if (pending.size && uid) {
      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => void flush(), 1500);
    }
    return;
  }
  flushing = true;
  const keys = [...pending];
  pending.clear();
  const { fs } = fb();
  const userUid = uid;
  try {
    let batch = writeBatch(fs);
    let n = 0;
    let bytes = 0;
    const committed: [string, { ts: number; deleted: boolean }][] = [];
    const skipped = new Set(useSync.getState().skipped);
    const commit = async () => {
      if (!n) return;
      await batch.commit();
      for (const [k, v] of committed) remote.set(k, v);
      committed.length = 0;
      batch = writeBatch(fs);
      n = 0;
      bytes = 0;
    };
    for (const k of keys) {
      const [c, id] = split(k);
      let local = await readLocal(c, id, false);
      const r = remote.get(k);
      const ref = doc(fs, 'users', userUid, c, id);
      if (!local) {
        // deleted locally → tombstone, unless the cloud already has it deleted
        if (r && !r.deleted) {
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
          local = (await readLocal(c, id, true))!;
        }
        const size = String(local.payload.json).length + String(local.payload.data ?? '').length;
        if (n >= 400 || bytes + size > 8 * 1024 * 1024) await commit();
        batch.set(ref, { ...local.payload, updatedAt: local.ts, deleted: false });
        committed.push([k, { ts: local.ts, deleted: false }]);
        n++;
        bytes += size;
      }
    }
    await commit();
    setStatus({ skipped: [...skipped], lastSyncAt: Date.now(), error: null, status: navigator.onLine ? 'synced' : 'offline' });
  } catch (e: any) {
    // put keys back so the next attempt retries them
    keys.forEach((k) => pending.add(k));
    setStatus({ status: 'error', error: e?.message ?? String(e) });
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => void flush(), 15000);
  } finally {
    flushing = false;
    if (pending.size) {
      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => void flush(), 800);
    }
  }
}

// ---------- pull ----------

async function applyRemote(c: Coll, changes: { id: string; data: any }[]) {
  const touchedObjects: string[] = [];
  for (const { id, data } of changes) {
    const ts = Number(data.updatedAt ?? 0);
    const deleted = !!data.deleted;
    remote.set(key(c, id), { ts, deleted });
    const local = await readLocal(c, id);
    if (deleted) {
      if (!local || local.ts > ts) continue;
      if (c === 'objects') {
        await db.objects.delete(id);
        touchedObjects.push(id);
      } else if (c === 'types') await db.types.delete(id);
      else if (c === 'blobs') await db.blobs.delete(id);
      continue;
    }
    if (local && local.ts >= ts) continue;
    try {
      if (c === 'objects') {
        await db.objects.put(JSON.parse(data.json) as Obj);
        touchedObjects.push(id);
      } else if (c === 'types') await db.types.put(JSON.parse(data.json) as ObjType);
      else if (c === 'blobs') {
        const meta = JSON.parse(data.json);
        await db.blobs.put({ ...meta, data: base64ToBlob(data.data ?? '', meta.mimeType) } as BlobRec);
      } else if (c === 'meta' && id === 'pinned') {
        await db.meta.bulkPut([
          { key: 'pinned', value: JSON.parse(data.json) },
          { key: 'pinnedUpdatedAt', value: ts },
        ]);
      }
    } catch (e) {
      console.warn('Orbit sync: could not apply', c, id, e);
    }
  }
  if (touchedObjects.length) await reindexObjects(touchedObjects);
}

async function reconcileAll() {
  // push every local record the cloud doesn't have, or has an older version of
  const [objs, types, blobs] = await Promise.all([db.objects.toCollection().primaryKeys(), db.types.toCollection().primaryKeys(), db.blobs.toCollection().primaryKeys()]);
  objs.forEach((id) => pending.add(key('objects', String(id))));
  types.forEach((id) => pending.add(key('types', String(id))));
  blobs.forEach((id) => pending.add(key('blobs', String(id))));
  pending.add(key('meta', 'pinned'));
  await flush();
}

function start(user: User) {
  stop();
  uid = user.uid;
  ready = false;
  remote.clear();
  setStatus({
    status: 'connecting',
    error: null,
    user: { uid: user.uid, email: user.email, name: user.displayName, photo: user.photoURL },
  });
  const { fs } = fb();
  const firstSeen = new Set<Coll>();
  // apply snapshots one at a time so local writes never interleave
  let chain = Promise.resolve();
  for (const c of COLLS) {
    const unsub = onSnapshot(
      collection(fs, 'users', user.uid, c),
      { includeMetadataChanges: false },
      (snap) => {
        const changes = snap
          .docChanges()
          .filter((ch) => ch.type !== 'removed' && !ch.doc.metadata.hasPendingWrites)
          .map((ch) => ({ id: ch.doc.id, data: ch.doc.data() }));
        chain = chain.then(async () => {
          if (uid !== user.uid) return;
          if (changes.length) await applyRemote(c, changes);
          if (!firstSeen.has(c)) {
            firstSeen.add(c);
            if (firstSeen.size === COLLS.length) {
              ready = true;
              setStatus({ status: 'syncing' });
              await reconcileAll();
            }
          } else if (ready && useSync.getState().status !== 'error') {
            setStatus({ status: snap.metadata.fromCache ? 'offline' : 'synced', lastSyncAt: Date.now() });
          }
        });
      },
      (err) => setStatus({ status: 'error', error: err.message }),
    );
    unsubs.push(unsub);
  }
}

function stop() {
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
  watch('blobs', db.blobs);
  const metaHook = (pk: any) => {
    if (pk === 'pinned' || pk === 'pinnedUpdatedAt') schedule('meta', 'pinned');
  };
  db.meta.hook('creating', metaHook);
  db.meta.hook('updating', (_m: any, pk: any) => metaHook(pk));

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
