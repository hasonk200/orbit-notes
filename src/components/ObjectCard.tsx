import { useT } from '../store/uiStore';
import type { Obj, ObjType } from '../db/schema';
import { displayTitle, useObjMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { firstText } from '../lib/content';
import { useBlobUrl } from '../db/blobs';
import { formatPropValue } from './PropertyPanel';
import { relativeTime } from '../lib/dates';
import { typeLabel } from '../lib/typeLabels';

export function ObjectCard({ obj, type }: { obj: Obj; type?: ObjType }) {
  const tr = useT();
  const open = useOpen();
  const objectMap = useObjMap();
  const cover = useBlobUrl(obj.cover);
  const props = (type?.properties ?? [])
    .map((d) => formatPropValue(d, obj.props[d.key], objectMap, type, tr))
    .filter(Boolean)
    .slice(0, 3);
  const titleOf = (id: string) => displayTitle(objectMap.get(id), tr);
  return (
    <button type="button" className="obj-card" style={{ ['--type-color' as any]: type?.color }} onClick={(e) => open(objPath(obj.id), e)}>
      {cover ? <img className="obj-card-cover" src={cover} alt="" /> : <div className="obj-card-band" />}
      <div className="obj-card-body">
        <div className="obj-card-title">
          <span>{obj.icon || type?.icon}</span> {displayTitle(obj, tr)}
        </div>
        {props.length > 0 && (
          <div className="obj-card-props">
            {props.map((p, i) => (
              <span key={i}>{p}</span>
            ))}
          </div>
        )}
        <p className="obj-card-snippet">{firstText(obj.content, 140, titleOf)}</p>
        <div className="obj-card-foot">{tr('Edited {time}', { time: relativeTime(obj.updatedAt, tr) })}</div>
      </div>
    </button>
  );
}

export function ObjectRow({ obj, type, right }: { obj: Obj; type?: ObjType; right?: React.ReactNode }) {
  const tr = useT();
  const open = useOpen();
  return (
    <button type="button" className="obj-row" onClick={(e) => open(objPath(obj.id), e)}>
      <span className="obj-row-icon" style={{ ['--type-color' as any]: type?.color }}>
        {obj.icon || type?.icon}
      </span>
      <span className="obj-row-title">{displayTitle(obj, tr)}</span>
      <span className="obj-row-type">{type && typeLabel(type, tr)}</span>
      {right}
    </button>
  );
}
