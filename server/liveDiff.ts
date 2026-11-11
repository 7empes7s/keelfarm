// Live leases' git reads (#398): what an agent's worktree changed since it left the default branch, and what the
// default branch changed since then, from the floor's clone. Read-only: no fetch, checkout or merge, and no optional
// index locks, so an agent's own git commands never trip over them. execFile with arg arrays (exec.ts).
import { git } from './exec.ts';
import { diffNames } from '../shared/liveLeases.ts';

const OPTS = { timeoutMs: 20_000 };
const g = (args: string[], cwd: string) => git(['--no-optional-locks', ...args], { ...OPTS, cwd });

/** An agent's worktree: the files changed since its merge-base with origin/<base>, committed or not, plus untracked ones (3 git calls). */
export async function worktreeChanges(dir: string, base: string): Promise<{ files: string[]; base: string }> {
  const from = (await g(['merge-base', 'HEAD', `origin/${base}`], dir)).trim();
  const [changed, untracked] = [await g(['diff', '--name-only', from], dir), await g(['ls-files', '--others', '--exclude-standard'], dir)];
  return { files: diffNames(changed, untracked), base: from };
}

/** The default branch's head in the floor's clone, as its last sync fetched it. */
export async function mainHead(mainDir: string, base: string): Promise<string> {
  return (await g(['rev-parse', `origin/${base}`], mainDir)).trim();
}

/** The files the default branch changed between two of its commits; null when the clone doesn't have `from`. */
export async function mainFilesSince(mainDir: string, from: string, to: string): Promise<string[] | null> {
  if (!/^[0-9a-f]{7,64}$/i.test(from) || !/^[0-9a-f]{7,64}$/i.test(to)) return null;
  const out = await g(['diff', '--name-only', from, to], mainDir).catch(() => null);
  return out === null ? null : diffNames(out);
}
