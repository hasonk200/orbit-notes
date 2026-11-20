import { propertyLabel } from '../lib/typeLabels';
import { useT } from '../store/uiStore';
import { useMemo } from 'react';
import { displayTitle, useData, useObjMap, useTypeMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { snippetsFor } from '../lib/content';
import { TypeIcon } from './TypeIcon';

export function Backlinks({ objectId }: { objectId: string }) {
  const tr = useT();
  const links = useData((s) => s.links);
  const objMap = useObjMap();
  const typeMap = useTypeMap();
  const open = useOpen();

  const groups = useMemo(() => {
    const by = new Map<string, { content: boolean; props: string[] }>();
    for (const l of links) {
      if (l.toId !== objectId) continue;
      const src = objMap.get(l.fromId);
      if (!src || src.deletedAt) continue;
      const g = by.get(l.fromId) ?? { content: false, props: [] };
      if (l.source === 'content') g.content = true;
      else {
        const def = typeMap.get(src.typeId)?.properties.find((p) => p.key === l.propKey);
        g.props.push(def ? propertyLabel(typeMap.get(src.typeId), def, tr) : l.propKey ?? tr('Property'));
      }
      by.set(l.fromId, g);
    }
    const titleOf = (id: string) => '[[' + displayTitle(objMap.get(id), tr) + ']]';
    return [...by.entries()]
      .map(([id, g]) => {
        const src = objMap.get(id)!;
        return { src, props: g.props, snippets: g.content ? snippetsFor(src.content, objectId, titleOf).slice(0, 3) : [] };
      })
      .sort((a, b) => b.src.updatedAt - a.src.updatedAt);
  }, [links, objMap, typeMap, objectId, tr]);

  return (
    <section className="backlinks">
      <h3>
        {tr('Linked in')} <span className="count">{groups.length}</span>
      </h3>
      {groups.length === 0 && <p className="muted small">{tr('No other object links here yet. Type [[ in any note to link this one.')}</p>}
      {groups.map(({ src, props, snippets }) => (
        <div key={src.id} className="backlink">
          <button type="button" className="backlink-title" onClick={(e) => open(objPath(src.id), e)}>
            <TypeIcon type={typeMap.get(src.typeId)} size="sm" />
            {src.icon ? `${src.icon} ` : ''}
            {displayTitle(src, tr)}
            {props.length > 0 && <span className="backlink-via">via {props.join(', ')}</span>}
          </button>
          {snippets.map((s, i) => (
            <p key={i} className="backlink-snippet">
              {s}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}
