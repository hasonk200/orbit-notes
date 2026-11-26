import { typeLabel } from '../lib/typeLabels';
import { Plus } from 'lucide-react';
import { createObject, getOrCreateDayNote } from '../db/indexers';
import { useSpaceTypes } from '../store/dataStore';
import { AI_LOG_TYPE } from '../lib/spaces';
import { objPath, useOpen } from '../store/pane';
import { useT, useUI } from '../store/uiStore';
import { todayISO } from '../lib/dates';
import { Popover } from './Popover';

export function NewMenu({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const tr = useT();
  const types = useSpaceTypes();
  const open = useOpen();
  const setTypeEditor = useUI((s) => s.setTypeEditor);
  return (
    <Popover anchor={anchor} onClose={onClose} className="menu">
      <div className="menu-label">{tr('Create new')}</div>
      {types.map((t) => (
        <button
          key={t.id}
          type="button"
          className="menu-item"
          onClick={async (e) => {
            const altKey = e.altKey;
            onClose();
            if (t.id === 'daily' || t.id === AI_LOG_TYPE) {
              await getOrCreateDayNote(todayISO());
              open(`/calendar?mode=day&date=${todayISO()}`, { altKey });
              return;
            }
            const o = await createObject(t.id);
            open(objPath(o.id) + '?new=1', { altKey });
          }}
        >
          <span className="menu-type-icon" style={{ ['--type-color' as any]: t.color }}>
            {t.icon}
          </span>
          {typeLabel(t, tr)}
        </button>
      ))}
      <div className="menu-sep" />
      <button
        type="button"
        className="menu-item"
        onClick={() => {
          onClose();
          setTypeEditor('new');
        }}
      >
        <Plus size={15} /> {tr('New object type…')}
      </button>
    </Popover>
  );
}
