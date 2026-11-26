import { useEffect, useRef, type ReactNode } from 'react';
import { create } from 'zustand';
import { CircleHelp, Trash2, X } from 'lucide-react';
import { useT } from '../store/uiStore';
import { Modal } from './Popover';

/**
 * Orbit's own "Are you sure?" dialog. Use `await askConfirm({...})` instead of window.confirm():
 * the desktop app's confirm() doesn't wait for an answer, so Cancel still went ahead.
 */
export interface ConfirmOptions {
  /** The question, already translated. */
  title: string;
  /** One or two sentences on what happens, already translated. */
  message?: string;
  /** Names of what is affected, shown as chips. */
  items?: string[];
  /** The confirm button, already translated (e.g. tr('Delete')). */
  confirmLabel: string;
  /** Red button and a trash icon: for deleting or replacing things. */
  danger?: boolean;
  icon?: ReactNode;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const useConfirm = create<{ queue: Pending[] }>(() => ({ queue: [] }));

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => useConfirm.setState((s) => ({ queue: [...s.queue, { ...options, resolve }] })));
}

/** Mount once, near the app root. */
export function ConfirmHost() {
  const tr = useT();
  const current = useConfirm((s) => s.queue[0]);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (current) okRef.current?.focus();
  }, [current]);
  if (!current) return null;
  const answer = (ok: boolean) => {
    useConfirm.setState((s) => ({ queue: s.queue.slice(1) }));
    current.resolve(ok);
  };
  return (
    <Modal onClose={() => answer(false)} className="confirm-modal" label={current.title}>
      <div className="confirm-head">
        <span className={`confirm-icon${current.danger ? ' is-danger' : ''}`} aria-hidden="true">
          {current.icon ?? (current.danger ? <Trash2 size={18} /> : <CircleHelp size={18} />)}
        </span>
        <h2>{current.title}</h2>
        <button type="button" className="icon-btn" onClick={() => answer(false)} title={tr('Close')} aria-label={tr('Close')}>
          <X size={16} />
        </button>
      </div>
      {(current.message || current.items?.length) && (
        <div className="confirm-body">
          {current.message && <p>{current.message}</p>}
          {current.items?.length ? (
            <div className="confirm-items">
              {current.items.map((item, i) => (
                <span key={i} className="chip plain">
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
      <div className="confirm-foot">
        <button type="button" className="btn" onClick={() => answer(false)}>
          {tr('Cancel')}
        </button>
        <button ref={okRef} type="button" className={`btn ${current.danger ? 'danger-solid' : 'primary'}`} onClick={() => answer(true)}>
          {current.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
