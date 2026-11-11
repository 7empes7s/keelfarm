# 3D / browser game

A game in the browser: three.js, React Three Fiber, Phaser, Babylon… Games fail on feel: QA has to play the preview in the Test lab browser and watch the frame rate.

## Recommended setup

| Job | Coding agent | Why |
| --- | --- | --- |
| Build | Claude Code · Opus | The strongest builder: plans, edits many files and runs the tests itself. |
| QA | Claude Code · Sonnet | Drives the Test lab browser and reads screenshots well. |
| Small fixes | Claude Code · Sonnet | Small fixes need speed more than depth. |
| Docs | Claude Code · Haiku | Cheap and quick for docs and copy. |

- **Team:** 4 agents to start.
- **Preview:** `npm run dev -- --port {port}`.
- **Test lab:** browser testing on the floor and the Test lab on, for screens and frame rates.
- **Skills:** frontend-design on for builders (Tools & skills).

## QA brief

The floor's setup card adds these when they are missing:

- The canvas renders with no console errors
- Frame rate stays smooth (about 60 fps, no long stalls)
- Keyboard, mouse and touch controls respond

## Getting it ready

1. Sign in the coding agents above in Settings → Providers & accounts.
2. Open the floor's app preview once and check it starts.
3. Turn on browser testing on the floor and the Test lab in Mission control.
4. Switch on frontend-design in Tools & skills.
5. Tap the recommended button on each card in the floor's Setup section (Floors & repos).

See [all guides](README.md).
