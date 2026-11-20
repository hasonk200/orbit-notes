import type { Obj, ObjectSyncBase } from '../db/schema';

export const DELETED_OBJECT = 'deleted';

export async function objectFingerprint(object: Obj | null): Promise<string | null> {
  if (!object) return null;
  const { updatedAt: _updatedAt, ...data } = object;
  const json = JSON.stringify(data, (_, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function chooseObjectSync(local: string | null, cloud: string | null, base?: Pick<ObjectSyncBase, 'local' | 'cloud'>) {
  if (local === cloud || (local === null && cloud === DELETED_OBJECT)) return 'same';
  if (!base) {
    if (!local) return 'download';
    return cloud ? 'conflict' : 'upload';
  }
  if (local === base.local) return 'download';
  if (cloud === base.cloud) return 'upload';
  // Keep edited content if a permanent deletion raced with an edit.
  return local ? 'conflict' : 'download';
}
