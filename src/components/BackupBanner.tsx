import { useT } from '../store/uiStore';
import { useEffect, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { useData } from '../store/dataStore';
import { downloadBackup } from '../db/backup';
import { backupToFolder, getBackupFolder } from '../db/fsSync';

const WEEK = 7 * 24 * 3600 * 1000;

export function BackupBanner() {
  const tr = useT();
  const last = useData((s) => s.lastBackupAt);
  const ready = useData((s) => s.ready);
  const count = useData((s) => s.objects.filter((o) => !o.deletedAt && o.typeId !== 'daily').length + s.objects.filter((o) => o.typeId === 'daily').length);
  const [hasFolder, setHasFolder] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('orbit-backup-dismissed') === '1';
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBackupFolder().then((h) => setHasFolder(!!h));
  }, [last]);

  const due = ready && count >= 3 && (!last || Date.now() - last > WEEK);
  if (!due || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem('orbit-backup-dismissed', '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="backup-banner" role="status">
      <ShieldCheck size={16} />
      <span>{last ? tr('Your last backup is over a week old.') : tr('You haven’t backed up your notes yet.')}</span>
      {hasFolder && (
        <button
          type="button"
          className="btn small primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await backupToFolder(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {tr('Back up to folder')}
        </button>
      )}
      <button
        type="button"
        className={`btn small${hasFolder ? '' : ' primary'}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await downloadBackup();
          } finally {
            setBusy(false);
          }
        }}
      >
        {tr('Export .zip')}
      </button>
      <button type="button" className="icon-btn tiny" onClick={dismiss} title={tr('Remind me later')}>
        <X size={14} />
      </button>
    </div>
  );
}
