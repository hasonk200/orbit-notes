import { useMemo, useRef, useState } from 'react';
import { ArrowUpDown, FolderPlus, Funnel, LayoutGrid, List, Pencil, Plus, Table, Trash, X } from 'lucide-react';
import { relativeTime } from '../lib/dates';
import { includesText } from '../lib/search';
import { propertyLabel, typeLabel } from '../lib/typeLabels';
import { createCollection, createObject, deleteCollection, getOrCreateDayNote, updateCollection } from '../db/indexers';
import { AI_DOC_TYPE, AI_LOG_TYPE, aiDocStatus, spaceOf } from '../lib/spaces';
import { MenuSelect } from '../components/MenuSelect';
import { displayTitle, useData } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useT, useUI } from '../store/uiStore';
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
  const tr = useT();
  const type = useData((s) => s.types.find((t) => t.id === typeId));
  const collections = useData((s) => s.collections);
  const objects = useData((s) => s.objects);
  const space = useUI((s) => s.space);
  const open = useOpen();
  const setTypeEditor = useUI((s) => s.setTypeEditor);
  const isDayType = typeId === 'daily' || typeId === AI_LOG_TYPE;
  // Archived AI documents are hidden unless asked for.
  const [showArchived, setShowArchived] = useState(false);
  const [view, setViewState] = useState<ViewMode>(() => readPref(`orbit-view-${typeId}`, isDayType ? 'list' : 'grid'));
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

  const allOfType = useMemo(() => objects.filter((o) => o.typeId === typeId && !o.deletedAt && spaceOf(o) === space), [objects, typeId, space]);
  const archivedCount = typeId === AI_DOC_TYPE ? allOfType.filter((o) => aiDocStatus(o) === 'Archived').length : 0;

  const colCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of allOfType) {
      for (const cid of o.collectionIds ?? []) m.set(cid, (m.get(cid) ?? 0) + 1);
    }
    return m;
  }, [allOfType]);

  const objectMap = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const items = useMemo(() => {
    if (!type) return [];
    let list = activeCol ? allOfType.filter((o) => o.collectionIds?.includes(activeCol.id)) : allOfType;
    if (typeId === AI_DOC_TYPE && !showArchived) list = list.filter((o) => aiDocStatus(o) !== 'Archived');
    if (filterKey && filterVal.trim()) {
      const q = filterVal.trim();
      if (filterKey === '__title') list = list.filter((o) => includesText(displayTitle(o, tr), q));
      else if (filterKey === '__tag') list = list.filter((o) => o.tags.some((t) => includesText(t, q.replace(/^#/, ''))));
      else {
        const def = type.properties.find((p) => p.key === filterKey);
        if (def) list = list.filter((o) => includesText(formatPropValue(def, o.props[def.key], objectMap, type, tr), q));
      }
    }
    const [key, dir] = sort.split(':');
    const mul = dir === 'asc' ? 1 : -1;
    const cmp = (a: any, b: any) => {
      const missingA = a == null || a === '';
      const missingB = b == null || b === '';
      if (missingA || missingB) return Number(missingA) - Number(missingB);
      return a < b ? -mul : a > b ? mul : 0;
    };
    return [...list].sort((a, b) => {
      if (key === 'updated') return b.updatedAt - a.updatedAt;
      if (key === 'created') return b.createdAt - a.createdAt;
      if (key === 'title') return displayTitle(a, tr).localeCompare(displayTitle(b, tr), tr.language);
      if (key === 'daily') return (b.dailyDate ?? '').localeCompare(a.dailyDate ?? '');
      return cmp(a.props[key], b.props[key]);
    });
  }, [allOfType, objectMap, type, activeCol, sort, filterKey, filterVal, tr, showArchived, typeId]);

  if (!type) return <div className="empty-state"><h2>{tr('Unknown type')}</h2></div>;

  const create = async (e: React.MouseEvent) => {
    const altKey = e.altKey;
    if (isDayType) {
      await getOrCreateDayNote(todayISO(), typeId === AI_LOG_TYPE ? 'ai' : 'me');
      return open(typeId === AI_LOG_TYPE && space !== 'ai' ? objPath(`ai-log-${todayISO()}`) : `/calendar?mode=day&date=${todayISO()}`, { altKey });
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

  const typeName = typeLabel(type, tr);
  const sortable = type.properties.filter((p) => ['text', 'number', 'date', 'select', 'checkbox', 'url'].includes(p.kind));

  return (
    <div className="page wide" style={{ ['--type-color' as any]: type.color }}>
      <header className="type-head">
        <TypeIcon type={type} size="lg" />
        <div>
          <h1>
            {typeName}
            {activeCol && (
              <span className="col-head-sub">
                {' '}
                / {activeCol.icon || '📁'} {activeCol.name}
              </span>
            )}
          </h1>
          <p className="muted">
            {activeCol ? tr('{count} in “{name}”', { count: items.length, name: activeCol.name }) : tr('{count} item(s)', { count: items.length })}
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
              <Pencil size={13} /> {tr('Rename collection')}
            </button>
            <button
              type="button"
              className="btn small danger"
              onClick={async () => {
                if (!confirm(tr('Delete collection “{name}”? Its objects will stay in {type}.', { name: activeCol.name, type: typeName }))) return;
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
              {tr('Save')}
            </button>
            <button type="button" className="icon-btn tiny" onClick={() => setEditingCol(false)}>
              <X size={14} />
            </button>
          </form>
        )}
        <button type="button" className="btn" onClick={() => setTypeEditor(type.id)}>
          <Pencil size={14} /> {tr('Edit type')}
        </button>
        <button type="button" className="btn primary" onClick={create}>
          <Plus size={15} /> {tr('New {type}', { type: typeName })}
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
            <FolderPlus size={13} /> {tr('New collection')}
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
                  placeholder={tr('Collection name (e.g. Reading now)…')}
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                />
                <button type="submit" className="btn small primary" disabled={!newColName.trim()}>
                  {tr('Create')}
                </button>
              </form>
            </Popover>
          )}
        </div>
      )}

      <div className="type-controls">
        <div className="segmented small">
          <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} title={tr('Cards')}>
            <LayoutGrid size={15} />
          </button>
          <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} title={tr('List')}>
            <List size={15} />
          </button>
          <button type="button" className={view === 'table' ? 'active' : ''} onClick={() => setView('table')} title={tr('Table')}>
            <Table size={15} />
          </button>
        </div>
        <MenuSelect
          label={tr('Sort')}
          icon={<ArrowUpDown size={14} />}
          value={sort}
          onChange={(v) => {
            setSort(v);
            writePref(`orbit-sort-${typeId}`, v);
          }}
          options={[
            { value: 'updated', label: tr('Last edited') },
            { value: 'created', label: tr('Created') },
            { value: 'title', label: tr('Title A–Z') },
            ...(isDayType ? [{ value: 'daily', label: tr('Date') }] : []),
            ...sortable.flatMap((p) => [
              { value: `${p.key}:asc`, label: `${propertyLabel(type, p, tr)} ↑` },
              { value: `${p.key}:desc`, label: `${propertyLabel(type, p, tr)} ↓` },
            ]),
          ]}
        />
        <div className="control-pair">
          <MenuSelect
            label={tr('Filter')}
            icon={<Funnel size={14} />}
            value={filterKey}
            onChange={setFilterKey}
            options={[
              { value: '', label: tr('No filter') },
              { value: '__title', label: tr('Title') },
              { value: '__tag', label: tr('Tag') },
              ...type.properties.map((p) => ({ value: p.key, label: propertyLabel(type, p, tr) })),
            ]}
          />
          {filterKey && (
            <label className="control filter-text">
              <input placeholder={tr('Contains…')} aria-label={tr('Contains…')} value={filterVal} onChange={(e) => setFilterVal(e.target.value)} autoFocus />
            </label>
          )}
        </div>
        {archivedCount > 0 && (
          <button type="button" className={`chip${showArchived ? ' active' : ''}`} aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {tr(showArchived ? 'Hide archived' : 'Show {count} archived', { count: archivedCount })}
          </button>
        )}
      </div>

      {items.length === 0 && (
        <div className="empty-inline center">
          <strong>{tr('There’s nothing here (yet).')}</strong>
          <span>
            {activeCol
              ? tr('Create a new {type} in “{name}” or add an existing note from its Collections row.', { type: typeName, name: activeCol.name })
              : tr('Create your first {type} with the button above.', { type: typeName })}
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
            <ObjectRow key={o.id} obj={o} type={type} right={<span className="muted small">{relativeTime(o.updatedAt, tr)}</span>} />
          ))}
        </div>
      )}
      {view === 'table' && (
        <div className="table-wrap">
          <table className="obj-table">
            <thead>
              <tr>
                <th>{tr('Title')}</th>
                {type.properties.map((p) => (
                  <th key={p.key}>{propertyLabel(type, p, tr)}</th>
                ))}
                <th>{tr('Tags')}</th>
                <th>{tr('Edited')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} onClick={(e) => open(objPath(o.id), e)}>
                  <td className="t-title">
                    {o.icon || type.icon} {displayTitle(o, tr)}
                  </td>
                  {type.properties.map((p) => (
                    <td key={p.key}>{formatPropValue(p, o.props[p.key], objectMap, type, tr)}</td>
                  ))}
                  <td className="muted">{o.tags.map((t) => '#' + t).join(' ')}</td>
                  <td className="muted nowrap">{relativeTime(o.updatedAt, tr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
