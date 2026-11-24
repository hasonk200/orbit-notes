import type { JSONContent, Obj, ObjType } from '../db/schema';

/**
 * Supertags (Tana style): a type with `tag` set turns #tag into a template. Any list or task item
 * carrying that tag shows the type's properties as fields; values live on the item (`attrs.fields`).
 */

export type ItemFields = Record<string, Record<string, unknown>>; // typeId → property key → value

export const normalizeTagName = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}_\-/]+/gu, '-')
    .replace(/^-+|-+$/g, '');

/** Types that act as supertags for any of the given tag names, in type order. */
export function supertagTypes(types: readonly ObjType[], tagNames: readonly string[]) {
  if (!tagNames.length) return [];
  return types.filter((t) => t.tag && tagNames.includes(t.tag));
}

export const supertagFor = (types: readonly ObjType[], tag: string) => types.find((t) => t.tag === tag);

/** Tags written directly in one block (not in nested blocks). */
export function blockTags(block: JSONContent | undefined): string[] {
  const out: string[] = [];
  for (const c of block?.content ?? []) if (c.type === 'tag' && c.attrs?.name) out.push(String(c.attrs.name).toLowerCase());
  return out;
}

function blockText(block: JSONContent, titleOf?: (id: string) => string) {
  return (block.content ?? [])
    .map((c) => {
      if (c.type === 'text') return c.text ?? '';
      if (c.type === 'objectLink') return titleOf?.(c.attrs?.id) ?? '';
      if (c.type === 'dateRef') return c.attrs?.date ?? '';
      if (c.type === 'hardBreak') return ' ';
      return '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TaggedItem {
  objectId: string;
  /** Child indexes from the document root to the item, for jumping to it. */
  path: number[];
  text: string;
  tags: string[];
  fields: ItemFields;
  /** null for items that are not to-dos */
  done: boolean | null;
  isItem: boolean;
}

/** Every tagged list item, task item, paragraph or heading across the given notes. */
export function collectTaggedItems(objects: readonly Obj[], titleOf?: (id: string) => string): TaggedItem[] {
  const out: TaggedItem[] = [];
  for (const o of objects) {
    if (o.deletedAt) continue;
    const visit = (node: JSONContent, path: number[]) => {
      const kids = node.content ?? [];
      if (node.type === 'listItem' || node.type === 'taskItem') {
        const first = kids[0];
        const tags = blockTags(first);
        if (first && tags.length) {
          out.push({
            objectId: o.id,
            path,
            text: blockText(first, titleOf),
            tags,
            fields: (node.attrs?.fields as ItemFields | null) ?? {},
            done: node.type === 'taskItem' ? !!node.attrs?.checked || node.attrs?.status === 'done' : null,
            isItem: true,
          });
        }
        kids.forEach((c, i) => i > 0 && visit(c, [...path, i]));
        return;
      }
      if (node.type === 'paragraph' || node.type === 'heading') {
        const tags = blockTags(node);
        if (tags.length) out.push({ objectId: o.id, path, text: blockText(node, titleOf), tags, fields: {}, done: null, isItem: false });
        return;
      }
      kids.forEach((c, i) => visit(c, [...path, i]));
    };
    visit(o.content, []);
  }
  return out;
}

export interface LiveQuery {
  tag: string;
  text?: string;
  /** property key of the tag's supertag, filtered by `value` */
  field?: string;
  value?: string;
  hideDone?: boolean;
  sort?: string;
  desc?: boolean;
}

const lower = (v: unknown) => String(v ?? '').toLowerCase();

/** Filter and sort tagged items for a live search. */
export function runLiveQuery(items: readonly TaggedItem[], q: LiveQuery, type: ObjType | undefined, objTitle: (id: string) => string) {
  const tag = normalizeTagName(q.tag ?? '');
  if (!tag) return [];
  const def = q.field ? type?.properties.find((p) => p.key === q.field) : undefined;
  const value = (q.value ?? '').trim();
  const text = (q.text ?? '').trim().toLowerCase();
  const valueOf = (it: TaggedItem, key: string) => (type ? it.fields[type.id]?.[key] : undefined);
  const list = items.filter((it) => {
    if (!it.tags.includes(tag)) return false;
    if (q.hideDone && it.done) return false;
    if (text && !it.text.toLowerCase().includes(text)) return false;
    if (def && value) {
      const v = valueOf(it, def.key);
      if (value === '∅') return v == null || v === '' || (Array.isArray(v) && !v.length);
      if (def.kind === 'checkbox') return !!v === (value === 'yes');
      if (def.kind === 'select') return lower(v) === value.toLowerCase();
      return lower(v).includes(value.toLowerCase());
    }
    return true;
  });
  const sortKey = q.sort ?? '';
  const dir = q.desc ? -1 : 1;
  const cmp = (a: unknown, b: unknown) => {
    const ea = a == null || a === '';
    const eb = b == null || b === '';
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // blanks last
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir;
    return String(a).localeCompare(String(b), undefined, { numeric: true }) * dir;
  };
  if (sortKey === 'text') return [...list].sort((a, b) => cmp(a.text, b.text));
  if (sortKey === 'note') return [...list].sort((a, b) => cmp(objTitle(a.objectId), objTitle(b.objectId)));
  if (sortKey) return [...list].sort((a, b) => cmp(valueOf(a, sortKey), valueOf(b, sortKey)));
  return list;
}

/** Document position of the node at `path`, or null when the path no longer exists. */
export function posAtPath(doc: { childCount: number; child: (i: number) => { nodeSize: number; childCount: number; child: (i: number) => any } }, path: number[]) {
  let node = doc;
  let pos = 0;
  for (let depth = 0; depth < path.length; depth++) {
    const idx = path[depth];
    if (idx >= node.childCount) return null;
    for (let k = 0; k < idx; k++) pos += node.child(k).nodeSize;
    if (depth < path.length - 1) {
      node = node.child(idx);
      pos += 1;
    }
  }
  return pos;
}
