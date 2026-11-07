// The demo's code reads for the CEO's pr_diff and worktree_file: made-up changes, since the demo has no code on disk.
import type { Backend } from './backend.ts';
import type { DemoFloor } from './demo.ts';
import type { PrDiff } from './github.ts';
import { guardPath, type WorktreeRead } from './worktreeRead.ts';

/** A small made-up diff for the CEO's pr_diff and worktree_file. */
const demoDiff = (what: string) =>
  [
    'diff --git a/src/App.tsx b/src/App.tsx',
    '--- a/src/App.tsx',
    '+++ b/src/App.tsx',
    '@@ -12,6 +12,14 @@ export function App() {',
    `+  // ${what}`,
    "+  const [ready, setReady] = useState(false);",
    '+  useEffect(() => setReady(true), []);',
    '   return (',
  ].join('\n');

/** A fake PR's diff: src/App.tsx and a file named after its title, sized from its additions and deletions. */
export function demoPrDiff(pr: { title: string; additions: number; deletions: number }, patch: boolean): PrDiff {
  const name = pr.title.toLowerCase().replace(/^fix:\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 2).join('-') || 'feature';
  const files = [
    { path: 'src/App.tsx', additions: Math.ceil(pr.additions * 0.6), deletions: Math.ceil(pr.deletions * 0.5) },
    { path: `src/${name}.tsx`, additions: Math.floor(pr.additions * 0.4), deletions: Math.floor(pr.deletions * 0.5) },
  ];
  // A visual feature changes the 3D office's code too, so its QA takes a full-quality pass (#301).
  if (/confetti|illustration/i.test(pr.title)) files.push({ path: `client/src/world/${name}.tsx`, additions: 12, deletions: 2 });
  return { files, diff: patch ? demoDiff(pr.title) : null };
}

// ---------- version-control practices (#24) ----------

/** Merges into main since each open PR's head was made. By head commit: an update or a fix push is a new head, up to date. */
const behind = new Map<string, number>();

/** A merge into main: every open PR falls one more commit behind it. */
export function demoMerged(pulls: { state: string; headSha: string }[]) {
  for (const p of pulls) if (p.state === 'OPEN') behind.set(p.headSha, (behind.get(p.headSha) ?? 0) + 1);
}

/** The demo's Backend methods for the practices: how far a PR is behind main, and the floor's history for hot files. */
export const demoPractices: Pick<Backend, 'behindBy' | 'fileHistory'> = {
  behindBy: async (_fullName, _base, headSha) => behind.get(headSha) ?? 0,
  fileHistory: async () => demoFileHistory(),
};

/** A made-up history for a demo floor's hot files: App.tsx and the changelog conflict most. */
function demoFileHistory(): { subject: string; files: string[] }[] {
  const merge = (n: number) => ({ subject: `Merge branch 'main' into swarm/issue-${n}-ana`, files: ['src/App.tsx', 'CHANGELOG.md'] });
  return [merge(3), merge(5), { subject: 'Resolve conflicts with main', files: ['src/App.tsx', 'src/styles.css'] }, merge(8), { subject: 'Add tests', files: ['src/App.test.tsx'] }, { subject: 'Polish styles', files: ['src/styles.css'] }, { subject: 'Tweak styles', files: ['src/styles.css'] }];
}

export function demoReadWorktree(r: WorktreeRead): string {
  if (r.mode === 'file') return `// ${guardPath(r.path ?? '')} (demo: a made-up file)\nexport function feature() {\n  return 'works';\n}\n`;
  return r.mode === 'diff_stat' ? ' src/App.tsx      | 24 +++++++++++++-----\n src/App.test.tsx | 12 ++++++++\n 2 files changed, 31 insertions(+), 5 deletions(-)' : demoDiff('the change');
}

/** The files every demo floor has, for the chat's file refs (shared/chatRefs.ts). */
const DEMO_REF_FILES = ['src/App.tsx', 'README.md'];

/** A demo floor's file: made up from its path, or null for one it doesn't have. */
export function demoRepoFile(fullName: string, rel: string): string | null {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (p === 'README.md') return [`# ${fullName.split('/')[1]}`, '', 'A demo project: the office makes up its files.', '', '## Run it', '', '```bash', 'npm install', 'npm run dev', '```', ''].join('\n');
  if (p !== 'src/App.tsx') return null;
  return [
    "import { useEffect, useState } from 'react';",
    "import { Board } from './Board';",
    '',
    '// The app shell: loads the board, then shows it.',
    'export function App() {',
    '  const [ready, setReady] = useState(false);',
    '  const [count, setCount] = useState(0);',
    '  useEffect(() => setReady(true), []);',
    '',
    "  if (!ready) return <p className=\"muted\">Loading…</p>;",
    '  return (',
    '    <main>',
    `      <h1>${fullName}</h1>`,
    '      <Board onMove={() => setCount((n) => n + 1)} />',
    '      <p>{count} moves</p>',
    '    </main>',
    '  );',
    '}',
    '',
  ].join('\n');
}

/** The demo CEO's pointers into the office: every kind of chat ref (shared/chatRefs.ts) the busiest floor has. */
export function demoRefsLine(floors: readonly DemoFloor[]): string {
  const f = [...floors].sort((a, b) => b.pullRequests.length - a.pullRequests.length || b.backlog.length - a.backlog.length)[0];
  if (!f) return '';
  const who = f.agents?.[0]?.name;
  const pr = f.pullRequests[0]?.number;
  const issue = f.backlog[0]?.number;
  return [
    `Around the office: floor ${f.floor}`,
    who && `@${who} (watch @${who}/terminal)`,
    issue && `#${issue} is next`,
    `the app starts in file: floor ${f.floor} ${DEMO_REF_FILES[0]}:5`,
    pr ? `PR floor ${f.floor} #${pr} has qa: floor ${f.floor} #${pr} and preview: floor ${f.floor} #${pr}` : '',
    `and main runs at preview: floor ${f.floor}.`,
  ]
    .filter(Boolean)
    .join(', ');
}
