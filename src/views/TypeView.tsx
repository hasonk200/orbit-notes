import { useMemo, useRef, useState } from 'react';
import { askConfirm } from '../components/ConfirmDialog';
import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpNarrowWide,
  Check,
  Columns2,
  FolderPlus,
  Funnel,
  LayoutGrid,
  List,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Table,
  Trash,
  X,
} from 'lucide-react';
import { relativeTime } from '../lib/dates';
import { includesText } from '../lib/search';
import { propertyLabel, typeLabel } from '../lib/typeLabels';
import { createCollection, createObject, deleteCollection, getOrCreateDayNote, saveObject, softDelete, updateCollection } from '../db/indexers';
import { AI_DOC_TYPE, AI_LOG_TYPE, aiDocStatus, spaceOf } from '../lib/spaces';
import { MenuSelect } from '../components/MenuSelect';
import { displayTitle, togglePinned, useData } from '../store/dataStore';
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

function defaultSortDir(key: string): 'asc' | 'desc' {
  return key === 'updated' || key === 'created' || key === 'daily' ? 'desc' : 'asc';
}

function parseSortPref(raw: string): { key: string; dir: 'asc' | 'desc' } {
  const [key, dir] = raw.split(':');
  return {
    key: key || 'updated',
    dir: dir === 'asc' || dir === 'desc' ? dir : defaultSortDir(key || 'updated'),
  };
}

export function TypeView({ typeId, collectionId }: { typeId: string; collectionId?: string | null }) {
  const tr = useT();
  const type = useData((s) => s.types.find((t) => t.id === typeId));
  const collections = useData((s) => s.collections);
  const objects = useData((s) => s.objects);
  const pinned = useData((s) => s.pinned);
  const space = useUI((s) => s.space);
  const open = useOpen();
  const setTypeEditor = useUI((s) => s.setTypeEditor);
  const isDayType = typeId === 'daily' || typeId === AI_LOG_TYPE;
  // Archived AI documents are hidden unless asked for.
  const [showArchived, setShowArchived] = useState(false);
  const [view, setViewState] = useState<ViewMode>(() => readPref(`orbit-view-${typeId}`, isDayType ? 'list' : 'grid'));
  const [sort, setSort] = useState<string>(() => {
    const { key, dir } = parseSortPref(readPref(`orbit-sort-${typeId}`, 'updated:desc'));
    return `${key}:${dir}`;
  });
  const [filterKey, setFilterKey] = useState('');
  const [filterVal, setFilterVal] = useState('');
  const [addingCol, setAddingCol] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColIcon, setNewColIcon] = useState('📁');
  const [editingCol, setEditingCol] = useState(false);
  const [editColName, setEditColName] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ objId: string; rect: DOMRect } | null>(null);
  const [ctxNewFolder, setCtxNewFolder] = useState(false);
  const [ctxFolderName, setCtxFolderName] = useState('');
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
    const { key: sortKey, dir } = parseSortPref(sort);
    const mul = dir === 'asc' ? 1 : -1;
    const cmp = (a: any, b: any) => {
      const missingA = a == null || a === '';
      const missingB = b == null || b === '';
      if (missingA || missingB) return Number(missingA) - Number(missingB);
      return a < b ? -mul : a > b ? mul : 0;
    };
    return [...list].sort((a, b) => {
      if (sortKey === 'updated') return (a.updatedAt - b.updatedAt) * mul;
      if (sortKey === 'created') return (a.createdAt - b.createdAt) * mul;
      if (sortKey === 'title') return displayTitle(a, tr).localeCompare(displayTitle(b, tr), tr.language) * mul;
      if (sortKey === 'daily') return (a.dailyDate ?? '').localeCompare(b.dailyDate ?? '') * mul;
      return cmp(a.props[sortKey], b.props[sortKey]);
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
  const { key: sortKey, dir: sortDir } = parseSortPref(sort);
  const updateSort = (nextKey: string, nextDir: 'asc' | 'desc') => {
    const next = `${nextKey}:${nextDir}`;
    setSort(next);
    writePref(`orbit-sort-${typeId}`, next);
  };
  const sortDirLabel =
    sortKey === 'updated' || sortKey === 'created' || sortKey === 'daily'
      ? tr(sortDir === 'desc' ? 'Newest first (click to reverse)' : 'Oldest first (click to reverse)')
      : tr(sortDir === 'asc' ? 'First to end (click to reverse)' : 'End to first (click to reverse)');
  const openContextMenu = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxNewFolder(false);
    setCtxFolderName('');
    setCtxMenu({ objId: id, rect: new DOMRect(e.clientX, e.clientY, 0, 0) });
  };
  const ctxObj = ctxMenu ? objectMap.get(ctxMenu.objId) ?? null : null;
  const ctxPinned = ctxObj ? pinned.includes(ctxObj.id) : false;
  const toggleCtxFolder = async (colId: string) => {
    if (!ctxObj) return;
    const cur = ctxObj.collectionIds ?? [];
    const next = cur.includes(colId) ? cur.filter((id) => id !== colId) : [...cur, colId];
    await saveObject(ctxObj.id, { collectionIds: next });
  };
  const createAndAddFolder = async () => {
    const name = ctxFolderName.trim();
    if (!name || !ctxObj) return;
    const col = await createCollection(typeId, name, '📁');
    const cur = ctxObj.collectionIds ?? [];
    if (!cur.includes(col.id)) await saveObject(ctxObj.id, { collectionIds: [...cur, col.id] });
    setCtxFolderName('');
    setCtxNewFolder(false);
  };

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
                if (!(await askConfirm({ title: tr('Delete collection “{name}”? Its objects will stay in {type}.', { name: activeCol.name, type: typeName }), confirmLabel: tr('Delete'), danger: true }))) return;
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
            {tr('All')} <span className="count">{allOfType.length}</span>
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
        <div className="control-pair">
          <MenuSelect
            label={tr('Sort')}
            icon={<ArrowUpDown size={14} />}
            value={sortKey}
            onChange={(nextKey) => updateSort(nextKey, defaultSortDir(nextKey))}
            options={[
              { value: 'updated', label: tr('Last edited') },
              { value: 'created', label: tr('Created') },
              { value: 'title', label: tr('Title') },
              ...(isDayType ? [{ value: 'daily', label: tr('Date') }] : []),
              ...sortable.map((p) => ({ value: p.key, label: propertyLabel(type, p, tr) })),
            ]}
          />
          <button
            type="button"
            className="control sort-dir-btn"
            onClick={() => updateSort(sortKey, sortDir === 'asc' ? 'desc' : 'asc')}
            title={sortDirLabel}
            aria-label={sortDirLabel}
          >
            {sortDir === 'asc' ? <ArrowUpNarrowWide size={14} /> : <ArrowDownWideNarrow size={14} />}
          </button>
        </div>
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
            <ObjectCard key={o.id} obj={o} type={type} onContextMenu={(e) => openContextMenu(o.id, e)} />
          ))}
        </div>
      )}
      {view === 'list' && (
        <div className="row-list">
          {items.map((o) => (
            <ObjectRow
              key={o.id}
              obj={o}
              type={type}
              right={<span className="muted small">{relativeTime(o.updatedAt, tr)}</span>}
              onContextMenu={(e) => openContextMenu(o.id, e)}
            />
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
                <tr key={o.id} onClick={(e) => open(objPath(o.id), e)} onContextMenu={(e) => openContextMenu(o.id, e)}>
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

      {ctxMenu && ctxObj && (
        <Popover rect={ctxMenu.rect} onClose={() => setCtxMenu(null)} className="menu obj-ctx-menu">
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              open(objPath(ctxObj.id), { altKey: true });
              setCtxMenu(null);
            }}
          >
            <Columns2 size={14} /> {tr('Open in split view')}
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              void togglePinned(ctxObj.id);
              setCtxMenu(null);
            }}
          >
            {ctxPinned ? <PinOff size={14} /> : <Pin size={14} />}
            {tr(ctxPinned ? 'Unpin' : 'Pin to sidebar')}
          </button>

          {typeId !== 'daily' && (
            <>
              <div className="menu-sep" />
              <div className="menu-label">{tr('Add to folder')}</div>
              {typeCollections.map((c) => {
                const inside = ctxObj.collectionIds?.includes(c.id) ?? false;
                return (
                  <button key={c.id} type="button" className="menu-item" onClick={() => void toggleCtxFolder(c.id)}>
                    <span>{c.icon || '📁'}</span>
                    <span className="menu-item-label">{c.name}</span>
                    {inside && <Check size={14} className="menu-select-check" />}
                  </button>
                );
              })}
              {ctxNewFolder ? (
                <form
                  className="col-create-form obj-ctx-folder-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void createAndAddFolder();
                  }}
                >
                  <input
                    autoFocus
                    placeholder={tr('Folder name…')}
                    value={ctxFolderName}
                    onChange={(e) => setCtxFolderName(e.target.value)}
                  />
                  <button type="submit" className="btn small primary" disabled={!ctxFolderName.trim()}>
                    {tr('Add')}
                  </button>
                </form>
              ) : (
                <button type="button" className="menu-item" onClick={() => setCtxNewFolder(true)}>
                  <FolderPlus size={14} /> {tr('New folder…')}
                </button>
              )}
            </>
          )}

          <div className="menu-sep" />
          <button
            type="button"
            className="menu-item danger"
            onClick={() => {
              void softDelete(ctxObj.id);
              setCtxMenu(null);
            }}
          >
            <Trash size={14} /> {tr('Move to Trash')}
          </button>
        </Popover>
      )}
    </div>
  );
}
