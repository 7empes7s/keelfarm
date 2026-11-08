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
| **Subscription login** | Claude Code (Pro/Max), Codex (ChatGPT plan) | The plan's usage limits. Nothing per token. | Signs in in its own folder, `<SWARM_HOME>/accounts/<id>/claude` (or `codex`), which its sessions get as `CLAUDE_CONFIG_DIR` / `CODEX_HOME`. Your first login is never signed out. |
| **API key** | Claude Code (Anthropic), Codex (OpenAI) | Billed per token to that API account. It never uses or changes your subscription. | Saved in `<SWARM_HOME>/secrets.json` only (never in the state, the page, events or logs). Claude Code reads it through `apiKeyHelper`, so it is never written to a settings file or set as `ANTHROPIC_API_KEY`; Codex gets `OPENAI_API_KEY`. Its sessions keep your usual Claude Code setup (skills, plugins). |
| **Setup token** | Claude Code | The subscription's limits, like its login. | `claude setup-token` prints a token that lasts a year. Put it in an environment variable of the office (the account names which, e.g. `CUBEFARM_CLAUDE_TOKEN_2`) and restart: Anthropic's terms keep apps like this one from storing Claude tokens, so the office never writes it down. |

OpenCode runs on its own setup (`opencode auth login`); the office doesn't manage its accounts.

## Adding one

- **Subscription login**: Add account → Subscription login. Its sign-in opens in a terminal on the page: open the link,
  approve, paste the code back with **Paste code** (Codex: enter the one-time code). Sign in again from its ⋯ menu when
  it expires. A failed sign-in says why (a code works once, for a few minutes) and offers **Try again**; Claude Code's
  can run `claude setup-token` there instead.
  A new login's folder starts empty: your skills, plugins and settings in `~/.claude` aren't in it. Copy
  `settings.json` and `plugins/` in if you want them there too.
- **API key**: paste it; the office makes one free request (the provider's model list) to check it before saving it.
- **Setup token**: name the environment variable that holds it.

## Rotation, pins and tags

Agents and the CEO run on the **rotation** by default: the first account of their coding agent that isn't paused, top
first (⋯ → Move up / down). Pin one to an account or a **tag** ("max", "api", "backup") in their setup (Team, or the
CEO's card), or ask the CEO (`configure_agent` with `account`). A pinned account runs them even while it's paused.
Automatic fallback when an account is limited comes with the next issue; for now a limit on an account you added
marks that account Limited and doesn't pause the office (the built-in login's limit still does, as before).
A session that resumes on a different account than it started on can't find its conversation: keep an agent on one
account while a task is open.

## Usage, status and actions

Each card shows a status chip (Ready, Near limit at 80%, Limited until …, Signed out or No key, Paused), the 5-hour and
weekly bars for Claude subscriptions (read every 12 minutes, as the idle meter does), today's sessions and cost from
the cost ledger, limit hits in the last 7 days, and who is pinned to it. API keys can have a daily cost cap: over it,
the account shows Limited until midnight. The ⋯ menu has Sign in again, Test, Pause/Resume, Move up/down, Rename and
tags, daily cap, the billing page (claude.ai, console.anthropic.com, platform.openai.com) and Remove. Removing waits:
sessions running on the account finish first, and no new ones start on it meanwhile.

## A separate Linux user per account

Separate config folders are enough for Claude Code and Codex to keep separate logins on one machine, so the office
needs no extra user. If you prefer a whole user per subscription (like a `keelops` user with its own install), sign
that user's CLI in as that user and run a second office as them: the office runs every session as its own user and
doesn't switch users.
