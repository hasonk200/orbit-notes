import { useMemo, useState } from 'react';
import { addDays } from 'date-fns';
import { ArrowLeftRight, BookOpen, CalendarDays, ChevronRight, CircleCheck, Search, Settings } from 'lucide-react';
import type { Obj, TaskRec } from '../db/schema';
import { getOrCreateAiLog, moveToSpace } from '../db/indexers';
import { dateLabel, fromISODate, shortDate, toISODate, todayISO } from '../lib/dates';
import { AI_DOC_TYPE, AI_LOG_TYPE, aiDocStatus, aiLogEntries, daysSince, isStaleAiTodo, RECENT_LOG_DAYS, spaceOf, type AiDocStatus } from '../lib/spaces';
import { displayTitle, useData, useObjMap, useTypeMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useT, useUI } from '../store/uiStore';
import { TaskRow } from '../components/TaskRow';
import { SpaceSwitcher } from '../components/SpaceSwitcher';
import { SyncIndicator } from '../components/CloudSync';
import { ensureHandbook } from '../components/aiHandbook';
import { MobileHeader } from '../mobile/MobileHeader';
import { Row, Section } from '../mobile/MobileHome';
import { useIsMobile } from '../mobile/useIsMobile';

type Click = (e?: React.MouseEvent) => void;

/** A section: the phone home screen's heading on phones, Explore's small label on the computer. */
function Sec({ mobile, title, count, badge, children }: { mobile: boolean; title: string; count: number; badge?: boolean; children: React.ReactNode }) {
  const counter = badge && count ? <span className="space-badge">{count}</span> : null;
  if (mobile) {
    return (
      <Section title={title} count={counter ? undefined : count} badge={counter}>
        {children}
      </Section>
    );
  }
  return (
    <section>
      <h4 className="section-label aiw-label">
        {title}
        {counter ?? <span className="aiw-count">{count}</span>}
      </h4>
      <div className="row-list">{children}</div>
    </section>
  );
}

/** A row: the phone home screen's row on phones, Explore's note row on the computer. */
function Line({ mobile, icon, color, label, right, onClick }: { mobile: boolean; icon: React.ReactNode; color?: string; label: string; right?: React.ReactNode; onClick: Click }) {
  if (mobile) return <Row icon={icon} color={color} label={label} right={right} onClick={() => onClick()} />;
  return (
    <button type="button" className="obj-row" onClick={onClick}>
      <span className="obj-row-icon" style={color ? { ['--type-color' as string]: color } : undefined}>
        {icon}
      </span>
      <span className="obj-row-title">{label}</span>
      {right != null && <span className="obj-row-type">{right}</span>}
    </button>
  );
}

const Empty = ({ mobile, children }: { mobile: boolean; children: React.ReactNode }) => <p className={mobile ? 'mh-empty' : 'muted small aiw-empty'}>{children}</p>;

/**
 * The AI workspace home, built from the same pieces as the rest of Orbit: on the computer it looks
 * like Explore, on phones like the home screen of My space. What waits for you comes first, then
 * today's work, the AI's own to-dos, documents, this week and the archive.
 */
export function AiHome() {
  const tr = useT();
  const open = useOpen();
  const mobile = useIsMobile();
  const setPalette = useUI((s) => s.setPalette);
  const objects = useData((s) => s.objects);
  const tasks = useData((s) => s.tasks);
  const objMap = useObjMap();
  const typeMap = useTypeMap();
  const [showAllAdopted, setShowAllAdopted] = useState(false);
  const today = todayISO();

  const { logs, docs } = useMemo(() => {
    const logs = new Map<string, Obj>();
    const docs: Obj[] = [];
    for (const o of objects) {
      if (o.deletedAt || spaceOf(o) !== 'ai') continue;
      if (o.typeId === AI_LOG_TYPE && o.dailyDate) logs.set(o.dailyDate, o);
      else if (o.typeId === AI_DOC_TYPE) docs.push(o);
    }
    return { logs, docs };
  }, [objects]);

  const { confirm, next } = useMemo(() => {
    const confirm: TaskRec[] = [];
    const next: TaskRec[] = [];
    for (const t of tasks) {
      if (!t.aiTodo || t.done || !t.text.trim()) continue;
      const src = objMap.get(t.objectId);
      if (!src || src.deletedAt) continue;
      (t.aiTodo.kind === 'confirm' ? confirm : next).push(t);
    }
    // Oldest first: what has waited longest needs attention first.
    const byAge = (a: TaskRec, b: TaskRec) => a.aiTodo!.at.localeCompare(b.aiTodo!.at) || a.createdAt - b.createdAt;
    return { confirm: confirm.sort(byAge), next: next.sort(byAge) };
  }, [tasks, objMap]);

  const todayEntries = aiLogEntries(logs.get(today)?.content);

  // The last seven days, oldest on the left, with the number of work entries each day.
  const week = useMemo(
    () =>
      Array.from({ length: RECENT_LOG_DAYS }, (_, i) => {
        const iso = toISODate(addDays(fromISODate(today), i - RECENT_LOG_DAYS + 1));
        return { iso, log: logs.get(iso), count: aiLogEntries(logs.get(iso)?.content).length };
      }),
    [logs, today],
  );
  const weekMax = Math.max(1, ...week.map((d) => d.count));
  const weekTotal = week.reduce((n, d) => n + d.count, 0);

  // Logs older than a week, grouped by month, newest first. Nothing is deleted.
  const archive = useMemo(() => {
    const months = new Map<string, Obj[]>();
    const cutoff = week[0].iso;
    for (const [iso, log] of logs) {
      if (iso >= cutoff) continue;
      const key = iso.slice(0, 7);
      months.set(key, [...(months.get(key) ?? []), log]);
    }
    return [...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, list]) => ({ month, list: list.sort((a, b) => b.dailyDate!.localeCompare(a.dailyDate!)) }));
  }, [logs, week]);
  const archivedLogs = archive.reduce((n, m) => n + m.list.length, 0);

  const docGroups = useMemo(() => {
    const by = (s: AiDocStatus) => docs.filter((d) => aiDocStatus(d) === s).sort((a, b) => b.updatedAt - a.updatedAt);
    return { review: by('To review'), draft: by('Draft'), adopted: by('Adopted'), archived: by('Archived').length };
  }, [docs]);
  const adoptedShown = showAllAdopted ? docGroups.adopted : docGroups.adopted.slice(0, 3);
  const openDocs = docGroups.review.length + docGroups.draft.length;

  const openToday: Click = async (e) => {
    const altKey = e?.altKey;
    await getOrCreateAiLog(today);
    open(`/calendar?mode=day&date=${today}`, { altKey });
  };

  const staleChip = (t: TaskRec) =>
    isStaleAiTodo(t.aiTodo!, today) ? (
      <span className="aiw-stale" title={tr('Waiting since {date}', { date: t.aiTodo!.at })}>
        {tr('Waiting {days} days', { days: daysSince(t.aiTodo!.at, today) })}
      </span>
    ) : null;

  const docType = typeMap.get(AI_DOC_TYPE);
  const logType = typeMap.get(AI_LOG_TYPE);
  const docLine = (d: Obj) => (
    <Line key={d.id} mobile={mobile} icon={d.icon || docType?.icon} color={docType?.color} label={displayTitle(d, tr)} right={[mobile ? null : d.props?.source, d.props?.date ? shortDate(d.props.date, tr) : null].filter(Boolean).join(' · ')} onClick={(e) => open(objPath(d.id), e)} />
  );
  const subLabel = (text: string) => <div className={`aiw-sub${mobile ? ' is-mobile' : ''}`}>{text}</div>;
  const todoRow = (t: TaskRec) => <TaskRow key={t.id} task={t} showStatus={false} hideEmptyMeta extraActions={staleChip(t)} />;

  return (
    <div className={mobile ? 'mh aiw-home is-mobile' : 'page aiw-home'}>
      {mobile ? (
        <>
          <MobileHeader
            left={<SpaceSwitcher />}
            right={
              <div className="m-pill">
                <button type="button" onClick={() => open('/settings')} aria-label={tr('Settings')}>
                  <Settings size={21} />
                </button>
              </div>
            }
          />
          <button type="button" className="mh-today" onClick={() => openToday()}>
            <span className="mh-today-icon aiw-today-icon">
              <span className="mh-today-month">{dateLabel(new Date(), tr, 'MMM', 'M月')}</span>
              <span className="mh-today-day">{new Date().getDate()}</span>
            </span>
            <span className="mh-today-text">
              <strong>{tr('Today’s AI log')}</strong>
              <span>{todayEntries.length ? tr('{count} piece(s) of work today', { count: todayEntries.length }) : tr('No work recorded yet today')}</span>
            </span>
            <ChevronRight size={20} className="mh-chevron" />
          </button>
          <div className="mh-sync">
            <SyncIndicator />
          </div>
          <Row
            icon={<BookOpen size={20} />}
            color="var(--accent)"
            label={tr('AI handbook')}
            onClick={async () => open(await ensureHandbook(tr))}
          />
        </>
      ) : (
        <>
          <header className="page-head">
            <h1>{tr('AI workspace')}</h1>
            <p className="muted">{tr('What AI apps did for you, what waits for your OK, and what they will do next.')}</p>
          </header>
          <div className="explore-cards">
            <button type="button" className="explore-card" onClick={(e) => openToday(e)}>
              <CalendarDays size={20} />
              <span>{tr('Today’s AI log')}</span>
            </button>
            <button type="button" className="explore-card" onClick={(e) => open('/todos', e)}>
              <CircleCheck size={20} />
              <span>{tr('To-do')}</span>
            </button>
            <button type="button" className="explore-card" onClick={async (e) => open(await ensureHandbook(tr), { altKey: e.altKey })}>
              <BookOpen size={20} />
              <span>{tr('AI handbook')}</span>
            </button>
            <button type="button" className="explore-card" onClick={() => setPalette(true)}>
              <Search size={20} />
              <span>{tr('Search')}</span>
              <kbd>Ctrl K</kbd>
            </button>
          </div>
        </>
      )}

      <Sec mobile={mobile} title={tr('Waiting for you')} count={confirm.length} badge>
        {confirm.length === 0 ? <Empty mobile={mobile}>{tr('Nothing waits for you. When an AI needs your OK, it shows up here.')}</Empty> : confirm.map(todoRow)}
      </Sec>

      <Sec mobile={mobile} title={tr('Today’s AI log')} count={todayEntries.length}>
        {todayEntries.length === 0 ? (
          <Empty mobile={mobile}>{tr('No work recorded yet today.')}</Empty>
        ) : (
          todayEntries.map((e, i) => <Line key={i} mobile={mobile} icon={logType?.icon} color={logType?.color} label={`${e.time} · ${e.title}`} right={e.by} onClick={(ev) => openToday(ev)} />)
        )}
      </Sec>

      <Sec mobile={mobile} title={tr('AI next time')} count={next.length}>
        {next.length === 0 ? <Empty mobile={mobile}>{tr('Nothing left over. Unfinished work from AI sessions shows up here.')}</Empty> : next.map(todoRow)}
      </Sec>

      <Sec mobile={mobile} title={tr('AI documents')} count={openDocs}>
        {openDocs + docGroups.adopted.length === 0 && <Empty mobile={mobile}>{tr('Reports, drafts and scan results from AI apps go here.')}</Empty>}
        {docGroups.review.length > 0 && subLabel(tr('To review'))}
        {docGroups.review.map(docLine)}
        {docGroups.draft.length > 0 && subLabel(tr('Draft'))}
        {docGroups.draft.map(docLine)}
        {docGroups.adopted.length > 0 && subLabel(tr('Recently adopted'))}
        {adoptedShown.map((d) => (
          <div key={d.id} className="aiw-adopted">
            {docLine(d)}
            <button type="button" className="icon-btn" title={tr('Move to my space')} aria-label={tr('Move to my space')} onClick={() => void moveToSpace(d.id, 'me')}>
              <ArrowLeftRight size={16} />
            </button>
          </div>
        ))}
        {docGroups.adopted.length > 3 && (
          <button type="button" className="aiw-more" onClick={() => setShowAllAdopted((v) => !v)}>
            {tr(showAllAdopted ? 'Show fewer' : 'Show all {count}', { count: docGroups.adopted.length })}
          </button>
        )}
        {docGroups.archived > 0 && (
          <button type="button" className="aiw-more" onClick={(e) => open(`/type/${AI_DOC_TYPE}`, e)}>
            {tr('{count} archived document(s), hidden', { count: docGroups.archived })}
          </button>
        )}
      </Sec>

      <Sec mobile={mobile} title={tr('This week')} count={weekTotal}>
        <div className={`aiw-week${weekTotal === 0 ? ' is-empty' : ''}`} role="list" aria-label={tr('Work recorded each day this week')}>
          {week.map((d) => (
            <button
              key={d.iso}
              type="button"
              role="listitem"
              className={`aiw-week-day${d.iso === today ? ' is-today' : ''}`}
              disabled={!d.log}
              onClick={(e) => open(`/calendar?mode=day&date=${d.iso}`, e)}
              aria-label={tr('{date}: {count} piece(s) of work', { date: dateLabel(fromISODate(d.iso), tr, 'EEE MMM d', 'M月d日 EEEE'), count: d.count })}
            >
              <span className="aiw-week-count">{d.count || ''}</span>
              <span className="aiw-week-track">
                <span className="aiw-week-bar" style={{ height: `${(d.count / weekMax) * 100}%` }} />
              </span>
              <span className="aiw-week-label">{dateLabel(fromISODate(d.iso), tr, 'EEEEE', 'EEEEE')}</span>
            </button>
          ))}
        </div>
      </Sec>

      <Sec mobile={mobile} title={tr('Archive')} count={archivedLogs}>
        {archive.length === 0 ? (
          <Empty mobile={mobile}>{tr('Logs older than a week move here, grouped by month. Nothing is deleted.')}</Empty>
        ) : (
          archive.map(({ month, list }) => (
            <details key={month} className={`aiw-month${mobile ? ' is-mobile' : ''}`}>
              <summary>
                <ChevronRight size={16} className="aiw-month-chevron" />
                <span className="aiw-month-name">{dateLabel(fromISODate(month + '-01'), tr, 'MMMM yyyy', 'yyyy年M月')}</span>
                <span className="aiw-month-count">{tr('{count} log(s)', { count: list.length })}</span>
              </summary>
              {list.map((log) => (
                <Line key={log.id} mobile={mobile} icon={logType?.icon} color={logType?.color} label={displayTitle(log, tr)} right={tr('{count} piece(s) of work', { count: aiLogEntries(log.content).length })} onClick={(e) => open(objPath(log.id), e)} />
              ))}
            </details>
          ))
        )}
      </Sec>
    </div>
  );
}
