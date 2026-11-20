import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek, addDays } from 'date-fns';
import { fromISODate, toISODate, todayISO } from '../lib/dates';

export function MiniCalendar({ selected, onSelect, marks }: { selected: string; onSelect: (iso: string) => void; marks?: Set<string> }) {
  const [month, setMonth] = useState(() => startOfMonth(fromISODate(selected)));
  useEffect(() => {
    const d = fromISODate(selected);
    if (!isSameMonth(d, month)) setMonth(startOfMonth(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <div className="mini-cal">
      <div className="mini-cal-head">
        <button type="button" className="icon-btn round" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <div className="mini-cal-title">
          <select value={month.getMonth()} onChange={(e) => setMonth(new Date(month.getFullYear(), Number(e.target.value), 1))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i}>
                {format(new Date(2000, i, 1), 'MMMM')}
              </option>
            ))}
          </select>
          <select value={month.getFullYear()} onChange={(e) => setMonth(new Date(Number(e.target.value), month.getMonth(), 1))}>
            {Array.from({ length: 21 }, (_, i) => new Date().getFullYear() - 10 + i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="icon-btn round" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="mini-cal-grid">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <div key={d} className="mini-cal-dow">
            {d}
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
            <button key={iso} type="button" className={cls} onClick={() => onSelect(iso)}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
