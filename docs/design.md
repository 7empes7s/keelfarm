# Design system

Every 2D screen (panels, the console, pocket mode, the phone) follows this page. The manager's console
(`client/src/ui/ConsoleNav.tsx` and its sections, and pocket mode's `PocketConsole.tsx`) is the reference screen: copy it.
Tokens and shared styles are in `client/src/design.css`; components are in `client/src/ui/`.

## Direction

The office is a cartoon: thick ink outlines, solid offset shadows, round corners, warm paper, Fredoka. The 2D UI keeps
that voice but behaves like a good phone app, because the manager mostly uses the office on a phone.

1. **Thumb first.** Every target is at least 44×44 px (Apple HIG 44 pt; Material 3 asks 48 dp). Fields are 16 px text
   so iOS doesn't zoom. Lists wrap and stack; nothing scrolls sideways except a data matrix in its own scroller (or, on a
   narrow screen, a strip of tabs).
2. **One rhythm.** Spacing, type, radii and shadows come from tokens. No one-off pixel values in new CSS.
3. **Safe by default.** Nothing destructive or hard to undo is one visible tap away. It lives in a ⋯ menu's danger
   section and then asks to confirm (HIG: action sheets and destructive buttons; Material: menus and confirmation
   dialogs; GitHub mobile and Linear keep "Close", "Delete" and "Remove" behind ⋯).
4. **Headers hold.** A panel's title truncates, never wraps into the controls; ✕ is always in reach. On phones a
   panel is a full-screen sheet with the notch and home bar respected.
5. **Cartoon, quieter.** Outlines and offset shadows stay, at 2 px and 2–3 px inside panels (the 4 px outline is for
   the panel itself). Colour is for state and the floor's accent, not decoration.

How it fits the 3D office: the same ink, paper, accent orange and Fredoka; the floor's colour as the left edge of its
card; the same chunky buttons. Light only: every screen keeps the light tokens whatever the device's setting.

Rejected:
- **A component library (Radix, MUI, shadcn).** Its look fights the cartoon and adds weight to pocket mode's bundle;
  the few pieces we need (sheet, menu, rows) are small.
- **A flat, outline-free "pro dashboard" look (Vercel, Linear).** Polished, but it would make the console a different
  product from the office around it. We borrowed their spacing discipline and ⋯ menus instead.
- **Swipe-to-delete rows.** Hidden, easy to trigger by accident while scrolling, and not keyboard friendly.
- **Undo toasts instead of confirmations.** Most of our dangerous actions (letting an agent go, closing on GitHub)
  can't be undone by the office, so a toast would promise what it can't keep.
- **A dark mode that follows the device.** We had one (#30 / #67): the manager never asked for it,
  and screens built for the light look lost contrast in it (light chips, old one-off colours). Removed in #80:
  `color-scheme: light only` on the root and in index.html, so iOS and Chrome don't darken fields, scrollbars or pages
  either. High contrast is the one other palette.

## Tokens (`client/src/design.css`, on `:root`)

| Group | Tokens |
| --- | --- |
| Spacing (4 px grid) | `--ds-space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 20 · `-6` 24 · `-8` 32 · `-10` 40 |
| Type | `--ds-text-xs` .75 · `-sm` .875 · `-md` 1 · `-lg` 1.125 · `-xl` 1.375 rem; `--ds-leading`, `--ds-leading-tight`, `--ds-weight(-strong)` |
| Radii | `--ds-radius-sm` 8 · `-md` 12 · `-lg` 16 · `-xl` 24 · `-pill`; borders `--ds-border` 2, `--ds-border-strong` 3 |
| Touch | `--ds-target` 44 px |
| Colour | `--ds-surface`, `-raised`, `-sunken`, `-hover`; `--ds-text`, `--ds-text-muted`; `--ds-outline`, `--ds-shadow-color`, `--ds-line(-strong)`; `--ds-link`, `--ds-focus`; `--ds-good-fill`, `--ds-bad-fill`, `--ds-warn-fill` with `--ds-on-color` text; `--ds-danger-text`, `--ds-warn-text`; `--ds-scrim`; chart series `--ds-series-1…4` |
| Elevation | `--ds-shadow-1` (buttons), `-2` (cards), `-3` (panels), `--ds-shadow-float` (menus) |
| Motion | `--ds-dur-fast` 80 · `--ds-dur` 160 · `--ds-dur-slow` 240 ms, `--ds-ease`; all 0 under `prefers-reduced-motion` or the office's reduce-motion setting |
| Layers | `--ds-z-hud` 10 · `-panel` 30 · `-menu` 50 · `-confirm` 60 · `-toast` 70 |
| Safe areas | `--ds-safe-top/right/bottom/left` |

The values equal the office's old colours, so moving a rule onto tokens changes nothing. There is no dark palette: don't
add `prefers-color-scheme: dark` rules. Per-floor colour stays `var(--accent)` set on the element; text on a coloured
fill uses `--ds-on-color`.

`client/src/designTokens.test.ts` is the ratchet: colour literals in the old stylesheets may only go down.

## The console's map (#102)

The manager's console has five top tabs, and each one shows a side menu of its sections with one section beside it
(on a phone, the side menu is a list you tap into, with a back button, iOS Settings style). The map is
`client/src/ui/consoleNavRules.ts`, drawn by `ui/ConsoleNav.tsx` (the 3D office) and `pocket/PocketConsole.tsx` (phones):

| Tab | Sections |
| --- | --- |
| 🏢 Work | Floors & repos, Issues (3D only; phones have the Kanban tab), Team |
| 🛰️ Company | Mission control (with server health and the test lab), Charter, Memory map |
| 🧠 CEO | The CEO (chat, mandates, team changes, project briefs), CEO settings, Tools & skills |
| 📜 History | Sessions, Daily log, Time-lapse (3D only) |
| ⚙️ Settings | Agents, Every project, How agents run, Company, Profile, Cloud agents, Voice, Weather & world, Notifications, Themes, Accessibility, Pocket mode (phones only), About this office |

- Each section links as `#<tab>/<section>` (e.g. `#settings/cloud-agents`), and each tab remembers its last section in this browser.
- The search at the top of the side menu finds sections and settings by label. A new setting adds its label to its
  section's `find` list.
- Progressive disclosure: diagnostics (versions, paths, storage, transcript counts) never sit in a section's main flow.
  They go in a collapsed **Details** disclosure or in About this office. Nothing is removed, only tucked away.
- A section scrolls inside its own pane. The console itself never scrolls, and the top tabs fit on one row on desktop.

## Components

- **Screens**: every Panel, the phone, pocket mode, the start screen and the HUD carry `.ds-screen`:
  every button, field, switch and disclosure row inside is at least 44 px.
- **Panel / sheet** (`ui/Panel.tsx`): title (truncates), ✕ 44 px, body scrolls. Full-screen sheet ≤ 600 px.
  `className="ds-console"` adds the console's tabs, cards and headings.
- **Buttons**: `.btn` (primary actions: `.btn-good`; destructive confirm: `.btn-bad`; quiet: `.btn-ghost`) and
  `.ds-btn` for new code. Inside a rebuilt screen every button is at least 44×44.
- **Overflow menu** (`ui/Menu.tsx`): `<Menu label="More for Ada" title="Ada" items={[…]} />`. A popover on wide
  screens, a bottom sheet with a title and Cancel on phones. Arrow keys, Home/End, Esc (focus back to ⋯), Tab leaves,
  outside tap or scroll closes. Items with `danger: true` go last, under a separator, in red; end their label with "…"
  and confirm in `onSelect`.
- **Card header** `.ds-card-head`: badge or avatar, `.ds-row-main` (title `.ds-row-title` truncates, `.ds-row-meta`
  wraps), then actions, ⋯ last.
- **List row** `.ds-row`: `.ds-row-main` + `.ds-row-actions`; rows separate with a hairline.
- **Field groups** `.ds-fields` (as many columns as fit, one on a phone), switches `.ds-switches`, message box `.ds-compose`.
- **Narrow tables** `.ds-table` inside a `.ds-stack-scope`: a table when the container is wider than 760 px, a card per
  row below it. Label cells with `data-label`; `.ds-cell-head` and `.ds-cell-full` span the card.
- **Stat cards** (`ui/CharterStats.tsx`, the Charter tab): a `.cs-grid` of `.cs-stat` buttons, as many columns of at
  least 7rem as fit (two on a 390 px phone). Each is a 44 px-tall button: a `--ds-text-xs` uppercase title in
  `--ds-text-muted`, the number in `--ds-text-lg` strong, a `<small>` line saying what it's of. `--ds-surface` on a
  `--ds-line-strong` 1.5 px border, `--ds-radius-sm`; `.cs-warn` / `.cs-good` add a 4 px left edge in
  `--ds-warn-fill` / `--ds-good-fill` (never colour alone: the words say it too). Tapping one sets `aria-expanded`
  and lists what it counts under the grid (`.cs-refs`, links 44 px tall); tapping it again closes it. Text wraps, a
  long label clamps at two lines; nothing is cut sideways.
- **Insight stat card** (`.costs-stat`, Mission control's costs): a button, so it taps through to the rows it counts.
  Small muted label, the number at `--ds-text-xl`, one short note (a ↑/↓ % in `--ds-danger-text` when worse, a
  sparkline). 2 px outline, `--ds-shadow-2`, `--ds-radius-md`; two per row on a phone, three from 600 px; a wide one
  (a share bar) spans the row.
- **Ranked card** (`.costs-card`): rank badge, the amount at `--ds-text-lg`, the title (two lines at most), then chips
  (links ↗, floor with its colour dot, status filled with a state colour), muted facts, and a share bar against the top
  one. The floor's colour is the left edge; the card's one action (📋) sits in the top-right corner as a 44 px target,
  never in the text flow. Expandable groups are buttons with `aria-expanded`.
- **Share bar** (`.costs-bar`): an 8 px pill, 1 px ink outline, segments in `--ds-series-1…4` in that order, with a
  legend of dots below when there's more than one; give it `role="img"` and an `aria-label` with the numbers.
- **Decisions** `.ds-decision`: two answers (Hire / Decline, Let go / Keep) far apart; mark both `data-decision`.

## Finding things and learning the office (#109)

- **Search everything** (`ui/SearchPalette.tsx`, index in `ui/searchIndex.ts`): Ctrl/Cmd+K, or 🔍 in pocket's header
  and the HUD. A new kind of thing or action goes in `buildIndex`; settings come from the console's `find` lists.
- **Empty lists teach**: never a bare "Nothing here". Use `<EmptyState kind=… />`; its words (what shows up, why it's
  empty, the next action) are in `ui/emptyStates.ts`.
- **ⓘ on every main screen** (`ui/InfoButton.tsx`): the words are in `ui/screenHelp.ts`; a new console section adds one.
- **Statuses** are worded by `ui/statusPhrase.ts` (what now · what happens next), not per screen.
- **The guide** (`ui/guide.ts`): a checklist read from the office's state; a new feature worth setting up adds an item.

## Rules

Do:
- Use tokens for every new size, colour, radius, shadow, duration and z-index.
- Put destructive and hard-to-undo actions (let go, disconnect, close an issue or PR, clear a desk, remove or delete
  anything) in a ⋯ menu's danger section, then `confirmDialog({ tone: 'danger' })`. Shared ones: `ui/dangerActions.ts`.
- Keep the primary action visible; at most two or three visible buttons per card, the rest in ⋯.
- Write labels as verbs ("Let Ada go…", "Close as not planned…"), sentence case, no jargon.
- Check every screen you change at 360, 390, 430 and 1280 px, light and dark, and add it to `e2e/layout.spec.ts`'s
  `SCREENS`.

Don't:
- Put a destructive button next to a safe one, or anywhere one tap does it.
- Use `width`/`max-width` inline styles for layout; let grids and flex wrap.
- Nest a fixed-height scroller inside a scrolling panel (except a data matrix that needs both axes).
- Hard-code colours (`#fff`, `rgba(31, 29, 43, …)`) in new rules; they break High contrast.
- Animate without the motion tokens.

## Checking a screen

`e2e/layout.spec.ts` opens each screen in `SCREENS` at its widths in light and dark, walks its tabs and fails on:
sideways page scroll or an element wider than the viewport (outside a scroller), a button that can't be scrolled
into view or is covered (`elementFromPoint`), a button under 44×44, a destructive button outside a menu, a ⋯ menu
whose danger items aren't last and separated or whose Esc closes more than the menu, and any axe WCAG 2.1 AA
violation. Run it alone with your reserved port:

```bash
npm run build && E2E_PORT=<your port> E2E_SKIP_BUILD=1 npx playwright test layout --no-deps
```

Pocket-mode screens run at all four widths; screens inside the 3D office at 390 and 1280 (WebGL is slow, and phones
get pocket mode). `-g "phone at 390"` runs one; `LAYOUT_DEBUG=1` lists every axe node with its colours.
