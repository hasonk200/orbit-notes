import type { Obj, ObjType } from '../db/schema';
import { displayTitle, useData } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { firstText } from '../lib/content';
import { useBlobUrl } from '../db/blobs';
import { formatPropValue } from './PropertyPanel';
import { formatDistanceToNow } from 'date-fns';

export function ObjectCard({ obj, type }: { obj: Obj; type?: ObjType }) {
  const open = useOpen();
  const objects = useData((s) => s.objects);
  const cover = useBlobUrl(obj.cover);
  const props = (type?.properties ?? [])
    .map((d) => formatPropValue(d, obj.props[d.key], objects))
    .filter(Boolean)
    .slice(0, 3);
  return (
    <button type="button" className="obj-card" style={{ ['--type-color' as any]: type?.color }} onClick={(e) => open(objPath(obj.id), e)}>
      {cover ? <img className="obj-card-cover" src={cover} alt="" /> : <div className="obj-card-band" />}
      <div className="obj-card-body">
        <div className="obj-card-title">
          <span>{obj.icon || type?.icon}</span> {displayTitle(obj)}
        </div>
        {props.length > 0 && (
          <div className="obj-card-props">
            {props.map((p, i) => (
              <span key={i}>{p}</span>
            ))}
          </div>
        )}
        <p className="obj-card-snippet">{firstText(obj.content, 140)}</p>
        <div className="obj-card-foot">Edited {formatDistanceToNow(obj.updatedAt, { addSuffix: true })}</div>
      </div>
    </button>
  );
}

export function ObjectRow({ obj, type, right }: { obj: Obj; type?: ObjType; right?: React.ReactNode }) {
  const open = useOpen();
  return (
    <button type="button" className="obj-row" onClick={(e) => open(objPath(obj.id), e)}>
      <span className="obj-row-icon" style={{ ['--type-color' as any]: type?.color }}>
        {obj.icon || type?.icon}
      </span>
      <span className="obj-row-title">{displayTitle(obj)}</span>
      <span className="obj-row-type">{type?.name}</span>
      {right}
    </button>
  );
}
