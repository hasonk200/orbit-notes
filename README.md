# Orbit

A personal, local-first notes and life manager built on typed objects (Pages, People, Projects, Books, Ideas, Meetings, Daily Notes and your own custom types), with links, backlinks, tasks, a calendar, tags, search and a graph.

## Run

```
npm install
npm run dev
```

Then open http://localhost:5175. To build a production version, run `npm run build` (the output goes to `dist/`).

## Where your data lives

Everything is stored in your browser's IndexedDB for this address (`localhost:5175`). Back up regularly:

- **Settings → Export .zip backup**: a versioned archive with `data.json` plus a `media/` folder of images.
- **Settings → Backup to a local folder** (Chrome/Edge): writes dated zips to a folder you choose, keeps the newest 14, and backs up quietly once a day.
- **Settings → Import backup**: replaces all current data with a backup.

## Writing

Choose **English** or **繁體中文** in **Settings → Appearance → Language**. Search finds Chinese phrases inside unspaced text and supports mixed Chinese and English queries. Date shortcuts accept both `@tomorrow` and `@明天`.

| Type | Does |
| --- | --- |
| `/` | Command menu: headings, lists, tasks, quote, code, divider, image |
| `[[` | Link to an object, or create a new one |
| `#` | Add a tag |
| `@` | Insert a date; inside a task it sets the due date (`@today`, `@tomorrow`, `@fri`, `@2026-12-24`, `@+3`) |
| `[ ] ` | Start a task |
| Paste / drop an image | Compressed and stored as a binary blob |

## Shortcuts

- `Ctrl+K`: search and commands
- `Ctrl+Shift+D`: today's note
- `Ctrl+\`: toggle the sidebar
- `Alt+Click` a link: open it in split view

## Connect AI to Orbit

Sign in to Orbit and turn on Cloud Sync. AI tools use the synced copy of your account. Changes appear in Orbit through normal cloud sync. Choose **Settings → AI access** to approve a client for read-only or read/write access, issue an API token, revoke a connection, inspect previous versions or undo an AI change.

- **MCP** uses the service URL followed by `/mcp` and OAuth with PKCE. Add that address to a compatible MCP client. During connection, Orbit shows the Firebase account, the requesting client and its callback host. Read-only connections see only read tools.
- **HTTP API** uses `POST /api/v1/<operation>` with a JSON body and `Authorization: Bearer <token>`. Create a scoped token in Orbit settings. It is displayed once and expires in 30 days. MCP access tokens apply to the MCP endpoint and renew through OAuth for up to 90 days, unless you revoke the connection earlier.
- Use `search_notes`, `get_note`, `list_tasks`, `list_changes` and `get_change` to read. Write operations include `create_note`, `append_to_note`, `append_daily_note`, `update_note`, `add_task`, `update_task`, `trash_note`, `restore_note` and `undo_change`. The MCP tool list describes the arguments. Search and task lists return a cursor if there is more to scan. For date ranges, daily notes use their local calendar date and other notes use the UTC date of their latest edit.
- Each write requires a unique UUID in `request_id`. Reuse it only to retry the same write with the same connection. Editing, trashing or restoring a note requires the current `version` returned by a read. Appending to an existing note uses a transaction on the latest synced content. AI deletions go to Trash. Undo applies the saved previous version only while the current synced version matches the change being undone. Undoing a creation moves the new note to Trash.

### Deploy the integration

1. Install the app and Functions dependencies with `npm ci` and `npm --prefix functions ci`. Use Node 22 for the deployed function. Enable Firebase Cloud Functions billing on the existing Orbit project and sign the Firebase CLI in to an account with deployment access. The function's runtime service account needs Firestore read/write and Firebase Authentication user lookup (typically Cloud Datastore User and Firebase Authentication Viewer).
2. Copy `functions/.env.example` to `functions/.env`. Set `ORBIT_SERVICE_URL` to the root HTTPS URL of the backing Cloud Run service (typically `https://orbitapi-<project-number>.northamerica-northeast2.run.app`). Use the project **number**, or an HTTPS domain you mapped to that service. The root URL serves the OAuth discovery endpoints. Set `ORBIT_APP_URL` to the matching Orbit frontend. Set `ORBIT_AI_REDIRECT_URIS` to the exact callback URL from your AI client's connection settings. Separate multiple URLs with commas.
3. Run `firebase deploy --only functions:orbit-ai` against the existing Orbit Firebase project. The predeploy command builds the function. Check `/.well-known/oauth-protected-resource/mcp` at the configured service origin.
4. Set `VITE_ORBIT_AI_URL` to the same HTTPS service URL in the frontend `.env.local`, alongside its existing Firebase web configuration, then publish the frontend through the existing GitHub Pages deployment workflow. Configure the MCP client with `<service-url>/mcp` and OAuth Dynamic Client Registration.

The backend keeps credentials and audit copies in server-only Firestore collections. API token values are stored as hashes, and the service derives the account from verified Firebase sign-in or a scoped token. For periodic cleanup, enable Firestore TTL on `expireAt` for the `orbitAiRequests`, `orbitAiCodes` and `orbitAiTokens` collection groups. Change history is retained separately.

### Verify with local emulators

```sh
npm --prefix functions run check
npm --prefix functions run build
npm exec --yes --package=firebase-tools -- firebase emulators:exec --project demo-orbit-ai --only firestore,auth "npm --prefix functions test"
```

The emulator tests create temporary accounts and cover API permissions, account isolation, version checks, safe retries, undo and the MCP OAuth connection.
