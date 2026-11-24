import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { JSONContent, Obj, ObjType } from '../../src/db/schema';
import { assignTaskIds, docText, emptyDoc, extractTags, extractTasks, patchTaskInDoc, walk } from '../../src/lib/content';
import { dailyTitle } from '../../src/lib/dates';
import { markdownToBlocks } from '../../src/lib/markdown';
import { appendTask } from '../../src/lib/taskInput';
import { classifyTaskKind } from '../../src/lib/tasks';
import { objectFingerprint } from '../../src/sync/objectVersions';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const READ = 'orbit:read';
export const WRITE = 'orbit:write';
export type Actor = { uid: string; grantId: string; name: string; scopes: string[] };
export const account = (db: Firestore, uid: string) => db.collection('orbitAiAccounts').doc(uid);

const id = z.string().regex(/^[^/\x00-\x1f\x7f]+$/u).max(400).refine((value) => value !== '.' && value !== '..' && !/^__.*__$/.test(value));
const date = z.iso.date();
const page = z.number().int().min(1).max(50).default(20);
const text = z.string().trim().min(1).max(20000);
const markdown = z.string().trim().min(1).max(100000).describe('Markdown: # headings, - bullets, 1. numbered, - [ ] / - [x] to-dos, > quotes, ``` code, | tables |, **bold**, *italic*, `code`, [text](url). Plain lines become paragraphs.');
const title = z.string().trim().min(1).max(500);
const request = { request_id: z.uuid().describe('Unique request UUID. Reuse the same ID when retrying this exact write.') };
const target = { note_id: id };
const existing = { ...target, version: z.string().max(100).describe('Version from get_note or search results.') };
const taskKind = z.enum(['todo', 'task']);
const taskFields = {
  due: date.nullable().optional(),
  priority: z.enum(['high', 'medium', 'low']).nullable().optional(),
  kind: taskKind.nullable().optional().describe('Explicitly mark as a one-off "todo" or a project "task". Omit to auto-classify.'),
};

export const operations = {
  search_notes: { description: 'Search synced notes in your Orbit account. Use the next cursor to continue across pages.', input: z.object({
    query: z.string().max(300).default(''), type_id: id.optional(), from_date: date.optional(), to_date: date.optional(),
    in_trash: z.boolean().default(false), limit: page, cursor: z.string().max(1000).optional(),
  }), write: false },
  get_note: { description: 'Read a note, its version, and its tasks. Use next_offset to read more text.', input: z.object({
    ...target, offset: z.number().int().min(0).max(1000000).default(0),
  }), write: false },
  list_tasks: { description: 'List synced tasks and to-dos with their source notes. Filter by kind ("todo" or "task"), completion, or due date, and follow next_cursor for more.', input: z.object({
    done: z.boolean().optional(), kind: taskKind.optional(), due_from: date.optional(), due_to: date.optional(), limit: page, cursor: z.string().max(1000).optional(),
  }), write: false },
  list_changes: { description: 'List recent AI changes, including undo records.', input: z.object({
    limit: page, before: z.string().max(1000).optional(),
  }), write: false },
  get_change: { description: 'Read the saved note text before a particular AI change.', input: z.object({
    change_id: z.uuid(), offset: z.number().int().min(0).max(1000000).default(0),
  }), write: false },
  create_note: { description: 'Create a note. Defaults to a Page. Use append_daily_note for a dated journal entry.', input: z.object({
    ...request, title, text: markdown.optional(), type_id: id.optional(),
  }), write: true },
  append_daily_note: { description: 'Append Markdown text to the daily note for the given local calendar date, creating it if needed.', input: z.object({
    ...request, date, text: markdown,
  }), write: true },
  append_to_note: { description: 'Append Markdown text to a note, preserving existing content and updating the latest saved version.', input: z.object({
    ...request, ...target, text: markdown,
  }), write: true },
  update_note: { description: 'Rename a note, replace one unique text fragment inside a single editor text node (keeps formatting and links), or rewrite the whole body from Markdown with replace_body. replace_body drops links to other notes, tags, dates and task details (due date, priority) that the new Markdown does not repeat; the change can be undone with undo_change.', input: z.object({
    ...request, ...existing, title: title.optional(), replace_text: z.object({ from: text, to: z.string().max(20000) }).optional(),
    replace_body: markdown.optional(),
  }).refine((input) => input.title !== undefined || input.replace_text !== undefined || input.replace_body !== undefined, 'Supply a title, a text replacement, or a new body.')
    .refine((input) => !(input.replace_text && input.replace_body), 'Use either replace_text or replace_body, not both.'), write: true },
  add_task: { description: 'Add a linked to-do or project task inside a source note so it appears in Orbit.', input: z.object({
    ...request, ...target, text: z.string().trim().min(1).max(2000), ...taskFields,
  }), write: true },
  update_task: { description: 'Complete, reopen, reschedule, reprioritize, or change kind ("todo" / "task") of a task in its source note. Read the note for the task ID and version.', input: z.object({
    ...request, ...existing, task_id: id, done: z.boolean().optional(), ...taskFields,
  }).refine((input) => input.done !== undefined || input.due !== undefined || input.priority !== undefined || input.kind !== undefined, 'Supply a task change.'), write: true },
  trash_note: { description: 'Move one note to Orbit’s recoverable Trash.', input: z.object({ ...request, ...existing }), write: true },
  restore_note: { description: 'Restore one note from Orbit’s Trash.', input: z.object({ ...request, ...existing }), write: true },
  undo_change: { description: 'Undo one AI change if the note still matches the version written by that change.', input: z.object({
    ...request, change_id: z.uuid(),
  }), write: true },
} as const;

type Operation = keyof typeof operations;
type Change = {
  id: string; note_id: string; title: string; action: Operation; actor: string; created_at: number;
  before_json: string | null; resulting_version: string; request_hash: string; undone_change_id?: string; task_id?: string;
};
type CloudObject = { json?: string; updatedAt: number; deleted?: boolean };

function decode(noteId: string, record?: CloudObject) {
  if (!record || record.deleted) return null;
  const note: Obj = JSON.parse(record.json ?? 'null');
  if (note?.id !== noteId || note.content?.type !== 'doc') throw new ApiError(409, 'This note has an unsupported saved format.');
  return note;
}

const link = (appUrl: URL, noteId: string) => noteId.startsWith('daily-')
  ? new URL('calendar?mode=day&date=' + encodeURIComponent(noteId.slice(6)), appUrl).href
  : new URL('o/' + encodeURIComponent(noteId), appUrl).href;
const version = async (note: Obj) => `${note.updatedAt}:${await objectFingerprint(note)}`;
const normalize = (value: string) => value.normalize('NFKC').toLowerCase();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function summary(note: Obj, appUrl: URL) {
  return {
    id: note.id, title: note.title, type_id: note.typeId, daily_date: note.dailyDate ?? null, tags: note.tags,
    updated_at: note.updatedAt, trashed: !!note.deletedAt, version: await version(note), url: link(appUrl, note.id),
  };
}

function textPage(value: string, offset: number) {
  const end = offset + 12000;
  return { text: value.slice(offset, end), next_offset: value.length > end ? end : null };
}

function cursorEncode(stamp: number, key: string, offset = 0) {
  return Buffer.from(JSON.stringify([stamp, key, offset])).toString('base64url');
}

function cursorDecode(cursor: string) {
  try {
    return z.tuple([z.number().int().nonnegative(), id, z.number().int().nonnegative()]).parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
  } catch {
    throw new ApiError(400, 'Invalid cursor.');
  }
}

function publicChange(change: Change, appUrl: URL) {
  const { before_json, request_hash, ...details } = change;
  return { ...details, has_previous_version: before_json !== null, url: link(appUrl, change.note_id) };
}

function appendText(content: JSONContent, body: string): JSONContent {
  const added = markdownToBlocks(body);
  const blocks = content.content ?? [];
  const empty = blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].content?.length;
  return assignTaskIds({ ...content, content: [...(empty ? [] : blocks), ...added] });
}

function replaceBody(content: JSONContent, body: string): JSONContent {
  const blocks = markdownToBlocks(body);
  return assignTaskIds({ ...content, content: blocks.length ? blocks : [{ type: 'paragraph' }] });
}

function replaceText(content: JSONContent, from: string, to: string) {
  const next = structuredClone(content);
  const matches: { parent: JSONContent; node: JSONContent; index: number }[] = [];
  walk(next, (node, parent) => {
    if (node.type !== 'text' || !node.text || !parent) return;
    let offset = node.text.indexOf(from);
    while (offset !== -1) {
      matches.push({ parent, node, index: offset });
      offset = node.text.indexOf(from, offset + 1);
    }
  });
  if (matches.length !== 1) throw new ApiError(409, 'The text must occur exactly once inside one editor text node.');
  const { parent, node, index } = matches[0];
  const updated = node.text!.slice(0, index) + to + node.text!.slice(index + from.length);
  if (updated.includes('\n') || updated.includes('\r')) throw new ApiError(400, 'Use append_to_note to add paragraphs.');
  if (updated) node.text = updated;
  else parent.content = parent.content!.filter((child) => child !== node);
  return next;
}

function makeNote(noteId: string, typeId: string, noteTitle: string, now: number, dailyDate: string | null, template?: JSONContent | null): Obj {
  return {
    id: noteId, typeId, title: noteTitle, icon: null, cover: null, props: {},
    content: template ? assignTaskIds(template, true) : emptyDoc(), tags: [], createdAt: now, updatedAt: now,
    dailyDate, deletedAt: null,
  };
}

export function createNotesService(db: Firestore, appUrl: URL) {
  async function invoke(name: string, raw: unknown, actor: Actor) {
    if (!Object.hasOwn(operations, name)) throw new ApiError(404, 'Unknown operation.');
    const operation = name as Operation;
    const definition = operations[operation];
    if (!actor.scopes.includes(definition.write ? WRITE : READ)) throw new ApiError(403, 'This connection does not have permission for this operation.');
    const validation = definition.input.safeParse(raw);
    if (!validation.success) throw new ApiError(400, validation.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; '));
    const notes = db.collection('users').doc(actor.uid).collection('objects');
    const changes = account(db, actor.uid).collection('changes');

    async function resolveLinkedTypes(linkIds: string[], cache: Map<string, string | null>) {
      const missing = linkIds.filter((lid) => !cache.has(lid));
      if (missing.length) {
        const snaps = await db.getAll(...missing.map((lid) => notes.doc(lid)));
        for (const snap of snaps) {
          let decoded: Obj | null = null;
          try { decoded = decode(snap.id, snap.data() as CloudObject | undefined); } catch { decoded = null; }
          cache.set(snap.id, decoded?.typeId ?? null);
        }
      }
      return linkIds.map((lid) => cache.get(lid));
    }

    switch (operation) {
      case 'get_note': {
        const input = operations.get_note.input.parse(validation.data);
        const note = decode(input.note_id, (await notes.doc(input.note_id).get()).data() as CloudObject | undefined);
        if (!note) throw new ApiError(404, 'Note not found.');
        const rawTasks = extractTasks(note.content, (key) => `[[${key}]]`).slice(0, 100);
        const typeCache = new Map<string, string | null>([[note.id, note.typeId]]);
        const allLinkIds = [...new Set(rawTasks.flatMap((t) => (t.explicitKind ? [] : t.linkIds)))];
        if (allLinkIds.length) await resolveLinkedTypes(allLinkIds, typeCache);
        const tasks = rawTasks.map((t) => ({
          ...t,
          kind: classifyTaskKind({
            explicitKind: t.explicitKind,
            status: t.status,
            contextId: t.contextId,
            sourceTypeId: note.typeId,
            linkedTypes: t.linkIds.map((lid) => typeCache.get(lid)),
          }),
        }));
        return { ...await summary(note, appUrl), ...textPage(docText(note.content, (key) => `[[${key}]]`), input.offset), tasks };
      }
      case 'search_notes': {
        const input = operations.search_notes.input.parse(validation.data);
        if (input.from_date && input.to_date && input.from_date > input.to_date) throw new ApiError(400, 'The start date must precede the end date.');
        let query = notes.orderBy('updatedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
        if (input.cursor) {
          const [stamp, key] = cursorDecode(input.cursor);
          query = query.startAfter(stamp, key);
        }
        const scanLimit = 40;
        const batch = await query.limit(scanLimit).get();
        const terms = normalize(input.query).trim().split(/\s+/u).filter(Boolean);
        const matches = [];
        let consumed = 0;
        for (const item of batch.docs) {
          consumed += 1;
          let note: Obj | null;
          try { note = decode(item.id, item.data() as CloudObject); } catch { continue; }
          if (!note || !!note.deletedAt !== input.in_trash || (input.type_id && input.type_id !== note.typeId)) continue;
          const day = note.dailyDate ?? new Date(note.updatedAt).toISOString().slice(0, 10);
          if ((input.from_date && day < input.from_date) || (input.to_date && day > input.to_date)) continue;
          const body = docText(note.content);
          const haystack = normalize([note.title, body, ...note.tags].join('\n'));
          if (!terms.every((term) => haystack.includes(term))) continue;
          matches.push({ ...await summary(note, appUrl), preview: body.slice(0, 500) });
          if (matches.length === input.limit) break;
        }
        const last = batch.docs[consumed - 1];
        const more = consumed < batch.size || batch.size === scanLimit;
        return { notes: matches, next_cursor: more && last ? cursorEncode(last.get('updatedAt'), last.id) : null };
      }
      case 'list_tasks': {
        const input = operations.list_tasks.input.parse(validation.data);
        if (input.due_from && input.due_to && input.due_from > input.due_to) throw new ApiError(400, 'The start date must precede the end date.');
        let query = notes.orderBy('updatedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
        const cursor = input.cursor ? cursorDecode(input.cursor) : null;
        if (cursor) query = cursor[2] ? query.startAt(cursor[0], cursor[1]) : query.startAfter(cursor[0], cursor[1]);
        const batch = await query.limit(40).get();
        const typeCache = new Map<string, string | null>();
        const results = [];
        for (const [index, row] of batch.docs.entries()) {
          let note: Obj | null;
          try { note = decode(row.id, row.data() as CloudObject); } catch { continue; }
          if (!note || note.deletedAt || note.syncConflictOf) continue;
          typeCache.set(note.id, note.typeId);
          const tasks = extractTasks(note.content);
          const offset = cursor && row.id === cursor[1] && row.get('updatedAt') === cursor[0] ? cursor[2] : 0;
          const neededLinks = [...new Set(tasks.slice(offset).flatMap((t) => (t.explicitKind ? [] : t.linkIds)))];
          if (neededLinks.length) await resolveLinkedTypes(neededLinks, typeCache);
          let noteVersion: string | undefined;
          for (let i = offset; i < tasks.length; i++) {
            const item = tasks[i];
            if (!item.text || (input.done !== undefined && item.done !== input.done)) continue;
            if ((input.due_from && (!item.due || item.due < input.due_from)) ||
                (input.due_to && (!item.due || item.due > input.due_to))) continue;
            const kind = classifyTaskKind({
              explicitKind: item.explicitKind,
              status: item.status,
              contextId: item.contextId,
              sourceTypeId: note.typeId,
              linkedTypes: item.linkIds.map((lid) => typeCache.get(lid)),
            });
            if (input.kind !== undefined && kind !== input.kind) continue;
            noteVersion ??= await version(note);
            results.push({ ...item, kind, note_id: note.id, note_title: note.title, note_version: noteVersion, url: link(appUrl, note.id) });
            if (results.length === input.limit) {
              const withinNote = i + 1 < tasks.length;
              const more = withinNote || index + 1 < batch.size || batch.size === 40;
              return { tasks: results, next_cursor: more ? cursorEncode(row.get('updatedAt'), row.id, withinNote ? i + 1 : 0) : null };
            }
          }
        }
        const last = batch.docs.at(-1);
        return { tasks: results, next_cursor: batch.size === 40 && last ? cursorEncode(last.get('updatedAt'), last.id) : null };
      }
      case 'list_changes': {
        const input = operations.list_changes.input.parse(validation.data);
        let query = changes.orderBy('created_at', 'desc').orderBy(FieldPath.documentId(), 'desc');
        if (input.before) {
          const [stamp, key] = cursorDecode(input.before);
          query = query.startAfter(stamp, key);
        }
        const batch = await query.limit(input.limit + 1).get();
        const entries = batch.docs.slice(0, input.limit).map((entry) => entry.data() as Change);
        const last = entries.at(-1);
        return {
          changes: entries.map((entry) => publicChange(entry, appUrl)),
          next_cursor: batch.size > input.limit && last ? cursorEncode(last.created_at, last.id) : null,
        };
      }
      case 'get_change': {
        const input = operations.get_change.input.parse(validation.data);
        const change = (await changes.doc(input.change_id).get()).data() as Change | undefined;
        if (!change) throw new ApiError(404, 'Change not found.');
        const previous = change.before_json ? JSON.parse(change.before_json) as Obj : null;
        return { ...publicChange(change, appUrl), before: previous ? {
          title: previous.title, trashed: !!previous.deletedAt, ...textPage(docText(previous.content, (key) => `[[${key}]]`), input.offset),
        } : null };
      }
    }

    const input = validation.data as { request_id: string };
    const changeRef = changes.doc(input.request_id);
    const requestHash = hash(JSON.stringify([operation, validation.data, actor.grantId]));
    const newNoteId = randomUUID();
    const newTaskId = randomUUID();
    const mutation = await db.runTransaction(async (tx) => {
      if (actor.grantId !== 'orbit-owner') {
        const grantRef = account(db, actor.uid).collection('grants').doc(actor.grantId);
        const grant = (await tx.get(grantRef)).data();
        if (!grant || grant.revokedAt || grant.expiresAt <= Date.now()) throw new ApiError(401, 'This connection has expired or was revoked.');
      }
      const existingChange = (await tx.get(changeRef)).data() as Change | undefined;
      if (existingChange) {
        if (existingChange.request_hash !== requestHash) throw new ApiError(409, 'This request ID was already used for a different operation.');
        return existingChange;
      }

      const args = validation.data as { note_id?: string; date?: string; change_id?: string; version?: string };
      let undone: Change | undefined;
      if (operation === 'undo_change') {
        undone = (await tx.get(changes.doc(args.change_id!))).data() as Change | undefined;
        if (!undone) throw new ApiError(404, 'Change not found.');
      }
      const noteId = undone?.note_id ?? args.note_id ?? (args.date ? 'daily-' + args.date : newNoteId);
      const noteRef = notes.doc(noteId);
      const snapshot = await tx.get(noteRef);
      const before = decode(noteId, snapshot.data() as CloudObject | undefined);
      if (!before && operation !== 'create_note' && operation !== 'append_daily_note') throw new ApiError(404, 'Note not found.');
      if (snapshot.exists && !before && operation === 'append_daily_note') throw new ApiError(409, 'This day has a permanently deleted note. Open the day in Orbit first.');
      if (before?.syncConflictOf) throw new ApiError(409, 'Resolve this sync conflict in Orbit before making AI changes to it.');
      const expected = undone?.resulting_version ?? args.version;
      if (expected && (!before || await version(before) !== expected)) throw new ApiError(409, 'The note has changed. Read its latest version before editing, or review the change in Orbit.');
      if (before?.deletedAt && operation !== 'restore_note' && operation !== 'undo_change') throw new ApiError(409, 'Restore this note from Trash before editing it.');

      const now = Math.max(Date.now(), (before?.updatedAt ?? 0) + 1);
      let after: Obj;
      let taskId: string | undefined;
      switch (operation) {
        case 'create_note': {
          const args = operations.create_note.input.parse(validation.data);
          const typeId = args.type_id ?? 'page';
          if (typeId === 'daily') throw new ApiError(400, 'Use append_daily_note to create a daily note.');
          const typeRecord = (await tx.get(db.collection('users').doc(actor.uid).collection('types').doc(typeId))).data();
          const type = typeRecord && !typeRecord.deleted && typeRecord.json ? JSON.parse(typeRecord.json) as ObjType : null;
          if (!type && typeId !== 'page') throw new ApiError(404, 'This note type has not synced to Orbit.');
          after = makeNote(noteId, typeId, args.title, now, null, type?.defaultTemplate);
          if (args.text) after.content = appendText(after.content, args.text);
          break;
        }
        case 'append_daily_note': {
          const args = operations.append_daily_note.input.parse(validation.data);
          const note = before ?? makeNote(noteId, 'daily', dailyTitle(args.date), now, args.date);
          after = { ...note, content: appendText(note.content, args.text) };
          break;
        }
        case 'append_to_note': {
          const args = operations.append_to_note.input.parse(validation.data);
          after = { ...before!, content: appendText(before!.content, args.text) };
          break;
        }
        case 'update_note': {
          const args = operations.update_note.input.parse(validation.data);
          const replacement = args.replace_text;
          after = { ...before!, title: args.title ?? before!.title,
            content: replacement ? replaceText(before!.content, replacement.from, replacement.to)
              : args.replace_body !== undefined ? replaceBody(before!.content, args.replace_body) : before!.content };
          break;
        }
        case 'add_task': {
          const args = operations.add_task.input.parse(validation.data);
          taskId = newTaskId;
          after = {
            ...before!,
            content: appendTask(before!.content, taskId, args.text, args.due ?? null, args.priority ?? null, { kind: args.kind ?? null }),
          };
          break;
        }
        case 'update_task': {
          const args = operations.update_task.input.parse(validation.data);
          taskId = args.task_id;
          const content = patchTaskInDoc(before!.content, taskId, {
            ...(args.done !== undefined ? { checked: args.done } : {}),
            ...(args.due !== undefined ? { due: args.due } : {}),
            ...(args.priority !== undefined ? { priority: args.priority } : {}),
            ...(args.kind !== undefined ? { kind: args.kind } : {}),
          });
          if (!content) throw new ApiError(404, 'Task not found in this note.');
          after = { ...before!, content };
          break;
        }
        case 'trash_note':
          after = { ...before!, deletedAt: now };
          break;
        case 'restore_note':
          if (!before!.deletedAt) throw new ApiError(409, 'This note is already active.');
          after = { ...before!, deletedAt: null };
          break;
        case 'undo_change':
          after = undone!.before_json ? JSON.parse(undone!.before_json) as Obj : { ...before!, deletedAt: now };
          break;
      }
      after.updatedAt = now;
      after.tags = extractTags(after.content);
      const json = JSON.stringify(after);
      const beforeJson = before ? JSON.stringify(before) : null;
      if (Buffer.byteLength(json) > 850_000 || (beforeJson && Buffer.byteLength(beforeJson) > 850_000)) {
        throw new ApiError(413, 'This note is too large to edit and keep a recoverable copy.');
      }
      const record: Change = {
        id: input.request_id, note_id: noteId, title: after.title, action: operation, actor: actor.name, created_at: now,
        before_json: beforeJson, resulting_version: await version(after), request_hash: requestHash,
        ...(undone ? { undone_change_id: undone.id } : {}), ...(taskId ? { task_id: taskId } : {}),
      };
      tx.set(noteRef, { json, updatedAt: now, deleted: false });
      tx.create(changeRef, record);
      return record;
    });
    return publicChange(mutation, appUrl);
  }
  return { invoke };
}
