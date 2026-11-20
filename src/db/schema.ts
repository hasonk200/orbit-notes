import Dexie, { type Table } from 'dexie';

export const SCHEMA_VERSION = 1;

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
  createdAt: number;
  updatedAt: number;
  dailyDate?: string | null; // yyyy-MM-dd for daily notes
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

export interface TaskRec {
  id: string; // taskId (stable UUID on the TipTap node)
  objectId: string;
  text: string;
  done: boolean;
  due?: string | null; // yyyy-MM-dd
  createdAt: number;
  updatedAt: number;
}

export interface MetaRec {
  key: string;
  value: any;
}

class OrbitDB extends Dexie {
  meta!: Table<MetaRec, string>;
  types!: Table<ObjType, string>;
  objects!: Table<Obj, string>;
  blobs!: Table<BlobRec, string>;
  links!: Table<LinkRec, string>;
  tasks!: Table<TaskRec, string>;

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
  }
}

export const db = new OrbitDB();

export const uid = () =>
  (crypto as any).randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

export async function getMeta<T = any>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value;
}
export async function setMeta(key: string, value: any) {
  await db.meta.put({ key, value });
}
