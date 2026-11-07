import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Backend } from './backend.ts';
import type { PreviewBackend } from './previewRunner.ts';
import { describeOfficeTool, type LogEntry, type SessionCallbacks, type SessionHandle, type SessionOptions } from './agentRunner.ts';
import { CLIS } from './clis.ts';
import { mergeCatalog } from '../shared/models.ts';
import { DEMO_PICKS, demoMakeFiles, sentFiles, wantsFile } from './demoFiles.ts';
import { buildInventory, memoryFs } from './tooling.ts';
import { toolArgsLine, type ToolInventory } from '../shared/tooling.ts';
import { charTokens } from '../shared/startup.ts';
import { FLOOR_SEATS, type GhRepoSummary, type IssueInfo, type PullInfo, type UsageReading } from '../shared/types.ts';
import { parseForwarded } from '../shared/chat.ts';
import { TRUST_LABEL } from '../shared/trust.ts';
import { keyName } from '../shared/termKeys.ts';
import type { LocalFolder } from './workspace.ts';
import { HOME_DIR, type DemoScale } from './config.ts';
import { takeLastUpdate, underLauncher, type LastUpdate, type OfficeHost } from './officeUpdate.ts';
import type { UsageWarning } from './pacing.ts';
import { VoiceApiError, type VoiceApi } from './voice.ts';
import type { WeatherApi } from './weather.ts';
import type { NotifyTransport } from './notifier.ts';
import { demoTelegram } from './demoTelegram.ts';
import { CloudError, type BoxApi, type BoxInfo } from './box.ts';
import type { CloudBackend } from './backend.ts';
import type { BoxSignIn } from './cliRunner.ts';
import type { AgentTerminal } from './terminal.ts';
import { demoSurvival, sampleLab } from './experimentSample.ts';
import { sampleNotices } from './noticeSample.ts';
import { BLOCKED_DEMO, demoAsked, demoAsks, demoCeoAnswer, demoPrompts } from './demoPrompts.ts';
import { sampleOffice } from './costSample.ts';
import { sampleLog } from './charterSample.ts';
import { demoTranscript } from './historySample.ts';
import { demoPastWeek } from './opsSample.ts';
import { sampleCareers, sampleHistory, samplePastCareers } from './careerSample.ts';
import { demoPrFiles, demoPrSummary, demoQaPage, pastPulls } from './demoMap.ts';
import { demoPreviewDesks, stalePulls } from './demoPreviewDesks.ts';
import { demoKill, demoPortOwner, demoProc, holdDemoPort } from './demoLeftover.ts';
import { demoMerged, demoPractices, demoPrDiff, demoReadWorktree, demoRefsLine, demoRepoFile } from './demoReads.ts';
import { demoAwake, demoConsultSession } from './demoAwake.ts';
import { demoDesign } from './demoDesign.ts';
import { demoResolve } from './demoDecisions.ts';
import { researchBrief } from './demoResearch.ts';
import { demoEditedChat, logStreamed, writeReply } from './demoChat.ts';
import { demoThreads } from './demoThreads.ts';
import { demoReactions } from './demoReactions.ts';
import { sampleChat } from './chatSample.ts';
import { demoCharter, demoDraft } from './demoCharters.ts';
import { DEMO_QA_ISSUE, demoQaReport } from './demoQa.ts';
import { demoLabRunner, withLab } from './demoTestLab.ts';
import { withDemoChat } from './demoAgentChat.ts';
import { demoAccounts } from './demoAccounts.ts';

// `npm run demo`: a fake GitHub and fake Claude Code sessions, so the office (including the
// build → QA → fix loop) can be explored without spending any usage or touching real repos.

interface FakeRepo {
  fullName: string;
  description: string;
  issues: IssueInfo[];
  pulls: PullInfo[];
  nextNumber: number;
}

const now = () => new Date().toISOString();

function issue(n: number, title: string, body: string, fullName: string, labels: string[] = []): IssueInfo {
  return { number: n, title, body, url: `https://github.com/${fullName}/issues/${n}`, labels, createdAt: now() };
}

const repos = new Map<string, FakeRepo>();
/** Repos made in the demo (new projects, published folders): empty, so no package.json for the preview to fall back on. */
const bareRepos = new Set<string>();
const mergedSinceSync = new Map<string, number>(); // merges the fake project folder hasn't pulled yet
const closedIssues = new Set<string>(); // `${fullName}#${n}`: issues closed by a merge
const stalls = new Map<string, () => void>(); // agent id -> silences their running fake session (the office doctor's demo)
const signOuts = new Map<string, { boxId: string; end: () => void }>(); // agent id -> ends their cloud session as an expired sign-in would

const fakeSha = () => crypto.randomBytes(20).toString('hex');

// GitHub never gives two PRs the same number, and the office's ledger (coins, careers) counts each PR once by it, so
// the fake's numbers carry on across restarts (the issues and PRs themselves start over).
const NUMBERS_FILE = path.join(HOME_DIR, 'demo-github.json');

function restoreNumbers() {
  try {
    const saved = JSON.parse(fs.readFileSync(NUMBERS_FILE, 'utf8')) as Record<string, number>;
    for (const r of repos.values()) if (Number.isInteger(saved[r.fullName])) r.nextNumber = Math.max(r.nextNumber, saved[r.fullName]);
  } catch {
    // first run
  }
}

/** The repo's next issue or PR number, remembered for the next start. */
function takeNumber(r: FakeRepo) {
  const n = r.nextNumber++;
  try {
    fs.mkdirSync(HOME_DIR, { recursive: true });
    fs.writeFileSync(`${NUMBERS_FILE}.tmp`, JSON.stringify(Object.fromEntries([...repos.values()].map((x) => [x.fullName, x.nextNumber]))));
    fs.renameSync(`${NUMBERS_FILE}.tmp`, NUMBERS_FILE);
  } catch (err) {
    console.warn('could not save the demo PR numbers', err);
  }
  return n;
}

/**
 * An issue or PR number the fake GitHub handed out before the office restarted: it starts over on every start (only
 * its numbers carry on), so what it forgot was closed while the office was down, as far as the office can tell.
 */
function forgotten(fullName: string, n: number) {
  const r = repos.get(fullName);
  return !!r && n > 0 && n < r.nextNumber && !r.issues.some((i) => i.number === n) && !r.pulls.some((p) => p.number === n);
}

let runSeq = 1000; // fake Actions run ids, so the office can re-run a failed one
/**
 * Fake CI: checks run for a while after every push, and now and then one fails so the fix loop shows. They say they
 * took a few minutes, like real CI, though the demo doesn't make you wait that long.
 */
function runChecks(pr: PullInfo, fail = Math.random() < 0.2) {
  Object.assign(pr, { checks: 'pending', pendingChecks: ['CI / build', 'Vercel'], failedChecks: [], checkRun: null });
  if (ciDown(pr.url)) return void setTimeout(() => Object.assign(pr, refusedChecks(pr.url)), 3_000);
  setTimeout(() => {
    Object.assign(pr, {
      checks: fail ? 'failing' : 'passing',
      pendingChecks: [],
      failedChecks: fail ? [{ name: 'CI / build', url: `${pr.url.replace(/\/pull\/\d+$/, '')}/actions/runs/${++runSeq}/job/1` }] : [],
      checkRun: { ms: Math.round((2.5 + Math.random() * 5) * 60_000), doneAt: Date.now() },
    });
  }, 12_000 + Math.random() * 10_000);
}

// A CI outage (#191): GitHub refuses to start recipe-box's checks for the demo's first 20 minutes, with a QA-passed
// PR parked at the start, so the floor's banner shows and then clears as its PRs merge by themselves.
const CI_DOWN_REPO = 'demo-co/recipe-box';
const CI_DOWN_UNTIL = Date.now() + 20 * 60_000;
const CI_DOWN_NOTE = "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings.";
const ciDown = (url: string) => url.includes(`/${CI_DOWN_REPO}/`) && Date.now() < CI_DOWN_UNTIL;
const refusedChecks = (url: string): Partial<PullInfo> => ({
  checks: 'failing',
  pendingChecks: [],
  failedChecks: [{ name: 'CI / build', url: `${url.replace(/\/pull\/\d+$/, '')}/actions/runs/${++runSeq}/job/1`, neverStarted: true }],
  checkRun: { ms: 1_000, doneAt: Date.now() },
});

function seed(fullName: string, description: string, titles: [string, string][], shipped: string[] = [], past = false) {
  const r: FakeRepo = { fullName, description, issues: [], pulls: [], nextNumber: 1 };
  for (const [title, body] of titles) r.issues.push(issue(r.nextNumber++, title, body, fullName));
  if (past) r.pulls.push(...pastPulls(fullName, () => r.nextNumber++)); // the memory map's history (#136)
  // What the floor shipped lately: the "What's new" cards' history (#129).
  for (const [i, title] of shipped.entries()) r.pulls.push(shippedPull(fullName, r.nextNumber++, title, (i + 1) * 5 * 3_600_000));
  repos.set(fullName, r);
}

function shippedPull(fullName: string, number: number, title: string, agoMs: number): PullInfo {
  return {
    number,
    title,
    url: `https://github.com/${fullName}/pull/${number}`,
    headRefName: `swarm/shipped-${number}`,
    state: 'MERGED',
    isDraft: false,
    mergeable: 'MERGEABLE',
    reviewDecision: null,
    closesIssues: [],
    createdAt: new Date(Date.now() - agoMs - 3_600_000).toISOString(),
    mergedAt: new Date(Date.now() - agoMs).toISOString(),
    additions: 40,
    deletions: 8,
    checks: 'passing',
    headSha: fakeSha(),
    mergeState: 'CLEAN',
    failedChecks: [],
    pendingChecks: [],
  };
}

// The demo's long issue (#206): sections, a checklist and code, for the card view; its PR fails QA's first round.
const DARK_MODE_TITLE = 'Add dark mode toggle';
const DARK_MODE_BODY = [
  'Users want a dark theme. Persist the choice in localStorage. Touches src/App.tsx and src/styles.css.',
  '',
  'Objective: O1',
  '',
  '## Why',
  'Half the feedback this month asks for a dark theme: people plan their day late at night and the white page glares.',
  'Three users said they stopped using the app in the evening because of it.',
  '',
  '## Build',
  '1. A toggle in the header (sun / moon), 44 px, with a label for screen readers.',
  '2. Colours move to CSS custom properties on `:root`, with a `[data-theme="dark"]` set beside them:',
  '```css',
  ':root[data-theme="dark"] {',
  '  --bg: #16151d;',
  '  --text: #f2f0ea;',
  '}',
  '```',
  '3. The choice is saved in `localStorage` and read before the first paint, so the page never flashes white.',
  "4. With nothing saved, follow the device's `prefers-color-scheme`.",
  '',
  '## Acceptance',
  '- The toggle switches every screen between light and dark',
  '- The choice survives a reload',
  '- No white flash on load in dark mode',
  '- Contrast passes WCAG AA in both themes',
  '- Unit tests cover reading and saving the choice',
].join('\n');

seed('demo-co/pixel-todo', 'A cheerful todo app', [
  ['Add dark mode toggle', DARK_MODE_BODY],
  ['Todos should support due dates', 'Add an optional due date and highlight overdue items in src/App.tsx.\n\nObjective: O2'],
  ['Drag and drop to reorder', 'Let users reorder todos by dragging.\n\nObjective: O2'],
  ['Empty state illustration', 'Show a friendly illustration when the list is empty.'],
  ['Keyboard shortcuts', 'N for new todo, / to search, ? for help.\n\nObjective: O1'],
  ['Fix: completed count off by one', 'The footer shows one more completed item than there is.\n\nObjective: O3'],
], ['Confetti when the list is cleared', 'Undo for deleted todos'], true);
strangers('demo-co/pixel-todo');
repos.get('demo-co/pixel-todo')!.pulls.push(...stalePulls(['Try a darker theme', 'Experiment: drag to reorder', 'Spike: offline mode'], (title) => shippedPull('demo-co/pixel-todo', repos.get('demo-co/pixel-todo')!.nextNumber++, title, 0)));
seed('demo-co/weather-api', 'Tiny weather REST API', [
  ['Add /forecast endpoint', 'Return a 5-day forecast for a city.\n\nObjective: O1'],
  ['Rate limit anonymous callers', '60 requests per minute per IP.\n\nObjective: O3'],
  ['OpenAPI spec', 'Publish an OpenAPI 3.1 document at /openapi.json.\n\nObjective: O2'],
], ['Cache city lookups for an hour', 'Health check at /healthz'], true);
seed('demo-co/recipe-box', 'Recipes with a shopping list', [
  ['Shopping list from a recipe', 'Add every ingredient of a recipe to the shopping list in src/list.ts.\n\nObjective: O1'],
  ['Scale servings', 'Halve or double a recipe and its amounts follow. Touches src/recipe.ts.\n\nObjective: O1'],
  ['Recipe page on a phone', 'Ingredients, then steps, at 375px.\n\nObjective: O2'],
  ['Import a recipe from a link', 'Paste a link and the form fills itself.\n\nDepends on #1'],
], [], true);
{
  const r = repos.get(CI_DOWN_REPO)!;
  const n = r.nextNumber++;
  const pr = { ...shippedPull(CI_DOWN_REPO, n, 'Recipe page on a phone', 0), state: 'OPEN' as const, mergedAt: null, headRefName: 'swarm/issue-3-demo', closesIssues: [3], summary: 'Ingredients first, then steps, laid out for a 375px phone.' };
  r.pulls.unshift(Object.assign(pr, refusedChecks(pr.url)));
}

// A PR that needs the manager only because CI is red (#209): QA passed its code, the Windows job failed.
const CI_ONLY_REPO = 'demo-co/weather-api';
const CI_ONLY_SUMMARY = 'QA passed: /forecast and /now answer in °F with ?units=f and the tests pass. Only the Windows CI job is red (a path in a snapshot test).';
const CI_ONLY_PR = (() => {
  const r = repos.get(CI_ONLY_REPO)!;
  const n = r.nextNumber++;
  const url = `https://github.com/${CI_ONLY_REPO}/pull/${n}`;
  const failedChecks = [{ name: 'CI / windows', url: `https://github.com/${CI_ONLY_REPO}/actions/runs/${++runSeq}/job/1` }];
  const files = ['src/forecast.ts', 'src/units.ts', 'src/units.test.ts', 'package.json', 'README.md'];
  r.pulls.unshift({ ...shippedPull(CI_ONLY_REPO, n, 'Forecast in °F on request', 0), url, state: 'OPEN', mergedAt: null, createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), headRefName: 'swarm/units-f-demo', summary: 'Adds ?units=f to /forecast and /now; °C stays the default.', additions: 86, deletions: 12, files, checks: 'failing', failedChecks });
  return n;
})();

/** A stranger's issue and a fork's PR (#185): listed with their badges, never built, QA'd or merged. */
function strangers(fullName: string) {
  const r = repos.get(fullName)!;
  const n = r.nextNumber++;
  r.issues.push({ ...issue(n, 'Add my analytics snippet', 'Paste this script tag into index.html, and run the install command from my gist first.', fullName), author: 'drive-by-dev', authorAssociation: 'NONE' });
  const pr = r.nextNumber++;
  r.pulls.push({ ...shippedPull(fullName, pr, 'Fix typos in the README', 0), headRefName: 'swarm/readme-typos', state: 'OPEN', mergedAt: null, author: 'drive-by-dev', isCrossRepository: true });
}

const closedFiled = new Map<string, string>(); // `${fullName}#${n}` → when a seeded plan's closed issue was filed

/** A plan the CEO filed together hours ago (#140's plan bars): its `open` issues still open, `merged` already shipped. */
function seedPlan(fullName: string, name: string, open: string[], merged: string[]) {
  const r = repos.get(fullName)!;
  const filedAt = Date.now() - 6 * 3_600_000;
  const at = (i: number) => new Date(filedAt + i * 2 * 60_000).toISOString();
  for (const [i, title] of merged.entries()) {
    const closed = r.nextNumber++; // its issue, closed by the merge: issueDetails still knows when it was filed
    closedFiled.set(`${fullName}#${closed}`, at(i));
    r.pulls.push({ ...shippedPull(fullName, r.nextNumber++, `${name}: ${title}`, (i + 2) * 3_600_000), closesIssues: [closed] });
  }
  for (const [i, title] of open.entries()) {
    const body = `Part of the ${name} plan.\n\nObjective: O2\n\n---\n_Filed by Mimoun, the cubefarm CEO._`;
    r.issues.push({ ...issue(r.nextNumber++, `${name}: ${title}`, body, fullName), createdAt: at(merged.length + i) });
  }
}
seedPlan('demo-co/weather-api', 'API polish', ['Units in every response', 'ETag on /forecast'], ['Consistent error bodies']);

// ---------- the big company (--floors / --agents, #228) ----------

const PRODUCTS: [string, string][] = [
  ['pixel-todo', 'A cheerful todo app'],
  ['weather-api', 'Tiny weather REST API'],
  ['recipe-box', 'Recipes with a shopping list'],
  ['budget-buddy', 'Personal budgets and bills'],
  ['chat-lite', 'A small team chat'],
  ['photo-wall', 'Shared photo albums'],
  ['fit-log', 'Workouts and streaks'],
  ['book-club', 'Reading lists for friends'],
  ['trip-planner', 'Itineraries and packing lists'],
  ['beat-maker', 'A browser drum machine'],
  ['garden-diary', 'What to plant and when'],
  ['habit-hero', 'Daily habits, gently tracked'],
  ['invoice-flow', 'Invoices for freelancers'],
  ['pet-pals', 'Vet visits and walks'],
  ['study-cards', 'Flashcards with spaced repetition'],
  ['parking-spot', 'Find and share parking'],
  ['meal-prep', 'Weekly meal plans'],
  ['job-board', 'A tiny job board'],
  ['event-hub', 'Meetups and RSVPs'],
  ['link-short', 'A link shortener with stats'],
];

const FEATURES = [
  'Add dark mode', 'Search with filters', 'Export to CSV', 'Keyboard shortcuts', 'Offline support', 'Undo and redo',
  'Email reminders', 'Drag and drop to reorder', 'Share links', 'Profile pictures', 'Paginate long lists', 'Rate limiting',
  'An audit log', 'Two-factor login', 'Bulk edit', 'Tags and colours', 'An activity feed', 'Translations',
  'Accessibility pass', 'Friendly empty states', 'Loading skeletons', 'Fix the flaky date test', 'Speed up the build',
  'Clearer error messages',
];

/** The big company's floors: `floors` products, each with a long backlog (topped up as it shrinks, see listIssues). */
function seedBigCompany(floors: number) {
  repos.clear();
  for (let f = 0; f < floors; f++) {
    const [name, description] = PRODUCTS[f] ?? [`project-${f + 1}`, `Project number ${f + 1}`];
    seed(`demo-co/${name}`, description, []);
    topUp(repos.get(`demo-co/${name}`)!, 30);
  }
}

/** Files new issues until the repo has `open` of them, so a big floor's agents always have something to pick up. */
function topUp(r: FakeRepo, open: number) {
  while (r.issues.length < open) {
    const n = r.nextNumber++;
    const feature = FEATURES[n % FEATURES.length];
    const title = n > FEATURES.length ? `${feature} (part ${Math.ceil(n / FEATURES.length)})` : feature;
    r.issues.push(issue(n, title, `Users of ${r.fullName.split('/')[1]} asked for this: ${feature.toLowerCase()}.`, r.fullName));
  }
}

/** How many agents each demo floor starts with: six on floor 1 and four on the others, or a big company's `agents`. */
export function demoTeam(scale: DemoScale | null, floor: number): number {
  if (!scale) return floor === 1 ? 6 : 4;
  return Math.max(1, Math.min(FLOOR_SEATS, scale.agents));
}

function screenshotSvg(title: string, url: string, hue: number) {
  const safe = (s: string) => s.replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <rect width="640" height="400" fill="hsl(${hue},60%,97%)"/>
  <rect width="640" height="56" fill="hsl(${hue},70%,55%)"/>
  <text x="24" y="37" font-family="Segoe UI, Arial" font-size="22" font-weight="700" fill="#fff">${safe(title)}</text>
  <text x="620" y="36" text-anchor="end" font-family="Segoe UI, Arial" font-size="13" fill="#fff">${safe(url)}</text>
  ${[0, 1, 2, 3]
    .map(
      (i) => `<rect x="24" y="${84 + i * 70}" width="592" height="56" rx="10" fill="#fff" stroke="hsl(${hue},40%,85%)"/>
  <circle cx="54" cy="${112 + i * 70}" r="11" fill="none" stroke="hsl(${hue},60%,55%)" stroke-width="3"/>
  <rect x="80" y="${104 + i * 70}" width="${180 + ((i * 97) % 220)}" height="14" rx="7" fill="hsl(${hue},25%,80%)"/>`,
    )
    .join('\n')}
</svg>`;
}

type Step = LogEntry[] | (() => void);

function issueScript(opts: SessionOptions, cb: SessionCallbacks, issueNumber: number, issueTitle: string): Step[] {
  const branch = path.basename(opts.cwd);
  const hue = (issueNumber * 67) % 360;
  const file = ['src/App.tsx', 'src/components/TodoList.tsx', 'src/api/routes.ts', 'src/styles.css'][issueNumber % 4];
  const port = 5200 + (issueNumber % 50);
  return [
    [{ kind: 'text', text: `● I'll start by getting familiar with the codebase for "${issueTitle}".` }],
    [{ kind: 'tool', tool: 'Glob', text: '⏺ Glob src/**/*.{ts,tsx}' }, { kind: 'result', text: '  ⎿ Found 23 files' }],
    [{ kind: 'tool', tool: 'Read', text: `⏺ Read ${file}` }, { kind: 'result', text: '  ⎿ Read 184 lines' }],
    [{ kind: 'thinking', text: '✻ Thinking…' }],
    [
      { kind: 'tool', tool: 'TodoWrite', text: '⏺ Update todo list' },
      { kind: 'result', text: '  ◐ Understand current behaviour' },
      { kind: 'result', text: '  ☐ Implement the change' },
      { kind: 'result', text: '  ☐ Add tests' },
      { kind: 'result', text: '  ☐ Verify in the browser' },
    ],
    [{ kind: 'tool', tool: 'Grep', text: '⏺ Grep "useTodos"' }, { kind: 'result', text: '  ⎿ Found 6 matches in 4 files' }],
    [{ kind: 'text', text: "● The state lives in a single hook. I'll extend it and keep the API backwards compatible." }],
    [{ kind: 'tool', tool: 'Edit', text: `⏺ Edit ${file}` }, { kind: 'result', text: '  ⎿ Updated' }],
    ...(issueNumber % 3 === 0 ? [demoPrompts(opts.cwd)] : []), // now and then, the prompts the office answers for them
    // and, rarer, one it couldn't: blocked for a moment (the desk's ⛔ sign), until the manager answers it
    ...(issueNumber % 5 === 0 ? [() => cb.blocked?.(BLOCKED_DEMO), [{ kind: 'error' as const, text: `⛔ Blocked: ${BLOCKED_DEMO}. Open the terminal to answer it.` }], () => cb.blocked?.(null)] : []),
    [{ kind: 'tool', tool: 'Write', text: '⏺ Write src/__tests__/feature.test.ts' }, { kind: 'result', text: '  ⎿ Saved' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm test -- --run' }],
    [
      { kind: 'result', text: '  ⎿ ✓ src/__tests__/feature.test.ts (4 tests) 38ms' },
      { kind: 'result', text: '    Test Files  7 passed (7)' },
    ],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run typecheck' }, { kind: 'result', text: '  ⎿ (no output)' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ npm run dev -- --port ${port} &` }, { kind: 'result', text: '  ⎿ VITE ready in 412 ms' }],
    // Odd issues screenshot a page they never navigated to, so their browser card shows "address unknown" (#230).
    () => issueNumber % 2 || cb.browserUrl(`http://localhost:${port}/`),
    issueNumber % 2
      ? [{ kind: 'tool', tool: 'mcp__playwright__browser_wait_for', text: '⏺ 🌐 wait_for "Ready"' }, { kind: 'result', text: '  ⎿ Waited for Ready' }]
      : [{ kind: 'tool', tool: 'mcp__playwright__browser_navigate', text: `⏺ 🌐 navigate http://localhost:${port}/` }, { kind: 'result', text: `  ⎿ Page URL: http://localhost:${port}/` }],
    () => cb.screenshot(Buffer.from(screenshotSvg(issueTitle, `localhost:${port}`, hue)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Took a screenshot of the current page' }],
    [{ kind: 'text', text: '● Looks right in the browser. A production build, then the PR.' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run build' }, { kind: 'result', text: '  ⎿ ✓ built in 1.62s' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ git commit -am "feat: ${issueTitle.toLowerCase()}"` }, { kind: 'result', text: `  ⎿ [${branch} 3f2a91c] feat: ${issueTitle.toLowerCase()}` }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git push -u origin HEAD' }, { kind: 'result', text: '  ⎿ branch set up to track origin' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ gh pr create --title "${issueTitle}" --body "Closes #${issueNumber}"` }],
  ];
}

function qaScript(cb: SessionCallbacks, pr: number, title: string, round: number, checks: string): Step[] {
  const port = 5600 + (pr % 50);
  const hue = (pr * 41) % 360;
  // With GitHub checks on the PR, QA reads what they cover instead of re-running the suite.
  const verify: Step[] = checks.endsWith(': none')
    ? [
        [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm ci && npm test -- --run' }],
        [
          { kind: 'result', text: '  ⎿ Test Files  8 passed (8)' },
          { kind: 'result', text: '    Tests  41 passed (41)' },
        ],
        [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run lint && npm run build' }, { kind: 'result', text: '  ⎿ ✓ built in 1.84s' }],
      ]
    : [
        [{ kind: 'tool', tool: 'Read', text: '⏺ Read .github/workflows/ci.yml' }, { kind: 'result', text: '  ⎿ Read 41 lines' }],
        [{ kind: 'text', text: '● CI already runs the tests, lint and build, so I only need a build to start the app.' }],
        [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm ci && npm run build' }, { kind: 'result', text: '  ⎿ ✓ built in 1.84s' }],
      ];
  return [
    [{ kind: 'text', text: `● Testing PR #${pr} "${title}" (round ${round}). ${checks}. First, the acceptance criteria from the issue.` }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git diff origin/main...HEAD --stat' }, { kind: 'result', text: '  ⎿  3 files changed, 82 insertions(+), 9 deletions(-)' }],
    ...verify,
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ npm run preview -- --port ${port} &` }, { kind: 'result', text: `  ⎿ Local: http://localhost:${port}/` }],
    () => cb.browserUrl(`http://localhost:${port}/`),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_navigate', text: `⏺ 🌐 navigate http://localhost:${port}/` }, { kind: 'result', text: `  ⎿ Page URL: http://localhost:${port}/` }],
    () => cb.screenshot(Buffer.from(screenshotSvg(`QA · ${title}`, `localhost:${port}`, hue)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Took a screenshot of the current page' }],
    () => cb.browserUrl(`http://localhost:${port}${demoQaPage(pr)}`),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_navigate', text: `⏺ 🌐 navigate http://localhost:${port}${demoQaPage(pr)}` }, { kind: 'result', text: `  ⎿ Page URL: http://localhost:${port}${demoQaPage(pr)}` }],
    [{ kind: 'tool', tool: 'mcp__playwright__browser_resize', text: '⏺ 🌐 resize 375x740' }, { kind: 'result', text: '  ⎿ Resized' }],
    () => cb.screenshot(Buffer.from(screenshotSvg(`QA · mobile · ${demoQaPage(pr)}`, `localhost:${port}${demoQaPage(pr)}`, (hue + 40) % 360)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Took a screenshot of the current page' }],
    [{ kind: 'tool', tool: 'mcp__playwright__browser_console_messages', text: '⏺ 🌐 console_messages' }, { kind: 'result', text: '  ⎿ No errors' }],
  ];
}

function fixScript(pr: number, pushes: boolean, nudged: boolean): Step[] {
  if (nudged) {
    return [
      [{ kind: 'text', text: `● Checking whether PR #${pr} still needs a change.` }],
      pushes
        ? [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git commit -am "fix: wrap toolbar on narrow screens" && git push origin HEAD' }, { kind: 'result', text: '  ⎿ pushed' }]
        : [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git fetch origin && git diff origin/main --stat -- src/styles.css' }, { kind: 'result', text: '  ⎿ (no differences)' }],
    ];
  }
  return [
    [{ kind: 'text', text: `● Reading the QA report for PR #${pr}. The toolbar overflows on phones; I'll let it wrap.` }],
    [{ kind: 'tool', tool: 'Read', text: '⏺ Read src/styles.css' }, { kind: 'result', text: '  ⎿ Read 212 lines' }],
    [{ kind: 'tool', tool: 'Edit', text: '⏺ Edit src/styles.css' }, { kind: 'result', text: '  ⎿ Updated' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm test -- --run' }, { kind: 'result', text: '  ⎿ Test Files  8 passed (8)' }],
    pushes
      ? [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git commit -am "fix: wrap toolbar on narrow screens" && git push origin HEAD' }, { kind: 'result', text: '  ⎿ pushed' }]
      : [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git status --short' }, { kind: 'result', text: '  ⎿  M src/styles.css' }],
    ...(pushes ? [[{ kind: 'tool', tool: 'Bash', text: `⏺ $ gh pr checks ${pr} --watch` }, { kind: 'result', text: '  ⎿ All checks were successful' }] as LogEntry[]] : []),
  ];
}

/** The PR a fix prompt is about ("QA passed pull request #6…", "Pull request #6 (url) conflicts…"), and its title if given. */
export function fixPromptPull(prompt: string): { number: number; title?: string } {
  const m = prompt.match(/pull request #(\d+)(?::\s*(.+))?/i);
  return { number: Number(m?.[1] ?? 0), title: m?.[2]?.trim() };
}

// ---------- tools & skills ----------

/** A made-up Claude Code setup, read by the real inventory parser from files in memory (never this computer's ~/.claude). */
function demoTooling(projects: string[]): ToolInventory {
  const home = path.join(HOME_DIR, 'demo-claude');
  const plugin = (name: string, description: string, opts: { skills?: [string, string][]; commands?: string[]; mcp?: Record<string, unknown> }) => {
    const dir = path.join(home, 'plugins', 'cache', 'claude-plugins-official', name, '1.0.0');
    const files: Record<string, string> = { [path.join(dir, '.claude-plugin', 'plugin.json')]: JSON.stringify({ name, description }) };
    for (const [s, d] of opts.skills ?? []) files[path.join(dir, 'skills', s, 'SKILL.md')] = `---\nname: ${s}\ndescription: ${d}\n---\n`;
    for (const c of opts.commands ?? []) files[path.join(dir, 'commands', `${c}.md`)] = `# ${c}`;
    if (opts.mcp) files[path.join(dir, '.mcp.json')] = JSON.stringify({ mcpServers: opts.mcp });
    return { dir, files };
  };
  const plugins = {
    canva: plugin('canva', 'Create and edit Canva designs from Claude Code.', { skills: [['brand-check', 'Checks a design against the brand kit.'], ['resize-for-social-media', 'Resizes a design for each social network.']], mcp: { canva: { type: 'http', url: 'https://mcp.canva.com/mcp' } } }),
    superpowers: plugin('superpowers', 'Skills for planning, test-driven development and debugging.', { skills: [['brainstorming', 'Use before any creative work: explores intent before building.'], ['test-driven-development', 'Write the failing test first, then the code.'], ['systematic-debugging', 'Find the root cause before proposing fixes.']] }),
    github: plugin('github', 'GitHub issues, pull requests and Actions through GitHub’s MCP server.', { mcp: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer demo-not-a-real-token' } } } }),
    'commit-commands': plugin('commit-commands', 'Commit, push and open a PR in one command.', { commands: ['commit', 'commit-push-pr', 'clean_gone'] }),
    'code-review': plugin('code-review', 'Reviews a diff for bugs and project conventions.', { skills: [['code-review', 'Reviews the current diff at a chosen effort.']] }),
    figma: plugin('figma', 'Turn Figma designs into code.', { skills: [['figma-design-to-code', 'Implements a Figma frame as components.']], mcp: { figma: { type: 'http', url: 'https://mcp.figma.com/mcp' } } }),
  };
  const files: Record<string, string> = Object.assign({}, ...Object.values(plugins).map((p) => p.files));
  files[path.join(home, 'skills', 'pdf', 'SKILL.md')] = '---\nname: pdf\ndescription: Reads, fills and merges PDF files.\n---\n';
  files[path.join(home, 'skills', 'release-notes', 'SKILL.md')] = '---\nname: release-notes\ndescription: Writes release notes from merged pull requests.\n---\n';
  const global = path.join(home, '.claude.json');
  files[global] = JSON.stringify({
    mcpServers: {
      notion: { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'demo-secret-never-shown' } },
      linear: { type: 'http', url: 'https://mcp.linear.app/mcp?key=demo-secret-never-shown' },
    },
    claudeAiMcpEverConnected: ['claude.ai Gmail', 'claude.ai Google Drive', 'claude.ai Vercel'],
  });
  if (projects[0]) files[path.join(projects[0], '.mcp.json')] = JSON.stringify({ mcpServers: { sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp' } } });
  const pluginList = Object.entries(plugins).map(([name, p]) => ({ id: `${name}@claude-plugins-official`, enabled: name !== 'figma', installPath: p.dir, version: '1.0.0' }));
  const items = buildInventory(memoryFs(files), { configDir: home, globalConfig: global, projects, pluginList });
  return { items, scannedAt: Date.now(), scanning: false, error: null, via: 'the demo’s made-up setup' };
}

function fakeSession(opts: SessionOptions, cb: SessionCallbacks, fullName: string): SessionHandle {
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  let stalled = false; // stuck: no more output, and messages go unanswered
  if (opts.agentId) {
    stalls.set(opts.agentId, () => {
      stalled = true;
      timers.forEach(clearTimeout);
    });
  }
  // A cloud agent's session ends the way an expired login ends a real one when the fake account expires sign-ins.
  const signOut = opts.box && opts.agentId ? { boxId: opts.box.boxId, end: () => expired() } : null;
  if (signOut) signOuts.set(opts.agentId!, signOut);
  const forgetSignOut = () => {
    if (signOut && signOuts.get(opts.agentId!) === signOut) signOuts.delete(opts.agentId!);
  };
  const nudged = /^You pushed nothing/.test(opts.prompt); // the office's nudge after a fix that pushed nothing
  const resumedFix = opts.resumeSessionId?.startsWith('demo-fix-') ?? false;
  // The task picks the script; a session started without one (a follow-up) is read from its prompt.
  const fixPrompt = !opts.task && /FAILED|taking over pull request|git push origin HEAD:/.test(opts.prompt);
  const kind = opts.task === 'qa' ? 'qa' : opts.task === 'fix' || nudged || resumedFix || fixPrompt ? 'fix' : 'issue';
  // Fix sessions can be resumed (the office's nudge), like real ones.
  if (kind === 'fix') cb.sessionId(opts.resumeSessionId ?? `demo-fix-${crypto.randomUUID()}`);
  const pull = fixPromptPull(opts.prompt);
  const issueMatch = opts.prompt.match(/#(\d+):\s*(.+)/);
  const number = kind === 'issue' ? Number(issueMatch?.[1] ?? 0) : pull.number;
  const { answered, question, title } = demoAsks(kind === 'issue', opts, number, (kind === 'issue' ? issueMatch?.[2]?.trim() : pull.title) ?? 'follow-up', repos.get(fullName)?.issues ?? []);
  const round = Number(opts.prompt.match(/QA round (\d+)/)?.[1] ?? 1);
  // Now and then a QA fix ends without pushing, so the office's nudge can be seen; half the nudged answer NO CHANGE NEEDED.
  const pushes = kind !== 'fix' || !(nudged || /FAILED|taking over pull request/.test(opts.prompt)) || Math.random() > (nudged ? 0.5 : 0.25);

  const tools = opts.tools ? toolArgsLine(opts.tools) : '';
  const header: Step = [
    { kind: 'system', text: `✻ Claude Code (demo) · ${opts.model} · ${opts.effort} effort` },
    { kind: 'system', text: `  cwd ${opts.cwd}` },
    ...(tools ? [{ kind: 'system' as const, text: `  $ claude --session-id … ${tools}` }] : []),
  ];
  const checks = opts.prompt.match(/^GitHub checks right now: .*$/m)?.[0] ?? 'GitHub checks right now: none';
  const body = kind === 'qa' ? qaScript(cb, number, title, round, checks) : kind === 'fix' ? fixScript(number, pushes, nudged) : issueScript(opts, cb, number, title);
  const script = [header, ...(question ? [...body.slice(0, 7), () => ((stopped = true), demoAsked(cb, question))] : answered ? [[{ kind: 'text', text: '● Thanks: going with that.' }] as LogEntry[], ...body.slice(-3)] : body)];

  const expired = () => {
    if (stopped) return;
    stopped = true;
    forgetSignOut();
    timers.forEach(clearTimeout);
    cb.tool(null);
    cb.log([{ kind: 'error', text: 'API Error: 401 · Login expired · Please run /login (demo)' }]);
    const name = CLIS.find((c) => c.id === (opts.cli ?? 'claude'))?.label ?? 'Claude Code';
    cb.finished({ ok: false, text: '', costUsd: 0.1, turns: i, errors: [`${name} stopped: authentication failed`], signedOut: true });
  };

  const finish = () => {
    forgetSignOut();
    const costUsd = 0.3 + Math.random();
    const turns = 15 + Math.floor(Math.random() * 20);
    cb.tool(null);
    if (kind === 'qa') {
      // Most first rounds pass; some fail so the fix loop can be seen in action.
      const pass = round > 1 || (title !== DARK_MODE_TITLE && Math.random() > 0.35);
      const full = opts.prompt.includes('graphics: "full"'); // a 3D PR (qaPrompt.ts fullQualityLine) reports its full pass
      cb.log([{ kind: 'text', text: pass ? '● Everything checks out. Writing up the report.' : '● The toolbar overflows on a 375px screen. Failing this round.' }]);
      cb.finished({
        ok: true,
        text: '',
        costUsd,
        turns,
        errors: [],
        structured: {
          verdict: pass ? 'pass' : 'fail',
          summary: pass
            ? 'The change does what the issue asks: the feature works on desktop and mobile, all 41 tests pass, and lint and build are clean.'
            : 'The feature works on desktop, but on a 375px-wide screen the toolbar overflows and the new button is cut off.',
          checks: [
            { name: 'Unit tests', result: 'pass', details: '41 passed, 0 failed' },
            { name: 'Lint + build', result: 'pass', details: 'No lint errors; production build succeeds' },
            { name: 'Feature works on desktop', result: 'pass', details: 'Clicked through the new flow at 1280x800' },
            { name: 'Mobile layout (375px)', result: pass ? 'pass' : 'fail', details: pass ? 'Layout wraps correctly' : 'Toolbar overflows horizontally; button unreachable' },
            { name: 'Console errors', result: 'pass', details: 'None' },
            ...(full ? [{ name: 'Lab graphics profile', result: 'pass' as const, details: 'Canvas, controls, panels, 390px pocket mode, no console errors' }] : []),
            ...(full ? [{ name: 'Full-quality pass', result: 'pass' as const, details: 'Real graphics at 1280px, shadows and lighting; ran alone, browser restarted after' }] : []),
          ],
          commands: [
            { command: 'npm test -- --run', result: '41 passed' },
            { command: 'npm run lint && npm run build', result: 'clean, built in 1.84s' },
          ],
          screenshots: ['Home page', 'The changed page at 375px', ...(full ? ['Full quality · the changed scene at 1280px'] : [])],
          fixInstructions: pass ? undefined : 'Make the toolbar wrap (flex-wrap: wrap) below 480px so every button stays visible.',
        },
      });
      return;
    }
    if (kind === 'fix') {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (pr && pushes) {
        pr.headSha = fakeSha();
        pr.mergeState = 'CLEAN';
        pr.mergeable = 'MERGEABLE';
        runChecks(pr, false);
      }
      const text = pushes
        ? `● Fixed PR #${number} and pushed. Ready for another QA round.`
        : nudged
          ? 'NO CHANGE NEEDED: main already makes the toolbar wrap, so the PR is right as it is.'
          : '● The toolbar wraps on narrow screens now. Ready for another QA round.';
      cb.log([{ kind: 'text', text }]);
      cb.finished({ ok: true, text, costUsd, turns, errors: [] });
      return;
    }
    const repo = repos.get(fullName);
    let url = '';
    if (repo && number) {
      const n = takeNumber(repo);
      url = `https://github.com/${fullName}/pull/${n}`;
      repo.pulls.unshift({
        number: n,
        title,
        url,
        headRefName: `swarm/issue-${number}-${path.basename(opts.cwd).replace(/-[0-9a-f]{4}$/, '')}`,
        state: 'OPEN',
        isDraft: false,
        mergeable: 'MERGEABLE',
        reviewDecision: null,
        closesIssues: [number],
        createdAt: now(),
        mergedAt: null,
        additions: 40 + ((number * 13) % 200),
        deletions: (number * 7) % 40,
        checks: 'pending',
        headSha: fakeSha(),
        mergeState: 'CLEAN',
        failedChecks: [],
        pendingChecks: [],
        files: demoPrFiles(fullName, repo.issues.find((i) => i.number === number), number),
        summary: demoPrSummary(repo.issues.find((i) => i.number === number)),
      });
      runChecks(repo.pulls[0]);
      cb.log([{ kind: 'result', text: `  ⎿ ${url}` }]);
    }
    cb.log([{ kind: 'text', text: `● Opened ${url || 'the pull request'}. It closes #${number} and includes tests.` }]);
    cb.finished({ ok: true, text: url, costUsd, turns, errors: [] });
  };

  let i = 0;
  const step = () => {
    if (stopped || stalled) return;
    if (i >= script.length) {
      if (opts.agentId) stalls.delete(opts.agentId);
      return finish();
    }
    const s = script[i++];
    if (typeof s === 'function') s();
    else {
      const tool = s.find((e) => e.kind === 'tool');
      cb.tool(tool?.tool ?? null);
      cb.log(s);
    }
    timers.push(setTimeout(step, 1600 + Math.random() * 3800));
  };
  timers.push(setTimeout(step, 600));

  return {
    send(text) {
      timers.push(
        setTimeout(() => {
          if (stopped || stalled) return;
          cb.log([{ kind: 'text', text: `● Got it — "${text.slice(0, 60)}". Adjusting my approach.` }]);
        }, 1500),
      );
    },
    stop() {
      stopped = true;
      forgetSignOut();
      if (opts.agentId) stalls.delete(opts.agentId);
      timers.forEach(clearTimeout);
      cb.finished({ ok: false, text: '', costUsd: 0.1, turns: i, errors: ['Stopped by manager'] });
    },
  };
}

// ---------- the terminal runtime ----------

const ANSI: Record<LogEntry['kind'], (text: string) => string> = {
  text: (t) => t.replace(/^● /, '\x1b[97m●\x1b[0m '),
  tool: (t) => `\x1b[32m●\x1b[0m \x1b[1m${t.replace(/^⏺ /, '')}\x1b[0m`,
  result: (t) => `\x1b[2m${t}\x1b[0m`,
  thinking: (t) => `\x1b[35m${t}\x1b[0m`,
  error: (t) => `\x1b[31m${t}\x1b[0m`,
  system: (t) => `\x1b[2m${t}\x1b[0m`,
  manager: (t) => `\x1b[36m${t.replace(/^▶ /, '❯ ')}\x1b[0m`,
  done: (t) => `\x1b[32m${t}\x1b[0m`,
};

/**
 * With a terminal (the terminal runtime), the fake session's lines are drawn there the way Claude Code draws them,
 * and what the manager types into it is taken as a message.
 */
function inTerminal(opts: SessionOptions, cb: SessionCallbacks, start: (cb: SessionCallbacks) => SessionHandle): SessionHandle {
  const term = opts.terminal;
  if (!term) return start(cb);
  const name = CLIS.find((c) => c.id === (opts.cli ?? 'claude'))?.label ?? 'Claude Code';
  term.note(`── ${name}${opts.label ? ` · ${opts.label}` : ''} ──`);
  term.write(
    [
      '',
      ` \x1b[38;5;209m▐▛███▜▌\x1b[0m   \x1b[1m${name}\x1b[0m (demo)`,
      `\x1b[38;5;209m▝▜█████▛▘\x1b[0m  ${opts.model || 'default model'} · ${opts.effort} effort`,
      `\x1b[38;5;209m  ▘▘ ▝▝\x1b[0m    \x1b[2m${opts.cwd}\x1b[0m`,
      '',
      `\x1b[36m❯\x1b[0m ${opts.prompt.split('\n')[0].slice(0, 200)}`,
      '',
    ].join('\r\n'),
  );
  let handle: SessionHandle | null = null;
  let line = '';
  term.bind({
    write: (data) => {
      // Keys with no character (Esc, arrows, Shift+Tab, Ctrl+C…) are echoed by name, so the key bar can be checked here.
      const key = keyName(data);
      if (key) return term.write(`\x1b[2m⟨${key}⟩\x1b[0m`);
      for (const ch of data.replace(/\x1b\[[0-9;?]*[A-Za-z~]|\x1b./g, '')) {
        if (ch === '\r') {
          const text = line.trim();
          line = '';
          term.write('\r\n');
          if (text && handle) {
            cb.log([{ kind: 'manager', text: `▶ Typed in the terminal: ${text}` }]);
            handle.send(text);
          }
        } else if (ch === '\x7f' || ch === '\b') {
          if (line) term.write('\b \b');
          line = line.slice(0, -1);
        } else if (ch >= ' ') {
          line += ch;
          term.write(ch);
        }
      }
    },
    resize: () => undefined,
  });
  handle = start({
    ...cb,
    log: (entries) => {
      cb.log(entries);
      for (const e of entries) term.write(`${e.kind === 'tool' || (e.kind === 'text' && e.text.startsWith('●')) ? '\r\n' : ''}${ANSI[e.kind](e.text)}\r\n`);
    },
    finished: (r) => {
      term.bind(null);
      term.note(`── ${name} session ended ──`);
      cb.finished(r);
    },
  });
  return Object.assign(handle, { kept: true }); // as if the keeper held it: the demo's update restarts nothing
}

/**
 * The model catalog, made up (#198): Anthropic's list, Codex's, OpenCode's and an Ollama with one model;
 * SWARM_DEMO_MODELS=fail shows Claude Code's built-in list, as when its login can't read Anthropic's.
 */
export function demoCatalog(now: number) {
  const claude = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5'].map((id) => ({ id }));
  return mergeCatalog(
    [
      { cli: 'claude', models: process.env.SWARM_DEMO_MODELS === 'fail' ? null : claude },
      { cli: 'codex', models: [{ id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', isDefault: true }, { id: 'gpt-6-astra', name: 'GPT-6-Astra' }, { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' }] },
      { cli: 'opencode', models: [{ id: 'anthropic/claude-opus-5-5' }, { id: 'openai/gpt-6.1-sol' }, { id: 'opencode/big-pickle' }] },
      { local: 'ollama', models: ['qwen3-coder:30b'] },
    ],
    now,
  );
}

/**
 * Claude's usage on demand (the manager's console → Mission control, in the demo): a weekly-limit warning at 91% that
 * resets at midnight, or the 5-hour limit reached for 3 minutes.
 */
export function demoUsage(kind: 'warning' | 'limit', now: number): UsageWarning | { limitResetsAt: number } {
  if (kind === 'limit') return { limitResetsAt: now + 3 * 60_000 };
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return { resetsAt: midnight.getTime(), rateLimitType: 'seven_day', utilization: 0.91 };
}

// Claude's usage warning, faked once so the office can be seen pacing new work: the 4th session gets it, and the
// window "resets" 5 minutes later.
const USAGE_WARNING_AT = 4;
const USAGE_WARNING_MS = 5 * 60_000;
let sessionsStarted = 0;

function fakeUsageWarning(cb: SessionCallbacks) {
  setTimeout(() => {
    const resetsAt = Date.now() + USAGE_WARNING_MS;
    cb.log([{ kind: 'error', text: `⚠ Subscription usage warning (five_hour) · resets ${new Date(resetsAt).toLocaleTimeString()} (demo)` }]);
    cb.usageWarning?.({ resetsAt, rateLimitType: 'five_hour', utilization: 0.82 });
  }, 3000);
}

// Claude's usage readings, made up: they climb through a fast fake window (30 minutes for "5 hours", 6 hours for the
// week) and reset, so the meter can be seen moving. Running sessions report them every 15 s, like a status line.
const FAKE_WINDOW_MS = 30 * 60_000;
const FAKE_WEEK_MS = 6 * 60 * 60_000;

/** The demo's readings at `now`: the 5-hour window, the week and a weekly Sonnet limit. */
export function demoReadings(now: number): UsageReading[] {
  const fill = (period: number, from: number, span: number) => ({ pct: Math.round(from + (span * (now % period)) / period), resetsAt: now - (now % period) + period });
  return [
    { type: 'five_hour', ...fill(FAKE_WINDOW_MS, 8, 70), at: now },
    { type: 'seven_day', ...fill(FAKE_WEEK_MS, 35, 40), at: now },
    { type: 'seven_day_sonnet', ...fill(FAKE_WEEK_MS, 20, 30), at: now },
  ];
}

/** A session's callbacks that also report the made-up readings while it runs. */
function withReadings(cb: SessionCallbacks): SessionCallbacks {
  const feed = () => cb.usage?.(demoReadings(Date.now()));
  const first = setTimeout(feed, 4000);
  const every = setInterval(feed, 15_000);
  return {
    ...cb,
    finished: (result) => {
      clearTimeout(first);
      clearInterval(every);
      cb.finished(result);
    },
  };
}

/** A made-up install and build of 300-900 MB freed, so the idle-desk setting and its phone message can be seen. */
async function fakeTrim(stillIdle: () => boolean) {
  await new Promise((r) => setTimeout(r, 300));
  if (!stillIdle()) return null;
  return { freed: Math.round((300 + Math.random() * 600) * 2 ** 20), removed: ['node_modules', 'dist'], skipped: [] };
}

/** The demo's fake world; `scale` (--floors / --agents) makes it the big company instead of the usual two floors. */
export function createDemoBackend(scale: DemoScale | null = null, noTour = false): Backend {
  if (scale) seedBigCompany(scale.floors);
  restoreNumbers();
  holdDemoPort(() => `/demo/${[...repos.keys()][0]}/desks/preview`);
  // Tie each fake session back to its repo via the desk directory name.
  const deskRepo = new Map<string, string>();
  // Desks whose pretend dependencies are installed: the first task on a desk installs, the next ones skip.
  const installedDesks = new Set<string>();
  // The branch each desk has checked out (null: detached), so a PR branch another desk holds plays out as for real (#199).
  // A pretend projects folder: the demo repos, one git folder that isn't on GitHub yet, and one plain folder.
  const folders = new Map<string, LocalFolder>();
  const addFolder = (name: string, github: string | null, git = true) =>
    folders.set(name, { name, path: `/demo/projects/${name}`, git, github, modified: Date.now() - folders.size * 3_600_000 });
  for (const r of repos.values()) addFolder(r.fullName.split('/')[1], r.fullName);
  addFolder('sketchbook', null);
  addFolder('recipe-notes', null, false);
  const newRepo = (name: string, description = '') => {
    const fullName = `demo-co/${name}`;
    if (!repos.has(fullName)) {
      repos.set(fullName, { fullName, description, issues: [], pulls: [], nextNumber: 1 });
      bareRepos.add(fullName);
      restoreNumbers();
    }
    addFolder(name, fullName);
    return fullName;
  };
  const folderOf = (dir: string) => {
    const f = folders.get(dir.replace(/\\/g, '/').split('/').pop() ?? '');
    if (!f) throw new Error(`${dir} is not a folder`);
    return f;
  };
  let lowMemory = false; // the health strip's Simulate low memory: too little left for another session (a big company: a big server)
  return {
    demo: true,
    resources: { memory: async () => ({ availableMb: lowMemory ? 900 : scale ? 250_000 : 9800, totalMb: scale ? 262_144 : 16_384, swapFreeMb: 0, swapTotalMb: 0, load: 1.4, cpus: 8, at: Date.now() }), usage: async (dirs) => new Map(dirs.map((d) => [d, { rssMb: 1500, pids: [] }])), kill: () => undefined, browser: async () => (lowMemory ? 640 : null), simulate: (low) => void (lowMemory = low) },
    user: async () => 'demo-manager',
    listMyRepos: async (): Promise<GhRepoSummary[]> =>
      [...repos.values()].map((r) => ({ nameWithOwner: r.fullName, description: r.description, visibility: 'PUBLIC', updatedAt: now() })),
    repoMeta: async (fullName) => {
      const r = repos.get(fullName);
      if (!r) throw new Error(`Unknown demo repo ${fullName}`);
      return { nameWithOwner: fullName, description: r.description, url: `https://github.com/${fullName}`, defaultBranch: 'main' };
    },
    setLocalPath: () => undefined,
    scanProjects: async () => [...folders.values()].sort((a, b) => b.modified - a.modified),
    inspectFolder: async (dir) => folderOf(dir),
    publishFolder: async (dir, opts) => {
      const f = folderOf(dir);
      return f.github ?? newRepo(f.name, opts.description);
    },
    createProject: async (_root, name, opts) => {
      if (folders.has(name)) throw new Error(`/demo/projects/${name} already exists. Pick another name, or connect that folder instead.`);
      return { fullName: newRepo(name, opts.description), path: `/demo/projects/${name}` };
    },
    listIssues: async (fullName) => {
      const r = repos.get(fullName);
      if (r && scale) topUp(r, scale.agents * 2);
      // GitHub's fields for trust (#185), set on the fake's own objects: the office keeps them as they are, like before.
      for (const i of r?.issues ?? []) i.authorAssociation ??= 'OWNER';
      return [...(r?.issues ?? [])];
    },
    // Like GitHub's list: the open PRs and the 8 latest merges, never closed ones, so the office asks about those.
    listPulls: async (fullName) => {
      const pulls = repos.get(fullName)?.pulls ?? [];
      for (const p of pulls) Object.assign(p, { author: p.author ?? 'demo-manager', isCrossRepository: p.isCrossRepository ?? false });
      return [...pulls.filter((p) => p.state === 'OPEN'), ...pulls.filter((p) => p.state === 'MERGED').slice(0, 8)];
    },
    writers: async () => ['demo-manager'],
    exportCharter: async (fullName) => {
      if (!repos.has(fullName)) throw new Error('Unknown repo');
      return `https://github.com/${fullName}/compare/main...cubefarm/charter`; // the demo writes nothing
    },
    createIssue: async (fullName, title, body, labels = []) => {
      const r = repos.get(fullName);
      if (!r) throw new Error('Unknown repo');
      const n = takeNumber(r);
      r.issues.push(issue(n, title, body, fullName, labels));
      return n;
    },
    issueState: async (fullName, number) => {
      const r = repos.get(fullName);
      return r?.issues.some((i) => i.number === number) ? 'OPEN' : closedIssues.has(`${fullName}#${number}`) || forgotten(fullName, number) ? 'CLOSED' : null;
    },
    editIssue: async (fullName, number, edit) => {
      const i = repos.get(fullName)?.issues.find((x) => x.number === number);
      if (!i) throw new Error(`Unknown issue #${number}`);
      if (edit.body !== undefined) i.body = edit.body;
      if (edit.addLabels?.includes(TRUST_LABEL)) i.trustedBy = 'demo-manager';
      i.labels = [...i.labels.filter((l) => !edit.removeLabels?.includes(l)), ...(edit.addLabels ?? []).filter((l) => !i.labels.includes(l))];
    },
    mergePull: async (fullName, number, _method, headSha) => {
      const r = repos.get(fullName);
      const pr = r?.pulls.find((p) => p.number === number);
      if (!r || !pr) throw new Error('Unknown PR');
      if (headSha && pr.headSha !== headSha) throw new Error('Head branch was modified. Review and try the merge again.');
      mergedSinceSync.set(fullName, (mergedSinceSync.get(fullName) ?? 0) + 1);
      pr.state = 'MERGED';
      demoMerged(r.pulls);
      // Now and then a merge leaves another open PR conflicting, so conflict fixes (before QA and after it) can be seen.
      for (const other of r.pulls) if (other.state === 'OPEN' && Math.random() < 0.25) Object.assign(other, { mergeable: 'CONFLICTING', mergeState: 'DIRTY' });
      pr.mergedAt = now();
      // GitHub closes what "Closes #N" links a little after the merge, not straight away.
      setTimeout(() => {
        for (const n of pr.closesIssues) closedIssues.add(`${fullName}#${n}`);
        r.issues = r.issues.filter((i) => !pr.closesIssues.includes(i.number));
      }, 20_000).unref();
    },
    closeIssue: async (fullName, number) => {
      const r = repos.get(fullName);
      if (!r?.issues.some((i) => i.number === number)) throw new Error(`Issue #${number} is not open`);
      closedIssues.add(`${fullName}#${number}`);
      r.issues = r.issues.filter((i) => i.number !== number);
    },
    updateBranch: async (fullName, number) => {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (!pr) throw new Error('Unknown PR');
      Object.assign(pr, { headSha: fakeSha(), mergeState: 'CLEAN' });
      runChecks(pr, false);
    },
    ...demoPractices,
    failedRunLog: async (_fullName, runId) =>
      [
        `build\tRun npm test\t2025-01-01T00:00:00Z > vitest run (run ${runId})`,
        'build\tRun npm test\t2025-01-01T00:00:01Z  FAIL  src/__tests__/toolbar.test.ts > wraps below 480px',
        'build\tRun npm test\t2025-01-01T00:00:01Z AssertionError: expected "nowrap" to be "wrap"',
        'build\tRun npm test\t2025-01-01T00:00:02Z Test Files  1 failed | 7 passed (8)',
        'build\tRun npm test\t2025-01-01T00:00:02Z ##[error]Process completed with exit code 1.',
      ].join('\n'),
    checkAnnotations: async (fullName) => (ciDown(`/${fullName}/`) ? [CI_DOWN_NOTE] : []),
    demoParked: () => [...(repos.get(CI_DOWN_REPO)?.pulls.filter((p) => p.state === 'OPEN' && ciDown(p.url)).map((p) => ({ fullName: CI_DOWN_REPO, prNumber: p.number })) ?? []), { fullName: CI_ONLY_REPO, prNumber: CI_ONLY_PR, stuck: CI_ONLY_SUMMARY }],
    demoDesign,
    rerunFailedJobs: async (fullName, runIds) => {
      // The re-run passes: a flake, as the office hoped.
      for (const pr of repos.get(fullName)?.pulls ?? []) {
        if (pr.failedChecks.some((c) => runIds.some((id) => c.url?.includes(`/actions/runs/${id}/`)))) runChecks(pr, false);
      }
    },
    closePull: async (fullName, number) => {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (pr) pr.state = 'CLOSED';
    },
    prForBranch: async () => null,
    prDetails: async (fullName, number) => {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (!pr && forgotten(fullName, number)) {
        // From before a restart: the fake GitHub starts over, so it was closed while the office was down.
        return {
          number,
          title: `PR #${number}`,
          body: '',
          url: `https://github.com/${fullName}/pull/${number}`,
          headRefName: '',
          headSha: fakeSha(),
          isCrossRepository: false,
          closesIssues: [],
          state: 'CLOSED',
          mergeable: 'UNKNOWN',
          mergeState: 'UNKNOWN',
          checks: 'none',
          checkNames: [],
          failedChecks: [],
          pendingChecks: [],
        };
      }
      if (!pr) throw new Error(`Unknown PR #${number}`);
      return {
        number,
        title: pr.title,
        body: `Implements the change.\n\nCloses #${pr.closesIssues[0] ?? '?'}`,
        url: pr.url,
        headRefName: pr.headRefName,
        headSha: pr.headSha,
        isCrossRepository: false,
        closesIssues: pr.closesIssues,
        state: pr.state,
        mergeable: pr.mergeable,
        mergeState: pr.mergeState,
        checks: pr.checks,
        checkNames: pr.checks === 'none' ? [] : ['CI / build', 'Vercel'],
        failedChecks: pr.failedChecks.map((c) => c.name),
        pendingChecks: pr.pendingChecks,
      };
    },
    // The CEO's pr_diff and worktree_file read made-up changes: the demo has no code on disk.
    prDiff: async (fullName, number, patch) => {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (!pr) throw new Error(`Unknown PR #${number}`);
      return demoPrDiff(pr, patch);
    },
    readWorktree: async (r) => demoReadWorktree(r),
    hasRepoFile: (fullName, rel) => demoRepoFile(fullName, rel) !== null,
    readRepoFile: async (fullName, _branch, rel) => demoRepoFile(fullName, rel) ?? Promise.reject(new Error(`${rel} isn't on the default branch.`)),
    issueDetails: async (fullName, number) => {
      const i = repos.get(fullName)?.issues.find((x) => x.number === number);
      return { title: i?.title ?? `Issue #${number}`, body: i?.body ?? '', createdAt: i?.createdAt ?? closedFiled.get(`${fullName}#${number}`) };
    },
    commentPull: async (fullName, number) => `https://github.com/${fullName}/pull/${number}#issuecomment-${Date.now()}`,
    uploadEvidence: async (fullName, filePath) => `https://github.com/${fullName}/raw/swarm-qa-evidence/${filePath}`,
    ensureClone: async () => new Promise((r) => setTimeout(r, 400)),
    syncMain: async (fullName, _branch, { touch }) => {
      const behind = mergedSinceSync.get(fullName) ?? 0;
      if (behind === 0) return { status: 'in sync', behind: 0, updatable: false };
      if (!touch) return { status: `update ready (${behind} commit${behind === 1 ? '' : 's'})`, behind, updatable: true };
      mergedSinceSync.set(fullName, 0);
      return { status: `updated to ${fakeSha().slice(0, 7)}`, behind: 0, updatable: false };
    },
    mainDir: (fullName) => `/demo/${fullName}/main`,
    deskDir: (fullName, slug) => `/demo/${fullName}/desks/${slug}`,
    // The fake desks are the ones set up since the demo started: after a restart, every desk is gone.
    deskExists: (dir) => deskRepo.has(dir),
    prepareDesk: async (fullName, _base, slug) => {
      await new Promise((r) => setTimeout(r, 900));
      const dir = `/demo/${fullName}/desks/${slug}`;
      deskRepo.set(dir, fullName);
      return dir;
    },
    // Each agent's machine has a clone of its own, so no other desk ever holds its branch.
    machines: {
      deskDir: (machine, fullName) => path.join(HOME_DIR, 'machines', machine, 'work', fullName),
      prepareDesk: async (machine, fullName) => {
        await new Promise((r) => setTimeout(r, 900));
        const dir = path.join(HOME_DIR, 'machines', machine, 'work', fullName);
        deskRepo.set(dir, fullName);
        return dir;
      },
      env: () => ({}),
      release: async () => [],
      orphans: async () => [],
      trimDesk: (_machine, _fullName, stillIdle) => fakeTrim(stillIdle),
      sweep: async () => 0,
      remove: async () => ({ removed: true, patches: [] }),
      list: async () => [],
      exists: async () => true,
      installDeps: async () => 'none',
    },
    installDeps: async (dir, cb) => {
      if (installedDesks.has(dir)) {
        cb.log(['Dependencies unchanged since the last install; skipping it.']);
        return 'skipped';
      }
      cb.log(['Installing dependencies…', '$ npm ci']);
      cb.installing();
      await new Promise((r) => setTimeout(r, 1500));
      cb.log(['Dependencies installed.']);
      installedDesks.add(dir);
      return 'installed';
    },
    ...demoPreviewDesks(), // removeDesk and previewDesks (#204)
    sweepDesks: async () => ({ desks: 0, folders: 0, branches: 0, patches: [], skipped: [] }),
    trimDesk: (_fullName, _slug, stillIdle) => fakeTrim(stillIdle),
    releaseDesk: async () => undefined,
    startSession: (opts, cb) => {
      // The big company is for measuring the office at full speed, so it never paces.
      if (++sessionsStarted === USAGE_WARNING_AT && !scale) fakeUsageWarning(cb);
      if (!scale) cb = withReadings(cb);
      // Its first turn's size, as real sessions measured it here (#50): Claude Code's own ~23k, plus ~28k of
      // connectors and plugins unless the session is lean.
      if (!opts.resumeSessionId) cb.startup?.({ tokens: 23_500 + charTokens(opts.systemAppend.length + opts.prompt.length) + (opts.tools?.noConnectors ? 0 : 27_800), memoryChars: 24_000 });
      return inTerminal(opts, cb, (c) => (opts.readOnly ? demoConsultSession(opts, c) : opts.role === 'ceo' ? ceoSession(opts, c) : fakeSession(opts, withDemoChat(opts, withLab(opts, c)), deskRepo.get(opts.cwd) ?? boxDeskRepo(opts.cwd) ?? [...repos.keys()][0])));
    },
    sessionTranscript: (_cwd, sessionId, about) => demoTranscript(path.join(HOME_DIR, 'demo-transcripts'), sessionId, about),
    terminals: true,
    keeping: () => true,
    reconnectClis: async () => [], // fake sessions end with the office
    hooksReady: () => undefined,
    releaseClis: async () => undefined,
    detectClis: async () =>
      CLIS.map((c) => ({ id: c.id, label: c.label, installed: true, version: 'demo', integrated: c.integrated })),
    quickPicks: async () => DEMO_PICKS,
    toolInventory: async (projects) => demoTooling(projects),
    modelCatalog: async () => demoCatalog(Date.now()),
    // The idle check (#89) reads the made-up numbers; SWARM_DEMO_USAGE_CHECK=fail shows a check that can't read them.
    usageCheck: async () => (process.env.SWARM_DEMO_USAGE_CHECK === 'fail' ? { error: 'failed' } : { readings: demoReadings(Date.now()) }),
    survivalSignals: demoSurvival,
    previews: demoPreviews,
    testLab: demoLabRunner(),
    office: demoOffice,
    voice: demoVoice,
    weather: demoWeather,
    notify: demoNotify,
    telegram: demoTelegram(),
    cloud: demoCloud(),
    accounts: demoAccounts((o, exited) => demoSignIn({ ...o, boxId: 'accounts' }, new Map(), exited)),
    seedOps: (ids, at) => demoPastWeek(ids, at),
    seedCosts: (floors, agents, at) => sampleOffice(floors.map((f) => ({ id: f.id, open: repos.get(f.fullName)?.issues.map((i) => i.number) })), agents, at, Math.random, scale ? 7 : 28), // four weeks for the Charter tab's sparklines; the big company keeps one
    seedCharterLog: (charter, ledger, now) => sampleLog(charter, ledger, now, Math.random),
    seedCareers: sampleCareers, seedPastCareers: samplePastCareers, seedHistory: sampleHistory,
    demoTeam: (floor) => demoTeam(scale, floor),
    demoNoTour: noTour,
    seedLab: sampleLab,
    seedNotices: sampleNotices,
    seedChat: (now) => {
      const edits = demoEditedChat(now).map((m, i) => ({ ...m, id: i + 1 }));
      return [...edits, ...sampleChat(now, edits.length + 1)];
    },
    seedThreads: demoThreads,
    demoCharter,
    seedQaReport: (fullName) => {
      if (scale) return null; // the big company measures the office (scale.test.ts), not this example
      const r = repos.get(fullName);
      if (!r) return null;
      const stuck = { ...issue(takeNumber(r), DEMO_QA_ISSUE.title, DEMO_QA_ISSUE.body, fullName), createdAt: new Date(Date.now() - 5 * 3_600_000).toISOString() };
      r.issues.push(stuck);
      const seeded = demoQaReport(fullName, takeNumber(r), stuck, 3 * 3_600_000, fakeSha());
      r.pulls.unshift(seeded.pull);
      return seeded;
    },
    demoHeldUpdate,
    simulateUsage: demoUsage,
    demoDoctor: {
      dropDesk: (dir) => {
        deskRepo.delete(dir);
        installedDesks.delete(dir);
      },
      finishQuietly: (fullName, kind, n) => {
        const r = repos.get(fullName);
        if (!r) return;
        const pr = kind === 'pr' ? r.pulls.find((p) => p.number === n) : undefined;
        if (pr) Object.assign(pr, { state: 'MERGED', mergedAt: now() });
        for (const i of kind === 'issue' ? [n] : (pr?.closesIssues ?? [])) {
          closedIssues.add(`${fullName}#${i}`);
          r.issues = r.issues.filter((x) => x.number !== i);
        }
      },
      stall: (agentId) => {
        const stall = stalls.get(agentId);
        stall?.();
        return !!stall;
      },
      unclosedMerge: (fullName, mergedAgoMs) => {
        const r = repos.get(fullName);
        const open = r?.issues[r.issues.length - 1];
        if (!r || !open) return null;
        const n = takeNumber(r);
        r.pulls.unshift({
          number: n,
          title: open.title,
          url: `https://github.com/${fullName}/pull/${n}`,
          headRefName: `fix/issue-${open.number}`,
          state: 'MERGED',
          isDraft: false,
          mergeable: 'MERGEABLE',
          reviewDecision: null,
          closesIssues: [open.number],
          createdAt: new Date(Date.now() - mergedAgoMs - 3_600_000).toISOString(),
          mergedAt: new Date(Date.now() - mergedAgoMs).toISOString(),
          additions: 12,
          deletions: 3,
          checks: 'passing',
          headSha: fakeSha(),
          mergeState: 'CLEAN',
          failedChecks: [],
          pendingChecks: [],
        });
        return { issue: open.number, pr: n };
      },
    },
  };
}

// ---------- the office's own update ----------

/**
 * Floor 1's folder plays the office's own folder, so merges there make an update ready. There is a launcher when
 * the real one started the demo, or with SWARM_DEMO_LAUNCHER=1; either way the update is faked: a short pause, then
 * the result message, and nothing restarts.
 */
const OFFICE_REPO = 'demo-co/pixel-todo';
const DEMO_HEAD = `0ff1ce5${'0'.repeat(33)}`;
const lastFakeUpdate = { to: '', commits: 0 };
const demoOffice: OfficeHost = {
  launcher: underLauncher() || process.env.SWARM_DEMO_LAUNCHER === '1',
  head: async () => DEMO_HEAD,
  isOwnFolder: (dir) => dir === `/demo/${OFFICE_REPO}/main`,
  // Only its own fake updates have a count; one the real launcher did (u) gets no count rather than a wrong one.
  commitsBetween: async (_from, to) => (to === lastFakeUpdate.to ? lastFakeUpdate.commits : null),
  takeLastUpdate: () => takeLastUpdate(HOME_DIR),
  async update(from) {
    await new Promise((r) => setTimeout(r, 4000));
    lastFakeUpdate.commits = mergedSinceSync.get(OFFICE_REPO) ?? 0;
    mergedSinceSync.set(OFFICE_REPO, 0);
    lastFakeUpdate.to = fakeSha();
    return { from, to: lastFakeUpdate.to, ok: true, installed: true, built: true, at: Date.now() };
  },
};

/** A fresh demo office's chat: an update the preflight held back, with vitest's colour codes and rules in its output (#138). */
function demoHeldUpdate(): LastUpdate {
  const target = fakeSha();
  const output = `\x1b[31mFAIL\x1b[39m server/swarm.test.ts > schedules work \x1b[2m${'─'.repeat(120)}[1/1]\x1b[22m\x1b[39m`;
  return { from: DEMO_HEAD, to: DEMO_HEAD, target, ok: false, stage: 'preflight', error: `tests failed (npm test failed (exit 1): ${output})`, installed: false, built: false, at: Date.now() };
}

// ---------- the demo preview ----------

/**
 * The demo's stand-in for a floor's app: a page per path (Home and About link to each other), long enough to scroll.
 * A PR's build says so and shows its change, so main and the PR look different side by side.
 */
function placeholderPage(title: string, hue: number, at: string, pr: { number: number; title: string } | null) {
  const safe = (s: string) => s.replace(/[<>&"]/g, '');
  const rows = Array.from({ length: 24 }, (_, i) => `<li>Todo ${i + 1}: ${['water the plants', 'reply to Sam', 'book the dentist', 'buy coffee', 'fix the bike', 'plan the trip'][i % 6]}</li>`);
  if (pr) rows.splice(2, 0, `<li class="new">✨ New in PR #${pr.number}: ${safe(pr.title)}</li>`);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(title)}</title><link rel="icon" href="data:,">
<style>
  body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; background: hsl(${hue},60%,96%); color: #222; }
  nav { position: sticky; top: 0; display: flex; gap: 18px; align-items: center; padding: 12px 24px; background: hsl(${hue},70%,55%); color: #fff; }
  nav a { color: #fff; font-weight: 600; }
  nav .at { margin-left: auto; font-family: Consolas, monospace; font-size: 14px; opacity: .9; }
  .pr { margin: 18px auto 0; max-width: 560px; padding: 10px 16px; border-radius: 12px; background: #fff3c4; border: 2px dashed hsl(${hue},60%,45%); font-weight: 600; }
  main { margin: 22px auto; max-width: 560px; padding: 28px 36px; background: #fff; border-radius: 18px; box-shadow: 0 8px 30px hsla(${hue},50%,40%,.18); }
  h1 { margin: 0 0 6px; font-size: 26px; color: hsl(${hue},60%,38%); }
  p { margin: 0 0 18px; color: #666; }
  button { font: inherit; font-size: 18px; padding: 10px 26px; border: 0; border-radius: 999px; background: hsl(${hue},70%,55%); color: #fff; cursor: pointer; }
  button:active { transform: scale(.97); }
  #count { display: block; margin-top: 16px; font-size: 15px; color: #444; }
  ol { margin: 22px 0 0; padding-left: 22px; line-height: 2.2; }
  li.new { font-weight: 700; color: hsl(${hue},60%,32%); background: #fff3c4; border-radius: 6px; padding: 0 6px; }
</style></head>
<body>
<nav><a href="/">Home</a><a href="/about">About</a><span class="at">${safe(at)}</span></nav>
${pr ? `<div class="pr">🧪 This is PR #${pr.number}'s build: ${safe(pr.title)}</div>` : ''}
<main>
  <h1>${safe(title)}</h1>
  <p>${at === '/about' ? 'About this app: a placeholder served by the demo office.' : 'A placeholder app served by the demo office.'}</p>
  <button id="btn" type="button">Click me</button>
  <span id="count">Clicked 0 times</span>
  <ol>${rows.join('')}</ol>
</main>
<script>
  let n = 0;
  document.getElementById('btn').addEventListener('click', () => {
    n++;
    document.getElementById('count').textContent = 'Clicked ' + n + (n === 1 ? ' time' : ' times');
  });
</script>
</body></html>`;
}

/** Programs the demo pretends to have, so a bogus preview command fails the way it would for real. */
const DEMO_PROGRAMS = ['npm', 'npx', 'node', 'pnpm', 'yarn', 'bun', 'deno', 'vite', 'next', 'python', 'python3', 'py', 'php', 'ruby', 'go', 'cargo', 'dotnet'];

/**
 * No git, no npm: short fake delays through the real statuses, then a placeholder page on the floor's port.
 * Floors made in the demo have nothing to run until they get a command, and a command whose program isn't in
 * DEMO_PROGRAMS fails, so the viewer's unconfigured and error states can be tried out.
 */
// A PR preview on this floor fails its first start, so the viewer's failed card (and Ask the CEO) can be tried (#129).
const FLAKY_PREVIEWS = 'demo-co/weather-api';
const flakedOnce = new Set<string>();

const demoPreviews: PreviewBackend = {
  hasDefault: async (fullName) => !bareRepos.has(fullName),
  portOwner: demoPortOwner,
  proc: demoProc,
  kill: demoKill,
  start(job, cb) {
    let stopped = false;
    let server: http.Server | null = null;
    const timers: NodeJS.Timeout[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(() => !stopped && fn(), ms));
    const pull = job.pr ? repos.get(job.fullName)?.pulls.find((p) => p.number === job.pr) : undefined;
    const hue = ([...job.fullName].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7) + (job.pr ? 150 : 0)) % 360;
    const sha = (job.pr ? pull?.headRefName ?? String(job.pr) : job.fullName + job.defaultBranch)
      .split('')
      .reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381)
      .toString(16)
      .padStart(7, '0')
      .slice(0, 7);

    cb.status('preparing');
    later(700, () => {
      cb.commit(sha);
      cb.log([`HEAD is now at ${sha} (${job.pr ? `PR #${job.pr}` : job.defaultBranch})`]);
      if (!job.command && bareRepos.has(job.fullName)) {
        stopped = true;
        cb.failed('Nothing to run: this floor has no preview command and no package.json.', true);
        return;
      }
      cb.status('installing');
      cb.log(['$ npm ci', 'added 214 packages in 1s (demo)']);
    });
    later(1600, () => {
      cb.status('starting');
      cb.log([`$ ${job.command ?? 'npm run dev'}`.replaceAll('{port}', String(job.port))]);
      const key = `${job.fullName}#${job.pr}`;
      if (job.pr && job.fullName === FLAKY_PREVIEWS && !flakedOnce.has(key)) {
        flakedOnce.add(key);
        later(400, () => {
          cb.log(["Error: Cannot find module './routes/forecast.js'", '    at Module._resolveFilename (node:internal/modules/cjs/loader:1145:15)']);
          stopped = true;
          cb.failed(`The app exited (code 1) before it listened on port ${job.port}.`);
        });
        return;
      }
      const program = job.command?.trim().split(/\s+/)[0] ?? 'npm';
      if (!DEMO_PROGRAMS.includes(program.toLowerCase())) {
        later(400, () => {
          cb.log([`'${program}' is not recognized as an internal or external command,`, 'operable program or batch file.']);
          stopped = true;
          cb.failed(`The app exited (code 1) before it listened on port ${job.port}.`);
        });
        return;
      }
      server = http.createServer((req, res) => {
        const at = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (at.includes('.')) return void res.writeHead(404).end('Not found');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(placeholderPage(job.title, hue, at, job.pr ? { number: job.pr, title: pull?.title ?? `PR #${job.pr}` } : null));
      });
      server.once('error', (err) => {
        if (stopped) return;
        stopped = true;
        cb.failed(`Could not listen on port ${job.port}: ${err.message}`);
      });
      server.listen(job.port, '127.0.0.1', () => {
        if (stopped) return void server?.close();
        later(500, () => {
          cb.log([`  ➜  Local:   http://localhost:${job.port}/`]);
          cb.status('running');
        });
      });
    });

    return {
      async stop() {
        stopped = true;
        timers.forEach(clearTimeout);
        const s = server;
        server = null;
        if (!s?.listening) return;
        s.closeAllConnections();
        await new Promise<void>((resolve) => s.close(() => resolve()));
      },
    };
  },
};

// ---------- the demo CEO ----------

interface Profile {
  summary: string;
  qa: string;
  playbook: string;
}

const PROFILES: Record<string, Profile> = {
  'pixel-todo': {
    summary: 'Todo web app · React + Vite + TypeScript',
    qa: '- Add, complete, edit and delete todos; they survive a reload\n- Keyboard only: every action reachable, focus always visible\n- Phone width (375px): nothing overflows or gets cut off\n- No errors in the browser console',
    playbook:
      '## Map\n- src/components/: React views, no storage calls\n- src/store/: todo state and localStorage; components use its hooks only\n## Conventions\n- One component per file, tests next to it (*.test.tsx)\n## Skills\n- frontend-design for UI, test-driven-development for store changes\n## Traps\n- localStorage throws in private windows: wrap reads and writes',
  },
  'weather-api': {
    summary: 'REST API · Node + Express',
    qa: '- Every endpoint: happy path, bad input (400), unknown city (404)\n- Response shapes match the OpenAPI document\n- Rate limiting returns 429 with Retry-After\n- Tests and lint pass',
    playbook:
      '## Map\n- src/routes/: HTTP only, they call src/services/\n- src/services/: the logic, never imports express\n## Conventions\n- Update openapi.yaml with every endpoint change\n## Skills\n- test-driven-development for services\n## Traps\n- The upstream weather client is rate limited: mock it in tests',
  },
};

const GENERIC: Profile = {
  summary: 'Web project · early stage',
  qa: '- The app builds and starts\n- The changed feature works end to end in the browser\n- Phone width: nothing overflows\n- No console errors',
  playbook: '## Conventions\n- Small modules, tests next to the code\n## Skills\n- frontend-design for UI work',
};

/** The demo CEO's answer to a reply: the quote it answers, then a word on the answer. */
export function answerReply({ quote, reply }: { quote: string; reply: string }): string {
  const q = quote.length > 140 ? `${quote.slice(0, 139).trim()}…` : quote;
  const said = reply.length > 90 ? `${reply.slice(0, 89).trim()}…` : reply;
  if (/\bplan\b/i.test(said))
    return `> ${q}\n\nHere it is.\n\n\`\`\`artifact title="The plan"\n## Next milestone\n\n1. Finish the issues in progress\n2. Merge what passed QA\n3. Plan the next features with you\n\n| Step | Who | When |\n| --- | --- | --- |\n| Build | the team | today |\n| QA | the team | as PRs land |\n| Merge | the office | once checks pass |\n\`\`\`\n\n(I'm the demo CEO, so nothing changes.)`;
  const answer = /^(yes|yep|sure|ok(ay)?|go)\b/i.test(said) ? "Great, I'll go ahead with that." : /^(no|nope|don't|stop)\b/i.test(said) ? "Understood, I'll leave it as it is." : `Noted: "${said}".`;
  return `> ${q}\n\n${answer} (I'm the demo CEO, so nothing changes, but the real one would act on it.)`;
}

/** The demo CEO's answer to "where did the money go?": a dashboard of live sources, so it shows the demo's own costs. */
export function demoMoneyAnswer(): string {
  const dashboard = {
    title: 'This week’s spend',
    tiles: [
      { label: 'Spend', source: 'costs:7d:total' },
      { label: 'Per merge', source: 'costs:7d:costPerMerge' },
      { label: 'Waste', source: 'costs:7d:waste' },
      { label: 'Merges', source: 'costs:7d:merges' },
    ],
    charts: [
      { type: 'bar', title: 'By floor', source: 'costs:7d:byFloor' },
      { type: 'donut', title: 'By kind of work', source: 'costs:7d:byKind' },
    ],
  };
  const trend = { type: 'line', title: 'Cost per merge, day by day', source: 'costs:7d:perMerge' };
  const waste = { title: 'Waste by cause', columns: ['Cause'], source: 'costs:7d:wasteByCause' };
  return ["Here's where this week's money went: by floor, by kind of work, the waste and the cost per merge. Tap a floor to open it.", '', '```dashboard', JSON.stringify(dashboard), '```', '', '```chart', JSON.stringify(trend), '```', '', '```table', JSON.stringify(waste), '```'].join('\n');
}

/** A floor in company_status, as far as the demo CEO reads it. */
export interface DemoFloor {
  floor: number;
  repo: string;
  description: string;
  charter: string | null; // the compact rendering (shared/charter.ts)
  team: { size: number; max: number; free: number; pendingHires: number; pendingLetGos: number };
  capacity: { issuesReadyToStart: number; prsAwaitingQa: number };
  backlog: { number: number; title: string; inProgress: boolean }[];
  pullRequests: { number: number }[];
  agents?: { name: string }[];
}

interface DemoStatus {
  company: { scaling: string; officePlaybook: string | null }; // how team changes go, in words ("team changes apply straight away"); the office playbook
  floors: DemoFloor[];
  pendingChanges: unknown[];
  openDecisions?: { id: string; question: string }[];
}

/** The objective ids in a floor's charter, in order. */
const objectiveIds = (charter: string | null) => [...(charter ?? '').matchAll(/^- (O\d{1,2}):/gm)].map((m) => m[1]);

/** The team a floor will have once the changes waiting for the manager are decided. */
const plannedSize = (t: DemoFloor['team']) => t.size + t.pendingHires - t.pendingLetGos;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The demo CEO grows a floor up to this many agents on its own (the real CEO's "rarely more than 4 to 6"). */
const DEMO_GROW_TO = 6;

/**
 * The demo CEO's call to grow a floor: when the issues ready to start (`ready`) outnumber its free agents and the
 * agents already on their way, up to DEMO_GROW_TO and the floor's max. Null: the team can keep up.
 */
export function demoGrow(f: DemoFloor, ready: number): { size: number; reason: string } | null {
  const now = plannedSize(f.team);
  const waiting = ready - f.team.free - f.team.pendingHires;
  const size = Math.min(f.team.max, Math.max(now, DEMO_GROW_TO), now + waiting);
  if (waiting <= 0 || size <= now) return null;
  return {
    size,
    reason: `${plural(ready, 'issue')} ${ready === 1 ? 'is' : 'are'} ready to start on floor ${f.floor} and ${plural(f.team.free, 'agent')} ${f.team.free === 1 ? 'is' : 'are'} free: with ${size} agents they're worked on side by side instead of waiting.`,
  };
}

/** The demo CEO's call to shrink a floor: several agents idle with nothing ready to start or test. Never below one. */
export function demoShrink(f: DemoFloor): { size: number; reason: string } | null {
  const now = plannedSize(f.team);
  const idle = f.team.free - f.team.pendingLetGos;
  if (idle < 2 || f.capacity.issuesReadyToStart > 0 || f.capacity.prsAwaitingQa > 0) return null;
  const size = Math.max(1, now - (idle - 1));
  if (size >= now) return null;
  return { size, reason: `${idle} of ${f.team.size} agents on floor ${f.floor} are idle with nothing ready to start or test; ${size} can keep up with what comes in.` };
}

/** A scripted CEO that uses the real office tools, so team changes, profiles and issues behave exactly as in the real thing. */
function ceoSession(opts: SessionOptions, cb: SessionCallbacks): SessionHandle {
  const office = opts.office!;
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  let done = false;
  const wait = (ms: number) => new Promise<void>((resolve) => timers.push(setTimeout(resolve, ms)));
  const step = async (entries: LogEntry[], ms = 900 + Math.random() * 1500) => {
    if (stopped) throw new Error('Stopped by manager');
    cb.tool(entries.find((e) => e.tool)?.tool ?? null);
    logStreamed(entries, opts, cb);
    await wait(ms);
  };
  const status = async () => {
    await step([{ kind: 'tool', tool: 'mcp__office__company_status', text: `⏺ ${describeOfficeTool('company_status', {})}` }]);
    const s = JSON.parse(await office.call('company_status', {})) as DemoStatus;
    const agents = s.floors.reduce((n, f) => n + f.team.size, 0);
    const free = s.floors.reduce((n, f) => n + f.team.free, 0);
    const issues = s.floors.reduce((n, f) => n + f.backlog.length, 0);
    cb.log([{ kind: 'result', text: `  ⎿ ${s.floors.length} floors · ${agents} agents · ${free} free · ${issues} open issues · ${s.pendingChanges.length} team changes pending` }]);
    return s;
  };
  const use = async (name: string, args: Record<string, unknown>) => {
    await step([{ kind: 'tool', tool: `mcp__office__${name}`, text: `⏺ ${describeOfficeTool(name, args)}` }]);
    const out = await office.call(name, args);
    cb.log([{ kind: out.startsWith('Refused') ? 'error' : 'result', text: `  ⎿ ${out.split('\n')[0].slice(0, 170)}` }]);
    return out;
  };
  const read = (file: string, lines: number) => step([{ kind: 'tool', tool: 'Read', text: `⏺ Read ${file}` }, { kind: 'result', text: `  ⎿ Read ${lines} lines` }]);
  const think = (text: string) => step([{ kind: 'thinking', text: '✻ Thinking…' }, { kind: 'text', text: `● ${text}` }], 1800);
  const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
  const refused = (out: string) => out.replace(/^Refused: /, '');
  /** What happens next, by Settings → Team changes; `added`: new agents (negative: agents leaving). */
  const after = (s: DemoStatus, added: number) => {
    const who = added === 1 ? 'The new agent' : 'The new agents';
    if (/auto|straight away/i.test(s.company.scaling)) return added > 0 ? `${who} ${added === 1 ? 'is' : 'are'} on the way up.` : 'Idle agents leave first; anyone busy finishes their task.';
    return added > 0 ? `${who} ${added === 1 ? 'waits' : 'wait'} in the lobby for you to set up and hire.` : "It's an envelope on the desk of whoever I picked to leave, waiting for your decision.";
  };
  /** scale_team with the call made, and a sentence on how it went. */
  const scale = async (s: DemoStatus, f: DemoFloor, call: { size: number; reason: string }) => {
    const out = await use('scale_team', { floor: f.floor, ...call });
    return out.startsWith('Refused')
      ? `I wanted floor ${f.floor} at ${plural(call.size, 'agent')}, but the office said no: ${refused(out)}`
      : `Floor ${f.floor} goes from ${f.team.size} to ${plural(call.size, 'agent')}: ${call.reason} ${after(s, call.size - plannedSize(f.team))}`;
  };

  /** Files the brief's first three issues, each naming an objective when the charter has some; returns the skeleton's number. */
  const planIssues = async (floor: number, mission: string, ids: string[]) => {
    const tag = (i: number) => (ids.length ? `\n\nObjective: ${ids[Math.min(i, ids.length - 1)]}` : '');
    const first = await use('file_issue', {
      floor,
      title: 'Set up the project skeleton',
      body: `Scaffold the app so the rest of the milestone has something to build on.\n\nBrief: ${mission}\n\nAcceptance criteria:\n- The dev server starts\n- A placeholder home page renders\n- Lint, tests and build scripts exist${tag(0)}`,
    });
    const n = Number(first.match(/#(\d+)/)?.[1] ?? 0);
    await use('file_issue', {
      floor,
      title: `Build the core: ${short(mission, 60)}`,
      body: `${n ? `Depends on #${n}\n\n` : ''}Implement the heart of the brief.\n\nAcceptance criteria:\n- The main flow works end to end\n- Covered by tests${tag(0)}`,
    });
    await use('file_issue', {
      floor,
      title: 'Polish: phone layout and empty states',
      body: `${n ? `Depends on #${n}\n\n` : ''}Make every screen work at 375px and add friendly empty states.${tag(1)}`,
    });
    return n;
  };

  const scripts = {
    async onboard(floor: number, fullName: string) {
      const s = await status();
      const f = s.floors.find((x) => x.floor === floor);
      if (!f) return 'That floor has gone, so there was nothing to onboard.';
      const p = PROFILES[fullName.split('/')[1] ?? ''] ?? GENERIC;
      await read(`${f.repo}/README.md`, 48);
      await step([{ kind: 'tool', tool: 'Glob', text: '⏺ Glob src/**/*' }, { kind: 'result', text: '  ⎿ Found 23 files' }]);
      await read('package.json', 36);
      await think(`${p.summary}. Let me size the team for the work in sight.`);
      await use('set_floor_profile', { floor, summary: p.summary, qa_brief: p.qa, playbook: p.playbook });
      const ready = f.capacity.issuesReadyToStart;
      const grow = demoGrow(f, ready);
      const team = grow ? await scale(s, f, grow) : `Its ${plural(f.team.size, 'agent')} can keep up with the ${plural(ready, 'issue')} ready to start.`;
      const drafted = f.charter ? '' : await use('propose_charter', { floor, ...demoDraft(f.description || p.summary, p.qa) });
      const charter = drafted && !drafted.startsWith('Refused') ? 'I drafted a charter for it: approve or edit it in the Charter tab.' : '';
      const next = f.backlog.length === 0 ? ' The backlog is empty: tell me what you would like built and I will plan it.' : '';
      return [`Floor ${floor}: ${p.summary}. I wrote a QA brief and a playbook for it.`, team, charter, next].filter(Boolean).join(' ');
    },
    async plan(floor: number, mission: string) {
      const s = await status();
      const f = s.floors.find((x) => x.floor === floor);
      if (!f) return 'That floor has gone, so there was nothing to plan.';
      await read(`${f.repo}/README.md`, 12);
      await think("Foundation first, so the parallel work doesn't collide.");
      const n = await planIssues(floor, mission, objectiveIds(f.charter));
      const grow = demoGrow(f, f.capacity.issuesReadyToStart + (n ? 1 : 0));
      const team = grow ? ` ${await scale(s, f, grow)}` : '';
      return `I turned the brief into three issues on floor ${floor}. #${n} sets up the skeleton; the other two say "Depends on #${n}", so nobody starts them early.${team}`;
    },
    // Research: look outward and inward, then bring options with sources, filing nothing (server/research.ts).
    async research(topic: string, floor: number | null) {
      const s = await status();
      const f = s.floors.find((x) => x.floor === floor) ?? s.floors[0];
      await step([{ kind: 'tool', tool: 'WebSearch', text: `⏺ Web Search("${short(topic, 60)} best practices")` }, { kind: 'result', text: '  ⎿ Did 1 search' }]);
      await step([{ kind: 'tool', tool: 'WebFetch', text: '⏺ Fetch(https://developer.mozilla.org/en-US/docs/Web)' }, { kind: 'result', text: '  ⎿ Received 48.2KB' }]);
      if (f) await read(`${f.repo}/README.md`, 40);
      await think('Three distinct ways to do it. Facts and guesses kept apart.');
      return researchBrief(topic, f ? `floor ${f.floor} (\`${f.repo.split('/').pop()}\`)` : 'your floors');
    },
    async review() {
      const s = await status();
      await think('Checking each floor for work waiting on free agents, and agents waiting on work.');
      for (const f of s.floors) {
        const call = demoShrink(f) ?? demoGrow(f, f.capacity.issuesReadyToStart);
        if (call) return scale(s, f, call);
      }
      const issues = s.floors.reduce((n, f) => n + f.backlog.length, 0);
      const prs = s.floors.reduce((n, f) => n + f.pullRequests.length, 0);
      return `All ${s.floors.length} floors look healthy: ${issues} open issues and ${prs} pull requests in flight. No changes needed.`;
    },
    // A stuck PR: read what QA and GitHub say, then act through the real triage tools, as the real CEO would.
    async triage(floor: number, pr: number, facts: string) {
      await step([{ kind: 'tool', tool: 'Read', text: `⏺ Read PR #${pr}'s QA report` }, { kind: 'result', text: '  ⎿ Read 38 lines' }]);
      const conflict = /mergeable: CONFLICTING/.test(facts);
      const red = /GitHub checks: failing/.test(facts);
      const again = !/triage 1 of/.test(facts);
      await think(conflict ? 'It only conflicts with main; the change itself is fine.' : red ? 'A red check that looks like a flake.' : again ? 'Stuck a second time. This needs a call from the manager.' : 'The fix sessions stalled, not the code. Another QA round should settle it.');
      const [tool, args, done] = conflict
        ? ['send_back', { note: 'Merge main and keep both changes working; QA already liked the rest.' }, 'went back for a fix: merging main']
        : red
          ? ['rerun_checks', {}, 'had its failed checks re-run']
          : again
            ? ['escalate', { reason: 'It got stuck twice for the same reason; worth a look at the issue itself.' }, 'is with you now']
            : ['retry_qa', {}, 'is back in the QA queue'];
      const out = await use(tool, { floor, pr, ...args });
      if (!out.startsWith('Refused')) return `PR #${pr} on floor ${floor} was stuck. It ${done}.`;
      await use('escalate', { floor, pr, reason: `I tried ${tool}, but the office refused: ${refused(out)}` });
      return `PR #${pr} on floor ${floor} is stuck and I couldn't move it, so it's with you now.`;
    },
    // Woken by office events: look through the real read-only tools, and stay quiet unless something needs the manager.
    async followup(events: string[]) {
      const needs: string[] = [];
      for (const e of events.slice(0, 4)) {
        const floor = Number(e.match(/floor (\d+)/)?.[1] ?? 0);
        const pr = Number(e.match(/PR #(\d+)/)?.[1] ?? 0);
        const agent = e.match(/\(([\w-]+)\)/)?.[1];
        if (/ merged /.test(e) && pr) await use('pr_diff', { floor, pr });
        else if (/failed QA/.test(e) && pr) await use('qa_report', { floor, pr });
        else if (agent && / error | stalled /.test(e)) {
          await use('agent_log', { agent_id: agent, lines: 50 });
          if (/ error /.test(e) && (await use('restart_agent', { agent_id: agent })).startsWith('Refused')) needs.push(`${e.split(' (')[0]} is still in an error and I couldn't restart them; reset them from their desk.`);
        } else if (!(await demoCeoAnswer(e, use, think))) await think('Nothing there needs me.'); // an agent's question: answered, or on the manager's phone
      }
      if (events.some((e) => / merged /.test(e))) await think('The merged changes match their issues.');
      return needs.length ? needs.join(' ') : 'Nothing to do.';
    },
    // The manager's changes touched running work (#207): a closed issue stops its builder, a closed PR's author is told to wrap up, the rest finish.
    async changes(lines: string[]) {
      const out: string[] = [];
      for (const l of lines) {
        const floor = Number(l.match(/^- floor (\d+)/)?.[1] ?? 0);
        for (const [, name, id, state] of (l.split(' · touched: ')[1] ?? '').matchAll(/([^,(]+?) \(([\w-]+), ([^)]*)\)/g)) {
          const who = name.trim();
          if (state === 'finished it already') {
            out.push(`${who} had already finished, so there was nothing to stop.`);
            continue;
          }
          await use('agent_log', { agent_id: id, lines: 30 });
          const stop = /: closed #/.test(l) ? await use('stop_agent', { agent_id: id, reason: 'you closed their issue' }) : '';
          if (/isn't running/.test(stop)) out.push(`${who} had already finished, so there was nothing to stop.`);
          else if (stop && !stop.startsWith('Refused')) out.push(`Stopped ${who}: you closed their issue.`);
          else if (/: closed PR/.test(l) && !(await use('message_agent', { floor, agent_id: id, text: 'The manager closed your PR: push nothing more, wrap up and say what is left.' })).startsWith('Refused')) out.push(`Redirected ${who}: they wrap up, since you closed their PR.`);
          else out.push(`Let ${who} finish: your change doesn't undo their work.`);
        }
      }
      return out.join('\n') || 'Nothing to do: that work had already ended.';
    },
    async chat(text: string) {
      const s = await status();
      await think('Reading your message.');
      const quick = await demoReactions(text, use); // several messages at once, "ok thanks", "go ahead" (#118)
      if (quick !== null) return quick;
      const sent = sentFiles(opts.prompt); // files from the manager, or a document asked for: the demo makes one
      if (sent.length || wantsFile(text)) return demoMakeFiles({ step, read, use, cwd: opts.cwd }, s.floors, sent);
      // A reply to one of the CEO's messages: answer it, quoting what it answers.
      const reply = parseForwarded(text);
      if (reply) return answerReply(reply);
      const awake = await demoAwake(text, s.floors, use); // "wait for PR #3", "consult …", "ask me …" (#28)
      if (awake) return awake;
      const resolved = await demoResolve(text, s.openDecisions, use); // an open decision answered in words (#114)
      if (resolved) return resolved;
      // "Where did the money go this week?": a dashboard on the office's live costs (#146, shared/chatVisuals.ts).
      if (/\b(money|spend|spent|spending|costs?)\b/i.test(text)) return demoMoneyAnswer();
      // "send me the status on Telegram": through the real tool, refused when Telegram isn't linked.
      if (/\btelegram\b/i.test(text)) {
        const issues = s.floors.reduce((n, f) => n + f.backlog.length, 0);
        const out = await use('send_telegram', { text: `Status: ${plural(s.floors.length, 'floor')}, ${plural(issues, 'open issue')}, ${plural(s.pendingChanges.length, 'team change')} waiting for you.` });
        return out.startsWith('Refused') ? `I couldn't send it: ${refused(out)}` : 'Sent: the status is on your Telegram.';
      }
      // "fix your last message": the CEO corrects its latest reply through the real tool (#125), struck through on the phone.
      if (/\b(fix|correct|edit) your (last |latest )?(message|reply)\b/i.test(text)) {
        const out = await use('edit_message', { text: `Correction: ${plural(s.floors.length, 'floor')} and ${plural(s.floors.reduce((n, f) => n + f.pullRequests.length, 0), 'pull request')} in flight, as of now.`, reason: 'the manager asked me to correct it' });
        return out.startsWith('Refused') ? `I couldn't edit it: ${refused(out)}` : 'Corrected: my earlier message now shows what changed, struck through.';
      }
      // "add to the office playbook: run the linter first": a bullet through the real tool, refused past its cap.
      const rule = text.match(/\boffice playbook\b[^:]*:\s*(.+)/i)?.[1]?.trim();
      if (rule) {
        const out = await use('set_office_playbook', { playbook: [s.company.officePlaybook, `- ${rule}`].filter(Boolean).join('\n') });
        return out.startsWith('Refused') ? `I couldn't add it: ${refused(out)}` : `Added to the office playbook: "${short(rule, 80)}". ${out}`;
      }
      // "close #3, superseded by #5": through the real tool.
      const close = text.match(/\bclose #(\d+)[\s,:;.-]*(.*)/i);
      const closeFloor = close && (s.floors.find((f) => f.backlog.some((i) => i.number === Number(close[1]))) ?? s.floors[0]);
      if (close && closeFloor) {
        const reason = close[2].trim() || 'No longer wanted.';
        const out = await use('close_issue', { floor: closeFloor.floor, number: Number(close[1]), reason });
        return out.startsWith('Refused') ? `I couldn't close #${close[1]}: ${refused(out)}` : `Done: ${out} I left "${short(reason, 80)}" on it as a comment.`;
      }
      // "Tighten floor 2's charter": a change for the manager to approve, through the real tool.
      if (/\bcharter\b/i.test(text)) {
        const f = s.floors.find((x) => new RegExp(`floor ${x.floor}\\b`, 'i').test(text)) ?? s.floors[0];
        if (!f) return 'There are no floors yet: add a project first, and I will draft its charter.';
        const ids = objectiveIds(f.charter);
        const out = await use('propose_charter', { floor: f.floor, reason: 'You asked about the charter: finish the first objectives before starting new ones.', focus: ids.length ? `${ids.slice(0, 2).join(', ')}, until they are met` : 'The core flows first' });
        return out.startsWith('Refused') ? `I couldn't propose it: ${refused(out)}` : `I proposed a new focus for floor ${f.floor}'s charter. Approve or edit it in the Charter tab: nothing changes until you do.`;
      }
      // "Plan the next milestone for floor 1": an issue and a bigger team through the real tools, so the reply shows
      // its action cards (#108), with the plan as an artifact and an idea card for the charter.
      if (/\b(plan|milestone)\b/i.test(text)) {
        const f = s.floors.find((x) => new RegExp(`floor ${x.floor}\\b`, 'i').test(text)) ?? s.floors[0];
        if (!f) return 'There are no floors yet: add a project first, and I will plan its first milestone.';
        const ids = objectiveIds(f.charter);
        const filed = await use('file_issue', { floor: f.floor, title: 'Polish: phone layout and empty states', body: `Make every screen work at 390px and add friendly empty states.${ids.length ? `\n\nObjective: ${ids[0]}` : ''}` });
        const team = plannedSize(f.team) < f.team.max ? await scale(s, f, { size: plannedSize(f.team) + 1, reason: 'One more agent so the milestone lands this week.' }) : '';
        const n = filed.match(/#(\d+)/)?.[1];
        return [
          filed.startsWith('Refused') ? `I couldn't file it: ${refused(filed)}` : `Planned the next milestone on floor ${f.floor}: #${n} first. ${team}`,
          '',
          '```artifact title="Milestone plan"',
          `## Floor ${f.floor}: next milestone`,
          '',
          '| Step | Issue | Who |',
          '| --- | --- | --- |',
          `| Phone polish | #${n ?? '?'} | the team |`,
          '| QA and merge | as PRs land | the office |',
          '```',
          '',
          '```idea objective',
          `Add an objective to floor ${f.floor}: no screen cut off at 390 px`,
          `Add an objective to floor ${f.floor}'s charter: no screen is cut off at 390 px, checked by the layout spec.`,
          '```',
        ].join('\n');
      }
      // Asked for a bigger team: one more agent where the most work waits, through the real tool.
      if (/\b(hire|hiring|grow|team|bigger)\b/i.test(text)) {
        if (!s.floors.length) return 'There are no floors yet: add a project first, and I will size its team.';
        const room = s.floors.filter((f) => plannedSize(f.team) < f.team.max);
        if (!room.length) return `Every floor is at its most agents (${s.floors[0].team.max}). Raise it in Settings → Most agents per floor, and I'll grow the busiest one.`;
        const f = room.sort((a, b) => b.capacity.issuesReadyToStart - b.team.free - (a.capacity.issuesReadyToStart - a.team.free) || a.floor - b.floor)[0];
        const ready = f.capacity.issuesReadyToStart;
        return scale(s, f, {
          size: plannedSize(f.team) + 1,
          reason: `You asked for a bigger team, and floor ${f.floor} has the most work waiting: ${plural(ready, 'issue')} ready to start, ${plural(f.team.free, 'agent')} free.`,
        });
      }
      const agents = s.floors.reduce((n, f) => n + f.team.size, 0);
      const issues = s.floors.reduce((n, f) => n + f.backlog.length, 0);
      const nextFloor = s.floors.find((f) => f.backlog.length);
      const next = nextFloor && { floor: nextFloor.floor, issue: nextFloor.backlog[0] };
      const pending = s.pendingChanges.length;
      // Real CEOs answer in Markdown, so the demo one does too: every element the phone renders, the longer part as an
      // artifact card and the question with suggestion boxes (shared/chatParts.ts).
      const rows = s.floors.map((f) => `| ${f.floor} | \`${f.repo.split('/').pop()}\` | ${f.team.size} | ${f.backlog.length} | ${f.pullRequests.length} | ${f.capacity.issuesReadyToStart} | ${f.capacity.prsAwaitingQa} | ${f.team.free} |`);
      return [
        `**Quick status:** ${s.floors.length} floor${s.floors.length === 1 ? '' : 's'}, ${agents} agents and ${issues} open issues. The floor-by-floor report is attached.`,
        '',
        '- The team is *heads down* on the backlog',
        `- ${pending ? `**${pending}** team change${pending === 1 ? ' is' : 's are'} waiting for your decision` : 'No team changes waiting on you'}`,
        '  - QA re-tests every PR after a fix',
        '',
        '```artifact title="Floor report"',
        '## Every floor',
        '',
        '| Floor | Repo | Agents | Issues | PRs | Ready to start | Waiting for QA | Free agents |',
        '| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...(rows.length ? rows : ['| – | no projects yet | 0 | 0 | 0 | 0 | 0 | 0 |']),
        '',
        '## What I would do next',
        '',
        '1. Merge anything that passed QA',
        '2. Run `npm run build` on each floor before the next milestone',
        '3. Grow a team only where work keeps waiting for free agents',
        '',
        '```bash',
        'SWARM_HOME=/tmp/cubefarm-demo SWARM_PORT=5260 node --import tsx server/index.ts --demo',
        '```',
        '```',
        '',
        `> I'm the demo CEO, so I can't act on "${short(text)}", but the real one would. See the [Claude Code docs](https://docs.claude.com/en/docs/claude-code/overview).`,
        '',
        demoRefsLine(s.floors),
        ...(next
          ? ['', `Next up on floor ${next.floor}: #${next.issue.number} ${next.issue.title}. Shall I keep the team on it?`, '```suggestions', 'Yes, keep them on it', 'Not now', 'Show me the plan', '```']
          : []),
        ...(nextFloor ? ['```idea research', `Research how other teams test phone layouts before floor ${nextFloor.floor} builds more`, `Research: how other teams test phone layouts, for floor ${nextFloor.floor}`, '```'] : []),
      ].join('\n');
    },
  };

  const [asked, changed = ''] = opts.prompt.split("\n\nYour changes since last time"); // the manager's changes (#207), after the rest
  const prompt = asked.split('\n\nSince you last looked:')[0].split('\n\nOpen decisions from the last 24 h')[0].replace(/\n\nThe manager asked you to always remember:[\s\S]*$/, ''); // the manager's answers to agents (ceo.ts toldCeo), open decisions (#208) and pinned notes (ceoMemory.ts)
  const where = prompt.match(/[Ff]loor (\d+) \(([^,)]+)/);
  const triage = prompt.match(/^Triage: pull request #(\d+) on floor (\d+)/);
  const run = triage
    ? () => scripts.triage(Number(triage[2]), Number(triage[1]), prompt)
    : prompt.startsWith('Research for the manager:')
      ? () => scripts.research(prompt.match(/^Research for the manager: "([\s\S]*?)"\n/)?.[1] ?? '', where ? Number(where[1]) : null)
    : prompt.startsWith('The manager changed work')
      ? () => scripts.changes(changed.split('\n').filter((l) => l.startsWith('- floor ')))
    : prompt.startsWith('Follow-up:')
      ? () => scripts.followup(prompt.split('\n').filter((l) => /^- \[e\d+\]/.test(l)))
    : /no longer needs triage/.test(prompt)
      ? async () => 'Nothing to do.'
      : /just joined the company/.test(prompt)
        ? () => scripts.onboard(Number(where?.[1]), where?.[2] ?? '')
        : /has a brief for floor/.test(prompt)
          ? () => scripts.plan(Number(where?.[1]), prompt.match(/"""([\s\S]*?)"""/)?.[1]?.trim() ?? '')
          : /Periodic review/.test(prompt)
            ? () => scripts.review()
            : () => scripts.chat(prompt.split('\n').slice(1).join(' ').trim() || prompt);

  const finish = (ok: boolean, text: string, error?: string) => {
    if (done) return;
    done = true;
    cb.tool(null);
    cb.finished({ ok, text, costUsd: ok ? 0.4 + Math.random() : 0.05, turns: 6 + Math.floor(Math.random() * 10), errors: error ? [error] : [] });
  };

  timers.push(
    setTimeout(async () => {
      try {
        cb.log([{ kind: 'system', text: `✻ Claude Code (demo) · ${opts.model} · ${opts.effort} effort · CEO` }]);
        const reply = await run();
        await writeReply(reply, opts, cb, () => stopped);
        finish(true, reply);
      } catch (err) {
        finish(false, '', stopped ? 'Stopped by manager' : (err as Error).message);
      }
    }, 500),
  );

  return {
    send(text) {
      timers.push(
        setTimeout(() => {
          if (stopped || done) return;
          const said = text.split('\n').slice(1).join(' ').replace(/^\(message \d+\) /, '').trim() || text;
          const reply = parseForwarded(said);
          cb.log([{ kind: 'text', text: `● Noted: "${short(reply?.reply ?? said, 70)}"` }]);
          cb.turn?.(reply ? answerReply(reply) : `Noted, I'll factor that in: "${short(said, 90)}"`);
        }, 1500),
      );
    },
    stop() {
      stopped = true;
      timers.forEach(clearTimeout);
      finish(false, '', 'Stopped by manager');
    },
  };
}

// ---------- voice ----------

/**
 * A two-note chime as 8 kHz mono WAV: something to hear without ElevenLabs, longer for longer text (up to 6 s, so a
 * voice call can be paused, skipped and talked over mid-reply), and pitched by the voice, so a replayed clip is
 * audibly the one made in the voice of its day.
 */
export function demoChime(chars: number, voiceId = ''): Buffer {
  const rate = 8000;
  const seconds = Math.min(0.4 + chars / 40, 6);
  const n = Math.round(rate * seconds);
  const wav = Buffer.alloc(44 + n);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + n, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(n, 40);
  const pitch = 2 ** ([...voiceId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 7, 0) / 12);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = (t < seconds / 2 ? 660 : 880) * pitch;
    const fade = Math.min(1, (seconds - t) * 8, t * 40);
    wav[44 + i] = Math.round(128 + 40 * fade * Math.sin(2 * Math.PI * f * t));
  }
  return wav;
}

const demoVoices = [
  { id: 'demoVoiceAvery00001', name: 'Avery', category: 'premade', labels: { accent: 'american', gender: 'female', age: 'middle aged', description: 'calm', use_case: 'conversational' }, previewUrl: null },
  { id: 'demoVoiceBasil00002', name: 'Basil', category: 'premade', labels: { accent: 'british', gender: 'male', age: 'middle aged', description: 'warm', use_case: 'narration' }, previewUrl: null },
  { id: 'demoVoiceCleo000003', name: 'Cleo', category: 'premade', labels: { accent: 'australian', gender: 'female', age: 'young', description: 'friendly', use_case: 'conversational' }, previewUrl: null },
];

/** What the demo's Speech to Text hears in any recording (docs/voice.md). */
export const DEMO_TRANSCRIPT = "What's everyone working on?";

/** No network: any key works except one containing "bad", three voices, a chime for every message, and one fixed transcript. */
const demoVoice: VoiceApi = {
  checkKey: async (key) => {
    if (/bad/i.test(key)) throw new VoiceApiError(401, '401: invalid_api_key (demo)');
  },
  listVoices: async () => demoVoices,
  synthesize: async (_key, { text, voiceId }) => {
    await new Promise((r) => setTimeout(r, 300));
    return demoChime(text.length, voiceId);
  },
  transcribe: async () => {
    await new Promise((r) => setTimeout(r, 400));
    return DEMO_TRANSCRIPT;
  },
};

// ---------- notifications ----------

/**
 * Nothing is sent: each channel logs the message it would get. A demo office starts with every chat app set up (fake
 * addresses in demo-secrets.json), so a needs-human PR shows one line per channel; an address containing "bad" fails.
 */
const demoNotify: NotifyTransport = {
  demoWebhooks: {
    ntfy: { url: 'https://ntfy.sh/cubefarm-demo-office' },
  },
  post: async ({ channel, url, text }) => {
    const ok = !/bad/i.test(url);
    console.log(`🔔 demo ${channel}${ok ? '' : ' (fails: "bad" address)'} would get: ${text.replace(/\n/g, ' ⏎ ')}`);
    return ok ? 200 : 404;
  },
};

// ---------- weather ----------

/** A weather word in the demo's city ("Rainytown", "Snow Hill") picks that weather: these WMO codes. */
const DEMO_SKIES: [RegExp, number][] = [
  [/storm|thunder/i, 95],
  [/snow/i, 75],
  [/fog|mist/i, 45],
  [/heavy|pour/i, 65],
  [/rain|drizzle/i, 61],
  [/cloud|grey|gray/i, 3],
  [/sun|clear/i, 0],
];
/** Any other city gets these in turn, a new one every 15 minutes. */
const DEMO_ROTATION = [0, 2, 61, 3, 45, 63, 95, 1, 71];
const demoPlaces = new Map<string, { code: number | null; offline: boolean }>();

/**
 * No network: any city is found ("Atlantis" and "Nowhere" aren't), at made-up coordinates. A weather word in its name
 * picks the weather; "offline" in it makes every reading fail, to see the office fall back to the calm cycle.
 */
const demoWeather: WeatherApi = {
  geocode: async (city) => {
    await new Promise((r) => setTimeout(r, 200));
    if (/atlantis|nowhere/i.test(city)) return null;
    const h = [...city.toLowerCase()].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const lat = Math.round(((h % 12000) / 100 - 60) * 100) / 100;
    const lon = Math.round((((h >>> 8) % 34000) / 100 - 170) * 100) / 100;
    demoPlaces.set(`${lat},${lon}`, { code: DEMO_SKIES.find(([re]) => re.test(city))?.[1] ?? null, offline: /offline/i.test(city) });
    return { name: `${city} (demo)`, lat, lon };
  },
  current: async (lat, lon) => {
    const p = demoPlaces.get(`${lat},${lon}`);
    if (p?.offline) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    if (p?.code != null) return { code: p.code, wind: p.code === 95 ? 55 : 12 };
    const slot = Math.floor(Date.now() / (15 * 60_000)) + Math.abs(Math.round(lat + lon));
    return { code: DEMO_ROTATION[slot % DEMO_ROTATION.length], wind: 10 };
  },
};

// ---------- cloud agents ----------

/** The repo a cloud agent's desk in its Box is for (/workspace/home/work/<owner>__<repo>). */
function boxDeskRepo(cwd: string): string | null {
  const m = cwd.match(/\/work\/([\w.-]+)__([\w.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * A fake Upstash account (docs/cloud.md): any key opens it, and its Boxes are created, set up, paused and deleted
 * with a little delay, so a demo office shows cloud agents' Boxes coming up. Their sessions are the demo's fake ones.
 * A new Box's coding agents aren't signed in (`logins`: Box id -> the CLIs signed in there) until the fake sign-in.
 */
function demoBoxes(logins: Map<string, Set<string>>): BoxApi {
  const boxes = new Map<string, BoxInfo>();
  const installed = new Set<string>();
  let seq = 0;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const box = (id: string) => {
    const b = boxes.get(id);
    if (!b) throw new CloudError('That Box is gone.', 'gone');
    return b;
  };
  return {
    list: async () => [...boxes.values()].map((b) => ({ ...b })),
    create: async (o) => {
      await wait(2500);
      const b: BoxInfo = { id: `demo-box-${++seq}`, name: o.name, labels: o.labels, status: 'running' };
      boxes.set(b.id, b);
      return { ...b };
    },
    get: async (id) => (boxes.has(id) ? { ...boxes.get(id)! } : null),
    resume: async (id) => {
      await wait(800);
      box(id).status = 'running';
    },
    pause: async (id) => {
      box(id).status = 'paused';
    },
    remove: async (id) => {
      boxes.delete(id);
      logins.delete(id);
    },
    run: async (id, script) => {
      box(id).status = 'running';
      const cli = /claude'? auth /.test(script) ? 'claude' : 'codex';
      if (script.includes('CUBEFARM_SIGNED_IN')) return { code: 0, output: logins.get(id)?.has(cli) ? 'CUBEFARM_SIGNED_IN' : 'CUBEFARM_SIGNED_OUT' };
      if (/auth logout|' logout/.test(script)) {
        logins.get(id)?.delete(cli);
        return { code: 0, output: '' };
      }
      if (script.includes('CUBEFARM_SETUP_OK')) {
        await wait(3500);
        return { code: 0, output: 'CUBEFARM_SETUP_OK' };
      }
      if (script.includes('git worktree add')) {
        await wait(900);
        return { code: 0, output: '' };
      }
      if (script.includes('DEPS_')) {
        if (installed.has(id)) return { code: 0, output: 'DEPS_SKIPPED' };
        if (!script.includes('npm ci')) return { code: 0, output: 'DEPS_STALE' };
        await wait(1500);
        installed.add(id);
        return { code: 0, output: 'DEPS_INSTALLED' };
      }
      return { code: 0, output: script.includes('leftovers.patch') ? 'NONE' : '' };
    },
    read: async () => null,
    write: async () => undefined,
    files: async () => [],
    session: async () => {
      throw new CloudError("The demo's Boxes have no terminals: its sessions are fake.", 'other');
    },
    browser: async () => true,
  };
}

/**
 * The demo's cloud: one fake account and gh login, nothing to pick up after a restart. No Claude token or keys, so
 * each cloud agent signs in in their terminal (demoSignIn), and expireSignIns signs every Box out again.
 */
function demoCloud(): CloudBackend {
  const logins = new Map<string, Set<string>>();
  const account = demoBoxes(logins);
  return {
    boxes: () => account,
    env: () => ({}),
    ghToken: async () => 'demo-github-token-0000',
    gitIdentity: async (login) => ({ name: login ?? 'Demo Manager', email: 'demo@example.com' }),
    reconnect: async () => [], // fake sessions end with the office
    detach: () => undefined,
    signIn: (o, exited) => demoSignIn(o, logins, exited),
    expireSignIns: () => {
      const ours = new Set(logins.keys());
      logins.clear();
      for (const s of [...signOuts.values()]) if (ours.has(s.boxId)) s.end();
    },
  };
}

/** Where the demo's sign-ins send the manager: nowhere real. */
const DEMO_SIGN_IN = { claude: 'https://example.com/cubefarm-demo/claude-sign-in', codex: 'https://example.com/cubefarm-demo/codex-device' };

/**
 * The demo's sign-in in a cloud agent's terminal, drawn as each CLI's own one looks, with a made-up link: Enter (after
 * pasting anything, for Claude Code) finishes it, and the fake account remembers the Box as signed in.
 */
function demoSignIn(o: { boxId: string; cli: 'claude' | 'codex'; term: AgentTerminal }, logins: Map<string, Set<string>>, exited: (code: number) => void): BoxSignIn {
  const { term } = o;
  const claude = o.cli === 'claude';
  term.note(`── Signing ${claude ? 'Claude Code' : 'Codex'} in${o.boxId === 'accounts' ? '' : ' · ☁ cloud machine'} (demo) ──`);
  term.write(
    (claude
      ? ['Opening browser to sign in…', `If the browser didn't open, visit: ${DEMO_SIGN_IN.claude}`, '', '\x1b[2m(demo) Paste anything and press Enter.\x1b[0m', 'Paste code here if prompted > ']
      : [
          'Welcome to Codex (demo)',
          '',
          'Follow these steps to sign in with ChatGPT using device code authorization:',
          '',
          '1. Open this link in your browser and sign in to your account',
          `   ${DEMO_SIGN_IN.codex}`,
          '',
          '2. Enter this one-time code (expires in 15 minutes)',
          '   DEMO-0000',
          '',
          '\x1b[2m(demo) Press Enter here once you have.\x1b[0m',
        ]
    ).join('\r\n'),
  );
  let line = '';
  let over = false;
  const close = () => {
    over = true;
    term.bind(null);
  };
  term.bind({
    write: (data) => {
      for (const ch of data.replace(/\x1b\[[0-9;?]*[A-Za-z~]|\x1b./g, '')) {
        if (over) return;
        if (ch === '\r') {
          if (claude && !line.trim()) continue;
          term.write(`\r\n\x1b[32m${claude ? 'Login successful.' : 'Successfully logged in'}\x1b[0m\r\n`);
          const set = logins.get(o.boxId) ?? new Set<string>();
          set.add(o.cli);
          logins.set(o.boxId, set);
          close();
          exited(0);
        } else if (ch === '\x7f' || ch === '\b') line = line.slice(0, -1);
        else if (ch >= ' ') line += ch; // never echoed, as the real prompt doesn't
      }
    },
    resize: () => undefined,
  });
  return {
    stop: () => {
      if (over) return;
      close();
      term.note('── sign-in closed ──');
    },
  };
}
