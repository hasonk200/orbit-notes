import { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, Monitor, Moon, RotateCcw, Sun, Upload } from 'lucide-react';
import { downloadBackup, importBackupZip } from '../db/backup';
import { backupToFolder, chooseBackupFolder, forgetBackupFolder, fsSupported, getBackupFolder } from '../db/fsSync';
import { pruneOrphans, reindexAll } from '../db/indexers';
import { db } from '../db/schema';
import { relativeTime } from '../lib/dates';
import { localizeError } from '../lib/i18n';
import { useData } from '../store/dataStore';
import { useT, useUI, type Theme } from '../store/uiStore';
import { AiAccessSettings } from '../components/AiAccessSettings';
import { CloudSyncSettings, SyncConflicts } from '../components/CloudSync';

export function Settings() {
  const tr = useT();
  const { theme, setTheme, language, setLanguage } = useUI();
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
      if (e?.name !== 'AbortError') setMsg({ kind: 'err', text: localizeError(e, tr) });
    } finally {
      setBusy(false);
    }
  };

  const themes: [Theme, string, React.ReactNode][] = [
    ['light', tr('Light'), <Sun size={15} />],
    ['dark', tr('Dark'), <Moon size={15} />],
    ['system', tr('System'), <Monitor size={15} />],
  ];
  const liveObjects = new Set(objects.filter((o) => !o.deletedAt).map((o) => o.id));

  return (
    <div className="page">
      <header className="page-head">
        <h1>{tr('Settings')}</h1>
      </header>

      <section className="card-section">
        <h3>{tr('Appearance')}</h3>
        <div className="segmented">
          {themes.map(([t, label, icon]) => (
            <button key={t} type="button" className={theme === t ? 'active' : ''} onClick={() => setTheme(t)}>
              {icon} {label}
            </button>
          ))}
        </div>
        <h4>{tr('Language')}</h4>
        <div className="segmented" role="group" aria-label={tr('Language')}>
          <button type="button" lang="en" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>
            English
          </button>
          <button type="button" lang="zh-Hant" className={language === 'zh-Hant' ? 'active' : ''} aria-pressed={language === 'zh-Hant'} onClick={() => setLanguage('zh-Hant')}>
            繁體中文
          </button>
        </div>
      </section>

      <CloudSyncSettings />
      <SyncConflicts />
      <AiAccessSettings />

      <section className="card-section">
        <h3>{tr('Backup & restore')}</h3>
        <p className="muted">
          {tr('Orbit stores your data in this browser (IndexedDB).')} {tr('Last backup')}{tr.language === 'zh-Hant' ? '：' : ': '}
          <strong>{lastBackupAt ? relativeTime(lastBackupAt, tr) : tr('never')}</strong>
        </p>
        <div className="btn-row">
          <button type="button" className="btn primary" disabled={busy} onClick={() => run(async () => (await downloadBackup(), tr('Backup downloaded.')))}>
            <Download size={15} /> {tr('Export .zip backup')}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> {tr('Import backup…')}
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
              if (!confirm(tr('Importing replaces ALL current data with the backup. Export a backup first if unsure. Continue?'))) return;
              void run(async () => {
                const r = await importBackupZip(f);
                return tr('Imported {objects} objects and {images} images.', { objects: r.objects, images: r.blobs });
              });
            }}
          />
        </div>

        <h4>{tr('Backup to a local folder')}</h4>
        {fsSupported() ? (
          <>
            <p className="muted small">
              {tr('Orbit writes a dated ZIP to your chosen folder once a day when permission is active. It keeps the latest 14 backups.')}
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
                    return name ? tr('Saved {name}', { name }) : tr('Folder selected.');
                  })
                }
              >
                <FolderOpen size={15} /> {folder ? tr('Change folder') : tr('Choose folder')}
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
                        return name ? tr('Saved {name} to “{folder}”.', { name, folder }) : tr('Permission to the folder was not granted.');
                      })
                    }
                  >
                    {tr('Back up now')}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => run(async () => (await forgetBackupFolder(), await refreshFolder(), tr('Folder forgotten.')))}>
                    {tr('Forget folder')}
                  </button>
                </>
              )}
            </div>
            {folder && <p className="small">{tr('Folder: {folder}', { folder })}</p>}
          </>
        ) : (
          <p className="muted small">{tr('Folder backup needs Chrome or Edge. Use .zip export in this browser.')}</p>
        )}
        {msg && <div className={`banner ${msg.kind === 'ok' ? 'ok' : 'warn'}`}>{msg.text}</div>}
      </section>

      <section className="card-section">
        <h3>{tr('Data')}</h3>
        <p className="muted small">
          {tr('{objects} objects · {tasks} tasks · {images} images ({size} MB)', {
            objects: liveObjects.size,
            tasks: tasks.filter((t) => t.text.trim() && liveObjects.has(t.objectId)).length,
            images: storage.blobs,
            size: (storage.bytes / 1024 / 1024).toFixed(1),
          })}
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
                return tr('Links, tasks and tags rebuilt.');
              })
            }
          >
            <RotateCcw size={15} /> {tr('Rebuild indexes')}
          </button>
        </div>
      </section>

      <section className="card-section">
        <h3>{tr('Shortcuts')}</h3>
        <ul className="shortcuts">
          <li><kbd>Ctrl</kbd> + <kbd>K</kbd> {tr('Search & commands')}</li>
          <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> {tr('Today’s note')}</li>
          <li><kbd>Ctrl</kbd> + <kbd>\</kbd> {tr('Toggle sidebar')}</li>
          <li><kbd>Alt</kbd> + {tr('click a link: open in split view')}</li>
          <li><kbd>/</kbd> {tr('commands (Callout, Toggle, Table, Outliner…)')} · <kbd>[[</kbd> {tr('link')} · <kbd>#</kbd> {tr('tag')} · <kbd>@</kbd> {tr('date')}</li>
          <li><kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd> {tr('nest bullet points')} · <kbd>Ctrl</kbd> + <kbd>.</kbd> {tr('collapse / expand bullet branch')}</li>
        </ul>
      </section>
    </div>
  );
}
