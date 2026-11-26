import { useEffect, useMemo, useState } from 'react';
import { Pencil, Search } from 'lucide-react';
import type { PropertyDef } from '../db/schema';
import { requestJump } from '../editor/jump';
import { collectTaggedItems, normalizeTagName, runLiveQuery, supertagFor, type LiveQuery, type TaggedItem } from '../lib/supertags';
import { optionLabel, propertyLabel } from '../lib/typeLabels';
import { displayTitle, useActiveObjects, useData, useObjMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useT } from '../store/uiStore';
import { MenuSelect } from './MenuSelect';
import { formatPropValue } from './PropertyPanel';

/** All tagged items, recomputed when notes change. */
export function useTaggedItems() {
  const objects = useActiveObjects();
  const objMap = useObjMap();
  return useMemo(() => collectTaggedItems(objects, (id) => displayTitle(objMap.get(id))), [objects, objMap]);
}

function Committed({ value, onCommit, placeholder, list }: { value: string; onCommit: (v: string) => void; placeholder: string; list?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      value={v}
      list={list}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (v !== value) onCommit(v);
        }
      }}
    />
  );
}

function QueryEditor({ query, onChange, tags, defs, typeOf }: { query: LiveQuery; onChange: (q: LiveQuery) => void; tags: string[]; defs: PropertyDef[]; typeOf: ReturnType<typeof supertagFor> }) {
  const tr = useT();
  const def = defs.find((d) => d.key === query.field);
  const listId = useMemo(() => 'ls-tags-' + Math.random().toString(36).slice(2), []);
  return (
    <div className="ls-editor">
      <label>
        <span>{tr('Tag')}</span>
        <span className="ls-hash">
          #
          <Committed value={query.tag ?? ''} placeholder={tr('e.g. bill')} list={listId} onCommit={(tag) => onChange({ ...query, tag: normalizeTagName(tag), field: '', value: '', sort: '' })} />
        </span>
        <datalist id={listId}>
          {tags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>
      <label>
        <span>{tr('Contains text')}</span>
        <Committed value={query.text ?? ''} placeholder={tr('Any')} onCommit={(text) => onChange({ ...query, text })} />
      </label>
      {defs.length > 0 && (
        <label>
          <span>{tr('Field')}</span>
          <span className="ls-where">
            <MenuSelect
              look="field"
              label={tr('Field')}
              value={query.field ?? ''}
              onChange={(field) => onChange({ ...query, field, value: '' })}
              options={[{ value: '', label: tr('Any field') }, ...defs.map((d) => ({ value: d.key, label: propertyLabel(typeOf, d, tr) }))]}
            />
            {def &&
              (def.kind === 'select' || def.kind === 'checkbox' ? (
                <MenuSelect
                  look="field"
                  label={tr('Value')}
                  value={query.value ?? ''}
                  onChange={(value) => onChange({ ...query, value })}
                  options={[
                    { value: '', label: tr('Anything') },
                    ...(def.kind === 'checkbox'
                      ? [
                          { value: 'yes', label: tr('Yes') },
                          { value: 'no', label: tr('No') },
                        ]
                      : (def.options ?? []).map((o) => ({ value: o, label: optionLabel(typeOf, def, o, tr) }))),
                    { value: '∅', label: tr('(empty)') },
                  ]}
                />
              ) : (
                <Committed value={query.value ?? ''} placeholder={tr('contains…')} onCommit={(value) => onChange({ ...query, value })} />
              ))}
          </span>
        </label>
      )}
      <label className="ls-inline">
        <input type="checkbox" checked={!!query.hideDone} onChange={(e) => onChange({ ...query, hideDone: e.target.checked })} />
        {tr('Hide finished to-dos')}
      </label>
    </div>
  );
}

/**
 * Tana-style live search: every item tagged #tag across all notes, with its supertag fields as columns.
 * `onChange` makes the query editable; without it only sorting changes (locally).
 */
export function LiveSearchTable({ query, onChange, editable = true, startEditing = false }: { query: LiveQuery; onChange?: (q: LiveQuery) => void; editable?: boolean; startEditing?: boolean }) {
  const tr = useT();
  const open = useOpen();
  const objMap = useObjMap();
  const types = useData((s) => s.types);
  const items = useTaggedItems();
  const [local, setLocal] = useState(query);
  useEffect(() => setLocal(query), [query]);
  const q = onChange ? query : local;
  const change = (next: LiveQuery) => (onChange ? onChange(next) : setLocal(next));
  const [editing, setEditing] = useState(startEditing);
  const tag = normalizeTagName(q.tag ?? '');
  const type = supertagFor(types, tag);
  const defs = type?.properties ?? [];
  const title = (id: string) => displayTitle(objMap.get(id), tr);
  const rows = useMemo(() => runLiveQuery(items, q, type, (id) => displayTitle(objMap.get(id))), [items, q, type, objMap]);
  const allTags = useMemo(() => [...new Set(items.flatMap((i) => i.tags))].sort(), [items]);

  const jump = (it: TaggedItem, e: React.MouseEvent) => {
    open(objPath(it.objectId), e);
    // Wait for the note's editor to mount before jumping inside it.
    window.setTimeout(() => requestJump(it.objectId, it.path), 60);
  };
  const sortBy = (key: string) => change({ ...q, sort: key, desc: q.sort === key ? !q.desc : false });
  const arrow = (key: string) => (q.sort === key ? (q.desc ? ' ↓' : ' ↑') : '');
  const where = q.field ? defs.find((d) => d.key === q.field) : undefined;

  return (
    <div className="live-search">
      <div className="ls-head">
        <Search size={14} />
        {tag ? (
          <span className="ls-summary">
            <strong>#{tag}</strong>
            {q.text ? <span> · {tr('contains “{text}”', { text: q.text })}</span> : null}
            {where && q.value ? (
              <span>
                {' '}
                · {propertyLabel(type, where, tr)} = {q.value === '∅' ? tr('(empty)') : where.kind === 'checkbox' ? tr(q.value === 'yes' ? 'Yes' : 'No') : q.value}
              </span>
            ) : null}
            {q.hideDone ? <span> · {tr('Hide finished to-dos')}</span> : null}
          </span>
        ) : (
          <span className="ls-summary muted">{tr('Live search: pick a tag to list every item that has it')}</span>
        )}
        <span className="ls-count">{tag ? rows.length : ''}</span>
        {editable && onChange && (
          <button type="button" className={`icon-btn tiny${editing ? ' active' : ''}`} title={tr('Edit search')} onClick={() => setEditing(!editing)}>
            <Pencil size={13} />
          </button>
        )}
      </div>
      {editing && editable && onChange && <QueryEditor query={q} onChange={change} tags={allTags} defs={defs} typeOf={type} />}
      {tag && (
        <div className="ls-table-wrap">
          <table className="ls-table">
            <thead>
              <tr>
                <th onClick={() => sortBy('text')}>{tr('Item')}{arrow('text')}</th>
                {defs.map((d) => (
                  <th key={d.key} onClick={() => sortBy(d.key)}>
                    {propertyLabel(type, d, tr)}
                    {arrow(d.key)}
                  </th>
                ))}
                <th onClick={() => sortBy('note')}>{tr('Source note')}{arrow('note')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => (
                <tr key={it.objectId + ':' + it.path.join('.')} className={it.done ? 'is-done' : ''} onClick={(e) => jump(it, e)} title={tr('Open where this item is written')}>
                  <td className="ls-item">
                    {it.done != null && <span className="ls-check">{it.done ? '☑' : '☐'}</span>}
                    {it.text || <span className="muted">{tr('Untitled')}</span>}
                  </td>
                  {defs.map((d) => (
                    <td key={d.key}>{formatPropValue(d, type ? it.fields[type.id]?.[d.key] : undefined, objMap, type, tr)}</td>
                  ))}
                  <td className="ls-note">{title(it.objectId)}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={defs.length + 2} className="muted ls-empty">
                    {tr('Nothing matches yet. Type #{tag} on any bullet or to-do to add it here.', { tag })}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
