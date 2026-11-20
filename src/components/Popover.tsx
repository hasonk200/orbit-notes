import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Floating panel anchored to an element (or a rect), rendered in <body>. Closes on outside click / Escape. */
export function Popover({
  anchor,
  rect,
  onClose,
  children,
  className,
  placement = 'bottom-start',
  onMouseEnter,
  onMouseLeave,
}: {
  anchor?: HTMLElement | null;
  rect?: DOMRect | null;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  placement?: 'bottom-start' | 'bottom-end';
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const r = rect ?? anchor?.getBoundingClientRect();
    const el = ref.current;
    if (!r || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = placement === 'bottom-end' ? r.right - w : r.left;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    setPos({ left, top });
  }, [anchor, rect, placement, children]);

  useEffect(() => {
    if (!onClose) return;
    const down = (e: MouseEvent) => {
      const t = e.target as globalThis.Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = window.setTimeout(() => document.addEventListener('mousedown', down), 0);
    document.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose, anchor]);

  return createPortal(
    <div
      ref={ref}
      className={`popover ${className ?? ''}`}
      style={{ left: pos.left, top: pos.top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function Modal({ onClose, children, className }: { onClose: () => void; children: ReactNode; className?: string }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className ?? ''}`}>{children}</div>
    </div>,
    document.body,
  );
}
