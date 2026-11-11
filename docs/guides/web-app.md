# Web app

A site people sign in to and use: React, Next.js, Vue, Svelte… Web apps break in the browser, not in the tests: QA needs the preview and a real browser.

## Recommended setup

| Job | Coding agent | Why |
| --- | --- | --- |
| Build | Claude Code · Opus | The strongest builder: plans, edits many files and runs the tests itself. |
| QA | Codex | A second opinion: a different model catches what the builder missed. |
| Small fixes | Claude Code · Sonnet | Small fixes need speed more than depth. |
| Docs | Claude Code · Haiku | Cheap and quick for docs and copy. |

- **Team:** 4 agents to start.
- **Preview:** `npm run dev -- --port {port}`.
- **Test lab:** browser testing on the floor and the Test lab on, for screens and frame rates.
- **Skills:** frontend-design on for builders (Tools & skills).

## QA brief

The floor's setup card adds these when they are missing:

- Every changed screen at 390 px and on a desktop, nothing cut off
- No console errors on the pages it touches
- The flow the issue names works end to end in a real browser

## Getting it ready

1. Sign in the coding agents above in Settings → Providers & accounts.
2. Open the floor's app preview once and check it starts.
3. Turn on browser testing on the floor and the Test lab in Mission control.
4. Switch on frontend-design in Tools & skills.
5. Tap the recommended button on each card in the floor's Setup section (Floors & repos).

See [all guides](README.md).
