# Providers & accounts

Settings → **Providers & accounts** lists every login and API key the coding agents on this computer (and the CEO)
run on. Cloud agents sign in separately, in their Boxes ([cloud.md](cloud.md)): keys saved under Settings → Cloud
agents never reach agents on this computer, the CEO or your subscription's login.

## Nothing changes until you add an account

The login the office always used is already there as the first account of each coding agent: Claude Code's
`CLAUDE_CONFIG_DIR` (or `~/.claude`) and Codex's `CODEX_HOME` (or `~/.codex`). Sessions on it run exactly as before.
It can be paused, so the others take its place, but not removed.

## The kinds of account, and what each costs

| Kind | Coding agents | What it costs | How the office uses it |
| --- | --- | --- | --- |
| **Subscription login** | Claude Code (Pro/Max), Codex (ChatGPT plan), Gemini CLI (Google AI plan) | The plan's usage limits. Nothing per token. | Signs in in its own folder, `<SWARM_HOME>/accounts/<id>/claude` (or `codex`), which its sessions get as `CLAUDE_CONFIG_DIR` / `CODEX_HOME`. Your first login is never signed out. |
| **API key** | Claude Code (Anthropic), Codex (OpenAI) | Billed per token to that API account. It never uses or changes your subscription. | Saved in `<SWARM_HOME>/secrets.json` only (never in the state, the page, events or logs). Claude Code reads it through `apiKeyHelper`, so it is never written to a settings file or set as `ANTHROPIC_API_KEY`; Codex gets `OPENAI_API_KEY`. Its sessions keep your usual Claude Code setup (skills, plugins). |
| **Setup token** | Claude Code | The subscription's limits, like its login. | `claude setup-token` prints a token that lasts a year. Put it in an environment variable of the office (the account names which, e.g. `CUBEFARM_CLAUDE_TOKEN_2`) and restart: Anthropic's terms keep apps like this one from storing Claude tokens, so the office never writes it down. |

OpenCode runs on its own setup (`opencode auth login`); the office doesn't manage its accounts. Its card shows the
version and the providers `opencode auth list` names, and **Sign in** runs `opencode auth login` in a terminal sheet.

A coding agent whose CLI isn't on this computer shows **Not installed on this computer** with **Install** (#493): its
official npm package at the version the office was tested with, into `<SWARM_HOME>/cli` (looked in before PATH), one
install at a time. The office then looks for the CLIs again, so the card turns usable without a restart; **Check again**
does the same after installing one yourself. Sign in and Add account stay disabled until it's there. In the demo,
`SWARM_DEMO_MISSING=gemini,opencode` picks the missing ones (default OpenCode) and `SWARM_DEMO_INSTALL=fail` fails the install.

### Gemini CLI (#365)

Gemini CLI runs on a Google AI plan (Plus or Pro) through a **subscription login** only: its folder is
`<SWARM_HOME>/accounts/<id>/gemini`, given to its sessions as `GEMINI_CLI_HOME` (Gemini keeps its files in `.gemini`
under it). Before a sign-in or session the office fills in what that folder's `settings.json` lacks, keeping every key
already there: the Google sign-in picked, auto-update off. Its sign-in runs one tiny prompt with `NO_BROWSER=true`:
open the link, approve, paste the code. Each session gets `--approval-mode yolo --skip-trust`, the office's
instructions as a `CUBEFARM.md` context file (it also reads `GEMINI.md`, `AGENTS.md` and `CLAUDE.md`), and its hooks
through a session settings file (`GEMINI_CLI_SYSTEM_SETTINGS_PATH`). "Usage limit reached for …" on its screen marks
the account Limited until "Access resets at …" and ends the session, so rotation carries on. Gemini CLI writes its
quota nowhere, so its card shows no usage bars. Without an account it runs on your own `~/.gemini`, which the office
never changes. It suits QA second opinions, docs, research, triage summaries and small fixes: it can't be the default
coding agent, and agents never fall back to it.

## Adding one

- **Subscription login**: Add account → Subscription login. Its sign-in is guided in three steps (#350): **Open sign-in
  page**, approve, then paste the code into the field and **Sign in** (Codex: enter the one-time code it shows on that
  page). The office reads the CLI's terminal for the link, answers its login-method menu, and shows how it ended; the
  terminal itself is under **Show terminal**, with its own **Paste code**. Sign in again from its ⋯ menu when
  it expires. A failed sign-in says why (a code works once, for a few minutes) and offers **Try again**; Claude Code's
  can run `claude setup-token` there instead.
  A new login's folder starts empty: your skills, plugins and settings in `~/.claude` aren't in it. Copy
  `settings.json` and `plugins/` in if you want them there too. The office sets it up before every session (#360):
  onboarding done, your theme, the agent's worktree trusted (Codex: in its `config.toml`), so no first-run screen
  stops an agent. A session that still opens on a sign-in ends at once: the account reads signed out, the task goes
  to the next account (or back in line), and you get one notification.

### Codex trust

Checked against Codex 0.166.0 (its source, `codex-rs/hooks` and `codex-rs/config`, and its own `codex app-server`
`hooks/list`). Before every Codex session on this computer, `readyCodexSession` (`server/cliSetup.ts`) edits the
session's `config.toml` (its `CODEX_HOME`, else `~/.codex`), under a lock and through a rename, keeping every other line:

- `[projects."<worktree>"] trust_level = "trusted"`, for the path as given and its real path (Codex looks that up first);
- for each office hook (`-c hooks.<Event>=…`), `[hooks.state."/<session-flags>/config.toml:<event>:0:0"]` (on Windows
  `C:\<session-flags>\config.toml`) with `trusted_hash`: sha256 over the hook's declaration as Codex normalizes it, so
  it matches only that exact command. Each sits under a `# cubefarm: the office's own session hook (#638)` line, and
  only marked entries are renewed when the office's hook command changes.

Never touched: other hooks' trust (a repo's, a plugin's, your own), a hook you turned off (`enabled = false`), and
office keys trusted for something else (then the log says so). A hooks review still on screen is answered with
"Continue without trusting" only when the office's own hooks are trusted; otherwise the agent shows as needing setup
and you get one notification. Cloud agents' Codex runs in their Box and keeps its old behaviour.
- **API key**: paste it; the office makes one free request (the provider's model list) to check it before saving it.
- **Setup token**: name the environment variable that holds it.

## Rotation, pins and tags

Agents and the CEO run on the **rotation** by default: the first account of their coding agent that isn't paused, top
first (⋯ → Move up / down). Pin one to an account or a **tag** ("max", "api", "backup") in their setup (Team, or the
CEO's card), or ask the CEO (`configure_agent` with `account`). A pinned account runs them even while it's paused.

## Make default, Switch now and task stickiness (#390)

A build or fix task stays on the account its first session started on: its resumes, QA fix rounds and follow-ups run
there while that account is usable (not paused, Limited, Signed out or at 95%). When it's out, rotation's fallback
applies (a fresh session on the next account, told its worktree is as it was) and the task stays on the new one. QA
runs are fresh sessions each round and follow the rotation.

- **Make default** (⋯ on an account, or the CEO's `make_default_account`) puts it first of its coding agent's. New
  tasks start on it; agents in the middle of a task finish it where they are. The chat says so ("Ultra is the default
  now: new tasks start on it; 3 agents finish their current task on Pro first.") and Mission control → Account rotation
  and Providers & accounts show "switching: 3 tasks left on Pro" until they're done.
- **Switch now** (⋯, after a confirmation; `switch_now` for the CEO) also moves open tasks, at their next session: a
  fresh session on the default in the same worktree, without its conversation. For when the old account must stop.
- **The CEO** follows the default for each job: a kept session on another account starts again at the next job, never
  mid-reply (a kept CLI is only picked up again on the account it runs on).
- **Coming back**: fallback never reorders accounts, so a default that was Limited (5-hour or weekly) is first again at
  its reset, with one chat line ("Ultra is back: new tasks start on it again."). Open tasks on the fallback finish
  where they are. No pins needed either way.

## Automatic fallback

With **Switch accounts automatically** on (Providers & accounts → Rotation, the default), each session starts on the
first usable account: the pinned account (even paused), then the pinned tag's, then the rest by priority. Accounts that
are paused, Limited, Signed out, over their daily cap or at 95% of a 5-hour or weekly limit are skipped (95% ones only
while another is free). **API keys only as a last resort** (on by default) puts API keys after every subscription.

A session that ends on a usage limit ("5-hour limit reached ∙ resets 4pm", Codex's "You've hit your usage limit"), a
429 or overloaded API, an expired login or an API key out of credit marks that account Limited until its reset (or
Signed out) and starts again at once on the next account: a fresh session (another account can't resume the
conversation) in the same worktree and branch, with no QA or fix round counted and nothing for you to do. When every
account of its coding agent is out, an agent can fall back to another coding agent the office already uses (one an
agent runs, or with an account added: **Agents fall back to another coding agent when out**); the CEO only to Codex,
and only if you allow it. The CEO's switches show in the chat as a pill
("Switched to Backup Max: Main Max is limited until 16:00"); agents' go into the CEO's next job.

When every account is out, the office posts one message with when the first one is back and pauses new work until
then; the CEO's job waits in its queue. If an API key is paused, the message has **Use API key**, which turns it on and
carries on there, billed per token. A limited account comes back by itself at its reset time, or as soon as its usage
check shows room. A pinned agent goes back to its pinned account at its next task. With only the login on this
computer (and agents on one coding agent), nothing changes: its limit pauses the office as before.

The Rotation card shows switches today, minutes saved (how long those sessions would have waited for the reset, up to
5 hours each) and what fallback spent on API keys; each account card shows a bar of when it was limited in the last
24 hours, and Mission control → Where the plan goes repeats the day's numbers. In the demo office, ⋯ → **Simulate a
limit** on an account limits it for 3 minutes and switches the sessions running on it.

## Usage, status and actions

Each card shows a status chip (Ready, Near limit at 80%, Limited until …, Signed out or No key, Paused), the 5-hour and
weekly bars for Claude subscriptions (read every 12 minutes, as the idle meter does), today's sessions and cost from
the cost ledger, limit hits in the last 7 days, and who is pinned to it. API keys can have a daily cost cap: over it,
the account shows Limited until midnight. The ⋯ menu has Sign in again, Test, Pause/Resume, Make default, Switch now, Move up/down, Rename and
tags, daily cap, the billing page (claude.ai, console.anthropic.com, platform.openai.com) and Remove. Removing waits:
sessions running on the account finish first, and no new ones start on it meanwhile.

## A separate Linux user per account

Separate config folders are enough for Claude Code and Codex to keep separate logins on one machine, so the office
needs no extra user. If you prefer a whole user per subscription (like a `keelops` user with its own install), sign
that user's CLI in as that user and run a second office as them: the office runs every session as its own user and
doesn't switch users.
