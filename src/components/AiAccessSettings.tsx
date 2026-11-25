import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, Eye, FilePlus2, KeyRound, ListPlus, ListTodo, Pencil, Plug, RotateCcw, TextCursorInput, Trash2, Undo2, Unplug, X } from 'lucide-react';
import { relativeTime, shortDate, toISODate } from '../lib/dates';
import { uid } from '../lib/uid';
import { useT } from '../store/uiStore';
import { useSync } from '../sync/engine';
import { aiService as service, manage, readConsentRequestId } from '../sync/aiService';
import { SettingsSection } from './SettingsSection';

type Connection = {
  id: string; name: string; kind: 'mcp' | 'api'; scopes: string[]; createdAt?: number; expiresAt: number; revokedAt: number | null;
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

const actionIcon: Record<keyof typeof actions, React.ReactNode> = {
  create_note: <FilePlus2 size={16} />, append_daily_note: <TextCursorInput size={16} />, append_to_note: <TextCursorInput size={16} />,
  update_note: <Pencil size={16} />, add_task: <ListPlus size={16} />, update_task: <ListTodo size={16} />,
  trash_note: <Trash2 size={16} />, restore_note: <RotateCcw size={16} />, undo_change: <Undo2 size={16} />,
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const tr = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ai-copy"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        } catch {
          window.prompt(label, text);
        }
      }}
    >
      {done ? <Check size={15} /> : <Copy size={15} />} {done ? tr('Copied') : tr('Copy')}
    </button>
  );
}

function ConnectedAiSettings({ account, onCount }: { account: string; onCount: (n: number) => void }) {
  const tr = useT();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [history, setHistory] = useState<Change[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChangeDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [newToken, setNewToken] = useState<{ token: string; name: string; expiresAt?: number } | null>(null);
  const undoRequests = useRef(new Map<string, string>());

  async function refresh(signal?: AbortSignal) {
    const [clients, changes] = await Promise.all([
      manage<{ grants: Connection[] }>(account, '/connections', { signal }),
      manage<ChangePage>(account, '/changes', { signal }),
    ]);
    setConnections(clients.grants);
    setHistory(changes.changes);
    setNext(changes.next_cursor);
    setLoaded(true);
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

  const active = connections.filter((client) => !client.revokedAt && client.expiresAt > Date.now());
  useEffect(() => onCount(active.length), [active.length, onCount]);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try { await fn(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Orbit could not complete this request.'); }
    finally { setBusy(false); }
  }

  const mcpUrl = `${service}/mcp`;

  return (
    <div className="ai-settings">
      <p className="ai-lead">{tr('AI connections can access the notes synced to this Orbit account.')}</p>

      <div className="ai-block">
        <div className="ai-block-head">
          <Plug size={16} />
          <h4>{tr('Connector address')}</h4>
        </div>
        <p className="ai-help">{tr('Paste this into an AI app such as Claude when adding a custom connector. It will open Orbit to ask for your approval.')}</p>
        <div className="ai-field">
          <code>{mcpUrl}</code>
          <CopyButton text={mcpUrl} label={tr('Copy connector address')} />
        </div>
      </div>

      <div className="ai-block">
        <div className="ai-block-head">
          <Bot size={16} />
          <h4>{tr('Connected apps')}</h4>
          <span className="ai-count">{active.length}</span>
        </div>
        {!loaded && busy && <p className="ai-help">{tr('Loading…')}</p>}
        {loaded && active.length === 0 && <p className="ai-empty">{tr('No active AI connections.')}</p>}
        <ul className="ai-list">
          {active.map((client) => {
            const write = client.scopes.includes('orbit:write');
            return (
              <li key={client.id} className="ai-conn">
                <span className="ai-avatar" aria-hidden="true">{Array.from(client.name.trim())[0]?.toUpperCase() ?? '?'}</span>
                <div className="ai-conn-main">
                  <div className="ai-conn-name">
                    <strong>{client.name}</strong>
                    <span className="ai-chip">{client.kind === 'mcp' ? tr('Connector') : tr('API token')}</span>
                    <span className={`ai-chip ${write ? 'is-write' : ''}`}>{tr(write ? 'Read and write' : 'Read only')}</span>
                  </div>
                  <div className="ai-conn-meta">
                    {client.createdAt ? tr('Connected {time}', { time: relativeTime(client.createdAt, tr) }) + ' · ' : ''}
                    {tr('Expires {date}', { date: shortDate(toISODate(new Date(client.expiresAt)), tr) })}
                  </div>
                </div>
                <button
                  type="button"
                  className="ai-revoke"
                  disabled={busy}
                  aria-label={tr('Revoke access for {name}', { name: client.name })}
                  title={tr('Revoke access')}
                  onClick={() => {
                    if (!window.confirm(tr('Revoke access for {name}? It will no longer be able to read or change your notes.', { name: client.name }))) return;
                    void run(async () => {
                      await manage(account, '/connections/' + client.id, { method: 'DELETE' });
                      setConnections((items) => items.filter((item) => item.id !== client.id));
                      setNotice('Connection revoked.');
                    });
                  }}
                >
                  <Unplug size={16} />
                  <span>{tr('Revoke')}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="ai-block">
        <div className="ai-block-head">
          <KeyRound size={16} />
          <h4>{tr('API token')}</h4>
        </div>
        <p className="ai-help">{tr('For scripts and tools that cannot sign in themselves. A token works for 30 days and can be revoked above.')}</p>
        {newToken ? (
          <div className="ai-token">
            <div className="ai-token-head">
              <Check size={16} />
              <strong>{tr('Token for “{name}” created', { name: newToken.name })}</strong>
            </div>
            <p className="ai-help">{tr('Copy it now. Orbit shows it only once.')}</p>
            <div className="ai-field">
              <code className="is-secret">{newToken.token}</code>
              <CopyButton text={newToken.token} label={tr('Copy token')} />
            </div>
            <button type="button" className="btn" onClick={() => setNewToken(null)}>
              {tr('Hide token')}
            </button>
          </div>
        ) : (
          <form
            className="ai-form"
            onSubmit={(event) => {
              event.preventDefault();
              const tokenName = name.trim();
              if (!tokenName) return;
              void run(async () => {
                const result = await manage<{ token: string; expiresAt?: number }>(account, '/connections', {
                  method: 'POST', body: JSON.stringify({ name: tokenName, scope }),
                });
                setNewToken({ token: result.token, name: tokenName, expiresAt: result.expiresAt });
                setName('');
                await refresh();
              });
            }}
          >
            <input aria-label={tr('Connection name')} placeholder={tr('Name, e.g. Shortcuts on my phone')} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
            <div className="segmented ai-scope" role="radiogroup" aria-label={tr('Access level')}>
              {(['read', 'write'] as const).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={scope === s} className={scope === s ? 'active' : ''} onClick={() => setScope(s)}>
                  {tr(s === 'read' ? 'Read only' : 'Read and write')}
                </button>
              ))}
            </div>
            <button className="btn primary" disabled={busy || !name.trim()} type="submit">
              {tr('Create token')}
            </button>
          </form>
        )}
      </div>

      <div className="ai-block">
        <div className="ai-block-head">
          <Undo2 size={16} />
          <h4>{tr('AI change history')}</h4>
        </div>
        {loaded && history.length === 0 && <p className="ai-empty">{tr('No AI changes yet.')}</p>}
        <ul className="ai-list">
          {history.map((change) => (
            <li key={change.id} className="ai-change">
              <span className="ai-change-icon" aria-hidden="true">{actionIcon[change.action] ?? <Pencil size={16} />}</span>
              <div className="ai-change-main">
                <strong>{change.title || tr('Untitled')}</strong>
                <span className="ai-conn-meta">
                  {tr(actions[change.action])} · {change.actor} · {relativeTime(change.created_at, tr)}
                </span>
                <div className="ai-change-actions">
                  {change.has_previous_version && (
                    <button type="button" className="ai-mini" disabled={busy} onClick={() => void run(async () => {
                      setDetail(detail?.id === change.id ? null : await manage<ChangeDetail>(account, '/changes/' + change.id));
                    })}>
                      <Eye size={14} /> {detail?.id === change.id ? tr('Close preview') : tr('View previous version')}
                    </button>
                  )}
                  <button type="button" className="ai-mini" disabled={busy} onClick={() => {
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
                  }}>
                    <Undo2 size={14} /> {tr('Undo change')}
                  </button>
                </div>
                {detail?.id === change.id && detail.before && (
                  <div className="ai-preview">
                    <div className="ai-preview-head">
                      <strong>{detail.before.title || tr('Untitled')}</strong>
                      <button type="button" className="icon-btn tiny" aria-label={tr('Close preview')} onClick={() => setDetail(null)}>
                        <X size={14} />
                      </button>
                    </div>
                    <p>{detail.before.text}</p>
                    {detail.before.next_offset && <p className="ai-help">{tr('Preview shows the first part of this note.')}</p>}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        {next && (
          <button type="button" className="ai-more" disabled={busy} onClick={() => void run(async () => {
            const page = await manage<ChangePage>(account, '/changes?before=' + encodeURIComponent(next));
            setHistory((items) => [...items, ...page.changes]);
            setNext(page.next_cursor);
          })}>
            {tr('Load older changes')}
          </button>
        )}
      </div>

      {notice && <p className="banner ok" role="status">{tr(notice)}</p>}
      {error && <p className="banner warn" role="alert">{tr(error)}</p>}
    </div>
  );
}

export function AiAccessSettings() {
  const tr = useT();
  const user = useSync((state) => state.user);
  const requestId = readConsentRequestId();
  const [count, setCount] = useState<number | null>(null);
  const summary = !service
    ? tr('The Orbit AI service has not been set up.')
    : !user
      ? tr('Sign in to manage AI access')
      : count == null
        ? tr('AI apps that can use your notes')
        : tr('{count} connected app(s)', { count });
  return (
    <SettingsSection id="ai-access" icon={<Bot size={18} />} tone="#6d5efc" title={tr('AI access')} summary={summary}>
      {requestId && <p className="banner"><a href={import.meta.env.BASE_URL + 'connect' + window.location.hash}>{tr('An AI app is waiting for your approval. Open the connect page')}</a></p>}
      {!service ? <p className="ai-help">{tr('The Orbit AI service has not been set up.')}</p> :
        !user ? <p className="ai-help">{tr('Sign in under Cloud Sync above to manage AI access.')}</p> :
        <ConnectedAiSettings key={user.uid} account={user.uid} onCount={setCount} />}
    </SettingsSection>
  );
}
