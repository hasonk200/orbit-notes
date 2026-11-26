import { db, getMeta, setMeta, uid, type CollectionRec, type JSONContent, type LinkRec, type Obj, type ObjType, type TaskKind, type TaskPriority, type TaskRec, type TaskStatus } from './schema';
import { assignTaskIds, emptyDoc, extractBlobIds, extractLinkIds, extractTags, extractTasks, patchTaskInDoc, patchTasksInDoc, removeTaskFromDoc, type TaskPatch } from '../lib/content';
import { dailyTitle, toISODate } from '../lib/dates';
import { classifyTaskKind } from '../lib/tasks';
import { defaultTemplate } from '../lib/typeLabels';
import { getT, useUI } from '../store/uiStore';
import { AI_LOG_TYPE, aiLogId, aiLogTitle, spaceMark } from '../lib/spaces';
import type { Space } from './schema';

/** Rebuild links / tasks / tags for one object. Must be called inside a rw transaction on objects, links, tasks. */
async function reindex(obj: Obj, type?: ObjType) {
  if (obj.syncConflictOf) {
    await db.links.where('fromId').equals(obj.id).delete();
    await db.tasks.where('objectId').equals(obj.id).delete();
    return;
  }
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
  const linkedTypesById = new Map(linked.filter(Boolean).map((o) => [o!.id, o!.typeId]));
  const titleOf = (id: string) => titles.get(id) ?? 'Deleted object';
  const extracted = extractTasks(obj.content, titleOf);
  const old = await db.tasks.where('objectId').equals(obj.id).toArray();
  const oldMap = new Map(old.map((t) => [t.id, t]));
  const now = Date.now();
  const rows: TaskRec[] = extracted.map((t) => {
    const prev = oldMap.get(t.id);
    const kind = classifyTaskKind({
      explicitKind: t.explicitKind,
      status: t.status,
      contextId: t.contextId,
      sourceTypeId: obj.typeId,
      linkedTypes: t.linkIds.map((lid) => linkedTypesById.get(lid)),
    });
    const changed =
      !prev ||
      prev.text !== t.text ||
      prev.done !== t.done ||
      prev.status !== t.status ||
      prev.kind !== kind ||
      (prev.explicitKind ?? null) !== t.explicitKind ||
      (prev.due ?? null) !== t.due ||
      (prev.priority ?? null) !== t.priority ||
      (prev.contextId ?? null) !== t.contextId ||
      JSON.stringify(prev.aiTodo ?? null) !== JSON.stringify(t.aiTodo);
    return {
      id: t.id,
      objectId: obj.id,
      contextId: t.contextId,
      text: t.text,
      done: t.done,
      status: t.status,
      kind,
      explicitKind: t.explicitKind,
      due: t.due,
      priority: t.priority,
      completedAt: t.done ? (t.completedAt ?? prev?.completedAt ?? now) : null,
      ...(t.aiTodo ? { aiTodo: t.aiTodo } : {}),
      createdAt: prev?.createdAt ?? now,
      updatedAt: changed ? now : prev!.updatedAt,
    };
  });
  await db.tasks.where('objectId').equals(obj.id).delete();
  if (rows.length) await db.tasks.bulkPut(rows);
}

export async function createObject(typeId: string, init: Partial<Obj> = {}): Promise<Obj> {
  const type = await db.types.get(typeId);
  const template = defaultTemplate(type, getT());
  const now = Date.now();
  const obj: Obj = {
    id: uid(),
    typeId,
    title: '',
    icon: null,
    cover: null,
    props: {},
    content: template ? assignTaskIds(template, true) : emptyDoc(),
    tags: [],
    createdAt: now,
    updatedAt: now,
    dailyDate: null,
    deletedAt: null,
    // New notes go to the space you are in, unless the caller says otherwise.
    ...spaceMark(init.space ?? useUI.getState().space),
    ...init,
  };
  if (obj.space !== 'ai') delete obj.space;
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
    if (!Object.keys(patch).length) return;
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
    return await createObject('daily', { id, dailyDate: iso, title: dailyTitle(iso), space: 'me' });
  } catch {
    // Created concurrently (e.g. React strict mode double effect)
    return (await db.objects.get(id))!;
  }
}

/** Today's (or any day's) AI log: one per day, in the AI workspace. */
export async function getOrCreateAiLog(date: string | Date): Promise<Obj> {
  const iso = typeof date === 'string' ? date : toISODate(date);
  const id = aiLogId(iso);
  const existing = await db.objects.get(id);
  if (existing) {
    if (existing.deletedAt) await saveObject(id, { deletedAt: null });
    return existing;
  }
  try {
    return await createObject(AI_LOG_TYPE, { id, dailyDate: iso, title: aiLogTitle(iso), space: 'ai' });
  } catch {
    return (await db.objects.get(id))!;
  }
}

/** The day's own note in a space: the daily note in my space, the AI log in the AI workspace. */
export function getOrCreateDayNote(date: string | Date, space: Space = useUI.getState().space) {
  return space === 'ai' ? getOrCreateAiLog(date) : getOrCreateDaily(date);
}

/** Move a note to the other space. Only the mark changes; links and tasks stay as they are. */
export async function moveToSpace(id: string, space: Space) {
  await saveObject(id, (cur) => ((cur.space === 'ai') === (space === 'ai') ? {} : spaceMark(space)));
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
  await saveObject(id, { typeId: newTypeId, props, collectionIds: [], dailyDate: newTypeId === 'daily' || newTypeId === AI_LOG_TYPE ? obj.dailyDate : null });
}

export async function createCollection(typeId: string, name: string, icon?: string | null): Promise<CollectionRec> {
  const existing = await db.collections.where('typeId').equals(typeId).filter((c) => !c.deletedAt).toArray();
  const now = Date.now();
  const col: CollectionRec = {
    id: uid(),
    typeId,
    name: name.trim() || 'Untitled collection',
    icon: icon ?? '📁',
    color: null,
    order: existing.length,
    createdAt: now,
    updatedAt: now,
  };
  await db.collections.add(col);
  return col;
}

export async function updateCollection(id: string, patch: Partial<Pick<CollectionRec, 'name' | 'icon' | 'color' | 'order'>>) {
  await db.collections.where('id').equals(id).filter((c) => !c.deletedAt).modify((c) => {
    Object.assign(c, patch, { updatedAt: Math.max(Date.now(), (c.updatedAt ?? c.createdAt) + 1) });
  });
}

export async function deleteCollection(id: string) {
  await db.transaction('rw', [db.collections, db.objects], async () => {
    const c = await db.collections.get(id);
    if (!c || c.deletedAt) return;
    const updatedAt = Math.max(Date.now(), (c.updatedAt ?? c.createdAt) + 1);
    await db.collections.update(id, { updatedAt, deletedAt: updatedAt });
    const objs = await db.objects.toArray();
    for (const o of objs) {
      if (o.collectionIds?.includes(id)) {
        await db.objects.put({ ...o, collectionIds: o.collectionIds.filter((c) => c !== id), updatedAt: Date.now() });
      }
    }
  });
}

export async function resolveObjectConflict(copyId: string, useCopy: boolean) {
  await db.transaction('rw', db.objects, db.links, db.tasks, db.types, async () => {
    const copy = await db.objects.get(copyId);
    if (!copy?.syncConflictOf || copy.deletedAt) return;
    const { syncConflictOf: id, syncConflictDeleted, ...version } = copy;
    if (useCopy) {
      const original = await db.objects.get(id);
      const restored: Obj = {
        ...version,
        id,
        dailyDate: original?.dailyDate ?? (id.startsWith('daily-') ? id.slice(6) : null),
        deletedAt: syncConflictDeleted ? Date.now() : null,
        updatedAt: Date.now(),
      };
      await db.objects.put(restored);
      await reindex(restored);
    }
    const now = Date.now();
    await db.objects.put({ ...copy, deletedAt: now, updatedAt: now });
  });
}

export async function toggleObjectCollection(objectId: string, collectionId: string) {
  await saveObject(objectId, (cur) => {
    const list = cur.collectionIds ?? [];
    const next = list.includes(collectionId) ? list.filter((c) => c !== collectionId) : [...list, collectionId];
    return { collectionIds: next };
  });
}

/** Write a task change back into the exact node of its source object. */
export async function updateTask(taskId: string, patch: TaskPatch) {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  await saveObject(task.objectId, (cur) => {
    const content = patchTaskInDoc(cur.content, taskId, patch);
    return content ? { content } : {};
  });
}

/** Reschedule many tasks in a single write per source note (1 sync update + 1 undo step per note). */
export async function rescheduleTasks(taskIds: string[], due: string | null) {
  if (!taskIds.length) return;
  const rows = (await db.tasks.bulkGet(taskIds)).filter(Boolean) as TaskRec[];
  const byObject = new Map<string, Record<string, TaskPatch>>();
  for (const row of rows) {
    const map = byObject.get(row.objectId) ?? {};
    map[row.id] = { due };
    byObject.set(row.objectId, map);
  }
  for (const [objectId, patches] of byObject.entries()) {
    await saveObject(objectId, (cur) => {
      const content = patchTasksInDoc(cur.content, patches);
      return content ? { content } : {};
    });
  }
}

/** Delete a task node cleanly from its source object. */
export async function deleteTask(taskId: string) {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  const obj = await db.objects.get(task.objectId);
  if (!obj) return;
  const next = removeTaskFromDoc(obj.content, taskId);
  if (next) await saveObject(obj.id, { content: next });
}

/** Create a new contextual task inside the chosen target object (or Today's Daily Note). */
export async function createTask(opts: {
  text: string;
  targetObjectId?: string | null;
  contextId?: string | null;
  status?: TaskStatus;
  kind?: TaskKind | null;
  due?: string | null;
  priority?: TaskPriority | null;
}): Promise<string | null> {
  const cleanText = opts.text.trim();
  if (!cleanText) return null;
  const targetId = opts.targetObjectId && opts.targetObjectId !== '__today' ? opts.targetObjectId : null;
  // Without a target, the task goes to today's note of the space you are in.
  const note = targetId ? await db.objects.get(targetId) : await getOrCreateDayNote(toISODate(new Date()));
  if (!note) return null;
  const fresh = await db.objects.get(note.id);
  if (!fresh) return null;

  const status: TaskStatus = opts.status ?? 'open';
  const checked = status === 'done';
  const taskId = uid();
  const content = JSON.parse(JSON.stringify(fresh.content ?? emptyDoc()));
  content.content = content.content ?? [];
  const item = {
    type: 'taskItem',
    attrs: {
      checked,
      taskId,
      status,
      ...(opts.kind ? { kind: opts.kind } : {}),
      due: opts.due ?? null,
      priority: opts.priority ?? null,
      contextId: opts.contextId && opts.contextId !== note.id ? opts.contextId : null,
      completedAt: checked ? Date.now() : null,
    },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: cleanText }] }],
  };
  const last = content.content[content.content.length - 1];
  if (last?.type === 'taskList') last.content.push(item);
  else {
    if (last?.type === 'paragraph' && !last.content?.length) content.content.pop();
    content.content.push({ type: 'taskList', content: [item] });
  }
  await saveObject(note.id, { content });
  return taskId;
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

const TASK_INDEX_VERSION = 1; // bump when derived task fields change (1: task kind)

/**
 * Rebuild derived links/tasks once after an upgrade, so tasks indexed before
 * a new derived field existed get it. Notes themselves are not rewritten,
 * so nothing is re-uploaded to the cloud.
 */
export async function upgradeTaskIndex() {
  if (((await getMeta<number>('taskIndexVersion')) ?? 0) >= TASK_INDEX_VERSION) return;
  const objs = await db.objects.toArray();
  const types = new Map((await db.types.toArray()).map((t) => [t.id, t]));
  await db.transaction('rw', db.objects, db.links, db.tasks, db.types, async () => {
    for (const o of objs) await reindex(o, types.get(o.typeId));
  });
  await setMeta('taskIndexVersion', TASK_INDEX_VERSION);
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
