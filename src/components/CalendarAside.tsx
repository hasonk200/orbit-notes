import { useMemo } from 'react';
import { addDays } from 'date-fns';
import { useT, useUI } from '../store/uiStore';
import { useData, useObjMap, useSpaceTasks } from '../store/dataStore';
import { AI_LOG_TYPE, spaceOf } from '../lib/spaces';
import { toISODate, todayISO } from '../lib/dates';
import { useOpen } from '../store/pane';
import { useIsMobile } from '../mobile/useIsMobile';
import { MiniCalendar } from './MiniCalendar';
import { TaskRow } from './TaskRow';

/** The next week's open tasks and to-dos, as shown beside the diary and the task pages. */
export function UpcomingTasks() {
  const tr = useT();
  const tasks = useSpaceTasks();
  const objMap = useObjMap();
  const today = todayISO();
  const week = toISODate(addDays(new Date(), 7));
  const list = tasks
    .filter((t) => !t.done && t.due && t.due <= week && t.text.trim() && objMap.has(t.objectId) && !objMap.get(t.objectId)?.deletedAt)
    .sort((a, b) => (a.due! < b.due! ? -1 : 1))
    .slice(0, 8);
  return (
    <div className="upcoming">
      <h4>{tr('Next 7 days')}</h4>
      {list.length === 0 && <p className="muted small">{tr('Nothing due. Enjoy the calm.')}</p>}
      {list.map((t) => (
        <TaskRow key={t.id} task={t} showKindBadge showStatus={false} />
      ))}
      {list.some((t) => t.due! < today) && <p className="muted small">{tr('Includes overdue tasks.')}</p>}
    </div>
  );
}

/** Dates that have a day note in the current space (daily notes, or AI logs in the AI workspace). */
export function useDayNoteDates() {
  const objects = useData((s) => s.objects);
  const space = useUI((s) => s.space);
  return useMemo(() => {
    const dayType = space === 'ai' ? AI_LOG_TYPE : 'daily';
    const out = new Set<string>();
    for (const o of objects) {
      if (!o.deletedAt && o.typeId === dayType && o.dailyDate && spaceOf(o) === space) out.add(o.dailyDate);
    }
    return out;
  }, [objects, space]);
}

/** The diary's right column (month + next 7 days), reused beside To-do, Routines and Tasks. Picking a day opens it in the diary. */
export function CalendarAside() {
  const open = useOpen();
  const marks = useDayNoteDates();
  return (
    <div className="side-cal-inner">
      <MiniCalendar selected={todayISO()} marks={marks} onSelect={(iso) => open(`/calendar?mode=day&date=${iso}`)} />
      <UpcomingTasks />
    </div>
  );
}

/** Puts the diary's month and upcoming list on the right of a desktop page; hidden on phones and narrow panes. */
export function WithCalendarAside({ children }: { children: React.ReactNode }) {
  if (useIsMobile()) return <>{children}</>;
  return (
    <div className="side-cal">
      <div className="side-cal-grid">
        <div className="side-cal-main">{children}</div>
        <aside className="side-cal-aside">
          <CalendarAside />
        </aside>
      </div>
    </div>
  );
}
