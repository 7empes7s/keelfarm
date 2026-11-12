# cubefarm

A cartoon first-person 3D office (React Three Fiber) over a Node orchestrator that runs one coding-agent session
(Claude Code, Codex or OpenCode) per agent, plus the CEO, working through GitHub issues. Agents are interchangeable (no
roles: any free agent builds, tests or fixes) and each works on a machine of its own (docs/agents.md).
This is the app the company runs on: a live office is running from this repo right now. README.md is the quick start; docs/how-it-works.md and CONTRIBUTING.md have the details.
It ships on npm as `cubefarm` (`npx cubefarm`); it used to be called Office Swarm.

## SAFETY (read first)

- The live office runs from `/root/keelfarm` on this Linux machine (`node scripts/office.mjs --no-open` under the
  systemd unit `cubefarm.service`), on port 4317 (5317 is its Vite's), with its state in `/root/.cubefarm`. Never edit
  or run anything in `/root/keelfarm`, never read or write the office's own state in `/root/.cubefarm` (your machine's
  folder under it is yours), and never use ports 4317 or 5317.
- Test only in demo mode (fake GitHub, fake agents, no Claude usage), with an isolated `SWARM_HOME` and your reserved
  `SWARM_PORT` (from your job instructions):

  ```bash
  npm install
  npm run build
  SWARM_HOME="$PWD/.swarm-home" SWARM_PORT=<your port> node --import tsx server/index.ts --demo
  ```
  ```powershell
  npm install; npm run build
  $env:SWARM_HOME="$PWD\.swarm-home"; $env:SWARM_PORT="<your port>"; node --import tsx server/index.ts --demo
  ```
  Then open `http://localhost:<your port>` (the server serves the built `dist/`). The startup banner must say
  `DEMO MODE` and print a `state:` path inside your `SWARM_HOME`. Stop it when done; don't commit `.swarm-home`.
- Never real mode (no `--demo`), and never `npm run dev` / `npm run demo` / `npm start` / `npx cubefarm`: they default
  to 4317, and `dev`/`demo` default Vite to 5317. The first three run `scripts/office.mjs`, the launcher, which also
  updates its own folder (git fetch + merge, npm install, build) when the office or you ask for it (`u`). Run it
  only in a throwaway clone outside the live office, with `--demo` and your `SWARM_HOME`, `SWARM_PORT` and
  `SWARM_CLIENT_PORT`.
- Agents are ordinary coding-agent CLI sessions on the manager's own setup, unsandboxed, by the manager's choice. The
  office's workflow rules (no pushes to the default branch, no merging, QA leaves GitHub alone) live in their prompts
  and instructions, not in enforcement: don't add hooks, permission rules or sandboxes that refuse tool calls.
  `ANTHROPIC_*` / `CLAUDE_*` are stripped from agent and preview env.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` over client, server, shared, the `.ts` in scripts and the configs |
| `npm run lint` | the code-health ratchet (`scripts/codeHealth.mjs`): oxlint (type-aware), knip and the file-size budget, failing only on what `code-health.baseline.json` doesn't list; `npm run lint:update` lowers it |
| `npm test` | Vitest, once (`npm run test:watch` to re-run on edits) |
| `npm run build` | typecheck, `vite build` to `dist/`, then the server bundled into `dist-server/` (`scripts/build-server.mjs`) |
| `npm run test:e2e` | optional, local only: Playwright (`e2e/`, `playwright.config.ts`): builds (`E2E_SKIP_BUILD=1` reuses your `dist/`), boots a demo office on `E2E_PORT` (default 4399; set it to your reserved port) with a temp `SWARM_HOME`, and smoke-tests it headless in a local Google Chrome, else Playwright's Chromium. Stops at once if the browser is missing: never install it mid-task |
| `node scripts/smoke-package.mjs` | after a build: packs the npm package, installs it into a temp folder and boots its demo |
| `npm run bench -- --port <yours>` | after a build: the scale benchmark (`scripts/bench.mjs`): boots the big-company demo headless, visits the lobby and three floors, writes FPS, frame-time p95, CPU per frame, draw calls, triangles, heap, audio nodes and websocket traffic to a JSON report (`--help`) |
| `node --import tsx server/index.ts --demo` | a demo office (see SAFETY for the env it needs); `--no-tour` opens it without the setup wizard or tour, for QA's browser |

CI (`.github/workflows/ci.yml`): Node 24, `npm ci` → `typecheck` → `test` → `build` → package smoke test → `lint`, for every PR
and push to `main`, with a throwaway `SWARM_HOME` and `SWARM_PORT=0`, on `ubuntu-latest` always and on `windows-latest`
unless a PR touches nothing OS-sensitive (only `client/`, `e2e/`, docs: it shows as skipped). No macOS job: this
copy's office runs on Linux, and GitHub's macOS runners often never start.
e2e is not part of CI. Locally, `typecheck`, `lint`, `test` and `build` must pass before you open a PR. Don't run `test:e2e`
unless an issue asks for it. If your change shows up in the office, boot your own demo office, check it in a real
browser with the Playwright tools, and put screenshots in the PR. `.github/workflows/release.yml` publishes to npm when the manager runs it from GitHub's Actions tab or pushes a
`v*` tag (npm trusted publishing, tied to that file name); never publish or tag releases yourself.

## Code map

Server (`server/`, Node + Express 5 + ws, run by tsx in development; esbuild bundles it into `dist-server/` for npm):
- `index.ts`: entry; picks the real or demo backend, REST routes under `/api`, the `/ws` and `/ws/term` websockets, serves `dist/`, shutdown.
- `config.ts`: `SWARM_PORT` (default 4317), `SWARM_HOST` (default 127.0.0.1; `npx cubefarm --host`), `SWARM_HOME` (default `~/.cubefarm`), `--demo`, state file, intervals,
  the default projects folder.
- `swarm.ts`: the orchestrator. Floors, agents, scheduling/auto-assign, build → QA → fix → merge loop, team changes
  (the CEO's `scale_team`, lobby approvals), CEO job queue, phone messages, persistence (`state.json` / `demo-state.json`), websocket fan-out (through
  `outbox.ts`). `Swarm` is the façade (index.ts, ceo.ts and the tests use only it); its parts are layers in `server/swarm/`,
  each an abstract class extending the one before, so a method's code sits in one file but every method is on `Swarm`.
  Shared fields are `protected`; a lower layer calling a higher one's method declares it in `contract.ts`.

  Where things live (`server/swarm/`, bottom of the chain first):

  | File | What |
  | --- | --- |
  | `model.ts`, `flavour.ts`, `screens.ts` | persisted shapes, runtimes, constants; names, colours, looks; screenshots on disk |
  | `contract.ts` | the methods lower layers call on higher ones (`protected abstract`) |
  | `core.ts` | state and runtimes, the constructor's services, views and the snapshot, `/ws` clients and broadcast, the state file, lookups |
  | `repos.ts` | connecting floors, syncing issues and PRs, previews, manager commands on GitHub |
  | `merge.ts` | auto-merge, folder syncs after merges, closed issues and PRs |
  | `agents.ts` | hiring and firing, agent commands, cloud agents' machines and sign-ins, Tools & skills |
  | `cloudCredit.ts` | cloud agents off an API key out of credit (#258): own login, the sign-in card per burst, back on the key |
  | `providers.ts` | Settings → Providers (#362): keys added there and MCP servers for agents' sessions (`server/providers.ts`, catalogue and cards pure in `shared/providers.ts`), the `providers` event, the CEO's line |
  | `usage.ts` | usage for every account and provider (#361): the usage card's sources (`usageSources.ts`, `codexLimits.ts`), 90% notifications, Admin keys |
  | `sessions.ts` | terminals, desk setup, prompts, starting and finishing build sessions |
  | `qa.ts` | queueing PRs for QA, QA and fix sessions and their outcomes |
  | `scheduling.ts` | the scheduler and hand-out, pacing on Claude's usage, mission control |
  | `update.ts` | the office's own update: drain, hand-over to the launcher, the result after a restart |
  | `reactions.ts` | the chat's delivery and status reactions, the CEO's react and reply tools, the manager's reactions (#118) |
  | `ceoModels.ts` | the CEO's model per kind of job, kept sessions on the same model, the retry on its own model (#331) |
  | `ceoFresh.ts` | background jobs in fresh sessions with the office's digest, a full chat session's handover (#330; rules in `server/ceoDigest.ts`) |
  | `ceoLog.ts` | the CEO jobs log and Redo on Opus (#332): each job's number, log row and kept inputs, the redo on the CEO's model (rules in `server/ceoRedo.ts`, `shared/ceoJobLog.ts`; the demo's in `server/ceoJobSample.ts`) |
  | `ceoJobs.ts` | the CEO's job queue, follow-ups, triage, the phone, notifications |
  | `ceoStuck.ts` | a stuck CEO (#375): its sessions' blocked screens and a minute's silence as a chat card (Open terminal, Sign in, Switch back) and one notification (words in `server/ceoStuck.ts`) |
  | `upkeep.ts` | idle desks, the watchdog and doctor, progress, ping-pong |
  | `team.ts` | hire and let-go requests, approvals, `scale_team` |
  | `itDesk.ts` | the IT desk (#506): it_run's read-only commands, it_propose's cards with Run / Not now, the never-list again at Run, the log (rules pure in `server/itDesk.ts`, runner `server/itExec.ts`) |
  | `itDept.ts` | the IT department (#524): the IT lead's own session (Settings → The IT department), chat, Telegram bot (`telegramIt`) and tools (`server/ceoItTools.ts`), the CEO's `ask_it`, a Run's result checked by IT (rules pure in `shared/itDept.ts`, prompts `server/itLead.ts`) |
  | `itTickets.ts` | IT tickets (#542): agents' and the CEO's it_report, the office's own tickets (lab errors, stuck agents, sign-in screens, previews, CI, disk), IT woken for a blocking ticket or a burst, its it_ticket, "Waiting on IT #N" (rules pure in `shared/itTickets.ts`, the demo's in `server/itTicketSample.ts`) |
  | `ceoTools.ts` | the CEO's office tools (`officeTools`, `company_status`, mandates, read-only tools) |
  | `voices.ts` | a voice for every agent (#320): picked on hire, or when a key is saved or ElevenLabs turned on |
  | `serverLoad.ts` | the server's load by program (#271): who's who for the grouping, the reading every 15 s, the 24 h trend, "Stop it" for leftovers |
  | `disk.ts` | the disk (#340): free space on the health strip and its hold, the hourly cleanup and "Free up space", the working copies' disk |
  | `setup.ts` | the setup advisor (#366): each floor's use case (guessed from its repo's top files), its gaps against `shared/useCases.ts`' recommendations (rules pure in `shared/setup.ts`), one notification per gap, Not now, the fixes, the CEO's `apply_setup` |
  | `../swarm.ts` | `Swarm` itself: startup (`init`), restart recovery, chat to agents, settings and setup |
- `outbox.ts`: what goes out on `/ws`: agents' and floors' changes batched on a 250 ms tick as patches of what
  changed, terminal lines only to the tabs that show them (`shared/watch.ts`), catch-ups when a tab's watch changes.
- `agentRunner.ts`: one Agent SDK session; options, env stripping, Playwright MCP, and turning the SDK stream into
  terminal lines.
- `cliRunner.ts`: the terminal runtime (the default): one agent as the real CLI in a node-pty, same session contract
  as `agentRunner.ts`. Claude Code reports through HTTP hooks (`POST /api/hooks/:token`; PreToolUse approves every
  call); Codex reports turn endings (notify) and, once the manager trusts them, its steps (`-c hooks.*`); OpenCode
  only turn endings. Codex/OpenCode screenshots are collected from the session's Playwright output folder. Esc in a
  terminal ends the session as `interrupted`. The CEO's office tools are served over MCP (`/api/mcp/:token`).
- `ptyHost.ts`: the terminal keeper, a detached process of its own (`launch` re-spawns it outside the office's process
  tree) holding the CLIs' pseudo-terminals and relaying their hooks, so agents keep working through office restarts.
  `ptyClient.ts` is the office's side (start/connect, spawn, adopt after a restart, local fallback); `ptyProtocol.ts`
  their JSON-lines messages. The launcher's `office:shutdown` says `restart: false` when quitting: CLIs stop then.
  An agent's CLI stays at its prompt after building or fixing (`keepAlive`): follow-ups and prompts typed there reuse it.
- `unblock.ts`: nothing waits on a human (pure): each Claude Code session's worktree permission rules, every CLI's
  non-interactive environment (`cliEnv`), the answers to PermissionRequest / Elicitation / AskUserQuestion hooks, and
  the watchdog's steps for a prompt still on screen (answer it, else the agent is `blocked`, notified after 5 minutes).
  `cliScreens.ts` (#360) is the table of first-run and warning screens answered at start-up (theme, trust, warnings),
  and the sign-in that ends a session instead; `cliSetup.ts` sets up an account's login folder before each session
  (onboarding, theme, the worktree trusted; the Box seed applies the same), never the built-in login's.
- `clis.ts`: the CLIs (Claude Code from the SDK's bundled binary, Codex, OpenCode, Gemini CLI): detection, Windows `.cmd` shim
  unwrapping, each one's command line, and the helper scripts they call back with. `geminiHome.ts`: a Gemini login
  folder's first-run settings (#365); what each CLI suits is in `shared/cliNotes.ts`.
- `terminal.ts`: `AgentTerminal`, a headless xterm mirror per agent (replay for late viewers, saved to disk), its
  `/ws/term` viewers, and keystrokes/resizes to the running CLI.
- `ceo.ts`: the CEO's office MCP tools (`createOfficeTools`, zod-validated: `scale_team`, `configure_agent`, issues,
  triage), `scalePlan` (team-size arithmetic), `ceoSystemPrompt`, `ceoJobPrompt`.
- `backend.ts`: the `Backend` interface (everything touching GitHub, git, disk and sessions) and `realBackend`.
- `machines.ts`: agents' machines, `MachineProvider`: each agent's own clone, worktree and temp folder (the local
  provider is folders under `<SWARM_HOME>/machines/<machine>/`, in `workspace.ts`; cloud agents' are Upstash Boxes).
- Cloud agents (docs/cloud.md, opt-in; `PersistedAgent.host === 'box'`): `cloud.ts` is the account (the Upstash key and
  pasted keys in `secrets.json`, `CUBEFARM_CLAUDE_TOKEN` read from the environment and never saved, credential
  resolution, `CloudView`); `box.ts` the only importer of `@upstash/box` (`BoxApi`, which the demo fakes);
  `boxMachines.ts` the Box `MachineProvider` (create, set up, prepare, pause, leftovers); `boxScripts.ts` the shell
  scripts run in a Box (pure, tested); `boxHelpers.ts` the programs put in a Box (launcher, hooks writing to the
  session's `events.jsonl`); `boxCli.ts` `BoxPty` (the CLI under tmux, its events read from a byte offset, reattached
  after drops and restarts). Credentials only ever travel as one Box command's environment. Without a key for its CLI,
  a cloud agent's CLI uses its own login in the Box: `Swarm`'s sign-in checks it before each task (`needsSignIn`
  holds the task) and runs the CLI's own login in their terminal (`cliRunner.ts` `startBoxSignIn`); the office never
  reads that login.
- `demo.ts`: `createDemoBackend()`: fake GitHub, fake sessions (drawn into the agent's terminal in the terminal runtime), fake previews and machines for `--demo`;
  `--floors N --agents N` (or `SWARM_DEMO_FLOORS` / `SWARM_DEMO_AGENTS`) makes it a big company for scale tests. It only
  wires `demo/`: each feature's module there registers its fakes (`registerDemo`) and the demo CEO's replies that show
  its tools (`registerCeoReply`) in `demo/registry.ts`, `demo/index.ts` imports them, `demo/world.ts` is the fake GitHub's
  state; `demo/parity.test.ts` checks every Backend member and CEO tool has a fake.
- `github.ts`: all GitHub access through the `gh` CLI.
- `workspace.ts`: floor checkouts, the preview worktrees (`<SWARM_HOME>/workspaces/<owner>__<repo>/desks/<name>`),
  local machines (clone, worktree, branch sweep, removal with leftovers), fast-forwarding main, a git lock per clone,
  stopping processes an agent left running.
- `exec.ts`: `run` / `git` / `gh`: `execFile` without a shell, prompts disabled, `CommandError` with stderr.
- `previews.ts`: one preview per floor: ports (6300 + floor), statuses, config validation; and the PR theatre's PR
  previews (`prTheatre.ts`: their slots, ports, eviction and idle stop, pure; `syncProxy.ts`: compare mode's synced scrolling).
  `previewPids.ts`: the previews' processes in `<SWARM_HOME>/previews.json`, so a restart reclaims the office's own
  leftovers and names anything else on a preview port (#225; the demo's `SWARM_DEMO_LEFTOVER=ours|foreign`, `demoLeftover.ts`).
  `previewGateway.ts`: previews through the office's own address at `/preview/<port>/` for other devices, with a
  service worker keeping the apps' root paths under it.
- `portLanes.ts`: the live office's preview lanes (6300-6499), which a demo office refuses; each agent's port block,
  put in their sessions' env (`SWARM_PORT`, `SWARM_PREVIEW_PORT`) so a demo office they start stays on it, and the lab's (#227).
  `procSweep.ts`: nothing outlives its session: what listens from an ended session's worktree goes with its process
  group, and every watchdog tick stops processes in machines' worktrees no live session owns (Linux, by cwd).
- `qaShots.ts`: QA's screenshots of each PR's latest round, kept for the app viewer's QA panel.
- `previewRunner.ts`: checks out, installs and runs a floor's app in its preview worktree; kills the process tree.
- `tooling.ts`: Settings → Tools & skills' inventory: what a Claude Code session here loads (`claude plugin list --json`,
  plugin folders, skills, MCP configs), read only, secrets masked. The switches (Everyone, the CEO, each agent) and how
  they become a session's `--disallowedTools` / `enabledPlugins` are pure, in `shared/tooling.ts`.
- `accounts.ts`: Providers & accounts (#247, docs/accounts.md): the registry (`<SWARM_HOME>/accounts.json`, no secrets;
  API keys in `secrets.json`), which account a session runs on and what it adds to its env (pure, `shared/accounts.ts`),
  usage per login, sign-in terminals (`/ws/term?agent=account:<id>`); `accountCheck.ts` its Test, `demoAccounts.ts` the demo's.
- `httpError.ts`: `HttpError(status, message)`.
- `officeUpdate.ts`: the office's self-update: the drain decision, the launcher contract (IPC, `last-update.json`).
- `pacing.ts`: pacing new work after Claude's usage warnings: the start/skip decision and the usage state.
- `health.ts`: resource safety (#55): sessions start only when memory and swap leave the headroom (per-kind estimates
  learned from peaks; the CEO always starts), each agent's processes measured through /proc on Linux (stopped over the
  ceiling or under pressure), killed sessions resumed twice then re-queued, the health strip's view. `shared/health.ts` has the settings.
- `serverLoad.ts`: the server's load by program (#271): /proc read every 15 s (memory, swap, load, disk, each process's RSS
  and CPU) and grouped into programs (agents' CLI sessions, their test browsers and demo offices, previews, the office,
  Postgres/Docker), orphans, and a 24 h trend in memory; pure parsing and grouping first. `shared/serverLoad.ts` has the
  types and trend rules; the chat's `server:*` sources and Mission control's `ServerCard.tsx` draw it; `demoServerLoad.ts` is the demo's.
- `diskCare.ts`: the disk on this computer (#340, rules pure in `shared/disk.ts`): free space, what agents' machines hold, removing only inside them,
  and machines on a second disk (linked from `<HOME_DIR>/machines/<machine>`, moved when idle); `demo/disk.ts` is the demo's.
- `presence.ts`: shared presence: relays tabs' poses, emotes and pings on `/ws` to their floor (pure interest and rate
  rules), never saved; `demoVisitors.ts` walks the demo's fake visitors. Names and limits in `shared/presence.ts`.
- `voice.ts`: phone messages read aloud (docs/voice.md): the ElevenLabs key in `secrets.json`, voices, cached clips;
  `elevenlabs.ts` is its REST client. The words spoken come from `shared/speech.ts`. `secrets.ts`: that file's reads and merged writes.
- `notifier.ts`: notifications (docs/pocket.md): the rate-limited fan-out to open tabs (desktop), Web Push and the chat
  apps' webhooks (secrets in `secrets.json`, push keys and devices in `push.json`), behind `Backend.notify`; `notify.ts`
  is its pure part (formatting, the per-event rate limit, webhook checks), `webPush.ts` VAPID and RFC 8291 encryption,
  `shared/notify.ts` the settings. `pwa.ts`: the installable app's service worker, served at `/sw.js`.
- `costLedger.ts`: the cost ledger (#18): a line per finished session (task kind, effort, cost, outcome) and merged PR in
  `<SWARM_HOME>/costs.jsonl`, 30 days, never in the snapshot; it backs Mission control's "Where the plan goes"
  (`GET /api/costs`) and company_status's spend. Kinds, waste rules and effort per kind: `shared/costs.ts`.
  Each new session's startup context (#50: its first turn's input tokens, split into the office's texts, CLAUDE.md
  files and the rest) is on its line: `shared/startup.ts`. Lean role profiles (builders and fixers, QA, the CEO) are in
  `shared/tooling.ts`; the office-wide playbook is `settings.officePlaybook`, in `prompts.ts`'s stable `floorContext`.
- `history.ts`: the daily work log and session history (#49): an entry per finished session and office merge in
  `<daily dir>/YYYY-MM-DD.md` (Settings; `/opt/ai-vault/daily` when it exists, never from the demo or tests), each
  Claude Code transcript gzipped to `<SWARM_HOME>/history/YYYY/MM/DD/`, an index for the History tab and the CEO's
  `session_history`, the nightly sweep. Formats and rules are pure, in `shared/history.ts`; `historySample.ts` is the demo's.
- `experiments.ts`: the lab (#23): A/B experiments on harness practices in `state.json`, the variant each new issue in a
  running one gets (seeded, stratified by floor and size), what it changes in its sessions (`launchSession`), and its PR's
  outcome and survival. The rules and statistics are pure, in `shared/experiments.ts`; `experimentSample.ts` is the demo's.
- `journal.ts`: the time-lapse journal (`<SWARM_HOME>/journal/<day>/`): records what `Swarm.broadcast` sends, a file
  per 10-minute keyframe, pruning, and the reads behind `/api/journal/*`. The rules (what's kept, secrets, seeking,
  marks) are in `shared/journal.ts`; `journalSample.ts` is the demo's made-up day.

The `cubefarm` command (`bin/cubefarm.js`, plain JS): checks Node/git/gh/Claude login, starts `dist-server/index.js`,
opens the browser; `login` and `doctor` subcommands.

The launcher (`scripts/office.mjs`, plain JS; `npm run dev` / `demo` / `start`): runs the server (plus Vite with
`--dev`, watching `server/` and `shared/`) with `SWARM_LAUNCHER=1` and an IPC channel, and applies office updates:
stop, fast-forward, install/build, restart, roll back on failure, `<SWARM_HOME>/last-update.json`. Its pure decisions
are in `scripts/officeSteps.mjs` (tested in `officeSteps.test.ts`).

Shared (`shared/`, imported by both sides):
- `types.ts`: the REST/websocket contract (`WorldSnapshot`, `ServerEvent`, views, settings), one file per area in
  `types/` (agents, repos, chat, notify, settings, events…, each under 400 lines), all re-exported from `types.ts`:
  add a type to its area's file and import it from `shared/types`.
- `issues.ts`: issue conventions (`swarm:skip`, `Depends on #N`, hold-up ranking).
- `journal.ts`: the time-lapse journal's format and pure rules, for the server and the replay.
- `chatPage.ts`: the CEO chat in pages (#145): the snapshot's latest page, older ones on scroll up (`client/src/ui/ChatPaging.tsx`), deleting and hiding messages.
- `chat.ts`: the phone chat's rules: a reply's quote forwarded to the CEO, delivery states, quick Yes / No (links: `client/src/ui/chatLinks.ts`).
- `watch.ts`: which terminal lines a tab gets: its floor, open panels, the workers list's latest lines.
- `memoryMap.ts`: the memory map (#136): the office as a graph (nodes, edges, weights, caps), its filters, local graph, search, insights and live changes; built in the tab from the snapshot (`client/src/ui/MemoryMap.tsx`, canvas and physics in `MapCanvas.tsx` / `mapForce.ts`); the 3D office's map room (#137, a lazy `mapRoom` overlay from the CEO's map table) swaps the stage for `Constellation.tsx`, its 3D layout, LOD and effects pure in `skyLayout.ts`).
- `looks.ts`: the look editor's options and `cleanStyle` (an agent's `style`, checked on the server).

Client (`client/`, Vite root; React 19, R3F, drei, zustand):
- `src/world/`: the 3D building: floors, desks, characters (`appearance.ts`, `characterParts.ts`, `Figure.tsx`, `face.ts`), elevator,
  whiteboard, player movement and collisions (`layout.ts`), canvas textures (`draw.ts`), `toys/` (Rapier physics),
  where people can walk (`walkways.ts`: the walk grid, paths, named spots and steering, on the roomba's grid),
  errands that get them up (`errands.ts`: the registry and who may go; `ErrandDirector.tsx` runs them), toy
  errands (`toyErrands.ts`: hoops and catch, on `toys/npc.ts`, the toys' hands for people, aimed by `toys/npcAim.ts`),
  comings and goings (`socials.ts`: new agents by elevator, leavers with a box, chats, visits, the CEO's stroll),
  the time of day (`sky/time.ts`, `sky/useDayTime.ts`) and the city outside (`outside/`: the seeded layout in
  `cityLayout.ts`, drawn by `City.tsx` in six instanced draw calls), the camera's other views (`camera/`: the
  overview, the building view and the follow cam in `rig.ts`, pose maths in `cameraMath.ts`, the cutaway as global
  clipping planes), the gamepad (`gamepad.ts`) and the graphics tiers (`gfx/`: Low/Medium/High/Auto in `quality.ts`
  with Auto's governor, post-processing in a lazy chunk (`Effects.tsx`, `pipeline.ts`); a material blooms only if
  `bloomMarks.ts` marks it), the other people viewing the office (`presence/`: visitors, pings, the profile),
  holiday themes (`themes/`: which one is on from `shared/themes.ts`, their data and decoration slots in `themes.ts`
  and `layout.ts`, each theme's scene in one lazy chunk loaded only while a theme is on; `?theme=` and `?date=` for QA).
- `src/ui/`: HTML overlays: HUD, terminal (`LiveTerminal.tsx`: xterm.js on `/ws/term`), Kanban, manager's console,
  phone (`Phone.tsx`; its chat in `Chat.tsx` / `ChatBubble.tsx`, team changes in `TeamChanges.tsx`, mini-games in `games/`: pure logic in `tetris.ts` / `snake.ts` / `pet.ts`), elevator panel, app
  viewer, sounds (`sfx.ts`), key bindings (`keymap.ts`, pure; `controls.ts` keeps the player's own, and every
  shortcut asks it, never a hard-coded key).
- Accessibility (Settings → Accessibility, `ui/a11y.ts`, saved per browser through pure `a11yPrefs.ts`): captions
  (`captions.ts`, rules in `captionRules.ts`; every sound `sfx.ts` records is offered to them), status colours and
  shapes (`statusLook.ts`, shared by CSS and the canvases), motion comfort (call `reduceMotion()` before animating
  the camera or anything non-essential), UI scale, readable font, high contrast. Dialogs use `dialogFocus.ts`
  (focus in, trapped, returned); `announce()` speaks to screen readers; `FloorList.tsx` is the list view.
- `src/pocket/`: pocket mode (docs/pocket.md), the 2D office for phones (`mode.ts` picks it; `App.tsx` loads it or the
  3D `Office.tsx` lazily, so a phone never downloads three.js). `src/pwa.ts` registers the service worker and Web Push
  (one sign-up step per tap in `pushSteps.ts`; the setup checklist in `ui/notifySteps.ts`, drawn by `NotifyGuide.tsx`);
  `src/notifications.ts` shows desktop notifications. `ui/Panel.tsx` is the panel, apart from `Overlays.tsx` (3D).
- `src/photo/`: photo mode and clips, lazy-loaded except `gate.ts` (on/frozen, the K and I keys, `__swarmPhoto`):
  `PhotoScene.tsx` (its own camera; frozen, the frame loop stops and it draws on change), `post.ts` (filters and depth
  of field on the finished picture), `recorder.ts` / `instantReplay.ts` (MediaRecorder; `webmRing.ts` keeps the last 15 s),
  `PhotoPanel.tsx`, and pure `flight.ts`, `shots.ts`, `filters.ts`.
- `src/store.ts`: the zustand store; `apply(ServerEvent)` folds websocket events into UI state through one handler per
  event in `src/store/apply/<area>.ts` (each area also gives its share of the snapshot), merged in `store/apply/index.ts`.
- `src/api.ts`: REST calls; errors become toasts.
- `src/viewport.ts`: the phone's viewport (#73): `--app-height` / `--app-top` from visualViewport for every full-screen
  view (pocket mode divides them by the UI scale), put back after the keyboard, a send, a photo or `pageshow`; the
  zoom lock on touch screens; `data-insets-covered` where a browser's toolbars cover the safe areas it reports.
- `src/routes.ts` / `routeLink.ts`: deep links to every page, tab, sheet and 3D place (docs/deep-links.md); QA waits
  for `html[data-route-ready]` after opening one.
- `src/net.ts`: the websocket connection with reconnect; it sends the tab's watch (`src/watch.ts`) as it changes.
  `src/perf.tsx`: render pausing, adaptive DPR, `?stats` (and `window.__swarmStats` with a census of what's drawn).
- `src/world/batch.ts` / `Batched.tsx`: a floor's repeated parts (Toon.tsx's boxes, people's `Piece`s) drawn as
  instanced batches behind invisible stand-ins (`?batch=off` to compare). `src/world/paint/`: canvas textures
  recorded here and painted in an OffscreenCanvas worker, with the canvas path as fallback (`?paint=main`).
- `src/replay.ts`: the time-lapse: plays the journal through `store.apply(ev, 'play' | 'seek')` while live events
  wait; `replayClock.ts` is its pure clock and "since I was last here", `ui/TimeLapse.tsx` its console tab and bar.

## Conventions

- ESM TypeScript everywhere (`"type": "module"`), strict, `noUnusedLocals`/`Parameters`. The server runs through
  tsx and imports with `.ts` extensions (`import { run } from './exec.ts'`); client files import without extensions.
- Comments are sparse and say why: a short header comment per file describing its role, `/** */` on exported
  functions and interface fields when the name isn't enough, inline notes for Windows or safety reasons, and
  `// ---------- section ----------` dividers in long files. No commented-out code.
- Demo parity: every new `Backend` method, CEO tool or capability gets a fake in its feature's module under
  `server/demo/` (a new one, listed in `demo/index.ts`), so `--demo` works with no GitHub, no git/npm and no Claude usage.
- UI state comes from the server: on connect the client gets a `snapshot`, then typed `ServerEvent`s (`repo`,
  `agent`, `qa`, `ceo`, `message`, `toast`, …) from `Swarm.broadcast`; agents' and floors' frequent changes come
  batched as `agents` / `repos` patches and terminal lines as `logs` / `latest`, only for what the tab shows
  (`server/outbox.ts`). Add new state to `shared/types.ts`, the snapshot and an event, and handle it in its area's
  `client/src/store/apply/<area>.ts` (or a new area listed in `index.ts`). REST is for commands, not for polling state. A big company must fit `server/scale.test.ts`'s budgets.
- REST errors: throw `HttpError(4xx, message)`; the handler in `index.ts` returns `{ error }` JSON, anything else
  is a logged 500. Validate request bodies by hand at the route or in the swarm.
- CEO tools: zod input schemas, errors worded so the CEO can act on them, small outputs.
- Windows first (the office runs on Windows):
  - build paths with `path.join` / `path.resolve`; paths may contain spaces, so pass args as arrays (`execFile`),
    never string-built shell commands;
  - `fs.rm` with `maxRetries` for EBUSY/EPERM file locks; write state to a temp file and `rename`;
  - kill process trees, not just the child (`taskkill /T /F` on Windows, process groups elsewhere);
  - `windowsHide: true` on spawns; npm on Windows goes through `cmd.exe`.
- Agent prompts are paid for on every session: keep prompt text short and specific.
- 2D UI follows docs/design.md: new styles go in a css file next to their component, imported by it (`styles.css`
  keeps tokens, resets and buttons; `sheets.css` keeps its old feature blocks in cascade order); tokens from `client/src/design.css`, 44px targets, destructive actions only in a ⋯
  `Menu` (`ui/Menu.tsx`) then a confirmation; add changed screens to their screen's file in `e2e/layout/` (under 300 lines each).

## Code health

- `npm run lint` fails on findings the baseline doesn't have: a new lint finding in a file (per rule), a new unused
  file/export/type/dependency (knip), a new file over 800 lines (300 in `e2e/layout/`, 400 in `shared/types/`), or a file over 800 grown past its recorded size + 5%.
  Fix it; don't silence it. Fixed old ones? `npm run lint:update` and commit `code-health.baseline.json`.
  `--accept` (record as is) only for renames or a stated exception. No formatter, no reformatting. CONTRIBUTING.md
  and docs/code-health.md have the details and the cleanup backlog.

## Tests

- Vitest, `*.test.ts` next to the code, anywhere under `client/`, `server/`, `shared/` or `scripts/`
  (e.g. `shared/issues.test.ts`, `client/src/world/layout.test.ts`, `server/ceo.test.ts`). Config: `vitest.config.ts`.
- Test pure functions directly; extract logic into pure helpers rather than mocking. No network, no `gh`, no Claude
  sessions, no real `~/.cubefarm`: `npm test` already points `SWARM_HOME` at a temp folder and `SWARM_PORT` at 0.
- Must pass on both CI runners (ubuntu + windows): don't hardcode `/` or `\` in expected paths.
- E2E: one spec file per feature, setup from `e2e/helpers.ts`; new e2e tests go in their feature's spec file or a new one, never appended to `smoke.spec.ts`.

## Pull requests

- One issue per PR, `Closes #<n>` in the body. Keep the diff small and on-topic.
- Many PRs merge in parallel and auto-merge sends conflicts back: don't reformat, reorder or rename code you aren't
  changing, and don't touch unrelated files.
- Before opening it: `typecheck`, `lint`, `test` and `build`. `test:e2e` only when an issue asks for it; CI doesn't run it.
- Say how you verified it and list your assumptions. UI changes get screenshots from the demo office.
- Never push to `main`, never force-push, never merge your own PR.
