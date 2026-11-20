import { useT } from '../store/uiStore';
import { useEffect, useRef } from 'react';
import { useSuggest } from '../editor/suggestStore';
import { Popover } from './Popover';

export function SuggestPopup() {
  const tr = useT();
  const { open, items, index, rect, title, select } = useSuggest();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open || !rect) return null;
  let lastSection: string | undefined;
  return (
    <Popover rect={rect} className="suggest">
      <div className="suggest-list" aria-label={tr(title)} ref={listRef} onMouseDown={(e) => e.preventDefault()}>
        {items.length === 0 && <div className="suggest-empty">{tr('No matches. Keep typing…')}</div>}
        {items.map((it, i) => {
          const header = it.section && it.section !== lastSection ? it.section : null;
          lastSection = it.section;
          return (
            <div key={it.key}>
              {header && <div className="suggest-section">{tr(header)}</div>}
              <button
                type="button"
                className={`suggest-item${i === index ? ' is-active' : ''}`}
                onMouseEnter={() => useSuggest.setState({ index: i })}
                onClick={() => select?.(it)}
              >
                <span className="suggest-icon">{it.icon ?? ''}</span>
                <span className="suggest-label">{it.label}</span>
                {it.hint && <span className="suggest-hint">{it.hint}</span>}
              </button>
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
