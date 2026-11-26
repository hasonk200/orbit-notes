/**
 * Two-way sync with a WebDAV folder (Nutstore / 坚果云 works from mainland China without a VPN).
 *
 * Layout in the folder: `orbit-data.json` (every note, type, collection, pin, routine and image's
 * details) and `blob-<id>.txt` (each image, base64). A sync reads the data file, merges (see
 * webdavPlan.ts), uploads it with If-Match so two devices can't overwrite each other, then applies
 * what came down. Few requests per sync, which matters on Nutstore's free plan.
 * Links, tasks and tags are derived data: they are rebuilt locally, never synced.
 */
import { create } from 'zustand';
import { db, type BlobRec, type CollectionRec, type Obj, type ObjType } from '../db/schema';
import { reindexObjects } from '../db/indexers';
import { flushAllDrafts } from '../db/drafts';
import { isRoutineMetaKey, type RoutineRec } from '../lib/routines';
import { LocalizedError } from '../lib/i18n';
import { collectionTimestamp } from './collections';
import { DELETED_OBJECT, objectFingerprint } from './objectVersions';
import { basicAuth, folderUrl, platformTransport, type DavResponse, type DavTransport } from './webdavHttp';
import {
  blobFile, cloudHashOf, DATA_FILE, emptyRemote, parseRemote, planNote, planRecord, recordKey, splitKey,
  type RemoteData, type RemoteRecord,
} from './webdavPlan';

export interface WebDavConfig {
  server: string;
  user: string;
  password: string;
  folder: string;
}

export const NUTSTORE_SERVER = 'https://dav.jianguoyun.com/dav/';
export const DEFAULT_FOLDER = 'Orbit';
/** Kept on this device only: never synced, never in backups (the password is in here). */
export const WEBDAV_CONFIG_KEY = 'webdavConfig';
export const WEBDAV_BASE_KEY = 'webdavBase';

export type WebDavStatus = 'off' | 'syncing' | 'synced' | 'offline' | 'error';

interface WebDavState {
  status: WebDavStatus;
  config: Omit<WebDavConfig, 'password'> | null;
  /** Show with localizeError(error, tr). */
  error: unknown;
  lastSyncAt: number | null;
}

export const useWebDav = create<WebDavState>(() => ({ status: 'off', config: null, error: null, lastSyncAt: null }));

let config: WebDavConfig | null = null;
let transport: DavTransport | null = null;
let running: Promise<void> | null = null;
let again = false;
let applying = false;
let timer = 0;
let poll = 0;

const DEBOUNCE = 8000;
const POLL = 3 * 60 * 1000;

const accountOf = (c: WebDavConfig) => `webdav:${c.user}@${folderUrl(c.server, c.folder)}`;

// ---------- requests ----------

async function request(c: WebDavConfig, method: 'GET' | 'PUT' | 'MKCOL', file: string, headers: Record<string, string> = {}, body?: string): Promise<DavResponse> {
  transport ??= await platformTransport();
  let res: DavResponse;
  try {
    res = await transport({
      method,
      url: folderUrl(c.server, c.folder) + file,
      headers: { Authorization: basicAuth(c.user, c.password), ...(body !== undefined ? { 'Content-Type': 'text/plain; charset=utf-8' } : {}), ...headers },
      body,
    });
  } catch (e) {
    if (!navigator.onLine) throw new LocalizedError('You’re offline. Orbit will sync when you’re back online.');
    throw new LocalizedError('Couldn’t reach the WebDAV server. Check the address. On the web, most servers (including Nutstore) only work from the Orbit desktop or phone app.', undefined, { cause: e });
  }
  if (res.status === 401 || res.status === 403) throw new LocalizedError('The server refused the account or app password. For Nutstore, use an app password (Account info → Security → Third-party app management).');
  return res;
}

async function ensureFolder(c: WebDavConfig) {
  try {
    await request(c, 'MKCOL', '');
  } catch (e) {
    if (e instanceof LocalizedError && /refused/.test(e.key)) throw e;
    // Some phone HTTP stacks can't send MKCOL; the upload below says if the folder is really missing.
  }
}

async function readRemote(c: WebDavConfig): Promise<{ data: RemoteData; etag: string | null; exists: boolean }> {
  const res = await request(c, 'GET', DATA_FILE);
  if (res.status === 404) return { data: emptyRemote(), etag: null, exists: false };
  if (res.status !== 200) throw new LocalizedError('The WebDAV server answered {status}. Try again later.', { status: res.status });
  return { data: parseRemote(res.text), etag: res.etag, exists: true };
}

function checkWrite(res: DavResponse, folder: string) {
  if (res.status === 409) throw new LocalizedError('The sync folder “{folder}” doesn’t exist. Create it in your WebDAV storage (e.g. the Nutstore website), then sync again.', { folder });
  if (res.status === 507) throw new LocalizedError('Your WebDAV storage is full.');
  if (res.status >= 300 && res.status !== 412) throw new LocalizedError('The WebDAV server answered {status}. Try again later.', { status: res.status });
}

// ---------- local records other than notes ----------

type Kind = 'types' | 'collections' | 'meta' | 'blobs';
interface LocalRecord { ts: number; json: string }

async function readLocalRecords(): Promise<Map<string, LocalRecord>> {
  const [types, collections, metaRows, blobs] = await Promise.all([db.types.toArray(), db.collections.toArray(), db.meta.toArray(), db.blobs.toArray()]);
  const out = new Map<string, LocalRecord>();
  for (const t of types) out.set(recordKey('types', t.id), { ts: t.updatedAt ?? 0, json: JSON.stringify(t) });
  for (const c of collections) out.set(recordKey('collections', c.id), { ts: collectionTimestamp(c), json: JSON.stringify(c) });
  const pinned = metaRows.find((m) => m.key === 'pinned');
  if (pinned) out.set(recordKey('meta', 'pinned'), { ts: (metaRows.find((m) => m.key === 'pinnedUpdatedAt')?.value as number) ?? 0, json: JSON.stringify(pinned.value ?? []) });
  for (const m of metaRows) {
    if (isRoutineMetaKey(m.key) && m.value) out.set(recordKey('meta', m.key), { ts: (m.value as RoutineRec).updatedAt ?? 0, json: JSON.stringify(m.value) });
  }
  for (const b of blobs) {
    const { data: _data, ...meta } = b;
    out.set(recordKey('blobs', b.id), { ts: b.createdAt, json: JSON.stringify(meta) });
  }
  return out;
}

async function localTs(kind: Kind, id: string): Promise<number | null> {
  if (kind === 'types') return (await db.types.get(id))?.updatedAt ?? null;
  if (kind === 'collections') {
    const c = await db.collections.get(id);
    return c ? collectionTimestamp(c) : null;
  }
  if (kind === 'blobs') return (await db.blobs.get(id))?.createdAt ?? null;
  if (id === 'pinned') return (await db.meta.get('pinnedUpdatedAt'))?.value ?? null;
  return ((await db.meta.get(id))?.value as RoutineRec | undefined)?.updatedAt ?? null;
}

async function writeLocalRecord(kind: Kind, id: string, json: string, ts: number, blobData?: string) {
  if (kind === 'types') await db.types.put(JSON.parse(json) as ObjType);
  else if (kind === 'collections') await db.collections.put(JSON.parse(json) as CollectionRec);
  else if (kind === 'meta' && id === 'pinned') await db.meta.bulkPut([{ key: 'pinned', value: JSON.parse(json) }, { key: 'pinnedUpdatedAt', value: ts }]);
  else if (kind === 'meta' && isRoutineMetaKey(id)) await db.meta.put({ key: id, value: JSON.parse(json) as RoutineRec });
  else if (kind === 'blobs') {
    const meta = JSON.parse(json);
    await db.blobs.put({ ...meta, data: base64ToBlob(blobData ?? '', meta.mimeType) } as BlobRec);
  }
}

async function deleteLocalRecord(kind: Kind, id: string) {
  if (kind === 'types') await db.types.delete(id);
  else if (kind === 'collections') await db.collections.delete(id);
  else if (kind === 'meta' && isRoutineMetaKey(id)) await db.meta.delete(id);
  else if (kind === 'blobs') await db.blobs.delete(id);
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

function conflictCopy(local: Obj, localHash: string, cloudHash: string | null, now: number): Obj {
  return {
    ...local,
    id: `conflict-${localHash}-${cloudHash ?? 'missing'}`,
    syncConflictOf: local.syncConflictOf ?? local.id,
    syncConflictDeleted: local.syncConflictDeleted ?? !!local.deletedAt,
    dailyDate: null,
    deletedAt: null,
    updatedAt: now,
  };
}

// ---------- one sync ----------

async function syncPass(c: WebDavConfig) {
  await flushAllDrafts();
  const account = accountOf(c);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: remote, etag, exists } = await readRemote(c);
    if (!exists) await ensureFolder(c);
    const now = Date.now();
    let changed = false;
    const after: (() => Promise<void>)[] = [];
    const uploads: { file: string; body: string }[] = [];
    const put = (key: string, rec: RemoteRecord) => {
      remote.records[key] = rec;
      changed = true;
    };

    // Notes: three-way check against the last version both sides agreed on.
    const [objects, bases, metaBase] = await Promise.all([
      db.objects.toArray(),
      db.objectSyncBases.where('account').equals(account).toArray(),
      db.meta.get(WEBDAV_BASE_KEY),
    ]);
    const local = new Map(objects.map((o) => [o.id, o]));
    const baseOf = new Map(bases.map((b) => [b.objectId, b]));
    const ids = new Set<string>([...local.keys(), ...baseOf.keys()]);
    for (const k of Object.keys(remote.records)) if (k.startsWith('objects/')) ids.add(splitKey(k)[1]);
    const baseWrites: { objectId: string; local: string | null; cloud: string | null }[] = [];
    for (const id of ids) {
      const obj = local.get(id) ?? null;
      const key = recordKey('objects', id);
      const r = remote.records[key];
      const base = baseOf.get(id);
      const localHash = await objectFingerprint(obj);
      const cloudHash = cloudHashOf(r);
      const action = planNote(localHash, r, base);
      if (action === 'same') {
        if (r && (base?.local !== localHash || base?.cloud !== cloudHash)) baseWrites.push({ objectId: id, local: localHash, cloud: cloudHash });
        continue;
      }
      if (action === 'upload') {
        put(key, obj ? { ts: obj.updatedAt, hash: localHash!, json: JSON.stringify(obj) } : { ts: now, deleted: true });
        baseWrites.push({ objectId: id, local: localHash, cloud: localHash ?? DELETED_OBJECT });
        continue;
      }
      if (action === 'conflict' && obj && localHash) {
        const copy = conflictCopy(obj, localHash, cloudHash, now);
        if (!local.has(copy.id) && !remote.records[recordKey('objects', copy.id)]) {
          const copyHash = await objectFingerprint(copy);
          put(recordKey('objects', copy.id), { ts: copy.updatedAt, hash: copyHash!, json: JSON.stringify(copy) });
          baseWrites.push({ objectId: copy.id, local: copyHash, cloud: copyHash });
          after.push(async () => {
            if (!(await db.objects.get(copy.id))) await db.objects.add(copy);
          });
        }
      }
      // Download (also the second half of a conflict): take the server's version if the note didn't change meanwhile.
      const incoming: Obj | null = r && !r.deleted ? JSON.parse(r.json ?? 'null') : null;
      if (incoming && incoming.id !== id) throw new LocalizedError('Sync received an invalid note ({id}).', { id });
      const seen = JSON.stringify(obj);
      after.push(async () => {
        const changedHere = await db.transaction('rw', [db.objects, db.objectSyncBases, db.links, db.tasks, db.types], async () => {
          if (JSON.stringify((await db.objects.get(id)) ?? null) !== seen) return true;
          if (incoming) await db.objects.put(incoming);
          else await db.objects.delete(id);
          await db.objectSyncBases.put({ account, objectId: id, local: incoming ? cloudHash : null, cloud: cloudHash });
          return false;
        });
        if (!changedHere) await reindexObjects([id]);
      });
    }

    // Everything else: newer wins, with tombstones.
    const records = await readLocalRecords();
    const prevBase: Record<string, number> = { ...((metaBase?.value as Record<string, number>) ?? {}) };
    const nextBase: Record<string, number> = { ...prevBase };
    const keys = new Set<string>([...records.keys(), ...Object.keys(prevBase)]);
    for (const k of Object.keys(remote.records)) if (!k.startsWith('objects/')) keys.add(k);
    for (const key of keys) {
      const [kind, id] = splitKey(key) as [Kind, string];
      const mine = records.get(key) ?? null;
      const r = remote.records[key];
      const action = planRecord(mine?.ts ?? null, r, prevBase[key]);
      if (action === 'upload' && mine) {
        if (kind === 'blobs') {
          const blob = await db.blobs.get(id);
          if (!blob) continue;
          uploads.push({ file: blobFile(id), body: await blobToBase64(blob.data) });
        }
        put(key, { ts: mine.ts, json: mine.json });
        nextBase[key] = mine.ts;
      } else if (action === 'upload-tombstone') {
        put(key, { ts: now, deleted: true });
        delete nextBase[key];
      } else if (action === 'download' && r?.json) {
        let blobData: string | undefined;
        if (kind === 'blobs') {
          const res = await request(c, 'GET', blobFile(id));
          if (res.status !== 200) continue; // the other device hasn't finished uploading it
          blobData = res.text;
        }
        const ts = r.ts;
        after.push(async () => {
          const current = await localTs(kind, id);
          if (current !== null && current > ts) return;
          await writeLocalRecord(kind, id, r.json!, ts, blobData);
        });
        nextBase[key] = ts;
      } else if (action === 'delete-local') {
        after.push(() => deleteLocalRecord(kind, id));
        delete nextBase[key];
      } else if (mine) {
        nextBase[key] = mine.ts;
      }
    }

    if (changed) {
      for (const u of uploads) checkWrite(await request(c, 'PUT', u.file, {}, u.body), c.folder);
      remote.updatedAt = now;
      // If-Match: only replace the version we read, so a sync from another device is never lost.
      const guard: Record<string, string> = etag ? { 'If-Match': etag } : exists ? {} : { 'If-None-Match': '*' };
      const res = await request(c, 'PUT', DATA_FILE, guard, JSON.stringify(remote));
      checkWrite(res, c.folder);
      if (res.status === 412) continue; // someone else synced in between: read again and merge
    }

    applying = true;
    try {
      for (const step of after) await step();
      if (baseWrites.length) await db.objectSyncBases.bulkPut(baseWrites.map((b) => ({ account, ...b })));
      await db.meta.put({ key: WEBDAV_BASE_KEY, value: nextBase });
    } finally {
      applying = false;
    }
    return;
  }
  throw new LocalizedError('Another device kept syncing at the same time. Orbit will try again shortly.');
}

// ---------- running ----------

function setState(s: Partial<WebDavState>) {
  useWebDav.setState(s);
}

/** Sync now (or right after the sync that's already running). */
export function syncWebDav(): Promise<void> {
  if (!config) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  const c = config;
  setState({ status: 'syncing', error: null });
  running = (async () => {
    try {
      do {
        again = false;
        await syncPass(c);
      } while (again && config === c);
      if (config === c) setState({ status: 'synced', lastSyncAt: Date.now(), error: null });
    } catch (e) {
      if (config === c) setState({ status: navigator.onLine ? 'error' : 'offline', error: e });
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

function scheduleSync(delay = DEBOUNCE) {
  if (!config || applying) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void syncWebDav().catch(() => {}), delay);
}

function begin(c: WebDavConfig) {
  config = c;
  const { password: _password, ...shown } = c;
  setState({ config: shown, status: 'syncing', error: null });
  window.clearInterval(poll);
  poll = window.setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) scheduleSync(0);
  }, POLL);
  scheduleSync(0);
}

/** Check the account, save it on this device and start syncing. */
export async function connectWebDav(input: WebDavConfig) {
  const c: WebDavConfig = { server: input.server.trim() || NUTSTORE_SERVER, user: input.user.trim(), password: input.password, folder: input.folder.trim() || DEFAULT_FOLDER };
  if (!/^https?:\/\//i.test(c.server)) throw new LocalizedError('Enter the server address, starting with https://');
  await readRemote(c); // throws a clear message for a wrong address or password
  await db.meta.put({ key: WEBDAV_CONFIG_KEY, value: c });
  begin(c);
  await syncWebDav();
}

/** Stop syncing on this device. Notes stay here and in the WebDAV folder. */
export async function disconnectWebDav() {
  config = null;
  window.clearInterval(poll);
  window.clearTimeout(timer);
  await db.meta.delete(WEBDAV_CONFIG_KEY);
  setState({ status: 'off', config: null, error: null, lastSyncAt: null });
}

let installed = false;

/** Call once at startup: resumes syncing if this device was connected, and syncs after local edits. */
export async function initWebDav() {
  if (installed) return;
  installed = true;
  const watch = (table: any) => {
    table.hook('creating', () => void scheduleSync());
    table.hook('updating', () => void scheduleSync());
    table.hook('deleting', () => void scheduleSync());
  };
  [db.objects, db.types, db.collections, db.blobs].forEach(watch);
  const metaHook = (pk: unknown) => {
    if (pk === 'pinned' || isRoutineMetaKey(pk)) scheduleSync();
  };
  db.meta.hook('creating', (pk: unknown) => metaHook(pk));
  db.meta.hook('updating', (_m: unknown, pk: unknown) => metaHook(pk));
  db.meta.hook('deleting', (pk: unknown) => metaHook(pk));
  window.addEventListener('online', () => scheduleSync(0));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(1000);
  });
  const saved = (await db.meta.get(WEBDAV_CONFIG_KEY))?.value as WebDavConfig | undefined;
  if (saved?.user && saved.password) begin(saved);
}
