import JSZip from 'jszip';
import { db, getMeta, SCHEMA_VERSION, setMeta, type BlobRec } from './schema';
import { extForMime } from './blobs';
import { reindexAll } from './indexers';

const LOCAL_META_KEYS = new Set(['backupDirHandle']);

export async function buildBackupZip(): Promise<Blob> {
  const [meta, types, objects, links, tasks, blobs] = await Promise.all([
    db.meta.toArray(),
    db.types.toArray(),
    db.objects.toArray(),
    db.links.toArray(),
    db.tasks.toArray(),
    db.blobs.toArray(),
  ]);
  const zip = new JSZip();
  const blobMeta = blobs.map(({ data: _data, ...rest }) => ({ ...rest, file: `media/${rest.id}.${extForMime(rest.mimeType)}` }));
  const payload = {
    app: 'orbit',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    meta: meta.filter((m) => !LOCAL_META_KEYS.has(m.key)),
    types,
    objects,
    links,
    tasks,
    blobs: blobMeta,
  };
  zip.file('data.json', JSON.stringify(payload, null, 1));
  for (const b of blobs) zip.file(`media/${b.id}.${extForMime(b.mimeType)}`, b.data);
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

/** Replace all data with the contents of a backup zip. */
export async function importBackupZip(file: Blob) {
  const zip = await JSZip.loadAsync(file);
  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('This file is not an Orbit backup (data.json is missing).');
  const data = JSON.parse(await dataFile.async('string'));
  if (data.app !== 'orbit' || !Array.isArray(data.objects)) throw new Error('This file is not an Orbit backup.');
  if ((data.schemaVersion ?? 1) > SCHEMA_VERSION) throw new Error('This backup comes from a newer version of Orbit.');

  const blobs: BlobRec[] = [];
  for (const b of data.blobs ?? []) {
    const f = zip.file(b.file);
    if (!f) continue;
    const raw = await f.async('blob');
    const { file: _file, ...rest } = b;
    blobs.push({ ...rest, data: new Blob([raw], { type: b.mimeType }) });
  }
  const handle = await getMeta('backupDirHandle');
  await db.transaction('rw', [db.meta, db.types, db.objects, db.links, db.tasks, db.blobs], async () => {
    await Promise.all([db.meta.clear(), db.types.clear(), db.objects.clear(), db.links.clear(), db.tasks.clear(), db.blobs.clear()]);
    await db.meta.bulkPut((data.meta ?? []).filter((m: any) => !LOCAL_META_KEYS.has(m.key)));
    if (handle) await db.meta.put({ key: 'backupDirHandle', value: handle });
    await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
    await db.types.bulkPut(data.types ?? []);
    await db.objects.bulkPut(data.objects);
    await db.links.bulkPut(data.links ?? []);
    await db.tasks.bulkPut(data.tasks ?? []);
    await db.blobs.bulkPut(blobs);
  });
  // links/tasks/tags are derived data: rebuild them so they always match the content
  await reindexAll();
  return { objects: data.objects.length as number, blobs: blobs.length };
}
