# Orbit: guide for AI coding sessions

Read this before changing the UI. New sessions have no memory of earlier ones; this file is how Orbit keeps one look.

## Talking to the user
- Answer in **Traditional Chinese**, warm and plain. Code, commits and PR text in English.
- Test changes in a real browser (Playwright, Chromium is preinstalled) on **desktop and phone (Pixel 7), light and dark**, and show screenshots. Say honestly what you could not test.
- Rewriting notes for the user: "manual style" (see the Orbit note “gemini flash 風格 說明改寫skill”), and **never drop information**.

## Design system: reuse, don't reinvent
Before writing new CSS, find the existing pattern below and use it. A new screen should look like it was always there.

**Colours and shape** (`src/styles/tokens.css`): only use the variables: `--bg` (page), `--surface` (cards), `--surface-2/3` (hover, fills), `--line` / `--line-strong` (borders), `--text`, `--text-2`, `--muted`, `--accent` / `--accent-soft` / `--accent-text`, `--ok(-soft)`, `--danger(-soft)`, `--warn-soft`. No hard-coded colours except white text on `--accent`. Every screen must work in dark mode.

**Cards**: rounded 12–18px, `1px solid var(--line)`, `var(--surface)` background. Group related controls in one card; don't stack loose headings and buttons.

**Settings**: every block is a `SettingsSection` (`src/components/SettingsSection.tsx`): icon tile + title + one-line summary of the current state, folds open. **Never use the old `.card-section`** for new settings.
- Inside a section, sub-groups use the AI-access pattern (`AiAccessSettings.tsx`): `.ai-block` with an icon + `h4` head, `.ai-help` for explanations, rows as small cards (`.ai-conn` / `.ai-change`), chips (`.ai-chip`), small buttons (`.ai-mini`), copyable values in `.ai-field` with `CopyButton`.
- Status/explanations: `.banner ok|warn`, muted 13px help text.

**Buttons**: `.btn`, `.btn.primary` (one per group, the main action), `.btn.small`, `.btn-ghost`, `.btn.danger`; destructive actions ask with `confirm` first. Choices between 2–3 options: `.segmented`. Icons from `lucide-react`, 14–18px.

**Phone layout** (≤ 820px, `useIsMobile`): floating round buttons and pills, not toolbars.
- Fill the top bar with `<MobileHeader left/center/right actions>` (`src/mobile/MobileHeader.tsx`); switches in the middle use `MobileSegmented`.
- Menus are bottom sheets: `ActionSheet` / `BottomSheet` / `SheetGroup` / `SheetItem` (`src/mobile/BottomSheet.tsx`), not popovers.
- Home rows use the `.mh-row` pattern (`src/mobile/MobileHome.tsx`).
- The desktop layout must not change when you work on phones: compare desktop screenshots with `main` pixel by pixel.

**Folding things**: summary line when closed, chevron that rotates (see `SettingsSection`, `AiNotesPanel`).

**Text**: every visible string goes through `tr('English text')` with a Traditional Chinese entry in `src/lib/i18n.ts` (no duplicate keys; check that a key isn't already used with another meaning, e.g. "Shortcuts" = 快捷鍵, "Note" = 備註).

## Gotchas
- `.is-selected` is a global editor-selection outline; don't use it as a class name.
- Markdown goes through `src/lib/markdown.ts` (markdown-it + CJK-friendly); don't parse Markdown by hand.
- Run `npm test` and `npm run build`; for `functions/` also `npx tsc --noEmit` and the emulator tests: `npm exec --yes --package=firebase-tools -- firebase emulators:exec --project demo-orbit-ai --only firestore,auth "npm --prefix functions test"`.
- If your npm version rewrites unrelated parts of `package-lock.json`, keep only the entries for packages you added.
- Website deploys on merge (GitHub Pages; if Pages returns HTTP 500, re-run `deploy.yml`). API changes need the user to run the "Deploy Orbit Functions" shortcut; new API tools or arguments also need the Orbit connector reconnected in claude.ai. Tell the user.
