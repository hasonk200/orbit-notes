import { createContext, useCallback, useContext, type MouseEvent } from 'react';
import { useUI } from './uiStore';
import { openTab } from './tabs';
import { isMobileNow } from '../mobile/useIsMobile';

export interface PaneCtx {
  pane: 'main' | 'split';
  path: string;
  go: (path: string) => void;
  replace: (path: string) => void;
  back: () => void;
  forward: () => void;
  canBack: boolean;
  canForward: boolean;
}

export const PaneContext = createContext<PaneCtx>({
  pane: 'main',
  path: '/',
  go: () => {},
  replace: () => {},
  back: () => {},
  forward: () => {},
  canBack: false,
  canForward: false,
});

export const usePane = () => useContext(PaneContext);

/**
 * open(path, event?) navigates the pane the caller lives in.
 * Alt+Click (or { split: true }) opens the path in the split pane instead.
 * Ctrl/Cmd+Click opens it in a new background tab (desktop).
 */
export function useOpen() {
  const { go, pane } = usePane();
  const openSplit = useUI((s) => s.openSplit);
  const setSidebar = useUI((s) => s.setSidebar);
  return useCallback(
    (path: string, e?: MouseEvent | { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } | null, opts?: { split?: boolean }) => {
      if ((e?.ctrlKey || e?.metaKey) && !isMobileNow()) {
        openTab(path, false);
        return;
      }
      if (opts?.split || e?.altKey) {
        if (pane === 'split') go(path);
        else openSplit(path);
        return;
      }
      go(path);
      if (window.innerWidth < 820) setSidebar(false);
    },
    [go, pane, openSplit, setSidebar],
  );
}

export const objPath = (id: string) => (id.startsWith('daily-') ? `/calendar?mode=day&date=${id.slice(6)}` : `/o/${id}`);
