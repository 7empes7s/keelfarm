// Version-control practices for a swarm of agents (#24), each a switch that is off until the lab (#23) proves it:
// up to date before merge, file leases in scheduling, auto-rebase of conflicting PRs, generated and append-only files,
// and a small-PR budget. Settings → Every project holds the office's defaults; a floor overrides any of them, and an
// experiment's variant overrides both for the issues it covers. Pure, shared by the server and the settings.

/** The switches. All off (PRACTICES_OFF) is the office as it was before them. */
export interface Practices {
  upToDate: boolean; // before auto-merge, bring the PR up to date with the base and wait for CI on that result
  leases: boolean; // agents declare the files they expect to touch; the scheduler holds back issues that overlap
  autoRebase: boolean; // an open PR that conflicts after the base moves goes to a developer to update before QA
  generated: string[]; // files agents regenerate instead of hand-merging (e.g. docs/coverage.md)
  appendOnly: string[]; // append-only logs: on a conflict keep both sides' entries (e.g. STATE.md)
  diffBudget: number; // lines added + deleted a PR should stay under; over it the builder says why or splits it; 0: none
}

/** A floor's (or a variant's) changes to the defaults: only the switches it sets. */
export type PracticeOverrides = Partial<Practices>;

/** Settings → Every project: what every floor inherits unless it overrides it. */
export interface EveryProject {
  practices: Practices;
  playbook: string; // a playbook snippet in every floor's prompts, before the floor's own playbook
}

export const PRACTICES_OFF: Practices = { upToDate: false, leases: false, autoRebase: false, generated: [], appendOnly: [], diffBudget: 0 };

export const emptyEveryProject = (): EveryProject => ({ practices: { ...PRACTICES_OFF }, playbook: '' });

/** The longest Every project's playbook snippet may be: it is in every agent's prompt on every floor. */
export const EVERY_PLAYBOOK_MAX = 1500;
const MAX_FILES = 30;
const MAX_BUDGET = 100_000;

const KEYS = Object.keys(PRACTICES_OFF) as (keyof Practices)[];

/** A path as leases compare it: forward slashes, no leading ./ or /, no trailing glob. */
export function normPath(p: string): string {
  return p
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/\*\*?$/, '/')
    .replace(/\/{2,}/g, '/');
}

const fileList = (raw: unknown, what: string): string[] => {
  if (!Array.isArray(raw)) throw new Error(`${what} must be a list of file paths`);
  const out = raw.filter((f): f is string => typeof f === 'string').map(normPath).filter((f) => f && f.length <= 200 && !f.split('/').includes('..'));
  return [...new Set(out)].slice(0, MAX_FILES);
};

/** Overrides as the manager's form, a floor patch or a variant gives them, checked: unknown keys dropped, wrong values refused. */
export function cleanOverrides(raw: unknown): PracticeOverrides {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('practices must be an object of switches');
  const r = raw as Record<string, unknown>;
  const out: PracticeOverrides = {};
  for (const k of ['upToDate', 'leases', 'autoRebase'] as const) {
    if (r[k] === undefined || r[k] === null) continue;
    if (typeof r[k] !== 'boolean') throw new Error(`${k} must be true or false`);
    out[k] = r[k];
  }
  if (r.generated !== undefined && r.generated !== null) out.generated = fileList(r.generated, 'generated');
  if (r.appendOnly !== undefined && r.appendOnly !== null) out.appendOnly = fileList(r.appendOnly, 'appendOnly');
  if (r.diffBudget !== undefined && r.diffBudget !== null) {
    const n = Math.round(Number(r.diffBudget));
    if (!Number.isFinite(n) || n < 0) throw new Error('diffBudget must be a number of lines (0 for none)');
    out.diffBudget = Math.min(MAX_BUDGET, n);
  }
  return out;
}

/** Every project's settings after a patch from Settings. */
export function everyProjectSettings(prev: EveryProject | undefined, patch: unknown): EveryProject {
  const base = prev ?? emptyEveryProject();
  const p = (patch ?? {}) as { practices?: unknown; playbook?: unknown };
  return {
    practices: { ...PRACTICES_OFF, ...base.practices, ...cleanOverrides(p.practices) },
    playbook: typeof p.playbook === 'string' ? p.playbook.trim().slice(0, EVERY_PLAYBOOK_MAX) : base.playbook,
  };
}

/** A floor's overrides after a patch: a switch set to null goes back to inheriting Every project's. */
export function floorOverrides(prev: PracticeOverrides | undefined, patch: unknown): PracticeOverrides {
  const out: PracticeOverrides = { ...prev, ...cleanOverrides(patch) };
  const p = (patch ?? {}) as Record<string, unknown>;
  for (const k of KEYS) if (p[k] === null) delete out[k];
  return out;
}

/** What a floor runs with: a variant's overrides win over the floor's, which win over Every project's. */
export function effectivePractices(office: Practices | undefined, floor?: PracticeOverrides, variant?: PracticeOverrides): Practices {
  return { ...PRACTICES_OFF, ...office, ...floor, ...variant };
}

/** What a variant's practices would change if made every project's default, in a few words. */
export function describePractices(p: PracticeOverrides): string {
  const parts: string[] = [];
  if (p.upToDate !== undefined) parts.push(`up to date before merge ${p.upToDate ? 'on' : 'off'}`);
  if (p.leases !== undefined) parts.push(`file leases ${p.leases ? 'on' : 'off'}`);
  if (p.autoRebase !== undefined) parts.push(`auto-rebase ${p.autoRebase ? 'on' : 'off'}`);
  if (p.generated?.length) parts.push(`regenerate ${p.generated.join(', ')}`);
  if (p.appendOnly?.length) parts.push(`append-only ${p.appendOnly.join(', ')}`);
  if (p.diffBudget !== undefined) parts.push(p.diffBudget ? `${p.diffBudget}-line PR budget` : 'no PR budget');
  return parts.join(' · ');
}

// ---------- up to date before merge ----------

/**
 * Where a QA-passed PR stands against its base. current: it already contains the base; update: the office brings it
 * up to date (GitHub merges the base in) and CI runs on that result; conflict: it can't be, a developer merges by hand;
 * unknown: how far behind it is wasn't asked yet.
 */
export function upToDateStep(pr: { mergeable: string; mergeState: string }, behind: number | null): 'current' | 'update' | 'conflict' | 'unknown' {
  if (pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY') return 'conflict';
  if (pr.mergeState === 'BEHIND') return 'update';
  if (behind === null) return 'unknown';
  return behind > 0 ? 'update' : 'current';
}

// ---------- file leases ----------

/** Files an issue's work is expected to touch, while it's being built or its PR is open. */
export interface Lease {
  issue: number;
  pr: number | null;
  agentId: string | null;
  files: string[];
  source: 'declared' | 'predicted' | 'pr';
}

/** A lease-blocked issue starts after this long anyway, so no issue waits forever. */
export const LEASE_WAIT_MS = 45 * 60_000;

/** Do two paths touch the same thing: the same file, or one is a folder ("server/swarm/") the other is in. */
function touches(a: string, b: string): boolean {
  if (a === b) return true;
  const dir = (x: string) => (x.endsWith('/') ? x : `${x}/`);
  return b.startsWith(dir(a)) || a.startsWith(dir(b));
}

/** The paths of `a` that overlap `b`. */
export function overlap(a: string[], b: string[]): string[] {
  return a.filter((x) => b.some((y) => touches(x, y)));
}

const PATHISH = /(?:^|[\s`'"([])((?:[\w.@-]+\/)*[\w@-][\w.@-]*\.[a-z][a-z0-9]{0,5}|(?:[\w.@-]+\/)+)(?=\.?(?:$|[\s`'",;:)\]!?]))/gi;
const NOT_FILES = /^(e\.g|i\.e|etc|vs|no|n\.b)\.?$|^\d+(\.\d+)+$|^https?:|\.(com|org|io|net|dev|ai)$/i;

/**
 * The files an issue names, as the floor knows them: paths in its text ("server/swarm.ts", `Phone.tsx`, "docs/"), and
 * bare file names resolved to the paths the floor's PRs and history use (`known`). Only names that look like files.
 */
export function predictFiles(text: string, known: string[] = []): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PATHISH)) {
    const raw = m[1].replace(/[.,]+$/, '');
    if (NOT_FILES.test(raw) || raw.length > 200) continue;
    const p = normPath(raw);
    if (!p || p === '/') continue;
    if (p.includes('/')) {
      out.add(p);
      continue;
    }
    const full = known.filter((k) => k === p || k.endsWith(`/${p}`));
    if (full.length) for (const f of full) out.add(f);
    else out.add(p);
  }
  return [...out].slice(0, MAX_FILES);
}

/** A lease against a path from another issue: a bare file name ("Phone.tsx") matches that file in any folder. */
function leaseOverlap(files: string[], lease: string[]): string[] {
  return files.filter((f) => lease.some((l) => touches(f, l) || (!f.includes('/') && l.endsWith(`/${f}`)) || (!l.includes('/') && f.endsWith(`/${l}`))));
}

/**
 * The floor's leases now: each agent building or fixing an issue (the files they declared, else those predicted from
 * the issue) and each open PR (the files it changes). One lease per issue, its files merged. A lease ends on its own
 * when the agent stops and the PR merges or closes: what isn't listed here any more holds nothing.
 */
export function floorLeases(work: { agentId: string; issue: number; pr: number | null; declared: string[] | null; predicted: string[] }[], pulls: { number: number; issues: number[]; files: string[] }[]): Lease[] {
  const byIssue = new Map<number, Lease>();
  const add = (l: Lease) => {
    const had = byIssue.get(l.issue);
    if (!had) return void byIssue.set(l.issue, { ...l, files: [...new Set(l.files)] });
    had.files = [...new Set([...had.files, ...l.files])];
    had.pr ??= l.pr;
    had.agentId ??= l.agentId;
    if (l.source === 'declared' || (l.source === 'pr' && had.source === 'predicted')) had.source = l.source;
  };
  for (const w of work) add({ issue: w.issue, pr: w.pr, agentId: w.agentId, files: w.declared ?? w.predicted, source: w.declared ? 'declared' : 'predicted' });
  for (const p of pulls) for (const issue of p.issues.length ? p.issues : [-p.number]) add({ issue, pr: p.number, agentId: null, files: p.files, source: 'pr' });
  return [...byIssue.values()].filter((l) => l.files.length);
}

/** Why an issue is held back: the issue (or PR) whose lease it overlaps, and on which files. */
export interface LeaseHold {
  issue: number;
  by: { issue: number; pr: number | null };
  files: string[];
  since: number;
}

/**
 * The next issue to start, in the order given (readyIssues' urgency): the first one that has leases off (`on`, its
 * floor's or its variant's switch) or whose predicted files overlap no lease; when every one left overlaps, the first
 * held back for LEASE_WAIT_MS (it starts anyway rather than starve), else none. With leases off everywhere, the first.
 * `heldSince`: when each issue was first held back.
 */
export function chooseIssue(
  ready: { number: number; files: string[]; on: boolean }[],
  leases: Lease[],
  o: { now: number; heldSince: ReadonlyMap<number, number> },
): { pick: number | null; held: LeaseHold[] } {
  const held: LeaseHold[] = [];
  let pick: number | null = null;
  for (const r of ready) {
    const hit = r.on ? leases.find((l) => l.issue !== r.number && leaseOverlap(r.files, l.files).length) : undefined;
    if (!hit) {
      pick ??= r.number;
      continue;
    }
    held.push({ issue: r.number, by: { issue: hit.issue, pr: hit.pr }, files: leaseOverlap(r.files, hit.files), since: o.heldSince.get(r.number) ?? o.now });
  }
  pick ??= held.find((h) => o.now - h.since >= LEASE_WAIT_MS)?.issue ?? null;
  return { pick, held: held.filter((h) => h.issue !== pick) };
}

// ---------- hot files ----------

/** A commit as the hot-file ranking reads it: its subject and the files it changed. */
export interface FileCommit {
  subject: string;
  files: string[];
}

const CONFLICT_FIX = /\b(merge (branch|remote-tracking branch) '?[\w/.-]*'? into|resolv\w* (the )?(merge )?conflicts?|fix\w* (the )?(merge )?conflicts?|conflicts? (with|on) (main|master))\b/i;

/**
 * The files most often conflicted, from the default branch's history: a commit that merged the base into a branch or
 * resolved conflicts counts 3 for each file it touched, any other commit 1. The top `n` with a score of at least 4.
 */
export function hotFiles(log: FileCommit[], n = 8): { path: string; score: number; conflicts: number }[] {
  const score = new Map<string, { score: number; conflicts: number }>();
  for (const c of log) {
    const conflict = CONFLICT_FIX.test(c.subject);
    for (const f of new Set(c.files.map(normPath).filter(Boolean))) {
      const s = score.get(f) ?? { score: 0, conflicts: 0 };
      s.score += conflict ? 3 : 1;
      if (conflict) s.conflicts++;
      score.set(f, s);
    }
  }
  return [...score]
    .map(([path, s]) => ({ path, ...s }))
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.conflicts - a.conflicts || b.score - a.score || (a.path < b.path ? -1 : 1))
    .slice(0, n);
}

// ---------- auto-rebase ----------

/**
 * Open swarm PRs that conflict with the base while waiting for QA or for their merge: each goes to its developer (or
 * the next free one) to bring it up to date now, rather than to a tester or the merge gate first. Nothing when off.
 */
export function rebaseHandOffs(pulls: { number: number; state: string; headRefName: string; mergeable: string; mergeState: string }[], records: { prNumber: number; status: string }[], on: boolean): number[] {
  if (!on) return [];
  return records
    .filter((r) => r.status === 'queued' || r.status === 'passed')
    .filter((r) => {
      const p = pulls.find((x) => x.number === r.prNumber && x.state === 'OPEN');
      return !!p && p.headRefName.startsWith('swarm/') && (p.mergeable === 'CONFLICTING' || p.mergeState === 'DIRTY');
    })
    .map((r) => r.prNumber);
}

// ---------- what agents are told ----------

/** The prompt lines a floor's practices add to build and fix sessions; none with every switch off. */
export function practiceLines(p: Practices, o: { base: string; declareTool: boolean }): string[] {
  const out: string[] = [];
  if (p.leases && o.declareTool) out.push('Before anything else, call the office tool declare_files with the files or folders you expect to touch (call it again if that changes): the office keeps teammates off them.');
  if (p.generated.length) out.push(`Generated files: ${p.generated.join(', ')}. Never hand-merge them: on a conflict take origin/${o.base}'s version and regenerate them.`);
  if (p.appendOnly.length) out.push(`Append-only files: ${p.appendOnly.join(', ')}. Only add entries; on a conflict keep both sides' entries.`);
  if (p.diffBudget) out.push(`Diff budget: ${p.diffBudget} lines (added + deleted). Over it, split the work or say why under "Why this is big" in the PR.`);
  return out;
}

/** The line a floor's diff budget adds to QA sessions; none without one. */
export function qaPracticeLines(p: Practices): string[] {
  return p.diffBudget ? [`This floor's diff budget is ${p.diffBudget} lines (added + deleted): a PR over it must say why in its description, else fail it and ask for a split.`] : [];
}
