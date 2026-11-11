// The demo's repos as a fresh office finds them (#257): three floors with backlogs, recent merges, a stranger's issue
// and PR, a CI outage and a CI-only stuck PR; or the big company (--floors / --agents).
import { FLOOR_SEATS, type PullInfo } from '../../shared/types.ts';
import type { DemoScale } from '../config.ts';
import { demoTryIt, pastPulls } from '../demoMap.ts';
import { tryItSteps } from '../../shared/tryIt.ts';
import { stalePulls } from '../demoPreviewDesks.ts';
import { CI_DOWN_REPO, closedFiled, fakeSha, issue, nextRunId, refusedChecks, repos, type FakeRepo } from './world.ts';

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
export const DARK_MODE_TITLE = 'Add dark mode toggle';
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
  ['Keyboard shortcuts', 'N for new todo, / to search, ? for help. The help overlay touches src/App.tsx and src/styles.css.\n\nObjective: O1'],
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
// Listed but not moved in (#366): connecting it shows the setup advisor's checklist for a three.js game.
seed('demo-co/star-hopper', 'A three.js space hopper', [['Boost pads', 'Pads that launch the ship. Touches src/level.ts.'], ['Touch controls', 'A stick and a jump button on phones.']]);
{
  const r = repos.get(CI_DOWN_REPO)!;
  const n = r.nextNumber++;
  const pr = { ...shippedPull(CI_DOWN_REPO, n, 'Recipe page on a phone', 0), state: 'OPEN' as const, mergedAt: null, headRefName: 'swarm/issue-3-demo', closesIssues: [3], summary: 'Ingredients first, then steps, laid out for a 375px phone.', tryIt: demoTryIt('Recipe page on a phone', n) };
  r.pulls.unshift(Object.assign(pr, refusedChecks(pr.url)));
}

// A PR that needs the manager only because CI is red (#209): QA passed its code, the Windows job failed.
export const CI_ONLY_REPO = 'demo-co/weather-api';
export const CI_ONLY_SUMMARY = 'QA passed: /forecast and /now answer in °F with ?units=f and the tests pass. Only the Windows CI job is red (a path in a snapshot test).';
export const CI_ONLY_PR = (() => {
  const r = repos.get(CI_ONLY_REPO)!;
  const n = r.nextNumber++;
  const url = `https://github.com/${CI_ONLY_REPO}/pull/${n}`;
  const failedChecks = [{ name: 'CI / windows', url: `https://github.com/${CI_ONLY_REPO}/actions/runs/${nextRunId()}/job/1` }];
  const files = ['src/forecast.ts', 'src/units.ts', 'src/units.test.ts', 'package.json', 'README.md'];
  r.pulls.unshift({ ...shippedPull(CI_ONLY_REPO, n, 'Forecast in °F on request', 0), url, state: 'OPEN', mergedAt: null, createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), headRefName: 'swarm/units-f-demo', summary: 'Adds ?units=f to /forecast and /now; °C stays the default.', tryIt: tryItSteps('## Try it\n1. Open `/forecast?city=Paris&units=f`.\n2. You should see every temperature in °F.\n3. Open `/forecast?city=Paris`: still °C, as before.'), additions: 86, deletions: 12, files, checks: 'failing', failedChecks });
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
export function seedBigCompany(floors: number) {
  repos.clear();
  for (let f = 0; f < floors; f++) {
    const [name, description] = PRODUCTS[f] ?? [`project-${f + 1}`, `Project number ${f + 1}`];
    seed(`demo-co/${name}`, description, []);
    topUp(repos.get(`demo-co/${name}`)!, 30);
  }
}

/** Files new issues until the repo has `open` of them, so a big floor's agents always have something to pick up. */
export function topUp(r: FakeRepo, open: number) {
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
