import { useRef, useState } from 'react';
import { addDays, startOfWeek } from 'date-fns';
import { dailyTitle, dateLabel, fromISODate, toISODate, todayISO } from '../lib/dates';
import { useT } from '../store/uiStore';

/**
 * One week of days across the top of the phone calendar. Tap a day to open it,
 * swipe sideways for the previous or next week. Days with a daily note get a dot.
 */
export function WeekStrip({ selected, onSelect, marks }: { selected: string; onSelect: (iso: string) => void; marks?: Set<string> }) {
  const tr = useT();
  const sel = fromISODate(selected);
  const start = startOfWeek(sel);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = todayISO();
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [from, setFrom] = useState<'left' | 'right' | null>(null);

  const shift = (dir: 1 | -1) => {
    setFrom(dir > 0 ? 'right' : 'left');
    onSelect(toISODate(addDays(sel, 7 * dir)));
  };

  return (
    <div
      key={toISODate(start)}
      className={`week-strip${from ? ' from-' + from : ''}`}
      role="group"
      aria-label={tr('Week')}
      onTouchStart={(e) => {
        touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={(e) => {
        const t = touch.current;
        touch.current = null;
        if (!t) return;
        const dx = e.changedTouches[0].clientX - t.x;
        const dy = e.changedTouches[0].clientY - t.y;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) shift(dx < 0 ? 1 : -1);
      }}
    >
      {days.map((d) => {
        const iso = toISODate(d);
        return (
          <button
            key={iso}
            type="button"
            className={`ws-day${iso === selected ? ' is-chosen' : ''}${iso === today ? ' is-today' : ''}`}
            aria-pressed={iso === selected}
            aria-label={dailyTitle(iso, tr)}
            onClick={() => onSelect(iso)}
          >
            <span className="ws-num">{d.getDate()}</span>
            <span className="ws-dow">{dateLabel(d, tr, 'EEE', 'EEEEE')}</span>
            <span className={`ws-dot${marks?.has(iso) ? ' is-on' : ''}`} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
