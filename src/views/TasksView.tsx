import { useMemo, useState } from 'react';
import { Layers, Plus, Search } from 'lucide-react';
import type { TaskPriority, TaskRec } from '../db/schema';
import { getOrCreateDaily, saveObject } from '../db/indexers';
import { db, uid } from '../db/schema';
import { displayTitle, useActiveObjects, useData, useObjMap, useTypeMap } from '../store/dataStore';
import { parseQuickDate, todayISO } from '../lib/dates';
import { TaskRow } from '../components/TaskRow';

type GroupMode = 'date' | 'priority' | 'source';

const PRIO_RANK: Record<string, number> = { high: 0, medium: 1, low: 2, '': 3 };

/** Append a task to today's daily note or a specific target object. */
async function addTaskToObject(targetId: string, text: string, due: string | null, priority: TaskPriority | null) {
  const note = targetId === '__today' ? await getOrCreateDaily(todayISO()) : await db.objects.get(targetId);
  if (!note) return;
  const fresh = await db.objects.get(note.id);
  const content = JSON.parse(JSON.stringify(fresh!.content));
  content.content = content.content ?? [];
  const item = {
    type: 'taskItem',
    attrs: { checked: false, taskId: uid(), due, priority },
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  };
  const last = content.content[content.content.length - 1];
  if (last?.type === 'taskList') last.content.push(item);
  else {
    if (last?.type === 'paragraph' && !last.content?.length) content.content.pop();
    content.content.push({ type: 'taskList', content: [item] });
  }
  await saveObject(note.id, { content });
}

function parseQuickPriority(raw: string): { text: string; priority: TaskPriority | null } {
  const m = raw.match(/(?:^|\s)!(high|p1|med|medium|p2|low|p3)(?=\s|$)/i);
  if (!m) return { text: raw, priority: null };
  const token = m[1].toLowerCase();
  const priority: TaskPriority = token === 'high' || token === 'p1' ? 'high' : token === 'low' || token === 'p3' ? 'low' : 'medium';
  const text = (raw.slice(0, m.index) + ' ' + raw.slice((m.index ?? 0) + m[0].length)).replace(/\s+/g, ' ').trim();
  return { text, priority };
}

export function TasksView() {
  const tasks = useData((s) => s.tasks);
  const types = useData((s) => s.types);
  const activeObjects = useActiveObjects();
  const objMap = useObjMap();
  const typeMap = useTypeMap();

  const [showDone, setShowDone] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupMode>('date');
  const [filterType, setFilterType] = useState('');
  const [filterPrio, setFilterPrio] = useState('');
  const [search, setSearch] = useState('');

  // Quick-add state
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [prio, setPrio] = useState<TaskPriority | ''>('');
  const [targetObj, setTargetObj] = useState('__today');

  const targetChoices = useMemo(
    () =>
      activeObjects
        .filter((o) => o.typeId !== 'daily')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 30),
    [activeObjects],
  );

  const { groups, openTotal, doneItems } = useMemo(() => {
    const today = todayISO();
    const q = search.trim().toLowerCase();
    const active = tasks.filter((t) => {
      const o = objMap.get(t.objectId);
      if (!o || o.deletedAt || !t.text.trim()) return false;
      if (filterType && o.typeId !== filterType) return false;
      if (filterPrio && (t.priority ?? 'none') !== filterPrio) return false;
      if (q && !t.text.toLowerCase().includes(q) && !displayTitle(o).toLowerCase().includes(q)) return false;
      return true;
    });

    const byDueAndPrio = (a: TaskRec, b: TaskRec) =>
      (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
      (PRIO_RANK[a.priority ?? ''] ?? 3) - (PRIO_RANK[b.priority ?? ''] ?? 3) ||
      a.createdAt - b.createdAt;

    const open = active.filter((t) => !t.done);
    const done = active.filter((t) => t.done).sort((a, b) => b.updatedAt - a.updatedAt);

    let built: { key: string; label: string; items: TaskRec[]; alwaysShow?: boolean }[] = [];

    if (groupBy === 'date') {
      built = [
        { key: 'overdue', label: 'Overdue', items: open.filter((t) => t.due && t.due < today).sort(byDueAndPrio) },
        { key: 'today', label: 'Today', items: open.filter((t) => t.due === today).sort(byDueAndPrio), alwaysShow: true },
        { key: 'upcoming', label: 'Upcoming', items: open.filter((t) => t.due && t.due > today).sort(byDueAndPrio) },
        { key: 'nodate', label: 'No date', items: open.filter((t) => !t.due).sort(byDueAndPrio) },
      ];
    } else if (groupBy === 'priority') {
      built = [
        { key: 'high', label: 'P1 · High priority', items: open.filter((t) => t.priority === 'high').sort(byDueAndPrio) },
        { key: 'medium', label: 'P2 · Medium priority', items: open.filter((t) => t.priority === 'medium').sort(byDueAndPrio) },
        { key: 'low', label: 'P3 · Low priority', items: open.filter((t) => t.priority === 'low').sort(byDueAndPrio) },
        { key: 'none', label: 'No priority', items: open.filter((t) => !t.priority).sort(byDueAndPrio) },
      ];
    } else {
      const map = new Map<string, TaskRec[]>();
      for (const t of open) {
        const list = map.get(t.objectId) ?? [];
        list.push(t);
        map.set(t.objectId, list);
      }
      built = [...map.entries()]
        .map(([oid, list]) => {
          const o = objMap.get(oid);
          const tp = o ? typeMap.get(o.typeId) : undefined;
          return {
            key: `src-${oid}`,
            label: `${o?.icon || tp?.icon || '📄'} ${displayTitle(o)}`,
            items: list.sort(byDueAndPrio),
          };
        })
        .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
    }

    return { groups: built, openTotal: open.length, doneItems: done };
  }, [tasks, objMap, typeMap, filterType, filterPrio, search, groupBy]);

  const submit = async () => {
    const raw = text.trim();
    if (!raw) return;
    const { text: withoutPrio, priority: quickPrio } = parseQuickPriority(raw);
    const m = withoutPrio.match(/\s@(\S+)$/);
    const quickDate = m ? parseQuickDate(m[1]) : null;
    const cleanText = quickDate ? withoutPrio.slice(0, m!.index).trim() : withoutPrio;
    await addTaskToObject(targetObj, cleanText, quickDate ?? (due || null), quickPrio ?? (prio || null));
    setText('');
    setDue('');
    setPrio('');
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Tasks</h1>
        <p className="muted">{openTotal} open · tasks live inside your notes; checking, rescheduling or setting priority syncs right back.</p>
      </header>

      <div className="quick-add-box">
        <div className="quick-add">
          <Plus size={16} />
          <input
            placeholder="Add a task… (supports @tomorrow, @2026-12-01, !p1 / !p2 / !p3)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button type="button" className="btn primary" onClick={submit}>
            Add
          </button>
        </div>
        <div className="quick-add-meta">
          <select value={targetObj} onChange={(e) => setTargetObj(e.target.value)} title="Save task inside…">
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
          <select value={prio} onChange={(e) => setPrio(e.target.value as TaskPriority | '')} title="Priority">
            <option value="">No priority</option>
            <option value="high">P1 · High</option>
            <option value="medium">P2 · Medium</option>
            <option value="low">P3 · Low</option>
          </select>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} title="Due date" />
        </div>
      </div>

      <div className="tasks-toolbar">
        <div className="segmented small">
          <button type="button" className={groupBy === 'date' ? 'active' : ''} onClick={() => setGroupBy('date')}>
            By Date
          </button>
          <button type="button" className={groupBy === 'priority' ? 'active' : ''} onClick={() => setGroupBy('priority')}>
            By Priority
          </button>
          <button type="button" className={groupBy === 'source' ? 'active' : ''} onClick={() => setGroupBy('source')}>
            <Layers size={13} /> By Note
          </button>
        </div>
        <div className="tasks-filters">
          <label className="control">
            <Search size={13} />
            <input placeholder="Filter tasks…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select className="control-select" value={filterPrio} onChange={(e) => setFilterPrio(e.target.value)}>
            <option value="">All priorities</option>
            <option value="high">P1 · High</option>
            <option value="medium">P2 · Medium</option>
            <option value="low">P3 · Low</option>
            <option value="none">No priority</option>
          </select>
          <select className="control-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon} {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {openTotal === 0 && groupBy !== 'date' && (
        <div className="empty-inline center">
          <strong>No matching open tasks.</strong>
          <span>Add one above or clear your filters.</span>
        </div>
      )}

      {groups.map((g) => {
        if (!g.items.length && !g.alwaysShow) return null;
        return (
          <section key={g.key} className={`task-group task-group-${g.key}`}>
            <h3>
              {g.label} <span className="count">{g.items.length}</span>
            </h3>
            {g.items.length === 0 && <p className="muted small">Nothing due today.</p>}
            {g.items.map((t) => (
              <TaskRow key={t.id} task={t} showSource={groupBy !== 'source'} />
            ))}
          </section>
        );
      })}

      <button type="button" className="btn-ghost" onClick={() => setShowDone(!showDone)}>
        {showDone ? 'Hide' : 'Show'} completed ({doneItems.length})
      </button>

      {showDone && doneItems.length > 0 && (
        <section className="task-group task-group-done">
          <h3>
            Done <span className="count">{doneItems.length}</span>
          </h3>
          {doneItems.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </section>
      )}
    </div>
  );
}
