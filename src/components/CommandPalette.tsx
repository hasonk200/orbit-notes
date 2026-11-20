import { useEffect, useMemo, useRef, useState } from 'react';
import MiniSearch from 'minisearch';
import { Search } from 'lucide-react';
import { createObject, getOrCreateDaily } from '../db/indexers';
import { displayTitle, useData } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useUI } from '../store/uiStore';
import { docText } from '../lib/content';
import { dailyTitle, parseQuickDate, todayISO } from '../lib/dates';
import { formatPropValue } from './PropertyPanel';
import { Modal } from './Popover';

interface Cmd {
  key: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  snippet?: string;
  section: string;
  run: (alt: boolean) => void | Promise<void>;
}

function snippetAround(text: string, terms: string[], len = 110) {
  const lower = text.toLowerCase();
  let i = -1;
  for (const t of terms) {
    i = lower.indexOf(t.toLowerCase());
    if (i >= 0) break;
  }
  if (i < 0) return text.slice(0, len);
  const start = Math.max(0, i - 30);
  return (start > 0 ? '…' : '') + text.slice(start, start + len).replace(/\s+/g, ' ') + (start + len < text.length ? '…' : '');
}

export function CommandPalette() {
  const setPalette = useUI((s) => s.setPalette);
  const objects = useData((s) => s.objects);
  const types = useData((s) => s.types);
  const collections = useData((s) => s.collections);
  const open = useOpen();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => setPalette(false);

  const { search, texts } = useMemo(() => {
    const typeMap = new Map(types.map((t) => [t.id, t]));
    const titleOf = (id: string) => displayTitle(objects.find((o) => o.id === id));
    const ms = new MiniSearch({
      fields: ['title', 'props', 'body', 'tags'],
      storeFields: ['id'],
      searchOptions: { boost: { title: 4, tags: 2, props: 1.5 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
    });
    const texts = new Map<string, string>();
    const docs = objects
      .filter((o) => !o.deletedAt)
      .map((o) => {
        const body = docText(o.content, titleOf);
        texts.set(o.id, body);
        const type = typeMap.get(o.typeId);
        const props = (type?.properties ?? []).map((d) => formatPropValue(d, o.props[d.key], objects)).join(' ');
        return { id: o.id, title: displayTitle(o), props, body, tags: o.tags.join(' ') };
      });
    ms.addAll(docs);
    return { search: ms, texts };
  }, [objects, types]);

  const cmds = useMemo<Cmd[]>(() => {
    const typeMap = new Map(types.map((t) => [t.id, t]));
    const query = q.trim();
    const out: Cmd[] = [];
    const go = (path: string) => (alt: boolean) => {
      close();
      open(path, { altKey: alt });
    };
    if (query) {
      const res = search.search(query).slice(0, 12);
      for (const r of res) {
        const o = objects.find((x) => x.id === r.id);
        if (!o) continue;
        const t = typeMap.get(o.typeId);
        out.push({
          key: o.id,
          icon: o.icon || t?.icon,
          label: displayTitle(o),
          hint: t?.name,
          snippet: snippetAround(texts.get(o.id) ?? '', r.terms),
          section: 'Objects',
          run: go(objPath(o.id)),
        });
      }
      const date = parseQuickDate(query);
      if (date) {
        out.push({
          key: 'date',
          icon: '◷',
          label: dailyTitle(date),
          hint: 'Open day',
          section: 'Jump to',
          run: async (alt) => {
            await getOrCreateDaily(date);
            go(`/calendar?mode=day&date=${date}`)(alt);
          },
        });
      }
      for (const t of types.filter((x) => x.id !== 'daily')) {
        out.push({
          key: 'new-' + t.id,
          icon: t.icon,
          label: `New ${t.name}: “${query}”`,
          section: 'Create',
          run: async (alt) => {
            const o = await createObject(t.id, { title: query });
            go(objPath(o.id))(alt);
          },
        });
      }
    } else {
      const recent = objects
        .filter((o) => !o.deletedAt)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 6);
      for (const o of recent) {
        const t = typeMap.get(o.typeId);
        out.push({ key: o.id, icon: o.icon || t?.icon, label: displayTitle(o), hint: t?.name, section: 'Recent', run: go(objPath(o.id)) });
      }
    }
    const views: [string, string, string][] = [
      ['📅', 'Today’s note', 'today'],
      ['🗓️', 'Calendar', '/calendar'],
      ['☑', 'Tasks', '/tasks'],
      ['🕸', 'Graph', '/graph'],
      ['#', 'Tags', '/tags'],
      ['🧭', 'Explore', '/home'],
      ['🗑', 'Trash', '/trash'],
      ['⚙', 'Settings', '/settings'],
      ...types.map((t) => [t.icon, `All ${t.name}s`, `/type/${t.id}`] as [string, string, string]),
      ...collections.map((c) => {
        const t = typeMap.get(c.typeId);
        return [c.icon || '📁', `${t?.name ?? ''} / ${c.name}`, `/type/${c.typeId}?collection=${c.id}`] as [string, string, string];
      }),
    ];
    const lq = query.toLowerCase();
    for (const [icon, label, path] of views) {
      if (lq && !label.toLowerCase().includes(lq)) continue;
      out.push({
        key: 'view-' + path,
        icon,
        label,
        section: 'Go to',
        run:
          path === 'today'
            ? async (alt) => {
                await getOrCreateDaily(todayISO());
                go(`/calendar?mode=day&date=${todayISO()}`)(alt);
              }
            : go(path),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, search, texts, objects, types, collections]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  let last = '';
  return (
    <Modal onClose={close} className="palette">
      <div className="palette-input">
        <Search size={18} />
        <input
          autoFocus
          placeholder="Search everything, jump to a date (tomorrow, 2026-12-24), or create…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, cmds.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              void cmds[index]?.run(e.altKey);
            }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <div className="palette-list" ref={listRef}>
        {cmds.map((c, i) => {
          const header = c.section !== last ? c.section : null;
          last = c.section;
          return (
            <div key={c.key}>
              {header && <div className="palette-section">{header}</div>}
              <button
                type="button"
                className={`palette-item${i === index ? ' is-active' : ''}`}
                onMouseMove={() => setIndex(i)}
                onClick={(e) => void c.run(e.altKey)}
              >
                <span className="palette-icon">{c.icon}</span>
                <span className="palette-main">
                  <span className="palette-label">{c.label}</span>
                  {c.snippet && <span className="palette-snippet">{c.snippet}</span>}
                </span>
                {c.hint && <span className="palette-hint">{c.hint}</span>}
              </button>
            </div>
          );
        })}
        {cmds.length === 0 && <div className="muted pad">No results.</div>}
      </div>
      <div className="palette-foot muted small">↑↓ to move · Enter to open · Alt+Enter opens in split view</div>
    </Modal>
  );
}
