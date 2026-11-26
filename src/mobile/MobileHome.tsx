import { useMemo, useState } from 'react';
import { BookOpen, CalendarDays, Check, ChevronRight, CircleCheck, Hash, Monitor, Moon, Network, Plus, Repeat, Settings, SquareCheckBig, Sun, Trash } from 'lucide-react';
import { getOrCreateDaily } from '../db/indexers';
import { dateLabel, todayISO } from '../lib/dates';
import { isRoutineDoneForDate, isRoutineDueOnDate } from '../lib/routines';
import { spaceOf } from '../lib/spaces';
import { classifyTaskKind } from '../lib/tasks';
import { typeLabel } from '../lib/typeLabels';
import { displayTitle, useData, useObjMap, useSpaceObjects, useSpaceRoutines, useSpaceTasks, useSpaceTypes } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useT, useUI } from '../store/uiStore';
import { SpaceSwitcher } from '../components/SpaceSwitcher';
import { SyncIndicator } from '../components/CloudSync';
import { MobileHeader } from './MobileHeader';
import { useRefresh } from './refresh';
import { ensureHandbook } from '../components/aiHandbook';

export function Section({ title, count, badge, onAdd, addLabel, children }: { title: string; count?: number; badge?: React.ReactNode; onAdd?: () => void; addLabel?: string; children: React.ReactNode }) {
  return (
    <section className="mh-section">
      <header className="mh-section-head">
        <h2>{title}</h2>
        {count != null && <span className="mh-count">{count}</span>}
        {badge}
        {onAdd && (
          <button type="button" className="mh-add" onClick={onAdd} aria-label={addLabel}>
            <Plus size={20} />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

export function Row({ icon, label, onClick, right, color, chevron, indent }: { icon: React.ReactNode; label: string; onClick: () => void; right?: React.ReactNode; color?: string; chevron?: React.ReactNode; indent?: boolean }) {
  return (
    <div className={`mh-row${indent ? ' is-indent' : ''}`}>
      <span className="mh-row-lead">{chevron}</span>
      <button type="button" className="mh-row-main" onClick={onClick}>
        <span className="mh-row-icon" style={color ? { ['--type-color' as string]: color } : undefined}>
          {icon}
        </span>
        <span className="mh-row-label">{label}</span>
        {right != null && <span className="mh-row-right">{right}</span>}
      </button>
    </div>
  );
}

/** The phone home screen of my space: today, pinned notes, shortcuts, object types and recent edits. */
export function MobileHome() {
  const tr = useT();
  const open = useOpen();
  const objects = useData((s) => s.objects);
  const spaceObjects = useSpaceObjects();
  const types = useSpaceTypes();
  const collections = useData((s) => s.collections);
  const tasks = useSpaceTasks();
  const routines = useSpaceRoutines();
  const pinned = useData((s) => s.pinned);
  const objMap = useObjMap();
  const { theme, setTheme, setTypeEditor, setPalette } = useUI();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { note } = useRefresh();

  const counts = useMemo(() => {
    const byType = new Map<string, number>();
    const byCollection = new Map<string, number>();
    let trash = 0;
    for (const o of objects) {
      if (o.deletedAt) trash++;
      else if (spaceOf(o) === 'me') {
        byType.set(o.typeId, (byType.get(o.typeId) ?? 0) + 1);
        for (const c of o.collectionIds ?? []) byCollection.set(c, (byCollection.get(c) ?? 0) + 1);
      }
    }
    return { byType, byCollection, trash };
  }, [objects]);

  const dueToday = useMemo(() => {
    const today = todayISO();
    let todos = 0;
    let projectTasks = 0;
    for (const t of tasks) {
      if (t.done || !t.text.trim()) continue;
      const src = objMap.get(t.objectId);
      if (!src || src.deletedAt) continue;
      const kind = t.kind ?? classifyTaskKind({ explicitKind: t.explicitKind, status: t.status, contextId: t.contextId, sourceTypeId: src.typeId });
      if (kind === 'todo') {
        if (t.due && t.due <= today) todos++;
      } else if ((t.due && t.due <= today) || t.status === 'in_progress') projectTasks++;
    }
    const dueRoutines = routines.filter((r) => isRoutineDueOnDate(r, today, today) && !isRoutineDoneForDate(r, today)).length;
    return { todos, projectTasks, dueRoutines };
  }, [tasks, objMap, routines]);

  const pinnedObjects = pinned.map((id) => objMap.get(id)).filter((o) => o && !o.deletedAt && spaceOf(o) === 'me');
  const recent = useMemo(() => [...spaceObjects].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8), [spaceObjects]);
  const typeOf = (id: string) => types.find((t) => t.id === id);
  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const themeLabel = { light: tr('Light'), dark: tr('Dark'), system: tr('System') };
  const now = new Date();

  const openToday = async () => {
    await getOrCreateDaily(todayISO());
    open(`/calendar?mode=day&date=${todayISO()}`);
  };

  return (
    <div className="mh">
      <MobileHeader
        left={<SpaceSwitcher />}
        right={
          <div className="m-pill">
            <button type="button" onClick={() => setTheme(nextTheme)} aria-label={tr('Theme: {current} (click for {next})', { current: themeLabel[theme], next: themeLabel[nextTheme] })}>
              {theme === 'light' ? <Sun size={21} /> : theme === 'dark' ? <Moon size={21} /> : <Monitor size={21} />}
            </button>
            <span className="m-pill-sep" />
            <button type="button" onClick={() => open('/settings')} aria-label={tr('Settings')}>
              <Settings size={21} />
            </button>
          </div>
        }
      />

      {note && (
        <p className={`mh-refresh${note === 'updating' ? ' is-updating' : ''}`} role="status">
          {note !== 'updating' && <Check size={15} />}
          {tr(note === 'updating' ? 'Loading the new version…' : note === 'synced' ? 'Synced · you have the latest version' : 'You have the latest version')}
        </p>
      )}
      <button type="button" className="mh-today" onClick={() => void openToday()}>
        <span className="mh-today-icon">
          <span className="mh-today-month">{dateLabel(now, tr, 'MMM', 'M月')}</span>
          <span className="mh-today-day">{now.getDate()}</span>
        </span>
        <span className="mh-today-text">
          <strong>{tr('Today’s note')}</strong>
          <span>{dateLabel(now, tr, 'EEEE, MMMM d', 'M月d日 EEEE')}</span>
        </span>
        <ChevronRight size={20} className="mh-chevron" />
      </button>
      <div className="mh-sync">
        <SyncIndicator />
      </div>

      <Section title={tr('Pinned')} count={pinnedObjects.length} onAdd={() => setPalette(true)} addLabel={tr('Find a note to pin')}>
        {pinnedObjects.length === 0 ? (
          <p className="mh-empty">{tr('Nothing pinned yet. Pin a note from its ⋯ menu to keep it here.')}</p>
        ) : (
          pinnedObjects.map((o) => (
            <Row key={o!.id} icon={o!.icon || typeOf(o!.typeId)?.icon} color={typeOf(o!.typeId)?.color} label={displayTitle(o!, tr)} onClick={() => open(objPath(o!.id))} />
          ))
        )}
      </Section>

      <Section title={tr('Quick links')}>
        <Row icon={<CircleCheck size={18} />} label={tr('To-do')} onClick={() => open('/todos')} right={dueToday.todos || null} />
        <Row icon={<Repeat size={18} />} label={tr('Routines')} onClick={() => open('/routines')} right={dueToday.dueRoutines || null} />
        <Row icon={<SquareCheckBig size={18} />} label={tr('Tasks')} onClick={() => open('/tasks')} right={dueToday.projectTasks || null} />
        <Row icon={<CalendarDays size={18} />} label={tr('Calendar')} onClick={() => open('/calendar?mode=month')} />
        <Row icon={<Network size={18} />} label={tr('Graph')} onClick={() => open('/graph')} />
        <Row icon={<Hash size={18} />} label={tr('Tags')} onClick={() => open('/tags')} />
        <Row icon={<BookOpen size={18} />} label={tr('AI handbook')} onClick={async () => open(await ensureHandbook(tr))} />
        <Row icon={<Trash size={18} />} label={tr('Trash')} onClick={() => open('/trash')} right={counts.trash || null} />
      </Section>

      <Section title={tr('Object Types')} count={types.length} onAdd={() => setTypeEditor('new')} addLabel={tr('New object type')}>
        {types.map((t) => {
          const cols = collections.filter((c) => c.typeId === t.id);
          const isOpen = expanded.has(t.id);
          return (
            <div key={t.id}>
              <Row
                icon={t.icon}
                color={t.color}
                label={typeLabel(t, tr)}
                onClick={() => open(`/type/${t.id}`)}
                right={counts.byType.get(t.id) ?? 0}
                chevron={
                  cols.length > 0 && (
                    <button
                      type="button"
                      className={`mh-expand${isOpen ? ' is-open' : ''}`}
                      aria-expanded={isOpen}
                      aria-label={tr(isOpen ? 'Hide collections' : 'Show collections')}
                      onClick={() =>
                        setExpanded((s) => {
                          const next = new Set(s);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
                          return next;
                        })
                      }
                    >
                      <ChevronRight size={18} />
                    </button>
                  )
                }
              />
              {isOpen &&
                cols.map((c) => (
                  <Row key={c.id} indent icon={c.icon || '📁'} label={c.name} onClick={() => open(`/type/${t.id}?collection=${c.id}`)} right={counts.byCollection.get(c.id) ?? 0} />
                ))}
            </div>
          );
        })}
      </Section>

      <Section title={tr('Recently edited')}>
        {recent.length === 0 ? (
          <p className="mh-empty">{tr('Nothing yet. Tap + below to create your first note.')}</p>
        ) : (
          recent.map((o) => <Row key={o.id} icon={o.icon || typeOf(o.typeId)?.icon} color={typeOf(o.typeId)?.color} label={displayTitle(o, tr)} onClick={() => open(objPath(o.id))} />)
        )}
      </Section>
    </div>
  );
}
