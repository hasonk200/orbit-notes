import { CalendarDays, Plus } from 'lucide-react';
import { createObject, getOrCreateDayNote } from '../db/indexers';
import { AI_LOG_TYPE, creatableTypes } from '../lib/spaces';
import { todayISO } from '../lib/dates';
import { typeLabel } from '../lib/typeLabels';
import { useData } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useT, useUI } from '../store/uiStore';
import { BottomSheet } from './BottomSheet';

/** The "+" sheet on phones: one tile per object type, plus today's daily note and a new type. */
export function CreateSheet({ onClose }: { onClose: () => void }) {
  const tr = useT();
  const space = useUI((s) => s.space);
  const types = creatableTypes(useData((s) => s.types), useData((s) => s.objects), space);
  const open = useOpen();
  const setTypeEditor = useUI((s) => s.setTypeEditor);

  const create = async (typeId: string) => {
    onClose();
    if (typeId === 'daily' || typeId === AI_LOG_TYPE) {
      await getOrCreateDayNote(todayISO());
      open(`/calendar?mode=day&date=${todayISO()}`);
      return;
    }
    const o = await createObject(typeId);
    open(objPath(o.id) + '?new=1');
  };

  return (
    <BottomSheet onClose={onClose} title={tr('Create')} label={tr('Create')}>
      <div className="create-grid">
        <button type="button" className="create-tile" onClick={() => void create('daily')}>
          <span className="create-tile-icon is-today">
            <CalendarDays size={20} />
          </span>
          <span>{tr(space === 'ai' ? 'Today’s AI log' : 'Today’s note')}</span>
        </button>
        {types
          .map((t) => (
            <button key={t.id} type="button" className="create-tile" onClick={() => void create(t.id)}>
              <span className="create-tile-icon" style={{ ['--type-color' as string]: t.color }}>
                {t.icon}
              </span>
              <span>{typeLabel(t, tr)}</span>
            </button>
          ))}
        <button
          type="button"
          className="create-tile is-new"
          onClick={() => {
            onClose();
            setTypeEditor('new');
          }}
        >
          <span className="create-tile-icon">
            <Plus size={20} />
          </span>
          <span>{tr('New object type…')}</span>
        </button>
      </div>
    </BottomSheet>
  );
}
