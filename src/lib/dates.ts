import { addDays, format, isValid, parseISO } from 'date-fns';

export const toISODate = (d: Date) => format(d, 'yyyy-MM-dd');
export const todayISO = () => toISODate(new Date());
export const fromISODate = (s: string) => parseISO(s);

export function dailyTitle(iso: string) {
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'EEEE, MMMM d, yyyy') : iso;
}

export function shortDate(iso?: string | null) {
  if (!iso) return '';
  const d = parseISO(iso);
  if (!isValid(d)) return iso;
  const today = todayISO();
  if (iso === today) return 'Today';
  if (iso === toISODate(addDays(new Date(), 1))) return 'Tomorrow';
  if (iso === toISODate(addDays(new Date(), -1))) return 'Yesterday';
  return format(d, d.getFullYear() === new Date().getFullYear() ? 'MMM d' : 'MMM d, yyyy');
}

/** Parse quick date words: today, tomorrow, yesterday, next week, mon..sun, yyyy-mm-dd, +3 / +3d. */
export function parseQuickDate(q: string): string | null {
  const s = q.trim().toLowerCase();
  if (!s) return null;
  const now = new Date();
  if (s === 'today' || s === 'tod') return toISODate(now);
  if (s === 'tomorrow' || s === 'tom' || s === 'tmr') return toISODate(addDays(now, 1));
  if (s === 'yesterday') return toISODate(addDays(now, -1));
  if (s === 'next week' || s === 'nextweek') return toISODate(addDays(now, 7));
  const plus = s.match(/^\+(\d+)d?$/);
  if (plus) return toISODate(addDays(now, Number(plus[1])));
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const di = days.findIndex((d) => s.length >= 3 && d.startsWith(s));
  if (di >= 0) {
    let diff = (di - now.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return toISODate(addDays(now, diff));
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return isValid(dt) && dt.getMonth() === m - 1 ? toISODate(dt) : null;
  }
  return null;
}
