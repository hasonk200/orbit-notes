import { Plus } from 'lucide-react';
import { createObject, getOrCreateDaily } from '../db/indexers';
import { useData } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useUI } from '../store/uiStore';
import { todayISO } from '../lib/dates';
import { Popover } from './Popover';

export function NewMenu({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const types = useData((s) => s.types);
  const open = useOpen();
  const setTypeEditor = useUI((s) => s.setTypeEditor);
  return (
    <Popover anchor={anchor} onClose={onClose} className="menu">
      <div className="menu-label">Create new</div>
      {types.map((t) => (
        <button
          key={t.id}
          type="button"
          className="menu-item"
          onClick={async (e) => {
            const altKey = e.altKey;
            onClose();
            if (t.id === 'daily') {
              await getOrCreateDaily(todayISO());
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
          {t.name}
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
        <Plus size={15} /> New object type…
      </button>
    </Popover>
  );
}
