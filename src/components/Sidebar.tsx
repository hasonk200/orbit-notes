import { typeLabel } from '../lib/typeLabels';
import { useMemo, useRef } from 'react';
import { CalendarDays, CircleCheck, Compass, Hash, Moon, Network, PanelLeft, Plus, Search, Settings, SquareCheckBig, Sun, Monitor, Trash } from 'lucide-react';
import { displayTitle, useData, useObjMap } from '../store/dataStore';
import { useT, useUI } from '../store/uiStore';
import { objPath, useOpen, usePane } from '../store/pane';
import { getOrCreateDaily } from '../db/indexers';
import { todayISO } from '../lib/dates';
import { classifyTaskKind } from '../lib/tasks';
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
  const tr = useT();
  const { path } = usePane();
  const objects = useData((s) => s.objects);
  const types = useData((s) => s.types);
  const collections = useData((s) => s.collections);
  const tasks = useData((s) => s.tasks);
  const pinned = useData((s) => s.pinned);
  const objMap = useObjMap();
  const { toggleSidebar, setPalette, theme, setTheme, setTypeEditor, newMenuOpen, setNewMenu } = useUI();
  const open = useOpen();
  const newBtn = useRef<HTMLButtonElement>(null);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    const col = new Map<string, number>();
    let trash = 0;
    for (const o of objects) {
      if (o.deletedAt) trash++;
      else {
        c.set(o.typeId, (c.get(o.typeId) ?? 0) + 1);
        for (const cid of o.collectionIds ?? []) col.set(cid, (col.get(cid) ?? 0) + 1);
      }
    }
    return { c, col, trash };
  }, [objects]);

  const { openTodos, openTasks } = useMemo(() => {
    const today = todayISO();
    let todosC = 0;
    let tasksC = 0;
    for (const t of tasks) {
      if (t.done || !t.text.trim()) continue;
      const src = objMap.get(t.objectId);
      if (!src || src.deletedAt) continue;
      const k =
        t.kind ??
        classifyTaskKind({
          explicitKind: t.explicitKind,
          status: t.status,
          contextId: t.contextId,
          sourceTypeId: src.typeId,
        });
      if (k === 'todo') {
        if (t.due && t.due <= today) todosC++;
      } else {
        if ((t.due && t.due <= today) || t.status === 'in_progress') tasksC++;
      }
    }
    return { openTodos: todosC, openTasks: tasksC };
  }, [tasks, objMap]);

  const parsedUrl = new URL(path, 'http://orbit.local');
  const p = parsedUrl.pathname;
  const activeColId = parsedUrl.searchParams.get('collection');
  const isCal = p === '/' || p.startsWith('/calendar') || p.startsWith('/daily');
  const themeLabel = { light: tr('Light'), dark: tr('Dark'), system: tr('System') };
  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <button type="button" className="brand" onClick={(e) => open('/', e)} title={tr('Home')}>
          <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
            <defs>
              <clipPath id="orbit-logo-front">
                <rect x="5" y="16" width="22" height="16" />
              </clipPath>
              {/* cut a thin gap in the planet where the front of the ring passes over it */}
              <mask id="orbit-logo-gap" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
                <rect width="32" height="32" fill="#fff" />
                <ellipse cx="16" cy="16" rx="14" ry="5.2" fill="none" stroke="#000" strokeWidth="4.6" clipPath="url(#orbit-logo-front)" />
              </mask>
            </defs>
            <g transform="rotate(-22 16 16)">
              <ellipse cx="16" cy="16" rx="14" ry="5.2" fill="none" stroke="var(--accent)" strokeWidth="2.6" />
              <circle cx="16" cy="16" r="8" fill="var(--accent)" mask="url(#orbit-logo-gap)" />
            </g>
            <circle cx="28.6" cy="10.4" r="2.2" fill="var(--accent)" />
          </svg>
          Orbit
        </button>
        <button type="button" className="icon-btn" onClick={toggleSidebar} title={tr('Hide sidebar (Ctrl+\\)')}>
          <PanelLeft size={17} />
        </button>
      </div>

      <div className="sb-actions">
        <button type="button" ref={newBtn} className="sb-new" onClick={() => setNewMenu(!newMenuOpen)}>
          <Plus size={16} /> {tr('New')}
        </button>
        <button type="button" className="sb-search" onClick={() => setPalette(true)} title={tr('Search (Ctrl+K)')}>
          <Search size={16} />
        </button>
        {newMenuOpen && <NewMenu anchor={newBtn.current} onClose={() => setNewMenu(false)} />}
      </div>

      <nav className="sb-nav">
        <NavItem icon={<CalendarDays size={16} />} label={tr('Calendar')} path="/calendar" active={isCal} />
        <NavItem
          icon={<span className="nav-today">{new Date().getDate()}</span>}
          label={tr('Today')}
          onClick={async (e) => {
            const altKey = e.altKey;
            await getOrCreateDaily(todayISO());
            open(`/calendar?mode=day&date=${todayISO()}`, { altKey });
          }}
        />
        <NavItem icon={<CircleCheck size={16} />} label={tr('To-do')} path="/todos" active={p === '/todos'} badge={openTodos || null} />
        <NavItem icon={<SquareCheckBig size={16} />} label={tr('Tasks')} path="/tasks" active={p === '/tasks'} badge={openTasks || null} />
        <NavItem icon={<Compass size={16} />} label={tr('Explore')} path="/home" active={p === '/home'} />
        <NavItem icon={<Network size={16} />} label={tr('Graph')} path="/graph" active={p === '/graph'} />
        <NavItem icon={<Hash size={16} />} label={tr('Tags')} path="/tags" active={p.startsWith('/tags')} />
      </nav>

      <div className="sb-scroll">
        <div className="sb-section">{tr('Pinned')}</div>
        {pinned.filter((id) => objMap.get(id) && !objMap.get(id)!.deletedAt).length === 0 && <div className="sb-empty">{tr('No pinned objects')}</div>}
        {pinned.map((id) => {
          const o = objMap.get(id);
          if (!o || o.deletedAt) return null;
          const t = types.find((x) => x.id === o.typeId);
          return (
            <NavItem
              key={id}
              icon={<span className="nav-emoji">{o.icon || t?.icon}</span>}
              label={displayTitle(o, tr)}
              path={objPath(id)}
              active={p === `/o/${id}`}
            />
          );
        })}

        <div className="sb-section">
          {tr('Object Types')}
          <button type="button" className="icon-btn tiny" title={tr('New object type')} onClick={() => setTypeEditor('new')}>
            <Plus size={14} />
          </button>
        </div>
        {types.map((t) => {
          const cols = collections.filter((c) => c.typeId === t.id);
          return (
            <div key={t.id} className="sb-type-group">
              <NavItem
                icon={
                  <span className="nav-type-icon" style={{ ['--type-color' as any]: t.color }}>
                    {t.icon}
                  </span>
                }
                label={typeLabel(t, tr)}
                path={`/type/${t.id}`}
                active={p === `/type/${t.id}` && !activeColId}
                badge={<span className="muted">{counts.c.get(t.id) ?? 0}</span>}
              />
              {cols.map((col) => (
                <div key={col.id} className="sb-col-item">
                  <NavItem
                    icon={<span className="nav-emoji">{col.icon || '📁'}</span>}
                    label={col.name}
                    path={`/type/${t.id}?collection=${col.id}`}
                    active={p === `/type/${t.id}` && activeColId === col.id}
                    badge={<span className="muted">{counts.col.get(col.id) ?? 0}</span>}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="sb-foot">
        <SyncIndicator />
        <NavItem icon={<Trash size={16} />} label={tr('Trash')} path="/trash" active={p === '/trash'} badge={counts.trash || null} />
        <div className="sb-foot-row">
          <NavItem icon={<Settings size={16} />} label={tr('Settings')} path="/settings" active={p === '/settings'} />
          <button type="button" className="icon-btn" title={tr('Theme: {current} (click for {next})', { current: themeLabel[theme], next: themeLabel[nextTheme] })} onClick={() => setTheme(nextTheme)}>
            {theme === 'light' ? <Sun size={16} /> : theme === 'dark' ? <Moon size={16} /> : <Monitor size={16} />}
          </button>
        </div>
        <div className="sb-version" title={`${tr('Built')} ${__APP_BUILT__}${__APP_COMMIT__ ? ` · ${__APP_COMMIT__}` : ''}`}>
          Orbit v{__APP_VERSION__}{__APP_COMMIT__ && ` · ${__APP_COMMIT__}`}
        </div>
      </div>
    </aside>
  );
}
