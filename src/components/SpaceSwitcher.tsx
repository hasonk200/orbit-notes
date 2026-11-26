import { useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, RefreshCw } from 'lucide-react';
import type { Space } from '../db/schema';
import { spaceOf } from '../lib/spaces';
import { useData, useObjMap } from '../store/dataStore';
import { useT, useUI } from '../store/uiStore';
import { useIsMobile } from '../mobile/useIsMobile';
import { BottomSheet, SheetGroup, SheetItem } from '../mobile/BottomSheet';
import { refreshFromHome, useRefresh } from '../mobile/refresh';
import { OrbitLogo } from './OrbitLogo';
import { Popover } from './Popover';

/** Open AI to-dos: how many wait for the user, and how many the AI left for itself. */
export function useAiTodoCounts() {
  const tasks = useData((s) => s.tasks);
  const objMap = useObjMap();
  return useMemo(() => {
    let confirm = 0;
    let next = 0;
    for (const t of tasks) {
      if (!t.aiTodo || t.done || !t.text.trim()) continue;
      const src = objMap.get(t.objectId);
      if (!src || src.deletedAt) continue;
      if (t.aiTodo.kind === 'confirm') confirm++;
      else next++;
    }
    return { confirm, next };
  }, [tasks, objMap]);
}

function useSpaceCounts() {
  const objects = useData((s) => s.objects);
  return useMemo(() => {
    const c = { me: 0, ai: 0 };
    for (const o of objects) if (!o.deletedAt && !o.syncConflictOf) c[spaceOf(o)]++;
    return c;
  }, [objects]);
}

/** Change space and land on its home screen. */
export function switchSpace(space: Space, mobile: boolean) {
  const ui = useUI.getState();
  if (ui.space !== space) ui.setSpace(space);
  // My space opens where the Orbit button always went; the AI workspace opens its own home.
  const home = space === 'ai' || mobile ? '/home' : '/';
  ui.mainGo?.(home);
}

export function SpaceIcon({ space, size = 20 }: { space: Space; size?: number }) {
  return space === 'ai' ? (
    <span className="space-emoji" style={{ fontSize: Math.round(size * 0.85) }} aria-hidden>
      🤖
    </span>
  ) : (
    <OrbitLogo size={size} />
  );
}

export const spaceName = (space: Space) => (space === 'ai' ? 'AI workspace' : 'My space');

function SpaceChoices({ onPick, mobile }: { onPick: (s: Space) => void; mobile: boolean }) {
  const tr = useT();
  const current = useUI((s) => s.space);
  const counts = useSpaceCounts();
  const { confirm } = useAiTodoCounts();
  const rows: { space: Space; hint: string }[] = [
    { space: 'me', hint: tr('Your own notes · {count}', { count: counts.me }) },
    { space: 'ai', hint: tr('AI logs, to-dos and documents · {count}', { count: counts.ai }) },
  ];
  if (mobile) {
    return (
      <SheetGroup>
        {rows.map((r) => (
          <SheetItem
            key={r.space}
            icon={<SpaceIcon space={r.space} size={22} />}
            label={
              <span className="space-choice-text">
                <strong>{tr(spaceName(r.space))}</strong>
                <span>{r.hint}</span>
              </span>
            }
            right={
              <span className="space-choice-right">
                {r.space === 'ai' && confirm > 0 && <span className="space-badge" title={tr('Waiting for you')}>{confirm}</span>}
                {current === r.space && <Check size={20} className="space-check" />}
              </span>
            }
            onClick={() => onPick(r.space)}
          />
        ))}
      </SheetGroup>
    );
  }
  return (
    <>
      <div className="menu-label">{tr('Switch space')}</div>
      {rows.map((r) => (
        <button key={r.space} type="button" className={`menu-item space-choice${current === r.space ? ' is-current' : ''}`} aria-pressed={current === r.space} onClick={() => onPick(r.space)}>
          <span className="space-choice-icon">
            <SpaceIcon space={r.space} size={20} />
          </span>
          <span className="space-choice-text">
            <strong>{tr(spaceName(r.space))}</strong>
            <span>{r.hint}</span>
          </span>
          {r.space === 'ai' && confirm > 0 && <span className="space-badge" title={tr('Waiting for you')}>{confirm}</span>}
          {current === r.space && <Check size={16} className="space-check" />}
        </button>
      ))}
    </>
  );
}

/**
 * The pill in the top-left corner: shows the space you are in and switches between
 * "My space" and the "AI workspace". On phones it also keeps "Refresh Orbit", which the pill used to do.
 */
export function SpaceSwitcher() {
  const tr = useT();
  const mobile = useIsMobile();
  const space = useUI((s) => s.space);
  const { confirm } = useAiTodoCounts();
  const { busy } = useRefresh();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pick = (s: Space) => {
    setOpen(false);
    switchSpace(s, mobile);
  };
  // In my space, a dot tells you the AI is waiting for you to check something.
  const waiting = space === 'me' && confirm > 0;
  const label = tr('Space: {name}. Tap to switch.', { name: tr(spaceName(space)) });

  if (mobile) {
    return (
      <div className="m-pill space-pill">
        <button type="button" onClick={() => setOpen(true)} aria-label={label} aria-haspopup="dialog" aria-busy={busy}>
          <span className={`m-brand-mark${busy ? ' is-spinning' : ''}`}>
            <SpaceIcon space={space} size={22} />
          </span>
          <span className="m-brand">{tr(spaceName(space))}</span>
          {waiting && <span className="space-dot" aria-label={tr('{count} waiting for you', { count: confirm })} />}
          <ChevronDown size={16} className="space-chevron" />
        </button>
        {open && (
          <BottomSheet onClose={() => setOpen(false)} title={tr('Switch space')} label={tr('Switch space')}>
            <SpaceChoices onPick={pick} mobile />
            <SheetGroup>
              <SheetItem
                icon={<RefreshCw size={20} />}
                label={tr('Refresh Orbit')}
                onClick={() => {
                  setOpen(false);
                  void refreshFromHome();
                }}
              />
            </SheetGroup>
          </BottomSheet>
        )}
      </div>
    );
  }

  return (
    <>
      <button ref={btn} type="button" className="brand space-brand" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} title={label}>
        <SpaceIcon space={space} size={20} />
        <span className="space-brand-name">{tr(spaceName(space))}</span>
        {waiting && <span className="space-dot" aria-label={tr('{count} waiting for you', { count: confirm })} />}
        <ChevronDown size={14} className="space-chevron" />
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} className="menu space-menu">
          <SpaceChoices onPick={pick} mobile={false} />
        </Popover>
      )}
    </>
  );
}
