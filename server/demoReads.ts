// The demo's code reads for the CEO's pr_diff and worktree_file: made-up changes, since the demo has no code on disk.
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
  return { files, diff: patch ? demoDiff(pr.title) : null };
}

/** A made-up history for a demo floor's hot files: App.tsx and the changelog conflict most. */
export function demoFileHistory(): { subject: string; files: string[] }[] {
  const merge = (n: number) => ({ subject: `Merge branch 'main' into swarm/issue-${n}-ana`, files: ['src/App.tsx', 'CHANGELOG.md'] });
  return [merge(3), merge(5), { subject: 'Resolve conflicts with main', files: ['src/App.tsx', 'src/styles.css'] }, merge(8), { subject: 'Add tests', files: ['src/App.test.tsx'] }, { subject: 'Polish styles', files: ['src/styles.css'] }, { subject: 'Tweak styles', files: ['src/styles.css'] }];
}

export function demoReadWorktree(r: WorktreeRead): string {
  if (r.mode === 'file') return `// ${guardPath(r.path ?? '')} (demo: a made-up file)\nexport function feature() {\n  return 'works';\n}\n`;
  return r.mode === 'diff_stat' ? ' src/App.tsx      | 24 +++++++++++++-----\n src/App.test.tsx | 12 ++++++++\n 2 files changed, 31 insertions(+), 5 deletions(-)' : demoDiff('the change');
}
