import { addDays, formatDistanceToNow, isToday as isDateToday, isYesterday as isDateYesterday } from 'date-fns';
import {
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Circle,
  Columns3,
  Compass,
  Filter,
  Inbox,
  LayoutGrid,
  List,
  Plus,
  Search,
  Table,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TaskPriority, TaskRec, TaskStatus } from '../db/schema';
import { createTask, updateTask } from '../db/indexers';
import { displayTitle, useActiveObjects, useData, useObjMap, useTypeMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { shortDate, todayISO, toISODate } from '../lib/dates';
import { parseQuickTaskInput, PRIO_MAP, PRIO_RANK, resolveTaskStatus, STATUS_MAP, STATUS_RANK, TASK_PRIORITIES, TASK_STATUSES } from '../lib/tasks';
import { TaskRow } from '../components/TaskRow';
import { TaskCard } from '../components/TaskCard';
import { Modal } from '../components/Popover';

type DashTab = 'inbox' | 'today' | 'scheduled' | 'status' | 'context' | 'open' | 'completed' | 'all';
type LayoutMode = 'board' | 'list' | 'table';

function readTab(): DashTab {
  try {
    const v = localStorage.getItem('orbit-tasks-tab') as DashTab | null;
    if (v && ['inbox', 'today', 'scheduled', 'status', 'context', 'open', 'completed', 'all'].includes(v)) return v;
  } catch {
    /* ignore */
  }
  return 'status';
}

function dayBucket(ts: number): 'Today' | 'Yesterday' | 'Earlier' {
  const d = new Date(ts);
  if (isDateToday(d)) return 'Today';
  if (isDateYesterday(d)) return 'Yesterday';
  return 'Earlier';
}

export function TasksView() {
  const tasks = useData((s) => s.tasks);
  const types = useData((s) => s.types);
  const activeObjects = useActiveObjects();
  const objMap = useObjMap();
  const typeMap = useTypeMap();
  const open = useOpen();

  const [tab, setTabState] = useState<DashTab>(readTab);
  const [allLayout, setAllLayout] = useState<LayoutMode>('list');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterPrio, setFilterPrio] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  // Kanban drag-and-drop
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);

  // Inline column quick-add (Status Kanban)
  const [addingInCol, setAddingInCol] = useState<TaskStatus | null>(null);
  const [colDraft, setColDraft] = useState('');
  const [colContext, setColContext] = useState('__today');

  // Inline context quick-add (Context tab)
  const [addingInCtx, setAddingInCtx] = useState<string | null>(null);
  const [ctxDraft, setCtxDraft] = useState('');

  // Full New Task Modal
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStatus, setNewStatus] = useState<TaskStatus>('open');
  const [newDue, setNewDue] = useState('');
  const [newPrio, setNewPrio] = useState<TaskPriority | ''>('');
  const [newTarget, setNewTarget] = useState('__today');

  const setTab = (next: DashTab) => {
    setTabState(next);
    try {
      localStorage.setItem('orbit-tasks-tab', next);
    } catch {
      /* ignore */
    }
  };

  const targetChoices = useMemo(
    () =>
      activeObjects
        .filter((o) => o.typeId !== 'daily')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 50),
    [activeObjects],
  );

  // All valid, non-empty, non-trashed tasks
  const allTasks = useMemo(() => {
    return tasks
      .filter((t) => {
        const o = objMap.get(t.objectId);
        return o && !o.deletedAt && t.text.trim() !== '';
      })
      .map((t) => ({
        ...t,
        status: resolveTaskStatus(t.done, t.status),
      }));
  }, [tasks, objMap]);

  // Apply search & filter bar
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTasks.filter((t) => {
      const ctxObj = objMap.get(t.contextId || t.objectId) ?? objMap.get(t.objectId);
      if (filterPrio && (t.priority ?? 'none') !== filterPrio) return false;
      if (filterStatus && t.status !== filterStatus) return false;
      if (filterType && ctxObj?.typeId !== filterType) return false;
      if (q) {
        const titleHit = t.text.toLowerCase().includes(q);
        const ctxHit = ctxObj ? displayTitle(ctxObj).toLowerCase().includes(q) : false;
        if (!titleHit && !ctxHit) return false;
      }
      return true;
    });
  }, [allTasks, objMap, search, filterPrio, filterStatus, filterType]);

  const today = todayISO();
  const tomorrow = toISODate(addDays(new Date(), 1));
  const nextWeekEnd = toISODate(addDays(new Date(), 7));

  const byPrioThenDue = (a: TaskRec, b: TaskRec) =>
    (PRIO_RANK[a.priority ?? ''] ?? 3) - (PRIO_RANK[b.priority ?? ''] ?? 3) ||
    (STATUS_RANK[resolveTaskStatus(a.done, a.status)] ?? 3) - (STATUS_RANK[resolveTaskStatus(b.done, b.status)] ?? 3) ||
    (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
    b.updatedAt - a.updatedAt;

  // Per-tab computed counts (from unfiltered allTasks so badges stay stable)
  const counts = useMemo(() => {
    let inbox = 0;
    let todayC = 0;
    let scheduled = 0;
    let openC = 0;
    let completed = 0;
    for (const t of allTasks) {
      if (t.done) {
        completed++;
        continue;
      }
      openC++;
      if (!t.due && t.status === 'open') inbox++;
      if (t.due) scheduled++;
      if ((t.due && t.due <= today) || t.status === 'in_progress') todayC++;
    }
    return { inbox, today: todayC, scheduled, open: openC, completed, all: allTasks.length };
  }, [allTasks, today]);

  // Tab datasets (from filtered)
  const inboxGroups = useMemo(() => {
    const list = filtered.filter((t) => !t.done && !t.due && t.status === 'open').sort((a, b) => b.createdAt - a.createdAt);
    const map = new Map<string, TaskRec[]>();
    for (const t of list) {
      const k = dayBucket(t.createdAt);
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return (['Today', 'Yesterday', 'Earlier'] as const)
      .map((label) => ({ key: label, label, items: map.get(label) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  const todayGroups = useMemo(() => {
    const list = filtered.filter((t) => !t.done && ((t.due && t.due <= today) || t.status === 'in_progress'));
    const overdue = list.filter((t) => t.due && t.due < today).sort(byPrioThenDue);
    const rest = list.filter((t) => !(t.due && t.due < today));
    const statusOrder: TaskStatus[] = ['in_progress', 'next_up', 'not_started', 'open'];
    const out: { key: string; label: string; tone?: string; items: TaskRec[] }[] = [];
    if (overdue.length) out.push({ key: 'overdue', label: 'Overdue', tone: 'rose', items: overdue });
    for (const st of statusOrder) {
      const items = rest.filter((t) => t.status === st).sort(byPrioThenDue);
      if (items.length) {
        const def = STATUS_MAP.get(st)!;
        out.push({ key: st, label: def.label, tone: def.tone, items });
      }
    }
    return out;
  }, [filtered, today]);

  const scheduledGroups = useMemo(() => {
    const list = filtered.filter((t) => !t.done && !!t.due);
    const byDue = (a: TaskRec, b: TaskRec) => (a.due ?? '').localeCompare(b.due ?? '') || byPrioThenDue(a, b);
    return [
      { key: 'overdue', label: 'Overdue', tone: 'rose', items: list.filter((t) => t.due! < today).sort(byDue) },
      { key: 'today', label: 'Today', tone: 'amber', items: list.filter((t) => t.due === today).sort(byDue) },
      { key: 'tomorrow', label: 'Tomorrow', tone: 'blue', items: list.filter((t) => t.due === tomorrow).sort(byDue) },
      { key: 'week', label: 'Next 7 days', tone: 'neutral', items: list.filter((t) => t.due! > tomorrow && t.due! <= nextWeekEnd).sort(byDue) },
      { key: 'later', label: 'Later', tone: 'neutral', items: list.filter((t) => t.due! > nextWeekEnd).sort(byDue) },
    ].filter((g) => g.items.length > 0);
  }, [filtered, today, tomorrow, nextWeekEnd]);

  const statusColumns = useMemo(() => {
    return TASK_STATUSES.map((s) => ({
      ...s,
      items: filtered
        .filter((t) => t.status === s.id)
        .sort((a, b) =>
          s.id === 'done'
            ? (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)
            : byPrioThenDue(a, b),
        ),
    }));
  }, [filtered]);

  const contextGroups = useMemo(() => {
    const openOnly = filtered.filter((t) => !t.done);
    const map = new Map<string, TaskRec[]>();
    for (const t of openOnly) {
      const cid = t.contextId || t.objectId;
      map.set(cid, [...(map.get(cid) ?? []), t]);
    }
    return [...map.entries()]
      .map(([cid, items]) => {
        const obj = objMap.get(cid);
        const tp = obj ? typeMap.get(obj.typeId) : undefined;
        return {
          id: cid,
          obj,
          type: tp,
          title: obj ? displayTitle(obj) : 'Unknown',
          icon: obj?.icon || tp?.icon || '📄',
          color: tp?.color ?? '#8b8a86',
          items: items.sort(byPrioThenDue),
        };
      })
      .sort((a, b) => b.items.length - a.items.length || a.title.localeCompare(b.title));
  }, [filtered, objMap, typeMap]);

  const openList = useMemo(() => filtered.filter((t) => !t.done).sort(byPrioThenDue), [filtered]);

  const completedGroups = useMemo(() => {
    const list = filtered
      .filter((t) => t.done)
      .sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt));
    const map = new Map<string, TaskRec[]>();
    for (const t of list) {
      const k = dayBucket(t.completedAt ?? t.updatedAt);
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return (['Today', 'Yesterday', 'Earlier'] as const)
      .map((label) => ({ key: label, label, items: map.get(label) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  const visibleCount = useMemo(() => {
    switch (tab) {
      case 'inbox':
        return inboxGroups.reduce((n, g) => n + g.items.length, 0);
      case 'today':
        return todayGroups.reduce((n, g) => n + g.items.length, 0);
      case 'scheduled':
        return scheduledGroups.reduce((n, g) => n + g.items.length, 0);
      case 'status':
        return filtered.length;
      case 'context':
        return contextGroups.reduce((n, g) => n + g.items.length, 0);
      case 'open':
        return openList.length;
      case 'completed':
        return completedGroups.reduce((n, g) => n + g.items.length, 0);
      case 'all':
        return filtered.length;
    }
  }, [tab, inboxGroups, todayGroups, scheduledGroups, filtered, contextGroups, openList, completedGroups]);

  const handleDropOnColumn = async (targetStatus: TaskStatus, e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/orbit-task') || dragTaskId;
    setDragOverCol(null);
    setDragTaskId(null);
    if (!id) return;
    await updateTask(id, { status: targetStatus });
  };

  const submitColumnQuickAdd = async (status: TaskStatus) => {
    const parsed = parseQuickTaskInput(colDraft);
    if (!parsed.text) return;
    await createTask({
      text: parsed.text,
      targetObjectId: colContext,
      status,
      due: parsed.due,
      priority: parsed.priority,
    });
    setColDraft('');
    setAddingInCol(null);
  };

  const submitContextQuickAdd = async (objectId: string) => {
    const parsed = parseQuickTaskInput(ctxDraft);
    if (!parsed.text) return;
    await createTask({
      text: parsed.text,
      targetObjectId: objectId,
      status: 'open',
      due: parsed.due,
      priority: parsed.priority,
    });
    setCtxDraft('');
    setAddingInCtx(null);
  };

  const submitNewModal = async () => {
    const parsed = parseQuickTaskInput(newTitle);
    if (!parsed.text) return;
    await createTask({
      text: parsed.text,
      targetObjectId: newTarget,
      status: newStatus,
      due: parsed.due ?? (newDue || null),
      priority: parsed.priority ?? (newPrio || null),
    });
    setNewTitle('');
    setNewDue('');
    setNewPrio('');
    setNewStatus('open');
    setNewModalOpen(false);
  };

  const rescheduleOverdueToToday = async () => {
    const overdue = scheduledGroups.find((g) => g.key === 'overdue')?.items ?? [];
    for (const t of overdue) await updateTask(t.id, { due: today });
  };

  const openNewModalForTab = () => {
    setNewStatus(tab === 'today' ? 'in_progress' : 'open');
    setNewDue(tab === 'today' || tab === 'scheduled' ? today : '');
    setNewModalOpen(true);
  };

  const hasActiveFilter = !!(filterPrio || filterStatus || filterType || search.trim());

  const TABS: { id: DashTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'inbox', label: 'Inbox', icon: <Inbox size={14} />, badge: counts.inbox },
    { id: 'today', label: 'Today', icon: <CalendarCheck size={14} />, badge: counts.today },
    { id: 'scheduled', label: 'Scheduled', icon: <CalendarClock size={14} />, badge: counts.scheduled },
    { id: 'status', label: 'Status', icon: <Columns3 size={14} /> },
    { id: 'context', label: 'Context', icon: <Compass size={14} /> },
    { id: 'open', label: 'Open', icon: <Circle size={14} />, badge: counts.open },
    { id: 'completed', label: 'Completed', icon: <CheckCircle2 size={14} />, badge: counts.completed },
    { id: 'all', label: 'All', icon: <List size={14} /> },
  ];

  const renderKanban = () => (
    <div className="kanban-board">
      {statusColumns.map((col) => {
        const isOver = dragOverCol === col.id;
        return (
          <div
            key={col.id}
            className={`kanban-col${isOver ? ' is-drop-target' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOverCol !== col.id) setDragOverCol(col.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                if (dragOverCol === col.id) setDragOverCol(null);
              }
            }}
            onDrop={(e) => void handleDropOnColumn(col.id, e)}
          >
            <div className="kanban-col-head">
              <span className={`status-pill tone-${col.tone}`}>{col.label}</span>
              <span className="kanban-col-count">{col.items.length}</span>
            </div>

            <div className="kanban-cards">
              {col.items.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  onDragStart={(id) => setDragTaskId(id)}
                  onDragEnd={() => {
                    setDragTaskId(null);
                    setDragOverCol(null);
                  }}
                />
              ))}
            </div>

            {addingInCol === col.id ? (
              <form
                className="kanban-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitColumnQuickAdd(col.id);
                }}
              >
                <input
                  autoFocus
                  placeholder="Task title… (@today, !p1)"
                  value={colDraft}
                  onChange={(e) => setColDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setAddingInCol(null)}
                />
                <div className="kanban-composer-foot">
                  <select value={colContext} onChange={(e) => setColContext(e.target.value)} title="Context object">
                    <option value="__today">📅 Today’s Note</option>
                    {targetChoices.map((o) => {
                      const tp = typeMap.get(o.typeId);
                      return (
                        <option key={o.id} value={o.id}>
                          {o.icon || tp?.icon || '📄'} {displayTitle(o)}
                        </option>
                      );
                    })}
                  </select>
                  <button type="submit" className="btn small primary" disabled={!colDraft.trim()}>
                    Add
                  </button>
                  <button type="button" className="icon-btn tiny" onClick={() => setAddingInCol(null)}>
                    <X size={13} />
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="kanban-new-btn"
                onClick={() => {
                  setColDraft('');
                  setAddingInCol(col.id);
                }}
              >
                <Plus size={14} /> New
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderTable = (items: TaskRec[]) => (
    <div className="table-wrap">
      <table className="obj-table">
        <thead>
          <tr>
            <th style={{ width: 36 }} />
            <th>Task</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Scheduled</th>
            <th>Context</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => {
            const st = STATUS_MAP.get(resolveTaskStatus(t.done, t.status))!;
            const pr = t.priority ? PRIO_MAP.get(t.priority) : null;
            const ctxObj = objMap.get(t.contextId || t.objectId);
            const ctxType = ctxObj ? typeMap.get(ctxObj.typeId) : undefined;
            return (
              <tr key={t.id}>
                <td>
                  <label className="task-check">
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={(e) => void updateTask(t.id, { checked: e.target.checked })}
                    />
                    <span className="task-box round" />
                  </label>
                </td>
                <td className={`t-title${t.done ? ' task-done-txt' : ''}`}>{t.text}</td>
                <td>
                  <span className={`status-pill tone-${st.tone} compact`}>{st.label}</span>
                </td>
                <td>{pr ? <span className={`prio-chip prio-${pr.id}`}>{pr.bang} {pr.label}</span> : <span className="muted">—</span>}</td>
                <td className="nowrap">{t.due ? shortDate(t.due) : <span className="muted">—</span>}</td>
                <td>
                  {ctxObj && (
                    <button
                      type="button"
                      className="tcard-ctx"
                      style={{ ['--type-color' as any]: ctxType?.color ?? '#8b8a86' }}
                      onClick={(e) => open(objPath(ctxObj.id), e)}
                    >
                      <span>{ctxObj.icon || ctxType?.icon}</span> {displayTitle(ctxObj)}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className={`page${tab === 'status' || (tab === 'all' && allLayout === 'board') ? ' tasks-full' : ' wide'}`}>
      <header className="tasks-head">
        <div className="tasks-head-left">
          <span className="tasks-brand-icon">
            <CheckCircle2 size={20} />
          </span>
          <h1>Tasks</h1>
        </div>
        <div className="tasks-head-right">
          {searchOpen ? (
            <label className="control tasks-search-box">
              <Search size={14} />
              <input
                autoFocus
                placeholder="Search tasks or context…"
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
            <button type="button" className="icon-btn" title="Search tasks" onClick={() => setSearchOpen(true)}>
              <Search size={16} />
            </button>
          )}
          <button
            type="button"
            className={`icon-btn${filtersOpen || hasActiveFilter ? ' is-accent' : ''}`}
            title="Filter tasks"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <Filter size={16} />
          </button>
          <button type="button" className="btn primary tasks-new-cta" onClick={openNewModalForTab}>
            <Plus size={15} /> New
          </button>
        </div>
      </header>

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
        <div className="tasks-tabs-meta">
          <span className="muted small nowrap"># {visibleCount}</span>
          {tab === 'all' && (
            <div className="segmented small">
              <button type="button" className={allLayout === 'list' ? 'active' : ''} onClick={() => setAllLayout('list')} title="List">
                <List size={14} />
              </button>
              <button type="button" className={allLayout === 'board' ? 'active' : ''} onClick={() => setAllLayout('board')} title="Kanban Board">
                <LayoutGrid size={14} />
              </button>
              <button type="button" className={allLayout === 'table' ? 'active' : ''} onClick={() => setAllLayout('table')} title="Table">
                <Table size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {filtersOpen && (
        <div className="tasks-filter-bar">
          <select className="control-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {TASK_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select className="control-select" value={filterPrio} onChange={(e) => setFilterPrio(e.target.value)}>
            <option value="">All priorities</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.bang} {p.label}
              </option>
            ))}
            <option value="none">No priority</option>
          </select>
          <select className="control-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">All context types</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon} {t.name}
              </option>
            ))}
          </select>
          {hasActiveFilter && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setFilterPrio('');
                setFilterStatus('');
                setFilterType('');
                setSearch('');
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* ---------- TAB: STATUS (KANBAN BOARD) ---------- */}
      {tab === 'status' && renderKanban()}

      {/* ---------- TAB: INBOX ---------- */}
      {tab === 'inbox' && (
        <div className="tasks-section-wrap">
          <p className="muted small tasks-tab-hint">
            Undated tasks without a status yet. Assign a date or move them to a status (Not Started / Next Up / In Progress) to process your inbox.
          </p>
          {inboxGroups.length === 0 ? (
            <div className="empty-inline center">
              <strong>Inbox zero!</strong>
              <span>Every task has been scheduled or assigned a status.</span>
            </div>
          ) : (
            inboxGroups.map((g) => (
              <section key={g.key} className="task-group">
                <h3>
                  {g.label} <span className="count">{g.items.length}</span>
                </h3>
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </section>
            ))
          )}
        </div>
      )}

      {/* ---------- TAB: TODAY ---------- */}
      {tab === 'today' && (
        <div className="tasks-section-wrap">
          <p className="muted small tasks-tab-hint">
            Tasks due today, overdue tasks, and anything currently In Progress — grouped by status and ordered by priority.
          </p>
          {todayGroups.length === 0 ? (
            <div className="empty-inline center">
              <strong>All clear for today.</strong>
              <span>Schedule a task for today or drag one into “In Progress” on the Status board.</span>
            </div>
          ) : (
            todayGroups.map((g) => (
              <section key={g.key} className="task-group">
                <h3>
                  <span className={`status-pill tone-${g.tone ?? 'neutral'}`}>{g.label}</span>
                  <span className="count">{g.items.length}</span>
                </h3>
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </section>
            ))
          )}
        </div>
      )}

      {/* ---------- TAB: SCHEDULED ---------- */}
      {tab === 'scheduled' && (
        <div className="tasks-section-wrap">
          {scheduledGroups.length === 0 ? (
            <div className="empty-inline center">
              <strong>No scheduled tasks yet.</strong>
              <span>Add a date to any task (or type @tomorrow inside a note) to see it here.</span>
            </div>
          ) : (
            scheduledGroups.map((g) => (
              <section key={g.key} className={`task-group task-group-${g.key}`}>
                <div className="task-group-head">
                  <h3>
                    <span className={`status-pill tone-${g.tone}`}>{g.label}</span>
                    <span className="count">{g.items.length}</span>
                  </h3>
                  {g.key === 'overdue' && (
                    <button type="button" className="btn small" onClick={() => void rescheduleOverdueToToday()}>
                      Reschedule all to Today
                    </button>
                  )}
                </div>
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </section>
            ))
          )}
        </div>
      )}

      {/* ---------- TAB: CONTEXT ---------- */}
      {tab === 'context' && (
        <div className="tasks-section-wrap">
          <p className="muted small tasks-tab-hint">
            Open tasks grouped by the Project, Book, Person, Meeting, or Note they belong to.
          </p>
          {contextGroups.length === 0 ? (
            <div className="empty-inline center">
              <strong>No open tasks in any context yet.</strong>
              <span>Create tasks inside your notes or link a task’s context object.</span>
            </div>
          ) : (
            <div className="context-groups">
              {contextGroups.map((g) => (
                <section key={g.id} className="context-group" style={{ ['--type-color' as any]: g.color }}>
                  <div className="context-group-head">
                    <button
                      type="button"
                      className="context-group-title"
                      onClick={(e) => g.obj && open(objPath(g.obj.id), e)}
                    >
                      <span className="context-group-icon">{g.icon}</span>
                      <span>{g.title}</span>
                      {g.type && <span className="context-group-type">{g.type.name}</span>}
                    </button>
                    <span className="count">{g.items.length}</span>
                    <div className="spacer" />
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        setCtxDraft('');
                        setAddingInCtx(addingInCtx === g.id ? null : g.id);
                      }}
                    >
                      <Plus size={13} /> Add task
                    </button>
                  </div>
                  {addingInCtx === g.id && (
                    <form
                      className="context-quick-add"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submitContextQuickAdd(g.id);
                      }}
                    >
                      <input
                        autoFocus
                        placeholder={`New task in ${g.title}… (@today, !p1)`}
                        value={ctxDraft}
                        onChange={(e) => setCtxDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Escape' && setAddingInCtx(null)}
                      />
                      <button type="submit" className="btn small primary" disabled={!ctxDraft.trim()}>
                        Add
                      </button>
                    </form>
                  )}
                  <div className="context-group-items">
                    {g.items.map((t) => (
                      <TaskRow key={t.id} task={t} showSource={false} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- TAB: OPEN ---------- */}
      {tab === 'open' && (
        <div className="tasks-section-wrap">
          {openList.length === 0 ? (
            <div className="empty-inline center">
              <strong>No open tasks.</strong>
              <span>Click “New” above to capture a task.</span>
            </div>
          ) : (
            <div className="task-group">
              {openList.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- TAB: COMPLETED ---------- */}
      {tab === 'completed' && (
        <div className="tasks-section-wrap">
          {completedGroups.length === 0 ? (
            <div className="empty-inline center">
              <strong>No completed tasks yet.</strong>
              <span>Check off a task or drag it into Done on the Status board.</span>
            </div>
          ) : (
            completedGroups.map((g) => (
              <section key={g.key} className="task-group">
                <h3>
                  {g.label} <span className="count">{g.items.length}</span>
                </h3>
                {g.items.map((t) => (
                  <div key={t.id} className="completed-row-wrap">
                    <TaskRow task={t} />
                    {t.completedAt && (
                      <span className="completed-time muted small">
                        Done {formatDistanceToNow(t.completedAt, { addSuffix: true })}
                      </span>
                    )}
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      )}

      {/* ---------- TAB: ALL ---------- */}
      {tab === 'all' && (
        allLayout === 'board' ? (
          renderKanban()
        ) : allLayout === 'table' ? (
          renderTable(filtered.sort(byPrioThenDue))
        ) : (
          <div className="tasks-section-wrap">
            {filtered.length === 0 ? (
              <div className="empty-inline center">
                <strong>No matching tasks.</strong>
                <span>Clear your filters or create a new task.</span>
              </div>
            ) : (
              <div className="task-group">
                {filtered.sort(byPrioThenDue).map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            )}
          </div>
        )
      )}

      {/* ---------- NEW TASK MODAL ---------- */}
      {newModalOpen && (
        <Modal onClose={() => setNewModalOpen(false)} className="new-task-modal">
          <div className="modal-head">
            <h2>New Task</h2>
            <button type="button" className="icon-btn" onClick={() => setNewModalOpen(false)}>
              <X size={18} />
            </button>
          </div>
          <form
            className="modal-body new-task-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitNewModal();
            }}
          >
            <input
              className="ntm-title"
              autoFocus
              placeholder="What needs to be done? (supports @tomorrow, !p1)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <div className="ntm-grid">
              <label>
                <span>Status</span>
                <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as TaskStatus)}>
                  {TASK_STATUSES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Priority</span>
                <select value={newPrio} onChange={(e) => setNewPrio(e.target.value as TaskPriority | '')}>
                  <option value="">None</option>
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.bang} {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Scheduled date</span>
                <input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} />
              </label>
              <label>
                <span>Context / Note</span>
                <select value={newTarget} onChange={(e) => setNewTarget(e.target.value)}>
                  <option value="__today">📅 Today’s Daily Note</option>
                  {targetChoices.map((o) => {
                    const tp = typeMap.get(o.typeId);
                    return (
                      <option key={o.id} value={o.id}>
                        {o.icon || tp?.icon || '📄'} {displayTitle(o)}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>
            <div className="modal-foot">
              <div className="spacer" />
              <button type="button" className="btn" onClick={() => setNewModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={!newTitle.trim()}>
                Create Task
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
