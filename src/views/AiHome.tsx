import { useMemo, useState } from 'react';
import { addDays } from 'date-fns';
import { ArrowRightLeft, BookOpen, CalendarDays, ChevronRight, CircleCheck, Settings } from 'lucide-react';
import type { Obj, TaskRec } from '../db/schema';
import { getOrCreateAiLog, moveToSpace } from '../db/indexers';
import { dateLabel, fromISODate, toISODate, todayISO } from '../lib/dates';
import { AI_DOC_TYPE, AI_LOG_TYPE, aiDocStatus, aiLogEntries, daysSince, isStaleAiTodo, RECENT_LOG_DAYS, spaceOf, type AiDocStatus } from '../lib/spaces';
import { displayTitle, useData, useObjMap, useTypeMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useT } from '../store/uiStore';
import { TaskRow } from '../components/TaskRow';
import { ObjectRow } from '../components/ObjectCard';
import { SpaceSwitcher } from '../components/SpaceSwitcher';
import { SyncIndicator } from '../components/CloudSync';
import { ensureHandbook } from '../components/aiHandbook';
import { MobileHeader } from '../mobile/MobileHeader';
import { useIsMobile } from '../mobile/useIsMobile';

function Block({ title, count, tone, children, action }: { title: string; count?: number; tone?: 'attention'; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className={`aiw-block${tone ? ' is-' + tone : ''}`}>
      <header className="aiw-block-head">
        <h2>{title}</h2>
        {count != null && <span className={`aiw-count${tone && count ? ' is-' + tone : ''}`}>{count}</span>}
        {action && <span className="aiw-block-action">{action}</span>}
      </header>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="aiw-empty">{children}</p>;

/** The AI workspace home: what waits for you first, then today's work, the AI's own to-dos, documents and the archive. */
export function AiHome() {
  const tr = useT();
  const open = useOpen();
  const mobile = useIsMobile();
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

  const todayLog = logs.get(today);
  const todayEntries = aiLogEntries(todayLog?.content);

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

  const docGroups = useMemo(() => {
    const by = (s: AiDocStatus) => docs.filter((d) => aiDocStatus(d) === s).sort((a, b) => b.updatedAt - a.updatedAt);
    return { review: by('To review'), draft: by('Draft'), adopted: by('Adopted'), archived: by('Archived').length };
  }, [docs]);

  const openToday = async () => {
    await getOrCreateAiLog(today);
    open(`/calendar?mode=day&date=${today}`);
  };

  const staleChip = (t: TaskRec) =>
    isStaleAiTodo(t.aiTodo!, today) ? (
      <span className="aiw-stale" title={tr('Waiting since {date}', { date: t.aiTodo!.at })}>
        {tr('Waiting {days} days', { days: daysSince(t.aiTodo!.at, today) })}
      </span>
    ) : null;

  const docRow = (d: Obj, extra?: React.ReactNode) => (
    <ObjectRow key={d.id} obj={d} type={typeMap.get(d.typeId)} right={<span className="aiw-doc-meta">{d.props?.source ? `${d.props.source} · ` : ''}{d.props?.date ?? ''}{extra}</span>} />
  );

  const adoptedShown = showAllAdopted ? docGroups.adopted : docGroups.adopted.slice(0, 3);

  return (
    <div className={mobile ? 'mh aiw-home is-mobile' : 'page aiw-home'}>
      {mobile ? (
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
      ) : (
        <header className="page-head aiw-head">
          <h1>
            <span aria-hidden>🤖</span> {tr('AI workspace')}
          </h1>
          <p className="muted">{tr('What AI apps did for you, what waits for your OK, and what they will do next.')}</p>
        </header>
      )}

      <div className="aiw-top">
        <button type="button" className="mh-today aiw-today" onClick={() => void openToday()}>
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
        <div className="aiw-quick">
          <button type="button" className="chip" onClick={(e) => open('/todos', e)}>
            <CircleCheck size={14} /> {tr('To-do')}
          </button>
          <button type="button" className="chip" onClick={(e) => open('/calendar?mode=month', e)}>
            <CalendarDays size={14} /> {tr('Calendar')}
          </button>
          <button type="button" className="chip" onClick={async (e) => open(await ensureHandbook(tr), { altKey: e.altKey })}>
            <BookOpen size={14} /> {tr('AI handbook')}
          </button>
        </div>
        {mobile && (
          <div className="mh-sync">
            <SyncIndicator />
          </div>
        )}
      </div>

      <div className="aiw-grid">
        <div className="aiw-col">
          <Block title={tr('Waiting for you')} count={confirm.length} tone="attention">
            {confirm.length === 0 ? <Empty>{tr('Nothing waits for you. When an AI needs your OK, it shows up here.')}</Empty> : confirm.map((t) => <TaskRow key={t.id} task={t} showStatus={false} hideEmptyMeta extraActions={staleChip(t)} />)}
          </Block>

          <Block title={tr('Today’s AI log')} count={todayEntries.length}>
            {todayEntries.length === 0 ? (
              <Empty>{tr('No work recorded yet today.')}</Empty>
            ) : (
              <div className="aiw-entries">
                {todayEntries.map((e, i) => (
                  <button key={i} type="button" className="aiw-entry" onClick={() => void openToday()}>
                    <span className="aiw-entry-time">{e.time}</span>
                    <span className="aiw-entry-title">{e.title}</span>
                    <span className="aiw-entry-by">{e.by}</span>
                  </button>
                ))}
              </div>
            )}
          </Block>

          <Block title={tr('AI next time')} count={next.length}>
            {next.length === 0 ? <Empty>{tr('Nothing left over. Unfinished work from AI sessions shows up here.')}</Empty> : next.map((t) => <TaskRow key={t.id} task={t} showStatus={false} hideEmptyMeta extraActions={staleChip(t)} />)}
          </Block>
        </div>

        <div className="aiw-col">
          <Block title={tr('AI documents')} count={docGroups.review.length + docGroups.draft.length}>
            {docGroups.review.length + docGroups.draft.length + docGroups.adopted.length === 0 && <Empty>{tr('Reports, drafts and scan results from AI apps go here.')}</Empty>}
            {docGroups.review.length > 0 && (
              <>
                <h3 className="aiw-sub">{tr('To review')}</h3>
                {docGroups.review.map((d) => docRow(d))}
              </>
            )}
            {docGroups.draft.length > 0 && (
              <>
                <h3 className="aiw-sub">{tr('Draft')}</h3>
                {docGroups.draft.map((d) => docRow(d))}
              </>
            )}
            {docGroups.adopted.length > 0 && (
              <>
                <h3 className="aiw-sub">{tr('Recently adopted')}</h3>
                {adoptedShown.map((d) => (
                  <div key={d.id} className="aiw-adopted">
                    {docRow(d)}
                    <button type="button" className="btn small" title={tr('Move to my space')} onClick={() => void moveToSpace(d.id, 'me')}>
                      <ArrowRightLeft size={13} /> {tr('Move to my space')}
                    </button>
                  </div>
                ))}
                {docGroups.adopted.length > 3 && (
                  <button type="button" className="aiw-more" onClick={() => setShowAllAdopted((v) => !v)}>
                    {tr(showAllAdopted ? 'Show fewer' : 'Show all {count}', { count: docGroups.adopted.length })}
                  </button>
                )}
              </>
            )}
            {docGroups.archived > 0 && (
              <button type="button" className="aiw-more" onClick={(e) => open(`/type/${AI_DOC_TYPE}`, e)}>
                {tr('{count} archived document(s), hidden', { count: docGroups.archived })}
              </button>
            )}
          </Block>

          <Block title={tr('This week')} count={weekTotal}>
            <div className="aiw-week" role="list" aria-label={tr('Work recorded each day this week')}>
              {week.map((d) => (
                <button
                  key={d.iso}
                  type="button"
                  role="listitem"
                  className={`aiw-week-day${d.iso === today ? ' is-today' : ''}`}
                  disabled={!d.log}
                  onClick={() => open(`/calendar?mode=day&date=${d.iso}`)}
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
          </Block>

          <Block title={tr('Archive')} count={archive.reduce((n, m) => n + m.list.length, 0)}>
            {archive.length === 0 ? (
              <Empty>{tr('Logs older than a week move here, grouped by month. Nothing is deleted.')}</Empty>
            ) : (
              archive.map(({ month, list }) => (
                <details key={month} className="aiw-month">
                  <summary>
                    <span>{dateLabel(fromISODate(month + '-01'), tr, 'MMMM yyyy', 'yyyy年M月')}</span>
                    <span className="muted">{tr('{count} log(s)', { count: list.length })}</span>
                  </summary>
                  {list.map((log) => (
                    <button key={log.id} type="button" className="aiw-archive-row" onClick={(e) => open(objPath(log.id), e)}>
                      <span>{displayTitle(log, tr)}</span>
                      <span className="muted small">{tr('{count} piece(s) of work', { count: aiLogEntries(log.content).length })}</span>
                    </button>
                  ))}
                </details>
              ))
            )}
          </Block>
        </div>
      </div>
    </div>
  );
}

