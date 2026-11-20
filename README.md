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
