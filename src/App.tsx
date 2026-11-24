import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PaneContext, type PaneCtx } from './store/pane';
import { useT, useUI } from './store/uiStore';
import { useData } from './store/dataStore';
import { Sidebar } from './components/Sidebar';
import { Pane } from './components/SplitPane';
import { CommandPalette } from './components/CommandPalette';
import { SuggestPopup } from './components/SuggestPopup';
import { TypeEditorModal } from './components/TypeEditorModal';
import { BackupBanner } from './components/BackupBanner';
import { UpdateNotice } from './components/AppInstall';
import { getOrCreateDaily } from './db/indexers';
import { todayISO } from './lib/dates';
import { isComposing } from './lib/keyboard';

export default function App() {
  const tr = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const { sidebarOpen, setSidebar, paletteOpen, setPalette, split, splitGo, splitReplace, splitBack, splitForward, typeEditor, toggleSidebar } = useUI();
  const ready = useData((s) => s.ready);
  const mainPath = location.pathname + location.search;

  // react-router keeps the history index in history.state.idx
  const idx = (window.history.state?.idx as number | undefined) ?? 0;
  const maxIdx = useRef(idx);
  if (idx > maxIdx.current) maxIdx.current = idx;
  const lastAction = useRef<'push' | 'other'>('other');
  useEffect(() => {
    if (lastAction.current === 'push') maxIdx.current = idx;
    lastAction.current = 'other';
  }, [idx]);

  const mainCtx: PaneCtx = useMemo(
    () => ({
      pane: 'main',
      path: mainPath,
      go: (p) => {
        lastAction.current = 'push';
        navigate(p);
      },
      replace: (p) => navigate(p, { replace: true }),
      back: () => navigate(-1),
      forward: () => navigate(1),
      canBack: idx > 0,
      canForward: idx < maxIdx.current,
    }),
    [mainPath, navigate, idx],
  );

  useEffect(() => {
    useUI.setState({ mainPath, mainGo: (p: string) => navigate(p) });
  }, [mainPath, navigate]);

  const splitCtx: PaneCtx | null = split
    ? {
        pane: 'split',
        path: split.stack[split.idx],
        go: splitGo,
        replace: splitReplace,
        back: splitBack,
        forward: splitForward,
        canBack: split.idx > 0,
        canForward: split.idx < split.stack.length - 1,
      }
    : null;

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isComposing(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        if (e.defaultPrevented) return; // the editor used it to add a link
        e.preventDefault();
        setPalette(!useUI.getState().paletteOpen);
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        toggleSidebar();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        void getOrCreateDaily(todayISO()).then(() => navigate(`/calendar?mode=day&date=${todayISO()}`));
      } else if (e.altKey && e.key === 'ArrowLeft' && !(e.target as HTMLElement)?.closest?.('.ProseMirror')) {
        navigate(-1);
      } else if (e.altKey && e.key === 'ArrowRight' && !(e.target as HTMLElement)?.closest?.('.ProseMirror')) {
        navigate(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, setPalette, toggleSidebar]);

  if (!ready) return <div className="boot">{tr('Loading Orbit…')}</div>;

  return (
    <PaneContext.Provider value={mainCtx}>
      <div className={`app${sidebarOpen ? ' with-sidebar' : ''}${split ? ' is-split' : ''}`}>
        {sidebarOpen && (
          <>
            <Sidebar />
            <div className="sidebar-scrim" onClick={() => setSidebar(false)} />
          </>
        )}
        <main className="panes">
          <Pane ctx={mainCtx} />
          {splitCtx && <Pane ctx={splitCtx} />}
        </main>
        {paletteOpen && <CommandPalette />}
        {typeEditor && <TypeEditorModal key={typeEditor} typeId={typeEditor} />}
        <SuggestPopup />
        <BackupBanner />
        <UpdateNotice />
      </div>
    </PaneContext.Provider>
  );
}
