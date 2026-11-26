import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { activateTab, closeTab, openTab, tabPath, useTabs, type Tab } from '../store/tabs';
import { ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, Columns2, Compass, FileText, Hash, Network, PanelLeft, Plus, Repeat, Search, Settings, SquareCheckBig, Trash, X } from 'lucide-react';
import { fileNameFromPath } from '../lib/native';
import { displayTitle, useData } from '../store/dataStore';
import { objPath, PaneContext, useOpen, usePane, type PaneCtx } from '../store/pane';
import { useT, useUI } from '../store/uiStore';
import { decodePathSegment, renderPath } from '../routes';
import { dailyTitle } from '../lib/dates';
import { aiLogTitle } from '../lib/spaces';
import { typeLabel } from '../lib/typeLabels';
import { createObject } from '../db/indexers';
import { useIsMobile } from '../mobile/useIsMobile';
import { MobileTopBar, useHeaderSlots } from '../mobile/MobileHeader';

function usePathTitle(path: string): { icon: ReactNode; title: string } {
  const tr = useT();
  const objects = useData((s) => s.objects);
  const types = useData((s) => s.types);
  const collections = useData((s) => s.collections);
  const space = useUI((s) => s.space);
  return useMemo(() => {
    const url = new URL(path, 'http://orbit.local');
    const parts = url.pathname.split('/').filter(Boolean);
    const [a, b] = parts;
    if (!a || a === 'calendar' || a === 'daily') {
      const date = url.searchParams.get('date') ?? b;
      const mode = url.searchParams.get('mode') ?? 'day';
      return { icon: <CalendarDays size={15} />, title: mode === 'day' && date ? (space === 'ai' ? aiLogTitle(date, tr) : dailyTitle(date, tr)) : tr('Diary') };
    }
    if (a === 'o') {
      const o = objects.find((x) => x.id === b);
      const t = types.find((x) => x.id === o?.typeId);
      return { icon: <span>{o?.icon || t?.icon || '📄'}</span>, title: o ? displayTitle(o, tr) : tr('Not found') };
    }
    if (a === 'type') {
      const t = types.find((x) => x.id === b);
      const colId = url.searchParams.get('collection');
      const col = colId ? collections.find((c) => c.id === colId) : null;
      const label = typeLabel(t, tr, 'Type');
      return {
        icon: <span>{col ? col.icon || '📁' : t?.icon}</span>,
        title: col ? `${label} / ${col.name}` : label,
      };
    }
    const map: Record<string, [ReactNode, string]> = {
      todos: [<CircleCheck size={15} />, tr('To-do')],
      routines: [<Repeat size={15} />, tr('Routines')],
      tasks: [<SquareCheckBig size={15} />, tr('Tasks')],
      graph: [<Network size={15} />, tr('Graph')],
      tags: [<Hash size={15} />, b ? `#${decodePathSegment(b)}` : tr('Tags')],
      trash: [<Trash size={15} />, tr('Trash')],
      settings: [<Settings size={15} />, tr('Settings')],
      home: [<Compass size={15} />, tr(space === 'ai' ? 'AI workspace home' : 'Explore')],
      'local-file': [<FileText size={15} />, url.searchParams.get('path') ? fileNameFromPath(url.searchParams.get('path')!) : tr('Local Markdown')],
    };
    const m = map[a];
    return m ? { icon: m[0], title: m[1] } : { icon: null, title: 'Orbit' };
  }, [path, objects, types, collections, tr, space]);
}

function TabItem({ tab, active, closable }: { tab: Tab; active: boolean; closable: boolean }) {
  const tr = useT();
  const { icon, title } = usePathTitle(tabPath(tab));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  return (
    <div ref={ref} className={`tab-item${active ? ' is-active' : ''}`}>
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className="tab-main"
        title={title}
        onClick={() => activateTab(tab.id)}
        onAuxClick={(e) => {
          // Middle-click closes, as in a browser.
          if (e.button === 1 && closable) {
            e.preventDefault();
            closeTab(tab.id);
          }
        }}
      >
        <span className="tab-icon">{icon}</span>
        <span className="tab-title">{title}</span>
      </button>
      {closable && (
        <button type="button" className="tab-close" onClick={() => closeTab(tab.id)} title={tr('Close tab')} aria-label={tr('Close tab')}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/** The main pane's tabs: one per open page, each with its own back/forward history. */
function TabStrip() {
  const tr = useT();
  const { tabs, active } = useTabs();
  return (
    <div className="tab-strip">
      <div className="tab-list" role="tablist" aria-label={tr('Open pages')}>
        {tabs.map((t) => (
          <TabItem key={t.id} tab={t} active={t.id === active} closable={tabs.length > 1} />
        ))}
      </div>
      <button type="button" className="icon-btn tab-new" onClick={() => openTab()} title={tr('New tab (Ctrl+T) · Ctrl+click a link to open it in a new tab')}>
        <Plus size={16} />
      </button>
    </div>
  );
}

function PaneTopBar() {
  const tr = useT();
  const ctx = usePane();
  const open = useOpen();
  const { icon, title } = usePathTitle(ctx.path);
  const { split, openSplit, closeSplit, sidebarOpen, toggleSidebar, setPalette } = useUI();
  const swap = () => {
    const s = useUI.getState().split;
    if (!s) return;
    const { mainPath, mainGo, splitReplace } = useUI.getState();
    const splitPath = s.stack[s.idx];
    splitReplace(mainPath);
    mainGo?.(splitPath);
  };
  return (
    <div className="pane-top">
      {ctx.pane === 'main' && !sidebarOpen && (
        <button type="button" className="icon-btn" onClick={toggleSidebar} title={tr('Show sidebar (Ctrl+\\)')}>
          <PanelLeft size={16} />
        </button>
      )}
      <button type="button" className="icon-btn" disabled={!ctx.canBack} onClick={ctx.back} title={tr('Back')}>
        <ChevronLeft size={17} />
      </button>
      <button type="button" className="icon-btn" disabled={!ctx.canForward} onClick={ctx.forward} title={tr('Forward')}>
        <ChevronRight size={17} />
      </button>
      {ctx.pane === 'main' ? (
        <TabStrip />
      ) : (
        <div className="pane-title">
          <span className="pane-title-icon">{icon}</span>
          <span className="pane-title-text">{title}</span>
        </div>
      )}
      <div className="pane-top-actions">
        {ctx.pane === 'main' && (
          <>
            <button type="button" className="icon-btn mobile-quick" aria-label={tr('Search')} title={tr('Search')} onClick={() => setPalette(true)}>
              <Search size={17} />
            </button>
            <button type="button" className="icon-btn mobile-quick" aria-label={tr('New note')} title={tr('New note')} onClick={async () => {
              const note = await createObject('page');
              open(objPath(note.id) + '?new=1');
            }}>
              <Plus size={18} />
            </button>
          </>
        )}
        {ctx.pane === 'main' && !split && (
          <button type="button" className="icon-btn" onClick={() => openSplit('/home')} title={tr('Open split view (or Alt+Click any link)')}>
            <Columns2 size={16} />
          </button>
        )}
        {ctx.pane === 'split' && (
          <>
            <button type="button" className="icon-btn" onClick={swap} title={tr('Swap panes')}>
              <ArrowLeftRight size={15} />
            </button>
            <button type="button" className="icon-btn" onClick={closeSplit} title={tr('Close split view')}>
              <X size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function Pane({ ctx }: { ctx: PaneCtx }) {
  const tr = useT();
  const mobile = useIsMobile();
  const { slots, refs, Provider } = useHeaderSlots();
  return (
    <PaneContext.Provider value={ctx}>
      <Provider value={mobile ? slots : { left: null, center: null, right: null }}>
        <section className={`pane pane-${ctx.pane}`}>
          {mobile ? <MobileTopBar refs={refs} /> : <PaneTopBar />}
          <div className="pane-body" key={ctx.pane + ctx.path.split('?')[0]}>
            {renderPath(ctx.path, tr)}
          </div>
        </section>
      </Provider>
    </PaneContext.Provider>
  );
}
