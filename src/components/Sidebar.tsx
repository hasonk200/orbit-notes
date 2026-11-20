import { useMemo, useRef } from 'react';
import { CalendarDays, Compass, Hash, Moon, Network, PanelLeft, Plus, Search, Settings, SquareCheckBig, Sun, Monitor, Trash } from 'lucide-react';
import { displayTitle, useData, useObjMap } from '../store/dataStore';
import { useUI } from '../store/uiStore';
import { objPath, useOpen, usePane } from '../store/pane';
import { getOrCreateDaily } from '../db/indexers';
import { todayISO } from '../lib/dates';
import { NewMenu } from './NewMenu';
import { SyncIndicator } from './CloudSync';

function NavItem({ icon, label, path, active, badge, onClick }: { icon: React.ReactNode; label: string; path?: string; active?: boolean; badge?: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) {
  const open = useOpen();
  return (
    <button type="button" className={`nav-item${active ? ' active' : ''}`} onClick={(e) => (onClick ? onClick(e) : path && open(path, e))}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {badge != null && <span className="nav-badge">{badge}</span>}
    </button>
  );
}

export function Sidebar() {
  const { path } = usePane();
  const objects = useData((s) => s.objects);
  const types = useData((s) => s.types);
  const tasks = useData((s) => s.tasks);
  const pinned = useData((s) => s.pinned);
  const objMap = useObjMap();
  const { toggleSidebar, setPalette, theme, setTheme, setTypeEditor, newMenuOpen, setNewMenu } = useUI();
  const open = useOpen();
  const newBtn = useRef<HTMLButtonElement>(null);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    let trash = 0;
    for (const o of objects) {
      if (o.deletedAt) trash++;
      else c.set(o.typeId, (c.get(o.typeId) ?? 0) + 1);
    }
    return { c, trash };
  }, [objects]);

  const openTasks = useMemo(() => {
    const today = todayISO();
    return tasks.filter((t) => !t.done && t.due && t.due <= today && t.text.trim() && !objMap.get(t.objectId)?.deletedAt).length;
  }, [tasks, objMap]);

  const p = path.split('?')[0];
  const isCal = p === '/' || p.startsWith('/calendar') || p.startsWith('/daily');
  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <div className="brand">
          <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
            <circle cx="16" cy="16" r="6.5" fill="var(--accent)" />
            <ellipse cx="16" cy="16" rx="14" ry="5.2" fill="none" stroke="var(--accent)" strokeWidth="2" transform="rotate(-25 16 16)" />
          </svg>
          Orbit
        </div>
        <button type="button" className="icon-btn" onClick={toggleSidebar} title="Hide sidebar (Ctrl+\)">
          <PanelLeft size={17} />
        </button>
      </div>

      <div className="sb-actions">
        <button type="button" ref={newBtn} className="sb-new" onClick={() => setNewMenu(!newMenuOpen)}>
          <Plus size={16} /> New
        </button>
        <button type="button" className="sb-search" onClick={() => setPalette(true)} title="Search (Ctrl+K)">
          <Search size={16} />
        </button>
        {newMenuOpen && <NewMenu anchor={newBtn.current} onClose={() => setNewMenu(false)} />}
      </div>

      <nav className="sb-nav">
        <NavItem icon={<CalendarDays size={16} />} label="Calendar" path="/calendar" active={isCal} />
        <NavItem
          icon={<span className="nav-today">{new Date().getDate()}</span>}
          label="Today"
          onClick={async (e) => {
            const altKey = e.altKey;
            await getOrCreateDaily(todayISO());
            open(`/calendar?mode=day&date=${todayISO()}`, { altKey });
          }}
        />
        <NavItem icon={<SquareCheckBig size={16} />} label="Tasks" path="/tasks" active={p === '/tasks'} badge={openTasks || null} />
        <NavItem icon={<Compass size={16} />} label="Explore" path="/home" active={p === '/home'} />
        <NavItem icon={<Network size={16} />} label="Graph" path="/graph" active={p === '/graph'} />
        <NavItem icon={<Hash size={16} />} label="Tags" path="/tags" active={p.startsWith('/tags')} />
      </nav>

      <div className="sb-scroll">
        <div className="sb-section">Pinned</div>
        {pinned.filter((id) => objMap.get(id) && !objMap.get(id)!.deletedAt).length === 0 && <div className="sb-empty">No pinned objects</div>}
        {pinned.map((id) => {
          const o = objMap.get(id);
          if (!o || o.deletedAt) return null;
          const t = types.find((x) => x.id === o.typeId);
          return (
            <NavItem
              key={id}
              icon={<span className="nav-emoji">{o.icon || t?.icon}</span>}
              label={displayTitle(o)}
              path={objPath(id)}
              active={p === `/o/${id}`}
            />
          );
        })}

        <div className="sb-section">
          Object Types
          <button type="button" className="icon-btn tiny" title="New object type" onClick={() => setTypeEditor('new')}>
            <Plus size={14} />
          </button>
        </div>
        {types.map((t) => (
          <NavItem
            key={t.id}
            icon={
              <span className="nav-type-icon" style={{ ['--type-color' as any]: t.color }}>
                {t.icon}
              </span>
            }
            label={t.name}
            path={`/type/${t.id}`}
            active={p === `/type/${t.id}`}
            badge={<span className="muted">{counts.c.get(t.id) ?? 0}</span>}
          />
        ))}
      </div>

      <div className="sb-foot">
        <SyncIndicator />
        <NavItem icon={<Trash size={16} />} label="Trash" path="/trash" active={p === '/trash'} badge={counts.trash || null} />
        <div className="sb-foot-row">
          <NavItem icon={<Settings size={16} />} label="Settings" path="/settings" active={p === '/settings'} />
          <button type="button" className="icon-btn" title={`Theme: ${theme} (click for ${nextTheme})`} onClick={() => setTheme(nextTheme)}>
            {theme === 'light' ? <Sun size={16} /> : theme === 'dark' ? <Moon size={16} /> : <Monitor size={16} />}
          </button>
        </div>
      </div>
    </aside>
  );
}
