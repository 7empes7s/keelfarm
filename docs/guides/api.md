# API

A server other programs call: Express, Fastify, FastAPI, Go, Rust… An API is tested by calling it: QA runs it and sends real requests.

## Recommended setup

| Job | Coding agent | Why |
| --- | --- | --- |
| Build | Claude Code · Opus | The strongest builder: plans, edits many files and runs the tests itself. |
| QA | Codex | A second opinion: a different model catches what the builder missed. |
| Small fixes | Claude Code · Sonnet | Small fixes need speed more than depth. |
| Docs | Claude Code · Haiku | Cheap and quick for docs and copy. |

- **Team:** 3 agents to start.
- **Preview:** the floor's own command (or npm run dev / start).
- **Test lab:** not needed; QA runs commands.

## QA brief

The floor's setup card adds these when they are missing:

- Each changed endpoint called for real: status codes and response bodies
- Errors and bad input give clear error bodies

## Getting it ready

1. Sign in the coding agents above in Settings → Providers & accounts.
2. Open the floor's app preview once and check it starts.
3. Tap the recommended button on each card in the floor's Setup section (Floors & repos).

See [all guides](README.md).
