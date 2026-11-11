# Setup guides

Each floor has a kind of project (its use case). The office guesses it when a floor's repo is cloned (from package.json, pyproject.toml, Cargo.toml…) and you can change it in the floor's Setup section. It then compares the floor with the recommended setup below and shows one card per gap, with the recommended action first and Not now. The same guides are in the app under Settings → Guides.

| Kind of project | Build | QA | Why |
| --- | --- | --- | --- |
| [Web app](web-app.md) | Claude Code · Opus | Codex | Web apps break in the browser, not in the tests: QA needs the preview and a real browser. |
| [API](api.md) | Claude Code · Opus | Codex | An API is tested by calling it: QA runs it and sends real requests. |
| [3D / browser game](game-3d.md) | Claude Code · Opus | Claude Code · Sonnet | Games fail on feel: QA has to play the preview in the Test lab browser and watch the frame rate. |
| [Static site](static-site.md) | Claude Code · Sonnet | Claude Code · Sonnet | A static site is all looks and links: a preview and a browser check catch nearly everything. |
| [CLI or library](cli-library.md) | Claude Code · Opus | Codex | No screen to look at: QA runs the commands and reads the tests. |
| [Mobile app](mobile.md) | Claude Code · Opus | Codex | Phones are the screen: QA checks at phone size, through the web build where there is one. |
| [Design studio](design.md) | Claude Code · Sonnet | Claude Code · Sonnet | Design work runs on an image model: add an image provider first. |
| [Video](video.md) | Claude Code · Sonnet | Claude Code · Sonnet | Video needs a video model and a voice: add both providers first. |
| [Social & marketing](marketing.md) | Claude Code · Sonnet | Codex | Posts need pictures: an image provider makes them. |
| [Ops](ops.md) | Claude Code · Opus | Codex | Ops work touches real servers: a cloud provider key, and QA that only dry-runs. |
| [Research & models](research.md) | Claude Code · Opus | Codex | Research reads a lot: a second text model with a long context helps with the reading. |

## What each coding agent is good at

- **Claude Code:** Plans and builds whole features, runs the tests, drives the Test lab browser. The main builder everywhere. Opus to build, Sonnet for fixes and QA, Haiku for docs.
- **Codex:** A different model family: a sharp second opinion on code. QA on web apps and APIs, so the reviewer is not the builder.
- **Gemini (through OpenCode):** A very long context: reads big docs and data. Research and docs. Never the main builder. Needs a Gemini key in Settings → Providers.
- **OpenCode:** Runs many providers’ models, local ones too. Trying another model on a floor without a new login.

## The company

Settings → Guides → What the company mainly makes. A floor of another kind gets a checklist sheet when it moves in, before its agents start, and the office tells you once about each gap. An agent who isn't signed in takes no work until you sign them in or switch them to the recommended coding agent.
