# Mobile app

An iOS or Android app: React Native, Expo, Flutter, Capacitor. Phones are the screen: QA checks at phone size, through the web build where there is one.

## Recommended setup

| Job | Coding agent | Why |
| --- | --- | --- |
| Build | Claude Code · Opus | The strongest builder: plans, edits many files and runs the tests itself. |
| QA | Codex | A second opinion: a different model catches what the builder missed. |
| Small fixes | Claude Code · Sonnet | Small fixes need speed more than depth. |
| Docs | Claude Code · Haiku | Cheap and quick for docs and copy. |

- **Team:** 3 agents to start.
- **Preview:** `npx expo start --web --port {port}`.
- **Test lab:** browser testing on the floor and the Test lab on, for screens and frame rates.
- **Skills:** frontend-design on for builders (Tools & skills).

## QA brief

The floor's setup card adds these when they are missing:

- Changed screens checked at phone size in the web build or a simulator
- Touch targets are at least 44 px

## Getting it ready

1. Sign in the coding agents above in Settings → Providers & accounts.
2. Open the floor's app preview once and check it starts.
3. Turn on browser testing on the floor and the Test lab in Mission control.
4. Switch on frontend-design in Tools & skills.
5. Tap the recommended button on each card in the floor's Setup section (Floors & repos).

See [all guides](README.md).
