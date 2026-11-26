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
import { ConfirmHost } from './components/ConfirmDialog';
import { activateTabAt, closeTab, cycleTab, openTab, tabBack, tabForward, tabGo, tabPath, tabReplace, useTabs, activeTab } from './store/tabs';
import { UpdateNotice } from './components/AppInstall';
import { getOrCreateDayNote } from './db/indexers';
import { todayISO } from './lib/dates';
import { isComposing } from './lib/keyboard';
import { onOpenLocalFile, takePendingLocalFiles } from './lib/native';
import { ConnectPage } from './views/ConnectPage';
import { DesktopAuthPage } from './views/DesktopAuthPage';
import { isMobileNow, useIsMobile } from './mobile/useIsMobile';
import { MobileNav } from './mobile/MobileNav';
import { KeyboardToolbar } from './mobile/KeyboardToolbar';

/** Desktop tab shortcuts. Web browsers keep Ctrl+T/W/Tab for themselves; the desktop app gets them all. */
function tabShortcut(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase();
  if (key === 't' && !e.shiftKey) openTab();
  else if (key === 'w' && !e.shiftKey) closeTab(useTabs.getState().active);
  else if (e.key === 'Tab') cycleTab(e.shiftKey ? -1 : 1);
  else if (/^[1-9]$/.test(e.key) && !e.shiftKey && !e.altKey) activateTabAt(Number(e.key));
  else return false;
  return true;
}

export default function App() {
  const tr = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const { sidebarOpen, setSidebar, paletteOpen, setPalette, split, splitGo, splitReplace, splitBack, splitForward, typeEditor, toggleSidebar } = useUI();
  const ready = useData((s) => s.ready);
  const mobile = useIsMobile();
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

  // Desktop: the main pane has tabs, each with its own history; the URL mirrors the active tab.
  const tabsOn = !mobile;
  const currentTab = useTabs((s) => activeTab(s));
  const tabPathNow = tabPath(currentTab);
  const firstSync = useRef(true);
  useEffect(() => {
    if (!tabsOn) return;
    const first = firstSync.current;
    firstSync.current = false;
    // Something navigated the router directly (a shortcut, a file opened from Explorer, a link):
    // that page opens in the active tab. At start-up, "/" is just the app loading, so the saved tabs win.
    if (mainPath !== tabPath(activeTab()) && !(first && mainPath === '/')) tabGo(mainPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainPath, tabsOn]);
  useEffect(() => {
    // Read the store, not this render's value: the effect above may have just moved the tab.
    const target = tabPath(activeTab());
    if (tabsOn && target !== mainPath) navigate(target, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabPathNow, tabsOn]);

  const routerCtx: PaneCtx = useMemo(
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
  const tabCtx: PaneCtx = useMemo(
    () => ({
      pane: 'main',
      path: tabPathNow,
      go: tabGo,
      replace: tabReplace,
      back: tabBack,
      forward: tabForward,
      canBack: currentTab.idx > 0,
      canForward: currentTab.idx < currentTab.stack.length - 1,
    }),
    [tabPathNow, currentTab.idx, currentTab.stack.length],
  );
  const mainCtx = tabsOn ? tabCtx : routerCtx;
  const mainCtxRef = useRef(mainCtx);
  mainCtxRef.current = mainCtx;

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
        void getOrCreateDayNote(todayISO()).then(() => navigate(`/calendar?mode=day&date=${todayISO()}`));
      } else if (e.altKey && e.key === 'ArrowLeft' && !(e.target as HTMLElement)?.closest?.('.ProseMirror')) {
        mainCtxRef.current.back();
      } else if (e.altKey && e.key === 'ArrowRight' && !(e.target as HTMLElement)?.closest?.('.ProseMirror')) {
        mainCtxRef.current.forward();
      } else if (mod && !isMobileNow() && tabShortcut(e)) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, setPalette, toggleSidebar]);

  // Open local Markdown files launched from Windows Explorer ("Open with Orbit").
  useEffect(() => {
    let unlisten = () => {};
    void takePendingLocalFiles().then((files) => {
      if (files.length) navigate(`/local-file?path=${encodeURIComponent(files[files.length - 1])}`);
    });
    void onOpenLocalFile((filePath) => {
      navigate(`/local-file?path=${encodeURIComponent(filePath)}`);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten();
  }, [navigate]);

  // The approval & desktop auth bridge pages stand on their own, without the sidebar or notes.
  if (location.pathname === '/connect') return <ConnectPage />;
  if (location.pathname === '/desktop-auth') return <DesktopAuthPage />;
  if (!ready) return <div className="boot">{tr('Loading Orbit…')}</div>;

  return (
    <PaneContext.Provider value={mainCtx}>
      {/* Phones get their own layout: floating bars instead of the sidebar, and one pane at a time. */}
      <div className={`app${mobile ? ' is-mobile' : ''}${sidebarOpen && !mobile ? ' with-sidebar' : ''}${split && !mobile ? ' is-split' : ''}`}>
        {sidebarOpen && !mobile && (
          <>
            <Sidebar />
            <div className="sidebar-scrim" onClick={() => setSidebar(false)} />
          </>
        )}
        <main className="panes">
          <Pane ctx={mainCtx} />
          {splitCtx && !mobile && <Pane ctx={splitCtx} />}
        </main>
        {mobile && <MobileNav />}
        {mobile && <KeyboardToolbar />}
        {paletteOpen && <CommandPalette />}
        {typeEditor && <TypeEditorModal key={typeEditor} typeId={typeEditor} />}
        <SuggestPopup />
        <BackupBanner />
        <ConfirmHost />
        <UpdateNotice />
      </div>
    </PaneContext.Provider>
  );
}
