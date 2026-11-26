import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app';

const emulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
const server = createServer();
const callback = 'http://127.0.0.1:49312/return';
const appUrl = 'http://127.0.0.1:5175/orbit-notes/';
let firebase: App;
let base: string;
let db: ReturnType<typeof getFirestore>;

before(async () => {
  if (!emulators) return;
  const projectId = 'demo-orbit-ai';
  firebase = initializeApp({ projectId });
  db = getFirestore(firebase);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server not listening.');
  base = 'http://127.0.0.1:' + address.port;
  server.on('request', createApp({ db, auth: getAuth(firebase), serviceUrl: base, appUrl, redirectUris: [callback], local: true }));
});

after(async () => {
  if (!emulators) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.terminate();
  await deleteApp(firebase);
});

async function account() {
  const result = await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  assert.equal(result.status, 200);
  return await result.json() as { idToken: string; localId: string };
}

async function request(method: string, path: string, token?: string, body?: object, status = 200) {
  const response = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  assert.equal(response.status, status, raw);
  return { body: raw ? JSON.parse(raw) : null, headers: response.headers };
}

const manage = (token: string, path: string, body?: object, status = 200) =>
  request(body ? 'POST' : 'GET', '/manage' + path, token, body, status).then((r) => r.body);
const api = (token: string, name: string, input: object, status = 200) =>
  request('POST', '/api/v1/' + name, token, input, status).then((r) => r.body);
const write = () => ({ request_id: randomUUID() });

async function connectMcp(token: string) {
  const headers = { Authorization: 'Bearer ' + token };
  const client = new Client({ name: 'orbit-integration-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers } }));
  return client;
}

test('API isolates Firebase accounts and records recallable, versioned and retry-safe note changes', { skip: !emulators }, async () => {
  const alice = await account();
  const bob = await account();
  const writer = (await manage(alice.idToken, '/connections', { name: 'Test assistant', scope: 'write' }, 201)).token;
  const reader = (await manage(alice.idToken, '/connections', { name: 'Test reader', scope: 'read' }, 201)).token;
  const other = (await manage(bob.idToken, '/connections', { name: 'Other account', scope: 'write' }, 201)).token;
  await api(reader, 'create_note', { ...write(), title: 'blocked' }, 403);
  await api(alice.idToken, 'search_notes', {}, 401);

  const initial = { ...write(), title: '外賣備忘', text: '今晚上班前去跑步半小時 Toronto' };
  const created = await api(writer, 'create_note', initial);
  assert.equal((await api(writer, 'create_note', initial)).note_id, created.note_id);
  await api(writer, 'create_note', { ...initial, title: 'different' }, 409);
  const found = await api(reader, 'search_notes', { query: '跑步 toronto' });
  assert.deepEqual(found.notes.map((n: { id: string }) => n.id), [created.note_id]);
  await api(other, 'get_note', { note_id: created.note_id }, 404);
  assert.equal((await api(other, 'list_changes', {})).changes.length, 0);

  const task = await api(writer, 'add_task', { ...write(), note_id: created.note_id, text: '記錄里程', due: '2026-11-22', kind: 'task' });
  const view = await api(reader, 'get_note', { note_id: created.note_id });
  assert.equal(view.tasks[0].id, task.task_id);
  assert.equal(view.tasks[0].due, '2026-11-22');
  assert.equal(view.tasks[0].kind, 'task');
  assert.equal((await api(reader, 'list_tasks', { done: false, kind: 'task', due_from: '2026-11-22' })).tasks[0].id, task.task_id);
  assert.equal((await api(reader, 'list_tasks', { kind: 'todo' })).tasks.length, 0);
  assert.equal((await api(reader, 'list_tasks', { due_to: '2026-11-21' })).tasks.length, 0);
  const next = await api(writer, 'update_task', { ...write(), note_id: created.note_id, version: view.version, task_id: task.task_id, done: true, kind: 'todo' });
  assert.equal((await api(reader, 'list_tasks', { done: true, kind: 'todo' })).tasks[0].id, task.task_id);
  await api(writer, 'trash_note', { ...write(), note_id: created.note_id, version: view.version }, 409);
  const trash = await api(writer, 'trash_note', { ...write(), note_id: created.note_id, version: next.resulting_version });
  assert.equal((await api(reader, 'search_notes', { in_trash: true })).notes.length, 1);
  const restored = await api(writer, 'restore_note', { ...write(), note_id: created.note_id, version: trash.resulting_version });
  assert.equal(restored.note_id, created.note_id);
  await api(writer, 'undo_change', { ...write(), change_id: trash.id }, 409);
  const prior = await manage(alice.idToken, '/changes/' + trash.id);
  assert.match(prior.before.text, /跑步/);

  const append = await api(writer, 'append_to_note', { ...write(), note_id: created.note_id, text: '追加段落' });
  const undo = await manage(alice.idToken, '/changes/' + append.id + '/undo', write());
  assert.equal(undo.undone_change_id, append.id);
  assert.doesNotMatch((await api(reader, 'get_note', { note_id: created.note_id })).text, /追加段落/);
  const source = (await db.collection('users').doc(alice.localId).collection('objects').doc(created.note_id).get()).data();
  assert.equal(JSON.parse(source!.json).content.type, 'doc');
  const firestore = 'http://' + process.env.FIRESTORE_EMULATOR_HOST + '/v1/projects/demo-orbit-ai/databases/(default)/documents/';
  const headers = { Authorization: 'Bearer ' + alice.idToken };
  assert.equal((await fetch(firestore + 'users/' + alice.localId + '/objects/' + created.note_id, { headers })).status, 200);
  assert.equal((await fetch(firestore + 'orbitAiAccounts/' + alice.localId + '/changes/' + trash.id, { headers })).status, 403);

  const md = await api(writer, 'create_note', { ...write(), title: 'Markdown 筆記', text: '# 標題\n- 項目\n- [ ] 付帳單\n[網站](https://example.com)' });
  const mdView = await api(reader, 'get_note', { note_id: md.note_id });
  assert.equal(mdView.tasks.length, 1);
  assert.equal(mdView.tasks[0].text, '付帳單');
  const mdSaved = JSON.parse((await db.collection('users').doc(alice.localId).collection('objects').doc(md.note_id).get()).data()!.json);
  assert.deepEqual(mdSaved.content.content.map((b: { type: string }) => b.type), ['heading', 'bulletList', 'taskList', 'paragraph']);
  assert.equal(mdSaved.content.content[3].content[0].marks[0].attrs.href, 'https://example.com');
  await api(writer, 'update_note', { ...write(), note_id: md.note_id, version: mdView.version, replace_text: { from: '項目', to: 'x' }, replace_body: '新內容' }, 400);
  const rewritten = await api(writer, 'update_note', { ...write(), note_id: md.note_id, version: mdView.version, replace_body: '## 新的\n☑ 完成了' });
  const rewrittenView = await api(reader, 'get_note', { note_id: md.note_id });
  assert.equal(rewrittenView.text, '新的\n完成了');
  assert.equal(rewrittenView.tasks[0].done, true);
  await manage(alice.idToken, '/changes/' + rewritten.id + '/undo', write());
  assert.match((await api(reader, 'get_note', { note_id: md.note_id })).text, /付帳單/);
  const inserted = await api(writer, 'update_note', { ...write(), note_id: md.note_id, version: (await api(reader, 'get_note', { note_id: md.note_id })).version, insert_text: { anchor: '付帳單', text: '- [ ] 插入的待辦', position: 'before' } });
  const insertedView = await api(reader, 'get_note', { note_id: md.note_id });
  assert.deepEqual(insertedView.tasks.map((t: { text: string }) => t.text), ['插入的待辦', '付帳單']);
  await api(writer, 'update_note', { ...write(), note_id: md.note_id, version: inserted.resulting_version, insert_text: { anchor: '找不到', text: 'x' } }, 409);
  await api(writer, 'update_note', { ...write(), note_id: md.note_id, version: inserted.resulting_version, insert_text: { anchor: '標題', text: 'x' }, replace_body: 'y' }, 400);
  await manage(alice.idToken, '/changes/' + inserted.id + '/undo', write());

  // AI notes and the AI handbook
  assert.equal((await api(reader, 'get_ai_context', {})).handbook, null);
  await api(reader, 'add_ai_note', { ...write(), note_id: md.note_id, text: 'x' }, 403);
  const noted = await api(writer, 'add_ai_note', { ...write(), note_id: md.note_id, text: '把待辦改成插入的版本，等使用者確認。' });
  const mdWithNotes = await api(reader, 'get_note', { note_id: md.note_id });
  assert.deepEqual(mdWithNotes.ai_notes.map((n: { by: string; text: string }) => [n.by, n.text]), [['Test assistant', '把待辦改成插入的版本，等使用者確認。']]);
  assert.match(mdWithNotes.text, /付帳單/);
  assert.doesNotMatch(mdWithNotes.text, /等使用者確認/);
  await api(writer, 'add_ai_note', { ...write(), note_id: 'missing-note', text: 'x' }, 404);
  const handbookNote = await api(writer, 'add_ai_note', { ...write(), text: '使用者偏好說明書風格。' });
  assert.equal(handbookNote.note_id, 'ai-handbook');
  const context = await api(reader, 'get_ai_context', {});
  assert.equal(context.handbook.id, 'ai-handbook');
  assert.match(context.handbook.text, /關於我/);
  assert.deepEqual(context.handbook.ai_notes.map((n: { text: string }) => n.text), ['使用者偏好說明書風格。']);
  await api(writer, 'add_ai_note', { ...write(), text: '第二則' });
  assert.equal((await api(reader, 'get_ai_context', {})).handbook.ai_notes.length, 2);
  await manage(alice.idToken, '/changes/' + noted.id + '/undo', write());
  assert.equal((await api(reader, 'get_note', { note_id: md.note_id })).ai_notes.length, 0);

  await Promise.all(['第一段', '第二段'].map((text) => api(writer, 'append_daily_note', { ...write(), date: '2026-11-22', text })));
  const day = await api(reader, 'get_note', { note_id: 'daily-2026-11-22' });
  assert.match(day.text, /第一段/);
  assert.match(day.text, /第二段/);
  assert.match(day.url, /orbit-notes\/calendar/);
  assert.equal((await api(reader, 'list_changes', { limit: 1 })).changes.length, 1);
  const viaToken = await connectMcp(reader);
  const toolNames = (await viaToken.listTools()).tools.map((t) => t.name);
  assert.ok(toolNames.includes('search_notes'));
  assert.ok(!toolNames.includes('create_note'));
  await viaToken.close();
  const { grants } = await manage(alice.idToken, '/connections');
  const grant = grants.find((g: { name: string }) => g.name === 'Test assistant');
  await request('DELETE', '/manage/connections/' + grant.id, bob.idToken, undefined, 404);
  await request('DELETE', '/manage/connections/' + grant.id, alice.idToken, undefined, 204);
  await api(writer, 'search_notes', {}, 401);
});

test('MCP discovers OAuth, protects PKCE and callbacks, filters tool scopes and honours revocation', { skip: !emulators }, async () => {
  const alice = await account();
  const resource = base + '/mcp';
  const unauth = await request('POST', '/mcp', undefined, {}, 401);
  assert.match(unauth.headers.get('www-authenticate') ?? '', /oauth-protected-resource\/mcp/);
  const metadata = (await request('GET', '/.well-known/oauth-protected-resource/mcp')).body;
  assert.equal(metadata.resource, resource);
  assert.ok((await request('GET', '/.well-known/oauth-authorization-server')).body.code_challenge_methods_supported.includes('S256'));

  const reg = { client_name: 'MCP Test Client', token_endpoint_auth_method: 'none' };
  await request('POST', '/register', undefined, { ...reg, redirect_uris: ['https://untrusted.example/callback'] }, 400);
  const clientId = (await request('POST', '/register', undefined, { ...reg, redirect_uris: [callback] }, 201)).body.client_id;

  async function approval(choice: 'read' | 'write' | 'deny') {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: callback,
      code_challenge: challenge, code_challenge_method: 'S256', resource, state: 'client-state' });
    const result = await fetch(base + '/authorize?' + query, { redirect: 'manual' });
    assert.equal(result.status, 302);
    const consentUrl = new URL(result.headers.get('location')!);
    assert.equal(consentUrl.pathname, '/orbit-notes/');
    const id = new URLSearchParams(consentUrl.hash.slice(1)).get('ai_request')!;
    const info = await manage(alice.idToken, '/consent/' + id);
    assert.equal(info.name, 'MCP Test Client');
    assert.equal(info.canWrite, true);
    const response = await manage(alice.idToken, '/consent/' + id, { choice });
    const redirect = new URL(response.redirect);
    assert.equal(redirect.searchParams.get('state'), 'client-state');
    assert.equal(redirect.searchParams.get('iss'), base + '/');
    await manage(alice.idToken, '/consent/' + id, { choice }, 404);
    return { verifier, code: redirect.searchParams.get('code'), error: redirect.searchParams.get('error') };
  }

  async function token(body: Record<string, string>, status = 200) {
    const response = await fetch(base + '/token', {
      method: 'POST', body: new URLSearchParams({ ...body, client_id: clientId, resource }),
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }

  assert.equal((await approval('deny')).error, 'access_denied');
  const read = await approval('read');
  assert.ok(read.code);
  const codeParams = { grant_type: 'authorization_code', code: read.code, code_verifier: read.verifier, redirect_uri: callback };
  await token({ ...codeParams, code_verifier: randomBytes(32).toString('base64url') }, 400);
  const readToken = await token(codeParams);
  assert.equal(readToken.scope, 'orbit:read');
  await token(codeParams, 400);
  await api(readToken.access_token, 'search_notes', {}, 401);

  const reader = await connectMcp(readToken.access_token);
  const tools = (await reader.listTools()).tools.map((t) => t.name);
  assert.ok(tools.includes('search_notes'));
  assert.ok(!tools.includes('create_note'));
  assert.equal((await reader.callTool({ name: 'search_notes', arguments: {} })).isError, undefined);
  await reader.close();

  const full = await approval('write');
  const original = await token({ grant_type: 'authorization_code', code: full.code!, code_verifier: full.verifier, redirect_uri: callback });
  const refreshed = await token({ grant_type: 'refresh_token', refresh_token: original.refresh_token });
  await token({ grant_type: 'refresh_token', refresh_token: original.refresh_token }, 400);
  const writer = await connectMcp(refreshed.access_token);
  const tool = await writer.callTool({ name: 'create_note', arguments: { ...write(), title: 'MCP 筆記' } });
  assert.equal(tool.isError, undefined);
  const changes = await manage(alice.idToken, '/changes');
  assert.equal(changes.changes[0].title, 'MCP 筆記');
  await writer.close();

  const connections = await manage(alice.idToken, '/connections');
  const writable = connections.grants.find((g: { scopes: string[] }) => g.scopes.includes('orbit:write'));
  await request('DELETE', '/manage/connections/' + writable.id, alice.idToken, undefined, 204);
  await token({ grant_type: 'refresh_token', refresh_token: refreshed.refresh_token }, 400);
  await request('POST', '/mcp', refreshed.access_token, {}, 401);
});

test('AI workspace: where notes go, the daily AI log, AI to-dos and AI documents', { skip: !emulators }, async () => {
  const user = await account();
  const writer = (await manage(user.idToken, '/connections', { name: 'Claude', scope: 'write' }, 201)).token;
  const reader = (await manage(user.idToken, '/connections', { name: 'Reader', scope: 'read' }, 201)).token;
  const saved = async (noteId: string) => JSON.parse((await db.collection('users').doc(user.localId).collection('objects').doc(noteId).get()).data()!.json);

  // Notes an AI creates go to the AI workspace; a note the user asked for can go to their own space.
  const aiNote = await api(writer, 'create_note', { ...write(), title: 'AI 草稿' });
  const mine = await api(writer, 'create_note', { ...write(), title: '💰 財務進度網站', space: 'me' });
  assert.equal((await api(reader, 'get_note', { note_id: aiNote.note_id })).space, 'ai');
  assert.equal((await api(reader, 'get_note', { note_id: mine.note_id })).space, 'me');
  assert.equal((await saved(aiNote.note_id)).space, 'ai');
  assert.equal('space' in (await saved(mine.note_id)), false);
  assert.deepEqual((await api(reader, 'search_notes', { space: 'me' })).notes.map((n: { id: string }) => n.id), [mine.note_id]);
  assert.deepEqual((await api(reader, 'search_notes', { space: 'ai' })).notes.map((n: { id: string }) => n.id), [aiNote.note_id]);
  assert.equal((await api(reader, 'search_notes', {})).notes.length, 2);

  // Changing the user's note leaves it in their space.
  await api(writer, 'append_to_note', { ...write(), note_id: mine.note_id, text: '11 月數字已更新' });
  assert.equal((await api(reader, 'get_note', { note_id: mine.note_id })).space, 'me');

  // One log per day, laid out by Orbit.
  const entry = { date: '2026-11-26', time: '9:05', title: '整理財務筆記', done: '把三個帳戶的數字對齊', notes: [mine.note_id], open: ['補上 10 月的帳單'], confirm: ['新版數字請核對'] };
  await api(writer, 'log_ai_work', { ...write(), ...entry, time: '25:00' }, 400);
  await api(writer, 'log_ai_work', { ...write(), ...entry, notes: ['missing-note'] }, 404);
  await api(reader, 'log_ai_work', { ...write(), ...entry }, 403);
  const first = await api(writer, 'log_ai_work', { ...write(), ...entry });
  assert.equal(first.note_id, 'ai-log-2026-11-26');
  const second = await api(writer, 'log_ai_work', { ...write(), ...entry, time: '16:40', title: '第二段', open: undefined, confirm: undefined, notes: [] });
  const log = await api(reader, 'get_note', { note_id: 'ai-log-2026-11-26' });
  assert.equal(log.title, 'AI 日誌 · 2026-11-26（四）');
  assert.equal(log.type_id, 'ai-log');
  assert.equal(log.space, 'ai');
  assert.equal(log.daily_date, '2026-11-26');
  assert.match(log.text, /^09:05 · Claude · 整理財務筆記\n做了什麼：把三個帳戶的數字對齊\n改了哪些筆記：\[\[/);
  assert.match(log.text, new RegExp('\\[\\[' + mine.note_id + '\\]\\]'));
  assert.match(log.text, /16:40 · Claude · 第二段/);
  assert.deepEqual(log.tasks.map((t: { text: string; aiTodo: { kind: string; at: string } }) => [t.text, t.aiTodo.kind, t.aiTodo.at]), [['補上 10 月的帳單', 'next', '2026-11-26'], ['新版數字請核對', 'confirm', '2026-11-26']]);
  assert.equal(log.tasks[0].kind, 'todo');

  // The next session sees what was left for it, and how much waits for the user.
  const context = await api(reader, 'get_ai_context', {});
  assert.equal(context.handbook, null);
  assert.equal(context.ai_workspace.waiting_for_user, 1);
  assert.deepEqual(context.ai_workspace.next_time.map((t: { text: string }) => t.text), ['補上 10 月的帳單']);
  assert.deepEqual(context.ai_workspace.next_time[0].related_notes, [mine.note_id]);
  assert.equal(context.ai_workspace.recent_logs[0].id, 'ai-log-2026-11-26');
  assert.match(context.usage, /log_ai_work/);
  assert.deepEqual((await api(reader, 'list_tasks', { ai_todo: 'confirm' })).tasks.map((t: { text: string }) => t.text), ['新版數字請核對']);
  assert.equal((await api(reader, 'list_tasks', { ai_todo: 'next', done: false })).tasks.length, 1);
  await api(writer, 'update_task', { ...write(), note_id: log.id, version: log.version, task_id: log.tasks[0].id, done: true });
  assert.equal((await api(reader, 'get_ai_context', {})).ai_workspace.next_time.length, 0);

  // An AI to-do can also be added to any note.
  const asked = await api(writer, 'add_task', { ...write(), note_id: mine.note_id, text: '確認帳單金額', ai_todo: 'confirm', date: '2026-11-26' });
  const mineView = await api(reader, 'get_note', { note_id: mine.note_id });
  assert.deepEqual(mineView.tasks.find((t: { id: string }) => t.id === asked.task_id).aiTodo, { kind: 'confirm', at: '2026-11-26' });

  // AI documents: dated title, source, status and related notes; they stay in the AI workspace.
  const report = await api(writer, 'create_note', { ...write(), type_id: 'ai-doc', title: 'Notion 全面掃描報告', date: '2026-11-25', status: 'review', related_notes: [mine.note_id], text: '## 結果\n- 找到 3 個重複頁面' });
  const doc = await saved(report.note_id);
  assert.equal(doc.title, 'Notion 全面掃描報告（2026-11-25）');
  assert.equal(doc.typeId, 'ai-doc');
  assert.equal(doc.space, 'ai');
  assert.deepEqual(doc.props, { source: 'Claude', date: '2026-11-25', status: 'To review', related: [mine.note_id] });
  assert.equal((await api(reader, 'search_notes', { type_id: 'ai-doc' })).notes.length, 1);
  await api(writer, 'create_note', { ...write(), type_id: 'ai-doc', title: 'x', space: 'me' }, 400);
  await api(writer, 'create_note', { ...write(), type_id: 'ai-log', title: 'x' }, 400);
  await api(writer, 'create_note', { ...write(), title: 'x', status: 'review' }, 400);
  await api(writer, 'create_note', { ...write(), type_id: 'ai-doc', title: 'x', related_notes: ['missing-note'] }, 404);

  // Undo removes one log entry and keeps the rest.
  await manage(user.idToken, '/changes/' + second.id + '/undo', write(), 409); // the log changed since (a task was completed)
  const firstUndoable = await api(writer, 'log_ai_work', { ...write(), ...entry, time: '18:00', title: '第三段', open: undefined, confirm: undefined, notes: [] });
  await manage(user.idToken, '/changes/' + firstUndoable.id + '/undo', write());
  const afterUndo = await api(reader, 'get_note', { note_id: 'ai-log-2026-11-26' });
  assert.doesNotMatch(afterUndo.text, /第三段/);
  assert.match(afterUndo.text, /第二段/);

  // Each MCP tool is offered to writers only.
  const viaToken = await connectMcp(writer);
  assert.ok((await viaToken.listTools()).tools.some((t) => t.name === 'log_ai_work'));
  await viaToken.close();
});
