import { addDays, format, formatDistanceToNow, isValid, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale/zh-TW';
import { translators, type Translate } from './i18n';

export const toISODate = (d: Date) => format(d, 'yyyy-MM-dd');
export const todayISO = () => toISODate(new Date());
export const fromISODate = (s: string) => parseISO(s);

export function dateLabel(date: Date, t: Translate, enPattern: string, zhPattern = enPattern) {
  return t.language === 'zh-Hant' ? format(date, zhPattern, { locale: zhTW }) : format(date, enPattern);
}

export function relativeTime(time: number, t: Translate) {
  return formatDistanceToNow(time, { addSuffix: true, locale: t.language === 'zh-Hant' ? zhTW : undefined });
}

export function dailyTitle(iso: string, t = translators.en) {
  const d = parseISO(iso);
  return isValid(d) ? dateLabel(d, t, 'EEEE, MMMM d, yyyy', 'yyyy年M月d日 EEEE') : iso;
}

export function shortDate(iso?: string | null, t = translators.en) {
  if (!iso) return '';
  const d = parseISO(iso);
  if (!isValid(d)) return iso;
  const today = todayISO();
  if (iso === today) return t('Today');
  if (iso === toISODate(addDays(new Date(), 1))) return t('Tomorrow');
  if (iso === toISODate(addDays(new Date(), -1))) return t('Yesterday');
  return d.getFullYear() === new Date().getFullYear() ? dateLabel(d, t, 'MMM d', 'M月d日') : dateLabel(d, t, 'MMM d, yyyy', 'yyyy年M月d日');
}

/** Accept relative date shortcuts in English and Chinese, as well as calendar dates. */
export function parseQuickDate(q: string, now = new Date()): string | null {
  const s = q.normalize('NFKC').trim().toLowerCase();
  if (!s) return null;
  if (['today', 'tod', '今天', '今日'].includes(s)) return toISODate(now);
  if (['tomorrow', 'tom', 'tmr', '明天', '聽日'].includes(s)) return toISODate(addDays(now, 1));
  if (['yesterday', '昨天', '琴日'].includes(s)) return toISODate(addDays(now, -1));
  if (['next week', 'nextweek', '下週', '下周', '下星期'].includes(s)) return toISODate(addDays(now, 7));
  const plus = s.match(/^\+(\d+)d?$/);
  if (plus) return toISODate(addDays(now, Number(plus[1])));
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const zhWeekday = s.match(/^(?:週|周|星期)([日天一二三四五六])$/)?.[1];
  const di = zhWeekday ? '日一二三四五六'.indexOf(zhWeekday === '天' ? '日' : zhWeekday) : days.findIndex((d) => s.length >= 3 && d.startsWith(s));
  if (di >= 0) {
    let diff = (di - now.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return toISODate(addDays(now, diff));
  }
  const date = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) ?? s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (date) {
    const [y, m, d] = date.slice(1).map(Number);
    const dt = new Date(y, m - 1, d);
    return isValid(dt) && dt.getMonth() === m - 1 ? toISODate(dt) : null;
  }
  return null;
}
