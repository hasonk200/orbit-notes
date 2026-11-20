import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { addDays, addMonths, endOfMonth, endOfWeek, format, getWeek, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import type { Obj, ObjType, TaskRec } from '../db/schema';
import { getOrCreateDaily } from '../db/indexers';
import { displayTitle, useData, useObjMap, useTypeMap } from '../store/dataStore';
import { objPath, useOpen, usePane } from '../store/pane';
import { fromISODate, toISODate, todayISO } from '../lib/dates';
import { ObjectEditor } from '../editor/Editor';
import { MiniCalendar } from '../components/MiniCalendar';
import { TaskRow } from '../components/TaskRow';
import { ObjectRow } from '../components/ObjectCard';

export type CalMode = 'day' | 'three' | 'week' | 'month';
const MODES: [CalMode, string][] = [
  ['month', 'Month'],
  ['week', 'Week'],
  ['three', 'Three days'],
  ['day', 'Day'],
];

interface CalIndex {
  daily: Map<string, Obj>;
  created: Map<string, Obj[]>;
  dated: Map<string, { obj: Obj; prop: string }[]>;
  due: Map<string, TaskRec[]>;
}

function useCalIndex(): CalIndex {
  const objects = useData((s) => s.objects);
  const tasks = useData((s) => s.tasks);
  const typeMap = useTypeMap();
  const objMap = useObjMap();
  return useMemo(() => {
    const daily = new Map<string, Obj>();
    const created = new Map<string, Obj[]>();
    const dated = new Map<string, { obj: Obj; prop: string }[]>();
    const due = new Map<string, TaskRec[]>();
    const push = <T,>(m: Map<string, T[]>, k: string, v: T) => {
      const a = m.get(k);
      if (a) a.push(v);
      else m.set(k, [v]);
    };
    for (const o of objects) {
      if (o.deletedAt) continue;
      if (o.typeId === 'daily' && o.dailyDate) {
        daily.set(o.dailyDate, o);
        continue;
      }
      push(created, toISODate(new Date(o.createdAt)), o);
      for (const def of typeMap.get(o.typeId)?.properties ?? []) {
        if (def.kind === 'date' && o.props?.[def.key]) push(dated, o.props[def.key], { obj: o, prop: def.name });
      }
    }
    for (const t of tasks) {
      if (!t.due) continue;
      const src = objMap.get(t.objectId);
      if (!src || src.deletedAt) continue;
      push(due, t.due, t);
    }
    return { daily, created, dated, due };
  }, [objects, tasks, typeMap, objMap]);
}

const weekdayColor = (d: Date) => `var(--wd-${d.getDay()})`;

function DayHeader({ iso, size = 'lg' }: { iso: string; size?: 'lg' | 'md' }) {
  const d = fromISODate(iso);
  const isToday = iso === todayISO();
  return (
    <div className={`day-head day-head-${size}`}>
      <div className="day-weekday">
        <span style={{ color: weekdayColor(d) }}>{format(d, 'EEEE')}</span>
        {isToday && <span className="today-badge">Today</span>}
      </div>
      <div className="day-date">
        <span>{format(d, 'MMMM d, yyyy')}</span>
        <span className="day-week">Week {getWeek(d)}</span>
      </div>
    </div>
  );
}

function AddDailyButton({ iso }: { iso: string }) {
  return (
    <button type="button" className="btn add-daily" onClick={() => getOrCreateDaily(iso)}>
      <Plus size={15} /> Daily Note
    </button>
  );
}

function DayExtras({ iso, idx, typeMap }: { iso: string; idx: CalIndex; typeMap: Map<string, ObjType> }) {
  const open = useOpen();
  const dated = idx.dated.get(iso) ?? [];
  const due = idx.due.get(iso) ?? [];
  const created = idx.created.get(iso) ?? [];
  if (!dated.length && !due.length && !created.length) return null;
  return (
    <div className="day-extras">
      {dated.map(({ obj, prop }) => (
        <button key={obj.id + prop} type="button" className="chip" onClick={(e) => open(objPath(obj.id), e)} style={{ ['--type-color' as any]: typeMap.get(obj.typeId)?.color }}>
          {obj.icon || typeMap.get(obj.typeId)?.icon} {displayTitle(obj)} <span className="muted">· {prop}</span>
        </button>
      ))}
      {due.length > 0 && (
        <span className="chip plain">
          ☑ {due.filter((t) => t.done).length}/{due.length} tasks due
        </span>
      )}
      {created.length > 0 && <span className="chip plain">✦ {created.length} created</span>}
    </div>
  );
}

type DayTab = 'all' | 'note' | 'created' | 'tasks';

function DayDetail({ iso, idx }: { iso: string; idx: CalIndex }) {
  const typeMap = useTypeMap();
  const [tab, setTab] = useState<DayTab>('all');
  const note = idx.daily.get(iso);
  const created = idx.created.get(iso) ?? [];
  const dated = idx.dated.get(iso) ?? [];
  const due = [...(idx.due.get(iso) ?? [])].sort((a, b) => Number(a.done) - Number(b.done));
  const tabs: [DayTab, string, number | null][] = [
    ['all', 'All', null],
    ['note', 'Daily note', null],
    ['created', 'Created', created.length],
    ['tasks', 'Due', due.length],
  ];
  const showNote = tab === 'all' || tab === 'note';
  return (
    <div className="day-detail">
      <DayHeader iso={iso} />
      <div className="day-tabs">
        {tabs.map(([k, label, n]) => (
          <button key={k} type="button" className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
            {label}
            {n ? <span className="tab-count">{n}</span> : null}
          </button>
        ))}
      </div>
      {showNote && (note ? <div className="day-note"><ObjectEditor key={note.id} obj={note} placeholder="What’s on your mind today? Type / for commands, [[ to link, @ for dates" /></div> : <AddDailyButton iso={iso} />)}
      {tab === 'all' && dated.length > 0 && (
        <section className="day-section">
          <h4>Scheduled</h4>
          {dated.map(({ obj, prop }) => (
            <ObjectRow key={obj.id + prop} obj={obj} type={typeMap.get(obj.typeId)} right={<span className="muted small">{prop}</span>} />
          ))}
        </section>
      )}
      {(tab === 'all' || tab === 'tasks') && (due.length > 0 || tab === 'tasks') && (
        <section className="day-section">
          <h4>Due this day</h4>
          {due.length === 0 && <p className="muted small">No tasks due. Add “@” inside a task to set a date.</p>}
          {due.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </section>
      )}
      {(tab === 'all' || tab === 'created') && (created.length > 0 || tab === 'created') && (
        <section className="day-section">
          <h4>Created this day</h4>
          {created.length === 0 && (
            <div className="empty-inline">
              <strong>There’s nothing here (yet).</strong>
              <span>Objects you create on this day show up here.</span>
            </div>
          )}
          {created.map((o) => (
            <ObjectRow key={o.id} obj={o} type={typeMap.get(o.typeId)} />
          ))}
        </section>
      )}
    </div>
  );
}

function MonthView({ month, idx, onPickDay, onPickMonth }: { month: Date; idx: CalIndex; onPickDay: (iso: string) => void; onPickMonth: (m: Date) => void }) {
  const open = useOpen();
  const typeMap = useTypeMap();
  const objMap = useObjMap();
  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = startOfWeek(startOfMonth(month)); d <= endOfWeek(endOfMonth(month)); d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);
  const today = todayISO();
  const noteCount = days.filter((d) => isSameMonth(d, month) && idx.daily.has(toISODate(d))).length;
  return (
    <div className="month-view">
      <div className="month-strip">
        {Array.from({ length: 12 }, (_, i) => (
          <button key={i} type="button" className={`month-chip${i === month.getMonth() ? ' active' : ''}`} onClick={() => onPickMonth(new Date(month.getFullYear(), i, 1))}>
            {format(new Date(2000, i, 1), 'MMM')}
          </button>
        ))}
      </div>
      <div className="month-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
          <div key={d} className="month-dow" style={{ color: `var(--wd-${i})` }}>
            {d}
          </div>
        ))}
        {days.map((d) => {
          const iso = toISODate(d);
          const note = idx.daily.get(iso);
          const dated = idx.dated.get(iso) ?? [];
          const due = idx.due.get(iso) ?? [];
          const items = [
            ...dated.map(({ obj }) => ({ key: 'o' + obj.id, label: displayTitle(obj), icon: obj.icon || typeMap.get(obj.typeId)?.icon, color: typeMap.get(obj.typeId)?.color, id: obj.id, done: false })),
            ...due.map((t) => ({ key: 't' + t.id, label: t.text || 'Task', icon: t.done ? '☑' : '☐', color: undefined, id: objMap.get(t.objectId)?.id ?? '', done: t.done })),
          ];
          return (
            <div key={iso} className={`month-cell${isSameMonth(d, month) ? '' : ' other'}${iso === today ? ' today' : ''}`} onClick={() => onPickDay(iso)}>
              <div className="month-cell-head">
                <span className="month-num">{d.getDate()}</span>
                {note && <span className="month-note" title="Daily note">📅</span>}
              </div>
              {items.slice(0, 3).map((it) => (
                <button
                  key={it.key}
                  type="button"
                  className={`month-item${it.done ? ' done' : ''}`}
                  style={{ ['--type-color' as any]: it.color }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (it.id) open(objPath(it.id), e);
                  }}
                >
                  <span>{it.icon}</span> {it.label}
                </button>
              ))}
              {items.length > 3 && <div className="month-more">+{items.length - 3} more</div>}
            </div>
          );
        })}
      </div>
      {noteCount === 0 && (
        <div className="empty-inline center">
          <strong>No daily notes for this month yet.</strong>
          <span>Click any day to open it and add a daily note.</span>
        </div>
      )}
    </div>
  );
}

export function CalendarView({ mode, date }: { mode: CalMode; date: string }) {
  const { replace } = usePane();
  const idx = useCalIndex();
  const typeMap = useTypeMap();
  const safeMode: CalMode = MODES.some(([m]) => m === mode) ? mode : 'day';
  const d = fromISODate(date);
  const set = (m: CalMode, iso: string) => replace(`/calendar?mode=${m}&date=${iso}`);
  const step = (dir: number) => {
    const next =
      safeMode === 'month' ? addMonths(d, dir) : safeMode === 'week' ? addDays(d, 7 * dir) : safeMode === 'three' ? addDays(d, 3 * dir) : addDays(d, dir);
    set(safeMode, toISODate(next));
  };
  const marks = useMemo(() => new Set(idx.daily.keys()), [idx]);

  let range: string[] = [];
  if (safeMode === 'three') range = [-1, 0, 1].map((i) => toISODate(addDays(d, i)));
  if (safeMode === 'week') {
    const s = startOfWeek(d);
    range = Array.from({ length: 7 }, (_, i) => toISODate(addDays(s, i)));
  }

  return (
    <div className="cal">
      <div className="cal-bar">
        <div className="cal-label">{format(d, 'MMM yyyy')}</div>
        <div className="segmented">
          {MODES.map(([m, label]) => (
            <button key={m} type="button" className={m === safeMode ? 'active' : ''} onClick={() => set(m, date)}>
              {label}
            </button>
          ))}
        </div>
        <div className="cal-nav">
          <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label="Previous">
            <ChevronLeft size={17} />
          </button>
          <button type="button" className="cal-today" onClick={() => set(safeMode, todayISO())}>
            Today
          </button>
          <button type="button" className="icon-btn" onClick={() => step(1)} aria-label="Next">
            <ChevronRight size={17} />
          </button>
        </div>
      </div>

      {safeMode === 'day' && (
        <div className="cal-day-layout">
          <div className="cal-day-main">
            <DayDetail key={date} iso={date} idx={idx} />
          </div>
          <aside className="cal-day-aside">
            <MiniCalendar selected={date} onSelect={(iso) => set('day', iso)} marks={marks} />
            <UpcomingTasks />
          </aside>
        </div>
      )}

      {(safeMode === 'three' || safeMode === 'week') && (
        <div className="cal-days">
          {range.map((iso) => {
            const note = idx.daily.get(iso);
            return (
              <div key={iso} className="cal-day-block">
                <button type="button" className="day-head-btn" onClick={() => set('day', iso)}>
                  <DayHeader iso={iso} size="md" />
                </button>
                {note ? (
                  <div className="day-note compact">
                    <ObjectEditor key={note.id} obj={note} placeholder="Write…" />
                  </div>
                ) : (
                  <AddDailyButton iso={iso} />
                )}
                <DayExtras iso={iso} idx={idx} typeMap={typeMap} />
              </div>
            );
          })}
        </div>
      )}

      {safeMode === 'month' && (
        <MonthView month={startOfMonth(d)} idx={idx} onPickDay={(iso) => set('day', iso)} onPickMonth={(m) => set('month', toISODate(m))} />
      )}
    </div>
  );
}

function UpcomingTasks() {
  const tasks = useData((s) => s.tasks);
  const objMap = useObjMap();
  const today = todayISO();
  const week = toISODate(addDays(new Date(), 7));
  const list = tasks
    .filter((t) => !t.done && t.due && t.due <= week && !objMap.get(t.objectId)?.deletedAt)
    .sort((a, b) => (a.due! < b.due! ? -1 : 1))
    .slice(0, 8);
  return (
    <div className="upcoming">
      <h4>Next 7 days</h4>
      {list.length === 0 && <p className="muted small">Nothing due. Enjoy the calm.</p>}
      {list.map((t) => (
        <TaskRow key={t.id} task={t} />
      ))}
      {list.some((t) => t.due! < today) && <p className="muted small">Includes overdue tasks.</p>}
    </div>
  );
}
