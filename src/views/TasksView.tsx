import { useT } from '../store/uiStore';
import { useMemo, useState } from 'react';
import { Layers, Plus, Search } from 'lucide-react';
import type { TaskPriority, TaskRec } from '../db/schema';
import { getOrCreateDaily, saveObject } from '../db/indexers';
import { flushDrafts } from '../db/drafts';
import { db, uid } from '../db/schema';
import { displayTitle, useActiveObjects, useData, useObjMap, useTypeMap } from '../store/dataStore';
import { todayISO } from '../lib/dates';
import { isComposing } from '../lib/keyboard';
import { LocalizedError, localizeError } from '../lib/i18n';
import { includesText } from '../lib/search';
import { appendTask, parseTaskInput } from '../lib/taskInput';
import { typeLabel } from '../lib/typeLabels';
import { TaskRow } from '../components/TaskRow';

type GroupMode = 'date' | 'priority' | 'source';

const PRIO_RANK: Record<string, number> = { high: 0, medium: 1, low: 2, '': 3 };

/** Append a task to today's daily note or a specific target object. */
async function addTaskToObject(targetId: string, text: string, due: string | null, priority: TaskPriority | null) {
  const note = targetId === '__today' ? await getOrCreateDaily(todayISO()) : await db.objects.get(targetId);
  if (!note) throw new LocalizedError('The selected note is no longer available.');
  await flushDrafts(note.id);
  let saved = false;
  await saveObject(note.id, (current) => {
    if (current.deletedAt) return {};
    saved = true;
    return { content: appendTask(current.content, uid(), text, due, priority) };
  });
  if (!saved) throw new LocalizedError('The selected note is no longer available.');
}

export function TasksView() {
  const tr = useT();
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
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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
    const q = search.trim();
    const active = tasks.filter((t) => {
      const o = objMap.get(t.objectId);
      if (!o || o.deletedAt || !t.text.trim()) return false;
      if (filterType && o.typeId !== filterType) return false;
      if (filterPrio && (t.priority ?? 'none') !== filterPrio) return false;
      if (q && !includesText(t.text, q) && !includesText(displayTitle(o, tr), q)) return false;
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
        { key: 'overdue', label: tr('Overdue'), items: open.filter((t) => t.due && t.due < today).sort(byDueAndPrio) },
        { key: 'today', label: tr('Today'), items: open.filter((t) => t.due === today).sort(byDueAndPrio), alwaysShow: true },
        { key: 'upcoming', label: tr('Upcoming'), items: open.filter((t) => t.due && t.due > today).sort(byDueAndPrio) },
        { key: 'nodate', label: tr('No date'), items: open.filter((t) => !t.due).sort(byDueAndPrio) },
      ];
    } else if (groupBy === 'priority') {
      built = [
        { key: 'high', label: tr('P1 · High priority'), items: open.filter((t) => t.priority === 'high').sort(byDueAndPrio) },
        { key: 'medium', label: tr('P2 · Medium priority'), items: open.filter((t) => t.priority === 'medium').sort(byDueAndPrio) },
        { key: 'low', label: tr('P3 · Low priority'), items: open.filter((t) => t.priority === 'low').sort(byDueAndPrio) },
        { key: 'none', label: tr('No priority'), items: open.filter((t) => !t.priority).sort(byDueAndPrio) },
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
            label: `${o?.icon || tp?.icon || '📄'} ${displayTitle(o, tr)}`,
            items: list.sort(byDueAndPrio),
          };
        })
        .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
    }

    return { groups: built, openTotal: open.length, doneItems: done };
  }, [tasks, objMap, typeMap, filterType, filterPrio, search, groupBy, tr]);

  const submit = async () => {
    const entry = parseTaskInput(text);
    if (!entry.text || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await addTaskToObject(targetObj, entry.text, entry.due ?? (due || null), entry.priority ?? (prio || null));
      setText((current) => current === text ? '' : current);
      setDue((current) => current === due ? '' : current);
      setPrio((current) => current === prio ? '' : current);
    } catch (error) {
      setAddError(localizeError(error, tr));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>{tr('Tasks')}</h1>
        <p className="muted">{tr('{count} open · changes also appear in the source note.', { count: openTotal })}</p>
      </header>

      <div className="quick-add-box">
        <div className="quick-add">
          <Plus size={16} />
          <input
            placeholder={tr('Add a task… (supports @tomorrow, @2026-12-01, !p1 / !p2 / !p3)')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isComposing(e.nativeEvent)) void submit(); }}
          />
          <button type="button" className="btn primary" onClick={submit} disabled={adding}>
            {tr('Add')}
          </button>
        </div>
        <div className="quick-add-meta">
          <select value={targetObj} onChange={(e) => setTargetObj(e.target.value)} title={tr('Save task inside…')}>
            <option value="__today">📅 {tr('Today’s note')}</option>
            {targetChoices.map((o) => {
              const tp = typeMap.get(o.typeId);
              return (
                <option key={o.id} value={o.id}>
                  {o.icon || tp?.icon || '📄'} {displayTitle(o, tr)}
                </option>
              );
            })}
          </select>
          <select value={prio} onChange={(e) => setPrio(e.target.value as TaskPriority | '')} title={tr('Priority')}>
            <option value="">{tr('No priority')}</option>
            <option value="high">{tr('P1 · High')}</option>
            <option value="medium">{tr('P2 · Medium')}</option>
            <option value="low">{tr('P3 · Low')}</option>
          </select>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} title={tr('Due date')} />
        </div>
        {addError && <p className="banner warn" role="alert">{addError}</p>}
      </div>

      <div className="tasks-toolbar">
        <div className="segmented small">
          <button type="button" className={groupBy === 'date' ? 'active' : ''} onClick={() => setGroupBy('date')}>
            {tr('By Date')}
          </button>
          <button type="button" className={groupBy === 'priority' ? 'active' : ''} onClick={() => setGroupBy('priority')}>
            {tr('By Priority')}
          </button>
          <button type="button" className={groupBy === 'source' ? 'active' : ''} onClick={() => setGroupBy('source')}>
            <Layers size={13} /> {tr('By Note')}
          </button>
        </div>
        <div className="tasks-filters">
          <label className="control">
            <Search size={13} />
            <input placeholder={tr('Filter tasks…')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select className="control-select" value={filterPrio} onChange={(e) => setFilterPrio(e.target.value)}>
            <option value="">{tr('All priorities')}</option>
            <option value="high">{tr('P1 · High')}</option>
            <option value="medium">{tr('P2 · Medium')}</option>
            <option value="low">{tr('P3 · Low')}</option>
            <option value="none">{tr('No priority')}</option>
          </select>
          <select className="control-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">{tr('All types')}</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon} {typeLabel(t, tr)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {openTotal === 0 && groupBy !== 'date' && (
        <div className="empty-inline center">
          <strong>{tr('No matching open tasks.')}</strong>
          <span>{tr('Add one above or clear your filters.')}</span>
        </div>
      )}

      {groups.map((g) => {
        if (!g.items.length && !g.alwaysShow) return null;
        return (
          <section key={g.key} className={`task-group task-group-${g.key}`}>
            <h3>
              {g.label} <span className="count">{g.items.length}</span>
            </h3>
            {g.items.length === 0 && <p className="muted small">{tr('Nothing due today.')}</p>}
            {g.items.map((t) => (
              <TaskRow key={t.id} task={t} showSource={groupBy !== 'source'} />
            ))}
          </section>
        );
      })}

      <button type="button" className="btn-ghost" onClick={() => setShowDone(!showDone)}>
        {tr(showDone ? 'Hide completed ({count})' : 'Show completed ({count})', { count: doneItems.length })}
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
