import { typeLabel } from '../lib/typeLabels';
import { useT } from '../store/uiStore';
import type { Obj } from '../db/schema';
import { convertType } from '../db/indexers';
import { useData } from '../store/dataStore';
import { Popover } from './Popover';

export function ConvertTypeMenu({ obj, anchor, onClose }: { obj: Obj; anchor: HTMLElement | null; onClose: () => void }) {
  const tr = useT();
  const types = useData((s) => s.types);
  const cur = types.find((t) => t.id === obj.typeId);
  return (
    <Popover anchor={anchor} onClose={onClose} className="menu">
      <div className="menu-label">{tr('Convert to…')}</div>
      {types
        .filter((t) => t.id !== 'daily' && t.id !== obj.typeId)
        .map((t) => {
          const kept = (cur?.properties ?? []).filter((p) => t.properties.some((q) => q.key === p.key && q.kind === p.kind));
          return (
            <button
              key={t.id}
              type="button"
              className="menu-item"
              onClick={async () => {
                await convertType(obj.id, t.id);
                onClose();
              }}
            >
              <span>{t.icon}</span> {typeLabel(t, tr)}
              {cur?.properties.length ? <span className="menu-hint">{tr('Keeps {kept}/{total} properties', { kept: kept.length, total: cur.properties.length })}</span> : null}
            </button>
          );
        })}
      <div className="menu-note">{tr('Title, content, tags and links are always kept.')}</div>
    </Popover>
  );
}
