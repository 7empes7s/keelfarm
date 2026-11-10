# Static site

Pages without a server: a blog, docs, a landing page (Astro, Eleventy, plain HTML). A static site is all looks and links: a preview and a browser check catch nearly everything.

## Recommended setup

| Job | Coding agent | Why |
| --- | --- | --- |
| Build | Claude Code · Sonnet | Pages and copy rarely need the biggest model. |
| QA | Claude Code · Sonnet | Drives the Test lab browser and reads screenshots well. |
| Small fixes | Claude Code · Sonnet | Small fixes need speed more than depth. |
| Docs | Claude Code · Haiku | Cheap and quick for docs and copy. |

- **Team:** 2 agents to start.
- **Preview:** `npx serve -l {port}`.
- **Test lab:** browser testing on the floor and the Test lab on, for screens and frame rates.
- **Skills:** frontend-design on for builders (Tools & skills).

## QA brief

The floor's setup card adds these when they are missing:

- Every changed screen at 390 px and on a desktop, nothing cut off
- No console errors on the pages it touches
- Links work and nothing 404s

## Getting it ready

1. Sign in the coding agents above in Settings → Providers & accounts.
2. Open the floor's app preview once and check it starts.
3. Turn on browser testing on the floor and the Test lab in Mission control.
4. Switch on frontend-design in Tools & skills.
5. Tap the recommended button on each card in the floor's Setup section (Floors & repos).

See [all guides](README.md).
