import JSZip from 'jszip';
import { db, SCHEMA_VERSION, setMeta, type BlobRec, type CollectionRec, type MetaRec, type Obj, type ObjType, type TaskRec } from './schema';
import { clearBlobUrlCache, extForMime } from './blobs';
import { reindexAll } from './indexers';
import { extractBlobIds } from '../lib/content';
import { LocalizedError } from '../lib/i18n';

const LOCAL_META_KEYS = new Set(['backupDirHandle']);

export async function buildBackupZip(): Promise<Blob> {
  const [meta, types, collections, objects, links, tasks, blobs] = await db.transaction(
    'r', [db.meta, db.types, db.collections, db.objects, db.links, db.tasks, db.blobs], () => Promise.all([
      db.meta.toArray(), db.types.toArray(), db.collections.toArray(), db.objects.toArray(),
      db.links.toArray(), db.tasks.toArray(), db.blobs.toArray(),
    ]),
  );
  const zip = new JSZip();
  const blobMeta = blobs.map(({ data: _data, ...rest }) => ({ ...rest, file: `media/${rest.id}.${extForMime(rest.mimeType)}` }));
  const payload = {
    app: 'orbit',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    meta: meta.filter((m) => !LOCAL_META_KEYS.has(m.key)),
    types,
    collections,
    objects,
    links,
    tasks,
    blobs: blobMeta,
  };
  zip.file('data.json', JSON.stringify(payload, null, 1));
  for (const b of blobs) zip.file(`media/${b.id}.${extForMime(b.mimeType)}`, await b.data.arrayBuffer());
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export function backupFileName(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `orbit-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip`;
}

export async function downloadBackup() {
  const blob = await buildBackupZip();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = backupFileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  await setMeta('lastBackupAt', Date.now());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function backupRows<T>(value: unknown, label: string, key = 'id', required = false): T[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) throw new Error(`Invalid ${label} in the Orbit backup.`);
  const keys = new Set<string>();
  for (const item of value) {
    const id = isRecord(item) ? item[key] : null;
    if (typeof id !== 'string' || !id || keys.has(id)) throw new Error(`Invalid or duplicate ${label} in the Orbit backup.`);
    keys.add(id);
  }
  return value;
}

export async function readBackupZip(file: Blob) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true }).catch((cause: unknown) => {
    throw new LocalizedError('Could not read the Orbit ZIP backup. The file may be damaged.', undefined, { cause });
  });
  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('This file is not an Orbit backup (data.json is missing).');
  const data: unknown = JSON.parse(await dataFile.async('string'));
  if (!isRecord(data) || data.app !== 'orbit') throw new Error('This file is not an Orbit backup.');
  const version = data.schemaVersion ?? 1;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new Error('Invalid Orbit backup version.');
  if (version > SCHEMA_VERSION) throw new Error('This backup comes from a newer version of Orbit.');

  const meta = backupRows<MetaRec>(data.meta, 'settings', 'key');
  const types = backupRows<ObjType>(data.types, 'types');
  const collections = backupRows<CollectionRec>(data.collections, 'collections');
  const objects = backupRows<Obj>(data.objects, 'objects', 'id', true);
  const tasks = backupRows<TaskRec>(data.tasks, 'tasks');
  if (objects.some((o) => typeof o.title !== 'string' || typeof o.typeId !== 'string' || !isRecord(o.content) || !isRecord(o.props))) {
    throw new Error('The Orbit backup contains an invalid object.');
  }

  const blobs: BlobRec[] = [];
  for (const { file: path, ...b } of backupRows<Omit<BlobRec, 'data'> & { file: string }>(data.blobs, 'images')) {
    if (typeof path !== 'string' || !path.startsWith('media/') || typeof b.mimeType !== 'string' || !Number.isSafeInteger(b.size) || b.size < 0) {
      throw new LocalizedError('Invalid image metadata in the Orbit backup ({id}).', { id: b.id });
    }
    const entry = zip.file(path);
    if (!entry) throw new LocalizedError('The Orbit backup is missing image {id}.', { id: b.id });
    const bytes = await entry.async('arraybuffer');
    if (bytes.byteLength !== b.size) throw new LocalizedError('The Orbit backup contains an incomplete image ({id}).', { id: b.id });
    blobs.push({ ...b, data: new Blob([bytes], { type: b.mimeType }) });
  }
  const available = new Set(blobs.map((b) => b.id));
  const used = new Set([
    ...objects.flatMap((o) => [...extractBlobIds(o.content), ...(o.cover ? [o.cover] : [])]),
    ...types.flatMap((t) => extractBlobIds(t.defaultTemplate ?? undefined)),
  ]);
  for (const id of used) {
    if (!available.has(id)) throw new LocalizedError('The Orbit backup is missing referenced image {id}.', { id });
  }
  return { meta, types, collections, objects, tasks, blobs };
}

/** Replace data and rebuild derived indexes only after the full archive is validated. */
export async function importBackupZip(file: Blob) {
  const { meta, types, collections, objects, tasks, blobs } = await readBackupZip(file);
  await db.transaction('rw', [db.meta, db.types, db.collections, db.objects, db.links, db.tasks, db.blobs], async () => {
    const handle = await db.meta.get('backupDirHandle');
    await Promise.all([
      db.meta.clear(),
      db.types.clear(),
      db.collections.clear(),
      db.objects.clear(),
      db.links.clear(),
      db.tasks.clear(),
      db.blobs.clear(),
    ]);
    await db.meta.bulkPut(meta.filter((m) => !LOCAL_META_KEYS.has(m.key)));
    if (handle) await db.meta.put(handle);
    await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
    await db.types.bulkPut(types);
    await db.collections.bulkPut(collections);
    await db.objects.bulkPut(objects);
    await db.tasks.bulkPut(tasks);
    await db.blobs.bulkPut(blobs);
    await reindexAll();
  });
  clearBlobUrlCache();
  return { objects: objects.length, blobs: blobs.length };
}
