import { lazy, Suspense } from 'react';
import { ObjectPage } from './views/ObjectPage';
import { CalendarView, type CalMode } from './views/CalendarView';
import { TasksView } from './views/TasksView';
import { TodosView } from './views/TodosView';
import { TypeView } from './views/TypeView';
import { TagsView } from './views/TagsView';
import { TrashView } from './views/TrashView';
import { Settings } from './views/Settings';
import { HomeView } from './views/HomeView';
import { todayISO } from './lib/dates';
import type { Translate } from './lib/i18n';

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
      return <TodosView />;
    case 'tasks':
      return <TasksView />;
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
      return <Settings />;
    case 'home':
      return <HomeView />;
    default:
      return (
        <div className="empty-state">
          <h2>{tr('Page not found')}</h2>
        </div>
      );
  }
}
