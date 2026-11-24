import { Download, RefreshCw, Share, SquarePlus } from 'lucide-react';
import { useT } from '../store/uiStore';
import { isIos, promptInstall, reloadForUpdate, usePwa } from '../lib/pwa';

/** Settings section: add Orbit to the home screen or dock. */
export function AppInstallSettings() {
  const tr = useT();
  const { canInstall, installed } = usePwa();
  return (
    <section className="card-section">
      <h3>{tr('Install app')}</h3>
      {installed ? (
        <p className="muted small">{tr('Orbit is installed on this device. It opens in its own window and works offline.')}</p>
      ) : canInstall ? (
        <>
          <p className="muted small">{tr('Add Orbit to your home screen or dock. It opens in its own window, starts faster and works offline.')}</p>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={() => void promptInstall()}>
              <Download size={15} /> {tr('Install Orbit')}
            </button>
          </div>
        </>
      ) : isIos() ? (
        <p className="muted small install-steps">
          {tr('In Safari, tap')} <Share size={14} /> <strong>{tr('Share')}</strong>, {tr('then')} <SquarePlus size={14} /> <strong>{tr('Add to Home Screen')}</strong>.
        </p>
      ) : (
        <p className="muted small">{tr('Open Orbit in Chrome, Edge or Safari, then use the browser menu’s “Install” or “Add to Home Screen” option.')}</p>
      )}
    </section>
  );
}

/** Small notice when a newer version has been downloaded. */
export function UpdateNotice() {
  const tr = useT();
  const updateReady = usePwa((s) => s.updateReady);
  if (!updateReady) return null;
  return (
    <div className="update-notice" role="status">
      <span>{tr('A new version of Orbit is ready.')}</span>
      <button type="button" className="btn small primary" onClick={reloadForUpdate}>
        <RefreshCw size={14} /> {tr('Reload')}
      </button>
      <button type="button" className="btn-ghost small" onClick={() => usePwa.setState({ updateReady: false })}>
        {tr('Not now')}
      </button>
    </div>
  );
}
