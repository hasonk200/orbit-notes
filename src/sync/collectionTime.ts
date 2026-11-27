import type { CollectionRec } from '../db/schema';

export function collectionTimestamp(collection: CollectionRec) {
  return collection.updatedAt ?? collection.createdAt;
}

export function compareCollections(a: CollectionRec, b: CollectionRec) {
  const first = JSON.stringify(a, Object.keys(a).sort());
  const second = JSON.stringify(b, Object.keys(b).sort());
  return collectionTimestamp(a) - collectionTimestamp(b)
    || Number(!!a.deletedAt) - Number(!!b.deletedAt)
    || (first > second ? 1 : first < second ? -1 : 0);
}
