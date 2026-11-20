import type { Obj } from '../db/schema';
import { convertType } from '../db/indexers';
import { useData } from '../store/dataStore';
import { Popover } from './Popover';

export function ConvertTypeMenu({ obj, anchor, onClose }: { obj: Obj; anchor: HTMLElement | null; onClose: () => void }) {
  const types = useData((s) => s.types);
  const cur = types.find((t) => t.id === obj.typeId);
  return (
    <Popover anchor={anchor} onClose={onClose} className="menu">
      <div className="menu-label">Convert to…</div>
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
              <span>{t.icon}</span> {t.name}
              {cur?.properties.length ? <span className="menu-hint">keeps {kept.length}/{cur.properties.length} props</span> : null}
            </button>
          );
        })}
      <div className="menu-note">Title, content, tags and links are always kept.</div>
    </Popover>
  );
}
