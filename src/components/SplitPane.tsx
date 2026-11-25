import { useMemo, type ReactNode } from 'react';
import { ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, Columns2, Compass, Hash, Network, PanelLeft, Plus, Search, Settings, SquareCheckBig, Trash, X } from 'lucide-react';
import { displayTitle, useData } from '../store/dataStore';
import { objPath, PaneContext, useOpen, usePane, type PaneCtx } from '../store/pane';
import { useT, useUI } from '../store/uiStore';
import { decodePathSegment, renderPath } from '../routes';
import { dailyTitle } from '../lib/dates';
import { typeLabel } from '../lib/typeLabels';
import { createObject } from '../db/indexers';
import { useIsMobile } from '../mobile/useIsMobile';
import { MobileTopBar, useHeaderSlots } from '../mobile/MobileHeader';

function usePathTitle(path: string): { icon: ReactNode; title: string } {
  const tr = useT();
  const objects = useData((s) => s.objects);
  const types = useData((s) => s.types);
  const collections = useData((s) => s.collections);
  return useMemo(() => {
    const url = new URL(path, 'http://orbit.local');
    const parts = url.pathname.split('/').filter(Boolean);
    const [a, b] = parts;
    if (!a || a === 'calendar' || a === 'daily') {
      const date = url.searchParams.get('date') ?? b;
      const mode = url.searchParams.get('mode') ?? 'day';
      return { icon: <CalendarDays size={15} />, title: mode === 'day' && date ? dailyTitle(date, tr) : tr('Calendar') };
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
      tasks: [<SquareCheckBig size={15} />, tr('Tasks')],
      graph: [<Network size={15} />, tr('Graph')],
      tags: [<Hash size={15} />, b ? `#${decodePathSegment(b)}` : tr('Tags')],
      trash: [<Trash size={15} />, tr('Trash')],
      settings: [<Settings size={15} />, tr('Settings')],
      home: [<Compass size={15} />, tr('Explore')],
    };
    const m = map[a];
    return m ? { icon: m[0], title: m[1] } : { icon: null, title: 'Orbit' };
  }, [path, objects, types, collections, tr]);
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
      <div className="pane-title">
        <span className="pane-title-icon">{icon}</span>
        <span className="pane-title-text">{title}</span>
      </div>
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
