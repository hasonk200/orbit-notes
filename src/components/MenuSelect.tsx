import { useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover } from './Popover';

export interface MenuOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A drop-down in Orbit's own menu style, in place of the browser's built-in <select> list.
 * The whole box (icon included) opens the menu; arrow keys and Enter work inside it.
 */
export function MenuSelect<T extends string>({ value, options, onChange, icon, label, className }: { value: T; options: MenuOption<T>[]; onChange: (v: T) => void; icon?: ReactNode; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];
  const pick = (v: T) => {
    setOpen(false);
    onChange(v);
    btn.current?.focus();
  };
  const move = (e: React.KeyboardEvent) => {
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? Math.min(at + 1, items.length - 1) : Math.max(at - 1, 0);
      items[next]?.focus();
    }
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`control menu-select${open ? ' is-open' : ''} ${className ?? ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? ''}`}
        title={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
        <span className="menu-select-value">{current?.label}</span>
        <ChevronDown size={14} className="menu-select-chevron" />
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} className="menu menu-select-pop">
          <div ref={list} role="listbox" aria-label={label} onKeyDown={move}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`menu-item${o.value === value ? ' is-current' : ''}`}
                autoFocus={o.value === value}
                onClick={() => pick(o.value)}
              >
                <span className="menu-select-label">{o.label}</span>
                {o.value === value && <Check size={15} className="menu-select-check" />}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
