import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { isComposing } from '../lib/keyboard';
import { useInsidePopover } from '../components/Popover';

/**
 * A sheet that slides up from the bottom of a phone screen.
 * Closes on the backdrop, Escape, or a downward drag of the handle area.
 */
export function BottomSheet({ onClose, title, children, label }: { onClose: () => void; title?: ReactNode; children: ReactNode; label: string }) {
  const sheet = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  useInsidePopover(backdrop);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => !isComposing(e) && e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    const previous = document.activeElement as HTMLElement | null;
    sheet.current?.focus();
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  const onTouchStart = (e: React.TouchEvent) => {
    // Only start a drag from the top of the sheet, so lists inside can still scroll.
    if ((sheet.current?.scrollTop ?? 0) > 0) return;
    start.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (start.current == null) return;
    setDrag(Math.max(0, e.touches[0].clientY - start.current));
  };
  const onTouchEnd = () => {
    if (start.current == null) return;
    start.current = null;
    if (drag > 90) onClose();
    else setDrag(0);
  };

  return createPortal(
    <div ref={backdrop} className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onTouchEnd={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={sheet}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="sheet-handle" aria-hidden="true" />
        {title && <h2 className="sheet-title">{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A rounded card grouping related sheet actions. */
export function SheetGroup({ children }: { children: ReactNode }) {
  return <div className="sheet-group">{children}</div>;
}

export function SheetItem({
  icon,
  label,
  onClick,
  danger,
  chevron,
  right,
  disabled,
}: {
  icon: ReactNode;
  label: ReactNode;
  onClick: () => void;
  danger?: boolean;
  chevron?: boolean;
  right?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button type="button" className={`sheet-item${danger ? ' danger' : ''}`} onClick={onClick} disabled={disabled}>
      <span className="sheet-item-icon">{icon}</span>
      <span className="sheet-item-label">{label}</span>
      {right}
      {chevron && <ChevronRight size={18} className="sheet-item-chevron" />}
    </button>
  );
}

/** One "⋯" action shown in a page's sheet. Groups are separated into cards. */
export interface MenuAction {
  key: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  group?: number;
}

export function ActionSheet({ actions, onClose, label }: { actions: MenuAction[]; onClose: () => void; label: string }) {
  const groups = new Map<number, MenuAction[]>();
  for (const a of actions) groups.set(a.group ?? 0, [...(groups.get(a.group ?? 0) ?? []), a]);
  return (
    <BottomSheet onClose={onClose} label={label}>
      {[...groups.entries()]
        .sort(([a], [b]) => a - b)
        .map(([g, items]) => (
          <SheetGroup key={g}>
            {items.map((a) => (
              <SheetItem
                key={a.key}
                icon={a.icon}
                label={a.label}
                danger={a.danger}
                onClick={() => {
                  onClose();
                  a.onClick();
                }}
              />
            ))}
          </SheetGroup>
        ))}
    </BottomSheet>
  );
}
