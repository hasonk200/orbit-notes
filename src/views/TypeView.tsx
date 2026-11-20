import { useMemo, useRef, useState } from 'react';
import { ArrowUpDown, FolderPlus, Funnel, LayoutGrid, List, Pencil, Plus, Table, Trash, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { createCollection, createObject, deleteCollection, getOrCreateDaily, updateCollection } from '../db/indexers';
import { displayTitle, useData } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useUI } from '../store/uiStore';
import { todayISO } from '../lib/dates';
import { ObjectCard, ObjectRow } from '../components/ObjectCard';
import { formatPropValue } from '../components/PropertyPanel';
import { TypeIcon } from '../components/TypeIcon';
import { Popover } from '../components/Popover';

type ViewMode = 'grid' | 'list' | 'table';

const COL_ICONS = ['📁', '⭐', '🔥', '📚', '🎯', '💡', '🗂️', '✅', '🌱', '🔖'];

function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function TypeView({ typeId, collectionId }: { typeId: string; collectionId?: string | null }) {
  const type = useData((s) => s.types.find((t) => t.id === typeId));
  const collections = useData((s) => s.collections);
  const objects = useData((s) => s.objects);
  const open = useOpen();
  const setTypeEditor = useUI((s) => s.setTypeEditor);
  const [view, setViewState] = useState<ViewMode>(() => readPref(`orbit-view-${typeId}`, typeId === 'daily' ? 'list' : 'grid'));
  const [sort, setSort] = useState<string>(() => readPref(`orbit-sort-${typeId}`, 'updated'));
  const [filterKey, setFilterKey] = useState('');
  const [filterVal, setFilterVal] = useState('');
  const [addingCol, setAddingCol] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColIcon, setNewColIcon] = useState('📁');
  const [editingCol, setEditingCol] = useState(false);
  const [editColName, setEditColName] = useState('');
  const addColBtn = useRef<HTMLButtonElement>(null);

  const setView = (v: ViewMode) => {
    setViewState(v);
    writePref(`orbit-view-${typeId}`, v);
  };

  const typeCollections = useMemo(() => collections.filter((c) => c.typeId === typeId), [collections, typeId]);
  const activeCol = collectionId ? typeCollections.find((c) => c.id === collectionId) ?? null : null;

  const allOfType = useMemo(() => objects.filter((o) => o.typeId === typeId && !o.deletedAt), [objects, typeId]);

  const colCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of allOfType) {
      for (const cid of o.collectionIds ?? []) m.set(cid, (m.get(cid) ?? 0) + 1);
    }
    return m;
  }, [allOfType]);

  const items = useMemo(() => {
    if (!type) return [];
    let list = activeCol ? allOfType.filter((o) => o.collectionIds?.includes(activeCol.id)) : allOfType;
    if (filterKey && filterVal.trim()) {
      const q = filterVal.trim().toLowerCase();
      if (filterKey === '__title') list = list.filter((o) => displayTitle(o).toLowerCase().includes(q));
      else if (filterKey === '__tag') list = list.filter((o) => o.tags.some((t) => t.includes(q.replace(/^#/, ''))));
      else {
        const def = type.properties.find((p) => p.key === filterKey);
        if (def) list = list.filter((o) => formatPropValue(def, o.props[def.key], objects).toLowerCase().includes(q));
      }
    }
    const [key, dir] = sort.split(':');
    const mul = dir === 'asc' ? 1 : -1;
    const cmp = (a: any, b: any) => (a == null || a === '' ? 1 : b == null || b === '' ? -1 : a < b ? -mul : a > b ? mul : 0);
    return [...list].sort((a, b) => {
      if (key === 'updated') return b.updatedAt - a.updatedAt;
      if (key === 'created') return b.createdAt - a.createdAt;
      if (key === 'title') return displayTitle(a).localeCompare(displayTitle(b));
      if (key === 'daily') return (b.dailyDate ?? '').localeCompare(a.dailyDate ?? '');
      return cmp(a.props[key], b.props[key]);
    });
  }, [allOfType, objects, type, activeCol, sort, filterKey, filterVal]);

  if (!type) return <div className="empty-state"><h2>Unknown type</h2></div>;

  const create = async (e: React.MouseEvent) => {
    const altKey = e.altKey;
    if (typeId === 'daily') {
      await getOrCreateDaily(todayISO());
      return open(`/calendar?mode=day&date=${todayISO()}`, { altKey });
    }
    const o = await createObject(typeId, activeCol ? { collectionIds: [activeCol.id] } : {});
    open(objPath(o.id) + '?new=1', { altKey });
  };

  const submitNewCol = async () => {
    const name = newColName.trim();
    if (!name) return;
    const col = await createCollection(typeId, name, newColIcon);
    setNewColName('');
    setNewColIcon('📁');
    setAddingCol(false);
    open(`/type/${typeId}?collection=${col.id}`);
  };

  const sortable = type.properties.filter((p) => ['text', 'number', 'date', 'select', 'checkbox', 'url'].includes(p.kind));

  return (
    <div className="page wide" style={{ ['--type-color' as any]: type.color }}>
      <header className="type-head">
        <TypeIcon type={type} size="lg" />
        <div>
          <h1>
            {type.name}
            {activeCol && (
              <span className="col-head-sub">
                {' '}
                / {activeCol.icon || '📁'} {activeCol.name}
              </span>
            )}
          </h1>
          <p className="muted">
            {items.length} {items.length === 1 ? 'object' : 'objects'}
            {activeCol ? ` in ${activeCol.name}` : ''}
          </p>
        </div>
        <div className="spacer" />
        {activeCol && !editingCol && (
          <>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setEditColName(activeCol.name);
                setEditingCol(true);
              }}
            >
              <Pencil size={13} /> Rename collection
            </button>
            <button
              type="button"
              className="btn small danger"
              onClick={async () => {
                if (!confirm(`Delete collection “${activeCol.name}”? Objects inside will remain in ${type.name}.`)) return;
                await deleteCollection(activeCol.id);
                open(`/type/${typeId}`);
              }}
            >
              <Trash size={13} />
            </button>
          </>
        )}
        {activeCol && editingCol && (
          <form
            className="col-rename-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (editColName.trim()) await updateCollection(activeCol.id, { name: editColName.trim() });
              setEditingCol(false);
            }}
          >
            <input autoFocus value={editColName} onChange={(e) => setEditColName(e.target.value)} />
            <button type="submit" className="btn small primary">
              Save
            </button>
            <button type="button" className="icon-btn tiny" onClick={() => setEditingCol(false)}>
              <X size={14} />
            </button>
          </form>
        )}
        <button type="button" className="btn" onClick={() => setTypeEditor(type.id)}>
          <Pencil size={14} /> Edit type
        </button>
        <button type="button" className="btn primary" onClick={create}>
          <Plus size={15} /> New {type.name}
        </button>
      </header>

      {typeId !== 'daily' && (
        <div className="collections-bar">
          <button type="button" className={`col-pill${!activeCol ? ' active' : ''}`} onClick={(e) => open(`/type/${typeId}`, e)}>
            All <span className="count">{allOfType.length}</span>
          </button>
          {typeCollections.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`col-pill${activeCol?.id === c.id ? ' active' : ''}`}
              onClick={(e) => open(`/type/${typeId}?collection=${c.id}`, e)}
            >
              <span>{c.icon || '📁'}</span> {c.name} <span className="count">{colCounts.get(c.id) ?? 0}</span>
            </button>
          ))}
          <button ref={addColBtn} type="button" className="col-pill col-add" onClick={() => setAddingCol((v) => !v)}>
            <FolderPlus size={13} /> New collection
          </button>
          {addingCol && (
            <Popover anchor={addColBtn.current} onClose={() => setAddingCol(false)} className="col-create-pop">
              <div className="col-icon-row">
                {COL_ICONS.map((em) => (
                  <button key={em} type="button" className={newColIcon === em ? 'active' : ''} onClick={() => setNewColIcon(em)}>
                    {em}
                  </button>
                ))}
              </div>
              <form
                className="col-create-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitNewCol();
                }}
              >
                <input
                  autoFocus
                  placeholder="Collection name (e.g. Reading now)…"
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                />
                <button type="submit" className="btn small primary" disabled={!newColName.trim()}>
                  Create
                </button>
              </form>
            </Popover>
          )}
        </div>
      )}

      <div className="type-controls">
        <div className="segmented small">
          <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} title="Cards">
            <LayoutGrid size={15} />
          </button>
          <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} title="List">
            <List size={15} />
          </button>
          <button type="button" className={view === 'table' ? 'active' : ''} onClick={() => setView('table')} title="Table">
            <Table size={15} />
          </button>
        </div>
        <label className="control">
          <ArrowUpDown size={14} />
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              writePref(`orbit-sort-${typeId}`, e.target.value);
            }}
          >
            <option value="updated">Last edited</option>
            <option value="created">Created</option>
            <option value="title">Title A–Z</option>
            {typeId === 'daily' && <option value="daily">Date</option>}
            {sortable.flatMap((p) => [
              <option key={p.key + 'a'} value={`${p.key}:asc`}>
                {p.name} ↑
              </option>,
              <option key={p.key + 'd'} value={`${p.key}:desc`}>
                {p.name} ↓
              </option>,
            ])}
          </select>
        </label>
        <label className="control">
          <Funnel size={14} />
          <select value={filterKey} onChange={(e) => setFilterKey(e.target.value)}>
            <option value="">No filter</option>
            <option value="__title">Title</option>
            <option value="__tag">Tag</option>
            {type.properties.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          {filterKey && <input placeholder="contains…" value={filterVal} onChange={(e) => setFilterVal(e.target.value)} autoFocus />}
        </label>
      </div>

      {items.length === 0 && (
        <div className="empty-inline center">
          <strong>There’s nothing here (yet).</strong>
          <span>
            {activeCol
              ? `Create a new ${type.name.toLowerCase()} in “${activeCol.name}” with the button above, or add existing ones from their Collections row.`
              : `Create your first ${type.name.toLowerCase()} with the button above.`}
          </span>
        </div>
      )}

      {view === 'grid' && (
        <div className="card-grid">
          {items.map((o) => (
            <ObjectCard key={o.id} obj={o} type={type} />
          ))}
        </div>
      )}
      {view === 'list' && (
        <div className="row-list">
          {items.map((o) => (
            <ObjectRow key={o.id} obj={o} type={type} right={<span className="muted small">{formatDistanceToNow(o.updatedAt, { addSuffix: true })}</span>} />
          ))}
        </div>
      )}
      {view === 'table' && (
        <div className="table-wrap">
          <table className="obj-table">
            <thead>
              <tr>
                <th>Title</th>
                {type.properties.map((p) => (
                  <th key={p.key}>{p.name}</th>
                ))}
                <th>Tags</th>
                <th>Edited</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} onClick={(e) => open(objPath(o.id), e)}>
                  <td className="t-title">
                    {o.icon || type.icon} {displayTitle(o)}
                  </td>
                  {type.properties.map((p) => (
                    <td key={p.key}>{formatPropValue(p, o.props[p.key], objects)}</td>
                  ))}
                  <td className="muted">{o.tags.map((t) => '#' + t).join(' ')}</td>
                  <td className="muted nowrap">{formatDistanceToNow(o.updatedAt, { addSuffix: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
