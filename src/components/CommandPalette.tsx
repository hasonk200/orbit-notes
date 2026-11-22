import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { createObject, getOrCreateDaily } from '../db/indexers';
import { displayTitle, useData } from '../store/dataStore';
import { objPath, useOpen } from '../store/pane';
import { useT, useUI } from '../store/uiStore';
import { docText } from '../lib/content';
import { buildNoteSearch, includesText, normalizeText } from '../lib/search';
import { isComposing } from '../lib/keyboard';
import { propertyLabel, typeLabel } from '../lib/typeLabels';
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
  const lower = normalizeText(text);
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
  const tr = useT();
  const setPalette = useUI((s) => s.setPalette);
  const objects = useData((s) => s.objects);
  const types = useData((s) => s.types);
  const collections = useData((s) => s.collections);
  const open = useOpen();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => setPalette(false);

  const { search, texts, objectMap } = useMemo(() => {
    const typeMap = new Map(types.map((t) => [t.id, t]));
    const objectMap = new Map(objects.map((o) => [o.id, o]));
    const titleOf = (id: string) => displayTitle(objectMap.get(id), tr);
    const texts = new Map<string, string>();
    const docs = objects
      .filter((o) => !o.deletedAt)
      .map((o) => {
        const body = docText(o.content, titleOf);
        texts.set(o.id, body);
        const type = typeMap.get(o.typeId);
        const props = (type?.properties ?? []).flatMap((def) => {
          const value = o.props[def.key];
          const label = propertyLabel(type, def, tr);
          const formatted = formatPropValue(def, value, objectMap, type, tr);
          const original = typeof value === 'string' && def.kind !== 'relation' ? value : '';
          return [...new Set([label, def.name, formatted, original])].filter(Boolean);
        }).join(' ');
        const title = displayTitle(o, tr);
        return { id: o.id, title: title === o.title ? title : `${title} ${o.title}`, props, body, tags: o.tags.join(' ') };
      });
    return { search: buildNoteSearch(docs), texts, objectMap };
  }, [objects, types, tr]);

  const cmds = useMemo<Cmd[]>(() => {
    const typeMap = new Map(types.map((t) => [t.id, t]));
    const query = q.trim();
    const out: Cmd[] = [];
    const go = (path: string) => (alt: boolean) => {
      close();
      open(path, { altKey: alt });
    };
    if (query) {
      const res = search(query);
      for (const r of res) {
        const o = objectMap.get(r.id);
        if (!o) continue;
        const t = typeMap.get(o.typeId);
        out.push({
          key: o.id,
          icon: o.icon || t?.icon,
          label: displayTitle(o, tr),
          hint: t && typeLabel(t, tr),
          snippet: snippetAround(texts.get(o.id) ?? '', r.terms),
          section: tr('Objects'),
          run: go(objPath(o.id)),
        });
      }
      const date = parseQuickDate(query);
      if (date) {
        out.push({
          key: 'date',
          icon: '◷',
          label: dailyTitle(date, tr),
          hint: tr('Open day'),
          section: tr('Jump to'),
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
          label: tr('New {type}: “{title}”', { type: typeLabel(t, tr), title: query }),
          section: tr('Create'),
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
        out.push({ key: o.id, icon: o.icon || t?.icon, label: displayTitle(o, tr), hint: t && typeLabel(t, tr), section: tr('Recent'), run: go(objPath(o.id)) });
      }
    }
    const views: [string, string, string][] = [
      ['📅', tr('Today’s note'), 'today'],
      ['🗓️', tr('Calendar'), '/calendar'],
      ['☑', tr('Tasks'), '/tasks'],
      ['🕸', tr('Graph'), '/graph'],
      ['#', tr('Tags'), '/tags'],
      ['🧭', tr('Explore'), '/home'],
      ['🗑', tr('Trash'), '/trash'],
      ['⚙', tr('Settings'), '/settings'],
      ...types.map((t): [string, string, string] => [t.icon, tr('All {type}', { type: typeLabel(t, tr) }), `/type/${t.id}`]),
      ...collections.map((c) => {
        const t = typeMap.get(c.typeId);
        return [c.icon || '📁', `${t ? typeLabel(t, tr) + ' / ' : ''}${c.name}`, `/type/${c.typeId}?collection=${c.id}`] as [string, string, string];
      }),
    ];
    for (const [icon, label, path] of views) {
      if (query && !includesText(label, query)) continue;
      out.push({
        key: 'view-' + path,
        icon,
        label,
        section: tr('Go to'),
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
  }, [q, search, texts, objectMap, objects, types, collections, tr]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  let last = '';
  return (
    <Modal onClose={close} className="palette" label={tr('Search and commands')}>
      <div className="palette-input">
        <Search size={18} />
        <input
          autoFocus
          aria-label={tr('Search and commands')}
          placeholder={tr('Search everything, jump to a date (tomorrow, 2026-12-24), or create…')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (isComposing(e.nativeEvent)) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, Math.max(0, cmds.length - 1)));
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
        {cmds.length === 0 && <div className="muted pad">{tr('No results.')}</div>}
      </div>
      <div className="palette-foot muted small">{tr('↑↓ to move · Enter to open · Alt+Enter opens in split view')}</div>
    </Modal>
  );
}
