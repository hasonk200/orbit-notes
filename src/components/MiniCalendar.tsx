import { useT } from '../store/uiStore';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, endOfMonth, endOfWeek, isSameMonth, startOfMonth, startOfWeek, addDays } from 'date-fns';
import { dailyTitle, dateLabel, fromISODate, toISODate, todayISO } from '../lib/dates';

export function MiniCalendar({ selected, onSelect, marks }: { selected: string; onSelect: (iso: string) => void; marks?: Set<string> }) {
  const tr = useT();
  const [month, setMonth] = useState(() => startOfMonth(fromISODate(selected)));
  useEffect(() => {
    setMonth((current) => {
      const d = fromISODate(selected);
      return isSameMonth(d, current) ? current : startOfMonth(d);
    });
  }, [selected]);

  const days = useMemo(() => {
    const out: Date[] = [];
    const start = startOfWeek(startOfMonth(month));
    const end = endOfWeek(endOfMonth(month));
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    while (out.length < 42) out.push(addDays(out[out.length - 1], 1));
    return out;
  }, [month]);
  const today = todayISO();
  const baseYear = new Date().getFullYear();
  const shownYear = month.getFullYear();
  const years = [...new Set([...Array.from({ length: 21 }, (_, i) => baseYear - 10 + i), shownYear])].sort((a, b) => a - b);

  return (
    <div className="mini-cal">
      <div className="mini-cal-head">
        <button type="button" className="icon-btn round" onClick={() => setMonth(addMonths(month, -1))} aria-label={tr('Previous month')}>
          <ChevronLeft size={16} />
        </button>
        <div className="mini-cal-title">
          <select aria-label={tr('Month')} value={month.getMonth()} onChange={(e) => setMonth(new Date(month.getFullYear(), Number(e.target.value), 1))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i}>
                {dateLabel(new Date(2000, i, 1), tr, 'MMMM', 'M月')}
              </option>
            ))}
          </select>
          <select aria-label={tr('Year')} value={shownYear} onChange={(e) => setMonth(new Date(Number(e.target.value), month.getMonth(), 1))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="icon-btn round" onClick={() => setMonth(addMonths(month, 1))} aria-label={tr('Next month')}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="mini-cal-grid">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d, i) => (
          <div key={d} className="mini-cal-dow">
            {tr.language === 'zh-Hant' ? dateLabel(new Date(2024, 0, 7 + i), tr, 'EEEEEE') : d}
          </div>
        ))}
        {days.map((d) => {
          const iso = toISODate(d);
          const cls = [
            'mini-cal-day',
            isSameMonth(d, month) ? '' : 'other',
            iso === today ? 'today' : '',
            iso === selected ? 'selected' : '',
            marks?.has(iso) ? 'marked' : '',
          ].join(' ');
          return (
            <button key={iso} type="button" className={cls} aria-label={dailyTitle(iso, tr)} aria-current={iso === today ? 'date' : undefined} onClick={() => onSelect(iso)}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
