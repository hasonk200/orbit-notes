import { lazy, Suspense } from 'react';
import { ObjectPage } from './views/ObjectPage';
import { CalendarView, type CalMode } from './views/CalendarView';
import { TasksView } from './views/TasksView';
import { TodosView } from './views/TodosView';
import { RoutinesView } from './views/RoutinesView';
import { WithCalendarAside } from './components/CalendarAside';
import { TypeView } from './views/TypeView';
import { TagsView } from './views/TagsView';
import { TrashView } from './views/TrashView';
import { HomeView } from './views/HomeView';
import { LocalFileView } from './views/LocalFileView';
import { MobileHome } from './mobile/MobileHome';
import { AiHome } from './views/AiHome';
import { useUI } from './store/uiStore';
import { useIsMobile } from './mobile/useIsMobile';
import { todayISO } from './lib/dates';
import type { Translate } from './lib/i18n';

/** The AI workspace has its own home. In my space, phones get their own home screen and the desktop keeps Explore. */
function HomeRoute() {
  const mobile = useIsMobile();
  if (useUI((s) => s.space) === 'ai') return <AiHome />;
  return mobile ? <MobileHome /> : <HomeView />;
}

// Settings includes the AI access panel, which needs the Firebase SDK.
const Settings = lazy(() => import('./views/Settings').then((m) => ({ default: m.Settings })));
const GraphView = lazy(() => import('./views/GraphView').then((m) => ({ default: m.GraphView })));

export function decodePathSegment(part: string) {
  try { return decodeURIComponent(part); } catch { return part; }
}

/** Path → view. Used by both the main pane (router location) and the split pane (own history). */
export function renderPath(path: string, tr: Translate) {
  const url = new URL(path, 'http://orbit.local');
  const parts = url.pathname.split('/').filter(Boolean).map(decodePathSegment);
  const [a, b] = parts;
  const q = url.searchParams;
  switch (a) {
    case undefined:
    case 'calendar':
      return <CalendarView mode={(q.get('mode') as CalMode) ?? 'day'} date={q.get('date') ?? todayISO()} />;
    case 'daily':
      return <CalendarView mode="day" date={b ?? todayISO()} />;
    case 'o':
      if (b?.startsWith('daily-')) return <CalendarView mode="day" date={b.slice(6)} />;
      return <ObjectPage id={b} isNew={q.get('new') === '1'} />;
    case 'type':
      return <TypeView typeId={b} collectionId={q.get('collection')} />;
    case 'todos':
      return (
        <WithCalendarAside>
          <TodosView />
        </WithCalendarAside>
      );
    case 'routines':
      return (
        <WithCalendarAside>
          <RoutinesView />
        </WithCalendarAside>
      );
    case 'tasks':
      return (
        <WithCalendarAside>
          <TasksView />
        </WithCalendarAside>
      );
    case 'graph':
      return (
        <Suspense fallback={<div className="empty-state muted">{tr('Loading graph…')}</div>}>
          <GraphView />
        </Suspense>
      );
    case 'tags':
      return <TagsView tag={b} />;
    case 'trash':
      return <TrashView />;
    case 'settings':
      return (
        <Suspense fallback={<div className="empty-state muted">{tr('Loading…')}</div>}>
          <Settings />
        </Suspense>
      );
    case 'local-file':
      return <LocalFileView path={q.get('path')} />;
    case 'home':
      return <HomeRoute />;
    default:
      return (
        <div className="empty-state">
          <h2>{tr('Page not found')}</h2>
        </div>
      );
  }
}
