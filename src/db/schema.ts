import Dexie, { type Table } from 'dexie';

export const SCHEMA_VERSION = 3;

export type JSONContent = {
  type?: string;
  attrs?: Record<string, any>;
  content?: JSONContent[];
  marks?: { type: string; attrs?: Record<string, any> }[];
  text?: string;
};

export type PropertyKind = 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'url' | 'relation';

export interface PropertyDef {
  key: string;
  name: string;
  kind: PropertyKind;
  options?: string[]; // select
  targetTypeId?: string | null; // relation (null = any type)
  multi?: boolean; // relation
}

export interface ObjType {
  id: string;
  name: string;
  icon: string; // emoji
  color: string; // hex
  properties: PropertyDef[];
  defaultTemplate?: JSONContent | null;
  /** Supertag: list and task items tagged #tag show this type's properties as fields. */
  tag?: string | null;
  builtin?: boolean;
  order: number;
  updatedAt?: number;
}

export interface Obj {
  id: string;
  typeId: string;
  title: string;
  icon?: string | null;
  cover?: string | null; // blobId
  props: Record<string, any>;
  content: JSONContent;
  tags: string[];
  collectionIds?: string[];
  createdAt: number;
  updatedAt: number;
  dailyDate?: string | null; // yyyy-MM-dd for daily notes
  deletedAt?: number | null;
  syncConflictOf?: string;
  syncConflictDeleted?: boolean;
  /** Notes left for future AI sessions (and by the user for them), kept apart from the body. */
  aiNotes?: AiNote[];
}

export interface AiNote {
  id: string;
  at: number;
  /** Which AI app wrote it, or 'me' for the user. */
  by: string;
  text: string;
}

export interface CollectionRec {
  id: string;
  typeId: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  order: number;
  createdAt: number;
  updatedAt?: number;
  deletedAt?: number | null;
}

export interface BlobRec {
  id: string;
  mimeType: string;
  data: Blob;
  size: number;
  width?: number;
  height?: number;
  createdAt: number;
}

export interface LinkRec {
  id: string;
  fromId: string;
  toId: string;
  source: 'content' | 'property';
  propKey?: string;
}

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'open' | 'not_started' | 'next_up' | 'in_progress' | 'done';
export type TaskKind = 'todo' | 'task';

export interface TaskRec {
  id: string; // taskId (stable UUID on the TipTap node)
  objectId: string;
  contextId?: string | null; // optional explicit context object (defaults to objectId)
  text: string;
  done: boolean;
  status: TaskStatus;
  kind: TaskKind; // effective kind (derived at index time when not explicit)
  explicitKind?: TaskKind | null; // only present when user/MCP explicitly chose kind
  due?: string | null; // yyyy-MM-dd
  priority?: TaskPriority | null;
  completedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface MetaRec {
  key: string;
  value: any;
}

export interface ObjectSyncBase {
  account: string;
  objectId: string;
  local: string | null;
  cloud: string | null;
}

class OrbitDB extends Dexie {
  meta!: Table<MetaRec, string>;
  types!: Table<ObjType, string>;
  collections!: Table<CollectionRec, string>;
  objects!: Table<Obj, string>;
  blobs!: Table<BlobRec, string>;
  links!: Table<LinkRec, string>;
  tasks!: Table<TaskRec, string>;
  objectSyncBases!: Table<ObjectSyncBase, [string, string]>;

  constructor() {
    super('orbit');
    this.version(1).stores({
      meta: 'key',
      types: 'id, order',
      objects: 'id, typeId, dailyDate, createdAt, updatedAt, *tags',
      blobs: 'id',
      links: 'id, fromId, toId',
      tasks: 'id, objectId, due',
    });
    this.version(2).stores({
      meta: 'key',
      types: 'id, order',
      collections: 'id, typeId, order',
      objects: 'id, typeId, dailyDate, createdAt, updatedAt, *tags',
      blobs: 'id',
      links: 'id, fromId, toId',
      tasks: 'id, objectId, due',
    });
    this.version(3).stores({ objectSyncBases: '[account+objectId], account' });
  }
}

export const db = new OrbitDB();

export { uid } from '../lib/uid';

export async function getMeta<T = any>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value;
}
export async function setMeta(key: string, value: any) {
  await db.meta.put({ key, value });
}
