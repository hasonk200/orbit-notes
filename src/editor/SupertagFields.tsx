import { useEffect, useMemo, useState } from 'react';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { ObjType, PropertyDef } from '../db/schema';
import { MenuSelect } from '../components/MenuSelect';
import { RelationPicker } from '../components/PropertyPanel';
import { supertagTypes, type ItemFields } from '../lib/supertags';
import { optionLabel, propertyLabel } from '../lib/typeLabels';
import { useData } from '../store/dataStore';
import { useT, useUI } from '../store/uiStore';

/** Tags written in the item's own first line. */
export function itemTagNames(node: PMNode) {
  const out: string[] = [];
  node.firstChild?.forEach((c) => {
    if (c.type.name === 'tag' && c.attrs.name) out.push(String(c.attrs.name).toLowerCase());
  });
  return out;
}

/** Supertag types that apply to this item. */
export function useItemSupertags(node: PMNode) {
  const types = useData((s) => s.types);
  const names = itemTagNames(node).join('\n');
  return useMemo(() => supertagTypes(types, names ? names.split('\n') : []).filter((t) => t.properties.length), [types, names]);
}

function TextField({ value, kind, onCommit, editable }: { value: unknown; kind: string; onCommit: (v: unknown) => void; editable: boolean }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  useEffect(() => setV(value == null ? '' : String(value)), [value]);
  const commit = () => {
    if (v === (value == null ? '' : String(value))) return;
    onCommit(kind === 'number' ? (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v)) : v.trim() || null);
  };
  return (
    <input
      className="st-input"
      type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
      inputMode={kind === 'number' ? 'decimal' : undefined}
      value={v}
      size={Math.max(4, Math.min(28, v.length + 1))}
      placeholder="—"
      disabled={!editable}
      onChange={(e) => {
        setV(e.target.value);
        if (kind === 'date') onCommit(e.target.value || null);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function FieldEditor({ def, type, value, onChange, editable }: { def: PropertyDef; type: ObjType; value: unknown; onChange: (v: unknown) => void; editable: boolean }) {
  const tr = useT();
  switch (def.kind) {
    case 'checkbox':
      return <input type="checkbox" className="st-check" checked={!!value} disabled={!editable} onChange={(e) => onChange(e.target.checked || null)} />;
    case 'select':
      return (
        <MenuSelect
          look="bare"
          className="st-select"
          label={propertyLabel(type, def, tr)}
          value={value == null ? '' : String(value)}
          disabled={!editable}
          onChange={(v) => onChange(v || null)}
          options={[{ value: '', label: '—' }, ...(def.options ?? []).map((o) => ({ value: o, label: optionLabel(type, def, o, tr) }))]}
        />
      );
    case 'relation':
      return <RelationPicker def={def} value={value} onChange={onChange} />;
    default:
      return <TextField value={value} kind={def.kind} onCommit={onChange} editable={editable} />;
  }
}

/** Field rows for a list or task item that carries one or more supertags. */
export function SupertagFields({ node, types, updateAttributes, editable }: { node: PMNode; types: ObjType[]; updateAttributes: (attrs: Record<string, unknown>) => void; editable: boolean }) {
  const tr = useT();
  const setTypeEditor = useUI((s) => s.setTypeEditor);
  const fields = (node.attrs.fields as ItemFields | null) ?? {};
  const set = (typeId: string, key: string, v: unknown) => {
    const current = { ...(fields[typeId] ?? {}) };
    if (v == null || v === '' || v === false) delete current[key];
    else current[key] = v;
    const next = { ...fields, [typeId]: current };
    if (!Object.keys(current).length) delete next[typeId];
    updateAttributes({ fields: Object.keys(next).length ? next : null });
  };
  return (
    <div className="st-fields" contentEditable={false}>
      {types.map((t) =>
        t.properties.map((def) => (
          <label key={t.id + def.key} className="st-field" style={{ ['--type-color' as string]: t.color }}>
            <span className="st-label" title={`#${t.tag}`}>
              {propertyLabel(t, def, tr)}
            </span>
            <FieldEditor def={def} type={t} value={fields[t.id]?.[def.key]} onChange={(v) => set(t.id, def.key, v)} editable={editable} />
          </label>
        )),
      )}
      {editable && (
        <button type="button" className="st-edit" title={tr('Edit fields for #{tag}', { tag: types[0].tag ?? '' })} onClick={() => setTypeEditor(types[0].id)}>
          ⚙︎
        </button>
      )}
    </div>
  );
}
