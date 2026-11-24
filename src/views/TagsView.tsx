import { useT } from '../store/uiStore';
import { useMemo } from 'react';
import { useActiveObjects, useTypeMap } from '../store/dataStore';
import { useOpen } from '../store/pane';
import { ObjectRow } from '../components/ObjectCard';
import { LiveSearchTable } from '../components/LiveSearchTable';
import { db, uid } from '../db/schema';
import { normalizeText } from '../lib/search';
import { supertagFor } from '../lib/supertags';
import { propertyLabel, typeLabel } from '../lib/typeLabels';
import { useData } from '../store/dataStore';
import { useUI } from '../store/uiStore';

/** The fields a tag gives its items, and the button to set them up. */
function SupertagPanel({ tag }: { tag: string }) {
  const tr = useT();
  const types = useData((s) => s.types);
  const setTypeEditor = useUI((s) => s.setTypeEditor);
  const type = supertagFor(types, tag);
  const setup = async () => {
    if (type) return setTypeEditor(type.id);
    // Reuse a type with the same name, otherwise make one for this tag.
    const same = types.find((t) => !t.tag && t.id !== 'daily' && [t.name, typeLabel(t, tr)].some((n) => normalizeText(n) === normalizeText(tag)));
    if (same) {
      await db.types.put({ ...same, tag, updatedAt: Date.now() });
      return setTypeEditor(same.id);
    }
    const id = `tag-${uid().slice(0, 8)}`;
    await db.types.put({ id, name: tag, icon: '🏷️', color: '#6d5efc', properties: [], defaultTemplate: null, order: types.length, tag, updatedAt: Date.now() });
    setTypeEditor(id);
  };
  return (
    <div className="supertag-panel">
      {type && type.properties.length ? (
        <>
          <span className="muted small">{tr('Items tagged #{tag} have these fields:', { tag })}</span>
          <span className="supertag-fields">
            {type.properties.map((p) => (
              <span key={p.key} className="supertag-field">
                {propertyLabel(type, p, tr)}
              </span>
            ))}
          </span>
          <button type="button" className="btn-ghost small" onClick={setup}>
            {tr('Edit fields')}
          </button>
        </>
      ) : (
        <>
          <span className="muted small">{tr('Give #{tag} fields (like amount or due date) and every item with this tag can fill them in.', { tag })}</span>
          <button type="button" className="btn small" onClick={setup}>
            ＋ {tr('Add fields')}
          </button>
        </>
      )}
    </div>
  );
}

export function TagsView({ tag }: { tag?: string }) {
  const tr = useT();
  const objects = useActiveObjects();
  const typeMap = useTypeMap();
  const open = useOpen();
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of objects) for (const t of o.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], tr.language));
  }, [objects, tr]);
  const max = Math.max(1, ...counts.map(([, n]) => n));

  if (tag) {
    const list = objects.filter((o) => o.tags.includes(tag)).sort((a, b) => b.updatedAt - a.updatedAt);
    return (
      <div className="page">
        <header className="page-head">
          <button type="button" className="btn-ghost" onClick={(e) => open('/tags', e)}>
            ← {tr('All tags')}
          </button>
          <h1>#{tag}</h1>
          <p className="muted">{tr('{count} item(s)', { count: list.length })}</p>
        </header>
        <SupertagPanel tag={tag} />
        <LiveSearchTable query={{ tag }} editable={false} />
        {list.length > 0 && <h3 className="section-title">{tr('Notes with this tag')}</h3>}
        <div className="row-list">
          {list.map((o) => (
            <ObjectRow key={o.id} obj={o} type={typeMap.get(o.typeId)} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>{tr('Tags')}</h1>
        <p className="muted">{tr('Type # in any note to tag it.')}</p>
      </header>
      {counts.length === 0 && (
        <div className="empty-inline center">
          <strong>{tr('No tags yet.')}</strong>
          <span>{tr('Type #idea or #reading in a note to create one.')}</span>
        </div>
      )}
      <div className="tag-cloud">
        {counts.map(([t, n]) => (
          <button key={t} type="button" className="tag-chip big" style={{ fontSize: `${0.9 + (n / max) * 0.6}rem` }} onClick={(e) => open(`/tags/${encodeURIComponent(t)}`, e)}>
            #{t} <span className="count">{n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
