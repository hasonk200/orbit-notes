import { useState } from 'react';
import { CalendarDays, CircleCheck, Home, Plus, Search } from 'lucide-react';
import { getOrCreateDaily } from '../db/indexers';
import { todayISO } from '../lib/dates';
import { useOpen, usePane } from '../store/pane';
import { useT, useUI } from '../store/uiStore';
import { CreateSheet } from './CreateSheet';
import { useActiveEditor } from './activeEditor';

/** The floating tab bar at the bottom of the phone layout. */
export function MobileNav() {
  const tr = useT();
  const { path } = usePane();
  const open = useOpen();
  const setPalette = useUI((s) => s.setPalette);
  const [creating, setCreating] = useState(false);
  const typing = useActiveEditor((s) => !!s.editor);
  const p = new URL(path, 'http://orbit.local').pathname;
  const isHome = p === '/home';
  const isCalendar = p === '/' || p.startsWith('/calendar') || p.startsWith('/daily');
  const isTodos = p === '/todos' || p === '/tasks';

  const item = (active: boolean, label: string, icon: React.ReactNode, onClick: () => void) => (
    <button type="button" className={`m-nav-item${active ? ' is-active' : ''}`} aria-label={label} aria-current={active ? 'page' : undefined} onClick={onClick}>
      {icon}
    </button>
  );

  return (
    <>
      <nav className={`m-nav${typing ? ' is-hidden' : ''}`} aria-label={tr('Main')} aria-hidden={typing || undefined}>
        {item(isHome, tr('Home screen'), <Home size={23} />, () => open('/home'))}
        {item(isCalendar, tr('Calendar'), <CalendarDays size={23} />, async () => {
          await getOrCreateDaily(todayISO());
          open(`/calendar?mode=day&date=${todayISO()}`);
        })}
        {item(isTodos, tr('To-do'), <CircleCheck size={23} />, () => open('/todos'))}
        {item(false, tr('Create'), <Plus size={25} />, () => setCreating(true))}
        {item(false, tr('Search'), <Search size={23} />, () => setPalette(true))}
      </nav>
      {creating && <CreateSheet onClose={() => setCreating(false)} />}
    </>
  );
}
