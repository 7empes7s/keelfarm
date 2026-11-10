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

OpenCode runs on its own setup (`opencode auth login`); the office doesn't manage its accounts.

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
  `settings.json` and `plugins/` in if you want them there too.
- **API key**: paste it; the office makes one free request (the provider's model list) to check it before saving it.
- **Setup token**: name the environment variable that holds it.

## Rotation, pins and tags

Agents and the CEO run on the **rotation** by default: the first account of their coding agent that isn't paused, top
first (⋯ → Move up / down). Pin one to an account or a **tag** ("max", "api", "backup") in their setup (Team, or the
CEO's card), or ask the CEO (`configure_agent` with `account`). A pinned account runs them even while it's paused.
A session that resumes on a different account than it started on can't find its conversation: keep an agent on one
account while a task is open.

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
the account shows Limited until midnight. The ⋯ menu has Sign in again, Test, Pause/Resume, Move up/down, Rename and
tags, daily cap, the billing page (claude.ai, console.anthropic.com, platform.openai.com) and Remove. Removing waits:
sessions running on the account finish first, and no new ones start on it meanwhile.

## A separate Linux user per account

Separate config folders are enough for Claude Code and Codex to keep separate logins on one machine, so the office
needs no extra user. If you prefer a whole user per subscription (like a `keelops` user with its own install), sign
that user's CLI in as that user and run a second office as them: the office runs every session as its own user and
doesn't switch users.
