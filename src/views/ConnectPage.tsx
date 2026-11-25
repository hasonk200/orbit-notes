import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { ArrowLeftRight, Check, Clock, Copy, Link2, LogIn, ShieldCheck, X } from 'lucide-react';
import { aiService, manage, readConsentRequestId, type ConsentChoice, type ConsentRequest } from '../sync/aiService';
import { fb, firebaseConfigured, googleDirectAvailable, signInWithFirebasePopup, signInWithGoogle } from '../sync/firebase';
import { useT } from '../store/uiStore';

/**
 * Orbit's own approval page for AI apps (the OAuth consent screen).
 * The AI service sends people to /connect#ai_request=…; this page signs them in if needed,
 * says plainly what the app will be able to do, and after a choice offers the way back
 * (a button, plus a link to copy when the connection was started in another browser or app).
 * It never jumps away by itself, so the installed app does not open the AI app's page.
 */

type Phase =
  | { step: 'loading' }
  | { step: 'sign-in' }
  | { step: 'review'; consent: ConsentRequest }
  | { step: 'done'; consent: ConsentRequest; choice: ConsentChoice; link: string }
  | { step: 'error'; kind: 'missing' | 'expired' | 'unavailable' | 'other'; message?: string };

const home = import.meta.env.BASE_URL;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function Avatar({ name, photo, className }: { name: string; photo?: string | null; className: string }) {
  if (photo) return <img className={className} src={photo} alt="" referrerPolicy="no-referrer" />;
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return <span className={className} aria-hidden="true">{letter}</span>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="connect-page">
      <div className="connect-card">{children}</div>
    </main>
  );
}

function Header({ client }: { client?: string }) {
  return (
    <div className="connect-logos" aria-hidden="true">
      <img className="connect-logo" src={home + 'icons/icon-192.png'} alt="" />
      {client && (
        <>
          <span className="connect-link-line">
            <Link2 size={14} />
          </span>
          <Avatar className="connect-logo connect-client" name={client} />
        </>
      )}
    </div>
  );
}

export function ConnectPage() {
  const tr = useT();
  // Read once: the address is cleaned up after a choice, and that must not reset the page.
  const [requestId] = useState(readConsentRequestId);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: 'loading' });
  const [scope, setScope] = useState<'read' | 'write'>('write');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);

  useEffect(() => {
    const previous = document.title;
    document.title = tr('Connect to Orbit');
    return () => {
      document.title = previous;
    };
  }, [tr]);

  useEffect(() => {
    if (!firebaseConfigured || !aiService) return;
    return onAuthStateChanged(fb().auth, (next) => {
      setUser(next);
      setAuthReady(true);
    });
  }, []);

  const load = useCallback(
    (signal?: AbortSignal) => {
      if (!user || !requestId) return;
      setPhase({ step: 'loading' });
      manage<ConsentRequest>(user.uid, '/consent/' + encodeURIComponent(requestId), { signal })
        .then((consent) => {
          setScope(consent.canWrite ? 'write' : 'read');
          setPhase({ step: 'review', consent });
        })
        .catch((failure: Error) => {
          if (signal?.aborted) return;
          const expired = /expired|not found/i.test(failure.message);
          setPhase({ step: 'error', kind: expired ? 'expired' : 'other', message: failure.message });
        });
    },
    [user, requestId],
  );

  useEffect(() => {
    if (!firebaseConfigured || !aiService) return setPhase({ step: 'error', kind: 'unavailable' });
    if (!requestId) return setPhase({ step: 'error', kind: 'missing' });
    if (!authReady) return setPhase({ step: 'loading' });
    if (!user) return setPhase({ step: 'sign-in' });
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [authReady, user, requestId, load]);

  const signIn = async (method: () => Promise<void>) => {
    setBusy(true);
    setProblem('');
    try {
      await method();
    } catch (e: any) {
      const code = e?.code as string | undefined;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      if (code === 'popup_failed_to_open') setProblem(tr('The browser blocked the sign-in window. Allow pop-ups for this site and try again.'));
      else setProblem(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (consent: ConsentRequest, choice: ConsentChoice) => {
    if (!user || !requestId || busy) return;
    setBusy(true);
    setProblem('');
    try {
      const { redirect } = await manage<{ redirect: string }>(user.uid, '/consent/' + encodeURIComponent(requestId), {
        method: 'POST',
        body: JSON.stringify({ choice }),
      });
      // The request is used up now; keep it out of the address bar so a reload does not retry it.
      window.history.replaceState(window.history.state, '', home + 'connect');
      setPhase({ step: 'done', consent, choice, link: redirect });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Orbit could not complete this request.';
      if (/expired|not found/i.test(message)) setPhase({ step: 'error', kind: 'expired', message });
      else setProblem(message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };

  if (phase.step === 'loading') {
    return (
      <Shell>
        <Header />
        <p className="connect-wait" role="status">{tr('Checking the connection request…')}</p>
      </Shell>
    );
  }

  if (phase.step === 'error') {
    const text = {
      missing: [tr('No connection request'), tr('Start connecting from your AI app, such as Claude, and it will bring you back here.')],
      expired: [tr('This request has expired'), tr('Connection requests last 10 minutes and work once. Go back to your AI app and connect again.')],
      unavailable: [tr('AI connections are not set up'), tr('This copy of Orbit has no AI service or sign-in configured.')],
      other: [tr('Something went wrong'), tr(phase.message ?? 'Orbit could not complete this request.')],
    }[phase.kind];
    return (
      <Shell>
        <Header />
        <div className="connect-state">
          <span className="connect-state-icon is-muted">{phase.kind === 'expired' ? <Clock size={26} /> : <X size={26} />}</span>
          <h1>{text[0]}</h1>
          <p className="connect-sub">{text[1]}</p>
        </div>
        <div className="connect-actions">
          {phase.kind === 'other' && (
            <button type="button" className="connect-btn primary" onClick={() => load()}>
              {tr('Try again')}
            </button>
          )}
          <a className="connect-btn" href={home}>
            {tr('Open Orbit')}
          </a>
        </div>
      </Shell>
    );
  }

  if (phase.step === 'sign-in') {
    return (
      <Shell>
        <Header />
        <h1>{tr('Sign in to connect')}</h1>
        <p className="connect-sub">{tr('An AI app wants to use your Orbit notes. Sign in with the Google account you use for Orbit cloud sync first.')}</p>
        <div className="connect-actions">
          <button type="button" className="connect-btn primary" disabled={busy} onClick={() => void signIn(signInWithGoogle)}>
            <LogIn size={17} /> {tr('Sign in with Google')}
          </button>
          {googleDirectAvailable && (
            <button type="button" className="connect-btn ghost" disabled={busy} onClick={() => void signIn(signInWithFirebasePopup)}>
              {tr('Other sign-in method')}
            </button>
          )}
        </div>
        {problem && <p className="connect-problem" role="alert">{problem}</p>}
      </Shell>
    );
  }

  const client = clip(phase.consent.name.trim() || tr('An AI app'), 60);
  const destination = phase.consent.destination;

  if (phase.step === 'done') {
    const allowed = phase.choice !== 'deny';
    return (
      <Shell>
        <Header client={client} />
        <div className="connect-state">
          <span className={`connect-state-icon ${allowed ? 'is-ok' : 'is-muted'}`}>{allowed ? <Check size={28} /> : <X size={26} />}</span>
          <h1>{allowed ? tr('{client} is connected', { client }) : tr('Connection cancelled')}</h1>
          <p className="connect-sub">
            {allowed
              ? tr(phase.choice === 'write' ? 'It can read and edit your synced notes.' : 'It can read your synced notes, but not change them.')
              : tr('{client} did not get access to Orbit.', { client })}
          </p>
        </div>
        <div className="connect-actions">
          <a className="connect-btn primary" href={phase.link}>
            {tr('Return to {destination}', { destination })}
          </a>
          <button type="button" className="connect-btn" onClick={() => void copy(phase.link)}>
            {copied === 'yes' ? <Check size={16} /> : <Copy size={16} />} {copied === 'yes' ? tr('Copied') : tr('Copy link')}
          </button>
        </div>
        {copied === 'failed' && <input className="connect-link-field" readOnly value={phase.link} onFocus={(e) => e.currentTarget.select()} aria-label={tr('Return link')} />}
        <p className="connect-note">{tr('Started connecting in another browser or app? Copy the link and open it there. It works once and expires in a few minutes.')}</p>
        {allowed && (
          <a className="connect-footer-link" href={home + 'settings'}>
            {tr('Manage AI connections in Settings')}
          </a>
        )}
      </Shell>
    );
  }

  const { consent } = phase;
  const canDo = [
    'Search and read the notes, daily notes and to-dos synced to your Orbit account',
    'See the list of changes AI apps have made',
    ...(scope === 'write'
      ? ['Create notes and add to or edit their content', 'Add to-dos, check them off and change their dates', 'Move notes to Trash (you can restore them)']
      : []),
  ];
  const cannot = [
    ...(scope === 'read' ? ['Change, add or move any note'] : []),
    'Delete notes for good',
    'See anything that is only on this device and not synced',
    'Use your Google account or password',
  ];

  return (
    <Shell>
      <Header client={client} />
      <h1>{tr('Connect {client} to Orbit', { client })}</h1>
      <p className="connect-sub">{tr('{client} wants to use your Orbit notes.', { client })}</p>
      <p className="connect-dest" title={tr('The app name is chosen by the app itself; this address is where the answer really goes.')}>
        <ArrowLeftRight size={14} />
        <span>{tr('Answer goes to')}</span>
        <strong>{destination}</strong>
      </p>

      <div className="connect-section">
        <span className="connect-label">{tr('Orbit account')}</span>
        <div className="connect-account">
          <Avatar className="connect-avatar" name={user?.displayName || user?.email || '?'} photo={user?.photoURL} />
          <div className="connect-account-text">
            <strong>{user?.displayName || user?.email}</strong>
            {user?.displayName && user.email && <span>{user.email}</span>}
          </div>
        </div>
      </div>

      {consent.canWrite ? (
        <div className="connect-section" role="radiogroup" aria-label={tr('Access level')}>
          <span className="connect-label">{tr('Access level')}</span>
          <div className="connect-scopes">
            {(['write', 'read'] as const).map((s) => (
              <label key={s} className={`connect-scope${scope === s ? ' is-active' : ''}`}>
                <input type="radio" name="connect-scope" value={s} checked={scope === s} onChange={() => setScope(s)} />
                <span>
                  <strong>{tr(s === 'write' ? 'Read and edit' : 'Read only')}</strong>
                  <small>{tr(s === 'write' ? 'For asking AI to write and tidy notes for you' : 'For asking questions about your notes')}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : (
        <p className="connect-pill">{tr('{client} asked for read-only access.', { client })}</p>
      )}

      <div className="connect-section">
        <span className="connect-label">{tr('{client} will be able to', { client })}</span>
        <ul className="connect-list is-can">
          {canDo.map((item) => (
            <li key={item}>
              <Check size={16} />
              {tr(item)}
            </li>
          ))}
        </ul>
        <span className="connect-label">{tr('It will not be able to')}</span>
        <ul className="connect-list is-cannot">
          {cannot.map((item) => (
            <li key={item}>
              <X size={16} />
              {tr(item)}
            </li>
          ))}
        </ul>
      </div>

      <p className="connect-safety">
        <ShieldCheck size={16} />
        <span>{tr('Every change an AI app makes is recorded. In Settings → AI access you can see or undo it, and remove this connection at any time.')}</span>
      </p>

      {problem && <p className="connect-problem" role="alert">{tr(problem)}</p>}
      <p className="connect-note">{tr('After you choose, Orbit sends the answer to {destination}. Only continue if you started connecting there.', { destination })}</p>
      {/* Last in the card so it can stay pinned to the bottom of a phone screen while reading. */}
      <div className="connect-actions is-sticky">
        <button type="button" className="connect-btn primary" disabled={busy} onClick={() => void decide(consent, scope)}>
          {busy ? tr('Connecting…') : tr('Allow access')}
        </button>
        <button type="button" className="connect-btn" disabled={busy} onClick={() => void decide(consent, 'deny')}>
          {tr('Cancel')}
        </button>
      </div>
    </Shell>
  );
}
