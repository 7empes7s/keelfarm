# Design system

Every 2D screen (panels, the console, pocket mode, the phone) follows this page. The manager's console
(`client/src/ui/ManagerConsole.tsx` and pocket mode's `PocketConsole.tsx`) is the reference screen: copy it.
Tokens and shared styles are in `client/src/design.css`; components are in `client/src/ui/`.

## Direction

The office is a cartoon: thick ink outlines, solid offset shadows, round corners, warm paper, Fredoka. The 2D UI keeps
that voice but behaves like a good phone app, because the manager mostly uses the office on a phone.

1. **Thumb first.** Every target is at least 44×44 px (Apple HIG 44 pt; Material 3 asks 48 dp). Fields are 16 px text
   so iOS doesn't zoom. Lists wrap and stack; nothing scrolls sideways except a strip of tabs or a data matrix in its
   own scroller.
2. **One rhythm.** Spacing, type, radii and shadows come from tokens. No one-off pixel values in new CSS.
3. **Safe by default.** Nothing destructive or hard to undo is one visible tap away. It lives in a ⋯ menu's danger
   section and then asks to confirm (HIG: action sheets and destructive buttons; Material: menus and confirmation
   dialogs; GitHub mobile and Linear keep "Close", "Delete" and "Remove" behind ⋯).
4. **Headers hold.** A panel's title truncates, never wraps into the controls; ✕ is always in reach. On phones a
   panel is a full-screen sheet with the notch and home bar respected.
5. **Cartoon, quieter.** Outlines and offset shadows stay, at 2 px and 2–3 px inside panels (the 4 px outline is for
   the panel itself). Colour is for state and the floor's accent, not decoration.

How it fits the 3D office: the same ink, paper, accent orange and Fredoka; the floor's colour as the left edge of its
card; the same chunky buttons. Dark mode keeps the orange header and turns the body into dusk (`.ds-auto-dark`).

Rejected:
- **A component library (Radix, MUI, shadcn).** Its look fights the cartoon and adds weight to pocket mode's bundle;
  the few pieces we need (sheet, menu, rows) are small.
- **A flat, outline-free "pro dashboard" look (Vercel, Linear).** Polished, but it would make the console a different
  product from the office around it. We borrowed their spacing discipline and ⋯ menus instead.
- **Swipe-to-delete rows.** Hidden, easy to trigger by accident while scrolling, and not keyboard friendly.
- **Undo toasts instead of confirmations.** Most of our dangerous actions (letting an agent go, closing on GitHub)
  can't be undone by the office, so a toast would promise what it can't keep.
- **Dark mode for the whole app at once.** Screens with one-off colours would break; each screen opts in with
  `.ds-auto-dark` once it's rebuilt on tokens.

## Tokens (`client/src/design.css`, on `:root`)

| Group | Tokens |
| --- | --- |
| Spacing (4 px grid) | `--ds-space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 20 · `-6` 24 · `-8` 32 · `-10` 40 |
| Type | `--ds-text-xs` .75 · `-sm` .875 · `-md` 1 · `-lg` 1.125 · `-xl` 1.375 rem; `--ds-leading`, `--ds-leading-tight`, `--ds-weight(-strong)` |
| Radii | `--ds-radius-sm` 8 · `-md` 12 · `-lg` 16 · `-xl` 24 · `-pill`; borders `--ds-border` 2, `--ds-border-strong` 3 |
| Touch | `--ds-target` 44 px |
| Colour | `--ds-surface`, `-raised`, `-sunken`, `-hover`; `--ds-text`, `--ds-text-muted`; `--ds-outline`, `--ds-shadow-color`, `--ds-line(-strong)`; `--ds-link`, `--ds-focus`; `--ds-good-fill`, `--ds-bad-fill`, `--ds-warn-fill` with `--ds-on-color` text; `--ds-danger-text`; `--ds-scrim` |
| Elevation | `--ds-shadow-1` (buttons), `-2` (cards), `-3` (panels), `--ds-shadow-float` (menus) |
| Motion | `--ds-dur-fast` 80 · `--ds-dur` 160 · `--ds-dur-slow` 240 ms, `--ds-ease`; all 0 under `prefers-reduced-motion` or the office's reduce-motion setting |
| Layers | `--ds-z-hud` 10 · `-panel` 30 · `-menu` 50 · `-confirm` 60 · `-toast` 70 |
| Safe areas | `--ds-safe-top/right/bottom/left` |

Light values equal the office's old colours, so moving a rule onto tokens changes nothing in light mode. Dark values
apply inside `.ds-auto-dark` when the device prefers dark (never over High contrast). Per-floor colour stays
`var(--accent)` set on the element.

## Components

- **Panel / sheet** (`ui/Panel.tsx`): title (truncates), ✕ 44 px, body scrolls. Full-screen sheet ≤ 600 px.
  Pass `className="ds-console ds-auto-dark"`-style classes to opt a screen into the system and dark mode.
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
- **Decisions** `.ds-decision`: two answers (Hire / Decline, Let go / Keep) far apart; mark both `data-decision`.

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
- Hard-code colours (`#fff`, `rgba(31, 29, 43, …)`) in new rules; they break dark mode.
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
