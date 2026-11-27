import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { db, type CollectionRec } from '../db/schema';

import { collectionTimestamp, compareCollections } from './collectionTime';
export { collectionTimestamp, compareCollections };

export async function syncCollection(fs: Firestore, account: string, id: string, isCurrent: () => boolean) {
  const local = await db.collections.get(id);
  const ref = doc(fs, 'users', account, 'collections', id);
  const cloud = await runTransaction(fs, async (tx) => {
    if (!isCurrent()) return;
    const data = (await tx.get(ref)).data();
    const collection: CollectionRec | undefined = data ? JSON.parse(data.json) : undefined;
    if (data && collection?.id !== id) throw new Error(`Cloud sync received an invalid collection (${id}).`);
    if (!isCurrent()) return;
    if (local && (!collection || compareCollections(local, collection) > 0)) {
      tx.set(ref, { json: JSON.stringify(local), updatedAt: collectionTimestamp(local), deleted: false });
      return;
    }
    if (collection && (!local || compareCollections(local, collection) < 0)) return collection;
  });
  if (!cloud || !isCurrent()) return;
  await db.transaction('rw', db.collections, async () => {
    const current = await db.collections.get(id);
    if (isCurrent() && (!current || compareCollections(current, cloud) < 0)) await db.collections.put(cloud);
  });
}
