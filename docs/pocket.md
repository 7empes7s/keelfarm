# The office in your pocket

cubefarm works from a phone: **pocket mode** is the office as a 2D app, it installs on your home screen, and the
office tells you when something needs you, on your devices or in the ntfy app.

## Pocket mode

On a narrow or touch screen the office opens in pocket mode by itself. On a computer, pick **📱 Pocket mode** on the
start screen. Each device remembers what you last chose; `?pocket=1` or `?pocket=0` in the address decides for one
visit. Five tabs, at the bottom:

| Tab | What's there |
| --- | --- |
| **Company** | Each floor's pipeline: 🔨 building, 🔍 in QA, 🔧 being fixed, ✅ ready to merge, ⚠️ needs you. Banners when Claude's usage pauses or paces the office, or when it's updating. |
| **Chat** | The CEO's phone thread, with ▶ to replay messages read aloud. |
| **Kanban** | Each floor's board, one column under the other: assign, send to QA, merge, close, file issues. |
| **Team** | Everyone's status and what they're on, with **Message**, **■ Stop**, **↺ Clear desk**, assigning an issue (or a PR to test) and their terminal. |
| **Approvals** | Team changes waiting for you (new agents to set up and hire, agents leaving), stuck PRs (**Retry QA**, **Send back**, **Merge anyway**, **Close**) and passed PRs on floors without auto-merge. |

**⚙️** (top right) is the manager's console, with the same controls as in the 3D office, one section at a time:

| Section | What's there |
| --- | --- |
| **🏢 Floors** | The office's own update, each floor's settings (colour, auto-assign, auto-merge, browser testing, which floors its agents may read, the app preview, sync, disconnect) and **➕ Add a project**: a folder, a GitHub repo or something new. |
| **🧠 CEO** | The CEO's name, model and effort, what they're told, their terminal, a message box, **Review the company now**, team changes, and each floor's brief and QA brief. |
| **👩‍💻 Team** | Careers, **+ Agent** per floor, and each agent's name, look, coding agent, model, effort, terminal and **Let go**. |
| **⚙️ Office** | Every office setting: agent defaults, session limits, the CEO's team changes and reviews, how agents run, the company, your profile, cloud agents, voice, the city outside and themes. |
| **🛰️ Mission control** | The pipeline, alarms, checks, cost and Claude's usage. |
| **📱 This device** | Notifications, accessibility and switching to the 3D office. |

Pocket mode draws its icons with [Lucide](https://lucide.dev) (ISC licence, `client/src/pocket/pocket-icons.LICENSE`):
a small icon font, `pocket-icons.woff2`, covers exactly the emoji the office uses and draws each one as a Lucide icon,
in the text's colour, while the 3D office keeps its emoji. `scripts/pocketIcons.mjs` lists the pairs and rebuilds the
font; an emoji not on its list shows as itself.

Only what needs the 3D building stays there: walking the floors, graphics and camera settings, key bindings, the
time-lapse and the first-run setup. Pocket mode uses the same live connection and commands as the 3D office, and
loads no 3D at all until you tap **🏢 Open the 3D office** (Company tab, or ⚙️ → This device), or open an agent's
look, whose preview is 3D.

### On a desktop

Pocket mode is also the 2D office for a computer, for getting work done without walking around. **🗺️ 2D office** in
the 3D office's top bar switches to it, **🏢 3D office** in pocket mode's header goes back, and **O** (Help →
Controls) does either from the keyboard. Each device remembers the last choice; `?pocket=1` / `?pocket=0` still win.

The layout follows the window's width (in the UI scale's px): up to 760 px it's the phone's, with the tabs at the
bottom. From 761 px a rail on the left takes their place, with ⚙️ at its foot and badges for the chat and approvals:

- **1024 px and wider**: the rail with labels, and the CEO's chat docked on the right while you use the other tabs
  (✕ hides it, 💬 on the rail brings it back; drag its left edge, or focus it and use the arrow keys, for a width
  between 360 and 520 px; both remembered). Company shows the floors as a grid of cards with usage and the CEO beside
  them, the Kanban its whole board side by side, Team its agents as a grid, and Approvals a list of decisions beside
  the one picked. ⚙️ opens the console in the pages' place. An agent's terminal, a floor's app or a card (from a tab
  or a chat chip) opens in a pane beside them, or over them when the room left beside the chat is under 720 px.
- **761-1023 px**: the rail with icons only; 💬 opens the chat as a drawer over the pages, and terminals, apps and
  the console cover the pages. Opening one closes the drawer.

Whatever you open, tap or focus last comes to the front (#212, `ui/panels.ts`): a chat chip, a notification or a card
never opens behind the console, the rail brings its page in front of it, and ⚙️ brings the console back in front of a
pane. A window opened in place of another leaves a **‹ back chip** in the header that brings the first one back.

Touch-only screens keep the phone's layout below 768 px wide or 600 px tall (an iPad upright gets the rail and the
chat drawer, a phone on its side doesn't). Keys, never while typing in a field: **1**-**5** (or **Alt+1**-**5**) the
tabs in the rail's order, **/** the chat's message box, **Esc** closes the top panel only, then the chat drawer.

### The tour and What's new

Every screen has a short tour, one sentence per step with a ring around the real control, **Next**, **← Back**,
**Skip tour** and progress dots; where it's harmless a step has a **Try it** (open the bell or search, put a /plan in
the chat's box without sending it). The 3D office starts it after setup; pocket mode offers it on the Company tab
(**🧭 Take the tour**). The track follows the screen: the phone's layout, pocket mode on a desktop or the 3D office.
After an update adds steps, Company (or a card in the 3D office's corner) says **✨ N new things since you last
looked** and replays only those; this device remembers what it has seen. **✨ What's new** in Settings → Company and
in every ⓘ sheet brings them back, and **🧭 Replay the tour** starts it over.

The steps are in `client/src/ui/tourSteps.ts`; a step's PR adds it there, with its id here:

| Step | Phone | Desktop pocket | 3D office |
| --- | --- | --- | --- |
| `look`, `phone`, `phone-tour`, `ceo`, `hires`, `upstairs`, `whiteboard`, `watch`, `office`: walking the building | | | ✓ |
| `pocket-tabs`: the five tabs | ✓ | ✓ | |
| `desk-keys`: 1-5, / and 🏢 3D office | | ✓ | |
| `search`: 🔍 search everything | ✓ | ✓ | ✓ |
| `guide`: the ✅ guide checklist | ✓ | ✓ | ✓ |
| `bell`: 🔔 the notification centre | ✓ | ✓ | ✓ |
| `chat-cards`: starters, / commands, action cards with live steps | ✓ | ✓ | ✓ |
| `console`: the console's tabs, side menus and search | ✓ | ✓ | ✓ |
| `charter`: the charter page and its numbers | ✓ | ✓ | ✓ |
| `costs`: Mission control's cost insights and cards | ✓ | ✓ | ✓ |
| `agent-chat`: an agent's chat, chat mode and reactions | ✓ | ✓ | ✓ |
| `chat-full`: ⛶ the CEO chat full screen | ✓ | ✓ | ✓ |
| `info`: every screen's ⓘ | ✓ | ✓ | |
| `switch`: the 2D office | | | ✓ |

## Install it

The office is an installable web app: Chrome and Edge offer **Install** in the address bar (on Android: ⋮ → **Add
to Home screen**), and Safari on iPhone has **Share → Add to Home Screen**. Installing needs the office to be served
over HTTPS, or opened as `localhost` on its own PC (see [phone access](#reach-the-office-from-your-phone)).

The app's service worker caches only the app shell (the page, its scripts and styles, the icons) so it opens quickly.
It never caches the office's data: everything you see comes live from the office. Every office update gives the
worker a new version, which replaces the old one and its cache, so the app never runs stale code.

## Notifications

Open **⚙️ Settings → 🔔 Notifications** in the manager's console (or **⚙️** in pocket mode) and pick what you hear
about:

- a pull request needs you (stuck, and the CEO has handed it to you)
- a message from the CEO
- a team change waits for your decision
- someone has been stuck in an error for over 10 minutes
- Claude's usage limit pauses the office, or a usage warning paces it
- every merge (off unless you turn it on)

You get at most one notification of each kind a minute. Whatever else of that kind happens in the minute arrives
together as one summary ("🔀 9 more merges"), so a burst of merges is two notifications, not ten.

**Office address for links:** the address your phone opens the office at (for example your Tailscale Serve URL).
Every ntfy message ends with it, so a tap takes you there. Opening the settings over HTTPS fills it in when it's empty.

A demo office (`--demo`) sends nothing: it starts with ntfy set up with a fake topic and prints what each channel
would get in the server's log.

### Get notified on this phone

Open **⚙️ → 📱 This device → Notifications** (or **⚙️ Settings → 🔔 Notifications** in the 3D office) on the phone
itself. **Get notified on this device** is a checklist of live checks, each with a tick or what to do, and one big
button that does the next step:

1. **Opened over HTTPS** (or `localhost` on the office's PC); otherwise it links to the office's HTTPS address.
2. **iPhone only: running as the home-screen app** (Share → Add to Home Screen, then open it from there). Safari
   only allows Web Push in the installed app (iOS 16.4 or later).
3. **Notifications allowed**, or how to unblock them in this browser.
4. **Background helper running**: the office's service worker.
5. **This device is signed up**, and saved on the office.
6. **Send a test**: what the push service answered (accepted, expired, or an error with its HTTP status), then
   *Did it arrive?*

Allowing notifications and signing up are separate taps on purpose: Safari only lets a page subscribe within the tap
that asked, and the permission prompt uses that tap up. A step that fails says why on screen and in the office's log
(`notify: push sign-up stopped at …`).

Push reaches a device even when the office isn't open on it. The office signs its pushes with its own VAPID key pair,
kept in `<SWARM_HOME>/push.json` with the devices' subscriptions (owner-only file permissions). Messages are
encrypted for each device (RFC 8291) and go through the browser maker's push service (Google, Mozilla, Apple), which
can't read them.

### The ntfy app instead

[ntfy](https://ntfy.sh) pushes to its own phone app, with no account and nothing to set up in the browser. Tap
**Set up ntfy**: the office makes a long random topic on ntfy.sh, saves it and sends it a test. It then shows, once,
a **Subscribe in the ntfy app** link and a QR code for another phone's camera, with the App Store and Google Play
links. Anyone who knows the topic can read it, so it's never shown again; **Make a new ntfy topic** replaces it.
**Use my own ntfy server or topic** takes a topic URL and an access token (`tk_…`) instead.

### Telegram

Your own Telegram bot gets the notifications and lets you talk to the CEO from Telegram. In **⚙️ → Notifications →
Telegram**:

1. **Make a bot**: open [@BotFather](https://t.me/BotFather), send `/newbot`, pick a name and a username ending in
   `bot`, and copy the token it gives you.
2. **Paste the token**: the office checks it with Telegram (`getMe`) before saving it.
3. **Open your bot and press Start** with the link the office shows. It carries a one-time code (good for 30
   minutes): the chat that presses Start with it is linked, and the office never listens to any other chat.

Then Telegram is one more channel with its own **On** switch, the same events, rate limit and summaries, and the
office link at the end. **Send test**, **Link another chat** and **Remove** are there too.

- **Chat with the CEO:** what you write to the bot reaches the CEO as a phone message does, and shows in the phone
  chat marked *via Telegram*. Replying to one of the bot's messages quotes it to the CEO. When your last message came
  from Telegram, the CEO's answers go there too (*✈️ sent to Telegram* in the phone chat); **Mirror the whole CEO
  chat to Telegram** sends every CEO message.
- **Team changes** arrive with **✅ Hire** / **✋ Decline** buttons, which go through the same approve and decline
  as the lobby's.
- **The CEO can send you a message** there when you ask ("send me the plan on Telegram"), only to your linked chat.

The office reads the bot's messages with long polling (`getUpdates`), so no public address is needed: it works with
the office on `127.0.0.1` or your tailnet. It retries with a growing pause when Telegram can't be reached, and stops
at shutdown. Give the office a bot of its own: two programs can't read one bot's messages. The token and your chat
are kept in `secrets.json` under `telegram` (see below); **Remove** forgets both. A demo office talks to a fake
Telegram that prints what it would send, and its settings have buttons that play you on Telegram (press Start, write
a message, press a team change's button).

### Channels

Each channel shows when it last sent and whether that worked, with the error if it didn't: desktop (the office's
open tabs), each push device and ntfy. Devices can be tested, renamed and removed there. A device whose push service
says it's gone (it unsubscribed, or its browser data was cleared) is dropped.

Desktop notifications: any browser with the office open in a background tab shows them once you click **Allow in
this browser**. A tab you're looking at doesn't: the office chimes and shows the toast there anyway.

### Where the secrets live

The ntfy topic and token, and the Telegram bot's token and your chat, are kept in `<SWARM_HOME>/secrets.json`
(`~/.cubefarm/secrets.json` by default) next to the ElevenLabs key: owner-only file permissions, never in
`state.json`, never logged, never sent to a browser (the settings show the last 4 characters) and never given to
agents. **Remove** deletes them. A demo office keeps its own `demo-secrets.json`, `demo-telegram-secrets.json` and `demo-push.json`.

## Reach the office from your phone

The office listens on `127.0.0.1` only, on purpose: it can start agents that run commands on your PC, so it must
never be open to your network or the internet as it is. It never changes that or opens ports itself unless you start
it with `--host <address>` (or `SWARM_HOST`), which has no sign-in: only for a network you trust. To use it from your
phone, put something that authenticates you in front of it:

- **Tailscale Serve (recommended).** Install [Tailscale](https://tailscale.com) on the office's PC and your phone,
  signed in to the same tailnet. On the PC run:

  ```
  tailscale serve --bg 4317
  ```

  It prints an address such as `https://office-pc.your-tailnet.ts.net`, with a real HTTPS certificate, reachable
  only from your own devices. Open it on your phone: pocket mode, installing and push all work. Put the same address
  in **Office address for links**. `tailscale serve reset` stops it. Don't use `tailscale funnel`, which publishes the
  office to the whole internet.
- **Cloudflare Tunnel with Cloudflare Access**, or another tunnel that makes you sign in before anything reaches the
  office, also works. A tunnel without its own sign-in is not safe.

Floors' apps (the app monitor, the PR theatre, **Open in new tab**) run on the office PC's own ports, which your phone
can't reach. Away from that PC, the office shows them through its own address at `/preview/<port>/` instead, for
running previews only. Most apps work as they are; a client-side router sees `/preview/<port>/` in the address, and a
dev server's hot reload doesn't connect. On the office PC itself they open directly, as before.

Over plain `http://` on your LAN (say `http://192.168.1.20:4317`, which needs the office to listen there, which it
doesn't without `--host`) browsers refuse service workers and push, so there's no install and no push: another reason to use HTTPS.
