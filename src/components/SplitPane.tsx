import { useMemo, type ReactNode } from 'react';
import { ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight, Columns2, Compass, Hash, Network, PanelLeft, Settings, SquareCheckBig, Trash, X } from 'lucide-react';
import { displayTitle, useData } from '../store/dataStore';
import { PaneContext, usePane, type PaneCtx } from '../store/pane';
import { useUI } from '../store/uiStore';
import { renderPath } from '../routes';
import { dailyTitle } from '../lib/dates';

function usePathTitle(path: string): { icon: ReactNode; title: string } {
  const objects = useData((s) => s.objects);
  const types = useData((s) => s.types);
  return useMemo(() => {
    const url = new URL(path, 'http://orbit.local');
    const parts = url.pathname.split('/').filter(Boolean);
    const [a, b] = parts;
    if (!a || a === 'calendar' || a === 'daily') {
      const date = url.searchParams.get('date') ?? b;
      const mode = url.searchParams.get('mode') ?? (a === 'daily' ? 'day' : 'day');
      return { icon: <CalendarDays size={15} />, title: mode === 'day' && date ? dailyTitle(date) : 'Calendar' };
    }
    if (a === 'o') {
      const o = objects.find((x) => x.id === b);
      const t = types.find((x) => x.id === o?.typeId);
      return { icon: <span>{o?.icon || t?.icon || '📄'}</span>, title: o ? displayTitle(o) : 'Not found' };
    }
    if (a === 'type') {
      const t = types.find((x) => x.id === b);
      return { icon: <span>{t?.icon}</span>, title: t?.name ?? 'Type' };
    }
    const map: Record<string, [ReactNode, string]> = {
      tasks: [<SquareCheckBig size={15} />, 'Tasks'],
      graph: [<Network size={15} />, 'Graph'],
      tags: [<Hash size={15} />, b ? `#${decodeURIComponent(b)}` : 'Tags'],
      trash: [<Trash size={15} />, 'Trash'],
      settings: [<Settings size={15} />, 'Settings'],
      home: [<Compass size={15} />, 'Explore'],
    };
    const m = map[a];
    return m ? { icon: m[0], title: m[1] } : { icon: null, title: 'Orbit' };
  }, [path, objects, types]);
}

function PaneTopBar() {
  const ctx = usePane();
  const { icon, title } = usePathTitle(ctx.path);
  const { split, openSplit, closeSplit, sidebarOpen, toggleSidebar } = useUI();
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
        <button type="button" className="icon-btn" onClick={toggleSidebar} title="Show sidebar (Ctrl+\)">
          <PanelLeft size={16} />
        </button>
      )}
      <button type="button" className="icon-btn" disabled={!ctx.canBack} onClick={ctx.back} title="Back">
        <ChevronLeft size={17} />
      </button>
      <button type="button" className="icon-btn" disabled={!ctx.canForward} onClick={ctx.forward} title="Forward">
        <ChevronRight size={17} />
      </button>
      <div className="pane-title">
        <span className="pane-title-icon">{icon}</span>
        <span className="pane-title-text">{title}</span>
      </div>
      <div className="pane-top-actions">
        {ctx.pane === 'main' && !split && (
          <button type="button" className="icon-btn" onClick={() => openSplit('/home')} title="Open split view (or Alt+Click any link)">
            <Columns2 size={16} />
          </button>
        )}
        {ctx.pane === 'split' && (
          <>
            <button type="button" className="icon-btn" onClick={swap} title="Swap panes">
              <ArrowLeftRight size={15} />
            </button>
            <button type="button" className="icon-btn" onClick={closeSplit} title="Close split view">
              <X size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function Pane({ ctx }: { ctx: PaneCtx }) {
  return (
    <PaneContext.Provider value={ctx}>
      <section className={`pane pane-${ctx.pane}`}>
        <PaneTopBar />
        <div className="pane-body" key={ctx.pane + ctx.path.split('?')[0]}>
          {renderPath(ctx.path)}
        </div>
      </section>
    </PaneContext.Provider>
  );
}
