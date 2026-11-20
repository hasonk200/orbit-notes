import { db, uid, type JSONContent, type LinkRec, type Obj, type ObjType, type TaskRec } from './schema';
import { assignTaskIds, emptyDoc, extractBlobIds, extractLinkIds, extractTags, extractTasks, patchTaskInDoc } from '../lib/content';
import { dailyTitle, toISODate } from '../lib/dates';

/** Rebuild links / tasks / tags for one object. Must be called inside a rw transaction on objects, links, tasks. */
async function reindex(obj: Obj, type?: ObjType) {
  type = type ?? (await db.types.get(obj.typeId));
  // ---- links (content + relation properties)
  const links: LinkRec[] = [];
  for (const toId of extractLinkIds(obj.content)) {
    if (toId !== obj.id) links.push({ id: `${obj.id}>${toId}>c`, fromId: obj.id, toId, source: 'content' });
  }
  for (const def of type?.properties ?? []) {
    if (def.kind !== 'relation') continue;
    const v = obj.props?.[def.key];
    const ids: string[] = Array.isArray(v) ? v : v ? [v] : [];
    for (const toId of ids) {
      if (toId !== obj.id) links.push({ id: `${obj.id}>${toId}>p:${def.key}`, fromId: obj.id, toId, source: 'property', propKey: def.key });
    }
  }
  await db.links.where('fromId').equals(obj.id).delete();
  if (links.length) await db.links.bulkPut(links);

  // ---- tasks
  const linkIds = extractLinkIds(obj.content);
  const linked = linkIds.length ? await db.objects.bulkGet(linkIds) : [];
  const titles = new Map(linked.filter(Boolean).map((o) => [o!.id, o!.title || 'Untitled']));
  const titleOf = (id: string) => titles.get(id) ?? 'Deleted object';
  const extracted = extractTasks(obj.content, titleOf);
  const old = await db.tasks.where('objectId').equals(obj.id).toArray();
  const oldMap = new Map(old.map((t) => [t.id, t]));
  const now = Date.now();
  const rows: TaskRec[] = extracted.map((t) => {
    const prev = oldMap.get(t.id);
    const changed = !prev || prev.text !== t.text || prev.done !== t.done || (prev.due ?? null) !== t.due;
    return {
      id: t.id,
      objectId: obj.id,
      text: t.text,
      done: t.done,
      due: t.due,
      createdAt: prev?.createdAt ?? now,
      updatedAt: changed ? now : prev!.updatedAt,
    };
  });
  await db.tasks.where('objectId').equals(obj.id).delete();
  if (rows.length) await db.tasks.bulkPut(rows);
}

export async function createObject(typeId: string, init: Partial<Obj> = {}): Promise<Obj> {
  const type = await db.types.get(typeId);
  const now = Date.now();
  const obj: Obj = {
    id: uid(),
    typeId,
    title: '',
    icon: null,
    cover: null,
    props: {},
    content: type?.defaultTemplate ? assignTaskIds(type.defaultTemplate, true) : emptyDoc(),
    tags: [],
    createdAt: now,
    updatedAt: now,
    dailyDate: null,
    deletedAt: null,
    ...init,
  };
  obj.tags = extractTags(obj.content);
  await db.transaction('rw', db.objects, db.links, db.tasks, db.types, async () => {
    await db.objects.add(obj);
    await reindex(obj, type);
  });
  return obj;
}

export async function saveObject(id: string, patchOrFn: Partial<Obj> | ((cur: Obj) => Partial<Obj>)) {
  await db.transaction('rw', db.objects, db.links, db.tasks, db.types, async () => {
    const cur = await db.objects.get(id);
    if (!cur) return;
    const patch = typeof patchOrFn === 'function' ? patchOrFn(cur) : patchOrFn;
    const next: Obj = { ...cur, ...patch, updatedAt: Date.now() };
    if (patch.content) next.tags = extractTags(patch.content);
    await db.objects.put(next);
    if (patch.content || patch.props || patch.typeId) await reindex(next);
  });
}

/** Set one property, merging with the latest stored props (safe for quick successive edits). */
export async function setProp(id: string, key: string, value: any) {
  await saveObject(id, (cur) => ({ props: { ...cur.props, [key]: value } }));
}

export function dailyId(date: string) {
  return `daily-${date}`;
}

export async function getOrCreateDaily(date: string | Date): Promise<Obj> {
  const iso = typeof date === 'string' ? date : toISODate(date);
  const id = dailyId(iso);
  const existing = await db.objects.get(id);
  if (existing) {
    if (existing.deletedAt) await saveObject(id, { deletedAt: null });
    return existing;
  }
  try {
    return await createObject('daily', { id, dailyDate: iso, title: dailyTitle(iso) });
  } catch {
    // Created concurrently (e.g. React strict mode double effect)
    return (await db.objects.get(id))!;
  }
}

export async function softDelete(id: string) {
  await saveObject(id, { deletedAt: Date.now() });
}
export async function restoreObject(id: string) {
  await saveObject(id, { deletedAt: null });
}

export async function deletePermanently(id: string) {
  await db.transaction('rw', db.objects, db.links, db.tasks, async () => {
    await db.objects.delete(id);
    await db.links.where('fromId').equals(id).delete();
    await db.tasks.where('objectId').equals(id).delete();
  });
  await pruneOrphans();
}

export async function emptyTrash() {
  const trashed = (await db.objects.toArray()).filter((o) => o.deletedAt);
  await db.transaction('rw', db.objects, db.links, db.tasks, async () => {
    for (const o of trashed) {
      await db.objects.delete(o.id);
      await db.links.where('fromId').equals(o.id).delete();
      await db.tasks.where('objectId').equals(o.id).delete();
    }
  });
  await pruneOrphans();
  return trashed.length;
}

/** Remove links/tasks whose source object is gone, and blobs nothing references. */
export async function pruneOrphans() {
  await db.transaction('rw', [db.objects, db.links, db.tasks, db.blobs, db.types], async () => {
    const objs = await db.objects.toArray();
    const ids = new Set(objs.map((o) => o.id));
    const usedBlobs = new Set<string>();
    for (const o of objs) {
      extractBlobIds(o.content).forEach((b) => usedBlobs.add(b));
      if (o.cover) usedBlobs.add(o.cover);
    }
    const types = await db.types.toArray();
    for (const t of types) extractBlobIds(t.defaultTemplate ?? undefined).forEach((b) => usedBlobs.add(b));
    await db.links.filter((l) => !ids.has(l.fromId)).delete();
    await db.tasks.filter((t) => !ids.has(t.objectId)).delete();
    await db.blobs.filter((b) => !usedBlobs.has(b.id)).delete();
  });
}

/** Change an object's type, keeping properties that also exist (same key + kind) on the new type. */
export async function convertType(id: string, newTypeId: string) {
  const [obj, newType] = await Promise.all([db.objects.get(id), db.types.get(newTypeId)]);
  if (!obj || !newType) return;
  const cur = await db.types.get(obj.typeId);
  const props: Record<string, any> = {};
  for (const def of newType.properties) {
    const oldDef = cur?.properties.find((d) => d.key === def.key && d.kind === def.kind);
    if (oldDef && obj.props[def.key] !== undefined) props[def.key] = obj.props[def.key];
  }
  await saveObject(id, { typeId: newTypeId, props, dailyDate: newTypeId === 'daily' ? obj.dailyDate : null });
}

/** Write a task change back into the exact node of its source object. */
export async function updateTask(taskId: string, patch: { checked?: boolean; due?: string | null }) {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  const obj = await db.objects.get(task.objectId);
  if (!obj) return;
  const next = patchTaskInDoc(obj.content, taskId, patch);
  if (next) await saveObject(obj.id, { content: next });
}

/** Rebuild links/tasks for these objects without touching updatedAt (used when sync applies remote changes). */
export async function reindexObjects(ids: string[]) {
  if (!ids.length) return;
  await db.transaction('rw', db.objects, db.links, db.tasks, db.types, async () => {
    for (const id of ids) {
      const o = await db.objects.get(id);
      if (o) await reindex(o);
      else {
        await db.links.where('fromId').equals(id).delete();
        await db.tasks.where('objectId').equals(id).delete();
      }
    }
  });
}

export async function reindexAll() {
  const objs = await db.objects.toArray();
  const types = new Map((await db.types.toArray()).map((t) => [t.id, t]));
  await db.transaction('rw', db.objects, db.links, db.tasks, db.types, async () => {
    for (const o of objs) {
      const content = assignTaskIds(o.content);
      const next = { ...o, content, tags: extractTags(content) };
      await db.objects.put(next);
      await reindex(next, types.get(o.typeId));
    }
  });
}

export type { JSONContent };
