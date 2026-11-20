import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { TaskRec } from '../db/schema';
import { getOrCreateDaily, saveObject } from '../db/indexers';
import { db, uid } from '../db/schema';
import { useData, useObjMap } from '../store/dataStore';
import { parseQuickDate, todayISO } from '../lib/dates';
import { TaskRow } from '../components/TaskRow';

/** Append a task to today's daily note (creates the note if needed). */
async function addTaskToToday(text: string, due: string | null) {
  const note = await getOrCreateDaily(todayISO());
  const fresh = await db.objects.get(note.id);
  const content = JSON.parse(JSON.stringify(fresh!.content));
  content.content = content.content ?? [];
  const item = {
    type: 'taskItem',
    attrs: { checked: false, taskId: uid(), due },
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  };
  const last = content.content[content.content.length - 1];
  if (last?.type === 'taskList') last.content.push(item);
  else {
    // drop a trailing empty paragraph so the list sits at the end
    if (last?.type === 'paragraph' && !last.content?.length) content.content.pop();
    content.content.push({ type: 'taskList', content: [item] });
  }
  await saveObject(note.id, { content });
}

export function TasksView() {
  const tasks = useData((s) => s.tasks);
  const objMap = useObjMap();
  const [showDone, setShowDone] = useState(false);
  const [text, setText] = useState('');
  const [due, setDue] = useState('');

  const groups = useMemo(() => {
    const today = todayISO();
    const active = tasks.filter((t) => {
      const o = objMap.get(t.objectId);
      // empty checkboxes (e.g. from a fresh template) are not real tasks yet
      return o && !o.deletedAt && t.text.trim() !== '';
    });
    const byDue = (a: TaskRec, b: TaskRec) => (a.due ?? '').localeCompare(b.due ?? '') || a.createdAt - b.createdAt;
    const open = active.filter((t) => !t.done);
    return [
      { key: 'overdue', label: 'Overdue', items: open.filter((t) => t.due && t.due < today).sort(byDue) },
      { key: 'today', label: 'Today', items: open.filter((t) => t.due === today).sort(byDue) },
      { key: 'upcoming', label: 'Upcoming', items: open.filter((t) => t.due && t.due > today).sort(byDue) },
      { key: 'nodate', label: 'No date', items: open.filter((t) => !t.due).sort((a, b) => b.createdAt - a.createdAt) },
      { key: 'done', label: 'Done', items: active.filter((t) => t.done).sort((a, b) => b.updatedAt - a.updatedAt) },
    ];
  }, [tasks, objMap]);

  const submit = async () => {
    const raw = text.trim();
    if (!raw) return;
    // allow "buy milk @tomorrow"
    const m = raw.match(/\s@(\S+)$/);
    const quick = m ? parseQuickDate(m[1]) : null;
    await addTaskToToday(quick ? raw.slice(0, m!.index).trim() : raw, quick ?? (due || null));
    setText('');
    setDue('');
  };

  const total = groups.slice(0, 4).reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Tasks</h1>
        <p className="muted">{total} open · tasks live inside your notes, checking them here updates the note.</p>
      </header>
      <div className="quick-add">
        <Plus size={16} />
        <input
          placeholder="Add a task to today’s note… (end with @tomorrow, @fri, @2026-12-01)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} title="Due date" />
        <button type="button" className="btn primary" onClick={submit}>
          Add
        </button>
      </div>
      {groups.map((g) => {
        if (g.key === 'done' && !showDone) return null;
        if (!g.items.length && g.key !== 'today') return null;
        return (
          <section key={g.key} className={`task-group task-group-${g.key}`}>
            <h3>
              {g.label} <span className="count">{g.items.length}</span>
            </h3>
            {g.items.length === 0 && <p className="muted small">Nothing due today.</p>}
            {g.items.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </section>
        );
      })}
      <button type="button" className="btn-ghost" onClick={() => setShowDone(!showDone)}>
        {showDone ? 'Hide' : 'Show'} completed ({groups[4].items.length})
      </button>
    </div>
  );
}
