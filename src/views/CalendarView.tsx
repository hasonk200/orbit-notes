import { useT } from '../store/uiStore';
import { useMemo, useState } from 'react';
import { CalendarCheck, CalendarDays, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, CirclePlus, Clock, Link2, Pin, PinOff, Plus, Trash } from 'lucide-react';
import { addDays, addMonths, endOfMonth, endOfWeek, getWeek, isSameMonth, isValid, startOfMonth, startOfWeek } from 'date-fns';
import type { Obj, ObjType, TaskRec } from '../db/schema';
import { getOrCreateDaily, softDelete } from '../db/indexers';
import { displayTitle, togglePinned, useData, useObjMap, useTypeMap } from '../store/dataStore';
import { objPath, useOpen, usePane } from '../store/pane';
import { dailyTitle, dateLabel, fromISODate, toISODate, todayISO } from '../lib/dates';
import { propertyLabel } from '../lib/typeLabels';
import { Backlinks } from '../components/Backlinks';
import { ObjectEditor } from '../editor/Editor';
import { MiniCalendar } from '../components/MiniCalendar';
import { TaskRow } from '../components/TaskRow';
import { ObjectRow } from '../components/ObjectCard';
import { useIsMobile } from '../mobile/useIsMobile';
import { MobileHeader, MobileSegmented } from '../mobile/MobileHeader';
import { WeekStrip } from '../mobile/WeekStrip';
import type { MenuAction } from '../mobile/BottomSheet';
import { copyObjectLink } from '../mobile/copyLink';

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
  dated: Map<string, { obj: Obj; prop: string; fieldId: string }[]>;
  due: Map<string, TaskRec[]>;
}

function useCalIndex(): CalIndex {
  const tr = useT();
  const objects = useData((s) => s.objects);
  const tasks = useData((s) => s.tasks);
  const typeMap = useTypeMap();
  const objMap = useObjMap();
  return useMemo(() => {
    const daily = new Map<string, Obj>();
    const created = new Map<string, Obj[]>();
    const dated = new Map<string, { obj: Obj; prop: string; fieldId: string }[]>();
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
      const type = typeMap.get(o.typeId);
      for (const def of type?.properties ?? []) {
        if (def.kind === 'date' && o.props?.[def.key]) push(dated, o.props[def.key], { obj: o, prop: propertyLabel(type, def, tr), fieldId: def.key });
      }
    }
    for (const t of tasks) {
      if (!t.due) continue;
      const src = objMap.get(t.objectId);
      if (!src || src.deletedAt) continue;
      push(due, t.due, t);
    }
    return { daily, created, dated, due };
  }, [objects, tasks, typeMap, objMap, tr]);
}

const weekdayColor = (d: Date) => `var(--wd-${d.getDay()})`;

function DayHeader({ iso, size = 'lg' }: { iso: string; size?: 'lg' | 'md' }) {
  const tr = useT();
  const d = fromISODate(iso);
  const isToday = iso === todayISO();
  return (
    <div className={`day-head day-head-${size}`}>
      <div className="day-weekday">
        <span style={{ color: weekdayColor(d) }}>{dateLabel(d, tr, 'EEEE')}</span>
        {isToday && <span className="today-badge">{tr('Today')}</span>}
      </div>
      <div className="day-date">
        <span>{dateLabel(d, tr, 'MMMM d, yyyy', 'yyyy年M月d日')}</span>
        <span className="day-week">{tr('Week {number}', { number: getWeek(d) })}</span>
      </div>
    </div>
  );
}

function AddDailyButton({ iso }: { iso: string }) {
  const tr = useT();
  return (
    <button type="button" className="btn add-daily" onClick={() => getOrCreateDaily(iso)}>
      <Plus size={15} /> {tr('Daily Note')}
    </button>
  );
}

function DayExtras({ iso, idx, typeMap }: { iso: string; idx: CalIndex; typeMap: Map<string, ObjType> }) {
  const tr = useT();
  const open = useOpen();
  const dated = idx.dated.get(iso) ?? [];
  const due = idx.due.get(iso) ?? [];
  const created = idx.created.get(iso) ?? [];
  if (!dated.length && !due.length && !created.length) return null;
  return (
    <div className="day-extras">
      {dated.map(({ obj, prop, fieldId }) => (
        <button key={obj.id + fieldId} type="button" className="chip" onClick={(e) => open(objPath(obj.id), e)} style={{ ['--type-color' as any]: typeMap.get(obj.typeId)?.color }}>
          {obj.icon || typeMap.get(obj.typeId)?.icon} {displayTitle(obj, tr)} <span className="muted">· {prop}</span>
        </button>
      ))}
      {due.length > 0 && (
        <span className="chip plain">
          ✓ {tr('{done}/{total} due tasks completed', { done: due.filter((t) => t.done).length, total: due.length })}
        </span>
      )}
      {created.length > 0 && <span className="chip plain">✦ {tr('{count} created', { count: created.length })}</span>}
    </div>
  );
}

type DayTab = 'all' | 'note' | 'created' | 'tasks';

function DayDetail({ iso, idx, tab: shownTab, onTab, hideTabs }: { iso: string; idx: CalIndex; tab?: DayTab; onTab?: (t: DayTab) => void; hideTabs?: boolean }) {
  const tr = useT();
  const typeMap = useTypeMap();
  const [ownTab, setOwnTab] = useState<DayTab>('all');
  // The phone layout drives the tab from its top bar; the desktop keeps its own.
  const tab = shownTab ?? ownTab;
  const setTab = onTab ?? setOwnTab;
  const note = idx.daily.get(iso);
  const created = idx.created.get(iso) ?? [];
  const dated = idx.dated.get(iso) ?? [];
  const due = [...(idx.due.get(iso) ?? [])].sort((a, b) => Number(a.done) - Number(b.done));
  const tabs: [DayTab, string, number | null][] = [
    ['all', tr('All'), null],
    ['note', tr('Daily note'), null],
    ['created', tr('Created'), created.length],
    ['tasks', tr('Due'), due.length],
  ];
  const showNote = tab === 'all' || tab === 'note';
  return (
    <div className="day-detail">
      <DayHeader iso={iso} />
      {!hideTabs && (
      <div className="day-tabs">
        {tabs.map(([k, label, n]) => (
          <button key={k} type="button" className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
            {label}
            {n ? <span className="tab-count">{n}</span> : null}
          </button>
        ))}
      </div>
      )}
      {showNote && (note ? (
        <div className="day-note">
          <ObjectEditor key={note.id} obj={note} placeholder={tr('What’s on your mind today? Type / for commands, [[ to link, @ for dates')} />
          <Backlinks objectId={note.id} />
        </div>
      ) : <AddDailyButton iso={iso} />)}
      {tab === 'all' && dated.length > 0 && (
        <section className="day-section">
          <h4>{tr('Scheduled')}</h4>
          {dated.map(({ obj, prop, fieldId }) => (
            <ObjectRow key={obj.id + fieldId} obj={obj} type={typeMap.get(obj.typeId)} right={<span className="muted small">{prop}</span>} />
          ))}
        </section>
      )}
      {(tab === 'all' || tab === 'tasks') && (due.length > 0 || tab === 'tasks') && (
        <section className="day-section">
          <h4>{tr('Due this day')}</h4>
          {due.length === 0 && <p className="muted small">{tr('No tasks due. Add “@” inside a task to set a date.')}</p>}
          {due.map((t) => (
            <TaskRow key={t.id} task={t} showKindBadge />
          ))}
        </section>
      )}
      {(tab === 'all' || tab === 'created') && (created.length > 0 || tab === 'created') && (
        <section className="day-section">
          <h4>{tr('Created this day')}</h4>
          {created.length === 0 && (
            <div className="empty-inline">
              <strong>{tr('There’s nothing here (yet).')}</strong>
              <span>{tr('Objects you create on this day show up here.')}</span>
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
  const tr = useT();
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
            {dateLabel(new Date(2000, i, 1), tr, 'MMM', 'M月')}
          </button>
        ))}
      </div>
      <div className="month-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
          <div key={d} className="month-dow" style={{ color: `var(--wd-${i})` }}>
            {tr.language === 'zh-Hant' ? dateLabel(new Date(2024, 0, 7 + i), tr, 'EEEEEE') : d}
          </div>
        ))}
        {days.map((d) => {
          const iso = toISODate(d);
          const note = idx.daily.get(iso);
          const dated = idx.dated.get(iso) ?? [];
          const due = idx.due.get(iso) ?? [];
          const items = [
            ...dated.map(({ obj, fieldId }) => ({ key: 'o' + obj.id + fieldId, label: displayTitle(obj, tr), icon: obj.icon || typeMap.get(obj.typeId)?.icon, color: typeMap.get(obj.typeId)?.color, id: obj.id, done: false })),
            ...due.map((t) => ({ key: 't' + t.id, label: t.text || tr('Task'), icon: t.done ? '☑' : '☐', color: undefined, id: objMap.get(t.objectId)?.id ?? '', done: t.done })),
          ];
          return (
            <div key={iso} className={`month-cell${isSameMonth(d, month) ? '' : ' other'}${iso === today ? ' today' : ''}`} onClick={() => onPickDay(iso)}>
              <button type="button" className="month-cell-head" aria-label={dailyTitle(iso, tr)}>
                <span className="month-num">{d.getDate()}</span>
                {note && <span className="month-note" title={tr('Daily note')}>📅</span>}
              </button>
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
              {items.length > 3 && <div className="month-more">{tr('+{count} more', { count: items.length - 3 })}</div>}
            </div>
          );
        })}
      </div>
      {noteCount === 0 && (
        <div className="empty-inline center">
          <strong>{tr('No daily notes for this month yet.')}</strong>
          <span>{tr('Click any day to open it and add a daily note.')}</span>
        </div>
      )}
    </div>
  );
}

/** The phone calendar: a week strip, then the chosen day; the switch and "⋯" live in the floating bar. */
function MobileDay({ date, idx, set }: { date: string; idx: CalIndex; set: (m: CalMode, iso: string) => void }) {
  const tr = useT();
  const pinned = useData((s) => s.pinned);
  const [tab, setTab] = useState<DayTab>('all');
  const [monthOpen, setMonthOpen] = useState(false);
  const marks = useMemo(() => new Set(idx.daily.keys()), [idx]);
  const note = idx.daily.get(date);
  const created = idx.created.get(date) ?? [];
  const due = (idx.due.get(date) ?? []).filter((t) => !t.done);
  const today = todayISO();
  const isPinned = !!note && pinned.includes(note.id);

  const actions: MenuAction[] = [
    ...(date !== today ? [{ key: 'today', icon: <CalendarDays size={20} />, label: tr('Go to today'), onClick: () => set('day', today) }] : []),
    { key: 'month', icon: <CalendarRange size={20} />, label: tr('Month view'), onClick: () => set('month', date) },
    ...(note
      ? [
          { key: 'pin', group: 1, icon: isPinned ? <PinOff size={20} /> : <Pin size={20} />, label: tr(isPinned ? 'Unpin from Home' : 'Pin to Home'), onClick: () => void togglePinned(note.id) },
          { key: 'link', group: 1, icon: <Link2 size={20} />, label: tr('Copy link'), onClick: () => void copyObjectLink(note.id) },
          {
            key: 'trash',
            group: 2,
            danger: true,
            icon: <Trash size={20} />,
            label: tr('Move to Trash'),
            onClick: () => {
              if (window.confirm(tr('Move this daily note to Trash? You can restore it from Trash.'))) void softDelete(note.id);
            },
          },
        ]
      : []),
  ];

  return (
    <div className="m-day">
      <MobileHeader
        center={
          <MobileSegmented<DayTab>
            label={tr('Show')}
            value={tab === 'note' ? 'all' : tab}
            onChange={setTab}
            options={[
              { value: 'all', icon: <CalendarCheck size={17} />, label: tr('Daily note') },
              { value: 'created', icon: <CirclePlus size={17} />, label: tr('Created'), count: created.length },
              { value: 'tasks', icon: <Clock size={17} />, label: tr('Due'), count: due.length },
            ]}
          />
        }
        actions={actions}
        menuLabel={tr('Day actions')}
      />
      <WeekStrip selected={date} onSelect={(iso) => set('day', iso)} marks={marks} />
      <button type="button" className={`m-week-expand${monthOpen ? ' is-open' : ''}`} aria-expanded={monthOpen} aria-label={tr(monthOpen ? 'Hide month' : 'Show month')} onClick={() => setMonthOpen((v) => !v)}>
        <ChevronDown size={22} />
      </button>
      {monthOpen && (
        <div className="m-month">
          <MiniCalendar
            selected={date}
            marks={marks}
            onSelect={(iso) => {
              set('day', iso);
              setMonthOpen(false);
            }}
          />
        </div>
      )}
      <div className="m-day-body">
        <DayDetail key={date} iso={date} idx={idx} tab={tab} onTab={setTab} hideTabs />
        {tab === 'all' && <UpcomingTasks />}
      </div>
    </div>
  );
}

export function CalendarView({ mode, date: requestedDate }: { mode: CalMode; date: string }) {
  const tr = useT();
  const { replace } = usePane();
  const idx = useCalIndex();
  const typeMap = useTypeMap();
  const safeMode: CalMode = MODES.some(([m]) => m === mode) ? mode : 'day';
  const parsedDate = fromISODate(requestedDate);
  const d = isValid(parsedDate) ? parsedDate : fromISODate(todayISO());
  const date = toISODate(d);
  const set = (m: CalMode, iso: string) => replace(`/calendar?mode=${m}&date=${iso}`);
  const step = (dir: number) => {
    const next =
      safeMode === 'month' ? addMonths(d, dir) : safeMode === 'week' ? addDays(d, 7 * dir) : safeMode === 'three' ? addDays(d, 3 * dir) : addDays(d, dir);
    set(safeMode, toISODate(next));
  };
  const marks = useMemo(() => new Set(idx.daily.keys()), [idx]);
  const mobile = useIsMobile();

  // Phones show one day at a time (with a week strip); the month grid stays available from the ⋯ menu.
  if (mobile && safeMode !== 'month') return <MobileDay date={date} idx={idx} set={set} />;

  let range: string[] = [];
  if (safeMode === 'three') range = [-1, 0, 1].map((i) => toISODate(addDays(d, i)));
  if (safeMode === 'week') {
    const s = startOfWeek(d);
    range = Array.from({ length: 7 }, (_, i) => toISODate(addDays(s, i)));
  }

  return (
    <div className="cal">
      <div className="cal-bar">
        <div className="cal-label">{dateLabel(d, tr, 'MMM yyyy', 'yyyy年M月')}</div>
        <div className="segmented">
          {MODES.map(([m, label]) => (
            <button key={m} type="button" className={m === safeMode ? 'active' : ''} onClick={() => set(m, date)}>
              {tr(label)}
            </button>
          ))}
        </div>
        <div className="cal-nav">
          <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label={tr('Previous')}>
            <ChevronLeft size={17} />
          </button>
          <button type="button" className="cal-today" onClick={() => set(safeMode, todayISO())}>
            {tr('Today')}
          </button>
          <button type="button" className="icon-btn" onClick={() => step(1)} aria-label={tr('Next')}>
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
                    <ObjectEditor key={note.id} obj={note} placeholder={tr('Write…')} />
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
  const tr = useT();
  const tasks = useData((s) => s.tasks);
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
