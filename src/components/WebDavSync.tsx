import { useState } from 'react';
import { askConfirm } from './ConfirmDialog';
import { CloudCheck, CloudOff, FolderSync, KeyRound, Link2, RefreshCw, Unplug } from 'lucide-react';
import { useT } from '../store/uiStore';
import { localizeError } from '../lib/i18n';
import { relativeTime } from '../lib/dates';
import { connectWebDav, DEFAULT_FOLDER, disconnectWebDav, NUTSTORE_SERVER, syncWebDav, useWebDav, type WebDavStatus } from '../sync/webdav';
import { nativeHttpAvailable } from '../sync/webdavHttp';
import { SettingsSection } from './SettingsSection';

const LABEL: Record<WebDavStatus, string> = {
  off: 'Not connected',
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline · changes saved locally',
  error: 'Sync error',
};

/** Settings: sync through a WebDAV folder such as Nutstore (坚果云), which works in mainland China. */
export function WebDavSyncSettings() {
  const tr = useT();
  const { status, config, error, lastSyncAt } = useWebDav();
  const [server, setServer] = useState(NUTSTORE_SERVER);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [folder, setFolder] = useState(DEFAULT_FOLDER);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<unknown>(null);
  const native = nativeHttpAvailable();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(e);
    } finally {
      setBusy(false);
    }
  };

  const summary = config ? `${config.user} · ${tr(LABEL[status])}` : tr('Not connected');

  return (
    <SettingsSection id="webdav-sync" icon={<FolderSync size={18} />} tone="#2fa57a" title={tr('Nutstore / WebDAV sync')} summary={summary}>
      {!config ? (
        <form
          className="ai-settings"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await connectWebDav({ server, user, password, folder });
              setPassword('');
            });
          }}
        >
          <p className="ai-lead">{tr('Sync through your own WebDAV storage. Nutstore (坚果云) works in mainland China without a VPN, and needs no Google account.')}</p>
          {!native && <div className="banner warn">{tr('Nutstore only works from the Orbit desktop or phone app. In a web browser, only WebDAV servers that allow web access will connect.')}</div>}

          <div className="ai-block">
            <div className="ai-block-head">
              <KeyRound size={16} />
              <h4>{tr('Get an app password')}</h4>
            </div>
            <p className="ai-help">{tr('On the Nutstore website: Account info → Security → Third-party app management → Add app. Use the password it shows here, not your login password.')}</p>
          </div>

          <div className="ai-block">
            <div className="ai-block-head">
              <Link2 size={16} />
              <h4>{tr('Account')}</h4>
            </div>
            <div className="dav-form">
              <label>
                <span>{tr('Server address')}</span>
                <input type="url" inputMode="url" autoComplete="url" value={server} onChange={(e) => setServer(e.target.value)} placeholder={NUTSTORE_SERVER} required />
              </label>
              <label>
                <span>{tr('Folder')}</span>
                <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={DEFAULT_FOLDER} />
              </label>
              <label>
                <span>{tr('Account (email)')}</span>
                <input type="email" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} required />
              </label>
              <label>
                <span>{tr('App password')}</span>
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
            </div>
            <p className="ai-help">{tr('Orbit keeps one data file and your images in this folder. Every device you connect to the same folder stays in sync. The password stays on this device and isn’t included in backups.')}</p>
            <div className="btn-row">
              <button type="submit" className="btn primary" disabled={busy || !user.trim() || !password}>
                {busy ? <RefreshCw size={15} className="spin" /> : <FolderSync size={15} />} {tr(busy ? 'Connecting…' : 'Connect')}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <>
          <p className={`sync-line sync-${status === 'off' ? 'signed-out' : status}`}>
            {status === 'synced' ? <CloudCheck size={15} /> : status === 'syncing' ? <RefreshCw size={15} className="spin" /> : <CloudOff size={15} />} {tr(LABEL[status])}
            {lastSyncAt && status === 'synced' && <span className="muted"> · {relativeTime(lastSyncAt, tr)}</span>}
          </p>
          <div className="ai-field">
            <code>{`${config.server.replace(/\/+$/, '')}/${config.folder}`}</code>
          </div>
          {error != null && status !== 'synced' && status !== 'syncing' ? <div className="banner warn">{localizeError(error, tr)}</div> : null}
          <div className="btn-row">
            <button type="button" className="btn" disabled={busy || status === 'syncing'} onClick={() => run(syncWebDav)}>
              <RefreshCw size={15} /> {tr('Sync now')}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={async () => {
                if (await askConfirm({ title: tr('Stop syncing with this folder on this device? Notes stay on this device and in the folder.'), confirmLabel: tr('Disconnect') })) void run(disconnectWebDav);
              }}
            >
              <Unplug size={15} /> {tr('Disconnect')}
            </button>
          </div>
        </>
      )}
      {msg != null && <div className="banner warn">{localizeError(msg, tr)}</div>}
    </SettingsSection>
  );
}
