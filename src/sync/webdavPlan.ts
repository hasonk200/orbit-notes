/**
 * Decisions for WebDAV sync (e.g. Nutstore / 坚果云), kept free of I/O so they can be tested.
 *
 * The server holds one data file with every record, plus one text file per image. Notes reuse the
 * Firebase engine's three-way check (local hash, cloud hash, last agreed base), so an edit made on
 * two devices is never lost: the local version becomes a conflict copy. Everything else is
 * last-writer-wins by timestamp, with tombstones for deletions.
 */
import { chooseObjectSync, DELETED_OBJECT } from './objectVersions';

export const DATA_FILE = 'orbit-data.json';
export const FORMAT = 'orbit-webdav';

/** One record in the data file. `json` is absent on tombstones. */
export interface RemoteRecord {
  ts: number;
  deleted?: boolean;
  /** Object fingerprint (notes only), so other devices needn't re-hash. */
  hash?: string;
  json?: string;
}

export interface RemoteData {
  format: typeof FORMAT;
  version: 1;
  updatedAt: number;
  records: Record<string, RemoteRecord>;
}

export const emptyRemote = (): RemoteData => ({ format: FORMAT, version: 1, updatedAt: 0, records: {} });

export function parseRemote(text: string | null): RemoteData {
  if (!text) return emptyRemote();
  const data = JSON.parse(text);
  if (data?.format !== FORMAT || typeof data.records !== 'object' || !data.records) throw new Error('The file in the sync folder isn’t Orbit sync data.');
  return data as RemoteData;
}

export type NoteAction = 'same' | 'upload' | 'download' | 'conflict';

/** What to do with one note. `remote` undefined = the server has never seen it. */
export function planNote(localHash: string | null, remote: RemoteRecord | undefined, base?: { local: string | null; cloud: string | null }): NoteAction {
  const cloudHash = !remote ? null : remote.deleted ? DELETED_OBJECT : remote.hash ?? null;
  return chooseObjectSync(localHash, cloudHash, base);
}

export const cloudHashOf = (remote: RemoteRecord | undefined) => (!remote ? null : remote.deleted ? DELETED_OBJECT : remote.hash ?? null);

export type RecordAction = 'none' | 'upload' | 'download' | 'delete-local' | 'upload-tombstone';

/**
 * Types, collections, pins, routines and images: newer timestamp wins.
 * `baseTs` is the timestamp both sides agreed on last time; it tells "deleted here" from "new there".
 */
export function planRecord(localTs: number | null, remote: RemoteRecord | undefined, baseTs: number | undefined): RecordAction {
  if (localTs !== null) {
    if (!remote) return 'upload';
    if (remote.deleted) return localTs > remote.ts ? 'upload' : 'delete-local';
    if (localTs > remote.ts) return 'upload';
    if (remote.ts > localTs) return 'download';
    return 'none';
  }
  if (!remote || remote.deleted) return 'none';
  // Gone here but known before: deleted on this device, unless the other side changed it since.
  if (baseTs !== undefined && remote.ts <= baseTs) return 'upload-tombstone';
  return 'download';
}

export const recordKey = (kind: string, id: string) => `${kind}/${id}`;
export function splitKey(key: string): [string, string] {
  const i = key.indexOf('/');
  return [key.slice(0, i), key.slice(i + 1)];
}

/** Image file name on the server. Ids are made by Orbit, but keep the name safe for any server. */
export const blobFile = (id: string) => `blob-${encodeURIComponent(id)}.txt`;
