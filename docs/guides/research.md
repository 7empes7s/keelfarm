# Research & models

Notebooks, data and model training. Research reads a lot: a second text model with a long context helps with the reading.

## Recommended setup

| Job | Coding agent | Why |
| --- | --- | --- |
| Build | Claude Code · Opus | The strongest builder: plans, edits many files and runs the tests itself. |
| QA | Codex | A second opinion: a different model catches what the builder missed. |
| Small fixes | Claude Code · Sonnet | Small fixes need speed more than depth. |
| Docs | OpenCode · Gemini | A long context for reading research and notes; never the main builder. |

- **Team:** 2 agents to start.
- **Preview:** not needed.
- **Test lab:** not needed; QA runs commands.

- **Providers:** a text key in Settings → Providers.

## QA brief

The floor's setup card adds these when they are missing:

- Results are reproduced from the committed code and data
- Numbers in the write-up match the outputs

## Getting it ready

1. Add the text provider in Settings → Providers and press Test.
2. Sign in the coding agents above in Settings → Providers & accounts.
3. Tap the recommended button on each card in the floor's Setup section (Floors & repos).

See [all guides](README.md).
