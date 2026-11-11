# CLI or library

A command-line tool or a package others import. No screen to look at: QA runs the commands and reads the tests.

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

## QA brief

The floor's setup card adds these when they are missing:

- The changed commands or functions run for real, with their output checked
- Tests cover the change and pass

## Getting it ready

1. Sign in the coding agents above in Settings → Providers & accounts.
2. Tap the recommended button on each card in the floor's Setup section (Floors & repos).

See [all guides](README.md).
