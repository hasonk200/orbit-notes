import { typeLabel } from '../lib/typeLabels';
import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { displayTitle, useData, useSpaceObjects } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useT, useUI } from '../store/uiStore';

interface GNode {
  id: string;
  name: string;
  color: string;
  icon: string;
  deg: number;
  x?: number;
  y?: number;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function GraphView() {
  const tr = useT();
  const objects = useSpaceObjects();
  const types = useData((s) => s.types);
  const links = useData((s) => s.links);
  const theme = useUI((s) => s.theme);
  const open = useOpen();
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(['daily']));
  const [hideOrphans, setHideOrphans] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [colors, setColors] = useState(() => ({ text: cssVar('--text') || '#222', line: cssVar('--line-strong') || '#ccc' }));

  useEffect(() => {
    const sync = () => setColors({ text: cssVar('--text') || '#222', line: cssVar('--line-strong') || '#ccc' });
    sync();
    const raf = requestAnimationFrame(sync);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', sync);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener?.('change', sync);
    };
  }, [theme]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const built = useMemo(() => {
    const typeMap = new Map(types.map((t) => [t.id, t]));
    const visible = objects.filter((o) => !hidden.has(o.typeId));
    const ids = new Set(visible.map((o) => o.id));
    const seen = new Set<string>();
    const ls: { source: string; target: string }[] = [];
    const deg = new Map<string, number>();
    for (const l of links) {
      if (!ids.has(l.fromId) || !ids.has(l.toId)) continue;
      const k = [l.fromId, l.toId].sort().join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      ls.push({ source: l.fromId, target: l.toId });
      deg.set(l.fromId, (deg.get(l.fromId) ?? 0) + 1);
      deg.set(l.toId, (deg.get(l.toId) ?? 0) + 1);
    }
    const nodes: GNode[] = visible
      .filter((o) => !hideOrphans || deg.get(o.id))
      .map((o) => ({
        id: o.id,
        name: displayTitle(o, tr),
        color: typeMap.get(o.typeId)?.color ?? '#888',
        icon: o.icon || typeMap.get(o.typeId)?.icon || '',
        deg: deg.get(o.id) ?? 0,
      }));
    return { nodes, links: ls };
  }, [objects, types, links, hidden, hideOrphans, tr]);
  // keep the same graph object while nothing visible changed (avoids re-heating the layout on every keystroke elsewhere)
  const sig = built.nodes.map((n) => `${n.id}:${n.name}:${n.color}:${n.deg}`).join(',') + '|' + built.links.map((l) => l.source + '>' + l.target).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => built, [sig]);

  const neighbors = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const l of data.links) {
      const a = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const b = typeof l.target === 'object' ? (l.target as any).id : l.target;
      if (a === hover) s.add(b);
      if (b === hover) s.add(a);
    }
    return s;
  }, [hover, data]);

  const { text, line } = colors;

  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
  };

  return (
    <div className="graph-page">
      <div className="graph-filters">
        {types.map((t) => (
          <button key={t.id} type="button" className={`chip${hidden.has(t.id) ? ' off' : ''}`} style={{ ['--type-color' as any]: t.color }} onClick={() => toggle(t.id)}>
            <span className="dot" /> {t.icon} {typeLabel(t, tr)}
          </button>
        ))}
        <label className="chip plain">
          <input type="checkbox" checked={hideOrphans} onChange={(e) => setHideOrphans(e.target.checked)} /> {tr('Hide unlinked')}
        </label>
        <span className="muted small">
          {tr('{objects} objects · {links} links · Alt+Click opens in split view', { objects: data.nodes.length, links: data.links.length })}
        </span>
      </div>
      <div className="graph-wrap" ref={wrap}>
        {data.nodes.length === 0 ? (
          <div className="empty-inline center">
            <strong>{tr('Nothing to show yet.')}</strong>
            <span>{tr('Create objects and link them with [[ to grow your graph.')}</span>
          </div>
        ) : (
          <ForceGraph2D
            width={size.w}
            height={size.h}
            graphData={data}
            backgroundColor="rgba(0,0,0,0)"
            linkColor={(l: any) => {
              const a = typeof l.source === 'object' ? l.source.id : l.source;
              const b = typeof l.target === 'object' ? l.target.id : l.target;
              return neighbors && neighbors.has(a) && neighbors.has(b) ? text : line;
            }}
            linkWidth={1}
            cooldownTicks={120}
            onNodeHover={(n: any) => setHover(n?.id ?? null)}
            onNodeClick={(n: any, e: MouseEvent) => open(objPath(n.id), { altKey: e.altKey })}
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, scale: number) => {
              const n = node as GNode;
              const r = 4 + Math.min(10, Math.sqrt(n.deg) * 2.2);
              const dim = neighbors && !neighbors.has(n.id);
              ctx.globalAlpha = dim ? 0.2 : 1;
              ctx.beginPath();
              ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
              ctx.fillStyle = n.color;
              ctx.fill();
              if (scale > 0.9 || n.deg > 2 || hover === n.id) {
                const fs = Math.max(10 / scale, 3);
                ctx.font = `${hover === n.id ? 600 : 500} ${fs}px Inter, system-ui, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = text;
                const label = n.name.length > 28 ? n.name.slice(0, 27) + '…' : n.name;
                ctx.fillText(label, n.x!, n.y! + r + 2);
              }
              ctx.globalAlpha = 1;
            }}
            nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
              const n = node as GNode;
              const r = 6 + Math.min(10, Math.sqrt(n.deg) * 2.2);
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
              ctx.fill();
            }}
          />
        )}
      </div>
    </div>
  );
}
