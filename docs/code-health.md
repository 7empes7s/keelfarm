# Code health

How the repo keeps from getting worse (the ratchet that `npm run lint` runs in CI), what it measured when it was put
in, and a prioritised list of cleanups to take on one PR at a time.

## The ratchet

`npm run lint` (`scripts/codeHealth.mjs`, its rules in `scripts/codeHealthSteps.mjs`) runs three checks and compares
them with `code-health.baseline.json`. It fails only on what the baseline doesn't have, so the old findings don't
block anyone, and nothing new gets in.

| Check | Tool | Fails when |
| --- | --- | --- |
| Lint | oxlint, type-aware (`.oxlintrc.json`) | a file has more findings of a rule than the baseline records for that file and rule |
| Dead code | knip (`knip.jsonc`) | a new unused file, export, type, dependency, devDependency or unlisted import |
| File size | line count of `client/ server/ shared/ scripts/ bin/ e2e/` `.ts .tsx .mts .js .mjs .css` | a file the baseline doesn't list has over 800 lines, or a listed one (they're the files over 800) passes its recorded size + 5% |

- Lint counts per file and rule, not per line, so moving code around inside a file never trips it. When a count
  goes up, the output lists every finding of that rule in that file, since a count can't say which one is new.
- `npm run lint:update` lowers the baseline to what's fixed and never raises it. The check says when there's
  something to lower. `node scripts/codeHealth.mjs --accept` writes the run as it is: for a rename (the findings move
  to a new path) or a deliberate exception, said in the PR.
- The baseline file is sorted and has no timestamps, so the same findings always write the same bytes
  (`scripts/codeHealthSteps.test.ts` checks it). Paths use `/` on every OS.
- The tools are pinned to exact versions in `package.json`: a new oxlint or knip can find new things, so bumping
  them is a PR of its own that runs `--accept`.

### Why oxlint and not ESLint

The issue asked for ESLint with typescript-eslint. This repo builds with TypeScript 7 (the native compiler), and
typescript-eslint 8 needs TypeScript's JavaScript API, which 7 doesn't have (its peer range is `<6.1`). npm won't
install a second TypeScript just for it either: the peer dependency resolves to the root's 7.0. oxlint covers the
same rules and gets type information from `oxlint-tsgolint`, built on the same native compiler this repo uses, so its
types match `tsc`'s. One pass over all 787 files with types takes about 20 s.

The rules the issue named, and how they're set:

| Rule | Level | Where |
| --- | --- | --- |
| `typescript/no-floating-promises`, `typescript/no-misused-promises` | error | everywhere |
| `react-hooks/exhaustive-deps` (and `rules-of-hooks`) | warn (error) | `client/` |
| `no-unused-vars` | error | everywhere (tsc's `noUnusedLocals` already catches most) |
| `eqeqeq` | error, `== null` allowed | everywhere |
| `typescript/no-explicit-any` | warn | everywhere |
| `typescript/consistent-type-imports` | error | everywhere |

Plus oxlint's `correctness` category. Turned off: the React Compiler rules (`react/immutability`, `purity`, `refs`,
…: the office mutates refs and three.js objects in `useFrame` on purpose and doesn't use the compiler), and four
type-aware rules that were mostly noise here (`unbound-method`, `no-misused-spread`, `no-base-to-string`,
`restrict-template-expressions`). The ratchet counts warnings the same as errors.

Formatting is left alone: no formatter runs, nothing was reformatted.

### What this PR removed

Only what was unused and safe: the `concurrently` devDependency (the launcher replaced it). Everything else knip
found is in the baseline and the backlog below.

## The numbers

Measured on `main` at `c0dfef4` plus this PR's tooling, 2026-11-04. Re-run them with:

```bash
npm run lint                                    # lint / knip / size counts against the baseline
node scripts/codeHealth.mjs --accept            # (only to re-measure; git diff shows what moved)
npx --yes jscpd@5.4.2 --min-lines 10 --min-tokens 70 --absolute --reporters json --output .code-health/jscpd \
  --ignore "**/*.test.ts,**/node_modules/**" --silent client/src server shared scripts bin
npx vitest run --coverage --coverage.provider=v8 --coverage.reporter=json-summary --coverage.reportOnFailure=true \
  --coverage.reportsDirectory=.code-health/coverage
npx vitest run --reporter=default --reporter=json --outputFile.json=.code-health/tests.json
node scripts/codeHealthReport.mjs               # prints the tables below from all of the above
```

`.code-health/` is git-ignored. Function sizes and complexity come from `scripts/codeHealthReport.mjs` parsing every
non-test source file with oxc-parser: ESLint's cyclomatic complexity (1 + `if`, `?:`, loops, `catch`, `case`,
default values, `&&` `||` `??`), each function on its own (a nested callback is its own row, which is why a React
component that does its work in hooks shows a complexity of 1). Test timings were taken on a shared machine at a load
average near 30, so read them as relative; four wall-clock tests (`walkways` "well under a frame", `throwSim`,
`indoor`, a `previews` idle timer) failed there for that reason and pass in CI.

### Files

787 source files, 141335 lines (client, server, shared, scripts, bin, e2e; tests included).

| File | Lines |
| --- | ---: |
| `server/swarm.ts` | 5534 |
| `client/src/styles.css` | 5193 |
| `server/demo.ts` | 1645 |
| `client/src/world/toys/dogBrain.ts` | 1257 |
| `server/cliRunner.ts` | 983 |
| `client/src/world/jukeboxSongs.ts` | 916 |
| `client/src/world/draw.ts` | 911 |
| `server/workspace.ts` | 909 |
| `client/src/ui/ManagerConsole.tsx` | 858 |
| `client/src/world/ritualRunner.ts` | 854 |
| `client/src/world/ErrandDirector.tsx` | 851 |
| `client/src/ui/sfx.ts` | 838 |
| `shared/types.ts` | 775 |
| `scripts/office.mjs` | 771 |
| `server/workspace.test.ts` | 757 |

### Largest and most complex functions

12501 functions outside tests; 102 have a complexity over 20, 94 are over 100 lines.

| Function (longest) | Where | Lines | Complexity |
| --- | --- | ---: | ---: |
| `ErrandDirector` | `client/src/world/ErrandDirector.tsx:130` | 722 | 1 |
| `startCliSession` | `server/cliRunner.ts:474` | 510 | 80 |
| `Character` | `client/src/world/Character.tsx:220` | 484 | 8 |
| `Player` | `client/src/world/Player.tsx:222` | 399 | 1 |
| `(anonymous)` | `client/src/store.ts:207` | 391 | 2 |
| `PhotoScene` | `client/src/photo/PhotoScene.tsx:88` | 381 | 1 |
| `Balls` | `client/src/world/toys/ToyWorld.tsx:217` | 335 | 1 |
| `TerminalView` | `client/src/ui/TerminalView.tsx:25` | 314 | 69 |
| `Pet` | `client/src/ui/games/PetGame.tsx:425` | 311 | 17 |
| `createDemoBackend` | `server/demo.ts:614` | 294 | 4 |
| `sampleDay` | `server/journalSample.ts:75` | 279 | 51 |
| `apply` | `client/src/store.ts:280` | 272 | 125 |
| `(anonymous)` | `client/src/world/Character.tsx:327` | 271 | 123 |
| `KanbanView` | `client/src/ui/KanbanView.tsx:84` | 270 | 7 |
| `DogBody` | `client/src/world/toys/Dog.tsx:304` | 268 | 1 |

| Function (most complex) | Where | Lines | Complexity |
| --- | --- | ---: | ---: |
| `apply` | `client/src/store.ts:280` | 272 | 125 |
| `(anonymous)` | `client/src/world/Character.tsx:327` | 271 | 123 |
| `(anonymous)` | `client/src/world/ErrandDirector.tsx:642` | 207 | 117 |
| `(anonymous)` | `client/src/world/Player.tsx:459` | 159 | 83 |
| `startCliSession` | `server/cliRunner.ts:474` | 510 | 80 |
| `HUD` | `client/src/ui/HUD.tsx:123` | 127 | 79 |
| `act` | `client/src/world/toys/dogBrain.ts:888` | 183 | 77 |
| `TerminalView` | `client/src/ui/TerminalView.tsx:25` | 314 | 69 |
| `hook` | `server/cliRunner.ts:642` | 112 | 69 |
| `tick` | `client/src/world/toyErrands.ts:268` | 108 | 67 |
| `init` | `server/swarm.ts:681` | 237 | 66 |
| `handle` | `server/agentRunner.ts:389` | 108 | 64 |
| `stepRoomba` | `client/src/world/toys/roombaBrain.ts:401` | 195 | 60 |
| `(anonymous)` | `client/src/world/roof/RoofPeople.tsx:176` | 133 | 56 |
| `apply` | `server/ledger.ts:162` | 123 | 56 |

### Lint and knip by area

| Area | Lint | Top rules | Unused exports | Unused types | Other knip |
| --- | ---: | --- | ---: | ---: | ---: |
| `client/src/world` | 65 | typescript(consistent-type-imports) 19, unicorn(no-new-array) 10, eslint(no-unused-expressions) 9 | 106 | 25 | 0 |
| `server` | 34 | typescript(no-floating-promises) 10, eslint(no-control-regex) 7, unicorn(no-useless-spread) 4 | 53 | 17 | 0 |
| `client/src/ui` | 35 | typescript(no-misused-promises) 18, eslint(no-unused-expressions) 10, typescript(no-meaningless-void-operator) 3 | 47 | 10 | 0 |
| `shared` | 2 | eslint(no-misleading-character-class) 2 | 22 | 6 | 0 |
| `client/src` | 3 | unicorn(no-new-array) 3 | 10 | 2 | 0 |
| `client/src/photo` | 2 | typescript(consistent-type-imports) 2 | 5 | 0 | 0 |
| `e2e` | 2 | typescript(consistent-type-imports) 2 | 1 | 0 | 0 |
| `scripts` | 2 | eslint(no-unused-expressions) 2 | 0 | 0 | 0 |
| `client/src/pocket` | 0 |  | 1 | 0 | 0 |

| Rule | Findings |
| --- | ---: |
| typescript(consistent-type-imports) | 24 |
| eslint(no-unused-expressions) | 21 |
| typescript(no-misused-promises) | 20 |
| unicorn(no-new-array) | 14 |
| unicorn(no-useless-spread) | 13 |
| typescript(no-floating-promises) | 12 |
| react-hooks(exhaustive-deps) | 8 |
| eslint(no-control-regex) | 7 |
| typescript(no-meaningless-void-operator) | 6 |
| typescript(require-array-sort-compare) | 5 |
| typescript(no-implied-eval) | 4 |
| unicorn(prefer-string-starts-ends-with) | 3 |
| eslint(no-misleading-character-class) | 2 |
| unicorn(no-thenable) | 2 |
| typescript(await-thenable) | 1 |
| typescript(no-redundant-type-constituents) | 1 |
| typescript(no-this-alias) | 1 |
| unicorn(no-useless-fallback-in-spread) | 1 |

### Duplicated blocks (jscpd)

11 clones, 176 duplicated lines of 112650 (0.16%).

| Lines | First | Second |
| ---: | --- | --- |
| 28 | `client/src/ui/outsideSfx.ts:407` | `client/src/ui/weatherSfx.ts:253` |
| 20 | `client/src/world/Rituals.tsx:98` | `client/src/world/presence/Visitors.tsx:40` |
| 19 | `client/src/world/Candidates.tsx:52` | `client/src/world/Rituals.tsx:101` |
| 17 | `client/src/world/events/director.ts:171` | `client/src/world/sky/skyLayout.ts:30` |
| 16 | `client/src/ui/outsideSfx.ts:309` | `client/src/ui/weatherSfx.ts:189` |
| 15 | `client/src/world/coffeeBreak.ts:196` | `client/src/world/snackBreak.ts:122` |
| 14 | `client/src/world/coffeeBreak.ts:224` | `client/src/world/snackBreak.ts:166` |
| 13 | `client/src/world/weather/weatherRules.ts:134` | `server/journalSample.ts:6` |
| 12 | `client/src/ui/CloudSettings.tsx:95` | `client/src/ui/VoiceSettings.tsx:116` |
| 11 | `client/src/ui/cheerRules.ts:45` | `client/src/ui/keyboards.ts:66` |
| 11 | `server/previewGateway.ts:147` | `server/syncProxy.ts:123` |

### Test coverage by area (lines)

All files the tests load: 74.9% of lines, 67.6% of branches. Files no test imports don't appear (vitest's default).

| Area | Files loaded | Lines | Covered |
| --- | ---: | ---: | --- |
| `server` | 66 | 8786 | 66.7% |
| `client/src/world` | 99 | 8206 | 82.4% |
| `client/src/ui` | 38 | 1794 | 69.8% |
| `shared` | 22 | 880 | 99.0% |
| `client/src` | 13 | 711 | 56.5% |
| `client/src/photo` | 4 | 269 | 99.3% |
| `scripts` | 4 | 205 | 97.6% |
| `client/src/pocket` | 2 | 39 | 79.5% |

### Slowest tests

2508 tests in 225 files.

| Test file | ms |
| --- | ---: |
| `server/scale.test.ts` | 45953 |
| `server/workspace.test.ts` | 34145 |
| `client/src/world/toys/dogBrain.test.ts` | 10759 |
| `client/src/world/toys/throwSim.test.ts` | 9741 |
| `client/src/world/sky/indoor.test.ts` | 6975 |
| `server/ptyHost.test.ts` | 3703 |
| `client/src/world/events/director.test.ts` | 3043 |
| `client/src/world/appearance.test.ts` | 2546 |
| `server/boxHelpers.test.ts` | 2341 |
| `client/src/world/walkways.test.ts` | 2332 |

| Test | File | ms |
| --- | --- | ---: |
| a big company fits the snapshot and websocket budgets | `server/scale.test.ts` | 45953 |
| the dog gets about on the office floor it stays inside, never in furniture, and never idles by the elevator doors | `client/src/world/toys/dogBrain.test.ts` | 6641 |
| indoorLight changes smoothly, and the sun hands over to the moon only while the key is dark | `client/src/world/sky/indoor.test.ts` | 6428 |
| basketball throws (Rapier) scores from 3 to 5 m, straight on and at 30°, with a charge window of at least 150 ms | `client/src/world/toys/throwSim.test.ts` | 5370 |
| the terminal keeper keeps a CLI running through an office restart, with its output and the hook it sent meanwhile | `server/ptyHost.test.ts` | 3703 |
| the dog gets about on the lobby floor it stays inside, never in furniture, and never idles by the elevator doors | `client/src/world/toys/dogBrain.test.ts` | 3162 |
| prepareDesk lets other desks fix a PR whose branch the author's desk has checked out, and leaves the author's desk alone (#199) | `server/workspace.test.ts` | 2920 |
| basketball throws (Rapier) used to fall short of the rim when aimed at the painted square, however long it was charged | `client/src/world/toys/throwSim.test.ts` | 2033 |
| syncMain names a changed file in a subfolder with forward slashes | `server/workspace.test.ts` | 1995 |
| sweepDesks removes old desks, stray folders and finished branches, keeps what is in use, and saves unpushed work first | `server/workspace.test.ts` | 1915 |


## Cleanup backlog

In priority order: real-bug risk first, then what makes the big files smaller, then tidying. Each item is one PR
that changes no behaviour, lowers the baseline with `npm run lint:update` where it fixes findings, and names the test
that has to stay green.

1. **Handle the server's floating promises.**
   What: `server/swarm.ts:825, 2056, 2253, 2560, 2623` (`terminal.releaseIdle?.()`), `server/cliRunner.ts:245, 483,
   569` (`endLive(...)`), `server/agentRunner.ts:498` (an async IIFE). Add `.catch()` that logs (or `void` where the
   promise can't reject, with the reason).
   Why: a rejection nobody handles ends the Node process (Node ≥ 15): the office would go down over a CLI that
   wouldn't close.
   Risk: low; only adds handlers. Guard: `server/deskSetup.test.ts` (`releaseIdle`), `server/cliRunner.test.ts`,
   `server/ptyHost.test.ts`, `server/restartRecovery.test.ts`; lint's `no-floating-promises` count for `server/`
   goes to 0.

2. **Await the client's promise-returning handlers.**
   What: 18 `no-misused-promises` in `client/src/ui` (`KanbanView.tsx` ×7, `TerminalView.tsx` ×4,
   `ProjectPicker.tsx` ×3, `SetupWizard.tsx` ×2, `Phone.tsx`, `AppViewer.tsx`) and 2 floating ones
   (`world/Desk.tsx:68`, `world/desk/DeskStory.tsx:279`): wrap as `onClick={() => void doIt()}` and check each
   async handler catches (`api.ts` toasts REST errors, but not everything in them is a REST call).
   Why: a rejected handler is an unhandled rejection in the console, and the button shows no error.
   Risk: low. Guard: no unit test renders these components, so the e2e console-error check (`e2e/helpers.ts`) and a
   demo-office click through the Kanban, the terminal and the project picker.

3. **Fix `Promise.all` over non-promises in `dirSize`.**
   What: `server/workspace.ts:641`, where the map returns `0` for non-files (`await-thenable`): return
   `Promise.resolve(0)` or filter first.
   Why: it works today but reads like a bug, and the type checker can't help there.
   Risk: very low. Guard: `server/workspace.test.ts` (the sizes the desk sweep reports).

4. **Split `client/src/store.ts`'s `apply` (complexity 125, 272 lines).**
   What: one handler per `ServerEvent` type in a `Record<ServerEvent['type'], (s, ev) => Partial<State>>` (in a new
   `storeEvents.ts`), `apply` becomes a lookup.
   Why: the most complex function in the repo, and every new event adds a case to it.
   Risk: medium (central state); the type of the record makes a missed event a compile error. Guard:
   `client/src/store.test.ts` (it covers only a few events: add a test per handler as it moves), the time-lapse
   (seek/play go through `apply`) and `e2e/smoke.spec.ts`.

5. **Take the CEO job queue and the phone messages out of `server/swarm.ts` (5,534 lines).**
   What: move them into `server/ceoJobs.ts` and `server/phone.ts` as classes or functions that `Swarm` holds and
   calls, the way `outbox.ts` and `presence.ts` already are. One area per PR, no API changes.
   Why: `swarm.ts` is 4% of the code base, has no test file of its own and 59% line coverage; every PR touches it, so
   it's where conflicts come from. Smaller files can be tested on their own.
   Risk: medium (moves code, keeps logic); do it in a quiet hour for conflicts. Guard: the tests that build a
   `Swarm` (`server/ceoAsks.test.ts`, `proposals.test.ts`, `stateFile.test.ts`, `voiceKey.test.ts`,
   `scale.test.ts`), `server/ceo.test.ts`; lower `sizes["server/swarm.ts"]` with `lint:update`.

6. **Break up `startCliSession` in `server/cliRunner.ts` (510 lines, complexity 80; `hook` 112 lines, 69).**
   What: pull the hook handling, the CLI spawn/adopt and the turn-end bookkeeping out as named functions in the same
   file, with the pure parts (deciding what a hook event means) in a module that gets tests.
   Why: 4.6% line coverage, the lowest of any big server file: the terminal runtime is the default and nearly
   untested.
   Risk: medium. Guard: `server/cliRunner.test.ts`, `server/ptyHost.test.ts`, a demo-office run in the terminal runtime.

7. **Split `server/demo.ts` (1,645 lines) by what it fakes.**
   What: `demo/github.ts` (fake issues/PRs), `demo/sessions.ts` (fake agent sessions and their terminal output),
   `demo/machines.ts`; `createDemoBackend` composes them.
   Why: every new `Backend` method lands here (demo parity), so it only grows; it's the second-largest file.
   Risk: low (demo only). Guard: `server/demo.test.ts`, `server/demoVisitors.test.ts`, `server/scale.test.ts`, `scripts/smoke-package.mjs` (boots
   the demo).

8. **Un-export what's only used inside its own file.**
   What: knip's 245 unused exports and 60 unused types, in batches by area (`client/src/world` 106 + 25, `server`
   53 + 17, `client/src/ui` 47 + 10, `shared` 22 + 6). Mostly constants and types exported "just in case", e.g.
   the seven tunables in `server/voice.ts`. Remove the `export` (or the code, when nothing uses it at all).
   Why: an export is a promise that someone uses it; these make the files harder to change and hide dead code.
   Risk: low; typecheck catches a wrong one. Guard: `npm run typecheck`, `npm test`; knip's count goes down.

9. **Share the ambient-sound and break-errand code that's copied.**
   What: jscpd's biggest clones: `client/src/ui/outsideSfx.ts:309/407` ↔ `weatherSfx.ts:189/253` (44 lines),
   `client/src/world/coffeeBreak.ts:196/224` ↔ `snackBreak.ts:122/166` (29 lines, also the two `no-thenable` findings),
   `Rituals.tsx` ↔ `presence/Visitors.tsx` ↔ `Candidates.tsx` (39 lines). One shared helper per pair.
   Why: a fix to one copy misses the other.
   Risk: low to medium (sound and animation timing). Guard: `coffeeBreak.test.ts`, `snackBreak.test.ts`,
   `client/src/ui/outsideMix.test.ts`, `weatherMix.test.ts`, `e2e/coffee.spec.ts` and `e2e/sounds.spec.ts` locally.

10. **Mechanical lint fixes in one sweep.**
    What: `consistent-type-imports` (24, autofixable with `npx oxlint --type-aware --fix`), `no-useless-spread` (13),
    `no-new-array` (14), `prefer-string-starts-ends-with` (3), `no-useless-fallback-in-spread`, `no-this-alias`.
    Why: about 55 of the 145 findings, none needing thought; `import type` says at a glance what's only a type.
    Risk: very low. Guard: `typecheck`, `test`, `build`. Expect a conflict-prone diff across ~40 files: land it on
    its own.

11. **Review the 8 `exhaustive-deps` warnings.**
    What: `client/src/world/Character.tsx:248, 312`, `StickyNotes.tsx:535` (×2), `Jukebox.tsx:315`,
    `KitchenFridge.tsx:121`, `ErrandDirector.tsx:225`, `toys/ToyWorld.tsx:483`. Add the dependency, or keep it out
    with a `// oxlint-disable-next-line` that says why (refs and stable store selectors usually).
    Why: a stale closure in a per-frame hook is a bug that's hard to see.
    Risk: low to medium (re-running an effect can restart an animation). Guard: the e2e specs for those objects
    (`people`, `toys`, `dog`), a look in the demo office.

12. **Speed up the two slowest test files.**
    What: `server/scale.test.ts` (one test, ~46 s under load) and `server/workspace.test.ts` (~34 s: real git repos per
    test). Share one big-company world across scale's assertions, and one bare repo fixture across workspace tests
    that only read.
    Why: together most of `npm test`'s wall time, on every PR and in every agent's loop.
    Risk: low (tests only); keep each test's isolation where it writes. Guard: the tests themselves, plus their
    budgets in `server/scale.test.ts`.

13. **Split `client/src/styles.css` (5,193 lines).**
    What: one CSS file per panel next to its component (`Kanban.css`, `Phone.css`, …), imported by it; tokens and
    resets stay in `styles.css`.
    Why: the second-largest file, edited by most UI PRs.
    Risk: medium (cascade order can change which rule wins): move whole blocks, keep their order, compare screenshots.
    Guard: `e2e/smoke.spec.ts` and a before/after screenshot of each panel in the demo office.

14. **One ANSI-stripping helper.**
    What: three copies of "strip CSI escapes" (`server/previewRunner.ts:216`, `server/demo.ts:512` and `:1622`, two
    of them identical) become one `stripAnsi()` in a small shared module with a test and the one disable comment for
    `no-control-regex`. The other control-character regexes (`notifier.ts:87`, `cliRunner.ts:774`, two tests) are
    deliberate: give each a disable comment that says what it strips.
    Why: copies of the same regex drift (the preview one already misses `~` and two-byte escapes).
    Risk: low. Guard: `server/demo.test.ts`, `server/previews.test.ts`, a new `stripAnsi` test.
