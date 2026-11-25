import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, MoreHorizontal } from 'lucide-react';
import { usePane } from '../store/pane';
import { useT } from '../store/uiStore';
import { ActionSheet, type MenuAction } from './BottomSheet';

/**
 * The phone layout has no top toolbar. Each screen floats a back button on the left and,
 * if it has one, a "⋯" button on the right; a screen can also put a control in the middle
 * (like the calendar's Daily note / Created / Due switch). Screens fill these spots with
 * <MobileHeader>, which portals into the bar that the pane renders.
 */

interface Slots {
  left: HTMLElement | null;
  center: HTMLElement | null;
  right: HTMLElement | null;
}

const SlotContext = createContext<Slots>({ left: null, center: null, right: null });

type SlotRefs = Record<keyof Slots, (el: HTMLElement | null) => void>;

export function useHeaderSlots() {
  const [slots, setSlots] = useState<Slots>({ left: null, center: null, right: null });
  // Stable ref callbacks: a new function each render would detach and reattach the slots every time.
  const refs = useMemo<SlotRefs>(() => {
    const bind = (name: keyof Slots) => (el: HTMLElement | null) => setSlots((s) => (s[name] === el ? s : { ...s, [name]: el }));
    return { left: bind('left'), center: bind('center'), right: bind('right') };
  }, []);
  return { slots, refs, Provider: SlotContext.Provider };
}

/** The floating bar itself, rendered by the pane on phones. */
export function MobileTopBar({ refs }: { refs: SlotRefs }) {
  const tr = useT();
  const pane = usePane();
  // Home is the top of the phone app, so it has nothing to go back to.
  const isHome = new URL(pane.path, 'http://orbit.local').pathname === '/home';
  return (
    <div className="m-top">
      <div className="m-top-side" ref={refs.left}>
        {pane.canBack && !isHome && (
          <button type="button" className="m-circle" onClick={pane.back} aria-label={tr('Back')}>
            <ChevronLeft size={22} />
          </button>
        )}
      </div>
      <div className="m-top-center" ref={refs.center} />
      <div className="m-top-side is-right" ref={refs.right} />
    </div>
  );
}

/** Fill the floating bar from inside a screen. Renders nothing on desktop (the slots are absent). */
export function MobileHeader({ left, center, right, actions, menuLabel }: { left?: ReactNode; center?: ReactNode; right?: ReactNode; actions?: MenuAction[]; menuLabel?: string }) {
  const slots = useContext(SlotContext);
  const tr = useT();
  const [menu, setMenu] = useState(false);
  return (
    <>
      {left && slots.left && createPortal(left, slots.left)}
      {center && slots.center && createPortal(center, slots.center)}
      {right && slots.right && createPortal(right, slots.right)}
      {actions && actions.length > 0 && slots.right &&
        createPortal(
          <button type="button" className="m-circle" aria-label={menuLabel ?? tr('More actions')} aria-haspopup="dialog" onClick={() => setMenu(true)}>
            <MoreHorizontal size={22} />
          </button>,
          slots.right,
        )}
      {menu && actions && <ActionSheet actions={actions} label={menuLabel ?? tr('More actions')} onClose={() => setMenu(false)} />}
    </>
  );
}

/** A pill of two to four choices, for the middle of the bar (icon above a short label). */
export function MobileSegmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; icon: ReactNode; label: string; count?: number }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="m-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          <span className="m-seg-icon">
            {o.icon}
            {o.count ? <span className="m-seg-count">{o.count > 99 ? '99+' : o.count}</span> : null}
          </span>
          <span className="m-seg-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
