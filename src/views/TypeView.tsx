import { useMemo, useState } from 'react';
import { ArrowUpDown, Funnel, LayoutGrid, List, Pencil, Plus, Table } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { createObject, getOrCreateDaily } from '../db/indexers';
import { displayTitle, useData } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useUI } from '../store/uiStore';
import { todayISO } from '../lib/dates';
import { ObjectCard, ObjectRow } from '../components/ObjectCard';
import { formatPropValue } from '../components/PropertyPanel';
import { TypeIcon } from '../components/TypeIcon';

type ViewMode = 'grid' | 'list' | 'table';

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

export function TypeView({ typeId }: { typeId: string }) {
  const type = useData((s) => s.types.find((t) => t.id === typeId));
  const objects = useData((s) => s.objects);
  const open = useOpen();
  const setTypeEditor = useUI((s) => s.setTypeEditor);
  const [view, setViewState] = useState<ViewMode>(() => readPref(`orbit-view-${typeId}`, typeId === 'daily' ? 'list' : 'grid'));
  const [sort, setSort] = useState<string>(() => readPref(`orbit-sort-${typeId}`, 'updated'));
  const [filterKey, setFilterKey] = useState('');
  const [filterVal, setFilterVal] = useState('');
  const setView = (v: ViewMode) => {
    setViewState(v);
    writePref(`orbit-view-${typeId}`, v);
  };

  const items = useMemo(() => {
    if (!type) return [];
    let list = objects.filter((o) => o.typeId === typeId && !o.deletedAt);
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
  }, [objects, type, typeId, sort, filterKey, filterVal]);

  if (!type) return <div className="empty-state"><h2>Unknown type</h2></div>;

  const create = async (e: React.MouseEvent) => {
    const altKey = e.altKey;
    if (typeId === 'daily') {
      await getOrCreateDaily(todayISO());
      return open(`/calendar?mode=day&date=${todayISO()}`, { altKey });
    }
    const o = await createObject(typeId);
    open(objPath(o.id) + '?new=1', { altKey });
  };

  const sortable = type.properties.filter((p) => ['text', 'number', 'date', 'select', 'checkbox', 'url'].includes(p.kind));

  return (
    <div className="page wide" style={{ ['--type-color' as any]: type.color }}>
      <header className="type-head">
        <TypeIcon type={type} size="lg" />
        <div>
          <h1>{type.name}</h1>
          <p className="muted">
            {items.length} {items.length === 1 ? 'object' : 'objects'}
          </p>
        </div>
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => setTypeEditor(type.id)}>
          <Pencil size={14} /> Edit type
        </button>
        <button type="button" className="btn primary" onClick={create}>
          <Plus size={15} /> New {type.name}
        </button>
      </header>

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
          <span>Create your first {type.name.toLowerCase()} with the button above.</span>
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
