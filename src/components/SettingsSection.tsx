import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

const STORE = 'orbit-settings-open';

function readOpen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeOpen(id: string, open: boolean) {
  try {
    const set = new Set(readOpen());
    if (open) set.add(id);
    else set.delete(id);
    localStorage.setItem(STORE, JSON.stringify([...set]));
  } catch {
    /* private mode or blocked storage: the section just won't remember */
  }
}

/**
 * A settings card that folds: the header shows an icon, the title and a one-line summary of the
 * current state, so the page can be scanned without opening anything. It remembers which cards
 * were open, and a link to /settings#id opens and scrolls to that card.
 */
export function SettingsSection({ id, icon, tone, title, summary, children }: { id: string; icon: ReactNode; tone?: string; title: string; summary?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(() => readOpen().includes(id) || (typeof window !== 'undefined' && window.location.hash === '#' + id));
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.location.hash === '#' + id) ref.current?.scrollIntoView({ block: 'start' });
  }, [id]);

  const toggle = () => {
    setOpen((v) => {
      writeOpen(id, !v);
      return !v;
    });
  };

  return (
    <section ref={ref} id={id} className={`set-card${open ? ' is-open' : ''}`} style={tone ? { ['--set-tone' as string]: tone } : undefined}>
      <button type="button" className="set-head" aria-expanded={open} aria-controls={id + '-body'} onClick={toggle}>
        <span className="set-icon">{icon}</span>
        <span className="set-titles">
          <span className="set-title">{title}</span>
          {summary != null && <span className="set-summary">{summary}</span>}
        </span>
        <ChevronRight size={18} className="set-chevron" />
      </button>
      {/* Kept mounted while folded, so a section can load what its summary needs. */}
      <div className="set-body" id={id + '-body'} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
