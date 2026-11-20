import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Folder, Plus, X } from 'lucide-react';
import type { Obj, ObjType, PropertyDef } from '../db/schema';
import { createCollection, createObject, setProp, toggleObjectCollection } from '../db/indexers';
import { displayTitle, useData } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { shortDate } from '../lib/dates';
import { Popover } from './Popover';

export function formatPropValue(def: PropertyDef, v: any, objects: Obj[]): string {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
  switch (def.kind) {
    case 'checkbox':
      return v ? 'Yes' : '';
    case 'date':
      return shortDate(v);
    case 'relation': {
      const ids: string[] = Array.isArray(v) ? v : [v];
      return ids.map((id) => displayTitle(objects.find((o) => o.id === id))).join(', ');
    }
    default:
      return String(v);
  }
}

function TextInput({ value, onCommit, type = 'text', placeholder }: { value: any; onCommit: (v: any) => void; type?: string; placeholder?: string }) {
  const [v, setV] = useState(value ?? '');
  const t = useRef<number>(0);
  useEffect(() => setV(value ?? ''), [value]);
  const commit = (nv: string) => onCommit(type === 'number' ? (nv === '' ? null : Number(nv)) : nv);
  return (
    <input
      className="prop-input"
      type={type}
      value={v}
      placeholder={placeholder ?? 'Empty'}
      onChange={(e) => {
        setV(e.target.value);
        window.clearTimeout(t.current);
        const nv = e.target.value;
        t.current = window.setTimeout(() => commit(nv), 500);
      }}
      onBlur={() => {
        window.clearTimeout(t.current);
        if (String(v) !== String(value ?? '')) commit(v);
      }}
    />
  );
}

export function RelationPicker({ def, value, onChange, selfId }: { def: PropertyDef; value: any; onChange: (v: any) => void; selfId?: string }) {
  const objects = useData((s) => s.objects);
  const types = useData((s) => s.types);
  const open = useOpen();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const btn = useRef<HTMLButtonElement>(null);
  const ids: string[] = Array.isArray(value) ? value : value ? [value] : [];
  const target = types.find((t) => t.id === def.targetTypeId);
  const candidates = objects
    .filter((o) => !o.deletedAt && o.id !== selfId && !ids.includes(o.id))
    .filter((o) => !def.targetTypeId || o.typeId === def.targetTypeId)
    .filter((o) => !q || displayTitle(o).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);
  const add = (id: string) => {
    onChange(def.multi ? [...ids, id] : id);
    setQ('');
    if (!def.multi) setPicking(false);
  };
  const remove = (id: string) => onChange(def.multi ? ids.filter((x) => x !== id) : null);

  return (
    <div className="relation">
      {ids.map((id) => {
        const o = objects.find((x) => x.id === id);
        const t = types.find((x) => x.id === o?.typeId);
        return (
          <span key={id} className={`rel-chip${!o || o.deletedAt ? ' gone' : ''}`} style={{ ['--type-color' as any]: t?.color }}>
            <button type="button" onClick={(e) => o && !o.deletedAt && open(objPath(id), e)}>
              {o?.icon || t?.icon} {o && !o.deletedAt ? displayTitle(o) : 'Deleted object'}
            </button>
            <button type="button" className="rel-x" onClick={() => remove(id)} title="Remove">
              <X size={12} />
            </button>
          </span>
        );
      })}
      {(def.multi || ids.length === 0) && (
        <button type="button" ref={btn} className="rel-add" onClick={() => setPicking(true)}>
          <Plus size={13} /> {ids.length ? '' : `Add ${target?.name ?? 'object'}`}
        </button>
      )}
      {picking && (
        <Popover anchor={btn.current} onClose={() => setPicking(false)} className="rel-picker">
          <input autoFocus placeholder={`Search ${target?.name ?? 'objects'}…`} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="rel-options">
            {candidates.map((o) => (
              <button key={o.id} type="button" onClick={() => add(o.id)}>
                {o.icon || types.find((t) => t.id === o.typeId)?.icon} {displayTitle(o)}
              </button>
            ))}
            {q.trim() && (
              <button
                type="button"
                className="rel-create"
                onClick={async () => {
                  const o = await createObject(def.targetTypeId ?? 'page', { title: q.trim() });
                  add(o.id);
                }}
              >
                <Plus size={13} /> Create {target?.name ?? 'Page'} “{q.trim()}”
              </button>
            )}
            {!q && candidates.length === 0 && <div className="muted small pad">Nothing to link yet.</div>}
          </div>
        </Popover>
      )}
    </div>
  );
}

export function PropertyField({ def, obj }: { def: PropertyDef; obj: Obj }) {
  const value = obj.props?.[def.key];
  const set = (v: any) => setProp(obj.id, def.key, v);
  switch (def.kind) {
    case 'text':
      return <TextInput value={value} onCommit={set} />;
    case 'number':
      return <TextInput value={value} onCommit={set} type="number" />;
    case 'url':
      return (
        <div className="prop-url">
          <TextInput value={value} onCommit={set} placeholder="https://" />
          {value && (
            <a href={/^https?:\/\//.test(value) ? value : `https://${value}`} target="_blank" rel="noopener noreferrer" title="Open link">
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      );
    case 'date':
      return <input className="prop-input" type="date" value={value ?? ''} onChange={(e) => set(e.target.value || null)} />;
    case 'checkbox':
      return <input type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} />;
    case 'select':
      return (
        <select className={`prop-select${value ? ' has-value' : ''}`} value={value ?? ''} onChange={(e) => set(e.target.value || null)}>
          <option value="">Empty</option>
          {(def.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'relation':
      return <RelationPicker def={def} value={value} onChange={set} selfId={obj.id} />;
    default:
      return null;
  }
}

function CollectionPicker({ obj, type }: { obj: Obj; type: ObjType }) {
  const collections = useData((s) => s.collections);
  const open = useOpen();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const btn = useRef<HTMLButtonElement>(null);

  const typeCols = collections.filter((c) => c.typeId === type.id);
  const assignedIds = obj.collectionIds ?? [];
  const assigned = assignedIds.map((id) => typeCols.find((c) => c.id === id)).filter(Boolean);
  const candidates = typeCols.filter((c) => !assignedIds.includes(c.id) && (!q || c.name.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="relation">
      {assigned.map((c) => (
        <span key={c!.id} className="rel-chip col-chip" style={{ ['--type-color' as any]: type.color }}>
          <button type="button" onClick={(e) => open(`/type/${type.id}?collection=${c!.id}`, e)}>
            {c!.icon || '📁'} {c!.name}
          </button>
          <button type="button" className="rel-x" onClick={() => toggleObjectCollection(obj.id, c!.id)} title="Remove from collection">
            <X size={12} />
          </button>
        </span>
      ))}
      <button type="button" ref={btn} className="rel-add" onClick={() => setPicking(true)}>
        <Plus size={13} /> {assigned.length ? '' : 'Add to collection'}
      </button>
      {picking && (
        <Popover anchor={btn.current} onClose={() => setPicking(false)} className="rel-picker">
          <input autoFocus placeholder="Search or create collection…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="rel-options">
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={async () => {
                  await toggleObjectCollection(obj.id, c.id);
                  setQ('');
                }}
              >
                {c.icon || '📁'} {c.name}
              </button>
            ))}
            {q.trim() && !typeCols.some((c) => c.name.toLowerCase() === q.trim().toLowerCase()) && (
              <button
                type="button"
                className="rel-create"
                onClick={async () => {
                  const col = await createCollection(type.id, q.trim());
                  await toggleObjectCollection(obj.id, col.id);
                  setQ('');
                  setPicking(false);
                }}
              >
                <Folder size={13} /> Create collection “{q.trim()}”
              </button>
            )}
            {!q && candidates.length === 0 && <div className="muted small pad">Type a name to create a collection.</div>}
          </div>
        </Popover>
      )}
    </div>
  );
}

export function PropertyPanel({ obj, type }: { obj: Obj; type?: ObjType }) {
  const open = useOpen();
  if (!type) return null;
  const props = type.properties;
  return (
    <div className="props">
      {props.map((def) => (
        <div className="prop-row" key={def.key}>
          <div className="prop-name">{def.name}</div>
          <div className="prop-value">
            <PropertyField def={def} obj={obj} />
          </div>
        </div>
      ))}
      {type.id !== 'daily' && (
        <div className="prop-row">
          <div className="prop-name">Collections</div>
          <div className="prop-value">
            <CollectionPicker obj={obj} type={type} />
          </div>
        </div>
      )}
      {obj.tags.length > 0 && (
        <div className="prop-row">
          <div className="prop-name">Tags</div>
          <div className="prop-value tags-inline">
            {obj.tags.map((t) => (
              <button type="button" key={t} className="tag-chip" onClick={(e) => open(`/tags/${encodeURIComponent(t)}`, e)}>
                #{t}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
