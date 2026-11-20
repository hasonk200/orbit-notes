import { useState } from 'react';
import { Cloud, CloudCheck, CloudOff, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { syncNow, useSync, type SyncStatus } from '../sync/engine';
import { googleDirectAvailable, signInWithFirebasePopup, signInWithGoogle, signOutOfCloud } from '../sync/firebase';
import { useOpen } from '../store/pane';

const LABEL: Record<SyncStatus, string> = {
  unconfigured: 'Cloud sync not set up',
  'signed-out': 'Not syncing',
  connecting: 'Connecting…',
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline · changes saved locally',
  error: 'Sync error',
};

function StatusIcon({ status, size = 15 }: { status: SyncStatus; size?: number }) {
  if (status === 'synced') return <CloudCheck size={size} />;
  if (status === 'syncing' || status === 'connecting') return <RefreshCw size={size} className="spin" />;
  if (status === 'offline' || status === 'error' || status === 'unconfigured') return <CloudOff size={size} />;
  return <Cloud size={size} />;
}

/** Small status line for the sidebar. */
export function SyncIndicator() {
  const status = useSync((s) => s.status);
  const open = useOpen();
  if (status === 'unconfigured') return null;
  return (
    <button type="button" className={`sync-ind sync-${status}`} title={LABEL[status]} onClick={(e) => open('/settings', e)}>
      <StatusIcon status={status} size={14} />
      <span>{LABEL[status]}</span>
    </button>
  );
}

/** Settings section. */
export function CloudSyncSettings() {
  const { status, user, error, lastSyncAt, skipped } = useSync();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e: any) {
      const code = e?.code as string | undefined;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      if (code === 'popup_failed_to_open') {
        setMsg('The browser blocked the sign-in window. Allow pop-ups for this site and try again.');
        return;
      }
      if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found')
        setMsg('Google sign-in is not enabled for this Firebase project yet. Enable it in Firebase console → Authentication → Sign-in method → Google.');
      else setMsg(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card-section">
      <h3>Cloud sync</h3>
      {status === 'unconfigured' ? (
        <p className="muted small">Firebase isn’t configured. Copy .env.example to .env.local, fill in your Firebase web config and restart the dev server.</p>
      ) : !user ? (
        <>
          <p className="muted small">
            Sign in to keep your notes, types, pins and images in sync across your devices. Your data stays in this browser too, so Orbit keeps working offline.
          </p>
          <div className="btn-row">
            <button type="button" className="btn primary" disabled={busy} onClick={() => run(signInWithGoogle)}>
              <LogIn size={15} /> Sign in with Google
            </button>
            {googleDirectAvailable && (
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => run(signInWithFirebasePopup)} title="Firebase's own popup. Use this if the main button doesn't work.">
                Other sign-in method
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="sync-user">
            {user.photo && <img src={user.photo} alt="" referrerPolicy="no-referrer" />}
            <div>
              <div className="sync-user-name">{user.name ?? user.email}</div>
              <div className="muted small">{user.email}</div>
            </div>
          </div>
          <p className={`sync-line sync-${status}`}>
            <StatusIcon status={status} /> {LABEL[status]}
            {lastSyncAt && status === 'synced' && <span className="muted"> · {formatDistanceToNow(lastSyncAt, { addSuffix: true })}</span>}
          </p>
          {error && status === 'error' && <div className="banner warn">{error}</div>}
          {skipped.length > 0 && (
            <p className="muted small">{skipped.length} image(s) are too large (over 700 KB) to sync and stay on this device only.</p>
          )}
          <div className="btn-row">
            <button type="button" className="btn" disabled={busy} onClick={() => run(syncNow)}>
              <RefreshCw size={15} /> Sync now
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => run(signOutOfCloud)}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
          <p className="muted small">Signing out stops syncing. Notes already on this device stay here.</p>
        </>
      )}
      {msg && <div className="banner warn">{msg}</div>}
    </section>
  );
}
