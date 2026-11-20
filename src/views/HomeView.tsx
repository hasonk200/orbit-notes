import { CalendarDays, Network, Search, SquareCheckBig } from 'lucide-react';
import { createObject, getOrCreateDaily } from '../db/indexers';
import { useActiveObjects, useData, useTypeMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useUI } from '../store/uiStore';
import { todayISO } from '../lib/dates';
import { ObjectRow } from '../components/ObjectCard';

export function HomeView() {
  const objects = useActiveObjects();
  const types = useData((s) => s.types);
  const typeMap = useTypeMap();
  const open = useOpen();
  const setPalette = useUI((s) => s.setPalette);
  const recent = [...objects].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Explore</h1>
        <p className="muted">Jump back in, or start something new.</p>
      </header>
      <div className="explore-cards">
        <button type="button" className="explore-card" onClick={() => setPalette(true)}>
          <Search size={20} />
          <span>Search</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button
          type="button"
          className="explore-card"
          onClick={async (e) => {
            const altKey = e.altKey;
            await getOrCreateDaily(todayISO());
            open(`/calendar?mode=day&date=${todayISO()}`, { altKey });
          }}
        >
          <CalendarDays size={20} />
          <span>Today’s note</span>
        </button>
        <button type="button" className="explore-card" onClick={(e) => open('/tasks', e)}>
          <SquareCheckBig size={20} />
          <span>Tasks</span>
        </button>
        <button type="button" className="explore-card" onClick={(e) => open('/graph', e)}>
          <Network size={20} />
          <span>Graph</span>
        </button>
      </div>

      <h4 className="section-label">Quick create</h4>
      <div className="quick-types">
        {types
          .filter((t) => t.id !== 'daily')
          .map((t) => (
            <button
              key={t.id}
              type="button"
              className="chip"
              style={{ ['--type-color' as any]: t.color }}
              onClick={async (e) => {
                const altKey = e.altKey;
                const o = await createObject(t.id);
                open(objPath(o.id) + '?new=1', { altKey });
              }}
            >
              {t.icon} {t.name}
            </button>
          ))}
      </div>

      <h4 className="section-label">Recently edited</h4>
      {recent.length === 0 && <p className="muted small">Nothing yet. Create your first object above.</p>}
      <div className="row-list">
        {recent.map((o) => (
          <ObjectRow key={o.id} obj={o} type={typeMap.get(o.typeId)} />
        ))}
      </div>
    </div>
  );
}
