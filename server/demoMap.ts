// The demo's past for the memory map (#136): each floor's merged PRs of the last weeks, with the files they changed, so
// a fresh demo office has history to look at (hot files, the time slider), and the files its fake PRs change.
import type { IssueInfo, PullInfo } from '../shared/types.ts';

/** A merged PR of a demo floor's past: its title, files, and how many days ago it merged. */
interface PastWork {
  title: string;
  files: string[];
  days: number;
}

const PAST: Record<string, PastWork[]> = {
  'pixel-todo': [
    { title: 'Set up Vite + React', files: ['package.json', 'vite.config.ts', 'src/main.tsx', 'src/App.tsx'], days: 20 },
    { title: 'A todo list', files: ['src/App.tsx', 'src/todos.ts', 'src/todos.test.ts'], days: 16 },
    { title: 'Keep todos in localStorage', files: ['src/todos.ts', 'src/storage.ts'], days: 11 },
    { title: 'A cheerful theme', files: ['src/styles.css', 'src/App.tsx'], days: 6 },
    { title: 'Mark todos done', files: ['src/App.tsx', 'src/todos.ts', 'src/todos.test.ts'], days: 2 },
  ],
  'weather-api': [
    { title: 'Express skeleton', files: ['package.json', 'src/server.ts'], days: 18 },
    { title: 'GET /weather for a city', files: ['src/server.ts', 'src/routes/weather.ts', 'src/routes/weather.test.ts'], days: 12 },
    { title: 'Cache upstream answers', files: ['src/cache.ts', 'src/routes/weather.ts'], days: 5 },
  ],
  'recipe-box': [
    { title: 'Recipe model and seed data', files: ['src/recipe.ts', 'src/data.json'], days: 9 },
    { title: 'The recipe page', files: ['src/App.tsx', 'src/recipe.ts', 'src/styles.css'], days: 4 },
  ],
};

// What a fake PR changes when its issue names no file.
const POOL: Record<string, string[]> = {
  'pixel-todo': ['src/App.tsx', 'src/todos.ts', 'src/styles.css', 'src/todos.test.ts'],
  'weather-api': ['src/server.ts', 'src/routes/weather.ts', 'src/cache.ts'],
  'recipe-box': ['src/recipe.ts', 'src/App.tsx', 'src/list.ts'],
};

const DAY = 86_400_000;
const name = (fullName: string) => fullName.split('/')[1] ?? fullName;

/** A demo floor's merged past, newest first: a closed issue and its PR each, numbered by `take`. */
export function pastPulls(fullName: string, take: () => number, now = Date.now()): PullInfo[] {
  return (PAST[name(fullName)] ?? [])
    .map((w, i) => {
      const issue = take();
      const n = take();
      const merged = now - w.days * DAY;
      const opened = merged - (3 + i) * 3_600_000;
      const pr: PullInfo = {
        number: n,
        title: w.title,
        url: `https://github.com/${fullName}/pull/${n}`,
        headRefName: `swarm/issue-${issue}-demo`,
        state: 'MERGED',
        isDraft: false,
        mergeable: 'MERGEABLE',
        reviewDecision: null,
        closesIssues: [issue],
        createdAt: new Date(opened).toISOString(),
        mergedAt: new Date(merged).toISOString(),
        additions: 30 + w.files.length * 25,
        deletions: 4 * w.files.length,
        checks: 'passing',
        headSha: `past${issue}`,
        mergeState: 'CLEAN',
        failedChecks: [],
        pendingChecks: [],
        issueCreatedAt: new Date(opened - DAY).toISOString(),
        files: w.files,
      };
      return pr;
    })
    .reverse();
}

/** The files a fake PR for this issue changes: the ones its body names, else two from the floor's usual ones. */
export function demoPrFiles(fullName: string, issue: Pick<IssueInfo, 'number' | 'body'> | undefined, n: number): string[] {
  const named = [...new Set((issue?.body ?? '').match(/\b[\w/-]+\.(?:tsx?|css|json|md)\b/g) ?? [])];
  if (named.length) return named;
  const pool = POOL[name(fullName)] ?? ['src/App.tsx', 'src/index.ts', 'README.md'];
  return [pool[n % pool.length], pool[(n + 1) % pool.length]];
}
