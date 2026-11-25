import { useEffect, useRef, useState } from 'react';
import { relativeTime } from '../lib/dates';
import { uid } from '../lib/uid';
import { useT } from '../store/uiStore';
import { useSync } from '../sync/engine';
import { aiService as service, manage, readConsentRequestId } from '../sync/aiService';

type Connection = {
  id: string; name: string; kind: 'mcp' | 'api'; scopes: string[]; expiresAt: number; revokedAt: number | null;
};
type Change = {
  id: string; title: string; action: keyof typeof actions; actor: string; created_at: number; has_previous_version: boolean;
};
type ChangePage = { changes: Change[]; next_cursor: string | null };
type ChangeDetail = Change & { before: { title: string; text: string; next_offset: number | null } | null };

const actions = {
  create_note: 'Created note', append_daily_note: 'Appended to daily note', append_to_note: 'Appended to note',
  update_note: 'Edited note', add_task: 'Added task', update_task: 'Updated task',
  trash_note: 'Moved note to Trash', restore_note: 'Restored note', undo_change: 'Undid change',
} as const;

function ConnectedAiSettings({ account }: { account: string }) {
  const tr = useT();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [history, setHistory] = useState<Change[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChangeDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [newToken, setNewToken] = useState('');
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
    void refresh(controller.signal).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message);
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [account]);

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
  const requestId = readConsentRequestId();
  return <section className="card-section" id="ai-access">
    <h3>{tr('AI access')}</h3>
    {requestId && <p className="banner"><a href={import.meta.env.BASE_URL + 'connect' + window.location.hash}>{tr('An AI app is waiting for your approval. Open the connect page')}</a></p>}
    {!service ? <p className="muted">{tr('The Orbit AI service has not been set up.')}</p> :
      !user ? <p className="muted">{tr('Sign in under Cloud Sync above to manage AI access.')}</p> :
      <ConnectedAiSettings key={user.uid} account={user.uid} />}
  </section>;
}
