import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, FileText, FolderOpen, HardDrive, RefreshCw, Save } from 'lucide-react';
import type { JSONContent } from '../db/schema';
import { blocksToMarkdown, markdownToBlocks } from '../lib/markdown';
import { isTauri, openLocalFile, readLocalMarkdown, writeLocalMarkdown } from '../lib/native';
import { RichEditor } from '../editor/Editor';
import { useT } from '../store/uiStore';

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function parentFolderUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  const folder = idx > 0 ? normalized.slice(0, idx) : normalized;
  return 'file:///' + encodeURI(folder.replace(/^\/+/, '')).replace(/#/g, '%23');
}

export function LocalFileView({ path }: { path: string | null }) {
  const tr = useT();
  const [doc, setDoc] = useState<JSONContent | null>(null);
  const [status, setStatus] = useState<'loading' | 'saved' | 'saving' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const pendingRef = useRef<JSONContent | null>(null);
  const timerRef = useRef<number>(0);
  const writeChainRef = useRef(Promise.resolve());
  const activePathRef = useRef(path);
  activePathRef.current = path;

  const flush = useCallback(() => {
    window.clearTimeout(timerRef.current);
    const nextDoc = pendingRef.current;
    const targetPath = activePathRef.current;
    if (!nextDoc || !targetPath) return writeChainRef.current;
    pendingRef.current = null;
    setStatus('saving');
    const md = blocksToMarkdown(nextDoc.content ?? []);
    const op = writeChainRef.current
      .catch(() => undefined)
      .then(() => writeLocalMarkdown(targetPath, md))
      .then(() => {
        if (activePathRef.current === targetPath && !pendingRef.current) setStatus('saved');
      })
      .catch((err: unknown) => {
        if (!pendingRef.current) pendingRef.current = nextDoc;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
    writeChainRef.current = op;
    return op;
  }, []);

  const loadFile = useCallback(async () => {
    if (!path) {
      setError(tr('No local Markdown file selected.'));
      setStatus('error');
      return;
    }
    if (!isTauri()) {
      setError(tr('Local Markdown files can only be edited in Orbit Desktop.'));
      setStatus('error');
      return;
    }
    setStatus('loading');
    setError(null);
    pendingRef.current = null;
    try {
      const text = await readLocalMarkdown(path);
      const blocks = markdownToBlocks(text);
      setDoc({ type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] });
      setStatus('saved');
    } catch (err: unknown) {
      setDoc(null);
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [path, tr]);

  useEffect(() => {
    void loadFile();
    return () => {
      void flush();
    };
  }, [loadFile, flush]);

  useEffect(() => {
    const onHide = () => void flush();
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener('beforeunload', onHide);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('beforeunload', onHide);
      window.removeEventListener('keydown', onKey);
    };
  }, [flush]);

  const onChange = useCallback(
    (json: JSONContent) => {
      pendingRef.current = json;
      setStatus('saving');
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(), 500);
    },
    [flush],
  );

  if (!path) {
    return (
      <div className="empty-state">
        <h2>{tr('No local Markdown file selected.')}</h2>
      </div>
    );
  }

  return (
    <div className="page note-page">
      <div className="note-top">
        <span className="space-chip" title={path}>
          <HardDrive size={12} /> {tr('Local file · Not synced to cloud')}
        </span>
        <div className="note-top-actions">
          <span className="muted small">
            {status === 'saving' ? tr('Saving…') : status === 'saved' ? <><Check size={13} /> {tr('Saved')}</> : null}
          </span>
          {doc && (
            <button type="button" className="btn small" onClick={() => void flush()} title="Ctrl+S">
              <Save size={14} /> {tr('Save')}
            </button>
          )}
          {isTauri() && (
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => void openLocalFile(parentFolderUrl(path))}
              title={tr('Open containing folder')}
            >
              <FolderOpen size={14} /> {tr('Open folder')}
            </button>
          )}
          <button type="button" className="icon-btn" onClick={() => void loadFile()} title={tr('Reload from disk')}>
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      <header className="note-head">
        <h1 className="obj-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileText size={24} className="muted" />
          <span>{fileNameOf(path)}</span>
        </h1>
        <p className="muted small" style={{ marginTop: 4, wordBreak: 'break-all' }}>{path}</p>
      </header>

      {error && <div className="banner warn" role="alert">{error}</div>}

      {doc && (
        <RichEditor
          docKey={`local:${path}`}
          content={doc}
          onChange={onChange}
          autofocus={false}
          showOutline
        />
      )}
    </div>
  );
}
