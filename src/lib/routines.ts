import { addDays, isValid, startOfWeek, subMonths } from 'date-fns';
import { db, uid, type Space } from '../db/schema';
import { fromISODate, toISODate, todayISO } from './dates';
import { isChinese, type Translate } from './i18n';
import { spaceMark } from './spaces';
import { useUI } from '../store/uiStore';

export type RoutineCadence = 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'monthly';
export type RoutineTimeSlot = 'anytime' | 'morning' | 'afternoon' | 'evening';

export interface RoutineRec {
  id: string;
  title: string;
  note?: string;
  icon?: string | null;
  cadence: RoutineCadence;
  /** For 'weekly': 0 (Sun) .. 6 (Sat), sorted unique. */
  weekdays?: number[];
  /** For 'monthly': 1..31. */
  monthDay?: number;
  timeSlot?: RoutineTimeSlot;
  contextId?: string | null;
  space?: Space;
  /** ISO date `yyyy-MM-dd` -> completion timestamp (ms). */
  completions: Record<string, number>;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export const ROUTINE_KEY_PREFIX = 'routine-';
export const routineMetaKey = (id: string) => `${ROUTINE_KEY_PREFIX}${id}`;
export const isRoutineMetaKey = (key: unknown): key is string =>
  typeof key === 'string' && key.startsWith(ROUTINE_KEY_PREFIX);

export const ROUTINE_EMOJI_CHOICES = ['💊', '📊', '💰', '🏃', '💧', '📖', '🧹', '🧘', '🛏️', '✉️'];

const SHORT_WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六'];

export function weekdayShortLabel(dow: number, tr: Translate): string {
  const idx = ((dow % 7) + 7) % 7;
  return isChinese(tr.language) ? SHORT_WEEKDAYS_ZH[idx] : SHORT_WEEKDAYS_EN[idx];
}

export function effectiveMonthDay(year: number, monthIndex0: number, monthDay: number): number {
  const daysInMonth = new Date(year, monthIndex0 + 1, 0).getDate();
  return Math.min(Math.max(1, Math.floor(monthDay || 1)), daysInMonth);
}

/** Mon..Sun ISO dates for the week containing `iso`. */
export function weekIsoDates(iso: string): string[] {
  const d = fromISODate(iso);
  if (!isValid(d)) return [iso];
  const mon = startOfWeek(d, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => toISODate(addDays(mon, i)));
}

/** True when `iso` falls on one of the routine's scheduled calendar days. */
export function isRoutineScheduledOnDate(r: Pick<RoutineRec, 'cadence' | 'weekdays' | 'monthDay'>, iso: string): boolean {
  const d = fromISODate(iso);
  if (!isValid(d)) return false;
  const dow = d.getDay();
  switch (r.cadence) {
    case 'daily':
      return true;
    case 'weekdays':
      return dow >= 1 && dow <= 5;
    case 'weekends':
      return dow === 0 || dow === 6;
    case 'weekly': {
      const days = r.weekdays?.length ? r.weekdays : [1];
      return days.includes(dow);
    }
    case 'monthly':
      return d.getDate() === effectiveMonthDay(d.getFullYear(), d.getMonth(), r.monthDay ?? 1);
  }
}

/** True when the routine counts as completed for the period containing `iso`. */
export function isRoutineDoneForDate(r: Pick<RoutineRec, 'cadence' | 'completions'>, iso: string): boolean {
  const map = r.completions ?? {};
  if (r.cadence === 'weekends') {
    return weekIsoDates(iso).some((d) => Boolean(map[d]));
  }
  if (r.cadence === 'monthly') {
    const ym = iso.slice(0, 7);
    return Object.keys(map).some((k) => k.startsWith(ym));
  }
  return Boolean(map[iso]);
}

/**
 * True when a routine should appear on `iso`'s due list.
 * Monthly routines stay due for the rest of the month once their target day arrives until checked off.
 */
export function isRoutineDueOnDate(
  r: Pick<RoutineRec, 'cadence' | 'weekdays' | 'monthDay' | 'completions'> & { createdAt?: number },
  iso: string,
  refTodayIso = todayISO(),
): boolean {
  if (isRoutineScheduledOnDate(r, iso)) return true;
  if (r.cadence === 'monthly' && iso === refTodayIso) {
    const d = fromISODate(iso);
    if (!isValid(d)) return false;
    const target = effectiveMonthDay(d.getFullYear(), d.getMonth(), r.monthDay ?? 1);
    const scheduledIso = toISODate(new Date(d.getFullYear(), d.getMonth(), target));
    const createdIso = r.createdAt ? toISODate(new Date(r.createdAt)) : '';
    if (createdIso && scheduledIso < createdIso) return false;
    if (d.getDate() >= target && (!isRoutineDoneForDate(r, iso) || Boolean(r.completions?.[iso]))) return true;
  }
  return false;
}

/** Return a copy of `r` with its completion state for `iso` toggled. */
export function toggleRoutineForDate(r: RoutineRec, iso: string, now = Date.now()): RoutineRec {
  const next = { ...(r.completions ?? {}) };
  const wasDone = isRoutineDoneForDate(r, iso);
  if (wasDone) {
    if (r.cadence === 'weekends') {
      for (const d of weekIsoDates(iso)) delete next[d];
    } else if (r.cadence === 'monthly') {
      const ym = iso.slice(0, 7);
      for (const k of Object.keys(next)) {
        if (k.startsWith(ym)) delete next[k];
      }
    } else {
      delete next[iso];
    }
  } else {
    next[iso] = now;
    const keys = Object.keys(next);
    if (keys.length > 400) {
      const ref = fromISODate(iso);
      const cutoff = isValid(ref) ? toISODate(addDays(ref, -400)) : '';
      if (cutoff) {
        for (const k of keys) {
          if (k < cutoff) delete next[k];
        }
      }
    }
  }
  return { ...r, completions: next, updatedAt: now };
}

/** Consecutive scheduled periods completed up to `refIso`. */
export function routineStreak(
  r: Pick<RoutineRec, 'cadence' | 'weekdays' | 'monthDay' | 'completions'>,
  refIso = todayISO(),
): number {
  const ref = fromISODate(refIso);
  if (!isValid(ref)) return 0;

  if (r.cadence === 'weekends') {
    let streak = 0;
    for (let w = 0; w < 104; w++) {
      const probe = toISODate(addDays(ref, -7 * w));
      if (isRoutineDoneForDate(r, probe)) streak++;
      else if (w === 0) continue;
      else break;
    }
    return streak;
  }

  if (r.cadence === 'monthly') {
    let streak = 0;
    for (let m = 0; m < 60; m++) {
      const probe = toISODate(subMonths(ref, m));
      if (isRoutineDoneForDate(r, probe)) streak++;
      else if (m === 0) continue;
      else break;
    }
    return streak;
  }

  let streak = 0;
  for (let d = 0; d < 366; d++) {
    const iso = toISODate(addDays(ref, -d));
    if (!isRoutineScheduledOnDate(r, iso)) continue;
    if (isRoutineDoneForDate(r, iso)) streak++;
    else if (d === 0) continue;
    else break;
  }
  return streak;
}

export type RoutineDotState = 'done' | 'missed' | 'today-open' | 'off';

export function last7DaysStatus(
  r: Pick<RoutineRec, 'cadence' | 'weekdays' | 'monthDay' | 'completions'> & { createdAt?: number },
  refIso = todayISO(),
): { iso: string; state: RoutineDotState }[] {
  const ref = fromISODate(refIso);
  if (!isValid(ref)) return [];
  // Days before the routine existed weren't missed; show them as neutral.
  const createdIso = r.createdAt ? toISODate(new Date(r.createdAt)) : '';
  const out: { iso: string; state: RoutineDotState }[] = [];
  for (let offset = -6; offset <= 0; offset++) {
    const iso = toISODate(addDays(ref, offset));
    if (createdIso && iso < createdIso && !r.completions?.[iso]) {
      out.push({ iso, state: 'off' });
      continue;
    }
    const scheduled = isRoutineScheduledOnDate(r, iso);
    const doneExplicit = Boolean(r.completions?.[iso]);
    const donePeriod = isRoutineDoneForDate(r, iso);
    let state: RoutineDotState = 'off';
    if (doneExplicit || (scheduled && donePeriod)) state = 'done';
    else if (scheduled) state = iso === refIso ? 'today-open' : 'missed';
    out.push({ iso, state });
  }
  return out;
}

export function formatRoutineCadence(r: Pick<RoutineRec, 'cadence' | 'weekdays' | 'monthDay'>, tr: Translate): string {
  switch (r.cadence) {
    case 'daily':
      return tr('Every day');
    case 'weekdays':
      return tr('Weekdays');
    case 'weekends':
      return tr('Every weekend');
    case 'weekly': {
      const days = [...new Set(r.weekdays?.length ? r.weekdays : [1])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      const joined = days.map((d) => weekdayShortLabel(d, tr)).join(isChinese(tr.language) ? '、' : ', ');
      return tr('Every {days}', { days: joined });
    }
    case 'monthly':
      return tr('Monthly on day {day}', { day: r.monthDay ?? 1 });
  }
}

export const TIME_SLOT_ORDER: Record<RoutineTimeSlot, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
  anytime: 3,
};

export function sortRoutines(list: RoutineRec[]): RoutineRec[] {
  return [...list].sort(
    (a, b) =>
      a.order - b.order ||
      TIME_SLOT_ORDER[a.timeSlot ?? 'anytime'] - TIME_SLOT_ORDER[b.timeSlot ?? 'anytime'] ||
      a.createdAt - b.createdAt,
  );
}

export async function createRoutine(input: {
  title: string;
  note?: string;
  icon?: string | null;
  cadence: RoutineCadence;
  weekdays?: number[];
  monthDay?: number;
  timeSlot?: RoutineTimeSlot;
  contextId?: string | null;
  space?: Space;
}): Promise<RoutineRec | null> {
  const title = input.title.trim();
  if (!title) return null;
  const existing = await db.meta.where('key').startsWith(ROUTINE_KEY_PREFIX).toArray();
  const now = Date.now();
  const space = input.space ?? useUI.getState().space;
  const rec: RoutineRec = {
    id: uid(),
    title,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.icon ? { icon: input.icon } : {}),
    cadence: input.cadence,
    ...(input.cadence === 'weekly'
      ? { weekdays: [...new Set(input.weekdays?.length ? input.weekdays : [1])].sort((a, b) => a - b) }
      : {}),
    ...(input.cadence === 'monthly'
      ? { monthDay: Math.min(31, Math.max(1, Math.floor(input.monthDay ?? 1))) }
      : {}),
    timeSlot: input.timeSlot ?? 'anytime',
    contextId: input.contextId || null,
    ...spaceMark(space),
    completions: {},
    order: existing.length,
    createdAt: now,
    updatedAt: now,
  };
  if (rec.space !== 'ai') delete rec.space;
  await db.meta.put({ key: routineMetaKey(rec.id), value: rec });
  return rec;
}

export async function updateRoutine(
  id: string,
  patch: Partial<Omit<RoutineRec, 'id' | 'createdAt'>>,
): Promise<RoutineRec | null> {
  const key = routineMetaKey(id);
  const row = await db.meta.get(key);
  const cur = row?.value as RoutineRec | undefined;
  if (!cur) return null;
  const next: RoutineRec = {
    ...cur,
    ...patch,
    id: cur.id,
    createdAt: cur.createdAt,
    updatedAt: Math.max(Date.now(), cur.updatedAt + 1),
  };
  if (next.cadence !== 'weekly') delete next.weekdays;
  else next.weekdays = [...new Set(next.weekdays?.length ? next.weekdays : [1])].sort((a, b) => a - b);
  if (next.cadence !== 'monthly') delete next.monthDay;
  else next.monthDay = Math.min(31, Math.max(1, Math.floor(next.monthDay ?? 1)));
  if (!next.note?.trim()) delete next.note;
  else next.note = next.note.trim();
  if (!next.icon) delete next.icon;
  if (next.space !== 'ai') delete next.space;
  await db.meta.put({ key, value: next });
  return next;
}

export async function toggleRoutine(id: string, iso = todayISO()): Promise<RoutineRec | null> {
  const key = routineMetaKey(id);
  const row = await db.meta.get(key);
  const cur = row?.value as RoutineRec | undefined;
  if (!cur) return null;
  const now = Math.max(Date.now(), cur.updatedAt + 1);
  const next = toggleRoutineForDate(cur, iso, now);
  await db.meta.put({ key, value: next });
  return next;
}

export async function deleteRoutine(id: string) {
  await db.meta.delete(routineMetaKey(id));
}

/** The weekdays (0 = Sun) a cadence repeats on, for the day picker. Monthly routines have none. */
export function routineDays(cadence: RoutineCadence, weekdays?: number[]): number[] {
  switch (cadence) {
    case 'daily':
      return [0, 1, 2, 3, 4, 5, 6];
    case 'weekdays':
      return [1, 2, 3, 4, 5];
    case 'weekends':
      return [0, 6];
    case 'weekly':
      return weekdays?.length ? [...weekdays].sort((a, b) => a - b) : [1];
    case 'monthly':
      return [];
  }
}

/**
 * Tapping a day in the picker: switch that day on or off and pick the cadence that means exactly those days.
 * At least one day stays on. "Weekends" (done once per weekend) is never chosen this way: picking Sat and Sun means both days.
 */
export function pickRoutineDay(cadence: RoutineCadence, weekdays: number[] | undefined, day: number): { cadence: RoutineCadence; weekdays: number[] } {
  const current = cadence === 'monthly' ? [] : routineDays(cadence, weekdays);
  const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b);
  if (!next.length) return { cadence, weekdays: current };
  if (next.length === 7) return { cadence: 'daily', weekdays: next };
  if (next.join() === '1,2,3,4,5') return { cadence: 'weekdays', weekdays: next };
  return { cadence: 'weekly', weekdays: next };
}
