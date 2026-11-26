import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover } from './Popover';
import { BottomSheet, SheetGroup } from '../mobile/BottomSheet';
import { useIsMobile } from '../mobile/useIsMobile';

export interface MenuOption<T extends string> {
  value: T;
  label: string;
}

/**
 * How the closed box looks:
 * - `box`: a toolbar box with an optional icon (sort and filter on a type page).
 * - `field`: a bordered form field; the page's own class sets its size.
 * - `bare`: no border until hovered, for values shown inline (properties, fields in a note).
 */
export type MenuSelectLook = 'box' | 'field' | 'bare';

/** Typing a letter jumps to the next choice whose name starts with it; this long a pause starts a new search. */
const TYPEAHEAD_RESET_MS = 700;

/** A choice's name without a leading emoji or symbol ("📅 Today" → "today"), for type-to-jump. */
const searchable = (label: string) => label.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '');

/**
 * A drop-down in Orbit's own menu style, in place of the browser's built-in <select> list.
 * The whole box (icon included) opens the menu; arrow keys, Home/End, Enter, Escape, Tab
 * and typing a letter work as they do in a native list. On a phone the choices open in a bottom sheet.
 */
export function MenuSelect<T extends string>({
  value,
  options,
  onChange,
  icon,
  label,
  className,
  look = 'box',
  disabled,
  autoFocus,
}: {
  value: T;
  options: MenuOption<T>[];
  onChange: (v: T) => void;
  icon?: ReactNode;
  /** Names the control for screen readers and its tooltip. */
  label: string;
  className?: string;
  look?: MenuSelectLook;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The list's height: it fits below the box (scrolling if needed), and opens above only when there is no room below.
  const [maxHeight, setMaxHeight] = useState(360);
  const [minWidth, setMinWidth] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  // Where the pointer was last seen over the menu (null until it is first seen after opening).
  const pointer = useRef<string | null>(null);
  const current = options.find((o) => o.value === value) ?? options[0];
  // Phones get a bottom sheet, like every other menu there.
  const mobile = useIsMobile();

  const items = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('.menu-select-option') ?? [])];
  const focusItem = (item: HTMLButtonElement | undefined, center = false) => {
    // The list scrolls inside the popover; in a bottom sheet the whole sheet scrolls.
    const box = mobile ? list.current?.closest<HTMLElement>('.sheet') : list.current;
    if (!item || !box) return;
    item.focus({ preventScroll: true });
    // Scroll by hand: the menu may still be moving into place, so scrollIntoView could move the page.
    const top = item.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const h = item.offsetHeight;
    if (center) box.scrollTop = top - (box.clientHeight - h) / 2;
    else if (top < box.scrollTop) box.scrollTop = top;
    else if (top + h > box.scrollTop + box.clientHeight) box.scrollTop = top + h - box.clientHeight;
  };

  useEffect(() => {
    if (!open) return;
    // One frame later, so the menu is in place and a bottom sheet has done its own focusing first.
    const frame = requestAnimationFrame(() => {
      const all = items();
      focusItem(all.find((el) => el.getAttribute('aria-selected') === 'true') ?? all[0], true);
    });
    return () => cancelAnimationFrame(frame);
    // Only when the menu opens: later renders must not pull focus back to the current choice.
  }, [open]);

  useEffect(() => {
    if (autoFocus) btn.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const openMenu = () => {
    if (disabled || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    // Room left after the 6px gap, the 8px edge margin and the menu's own padding and border.
    const below = window.innerHeight - r.bottom - 30;
    setMaxHeight(Math.min(360, below >= 160 ? below : Math.max(below, r.top - 30)));
    // A form field's menu is at least as wide as the field (less the menu's padding and border).
    setMinWidth(look === 'box' ? 0 : Math.round(r.width) - 12);
    pointer.current = null;
    setOpen(true);
  };
  // Stable, so the bottom sheet does not re-run its setup on every render.
  const closeSheet = useCallback(() => setOpen(false), []);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus({ preventScroll: true });
  };
  const pick = (v: T) => {
    close(true);
    if (v !== value) onChange(v);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const all = items();
    // Before the highlight has landed on a choice, keys start from the current one.
    const focused = all.indexOf(document.activeElement as HTMLButtonElement);
    const at = focused >= 0 ? focused : all.findIndex((el) => el.getAttribute('aria-selected') === 'true');
    const go = (i: number) => {
      e.preventDefault();
      focusItem(all[Math.max(0, Math.min(i, all.length - 1))]);
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at < 0 ? all.length - 1 : at - 1);
    else if (e.key === 'Home' || e.key === 'PageUp') go(0);
    else if (e.key === 'End' || e.key === 'PageDown') go(all.length - 1);
    else if (e.key === 'Escape') {
      // Close only this menu: a popover or dialog around the box stays open.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      // Like a native list, Tab closes the menu and moves on from the box.
      close(true);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      const now = Date.now();
      const text = (now - typed.current.at > TYPEAHEAD_RESET_MS ? '' : typed.current.text) + e.key.toLowerCase();
      typed.current = { text, at: now };
      // A repeated letter steps through the choices that start with it.
      const repeat = text.length > 1 && [...text].every((c) => c === text[0]);
      const needle = repeat ? text[0] : text;
      const start = repeat || text.length === 1 ? at + 1 : Math.max(at, 0);
      const order = [...all.slice(start), ...all.slice(0, start)];
      const hit = order.find((el) => searchable(el.dataset.label ?? '').startsWith(needle));
      if (hit) {
        e.preventDefault();
        focusItem(hit);
      }
    }
  };

  const choices = (itemClass: string) =>
    options.map((o) => (
      <button
        key={o.value}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={o.value === value}
        data-label={o.label}
        title={o.label.length > 40 ? o.label : undefined}
        className={`${itemClass} menu-select-option${o.value === value ? ' is-current' : ''}`}
        onClick={() => pick(o.value)}
        // The pointer and the keyboard share one highlight, as in a native list. Only a real move
        // counts: a menu that opens under a resting pointer must not jump away from the current choice.
        onMouseMove={(e) => {
          const at = `${e.screenX},${e.screenY}`;
          const moved = pointer.current !== null && pointer.current !== at;
          pointer.current = at;
          if (moved && document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
        }}
      >
        <span className={itemClass === 'sheet-item' ? 'sheet-item-label menu-select-label' : 'menu-select-label'}>{o.label}</span>
        {o.value === value && <Check size={itemClass === 'sheet-item' ? 20 : 15} className="menu-select-check" aria-hidden="true" />}
      </button>
    ));

  const looks = look === 'box' ? 'control menu-select' : `menu-select menu-select--${look}`;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`${looks}${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? ''}`}
        title={label}
        disabled={disabled}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        {icon}
        <span className="menu-select-value">{current?.label}</span>
        {!disabled && <ChevronDown size={14} className="menu-select-chevron" aria-hidden="true" />}
      </button>
      {open &&
        (mobile ? (
          <BottomSheet onClose={closeSheet} title={label} label={label}>
            <SheetGroup>
              <div ref={list} role="listbox" aria-label={label} onKeyDown={onListKey} className="menu-select-sheet">
                {choices('sheet-item')}
              </div>
            </SheetGroup>
          </BottomSheet>
        ) : (
          <Popover anchor={btn.current} onClose={() => close(false)} className="menu menu-select-pop">
            <div ref={list} role="listbox" aria-label={label} onKeyDown={onListKey} className="menu-select-list" style={{ maxHeight, minWidth }}>
              {choices('menu-item')}
            </div>
          </Popover>
        ))}
    </>
  );
}
