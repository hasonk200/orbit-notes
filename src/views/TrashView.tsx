import { useT } from '../store/uiStore';
import { RotateCcw, Trash } from 'lucide-react';
import { relativeTime } from '../lib/dates';
import { typeLabel } from '../lib/typeLabels';
import { deletePermanently, emptyTrash, restoreObject } from '../db/indexers';
import { displayTitle, useData, useTypeMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';

export function TrashView() {
  const tr = useT();
  const objects = useData((s) => s.objects);
  const typeMap = useTypeMap();
  const open = useOpen();
  const trashed = objects.filter((o) => o.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>{tr('Trash')}</h1>
          <p className="muted">{tr('Deleted objects stay here until you remove them for good. Their links show as “Deleted object”.')}</p>
        </div>
        <div className="spacer" />
        {trashed.length > 0 && (
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              if (confirm(tr('Permanently delete {count} object(s)? This cannot be undone.', { count: trashed.length }))) await emptyTrash();
            }}
          >
            <Trash size={14} /> {tr('Empty Trash')}
          </button>
        )}
      </header>
      {trashed.length === 0 && (
        <div className="empty-inline center">
          <strong>{tr('Trash is empty.')}</strong>
        </div>
      )}
      <div className="row-list">
        {trashed.map((o) => {
          const t = typeMap.get(o.typeId);
          return (
            <div key={o.id} className="trash-row">
              <button type="button" className="obj-row" onClick={(e) => open(objPath(o.id).replace('/calendar?mode=day&date=', '/o/daily-'), e)}>
                <span className="obj-row-icon" style={{ ['--type-color' as any]: t?.color }}>
                  {o.icon || t?.icon}
                </span>
                <span className="obj-row-title">{displayTitle(o, tr)}</span>
                <span className="obj-row-type">
                  {t && typeLabel(t, tr)} · {tr('Deleted {time}', { time: relativeTime(o.deletedAt!, tr) })}
                </span>
              </button>
              <button type="button" className="btn small" onClick={() => restoreObject(o.id)}>
                <RotateCcw size={13} /> {tr('Restore')}
              </button>
              <button
                type="button"
                className="btn small danger"
                onClick={async () => {
                  if (confirm(tr('Permanently delete “{title}”? This cannot be undone.', { title: displayTitle(o, tr) }))) await deletePermanently(o.id);
                }}
              >
                {tr('Delete')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
