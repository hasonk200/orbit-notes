import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isComposing } from '../lib/keyboard';

/**
 * Lets a popover opened from inside another one (a drop-down menu in a task's popover) tell the outer
 * one about itself, so a click or Escape in the inner menu does not count as "outside" and close both.
 */
const PopoverLayer = createContext<((el: HTMLElement) => () => void) | null>(null);

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
  // Popovers opened from inside this one, at any depth.
  const inner = useRef(new Set<HTMLElement>());
  const registerWithOuter = useContext(PopoverLayer);
  const register = useCallback(
    (el: HTMLElement) => {
      inner.current.add(el);
      const unregister = registerWithOuter?.(el);
      return () => {
        inner.current.delete(el);
        unregister?.();
      };
    },
    [registerWithOuter],
  );
  useLayoutEffect(() => (ref.current && registerWithOuter ? registerWithOuter(ref.current) : undefined), [registerWithOuter]);

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
      if (ref.current?.contains(t) || anchor?.contains(t) || [...inner.current].some((el) => el.contains(t))) return;
      onClose();
    };
    // While an inner popover is open, Escape closes that one first.
    const key = (e: KeyboardEvent) => !isComposing(e) && e.key === 'Escape' && !inner.current.size && onClose();
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
      <PopoverLayer.Provider value={register}>{children}</PopoverLayer.Provider>
    </div>,
    document.body,
  );
}

export function Modal({ onClose, children, className, label }: { onClose: () => void; children: ReactNode; className?: string; label: string }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => !isComposing(e) && e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>,
    document.body,
  );
}
