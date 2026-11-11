# Ops

Servers, Docker, Terraform, CI. Ops work touches real servers: a cloud provider key, and QA that only dry-runs.

## Recommended setup

| Job | Coding agent | Why |
| --- | --- | --- |
| Build | Claude Code · Opus | The strongest builder: plans, edits many files and runs the tests itself. |
| QA | Codex | A second opinion: a different model catches what the builder missed. |
| Small fixes | Claude Code · Sonnet | Small fixes need speed more than depth. |
| Docs | Claude Code · Haiku | Cheap and quick for docs and copy. |

- **Team:** 2 agents to start.
- **Preview:** not needed.
- **Test lab:** not needed; QA runs commands.

- **Providers:** a cloud key in Settings → Providers.

## QA brief

The floor's setup card adds these when they are missing:

- The change is planned or dry-run first, never applied to live servers by QA
- Secrets stay out of the repo

## Getting it ready

1. Add the cloud provider in Settings → Providers and press Test.
2. Sign in the coding agents above in Settings → Providers & accounts.
3. Tap the recommended button on each card in the floor's Setup section (Floors & repos).

See [all guides](README.md).
