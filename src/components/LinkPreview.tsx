import { useT } from '../store/uiStore';
import { Columns2, ExternalLink, LayoutGrid, Link2 } from 'lucide-react';
import { displayTitle, useData, useObjMap, useObject } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { firstText } from '../lib/content';
import { propertyLabel, typeLabel } from '../lib/typeLabels';
import { formatPropValue } from './PropertyPanel';
import { Popover } from './Popover';

export function LinkPreview({
  anchor,
  objectId,
  display,
  onToggleDisplay,
  onEnter,
  onLeave,
}: {
  anchor: HTMLElement | null;
  objectId: string;
  display?: 'inline' | 'card';
  onToggleDisplay?: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const tr = useT();
  const obj = useObject(objectId);
  const type = useData((s) => s.types.find((t) => t.id === obj?.typeId));
  const objectMap = useObjMap();
  const open = useOpen();
  if (!obj) return null;
  const props = (type?.properties ?? [])
    .map((d) => [propertyLabel(type, d, tr), formatPropValue(d, obj.props[d.key], objectMap, type, tr)] as const)
    .filter(([, v]) => v)
    .slice(0, 4);
  const titleOf = (id: string) => displayTitle(objectMap.get(id), tr);
  return (
    <Popover anchor={anchor} className="link-preview" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="lp-head" style={{ ['--type-color' as any]: type?.color }}>
        <span className="lp-icon">{obj.icon || type?.icon}</span>
        <div>
          <div className="lp-title">{displayTitle(obj, tr)}</div>
          <div className="lp-type">{type && typeLabel(type, tr)}</div>
        </div>
      </div>
      {props.length > 0 && (
        <dl className="lp-props">
          {props.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="lp-snippet">{firstText(obj.content, 220, titleOf) || <em>{tr('Empty')}</em>}</p>
      <div className="lp-actions" onMouseDown={(e) => e.preventDefault()}>
        <button type="button" onClick={(e) => open(objPath(obj.id), e)}>
          <ExternalLink size={14} /> {tr('Open')}
        </button>
        <button type="button" onClick={() => open(objPath(obj.id), null, { split: true })}>
          <Columns2 size={14} /> {tr('Split')}
        </button>
        {onToggleDisplay && (
          <button type="button" onClick={onToggleDisplay}>
            {display === 'card' ? <Link2 size={14} /> : <LayoutGrid size={14} />} {display === 'card' ? tr('Inline') : tr('Card')}
          </button>
        )}
      </div>
    </Popover>
  );
}
