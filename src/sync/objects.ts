import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { reindexObjects } from '../db/indexers';
import { flushDrafts } from '../db/drafts';
import { db, uid, type Obj } from '../db/schema';
import { chooseObjectSync, DELETED_OBJECT, objectFingerprint } from './objectVersions';

type CloudObject = { json?: string; updatedAt: number; deleted?: boolean };

function payload(object: Obj): CloudObject {
  return { json: JSON.stringify(object), updatedAt: object.updatedAt, deleted: false };
}

function decode(id: string, record?: CloudObject): Obj | null {
  if (!record || record.deleted) return null;
  const object: Obj = JSON.parse(record.json ?? 'null');
  if (object?.id !== id) throw new Error(`Cloud sync received an invalid note (${id}).`);
  return object;
}

function recoveredCopy(local: Obj, localHash: string, cloudHash: string | null, now: number): Obj {
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

/** Resolve against the latest cloud version. Firestore retries the read if another device wins the race. */
export async function syncObject(fs: Firestore, account: string, id: string, isCurrent: () => boolean) {
  await flushDrafts(id);
  if (!isCurrent()) return;
  const [local, base] = await db.transaction('r', [db.objects, db.objectSyncBases], () => Promise.all([
    db.objects.get(id), db.objectSyncBases.get([account, id]),
  ]));
  const localHash = await objectFingerprint(local ?? null);
  const ref = doc(fs, 'users', account, 'objects', id);
  const now = Date.now();
  const fallbackCopyId = `conflict-${uid()}`;
  const result = await runTransaction(fs, async (tx) => {
    if (!isCurrent()) return;
    const cloudRecord = (await tx.get(ref)).data() as CloudObject | undefined;
    const cloud = decode(id, cloudRecord);
    const cloudHash = cloudRecord?.deleted ? DELETED_OBJECT : await objectFingerprint(cloud);
    const action = chooseObjectSync(localHash, cloudHash, base);
    if (!isCurrent()) return;
    if (action === 'upload') {
      tx.set(ref, local ? payload(local) : { deleted: true, updatedAt: now });
      return { object: local ?? null, cloudHash: localHash ?? DELETED_OBJECT, acknowledged: true };
    }
    if (action === 'conflict' && local && localHash) {
      let copy = recoveredCopy(local, localHash, cloudHash, now);
      let copyRef = doc(fs, 'users', account, 'objects', copy.id);
      const existing = (await tx.get(copyRef)).data() as CloudObject | undefined;
      if (!isCurrent()) return;
      if (existing && !existing.deleted) {
        const existingCopy = decode(copy.id, existing);
        if (existingCopy && !existingCopy.deletedAt) return { object: cloud, cloudHash, copy: existingCopy, acknowledged: false };
      }
      if (existing) {
        copy = { ...copy, id: fallbackCopyId };
        copyRef = doc(fs, 'users', account, 'objects', copy.id);
      }
      tx.set(copyRef, payload(copy));
      return { object: cloud, cloudHash, copy, acknowledged: false };
    }
    return { object: cloud, cloudHash, acknowledged: action === 'same' };
  });
  if (!result || !isCurrent()) return;

  const resolvedLocalHash = result.cloudHash === DELETED_OBJECT ? null : result.cloudHash;
  const copyHash = result.copy ? await objectFingerprint(result.copy) : null;
  await flushDrafts(id);
  await db.transaction('rw', [db.objects, db.objectSyncBases, db.links, db.tasks, db.types], async () => {
    const current = await db.objects.get(id);
    const currentBase = await db.objectSyncBases.get([account, id]);
    if (!isCurrent()) return;
    // Another tab can process this note while the network request is in flight.
    if (currentBase?.local !== base?.local || currentBase?.cloud !== base?.cloud) return;
    const originalUnchanged = JSON.stringify(current) === JSON.stringify(local);
    if (result.copy && !(await db.objects.get(result.copy.id))) {
      await db.objects.add(result.copy);
      await db.objectSyncBases.put({ account, objectId: result.copy.id, local: copyHash, cloud: copyHash });
    }
    if (originalUnchanged && localHash !== resolvedLocalHash) {
      if (result.object) await db.objects.put(result.object);
      else await db.objects.delete(id);
      await reindexObjects([id]);
    }
    // A pending newer edit descends from the sent version only if the cloud accepted it.
    if (originalUnchanged || result.acknowledged) {
      const next = { account, objectId: id, local: resolvedLocalHash, cloud: result.cloudHash };
      if (currentBase?.local !== next.local || currentBase?.cloud !== next.cloud) await db.objectSyncBases.put(next);
    }
  });
}
