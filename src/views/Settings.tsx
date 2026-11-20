import { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, Monitor, Moon, RotateCcw, Sun, Upload } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { downloadBackup, importBackupZip } from '../db/backup';
import { backupToFolder, chooseBackupFolder, forgetBackupFolder, fsSupported, getBackupFolder } from '../db/fsSync';
import { pruneOrphans, reindexAll } from '../db/indexers';
import { db } from '../db/schema';
import { useData } from '../store/dataStore';
import { useUI, type Theme } from '../store/uiStore';

export function Settings() {
  const { theme, setTheme } = useUI();
  const lastBackupAt = useData((s) => s.lastBackupAt);
  const objects = useData((s) => s.objects);
  const tasks = useData((s) => s.tasks);
  const [folder, setFolder] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState<{ blobs: number; bytes: number }>({ blobs: 0, bytes: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshFolder = async () => setFolder(((await getBackupFolder()) as any)?.name ?? null);
  useEffect(() => {
    void refreshFolder();
    db.blobs.toArray().then((b) => setStorage({ blobs: b.length, bytes: b.reduce((n, x) => n + x.size, 0) }));
  }, []);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ kind: 'ok', text });
    } catch (e: any) {
      if (e?.name !== 'AbortError') setMsg({ kind: 'err', text: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  };

  const themes: [Theme, string, React.ReactNode][] = [
    ['light', 'Light', <Sun size={15} />],
    ['dark', 'Dark', <Moon size={15} />],
    ['system', 'System', <Monitor size={15} />],
  ];

  return (
    <div className="page">
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <section className="card-section">
        <h3>Appearance</h3>
        <div className="segmented">
          {themes.map(([t, label, icon]) => (
            <button key={t} type="button" className={theme === t ? 'active' : ''} onClick={() => setTheme(t)}>
              {icon} {label}
            </button>
          ))}
        </div>
      </section>

      <section className="card-section">
        <h3>Backup &amp; restore</h3>
        <p className="muted">
          Everything lives in this browser (IndexedDB). Last backup:{' '}
          <strong>{lastBackupAt ? formatDistanceToNow(lastBackupAt, { addSuffix: true }) : 'never'}</strong>.
        </p>
        <div className="btn-row">
          <button type="button" className="btn primary" disabled={busy} onClick={() => run(async () => (await downloadBackup(), 'Backup downloaded.'))}>
            <Download size={15} /> Export .zip backup
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> Import backup…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (!confirm('Importing replaces ALL current data with the backup. Export a backup first if unsure. Continue?')) return;
              void run(async () => {
                const r = await importBackupZip(f);
                return `Imported ${r.objects} objects and ${r.blobs} images.`;
              });
            }}
          />
        </div>

        <h4>Backup to a local folder</h4>
        {fsSupported() ? (
          <>
            <p className="muted small">
              Pick a folder (for example inside Dropbox, OneDrive or iCloud Drive). Orbit writes a dated .zip there, keeps the newest 14, and backs up
              quietly once a day while the folder permission is active.
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await chooseBackupFolder();
                    await refreshFolder();
                    const name = await backupToFolder(true);
                    return name ? `Saved ${name}` : 'Folder selected.';
                  })
                }
              >
                <FolderOpen size={15} /> {folder ? 'Change folder' : 'Choose folder'}
              </button>
              {folder && (
                <>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const name = await backupToFolder(true);
                        return name ? `Saved ${name} to “${folder}”.` : 'Permission to the folder was not granted.';
                      })
                    }
                  >
                    Back up now
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => run(async () => (await forgetBackupFolder(), await refreshFolder(), 'Folder forgotten.'))}>
                    Forget folder
                  </button>
                </>
              )}
            </div>
            {folder && <p className="small">Folder: <strong>{folder}</strong></p>}
          </>
        ) : (
          <p className="muted small">Folder backup needs Chrome or Edge. Use .zip export in this browser.</p>
        )}
        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'warn'}`}>{msg.text}</div>}
      </section>

      <section className="card-section">
        <h3>Data</h3>
        <p className="muted small">
          {objects.filter((o) => !o.deletedAt).length} objects ·{' '}
          {tasks.filter((t) => t.text.trim() && !objects.find((o) => o.id === t.objectId)?.deletedAt).length} tasks · {storage.blobs} images (
          {(storage.bytes / 1024 / 1024).toFixed(1)} MB)
        </p>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await reindexAll();
                await pruneOrphans();
                return 'Links, tasks and tags rebuilt.';
              })
            }
          >
            <RotateCcw size={15} /> Rebuild indexes
          </button>
        </div>
      </section>

      <section className="card-section">
        <h3>Shortcuts</h3>
        <ul className="shortcuts">
          <li><kbd>Ctrl</kbd> + <kbd>K</kbd> Search &amp; commands</li>
          <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> Today’s note</li>
          <li><kbd>Ctrl</kbd> + <kbd>\</kbd> Toggle sidebar</li>
          <li><kbd>Alt</kbd> + click a link: open in split view</li>
          <li><kbd>/</kbd> commands (Callout, Toggle, Table, Outliner…) · <kbd>[[</kbd> link · <kbd>#</kbd> tag · <kbd>@</kbd> date</li>
          <li><kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd> nest bullet points · <kbd>Ctrl</kbd> + <kbd>.</kbd> collapse / expand bullet branch</li>
        </ul>
      </section>
    </div>
  );
}
