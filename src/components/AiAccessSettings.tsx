import { useEffect, useRef, useState } from 'react';
import { usePwa } from '../lib/pwa';
import { relativeTime } from '../lib/dates';
import { uid } from '../lib/uid';
import { useT } from '../store/uiStore';
import { useSync } from '../sync/engine';
import { fb } from '../sync/firebase';

type Connection = {
  id: string; name: string; kind: 'mcp' | 'api'; scopes: string[]; expiresAt: number; revokedAt: number | null;
};
type Change = {
  id: string; title: string; action: keyof typeof actions; actor: string; created_at: number; has_previous_version: boolean;
};
type ChangePage = { changes: Change[]; next_cursor: string | null };
type ChangeDetail = Change & { before: { title: string; text: string; next_offset: number | null } | null };
type Consent = { name: string; canWrite: boolean; destination: string };

const actions = {
  create_note: 'Created note', append_daily_note: 'Appended to daily note', append_to_note: 'Appended to note',
  update_note: 'Edited note', add_task: 'Added task', update_task: 'Updated task',
  trash_note: 'Moved note to Trash', restore_note: 'Restored note', undo_change: 'Undid change',
} as const;

function readService() {
  const setting = import.meta.env.VITE_ORBIT_AI_URL;
  if (!setting) return null;
  try {
    const url = new URL(setting);
    const dev = import.meta.env.DEV && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    return (url.protocol === 'https:' || dev) && !url.username && !url.password &&
      url.pathname === '/' && !url.search && !url.hash ? url.origin : null;
  } catch {
    return null;
  }
}
const service = readService();

async function manage<T>(account: string, path: string, options: RequestInit = {}): Promise<T> {
  const user = fb().auth.currentUser;
  if (!user || user.uid !== account) throw new Error('Sign in to Orbit first.');
  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch(service + '/manage' + path, {
      ...options, headers: { Authorization: 'Bearer ' + token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch {
    throw new Error('Could not reach the Orbit AI service.');
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? 'Orbit could not complete this request.');
  return data as T;
}

function ConnectedAiSettings({ account, email, requestId }: { account: string; email: string; requestId: string | null }) {
  const tr = useT();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [history, setHistory] = useState<Change[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChangeDetail | null>(null);
  const [consent, setConsent] = useState<Consent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [newToken, setNewToken] = useState('');
  const [returnLink, setReturnLink] = useState('');
  const [copied, setCopied] = useState(false);
  const undoRequests = useRef(new Map<string, string>());

  async function refresh(signal?: AbortSignal) {
    const [clients, changes] = await Promise.all([
      manage<{ grants: Connection[] }>(account, '/connections', { signal }),
      manage<ChangePage>(account, '/changes', { signal }),
    ]);
    setConnections(clients.grants);
    setHistory(changes.changes);
    setNext(changes.next_cursor);
  }

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    const work = requestId
      ? manage<Consent>(account, '/consent/' + encodeURIComponent(requestId), { signal: controller.signal }).then(setConsent)
      : refresh(controller.signal);
    void work.catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message);
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [account, requestId]);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try { await fn(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Orbit could not complete this request.'); }
    finally { setBusy(false); }
  }

  const message = error ? <p className="banner warn" role="alert">{tr(error)}</p> : null;
  if (requestId) {
    function decide(choice: 'read' | 'write' | 'deny') {
      return run(async () => {
        const { redirect } = await manage<{ redirect: string }>(account, '/consent/' + encodeURIComponent(requestId!), {
          method: 'POST', body: JSON.stringify({ choice }),
        });
        setReturnLink(redirect);
        // In the installed app the AI client's page is open in the browser, not here,
        // so show the link to copy instead of leaving the app.
        if (!usePwa.getState().installed) window.location.replace(redirect);
      });
    }
    if (returnLink) {
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(returnLink);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      };
      return <>
        <p>{tr('Copy this link and open it in the browser where you started connecting. It works once and expires in a few minutes.')}</p>
        <div className="btn-row orbit-ai-form">
          <input readOnly value={returnLink} onFocus={(event) => event.currentTarget.select()} aria-label={tr('Return link')} />
        </div>
        <div className="btn-row">
          <button className="btn primary" type="button" onClick={() => void copy()}>{copied ? tr('Copied') : tr('Copy link')}</button>
          <a className="btn" href={returnLink} target="_blank" rel="noopener noreferrer">{tr('Open in browser')}</a>
        </div>
      </>;
    }
    return <>
      {consent && <>
        <p>{tr('{client} wants to connect to Orbit. The authorization will return to {destination}.', { client: consent.name, destination: consent.destination })}</p>
        <p className="muted">{tr('Signing in as {account}', { account: email })}</p>
        <div className="btn-row">
          <button className="btn primary" type="button" disabled={busy} onClick={() => void decide('read')}>{tr('Allow read only')}</button>
          {consent.canWrite && <button className="btn" type="button" disabled={busy} onClick={() => void decide('write')}>{tr('Allow read and write')}</button>}
          <button className="btn" type="button" disabled={busy} onClick={() => void decide('deny')}>{tr('Decline')}</button>
        </div>
      </>}
      {message}
    </>;
  }

  const active = connections.filter((client) => !client.revokedAt && client.expiresAt > Date.now());
  return <>
    <p className="muted">{tr('AI connections can access the notes synced to this Orbit account.')}</p>
    <p><code>{service}/mcp</code></p>
    <h4>{tr('Connected clients')}</h4>
    {active.length === 0 && <p className="muted">{tr('No active AI connections.')}</p>}
    {active.map((client) => (
      <div className="btn-row" key={client.id}>
        <span>{client.name} · {client.kind.toUpperCase()} · {tr(client.scopes.includes('orbit:write') ? 'Read and write' : 'Read only')}</span>
        <button className="btn" type="button" disabled={busy} onClick={() => void run(async () => {
          await manage(account, '/connections/' + client.id, { method: 'DELETE' });
          setConnections((items) => items.filter((item) => item.id !== client.id));
          setNotice('Connection revoked.');
        })}>{tr('Revoke access')}</button>
      </div>
    ))}
    <h4>{tr('API token')}</h4>
    <form className="btn-row orbit-ai-form" onSubmit={(event) => {
      event.preventDefault();
      if (!name.trim()) return;
      void run(async () => {
        const result = await manage<{ token: string }>(account, '/connections', {
          method: 'POST', body: JSON.stringify({ name, scope }),
        });
        setNewToken(result.token);
        setName('');
        await refresh();
      });
    }}>
      <input aria-label={tr('Connection name')} placeholder={tr('Connection name')} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
      <select aria-label={tr('Access level')} value={scope} onChange={(event) => setScope(event.target.value === 'write' ? 'write' : 'read')}>
        <option value="read">{tr('Read only')}</option>
        <option value="write">{tr('Read and write')}</option>
      </select>
      <button className="btn" disabled={busy || !name.trim()} type="submit">{tr('Create token')}</button>
    </form>
    {newToken && <div className="btn-row orbit-ai-form">
      <input readOnly value={newToken} aria-label={tr('New API token')} onFocus={(event) => event.currentTarget.select()} />
      <button className="btn" type="button" onClick={() => setNewToken('')}>{tr('Hide token')}</button>
    </div>}
    <h4>{tr('AI change history')}</h4>
    {history.length === 0 && <p className="muted">{tr('No AI changes yet.')}</p>}
    {history.map((change) => (
      <div key={change.id} className="orbit-ai-change">
        <strong>{change.title || tr('Untitled')}</strong>
        <p className="muted small">{tr(actions[change.action])} · {change.actor} · {relativeTime(change.created_at, tr)}</p>
        <div className="btn-row">
          {change.has_previous_version && <button className="btn" type="button" disabled={busy} onClick={() => void run(async () => {
            setDetail((await manage<ChangeDetail>(account, '/changes/' + change.id)));
          })}>{tr('View previous version')}</button>}
          <button className="btn" type="button" disabled={busy} onClick={() => {
            if (!window.confirm(tr('Undo this AI change? Orbit will check for newer edits first.'))) return;
            void run(async () => {
              const id = undoRequests.current.get(change.id) ?? uid();
              undoRequests.current.set(change.id, id);
              await manage(account, '/changes/' + change.id + '/undo', { method: 'POST', body: JSON.stringify({ request_id: id }) });
              undoRequests.current.delete(change.id);
              setNotice('Change undone.');
              setDetail(null);
              await refresh();
            });
          }}>{tr('Undo change')}</button>
        </div>
        {detail?.id === change.id && detail.before && <div className="orbit-ai-preview">
          <strong>{detail.before.title || tr('Untitled')}</strong>
          <p>{detail.before.text}</p>
          {detail.before.next_offset && <p className="muted">{tr('Preview shows the first part of this note.')}</p>}
          <button className="btn" type="button" onClick={() => setDetail(null)}>{tr('Close preview')}</button>
        </div>}
      </div>
    ))}
    {next && <button className="btn" type="button" disabled={busy} onClick={() => void run(async () => {
      const page = await manage<ChangePage>(account, '/changes?before=' + encodeURIComponent(next));
      setHistory((items) => [...items, ...page.changes]);
      setNext(page.next_cursor);
    })}>{tr('Load older changes')}</button>}
    {notice && <p role="status">{tr(notice)}</p>}
    {message}
  </>;
}

export function AiAccessSettings() {
  const tr = useT();
  const user = useSync((state) => state.user);
  const requestId = typeof window === 'undefined' ? null : new URLSearchParams(window.location.hash.slice(1)).get('ai_request');
  return <section className="card-section" id="ai-access">
    <h3>{tr('AI access')}</h3>
    {!service ? <p className="muted">{tr('The Orbit AI service has not been set up.')}</p> :
      !user ? <p className="muted">{tr('Sign in under Cloud Sync above to manage AI access.')}</p> :
      <ConnectedAiSettings key={user.uid + (requestId ?? '')} account={user.uid} email={user.email ?? user.uid} requestId={requestId} />}
  </section>;
}
