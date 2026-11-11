// Live leases (#398, the practices' `liveLeases` switch): the files each building or fixing agent's worktree really
// changed, read on a throttled timer, and the nudges they lead to: "merge main now" when the default branch moved onto
// files an agent is editing, and a heads-up to the later of two agents changing one file before either has a PR.
// Pure; the office's side is server/swarm/liveLeases.ts.
import { normPath, overlap } from './practices.ts';

/** How often a busy agent's worktree is read. */
export const LIVE_EVERY_MS = 150_000;
const MAX_FILES = 200;

/** `git diff --name-only` and `git ls-files --others` outputs as lease paths. */
export function diffNames(...outs: string[]): string[] {
  const files = outs.flatMap((o) => o.split(/\r?\n/)).map(normPath).filter(Boolean);
  return [...new Set(files)].slice(0, MAX_FILES);
}

/** An agent as the timer sees them: building or fixing (busy), with the switch on, on this computer. */
export interface LiveAgent {
  id: string;
  busy: boolean;
  on: boolean;
  local: boolean;
}

/** The agents whose worktree is due a read: busy, local, switch on, last read at least `every` ago. */
export function dueDiffs(agents: LiveAgent[], last: ReadonlyMap<string, number>, now: number, every: number): string[] {
  return agents.filter((a) => a.on && a.busy && a.local && now - (last.get(a.id) ?? -Infinity) >= every).map((a) => a.id);
}

/**
 * After the default branch moved to `head`: the in-flight branches whose files it changed since they left it
 * (`mainFiles`, null when unknown), each told once per main SHA, none while their PR is with QA.
 */
export function mainNudges(branches: { agentId: string; files: string[]; mainFiles: string[] | null; inQa: boolean }[], head: string, told: ReadonlyMap<string, string>): { agentId: string; files: string[] }[] {
  return branches
    .filter((b) => !b.inQa && b.mainFiles && told.get(b.agentId) !== head)
    .map((b) => ({ agentId: b.agentId, files: overlap(b.files, b.mainFiles!) }))
    .filter((n) => n.files.length);
}

/**
 * Two in-flight worktrees changing one file, neither with a PR: the agent who started later hears who else is on it,
 * once per pair (`told` holds "later>earlier" keys). Nobody is held back.
 */
export function pairNudges(work: { agentId: string; startedAt: number; files: string[]; pr: number | null }[], told: ReadonlySet<string>): { agentId: string; others: string[]; files: string[]; keys: string[] }[] {
  const open = work.filter((w) => w.pr === null && w.files.length);
  const later = (a: (typeof open)[number], b: (typeof open)[number]) => a.startedAt > b.startedAt || (a.startedAt === b.startedAt && a.agentId > b.agentId);
  const out: { agentId: string; others: string[]; files: string[]; keys: string[] }[] = [];
  for (const w of open) {
    const hits = open.filter((o) => o !== w && later(w, o) && !told.has(`${w.agentId}>${o.agentId}`)).map((o) => ({ o, files: overlap(w.files, o.files) })).filter((h) => h.files.length);
    if (!hits.length) continue;
    out.push({ agentId: w.agentId, others: hits.map((h) => h.o.agentId), files: [...new Set(hits.flatMap((h) => h.files))], keys: hits.map((h) => `${w.agentId}>${h.o.agentId}`) });
  }
  return out;
}

const fileList = (files: string[]) => (files.length > 3 ? `${files.slice(0, 3).join(', ')} and ${files.length - 3} more` : files.join(', '));

/** The line on the agent's card. */
export function nudgeNote(kind: 'main' | 'pair', files: string[], who = ''): string {
  return kind === 'main' ? `Told to merge main: ${fileList(files)}` : `Shares ${fileList(files)} with ${who}`;
}

/** The message the agent gets in their session. */
export function nudgeText(kind: 'main' | 'pair', files: string[], base: string, who = ''): string {
  return kind === 'main'
    ? `${base} moved and changed files you are editing: ${fileList(files)}. Merge the latest ${base} now (git fetch origin && git merge origin/${base}) and keep both sides.`
    : `${who} is also changing ${fileList(files)} and neither of you has a PR yet. Keep your change there small, and merge ${base} once theirs lands.`;
}
