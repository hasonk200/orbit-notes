import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, FilePlus2, FolderOpen, HardDrive, Orbit, RefreshCw, Save, X } from 'lucide-react';
import type { JSONContent } from '../db/schema';
import { createObject } from '../db/indexers';
import { blocksToMarkdown, markdownToBlocks } from '../lib/markdown';
import {
  ensureMarkdownExt,
  fileNameFromPath,
  isTauri,
  openLocalFile,
  pickMarkdownSavePath,
  readLocalMarkdown,
  suggestCopyPath,
  writeLocalMarkdown,
} from '../lib/native';
import { RichEditor } from '../editor/Editor';
import { Modal } from '../components/Popover';
import { objPath, useOpen } from '../store/pane';
import { useT, useUI } from '../store/uiStore';

type SaveMode = 'overwrite' | 'save-as' | 'import-orbit';

function parentFolderUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  const folder = idx > 0 ? normalized.slice(0, idx) : normalized;
  return 'file:///' + encodeURI(folder.replace(/^\/+/, '')).replace(/#/g, '%23');
}

function nowTime(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

export function LocalFileView({ path }: { path: string | null }) {
  const tr = useT();
  const navigate = useNavigate();
  const open = useOpen();
  const space = useUI((s) => s.space);

  const [activePath, setActivePath] = useState(path ?? '');
  const [doc, setDoc] = useState<JSONContent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveMode, setSaveMode] = useState<SaveMode>('overwrite');
  const [saveAsPath, setSaveAsPath] = useState('');
  const [saving, setSaving] = useState(false);

  const latestDocRef = useRef<JSONContent | null>(null);
  const noticeTimerRef = useRef<number>(0);

  useEffect(() => {
    setActivePath(path ?? '');
  }, [path]);

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4500);
  }, []);

  const loadFile = useCallback(async (target: string, askIfDirty = false) => {
    if (askIfDirty && dirty && !window.confirm(tr('Discard unsaved edits and reload from disk?'))) return;
    if (!target) {
      setDoc(null);
      setError(tr('No local Markdown file selected.'));
      return;
    }
    if (!isTauri()) {
      setDoc(null);
      setError(tr('Local Markdown files can only be edited in Orbit Desktop.'));
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const text = await readLocalMarkdown(target);
      const blocks = markdownToBlocks(text);
      const parsed: JSONContent = { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };
      latestDocRef.current = parsed;
      setDoc(parsed);
      setDirty(false);
      setSavedAt(null);
    } catch (err: unknown) {
      setDoc(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [dirty, tr]);

  useEffect(() => {
    void loadFile(activePath, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  const openSaveModal = useCallback(() => {
    if (!doc || !activePath) return;
    setSaveMode('overwrite');
    setSaveAsPath(suggestCopyPath(activePath));
    setError(null);
    setSaveOpen(true);
  }, [doc, activePath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        openSaveModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSaveModal]);

  const handleBrowseSaveAs = async () => {
    const picked = await pickMarkdownSavePath(saveAsPath || suggestCopyPath(activePath));
    if (picked) {
      setSaveMode('save-as');
      setSaveAsPath(picked);
    }
  };

  const handleConfirmSave = async () => {
    if (saving || !activePath) return;
    const content = latestDocRef.current ?? doc;
    if (!content) return;
    setSaving(true);
    setError(null);
    try {
      if (saveMode === 'import-orbit') {
        const title = fileNameFromPath(activePath).replace(/\.(?:md|markdown)$/i, '') || tr('Untitled');
        const obj = await createObject('page', { title, content, space });
        setSaveOpen(false);
        open(objPath(obj.id));
        return;
      }

      const targetPath = saveMode === 'save-as' ? ensureMarkdownExt(saveAsPath) : activePath;
      if (!targetPath) {
        setError(tr('Enter a destination file path.'));
        setSaving(false);
        return;
      }
      const md = blocksToMarkdown(content.content ?? []);
      await writeLocalMarkdown(targetPath, md);
      setDirty(false);
      setSavedAt(nowTime());
      setSaveOpen(false);
      flashNotice(tr('Saved to {name}', { name: fileNameFromPath(targetPath) }));
      if (targetPath !== activePath) {
        setActivePath(targetPath);
        navigate(`/local-file?path=${encodeURIComponent(targetPath)}`, { replace: true });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!activePath) {
    return (
      <div className="empty-state">
        <h2>{tr('No local Markdown file selected.')}</h2>
      </div>
    );
  }

  return (
    <div className="obj-page">
      <div className="obj-inner">
        <div className="obj-toolbar local-file-toolbar">
          <span className="space-chip" title={activePath}>
            <HardDrive size={12} /> {tr('Local file · Not synced to cloud')}
          </span>
          {dirty ? (
            <span className="local-file-status is-dirty">
              <span className="local-dot" /> {tr('Unsaved changes')}
            </span>
          ) : savedAt ? (
            <span className="local-file-status is-saved">
              <Check size={13} /> {tr('Saved at {time}', { time: savedAt })}
            </span>
          ) : doc ? (
            <span className="muted small">{tr('No changes yet')}</span>
          ) : null}
          <div className="spacer" />
          <button type="button" className={dirty ? 'btn small primary' : 'btn small'} onClick={openSaveModal} disabled={!doc} title="Ctrl+S">
            <Save size={14} /> {tr('Save')}
          </button>
          {isTauri() && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => void openLocalFile(parentFolderUrl(activePath))}
              title={tr('Open containing folder')}
              aria-label={tr('Open containing folder')}
            >
              <FolderOpen size={16} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => void loadFile(activePath, true)}
            title={tr('Reload from disk')}
            aria-label={tr('Reload from disk')}
          >
            <RefreshCw size={16} />
          </button>
        </div>

        <h1 className="obj-title local-file-title">{fileNameFromPath(activePath)}</h1>
        <p className="local-file-path" title={activePath}>{activePath}</p>

        {notice && <div className="banner ok" role="status">{notice}</div>}
        {error && <div className="banner warn" role="alert">{error}</div>}

        {doc && (
          <RichEditor
            docKey={`local:${activePath}`}
            content={doc}
            onChange={(json) => {
              latestDocRef.current = json;
              setDirty(true);
            }}
            autofocus={false}
            showOutline
          />
        )}
      </div>

      {saveOpen && (
        <Modal onClose={() => !saving && setSaveOpen(false)} className="local-save-modal" label={tr('Save Markdown file')}>
          <div className="local-save-head">
            <div>
              <h3>{tr('Save Markdown file')}</h3>
              <p className="muted small">{tr('Choose where to save your changes.')}</p>
            </div>
            <button type="button" className="icon-btn" onClick={() => setSaveOpen(false)} disabled={saving} aria-label={tr('Close')}>
              <X size={16} />
            </button>
          </div>

          <div className="local-save-list">
            <button
              type="button"
              className={`local-save-opt${saveMode === 'overwrite' ? ' is-active' : ''}`}
              onClick={() => setSaveMode('overwrite')}
            >
              <div className="local-save-opt-head">
                <Save size={15} />
                <strong>{tr('Overwrite current file')}</strong>
              </div>
              <div className="local-path-preview">{activePath}</div>
            </button>

            <div
              className={`local-save-opt${saveMode === 'save-as' ? ' is-active' : ''}`}
              onClick={() => setSaveMode('save-as')}
            >
              <div className="local-save-opt-head">
                <FilePlus2 size={15} />
                <strong>{tr('Save as a new file…')}</strong>
              </div>
              <div className="local-save-browse">
                <input
                  type="text"
                  value={saveAsPath}
                  onFocus={() => setSaveMode('save-as')}
                  onChange={(e) => {
                    setSaveMode('save-as');
                    setSaveAsPath(e.target.value);
                  }}
                  placeholder={suggestCopyPath(activePath)}
                />
                {isTauri() && (
                  <button type="button" className="btn small" onClick={() => void handleBrowseSaveAs()}>
                    {tr('Browse…')}
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              className={`local-save-opt${saveMode === 'import-orbit' ? ' is-active' : ''}`}
              onClick={() => setSaveMode('import-orbit')}
            >
              <div className="local-save-opt-head">
                <Orbit size={15} />
                <strong>{tr('Save a copy to Orbit')}</strong>
              </div>
              <span className="muted small">{tr('Creates a synced note in Orbit and leaves the disk file unchanged.')}</span>
            </button>
          </div>

          {error && <div className="banner warn" role="alert">{error}</div>}

          <div className="local-save-foot">
            <button type="button" className="btn-ghost" onClick={() => setSaveOpen(false)} disabled={saving}>
              {tr('Cancel')}
            </button>
            <button type="button" className="btn primary" onClick={() => void handleConfirmSave()} disabled={saving}>
              <Check size={15} /> {saving ? tr('Saving…') : tr('Confirm save')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
