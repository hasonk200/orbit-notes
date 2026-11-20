import { create } from 'zustand';
import { liveQuery } from 'dexie';
import { useMemo } from 'react';
import { db, type CollectionRec, type LinkRec, type Obj, type ObjType, type TaskRec } from '../db/schema';

interface DataState {
  ready: boolean;
  objects: Obj[];
  types: ObjType[];
  collections: CollectionRec[];
  tasks: TaskRec[];
  links: LinkRec[];
  pinned: string[];
  lastBackupAt: number | null;
}

/** One shared live query over the whole (personal-sized) database. Every component selects from it. */
export const useData = create<DataState>(() => ({
  ready: false,
  objects: [],
  types: [],
  collections: [],
  tasks: [],
  links: [],
  pinned: [],
  lastBackupAt: null,
}));

let started = false;
export function startDataSync() {
  if (started) return;
  started = true;
  liveQuery(async () => {
    const [objects, types, collections, tasks, links, pinned, lastBackupAt] = await Promise.all([
      db.objects.toArray(),
      db.types.orderBy('order').toArray(),
      db.collections.orderBy('order').toArray(),
      db.tasks.toArray(),
      db.links.toArray(),
      db.meta.get('pinned'),
      db.meta.get('lastBackupAt'),
    ]);
    return {
      objects,
      types,
      collections: collections.filter((c) => !c.deletedAt),
      tasks,
      links,
      pinned: (pinned?.value as string[]) ?? [],
      lastBackupAt: (lastBackupAt?.value as number) ?? null,
    };
  }).subscribe({
    next: (v) => useData.setState({ ...v, ready: true }),
    error: (e) => console.error('Orbit live query failed', e),
  });
}

export function useObjMap() {
  const objects = useData((s) => s.objects);
  return useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
}

export function useTypeMap() {
  const types = useData((s) => s.types);
  return useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
}

export function useActiveObjects() {
  const objects = useData((s) => s.objects);
  return useMemo(() => objects.filter((o) => !o.deletedAt), [objects]);
}

export function useObject(id?: string | null) {
  return useData((s) => (id ? s.objects.find((o) => o.id === id) : undefined));
}

export function displayTitle(o?: Obj | null) {
  if (!o) return 'Deleted object';
  return o.title?.trim() || 'Untitled';
}

export async function togglePinned(id: string) {
  const cur: string[] = ((await db.meta.get('pinned'))?.value as string[]) ?? [];
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  await db.meta.bulkPut([
    { key: 'pinned', value: next },
    { key: 'pinnedUpdatedAt', value: Date.now() },
  ]);
}
