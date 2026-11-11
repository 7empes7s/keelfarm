# Design studio

Logos, mockups and images. Design work runs on an image model: add an image provider first.

## Recommended setup

| Job | Coding agent | Why |
| --- | --- | --- |
| Build | Claude Code · Sonnet | Writes the briefs and drives the image tools. |
| QA | Claude Code · Sonnet | Drives the Test lab browser and reads screenshots well. |
| Small fixes | Claude Code · Sonnet | Small fixes need speed more than depth. |
| Docs | Claude Code · Haiku | Cheap and quick for docs and copy. |

- **Team:** 2 agents to start.
- **Preview:** not needed.
- **Test lab:** not needed; QA runs commands.
- **Skills:** frontend-design on for builders (Tools & skills).
- **Providers:** a image key in Settings → Providers.

## QA brief

The floor's setup card adds these when they are missing:

- The images match the brief: size, colours, text

## Getting it ready

1. Add the image provider in Settings → Providers and press Test.
2. Sign in the coding agents above in Settings → Providers & accounts.
3. Switch on frontend-design in Tools & skills.
4. Tap the recommended button on each card in the floor's Setup section (Floors & repos).

See [all guides](README.md).
