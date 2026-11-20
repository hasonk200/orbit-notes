import { useMemo } from 'react';
import { useActiveObjects, useTypeMap } from '../store/dataStore';
import { useOpen } from '../store/pane';
import { ObjectRow } from '../components/ObjectCard';

export function TagsView({ tag }: { tag?: string }) {
  const objects = useActiveObjects();
  const typeMap = useTypeMap();
  const open = useOpen();
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of objects) for (const t of o.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [objects]);
  const max = Math.max(1, ...counts.map(([, n]) => n));

  if (tag) {
    const list = objects.filter((o) => o.tags.includes(tag)).sort((a, b) => b.updatedAt - a.updatedAt);
    return (
      <div className="page">
        <header className="page-head">
          <button type="button" className="btn-ghost" onClick={(e) => open('/tags', e)}>
            ← All tags
          </button>
          <h1>#{tag}</h1>
          <p className="muted">{list.length} objects</p>
        </header>
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
        <h1>Tags</h1>
        <p className="muted">Type # in any note to tag it.</p>
      </header>
      {counts.length === 0 && (
        <div className="empty-inline center">
          <strong>No tags yet.</strong>
          <span>Type #idea or #reading in a note to create one.</span>
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
