# Orbit design system

The one style guide for Orbit. Every screen, by any person or AI session, follows it, so the app always looks like one product. `CLAUDE.md` has the short version; this file has the details.

**The feel:** calm, airy, quiet. Warm off-white chrome, white cards, one purple accent, soft borders instead of heavy shadows. Content first; controls appear when needed. If something you are adding looks louder than the rest of the screen, tone it down.

**The rule behind everything:** reuse before you invent. Find the existing pattern below and use its class or component. Only add new CSS when nothing fits, and then build it from the tokens and scales in this file.

---

## 1. Colour

Defined in `src/styles/tokens.css`. Use the variables, never raw hex values.

| Token | Use for |
| --- | --- |
| `--bg` | App background behind panes and the sidebar |
| `--surface` | Cards, panes, popovers, modals |
| `--surface-2` | Hover fills, inputs, quiet chips, table headers |
| `--surface-3` | Pressed / selected fills (active nav item) |
| `--line` | Default 1px borders and dividers |
| `--line-strong` | Hover borders, checkbox outlines, stronger dividers |
| `--text` | Main text, titles |
| `--text-2` | Secondary text, unselected tabs and icons |
| `--muted` | Hints, counts, timestamps, placeholders |
| `--accent` / `--accent-soft` / `--accent-text` | The one brand colour: primary buttons, selection, links, focus. `-soft` for tinted backgrounds, `-text` for accent-coloured text on light backgrounds |
| `--ok` / `--ok-soft` | Success, "synced", done |
| `--warn` / `--warn-soft` | Warnings, medium priority, "needs attention" |
| `--info` / `--info-soft` | Neutral information, tips |
| `--danger` / `--danger-soft` | Errors, overdue, destructive actions |
| `--today` / `--today-soft` | Only for "today" in calendars and dates |
| `--wd-0` … `--wd-6` | Only for weekday names (Sun…Sat) in the calendar |

**Rules**
- **No hard-coded colours** in CSS or TSX. The only exceptions:
  - `#fff` text or icons on a solid `--accent`, `--danger` or `--today` fill.
  - **Category colours:** object type colours (`ObjType.color`), callout tones (`tone-*`), settings icon tiles (`SettingsSection tone`). These are a fixed palette, and they are always mixed with a surface, e.g. `color-mix(in srgb, var(--type-color) 12%, var(--surface))`, so they work in both themes.
- **Tinted backgrounds:** use the `-soft` token, or `color-mix(… X% …, var(--surface))` with 8–18%. Never a solid category colour behind text.
- **The AI space** recolours `--accent*` to teal (`:root[data-space='ai']`). Always use `--accent`, never `#6d5efc`, so this keeps working.
- **One accent per screen area.** Status colours (`ok`, `warn`, `danger`) mean status only; don't use them for decoration.

**Category palette** (use these hexes for new types, tones or tiles; don't invent new ones):
`#6d5efc` purple · `#3f9bd8` blue · `#2fa57a` green · `#e5b12e` yellow · `#e0864a` orange · `#d9546e` rose · `#b05cc9` violet · `#4bb3a8` teal · `#8b8a86` grey · `#5b7083` slate

## 2. Dark mode

Every screen must work in light **and** dark, including the theme set to **System** with Windows/macOS in dark mode.

- `applyTheme` always sets `data-theme="light"` or `"dark"` on `<html>`. For **System** it follows the OS setting and updates live, so one selector covers every case.
- Dark-only tweaks: write `:root[data-theme='dark'] .your-class { … }`. Don't write `@media (prefers-color-scheme: dark)` in `app.css`; that rule only lives in `tokens.css` as a fallback before the app starts.
- If you need a dark override, first ask whether a token would remove the need for it. Usually it does.

## 3. Typography

Font: `--font` (Inter, then the system font). Code: `--mono`.

Use only these sizes:

| Size | Weight | Use for |
| --- | --- | --- |
| 26px | 700 | Page titles (`.page-head h1`, type page title) |
| 22px | 700 | Section titles on large pages, day headers |
| 17px | 600 | Modal titles, settings section titles |
| 15px | 400–600 | Editor body text, card titles, large inputs |
| 14px | 400–500 | Default UI text (buttons, rows, menus) |
| 13px | 400 | Secondary text, help text, small buttons, table cells |
| 12px | 500–600 | Chips, badges, counts, section labels, timestamps |
| 11px | 600 | Tiny uppercase labels (`letter-spacing: 0.04em`), the smallest allowed |

- Note titles (`.obj-title`, 32px) and the calendar's big date (30px) are the only larger exceptions.
- Don't add half sizes (12.5px, 13.5px, 14.5px). They exist in older CSS; round them to the nearest size above when you touch that code.
- Weights: 400 body, 500 emphasis / active items, 600 titles / labels, 700 page titles only.
- Line height: 1.5 for UI, 1.65 for the editor.
- Text that might overflow: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`, or `-webkit-line-clamp` for 2–3 lines.

## 4. Shape and spacing

**Radius scale.** Use only these:

| Radius | Use for |
| --- | --- |
| 6px | Tiny buttons (`.icon-btn.tiny`), inline code, editor pills |
| 8px | Buttons, nav items, menu items, inputs, tabs |
| 10px | Standard buttons (`.btn`), fields, small cards, `--radius` |
| 12px | Popovers, rows shown as cards, list cards |
| 16px | Large cards, settings cards (`.set-card`), modals, panes |
| 999px | Pills, chips, badges, round buttons |

**Spacing.** Multiples of 4: `4, 8, 12, 16, 20, 24, 32, 48`. Gaps inside a row: 6–10px. Card padding: 12–16px (compact) or 16–20px (sections). Page padding: 28px desktop, 16px phone.

**Borders and depth.** Separate things with `1px solid var(--line)` and spacing, not shadows. `--shadow` is only for things that float (popovers, menus, the backup banner, cards on hover); `--shadow-lg` is only for modals and the phone sidebar.

**Icons.** `lucide-react` only. Sizes: 14px in chips and small buttons, 16px default, 18px in headers and settings tiles, 20px in empty states and big tap targets. Emoji are for object and type icons only, not for UI controls.

## 5. Components (reuse these)

### Buttons
| Class | When |
| --- | --- |
| `.btn` | Normal action |
| `.btn.primary` | The main action. **At most one per group or dialog.** |
| `.btn.small` | Inside rows, banners, tight spaces |
| `.btn.danger` | Destructive. Always `confirm()` first and say what is lost. |
| `.btn-ghost` | Quiet secondary actions ("Show completed", "Forget folder") |
| `.icon-btn` (`.round`, `.tiny`, `.danger`) | Icon-only. **Always add a `title`** (it's the tooltip and accessible name). |
| `.btn-row` | A row of buttons |

### Choices and inputs
- 2–4 exclusive options: `.segmented` (`.small` for icon-only). On phones: `MobileSegmented`.
- A long list of options: `MenuSelect`, not a plain `<select>`, in new UI.
- Text inputs: borderless until hover/focus, like `.prop-input`. Focus shows `--line-strong` or `--accent`.
- Dates: a native `<input type="date">` covering a styled chip (see the task due-date chip), so the picker always opens.

### Chips, tags and badges
- `.chip` for small labels (`.plain` = neutral, `--type-color` = tinted by type).
- `.tag-chip` for `#tags`. `.nav-badge` for counts in navigation.
- Status pills and priority labels: reuse `.status-pill.tone-*` and `.prio-*`. Don't make new colour schemes.

### Floating things
- Small menus and pickers: `Popover` (`src/components/Popover.tsx`) with `.menu` / `.menu-item`.
- Dialogs: `Modal` with `.modal-head` / `.modal-body` / `.modal-foot`. Primary button on the right.
- Escape and an outside click close every floating thing. These components already do it.

### Content layouts
- Pages: `.page` (max 820px) or `.page.wide` (1180px), with `.page-head` (h1 plus a one-line muted description).
- Lists of objects: `.card-grid` + `ObjectCard`, `.row-list` + `ObjectRow`, or `.obj-table`.
- Banners: `.banner ok|warn`, a short sentence plus at most one `.btn.small`.

### Settings
- Every block is a `SettingsSection`: icon tile + title + a **summary of the current state** ("Synced · 2 min ago", not "Cloud sync settings"), folding open.
- **Never use `.card-section` for new UI**; it's the old style.
- Inside a section, follow `AiAccessSettings.tsx`: `.ai-block` (icon + `h4` head), `.ai-help` text, rows as small cards (`.ai-conn`, `.ai-change`), `.ai-chip`, `.ai-mini` buttons, copyable values in `.ai-field` with a copy button.

### Folding
A summary line when closed, plus a chevron that rotates 90° when open (`SettingsSection`, `AiNotesPanel`). Remember the open/closed state when it helps (`localStorage`, wrapped in try/catch).

### Empty states
Never leave a blank area. Use `.empty-inline` (`.center` for whole pages): **one bold line** saying what's missing, then **one muted line** saying how to add it, optionally with a 20px icon.
> **There's nothing here (yet).** Create your first project with the button above.

### Loading and errors
- Loading: a muted line ("Loading…") or a spinning `RefreshCw`. No big spinners.
- Errors: a `.banner warn` in plain words saying what to do next. Pass errors through `localizeError`.

## 6. Phone layout (≤ 820px)

Check with `useIsMobile()`. The phone gets its own components; **the desktop layout must not change** when you work on phones.

- **Top bar:** `<MobileHeader left center right>`. Round floating buttons (`.m-circle`) and pills (`.m-pill`), no toolbars. Switches in the middle use `MobileSegmented`.
- **Menus:** bottom sheets (`ActionSheet`, `BottomSheet`, `SheetGroup`, `SheetItem`), never popovers.
- **Lists:** the Home row pattern (`Section` + `Row`, `.mh-row`).
- **Navigation:** `MobileNav`. Creating things: `CreateSheet`.
- Tap targets at least 40×40px. Text inputs at least 16px so iOS doesn't zoom.
- Breakpoints: only `820px` (phone) and `1100px` (narrow desktop with split view). Don't add new ones.

## 7. Motion

Use the tokens in `src/styles/motion.css`: `--dur-fast` 120ms (hover, press), `--dur` 200ms (popovers, toggles), `--dur-slow` 300ms (sheets, modals), with `--ease-out` (or `--ease-spring` for small "pop" moments). Reuse the existing `orbit-*` keyframes.

Animate only `opacity` and `transform`. Every new animation needs a `prefers-reduced-motion: reduce` fallback that removes it.

## 8. Accessibility

- Every interactive element is a `<button>`, `<a>` or form control, never a clickable `<div>`.
- Icon-only buttons have a `title` (and `aria-label` when the title isn't descriptive enough).
- Keep the visible focus ring: use `:focus-visible`, and never remove outlines without a replacement.
- Text contrast: `--text` / `--text-2` on surfaces; `--muted` only for non-essential text.
- Folding regions use `aria-expanded` and `aria-controls` (see `SettingsSection`).
- **`.is-selected` is reserved** for the editor's selection outline. Don't use it as a class name.

## 9. Writing and language

- Every visible string goes through `tr('English text')` (`const tr = useT()`), with a Traditional Chinese entry in `src/lib/i18n.ts`. Check that the key doesn't already exist with another meaning ("Shortcuts" = 快捷鍵, "Note" = 備註).
- Simplified Chinese is generated: after adding zh-Hant entries run `npm run i18n:hans`. Don't edit `src/lib/i18n.zh-Hans.ts` by hand; put mainland word choices (e.g. 設定 → 设置, 專案 → 项目) in `scripts/zh-hans.mjs`.
- Language checks: use `isChinese(tr.language)` for anything both Chinese UIs share (date formats, `、`, full-width colons), not `=== 'zh-Hant'`.
- Tone: short, friendly, plain. Sentence case ("Sign in with Google", not "Sign In With Google").
- Say what happened and what to do next. Avoid technical words in the UI ("Couldn't save. You're offline, so it'll retry automatically.").
- Counts: use the singular/plural keys (`'{count} task'` / `'{count} tasks'`).

## 10. Checklist before you open a PR

- [ ] Reused existing classes and components; any new CSS uses only tokens and the scales above
- [ ] No hard-coded colours, half font sizes, new radii or new breakpoints
- [ ] Looks right in **light, dark, and System-dark**
- [ ] Looks right on **desktop and phone** (Pixel 7); desktop unchanged when the change was phone-only
- [ ] Empty, loading and error states are handled
- [ ] Every string uses `tr()` with a zh-Hant entry
- [ ] Icon buttons have titles, and destructive actions confirm first
- [ ] `npm test` and `npm run build` pass; the PR includes screenshots
