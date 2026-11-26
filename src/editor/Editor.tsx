import { useT } from '../store/uiStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, Extension, InputRule, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import { OrbitTaskItem } from './extensions/TaskItem';
import { OutlinerListItem } from './extensions/OutlinerListItem';
import { Callout } from './extensions/Callout';
import { Toggle } from './extensions/Toggle';
import {
  BlockGroup,
  clearMarqueeTargets,
  collectSelectableTargets,
  deleteMarqueeTargets,
  duplicateMarqueeTargets,
  findEnclosingBlockGroup,
  getMarqueeTargets,
  setMarqueeTargets,
  spansMultipleBlocks,
  unwrapBlockGroupAt,
  wrapMarqueeTargets,
  type SelectableTarget,
} from './extensions/BlockGroup';
import { ObjectLink } from './extensions/ObjectLink';
import { Tag } from './extensions/TagSuggest';
import { DateRef } from './extensions/DateRef';
import { Outliner, zoomTo, zoomTrail, type ZoomCrumb } from './extensions/Outliner';
import { LiveSearch } from './extensions/LiveSearch';
import { onJump, takeJump } from './jump';
import { editorBlurred, editorFocused } from '../mobile/activeEditor';
import { posAtPath } from '../lib/supertags';
import { TextSelection } from '@tiptap/pm/state';
import { BlobImage } from './extensions/BlobImage';
import { SlashMenu } from './SlashMenu';
import { BlockDragHandle } from './BlockDragHandle';
import type { JSONContent, Obj } from '../db/schema';
import { saveObject } from '../db/indexers';
import { registerDraft } from '../db/drafts';
import { isAllowedLinkUrl, looksLikeMarkdown, MARKDOWN_LINK_INPUT_RE, markdownToBlocks, repairLooseBoldInDoc } from '../lib/markdown';
import { openLocalFile } from '../lib/native';
import { Plugin } from '@tiptap/pm/state';
import { Copy, Layers, Trash, Ungroup, X } from 'lucide-react';

/** Ctrl/Cmd+K on selected text (or inside a link) opens the link box; otherwise the key falls through to search. */
const LinkShortcut = Extension.create<{ open: () => boolean }>({
  name: 'linkShortcut',
  addOptions: () => ({ open: () => false }),
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        if (!this.editor.isEditable) return false;
        if (this.editor.state.selection.empty && !this.editor.isActive('link')) return false;
        return this.options.open();
      },
    };
  },
});

/** Pasting Markdown (from a .md file, Notepad, an AI chat…) keeps its headings, lists, to-dos and links. */
const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste: (view, event) => {
            const data = event.clipboardData;
            const text = data?.getData('text/plain') ?? '';
            if (!text || view.state.selection.$from.parent.type.spec.code) return false;
            // Rich text copied from Orbit (data-pm-slice) or structured HTML already has its structure.
            const html = data?.getData('text/html') ?? '';
            if (html && (/data-pm-slice=/i.test(html) || /<(h[1-6]|ul|ol|li|table|blockquote|pre)\b/i.test(html))) return false;
            if (!looksLikeMarkdown(text)) return false;
            const blocks = markdownToBlocks(text);
            if (!blocks.length) return false;
            try {
              return editor.chain().focus().insertContent(blocks).scrollIntoView().run();
            } catch {
              return false;
            }
          },
        },
      }),
    ];
  },
});

/** Typing `[label](url) ` turns into a clickable link mark right away when the scheme is allowlisted. */
const MarkdownLinkInput = Extension.create({
  name: 'markdownLinkInput',
  addInputRules() {
    return [
      new InputRule({
        find: MARKDOWN_LINK_INPUT_RE,
        handler: ({ state, range, match }) => {
          const [, label, href] = match;
          const linkType = state.schema.marks.link;
          if (!label || !href || !linkType || !isAllowedLinkUrl(href)) return null;
          if (state.selection.$from.parent.type.spec.code) return null;
          const codeMark = state.schema.marks.code;
          if (codeMark && codeMark.isInSet(state.selection.$from.marks())) return null;
          state.tr
            .replaceWith(range.from, range.to, [
              state.schema.text(label, [linkType.create({ href })]),
              state.schema.text(' '),
            ])
            .removeStoredMark(linkType);
        },
      }),
    ];
  },
});

/**
 * Typing `** text **` with accidental inner spaces still turns into bold text cleanly,
 * and pasting HTML that kept literal `** ... **` markers is repaired automatically.
 */
const LOOSE_BOLD_INPUT_RE = /(?<!\*)\*\*([ \t]+[^\n*]+?|[^\n*]+?[ \t]+)\*\*\s$/;

const LooseBoldInput = Extension.create({
  name: 'looseBoldInput',
  addInputRules() {
    return [
      new InputRule({
        find: LOOSE_BOLD_INPUT_RE,
        handler: ({ state, range, match }) => {
          const inner = match[1];
          const trimmed = inner.trim();
          const boldType = state.schema.marks.bold;
          if (!trimmed || !boldType) return null;
          if (state.selection.$from.parent.type.spec.code) return null;
          const codeMark = state.schema.marks.code;
          if (codeMark && codeMark.isInSet(state.selection.$from.marks())) return null;
          const beforeChar = range.from > 0 ? state.doc.textBetween(range.from - 1, range.from) : '';
          const leadSpace = /^[ \t]/.test(inner) && beforeChar && !/\s/.test(beforeChar) ? ' ' : '';
          const nodes = [
            ...(leadSpace ? [state.schema.text(leadSpace)] : []),
            state.schema.text(trimmed, [boldType.create()]),
            state.schema.text(' '),
          ];
          state.tr.replaceWith(range.from, range.to, nodes).removeStoredMark(boldType);
        },
      }),
    ];
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((t) => t.docChanged && (t.getMeta('paste') || t.getMeta('uiEvent') === 'paste'))) {
            return null;
          }
          const repaired = repairLooseBoldInDoc(newState.doc.toJSON() as JSONContent);
          if (!repaired) return null;
          try {
            const docNode = editor.schema.nodeFromJSON(repaired);
            return newState.tr.replaceWith(0, newState.doc.content.size, docNode.content);
          } catch {
            return null;
          }
        },
      }),
    ];
  },
});

function buildExtensions(getPlaceholder: (heading: boolean) => string, openLinkBox: () => boolean) {
  return [
    StarterKit.configure({
      listItem: false,
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: true,
        autolink: true,
        protocols: ['file'],
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      },
    }),
    LinkShortcut.configure({ open: openLinkBox }),
    MarkdownPaste,
    MarkdownLinkInput,
    LooseBoldInput,
    Outliner,
    LiveSearch,
    OutlinerListItem,
    Placeholder.configure({
      placeholder: ({ node }) => getPlaceholder(node.type.name === 'heading'),
      showOnlyCurrent: true,
    }),
    TaskList,
    OrbitTaskItem,
    Callout,
    Toggle,
    BlockGroup,
    TableKit.configure({
      table: { resizable: true, renderWrapper: true },
    }),
    ObjectLink,
    Tag,
    DateRef,
    BlobImage,
    SlashMenu,
  ];
}

function TableToolbar({ editor }: { editor: Editor }) {
  const tr = useT();
  return (
    <div className="table-bar" contentEditable={false}>
      <span className="table-bar-label">{tr('Table')}</span>
      <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()}>
        {tr('+ Row')}
      </button>
      <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()}>
        {tr('+ Col')}
      </button>
      <button type="button" onClick={() => editor.chain().focus().deleteRow().run()}>
        {tr('− Row')}
      </button>
      <button type="button" onClick={() => editor.chain().focus().deleteColumn().run()}>
        {tr('− Col')}
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
        {tr('Header')}
      </button>
      <button type="button" className="danger" onClick={() => editor.chain().focus().deleteTable().run()}>
        {tr('Delete')}
      </button>
    </div>
  );
}

/** Turns what people type into a link: Windows paths become file:/// links, bare domains get https://. */
export function normalizeLinkInput(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (/^[a-z]:[\\/]/i.test(s)) return 'file:///' + encodeURI(s.replace(/\\/g, '/')).replace(/#/g, '%23');
  if (/^\\\\/.test(s)) return 'file:' + encodeURI(s.replace(/\\/g, '/'));
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('/') || s.startsWith('#')) return s;
  return 'https://' + s;
}

function LinkBox({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const tr = useT();
  const existing = (editor.getAttributes('link').href as string | undefined) ?? '';
  const [url, setUrl] = useState(existing);
  const [error, setError] = useState(false);
  const [pos] = useState(() => {
    const c = editor.view.coordsAtPos(editor.state.selection.to);
    const left = Math.max(8, Math.min(c.left, window.innerWidth - 340));
    // Open above the text when there is no room below it.
    return c.bottom + 150 > window.innerHeight
      ? { bottom: window.innerHeight - c.top + 6, left }
      : { top: c.bottom + 6, left };
  });
  const close = () => {
    onClose();
    editor.commands.focus();
  };
  const apply = () => {
    const href = normalizeLinkInput(url);
    const chain = editor.chain().focus().extendMarkRange('link');
    const ok = href ? chain.setLink({ href }).run() : chain.unsetLink().run();
    if (!ok) return setError(true);
    onClose();
  };
  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onClose();
  };
  const isFile = /^file:/i.test(normalizeLinkInput(url));
  return (
    <div
      className="link-box"
      style={pos}
      onMouseDown={(e) => { if (e.target !== e.currentTarget && (e.target as HTMLElement).tagName === 'BUTTON') e.preventDefault(); }}
    >
      <input
        autoFocus
        value={url}
        placeholder={tr('Paste or type a link, then press Enter')}
        onChange={(e) => { setUrl(e.target.value); setError(false); }}
        onBlur={onClose}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') { e.preventDefault(); apply(); }
          else if (e.key === 'Escape') { e.preventDefault(); close(); }
        }}
      />
      <div className="link-box-row">
        <button type="button" className="primary" onClick={apply}>{tr('Apply')}</button>
        {existing && <button type="button" onClick={remove}>{tr('Remove link')}</button>}
      </div>
      {error && <p className="link-box-note danger">{tr('That link can’t be used.')}</p>}
      {!error && isFile && <p className="link-box-note">{tr('Browsers block computer file links from web pages. Clicking this link copies it, so you can paste it into the address bar.')}</p>}
    </div>
  );
}

interface OutlineItem { pos: number; level: number; text: string }

function readOutline(editor: Editor): OutlineItem[] {
  const items: OutlineItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim();
      if (text) items.push({ pos, level: node.attrs.level as number, text });
      return false;
    }
    return true;
  });
  return items;
}

function Outline({ editor, items }: { editor: Editor; items: OutlineItem[] }) {
  const tr = useT();
  const [open, setOpen] = useState(true);
  const jump = (pos: number) => {
    const dom = editor.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return;
    editor.chain().setTextSelection(pos + 1).focus(undefined, { scrollIntoView: false }).run();
    dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
    dom.classList.remove('outline-flash');
    void dom.offsetWidth;
    dom.classList.add('outline-flash');
    window.setTimeout(() => dom.classList.remove('outline-flash'), 1400);
  };
  return (
    <nav className="note-outline" contentEditable={false} aria-label={tr('Contents')}>
      <button type="button" className="note-outline-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="note-outline-caret">{open ? '▾' : '▸'}</span> {tr('Contents')} <span className="muted">{items.length}</span>
      </button>
      {open && (
        <ul>
          {items.map((h) => (
            <li key={h.pos} className={`lvl-${h.level}`}>
              <button type="button" onClick={() => jump(h.pos)}>{h.text}</button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

function ZoomBar({ editor, trail }: { editor: Editor; trail: ZoomCrumb[] }) {
  const tr = useT();
  return (
    <nav className="zoom-bar" contentEditable={false} aria-label={tr('Zoomed in')}>
      <button type="button" onClick={() => zoomTo(editor, null)} title={tr('Show the whole note (Ctrl+[)')}>
        {tr('Whole note')}
      </button>
      {trail.map((c, i) => (
        <span key={c.pos} className="zoom-crumb">
          <span className="zoom-sep">›</span>
          {i < trail.length - 1 ? (
            <button type="button" onClick={() => zoomTo(editor, c.pos)}>{c.text || tr('Untitled')}</button>
          ) : (
            <strong>{c.text || tr('Untitled')}</strong>
          )}
        </span>
      ))}
    </nav>
  );
}

interface RichEditorProps {
  docKey: string;
  content: JSONContent;
  onChange: (json: JSONContent) => void;
  placeholder?: string;
  editable?: boolean;
  autofocus?: boolean;
  className?: string;
  showGutter?: boolean;
  /** List the note's headings above it so a click jumps to each one. */
  showOutline?: boolean;
  onReady?: (e: Editor) => void;
}

/** Generic editor. Re-created when docKey changes. */
export function RichEditor({
  docKey,
  content,
  onChange,
  placeholder,
  editable = true,
  autofocus,
  className,
  showGutter = true,
  showOutline = false,
  onReady,
}: RichEditorProps) {
  const tr = useT();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const emptyText = placeholder ?? tr('Write something, or type / for commands, [[ to link, # to tag, @ for dates');
  const headingText = tr('Heading');
  const placeholderText = useRef({ emptyText, headingText });
  placeholderText.current = { emptyText, headingText };
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inTable, setInTable] = useState(false);
  const [linkBoxOpen, setLinkBoxOpen] = useState(false);
  const [selBar, setSelBar] = useState<{ top: number; left: number; inGroup: boolean } | null>(null);
  const [marqueeBox, setMarqueeBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [marqueeBar, setMarqueeBar] = useState<{ top: number; left: number; targets: SelectableTarget[]; singleGroupPos: number | null } | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [trail, setTrail] = useState<ZoomCrumb[]>([]);
  const trailKey = useRef('[]');
  const syncTrail = (ed: Editor) => {
    const next = zoomTrail(ed.state);
    const key = JSON.stringify(next);
    if (key === trailKey.current) return;
    trailKey.current = key;
    setTrail(next);
  };
  const syncMarqueeBar = useCallback((ed: Editor, draggingNow = false) => {
    const targets = getMarqueeTargets(ed.state);
    if (!editable || draggingNow || !targets.length || ed.isDestroyed) {
      setMarqueeBar(null);
      return;
    }
    const wrap = wrapRef.current;
    if (!wrap) return;
    try {
      const firstDom = ed.view.nodeDOM(targets[0].from);
      const el = firstDom instanceof HTMLElement ? firstDom : firstDom?.parentElement;
      if (!el) return setMarqueeBar(null);
      const rect = el.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const top = Math.max(4, rect.top - wrapRect.top - 42);
      const left = Math.max(8, Math.min(rect.left - wrapRect.left, Math.max(8, wrapRect.width - 300)));
      const singleNode = targets.length === 1 ? ed.state.doc.nodeAt(targets[0].from) : null;
      const singleGroupPos = singleNode?.type.name === 'blockGroup' ? targets[0].from : null;
      setMarqueeBar({ top, left, targets, singleGroupPos });
    } catch {
      setMarqueeBar(null);
    }
  }, [editable]);
  const syncSelBar = (ed: Editor) => {
    if (!editable || linkBoxOpen || ed.isDestroyed || !spansMultipleBlocks(ed.state) || getMarqueeTargets(ed.state).length > 0) {
      setSelBar(null);
      return;
    }
    const wrap = wrapRef.current;
    if (!wrap) return;
    try {
      const cFrom = ed.view.coordsAtPos(ed.state.selection.from);
      const cTo = ed.view.coordsAtPos(ed.state.selection.to);
      const rect = wrap.getBoundingClientRect();
      const top = Math.max(4, Math.min(cFrom.top, cTo.top) - rect.top - 40);
      const left = Math.max(8, Math.min(cFrom.left - rect.left, Math.max(8, rect.width - 210)));
      const inGroup = !!findEnclosingBlockGroup(ed.state);
      setSelBar({ top, left, inGroup });
    } catch {
      setSelBar(null);
    }
  };
  const outlineKey = useRef('');
  const [copiedAt, setCopiedAt] = useState<{ top: number; left: number } | null>(null);
  const copiedTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  const syncOutline = (ed: Editor) => {
    const items = readOutline(ed);
    const key = JSON.stringify(items);
    if (key === outlineKey.current) return;
    outlineKey.current = key;
    setOutline(items);
  };

  const editor = useEditor(
    {
      extensions: buildExtensions(
        (heading) => heading ? placeholderText.current.headingText : placeholderText.current.emptyText,
        () => { setLinkBoxOpen(true); return true; },
      ),
      content,
      editable,
      autofocus: autofocus ? 'end' : false,
      editorProps: {
        attributes: { class: `prose ${className ?? ''}`, spellcheck: 'true' },
        // Browsers refuse to open file:// links from a web page, so open natively in desktop or copy on web.
        handleClick: (_view, _pos, event) => {
          const a = (event.target as HTMLElement | null)?.closest?.('a[href]');
          const href = a?.getAttribute('href') ?? '';
          if (!a || !/^file:/i.test(href) || event.button !== 0) return false;
          event.preventDefault();
          const rect = a.getBoundingClientRect();
          void openLocalFile(href).then((opened) => {
            if (opened) return;
            void navigator.clipboard?.writeText(href).then(
              () => {
                setCopiedAt({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)) });
                window.clearTimeout(copiedTimer.current);
                copiedTimer.current = window.setTimeout(() => setCopiedAt(null), 2600);
              },
              () => window.prompt('', href),
            );
          });
          return true;
        },
      },
      onCreate: ({ editor }) => syncOutline(editor),
      onUpdate: ({ editor }) => {
        onChangeRef.current(editor.getJSON() as JSONContent);
        syncOutline(editor);
      },
      onSelectionUpdate: ({ editor }) => {
        setInTable(editor.isActive('table'));
        syncSelBar(editor);
      },
      onFocus: ({ editor }) => {
        editorFocused(editor);
        syncSelBar(editor);
      },
      onBlur: ({ editor, event }) => {
        editorBlurred(editor, (event as FocusEvent).relatedTarget);
        setSelBar(null);
      },
      onTransaction: ({ editor, transaction }) => {
        setInTable(editor.isActive('table'));
        if (transaction.docChanged) syncOutline(editor);
        syncTrail(editor);
        syncSelBar(editor);
        if (!marqueeDraggingRef.current) syncMarqueeBar(editor, false);
      },
    },
    [docKey],
  );
  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);
  // Land on a block another view asked for (a live search result, a tag page row).
  useEffect(() => {
    if (!editor) return;
    const jump = () => {
      const path = takeJump(docKey);
      if (!path || editor.isDestroyed) return;
      const pos = posAtPath(editor.state.doc, path);
      const node = pos == null ? null : editor.state.doc.nodeAt(pos);
      if (pos == null || !node) return;
      if (node.type.name === 'listItem' || node.type.name === 'taskItem') return zoomTo(editor, pos);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos + 1))).scrollIntoView());
      editor.view.focus();
    };
    jump();
    return onJump((id) => id === docKey && jump());
  }, [editor, docKey]);
  const marqueeDraggingRef = useRef(false);

  // Notion / SiYuan-style rubber-band marquee block selection from page/gutter margins
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !editor || !editable || editor.isDestroyed) return;
    const host = (wrap.closest('.obj-page') as HTMLElement | null) ?? wrap;

    const IGNORE_SEL =
      'button, a, input, textarea, select, label, .block-gutter, .selection-block-bar, .link-box, .table-bar, .note-outline, .zoom-bar, .callout-icon, .callout-tones, .task-check, .bg-head, .toggle-head, .obj-head, .obj-toolbar, .obj-props, .ai-notes-panel, .ctx-tasks-section, .backlinks';

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || window.innerWidth <= 820) return;
      const target = e.target as HTMLElement | null;
      if (!target || target.closest(IGNORE_SEL)) return;
      const pm = wrap.querySelector('.ProseMirror') as HTMLElement | null;
      if (!pm) return;
      const pmRect = pm.getBoundingClientRect();
      const inMargin =
        e.clientX <= pmRect.left + 8 ||
        e.clientX >= pmRect.right - 8 ||
        e.clientY >= pmRect.bottom - 4 ||
        target === pm ||
        target === wrap ||
        target === host ||
        target.classList.contains('obj-inner') ||
        target.classList.contains('obj-editor');
      if (!inMargin) return;
      if (e.clientY < pmRect.top - 16 && target.closest('.obj-inner') && target !== host) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let didDrag = false;
      let raf = 0;

      const updateHit = (curX: number, curY: number) => {
        const left = Math.min(startX, curX);
        const top = Math.min(startY, curY);
        const width = Math.abs(curX - startX);
        const height = Math.abs(curY - startY);
        setMarqueeBox({ left, top, width, height });

        const boxRight = left + width;
        const boxBottom = top + height;
        const curPmRect = pm.getBoundingClientRect();
        if (boxRight < curPmRect.left - 240 || left > curPmRect.right + 240) {
          setMarqueeTargets(editor, []);
          return;
        }
        const all = collectSelectableTargets(editor.state.doc);
        const hits: SelectableTarget[] = [];
        for (const t of all) {
          const dom = editor.view.nodeDOM(t.from);
          const el = dom instanceof HTMLElement ? dom : dom?.parentElement;
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.height <= 0 && r.width <= 0) continue;
          if (r.bottom >= top && r.top <= boxBottom) {
            hits.push(t);
          }
        }
        setMarqueeTargets(editor, hits);
      };

      const onMove = (me: MouseEvent) => {
        if (!didDrag) {
          if (Math.hypot(me.clientX - startX, me.clientY - startY) < 5) return;
          didDrag = true;
          marqueeDraggingRef.current = true;
          setMarqueeBar(null);
          setSelBar(null);
        }
        me.preventDefault();
        window.getSelection()?.removeAllRanges();
        window.cancelAnimationFrame(raf);
        const cx = me.clientX;
        const cy = me.clientY;
        raf = window.requestAnimationFrame(() => updateHit(cx, cy));
      };

      const onUp = (ue: MouseEvent) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.cancelAnimationFrame(raf);
        if (didDrag) {
          updateHit(ue.clientX, ue.clientY);
          marqueeDraggingRef.current = false;
          setMarqueeBox(null);
          syncMarqueeBar(editor, false);
          // Prevent mouseup from triggering a stray click that clears selection or clicks a link
          const eatClick = (ce: MouseEvent) => {
            ce.preventDefault();
            ce.stopPropagation();
          };
          window.addEventListener('click', eatClick, { capture: true, once: true });
          window.setTimeout(() => window.removeEventListener('click', eatClick, true), 80);
        } else if (getMarqueeTargets(editor.state).length > 0) {
          clearMarqueeTargets(editor);
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const targets = getMarqueeTargets(editor.state);
      if (!targets.length) return;
      const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        clearMarqueeTargets(editor);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteMarqueeTargets(editor, targets);
      }
    };

    host.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      host.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [editor, editable, syncMarqueeBar]);

  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editor, editable]);
  useEffect(() => {
    // Refresh the decoration without recreating the editor or resetting undo history.
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr);
  }, [editor, emptyText, headingText]);

  return (
    <div ref={wrapRef} className={`editor-shell${showGutter && editable ? ' with-gutter' : ''}`}>
      {showGutter && editable && <BlockDragHandle editor={editor} containerRef={wrapRef} />}
      {editor && trail.length > 0 && <ZoomBar editor={editor} trail={trail} />}
      {showOutline && editor && !trail.length && outline.length >= 2 && <Outline editor={editor} items={outline} />}
      {editable && editor && inTable && <TableToolbar editor={editor} />}
      {marqueeBox && (
        <div
          className="marquee-box"
          style={{
            left: marqueeBox.left,
            top: marqueeBox.top,
            width: marqueeBox.width,
            height: marqueeBox.height,
          }}
        />
      )}
      {editable && editor && marqueeBar && marqueeBar.targets.length > 0 && !linkBoxOpen && (
        <div
          className="selection-block-bar"
          style={{ top: marqueeBar.top, left: marqueeBar.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="sel-bar-count">{tr('{count} selected', { count: marqueeBar.targets.length })}</span>
          {marqueeBar.singleGroupPos !== null ? (
            <button
              type="button"
              className="sel-bar-btn primary"
              onClick={() => {
                unwrapBlockGroupAt(editor, marqueeBar.singleGroupPos!);
                setMarqueeBar(null);
              }}
            >
              <Ungroup size={14} /> {tr('Ungroup block')}
            </button>
          ) : (
            <button
              type="button"
              className="sel-bar-btn primary"
              onClick={() => {
                wrapMarqueeTargets(editor, marqueeBar.targets);
                setMarqueeBar(null);
              }}
            >
              <Layers size={14} /> {tr('Group into block')}
            </button>
          )}
          <button
            type="button"
            className="sel-bar-btn"
            onClick={() => {
              duplicateMarqueeTargets(editor, marqueeBar.targets);
              setMarqueeBar(null);
            }}
          >
            <Copy size={14} /> {tr('Duplicate')}
          </button>
          <button
            type="button"
            className="sel-bar-btn danger"
            onClick={() => {
              deleteMarqueeTargets(editor, marqueeBar.targets);
              setMarqueeBar(null);
            }}
          >
            <Trash size={14} /> {tr('Delete')}
          </button>
          <button
            type="button"
            className="icon-btn tiny"
            title={tr('Clear')}
            onClick={() => {
              clearMarqueeTargets(editor);
              setMarqueeBar(null);
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {editable && editor && !marqueeBar && selBar && !linkBoxOpen && (
        <div
          className="selection-block-bar"
          style={{ top: selBar.top, left: selBar.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="sel-bar-btn primary"
            onClick={() => {
              editor.chain().focus().wrapInBlockGroup().run();
              setSelBar(null);
            }}
          >
            <Layers size={14} /> {tr('Group into block')}
          </button>
          {selBar.inGroup && (
            <button
              type="button"
              className="sel-bar-btn"
              onClick={() => {
                editor.chain().focus().unwrapBlockGroup().run();
                setSelBar(null);
              }}
            >
              <Ungroup size={14} /> {tr('Ungroup block')}
            </button>
          )}
        </div>
      )}
      <EditorContent editor={editor} className="editor-root" />
      {editable && editor && linkBoxOpen && <LinkBox editor={editor} onClose={() => setLinkBoxOpen(false)} />}
      {copiedAt && (
        <div className="link-copied" style={{ top: copiedAt.top, left: copiedAt.left }} role="status">
          {tr('Copied. Paste it into the browser address bar to open it.')}
        </div>
      )}
    </div>
  );
}

/**
 * Editor bound to an object: debounced autosave, flush on leave,
 * and live reload when the object is changed elsewhere (Tasks view, split pane).
 */
export function ObjectEditor({ obj, autofocus, placeholder }: { obj: Obj; autofocus?: boolean; placeholder?: string }) {
  const editorRef = useRef<Editor | null>(null);
  const initialContent = useMemo(
    () => (obj.deletedAt ? null : repairLooseBoldInDoc(obj.content)) ?? obj.content,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [obj.id],
  );
  const lastSaved = useRef(JSON.stringify(obj.content));
  const pending = useRef<JSONContent | null>(null);
  const timer = useRef<number>(0);
  const write = useRef(Promise.resolve());
  const id = obj.id;

  useEffect(() => {
    if (obj.deletedAt) return;
    const repaired = repairLooseBoldInDoc(obj.content);
    if (!repaired) return;
    lastSaved.current = JSON.stringify(repaired);
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) {
      const { from, to } = ed.state.selection;
      ed.commands.setContent(repaired, { emitUpdate: false });
      try {
        const max = ed.state.doc.content.size;
        ed.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
      } catch {
        /* ignore */
      }
    }
    void saveObject(id, { content: repaired }).catch((error) => console.error('Orbit could not save repaired bold markers', error));
  }, [id, obj.content, obj.deletedAt]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const c = pending.current;
    if (!c) return write.current;
    pending.current = null;
    lastSaved.current = JSON.stringify(c);
    const retryable = write.current.catch(() => {}).then(() => saveObject(id, { content: c })).catch((error: unknown) => {
      if (!pending.current && write.current === retryable) pending.current = c;
      throw error;
    });
    write.current = retryable;
    return retryable;
  }, [id]);
  const flushInBackground = useCallback(() => {
    void flush().catch((error) => console.error('Orbit could not save the note', error));
  }, [flush]);

  const onChange = useCallback(
    (json: JSONContent) => {
      pending.current = json;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flushInBackground, 400);
    },
    [flushInBackground],
  );

  // flush when leaving the object / closing the tab
  useEffect(() => {
    const unregister = registerDraft(id, flush);
    const onHide = () => flushInBackground();
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onHide);
      document.removeEventListener('visibilitychange', onHide);
      flushInBackground();
      unregister();
    };
  }, [flush, flushInBackground, id]);

  // apply changes made elsewhere
  useEffect(() => {
    const s = JSON.stringify(obj.content);
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    if (s !== lastSaved.current && !pending.current) {
      lastSaved.current = s;
      const { from, to } = ed.state.selection;
      ed.commands.setContent(obj.content, { emitUpdate: false });
      try {
        const max = ed.state.doc.content.size;
        ed.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
      } catch {
        /* ignore */
      }
    }
  }, [obj.content]);

  const onReady = useCallback((e: Editor) => {
    editorRef.current = e;
  }, []);

  return (
    <RichEditor
      docKey={id}
      content={initialContent}
      onChange={onChange}
      autofocus={autofocus}
      placeholder={placeholder}
      editable={!obj.deletedAt}
      showOutline
      onReady={onReady}
    />
  );
}
