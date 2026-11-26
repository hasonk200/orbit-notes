import { addDays, isToday as isDateToday, isYesterday as isDateYesterday } from 'date-fns';
import {
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleCheck,
  History,
  Inbox,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { TaskPriority, TaskRec } from '../db/schema';
import { createTask, rescheduleTasks, updateTask } from '../db/indexers';
import { displayTitle, useActiveObjects, useObjMap, useSpaceTasks, useTypeMap } from '../store/dataStore';
import { useT } from '../store/uiStore';
import { relativeTime, todayISO, toISODate } from '../lib/dates';
import { includesText } from '../lib/search';
import { typeLabel } from '../lib/typeLabels';
import { classifyTaskKind, parseQuickTaskInput, PRIO_RANK, priorityChoices } from '../lib/tasks';
import { TaskRow } from '../components/TaskRow';
import { Popover } from '../components/Popover';
import { MenuSelect } from '../components/MenuSelect';
import { TaskTabs } from '../mobile/TaskTabs';

type TodoTab = 'today' | 'upcoming' | 'anytime' | 'logbook';

function readTodoTab(): TodoTab {
  try {
    const v = localStorage.getItem('orbit-todos-tab') as TodoTab | null;
    if (v && ['today', 'upcoming', 'anytime', 'logbook'].includes(v)) return v;
  } catch {
    /* ignore */
  }
  return 'today';
}

function dayBucket(ts: number): 'Today' | 'Yesterday' | 'Earlier' {
  const d = new Date(ts);
  if (isDateToday(d)) return 'Today';
  if (isDateYesterday(d)) return 'Yesterday';
  return 'Earlier';
}

function PromoteButton({ task }: { task: TaskRec }) {
  const tr = useT();
  const activeObjects = useActiveObjects();
  const typeMap = useTypeMap();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);

  const candidates = useMemo(() => {
    const nonDaily = activeObjects.filter((o) => o.typeId !== 'daily');
    const filtered = q.trim() ? nonDaily.filter((o) => includesText(displayTitle(o, tr), q)) : nonDaily;
    // Show Projects first, then recently edited objects
    return [...filtered]
      .sort((a, b) => {
        const ap = a.typeId === 'project' ? 0 : 1;
        const bp = b.typeId === 'project' ? 0 : 1;
        return ap - bp || b.updatedAt - a.updatedAt;
      })
      .slice(0, 12);
  }, [activeObjects, q, tr]);

  const promote = async (contextId: string | null) => {
    setOpen(false);
    setQ('');
    await updateTask(task.id, {
      kind: 'task',
      contextId,
      status: task.done ? 'done' : 'not_started',
    });
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="icon-btn tiny todo-promote-btn"
        title={tr('Promote to Task')}
        onClick={() => setOpen((v) => !v)}
      >
        <ArrowUpRight size={14} />
      </button>
      {open && (
        <Popover anchor={btnRef.current} onClose={() => setOpen(false)} className="promote-pop">
          <div className="tp-section">{tr('Promote to which project?')}</div>
          <input
            autoFocus
            className="promote-search"
            placeholder={tr('Search projects or notes…')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="promote-list">
            <button type="button" className="promote-opt muted-opt" onClick={() => void promote(null)}>
              <Inbox size={13} /> {tr('No project (Tasks Inbox)')}
            </button>
            {candidates.map((o) => {
              const tp = typeMap.get(o.typeId);
              return (
                <button key={o.id} type="button" className="promote-opt" onClick={() => void promote(o.id)}>
                  <span>{o.icon || tp?.icon || '📄'}</span>
                  <span className="promote-opt-title">{displayTitle(o, tr)}</span>
                  {tp && <span className="promote-opt-type">{typeLabel(tp, tr)}</span>}
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </>
  );
}

export function TodosView() {
  const tr = useT();
  const tasks = useSpaceTasks();
  const objMap = useObjMap();

  const [tab, setTabState] = useState<TodoTab>(readTodoTab);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Zero-friction top quick-add bar
  const [draft, setDraft] = useState('');
  const [quickDue, setQuickDue] = useState('');
  const [quickPrio, setQuickPrio] = useState<TaskPriority | ''>('');

  const setTab = (next: TodoTab) => {
    setTabState(next);
    try {
      localStorage.setItem('orbit-todos-tab', next);
    } catch {
      /* ignore */
    }
  };

  const today = todayISO();
  const tomorrow = toISODate(addDays(new Date(), 1));
  const nextWeekEnd = toISODate(addDays(new Date(), 7));

  const allTodos = useMemo(() => {
    return tasks
      .filter((t) => {
        const o = objMap.get(t.objectId);
        if (!o || o.deletedAt || t.text.trim() === '') return false;
        const effectiveKind =
          t.kind ??
          classifyTaskKind({
            explicitKind: t.explicitKind,
            status: t.status,
            contextId: t.contextId,
            sourceTypeId: o.typeId,
          });
        return effectiveKind === 'todo';
      })
      .map((t) => ({ ...t, kind: 'todo' as const }));
  }, [tasks, objMap]);

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return allTodos;
    return allTodos.filter((t) => {
      const o = objMap.get(t.objectId);
      return includesText(t.text, q) || (o ? includesText(displayTitle(o, tr), q) : false);
    });
  }, [allTodos, objMap, search, tr]);

  const byDueAndPrio = (a: TaskRec, b: TaskRec) =>
    (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
    (PRIO_RANK[a.priority ?? ''] ?? 3) - (PRIO_RANK[b.priority ?? ''] ?? 3) ||
    b.createdAt - a.createdAt;

  const counts = useMemo(() => {
    let todayC = 0;
    let upcoming = 0;
    let anytime = 0;
    let logbook = 0;
    for (const t of allTodos) {
      if (t.done) {
        logbook++;
        continue;
      }
      if (t.due && t.due <= today) todayC++;
      else if (t.due && t.due > today) upcoming++;
      else anytime++;
    }
    return { today: todayC, upcoming, anytime, logbook };
  }, [allTodos, today]);

  const overdueItems = useMemo(
    () => filtered.filter((t) => !t.done && t.due && t.due < today).sort(byDueAndPrio),
    [filtered, today],
  );
  const dueTodayItems = useMemo(
    () => filtered.filter((t) => !t.done && t.due === today).sort(byDueAndPrio),
    [filtered, today],
  );

  const upcomingGroups = useMemo(() => {
    const list = filtered.filter((t) => !t.done && t.due && t.due > today).sort(byDueAndPrio);
    return [
      { key: 'tomorrow', label: tr('Tomorrow'), tone: 'blue', items: list.filter((t) => t.due === tomorrow) },
      { key: 'week', label: tr('Next 7 days'), tone: 'neutral', items: list.filter((t) => t.due! > tomorrow && t.due! <= nextWeekEnd) },
      { key: 'later', label: tr('Later'), tone: 'neutral', items: list.filter((t) => t.due! > nextWeekEnd) },
    ].filter((g) => g.items.length > 0);
  }, [filtered, today, tomorrow, nextWeekEnd, tr]);

  const anytimeItems = useMemo(
    () => filtered.filter((t) => !t.done && !t.due).sort(byDueAndPrio),
    [filtered],
  );

  const logbookGroups = useMemo(() => {
    const list = filtered
      .filter((t) => t.done)
      .sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt));
    const map = new Map<string, TaskRec[]>();
    for (const t of list) {
      const k = dayBucket(t.completedAt ?? t.updatedAt);
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return (['Today', 'Yesterday', 'Earlier'] as const)
      .map((label) => ({ key: label, label: tr(label), items: map.get(label) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [filtered, tr]);

  const submitQuickAdd = async () => {
    const parsed = parseQuickTaskInput(draft);
    if (!parsed.text) return;
    const defaultDue = parsed.due ?? (quickDue || (tab === 'today' ? today : null));
    await createTask({
      text: parsed.text,
      targetObjectId: '__today',
      kind: 'todo',
      status: 'open',
      due: defaultDue,
      priority: parsed.priority ?? (quickPrio || null),
    });
    setDraft('');
    setQuickDue('');
    setQuickPrio('');
  };

  const TABS: { id: TodoTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'today', label: tr('Today'), icon: <CalendarDays size={14} />, badge: counts.today },
    { id: 'upcoming', label: tr('Upcoming'), icon: <CalendarClock size={14} />, badge: counts.upcoming },
    { id: 'anytime', label: tr('Anytime'), icon: <Sparkles size={14} />, badge: counts.anytime },
    { id: 'logbook', label: tr('Logbook'), icon: <History size={14} />, badge: counts.logbook },
  ];

  const renderRow = (t: TaskRec) => (
    <TaskRow
      key={t.id}
      task={t}
      showStatus={false}
      showSource={false}
      extraActions={<PromoteButton task={t} />}
    />
  );

  return (
    <div className="page todos-page">
      <TaskTabs current="todos" />
      <header className="tasks-head">
        <div className="tasks-head-left">
          <span className="todos-brand-icon">
            <CircleCheck size={20} />
          </span>
          <div>
            <h1>{tr('To-do')}</h1>
            <p className="muted small todos-sub">{tr('Quick one-off errands, bills, and reminders. Promote any item to a Project Task anytime.')}</p>
          </div>
        </div>
        <div className="tasks-head-right">
          {searchOpen ? (
            <label className="control tasks-search-box">
              <Search size={14} />
              <input
                autoFocus
                placeholder={tr('Filter to-dos…')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearch('');
                    setSearchOpen(false);
                  }
                }}
              />
              <button
                type="button"
                className="icon-btn tiny"
                onClick={() => {
                  setSearch('');
                  setSearchOpen(false);
                }}
              >
                <X size={13} />
              </button>
            </label>
          ) : (
            <button type="button" className="icon-btn" title={tr('Search')} onClick={() => setSearchOpen(true)}>
              <Search size={16} />
            </button>
          )}
        </div>
      </header>

      <form
        className="todo-quick-box"
        onSubmit={(e) => {
          e.preventDefault();
          void submitQuickAdd();
        }}
      >
        <div className="todo-quick-main">
          <Plus size={16} className="muted" />
          <input
            placeholder={tr('Add a to-do… (@tomorrow, !p1)')}
            title={
              tab === 'today'
                ? tr('Add a quick to-do for today… (supports @tomorrow, @2026-12-14, !p1)')
                : tr('Add a quick to-do… (supports @today, @tomorrow, @2026-12-14, !p1)')
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn small primary" disabled={!draft.trim()}>
            {tr('Add')}
          </button>
        </div>
        <div className="todo-quick-controls">
          <button
            type="button"
            className={`chip plain${quickDue === today ? ' is-picked' : ''}`}
            onClick={() => setQuickDue(quickDue === today ? '' : today)}
          >
            {tr('Today')}
          </button>
          <button
            type="button"
            className={`chip plain${quickDue === tomorrow ? ' is-picked' : ''}`}
            onClick={() => setQuickDue(quickDue === tomorrow ? '' : tomorrow)}
          >
            {tr('Tomorrow')}
          </button>
          <input type="date" className="todo-quick-date" value={quickDue} onChange={(e) => setQuickDue(e.target.value)} title={tr('Due date')} />
          <MenuSelect<TaskPriority | ''>
            look="field"
            className="todo-quick-prio"
            label={tr('Priority')}
            value={quickPrio}
            onChange={setQuickPrio}
            options={[{ value: '', label: tr('No priority') }, ...priorityChoices(tr)]}
          />
        </div>
      </form>

      <div className="tasks-tabs-bar">
        <div className="tasks-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tasks-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
              {t.badge != null && t.badge > 0 && <span className="tasks-tab-badge">{t.badge}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ---------- TODAY ---------- */}
      {tab === 'today' && (
        <div className="tasks-section-wrap">
          {overdueItems.length > 0 && (
            <section className="task-group task-group-overdue">
              <div className="task-group-head">
                <h3>
                  <span className="status-pill tone-rose">{tr('Overdue')}</span>
                  <span className="count">{overdueItems.length}</span>
                </h3>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => void rescheduleTasks(overdueItems.map((t) => t.id), today)}
                >
                  {tr('Reschedule all to Today')}
                </button>
              </div>
              {overdueItems.map(renderRow)}
            </section>
          )}
          <section className="task-group">
            <h3>
              {tr('Today')} <span className="count">{dueTodayItems.length}</span>
            </h3>
            {dueTodayItems.length === 0 && overdueItems.length === 0 ? (
              <div className="empty-inline center">
                <strong>{tr('Nothing left for today.')}</strong>
                <span>{tr('Type above to jot down a quick reminder or bill.')}</span>
              </div>
            ) : (
              dueTodayItems.map(renderRow)
            )}
          </section>
        </div>
      )}

      {/* ---------- UPCOMING ---------- */}
      {tab === 'upcoming' && (
        <div className="tasks-section-wrap">
          {upcomingGroups.length === 0 ? (
            <div className="empty-inline center">
              <strong>{tr('No upcoming to-dos.')}</strong>
              <span>{tr('Add a future date like @tomorrow or @2026-12-14 to schedule reminders ahead.')}</span>
            </div>
          ) : (
            upcomingGroups.map((g) => (
              <section key={g.key} className="task-group">
                <h3>
                  <span className={`status-pill tone-${g.tone}`}>{g.label}</span>
                  <span className="count">{g.items.length}</span>
                </h3>
                {g.items.map(renderRow)}
              </section>
            ))
          )}
        </div>
      )}

      {/* ---------- ANYTIME ---------- */}
      {tab === 'anytime' && (
        <div className="tasks-section-wrap">
          {anytimeItems.length === 0 ? (
            <div className="empty-inline center">
              <strong>{tr('No undated to-dos.')}</strong>
              <span>{tr('One-off items without a date show up here.')}</span>
            </div>
          ) : (
            <section className="task-group">{anytimeItems.map(renderRow)}</section>
          )}
        </div>
      )}

      {/* ---------- LOGBOOK ---------- */}
      {tab === 'logbook' && (
        <div className="tasks-section-wrap">
          {logbookGroups.length === 0 ? (
            <div className="empty-inline center">
              <strong>{tr('Logbook is empty.')}</strong>
              <span>{tr('Checked-off to-dos appear here.')}</span>
            </div>
          ) : (
            logbookGroups.map((g) => (
              <section key={g.key} className="task-group">
                <h3>
                  <CheckCircle2 size={14} className="muted" /> {g.label} <span className="count">{g.items.length}</span>
                </h3>
                {g.items.map((t) => (
                  <div key={t.id} className="completed-row-wrap">
                    {renderRow(t)}
                    {t.completedAt && (
                      <span className="completed-time muted small">
                        {tr('Done')} {relativeTime(t.completedAt, tr)}
                      </span>
                    )}
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}
