import { useEffect, useState } from 'react';
import { Check, LogIn } from 'lucide-react';
import { parseDesktopAuthParams } from '../lib/native';
import { requestGoogleAccessToken } from '../sync/firebase';
import { useT } from '../store/uiStore';

const home = import.meta.env.BASE_URL;

/**
 * Web OAuth bridge for Orbit Desktop (Tauri): signs the user in via Google's
 * popup inside their regular browser, then submits the access token back to
 * the desktop app's one-shot 127.0.0.1 loopback listener via a top-level POST form.
 */
export function DesktopAuthPage() {
  const tr = useT();
  const [authParams] = useState(() =>
    typeof window === 'undefined' ? null : parseDesktopAuthParams(window.location.search),
  );
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const prev = document.title;
    document.title = tr('Sign in to Orbit Desktop');
    return () => {
      document.title = prev;
    };
  }, [tr]);

  const startSignIn = async () => {
    if (!authParams || busy) return;
    setBusy(true);
    setError(null);
    try {
      const accessToken = await requestGoogleAccessToken();
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = `http://127.0.0.1:${authParams.port}/callback`;
      form.style.display = 'none';

      const stateInput = document.createElement('input');
      stateInput.type = 'hidden';
      stateInput.name = 'state';
      stateInput.value = authParams.state;

      const tokenInput = document.createElement('input');
      tokenInput.type = 'hidden';
      tokenInput.name = 'access_token';
      tokenInput.value = accessToken;

      form.append(stateInput, tokenInput);
      document.body.appendChild(form);
      setSent(true);
      form.submit();
    } catch (e: any) {
      const code = e?.code as string | undefined;
      if (code !== 'auth/popup-closed-by-user') {
        setError(e?.message ?? String(e));
      }
      setBusy(false);
    }
  };

  return (
    <main className="connect-page">
      <div className="connect-card">
        <div className="connect-logos" aria-hidden="true">
          <img className="connect-logo" src={home + 'icons/icon-192.png'} alt="" />
        </div>
        {!authParams ? (
          <>
            <h1>{tr('Invalid desktop sign-in link')}</h1>
            <p className="muted">{tr('Close this tab and click Sign in with Google inside Orbit Desktop again.')}</p>
          </>
        ) : sent ? (
          <>
            <h1><Check size={18} /> {tr('Sending sign-in to Orbit Desktop…')}</h1>
            <p className="muted">{tr('You can return to the Orbit desktop window.')}</p>
          </>
        ) : (
          <>
            <h1>{tr('Sign in to Orbit Desktop')}</h1>
            <p className="muted">{tr('Choose your Google account in this browser to unlock cloud sync in the Orbit desktop app.')}</p>
            <div className="btn-row">
              <button type="button" className="btn primary" disabled={busy} onClick={() => void startSignIn()}>
                <LogIn size={15} /> {tr('Sign in with Google')}
              </button>
            </div>
            {error && <div className="banner warn">{error}</div>}
          </>
        )}
      </div>
    </main>
  );
}
