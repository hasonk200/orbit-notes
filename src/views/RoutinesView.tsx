import { askConfirm } from '../components/ConfirmDialog';
import {
  CalendarClock,
  CheckCircle2,
  Flame,
  Pencil,
  Plus,
  Repeat,
  Search,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { MenuSelect } from '../components/MenuSelect';
import { Modal } from '../components/Popover';
import { todayISO } from '../lib/dates';
import {
  createRoutine,
  deleteRoutine,
  formatRoutineCadence,
  isRoutineDoneForDate,
  isRoutineDueOnDate,
  last7DaysStatus,
  ROUTINE_EMOJI_CHOICES,
  routineStreak,
  toggleRoutine,
  updateRoutine,
  weekdayShortLabel,
  type RoutineCadence,
  pickRoutineDay,
  routineDays,
  type RoutineRec,
  type RoutineTimeSlot,
} from '../lib/routines';
import { includesText } from '../lib/search';
import { typeLabel } from '../lib/typeLabels';
import { TaskTabs } from '../mobile/TaskTabs';
import { displayTitle, useActiveObjects, useObjMap, useSpaceRoutines, useTypeMap } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useT } from '../store/uiStore';

type RoutineTab = 'today' | 'daily' | 'weekly' | 'monthly' | 'all';

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun

function readRoutineTab(): RoutineTab {
  try {
    const v = localStorage.getItem('orbit-routines-tab') as RoutineTab | null;
    if (v && ['today', 'daily', 'weekly', 'monthly', 'all'].includes(v)) return v;
  } catch {
    /* ignore */
  }
  return 'today';
}

function timeSlotLabel(slot: RoutineTimeSlot | undefined): string {
  switch (slot) {
    case 'morning':
      return 'Morning';
    case 'afternoon':
      return 'Afternoon';
    case 'evening':
      return 'Evening';
    default:
      return 'Anytime';
  }
}

export function RoutinesView() {
  const tr = useT();
  const routines = useSpaceRoutines();
  const activeObjects = useActiveObjects();
  const objMap = useObjMap();
  const typeMap = useTypeMap();
  const open = useOpen();

  const [tab, setTabState] = useState<RoutineTab>(readRoutineTab);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Quick-add composer
  const [draft, setDraft] = useState('');
  const [quickCadence, setQuickCadence] = useState<RoutineCadence>('daily');
  const [quickWeekdays, setQuickWeekdays] = useState<number[]>([6]); // default Sat
  const [quickMonthDay, setQuickMonthDay] = useState<number>(1);

  // Create / Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formIcon, setFormIcon] = useState<string | null>(null);
  const [formCadence, setFormCadence] = useState<RoutineCadence>('daily');
  const [formWeekdays, setFormWeekdays] = useState<number[]>([6]);
  const [formMonthDay, setFormMonthDay] = useState<number>(1);
  const [formTimeSlot, setFormTimeSlot] = useState<RoutineTimeSlot>('anytime');
  const [formContextId, setFormContextId] = useState<string>('');

  const setTab = (next: RoutineTab) => {
    setTabState(next);
    try {
      localStorage.setItem('orbit-routines-tab', next);
    } catch {
      /* ignore */
    }
  };

  const today = todayISO();

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return routines;
    return routines.filter((r) => {
      const ctx = r.contextId ? objMap.get(r.contextId) : undefined;
      return (
        includesText(r.title, q) ||
        (r.note ? includesText(r.note, q) : false) ||
        (ctx ? includesText(displayTitle(ctx, tr), q) : false)
      );
    });
  }, [routines, search, objMap, tr]);

  const dueTodayAll = useMemo(() => routines.filter((r) => isRoutineDueOnDate(r, today, today)), [routines, today]);
  const dueTodayOpenCount = useMemo(
    () => dueTodayAll.filter((r) => !isRoutineDoneForDate(r, today)).length,
    [dueTodayAll, today],
  );
  const dueTodayDoneCount = dueTodayAll.length - dueTodayOpenCount;
  const dueTodayPct = dueTodayAll.length > 0 ? Math.round((dueTodayDoneCount / dueTodayAll.length) * 100) : 0;

  const todayOpen = useMemo(
    () => filtered.filter((r) => isRoutineDueOnDate(r, today, today) && !isRoutineDoneForDate(r, today)),
    [filtered, today],
  );
  const todayDone = useMemo(
    () => filtered.filter((r) => isRoutineDueOnDate(r, today, today) && isRoutineDoneForDate(r, today)),
    [filtered, today],
  );

  const dailyList = useMemo(
    () => filtered.filter((r) => r.cadence === 'daily' || r.cadence === 'weekdays'),
    [filtered],
  );
  const weeklyList = useMemo(
    () => filtered.filter((r) => r.cadence === 'weekends' || r.cadence === 'weekly'),
    [filtered],
  );
  const monthlyList = useMemo(() => filtered.filter((r) => r.cadence === 'monthly'), [filtered]);

  const counts = useMemo(
    () => ({
      today: dueTodayOpenCount,
      daily: routines.filter((r) => r.cadence === 'daily' || r.cadence === 'weekdays').length,
      weekly: routines.filter((r) => r.cadence === 'weekends' || r.cadence === 'weekly').length,
      monthly: routines.filter((r) => r.cadence === 'monthly').length,
      all: routines.length,
    }),
    [routines, dueTodayOpenCount],
  );

  const monthDayOptions = useMemo(
    () => Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: tr('Day {day}', { day: i + 1 }) })),
    [tr],
  );

  const contextOptions = useMemo(() => {
    const candidates = activeObjects
      .filter((o) => o.typeId !== 'daily')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 40);
    return [
      { value: '', label: tr('None') },
      ...candidates.map((o) => {
        const tp = typeMap.get(o.typeId);
        return { value: o.id, label: `${o.icon || tp?.icon || '📄'} ${displayTitle(o, tr)}` };
      }),
    ];
  }, [activeObjects, typeMap, tr]);

  const submitQuickAdd = async () => {
    if (!draft.trim()) return;
    await createRoutine({
      title: draft,
      cadence: quickCadence,
      weekdays: quickCadence === 'weekly' ? quickWeekdays : undefined,
      monthDay: quickCadence === 'monthly' ? quickMonthDay : undefined,
    });
    setDraft('');
  };

  const openCreateModal = () => {
    setEditingId(null);
    setFormTitle('');
    setFormNote('');
    setFormIcon(null);
    setFormCadence(tab === 'weekly' ? 'weekends' : tab === 'monthly' ? 'monthly' : 'daily');
    setFormWeekdays([6]);
    setFormMonthDay(1);
    setFormTimeSlot('anytime');
    setFormContextId('');
    setModalOpen(true);
  };

  const openEditModal = (r: RoutineRec) => {
    setEditingId(r.id);
    setFormTitle(r.title);
    setFormNote(r.note ?? '');
    setFormIcon(r.icon ?? null);
    setFormCadence(r.cadence);
    setFormWeekdays(r.weekdays?.length ? r.weekdays : [6]);
    setFormMonthDay(r.monthDay ?? 1);
    setFormTimeSlot(r.timeSlot ?? 'anytime');
    setFormContextId(r.contextId ?? '');
    setModalOpen(true);
  };

  const submitModal = async () => {
    const clean = formTitle.trim();
    if (!clean) return;
    if (editingId) {
      await updateRoutine(editingId, {
        title: clean,
        note: formNote,
        icon: formIcon,
        cadence: formCadence,
        weekdays: formCadence === 'weekly' ? formWeekdays : undefined,
        monthDay: formCadence === 'monthly' ? formMonthDay : undefined,
        timeSlot: formTimeSlot,
        contextId: formContextId || null,
      });
    } else {
      await createRoutine({
        title: clean,
        note: formNote,
        icon: formIcon,
        cadence: formCadence,
        weekdays: formCadence === 'weekly' ? formWeekdays : undefined,
        monthDay: formCadence === 'monthly' ? formMonthDay : undefined,
        timeSlot: formTimeSlot,
        contextId: formContextId || null,
      });
    }
    setModalOpen(false);
  };

  const confirmDelete = async (r: RoutineRec) => {
    if (await askConfirm({ title: tr('Delete this routine?'), message: tr('Its check-off history is deleted too.'), items: [r.title], confirmLabel: tr('Delete'), danger: true })) {
      void deleteRoutine(r.id);
    }
  };

  const renderRow = (r: RoutineRec) => {
    const done = isRoutineDoneForDate(r, today);
    const streak = routineStreak(r, today);
    const dots = last7DaysStatus(r, today);
    const ctxObj = r.contextId ? objMap.get(r.contextId) : undefined;
    const ctxType = ctxObj ? typeMap.get(ctxObj.typeId) : undefined;

    return (
      <div key={r.id} className={`task-row routine-row${done ? ' done' : ''}`}>
        <label className="task-check">
          <input
            type="checkbox"
            checked={done}
            onChange={() => void toggleRoutine(r.id, today)}
          />
          <span className="task-box round" />
        </label>
        <div className="task-row-main routine-main">
          <div className="task-row-text routine-title-line">
            {r.icon && <span className="routine-emoji">{r.icon}</span>}
            <span>{r.title}</span>
          </div>
          {r.note && <div className="routine-note muted small">{r.note}</div>}
          {ctxObj && (
            <button
              type="button"
              className="task-src"
              style={{ ['--type-color' as any]: ctxType?.color }}
              onClick={(e) => open(objPath(ctxObj.id), e)}
            >
              {ctxObj.icon || ctxType?.icon} {displayTitle(ctxObj, tr)}
            </button>
          )}
        </div>

        <div className="routine-meta">
          {r.timeSlot && r.timeSlot !== 'anytime' && (
            <span className="chip plain routine-slot-chip">{tr(timeSlotLabel(r.timeSlot))}</span>
          )}
          <span className="chip plain routine-cadence-chip">{formatRoutineCadence(r, tr)}</span>
          <div className="routine-dots" aria-label={tr('Last 7 days')}>
            {dots.map((d) => (
              <span key={d.iso} className={`routine-dot is-${d.state}`} title={d.iso} />
            ))}
          </div>
          {streak >= 2 && (
            <span className="routine-streak" title={tr('{count} in a row', { count: streak })}>
              <Flame size={12} /> {streak}
            </span>
          )}
          <button
            type="button"
            className="icon-btn tiny routine-row-act"
            title={tr('Edit')}
            onClick={() => openEditModal(r)}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="icon-btn tiny danger routine-row-act"
            title={tr('Delete')}
            onClick={() => confirmDelete(r)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    );
  };

  const TABS: { id: RoutineTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'today', label: tr('Today'), icon: <Sun size={14} />, badge: counts.today },
    { id: 'daily', label: tr('Daily'), icon: <Repeat size={14} /> },
    { id: 'weekly', label: tr('Weekly'), icon: <CalendarClock size={14} /> },
    { id: 'monthly', label: tr('Monthly'), icon: <Sparkles size={14} /> },
    { id: 'all', label: tr('All'), icon: <CheckCircle2 size={14} />, badge: counts.all },
  ];

  const cadenceChoices: [RoutineCadence, string][] = [
    ['daily', tr('Every day')],
    ['weekends', tr('Every weekend')],
    ['weekdays', tr('Weekdays')],
    ['weekly', tr('Every week')],
    ['monthly', tr('Every month')],
  ];

  return (
    <div className="page todos-page routines-page">
      <TaskTabs current="routines" />
      <header className="tasks-head">
        <div className="tasks-head-left">
          <span className="routines-brand-icon">
            <Repeat size={20} />
          </span>
          <div>
            <h1>{tr('Routines')}</h1>
            <p className="muted small todos-sub">{tr('Daily habits, weekend check-ins, and repeating missions.')}</p>
          </div>
        </div>
        <div className="tasks-head-right">
          {searchOpen ? (
            <label className="control tasks-search-box">
              <Search size={14} />
              <input
                autoFocus
                placeholder={tr('Filter routines…')}
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
          <button type="button" className="btn primary tasks-new-cta" onClick={openCreateModal}>
            <Plus size={15} /> {tr('New')}
          </button>
        </div>
      </header>

      {dueTodayAll.length > 0 && (
        <div className={`routine-summary${dueTodayOpenCount === 0 ? ' is-complete' : ''}`}>
          <div className="routine-summary-text">
            <strong>
              {dueTodayOpenCount === 0
                ? tr('All routines done for today!')
                : tr('{done} of {total} done today', { done: dueTodayDoneCount, total: dueTodayAll.length })}
            </strong>
            <span className="muted small">
              {dueTodayOpenCount === 0
                ? tr('Nice streak — check back tomorrow or on the weekend.')
                : tr('{count} left to check off', { count: dueTodayOpenCount })}
            </span>
          </div>
          <div className="proj-progress routine-summary-progress">
            <div className="proj-progress-bar">
              <div className="proj-progress-fill" style={{ width: `${dueTodayPct}%` }} />
            </div>
            <span className="proj-progress-label">{dueTodayPct}%</span>
          </div>
        </div>
      )}

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
            placeholder={tr('Add a routine… (e.g. Take medicine, Weekend AI finance upload)')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn small primary" disabled={!draft.trim()}>
            {tr('Add')}
          </button>
        </div>
        <div className="todo-quick-controls">
          {cadenceChoices.map(([c, label]) => (
            <button
              key={c}
              type="button"
              className={`chip plain${quickCadence === c ? ' is-picked' : ''}`}
              onClick={() => setQuickCadence(c)}
            >
              {label}
            </button>
          ))}
          {quickCadence !== 'monthly' && (
            <div className="weekday-pills" role="group" aria-label={tr('Days of week')}>
              {WEEKDAY_ORDER.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={routineDays(quickCadence, quickWeekdays).includes(d)}
                  className={`weekday-pill${routineDays(quickCadence, quickWeekdays).includes(d) ? ' active' : ''}`}
                  onClick={() => {
                    const next = pickRoutineDay(quickCadence, quickWeekdays, d);
                    setQuickCadence(next.cadence);
                    setQuickWeekdays(next.weekdays);
                  }}
                >
                  {weekdayShortLabel(d, tr)}
                </button>
              ))}
            </div>
          )}
          {quickCadence === 'monthly' && (
            <MenuSelect
              look="field"
              className="todo-quick-prio"
              label={tr('Day of month')}
              value={String(quickMonthDay)}
              onChange={(v) => setQuickMonthDay(Number(v) || 1)}
              options={monthDayOptions}
            />
          )}
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
          {todayOpen.length === 0 && todayDone.length === 0 ? (
            <div className="empty-inline center">
              <strong>{tr('No routines scheduled for today.')}</strong>
              <span>{tr('Add a daily habit like taking medicine, or a weekend check-in above.')}</span>
            </div>
          ) : (
            <>
              {todayOpen.length > 0 && (
                <section className="task-group">
                  <h3>
                    {tr('Due today')} <span className="count">{todayOpen.length}</span>
                  </h3>
                  {todayOpen.map(renderRow)}
                </section>
              )}
              {todayDone.length > 0 && (
                <section className="task-group">
                  <h3>
                    <CheckCircle2 size={14} className="muted" /> {tr('Completed today')}{' '}
                    <span className="count">{todayDone.length}</span>
                  </h3>
                  {todayDone.map(renderRow)}
                </section>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------- DAILY ---------- */}
      {tab === 'daily' && (
        <div className="tasks-section-wrap">
          {dailyList.length === 0 ? (
            <div className="empty-inline center">
              <strong>{tr('No daily routines yet.')}</strong>
              <span>{tr('Use “Every day” or “Weekdays” above for things you do every day.')}</span>
            </div>
          ) : (
            <section className="task-group">{dailyList.map(renderRow)}</section>
          )}
        </div>
      )}

      {/* ---------- WEEKLY & WEEKEND ---------- */}
      {tab === 'weekly' && (
        <div className="tasks-section-wrap">
          {weeklyList.length === 0 ? (
            <div className="empty-inline center">
              <strong>{tr('No weekly or weekend routines yet.')}</strong>
              <span>{tr('Great for weekend reviews, uploading income & expense records, or backups.')}</span>
            </div>
          ) : (
            <section className="task-group">{weeklyList.map(renderRow)}</section>
          )}
        </div>
      )}

      {/* ---------- MONTHLY ---------- */}
      {tab === 'monthly' && (
        <div className="tasks-section-wrap">
          {monthlyList.length === 0 ? (
            <div className="empty-inline center">
              <strong>{tr('No monthly routines yet.')}</strong>
              <span>{tr('Set a monthly day for recurring bills, rent, or monthly reviews.')}</span>
            </div>
          ) : (
            <section className="task-group">{monthlyList.map(renderRow)}</section>
          )}
        </div>
      )}

      {/* ---------- ALL ---------- */}
      {tab === 'all' && (
        <div className="tasks-section-wrap">
          {filtered.length === 0 ? (
            <div className="empty-inline center">
              <strong>{tr('No routines yet.')}</strong>
              <span>{tr('Create your first daily, weekend, or monthly routine above.')}</span>
            </div>
          ) : (
            [
              { key: 'daily', label: tr('Daily'), items: dailyList },
              { key: 'weekly', label: tr('Weekly & Weekend'), items: weeklyList },
              { key: 'monthly', label: tr('Monthly'), items: monthlyList },
            ]
              .filter((g) => g.items.length > 0)
              .map((g) => (
                <section key={g.key} className="task-group">
                  <h3>
                    {g.label} <span className="count">{g.items.length}</span>
                  </h3>
                  {g.items.map(renderRow)}
                </section>
              ))
          )}
        </div>
      )}

      {/* ---------- CREATE / EDIT MODAL ---------- */}
      {modalOpen && (
        <Modal
          onClose={() => setModalOpen(false)}
          className="new-task-modal routine-modal"
          label={editingId ? tr('Edit routine') : tr('New routine')}
        >
          <div className="modal-head">
            <h2>{editingId ? tr('Edit routine') : tr('New routine')}</h2>
            <button type="button" className="icon-btn" onClick={() => setModalOpen(false)}>
              <X size={18} />
            </button>
          </div>
          <form
            className="modal-body new-task-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitModal();
            }}
          >
            <div className="emoji-quick-row">
              {ROUTINE_EMOJI_CHOICES.map((em) => (
                <button
                  key={em}
                  type="button"
                  className={`emoji-pick-btn${formIcon === em ? ' active' : ''}`}
                  onClick={() => setFormIcon(formIcon === em ? null : em)}
                >
                  {em}
                </button>
              ))}
            </div>
            <input
              className="ntm-title"
              autoFocus
              placeholder={tr('Routine title (e.g. Take medicine)')}
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
            />
            <input
              className="routine-modal-note"
              placeholder={tr('Optional note (e.g. Upload income & expense screenshots to AI)')}
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
            />

            <div className="routine-modal-field">
              <span>{tr('Repeat')}</span>
              <div className="routine-cadence-picks">
                {cadenceChoices.map(([c, label]) => (
                  <button
                    key={c}
                    type="button"
                    className={`chip plain${formCadence === c ? ' is-picked' : ''}`}
                    onClick={() => setFormCadence(c)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {formCadence !== 'monthly' && (
              <div className="routine-modal-field">
                <span>{tr('Days of week')}</span>
                <div className="weekday-pills" role="group" aria-label={tr('Days of week')}>
                  {WEEKDAY_ORDER.map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={routineDays(formCadence, formWeekdays).includes(d)}
                      className={`weekday-pill${routineDays(formCadence, formWeekdays).includes(d) ? ' active' : ''}`}
                      onClick={() => {
                        const next = pickRoutineDay(formCadence, formWeekdays, d);
                        setFormCadence(next.cadence);
                        setFormWeekdays(next.weekdays);
                      }}
                    >
                      {weekdayShortLabel(d, tr)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="ntm-grid">
              {formCadence === 'monthly' && (
                <label>
                  <span>{tr('Day of month')}</span>
                  <MenuSelect
                    look="field"
                    label={tr('Day of month')}
                    value={String(formMonthDay)}
                    onChange={(v) => setFormMonthDay(Number(v) || 1)}
                    options={monthDayOptions}
                  />
                </label>
              )}
              <label>
                <span>{tr('Time of day')}</span>
                <MenuSelect<RoutineTimeSlot>
                  look="field"
                  label={tr('Time of day')}
                  value={formTimeSlot}
                  onChange={setFormTimeSlot}
                  options={[
                    { value: 'anytime', label: tr('Anytime') },
                    { value: 'morning', label: tr('Morning') },
                    { value: 'afternoon', label: tr('Afternoon') },
                    { value: 'evening', label: tr('Evening') },
                  ]}
                />
              </label>
              <label>
                <span>{tr('Linked note')}</span>
                <MenuSelect
                  look="field"
                  label={tr('Linked note')}
                  value={formContextId}
                  onChange={setFormContextId}
                  options={contextOptions}
                />
              </label>
            </div>

            <div className="modal-foot">
              <div className="spacer" />
              <button type="button" className="btn" onClick={() => setModalOpen(false)}>
                {tr('Cancel')}
              </button>
              <button type="submit" className="btn primary" disabled={!formTitle.trim()}>
                {editingId ? tr('Save') : tr('Create')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
