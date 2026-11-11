// The office keeps its disk healthy (#340): free space on the disks it writes to, a warning before one fills and a hold
// on new builds, QA and previews when one nearly has, the cleanup of its own leftovers (what goes, what stays and why,
// what it leaves alone outside its folders), and a second disk for agents' working copies. Pure rules, shared by the
// server (server/diskCare.ts, server/swarm/disk.ts) and the health strip and settings.
import { gb } from './health.ts';

export interface DiskSettings {
  warnPct: number; // warn when a disk has less than this share free…
  warnGb: number; // …or less than this many GB free
  holdGb: number; // below this many GB free new builds, QA and previews wait
  rearmGb: number; // after a warning, warn again only once free space was back this many GB above the warning (#502)
  keepDays: number; // agents' temp files idle this many days go in a cleanup
  cleanEveryHours: number; // the automatic cleanup's interval; 0 = only by hand
  workRoot: string; // where agents' working copies live: '' = the office folder, else a folder on another mounted disk
}

export const DEFAULT_DISK: DiskSettings = { warnPct: 15, warnGb: 10, holdGb: 5, rearmGb: 3, keepDays: 2, cleanEveryHours: 1, workRoot: '' };

const num = (raw: unknown, min: number, max: number) => (raw !== null && raw !== '' && Number.isFinite(Number(raw)) ? Math.max(min, Math.min(max, Number(raw))) : null);

/** Disk settings from a saved state or a PATCH, field by field; anything invalid keeps `base`. `workRoot` is checked apart (workRootProblem). */
export function diskSettings(base: DiskSettings, patch: unknown): DiskSettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof DiskSettings, unknown>>;
  const b = { ...DEFAULT_DISK, ...base };
  return {
    warnPct: num(p.warnPct, 0, 90) ?? b.warnPct,
    warnGb: num(p.warnGb, 0, 10_000) ?? b.warnGb,
    holdGb: num(p.holdGb, 0, 10_000) ?? b.holdGb,
    rearmGb: num(p.rearmGb, 0, 10_000) ?? b.rearmGb,
    keepDays: Math.round(num(p.keepDays, 0, 365) ?? b.keepDays),
    cleanEveryHours: Math.round(num(p.cleanEveryHours, 0, 168) ?? b.cleanEveryHours),
    workRoot: typeof p.workRoot === 'string' ? p.workRoot.trim() : b.workRoot,
  };
}

// ---------- free space ----------

/** One disk the office writes to, by what it holds ("Office data", "Temp files", "Working copies"). */
export interface DiskReading {
  label: string;
  path: string;
  totalMb: number;
  freeMb: number;
}

export type DiskLevel = 'ok' | 'warn' | 'hold';

/** The disk's state: hold below holdGb free, warn below warnGb or warnPct free, else ok. */
export function diskLevel(d: Pick<DiskReading, 'totalMb' | 'freeMb'>, s: DiskSettings): DiskLevel {
  if (d.freeMb < s.holdGb * 1024) return 'hold';
  if (d.freeMb < s.warnGb * 1024 || (d.totalMb > 0 && (d.freeMb / d.totalMb) * 100 < s.warnPct)) return 'warn';
  return 'ok';
}

/** The worst of the disks' states. */
export function worstLevel(disks: readonly DiskReading[], s: DiskSettings): DiskLevel {
  const levels = disks.map((d) => diskLevel(d, s));
  return levels.includes('hold') ? 'hold' : levels.includes('warn') ? 'warn' : 'ok';
}

/** Disks that are one and the same (same size and free space): one reading, their labels joined. */
export function uniqueDisks(disks: readonly DiskReading[]): DiskReading[] {
  const out: DiskReading[] = [];
  for (const d of disks) {
    const same = out.find((o) => Math.abs(o.totalMb - d.totalMb) <= 1 && Math.abs(o.freeMb - d.freeMb) <= 1);
    if (same) same.label = `${same.label} & ${d.label.toLowerCase()}`;
    else out.push({ ...d });
  }
  return out;
}

const HOLD_HELP = 'Free up space in Mission control, or store working copies on another disk in Settings → Agents.';

/** Why new builds, QA and previews wait for disk space now (null: they don't). */
export function diskHold(disks: readonly DiskReading[], s: DiskSettings): string | null {
  const d = disks.find((x) => diskLevel(x, s) === 'hold');
  return d ? `Waiting for disk space: ${gb(d.freeMb)} free on ${d.label.toLowerCase()} (${d.path}), below the ${s.holdGb} GB kept free. ${HOLD_HELP}` : null;
}

/** The kinds of session a disk hold stops: what writes worktrees, installs and builds. The CEO and consults carry on. */
export const DISK_HELD_KINDS: readonly string[] = ['build', 'fix', 'qa', 'preview', 'labRun', 'labBrowser'];

/** The last disk notification (#502), kept in the state file so a restart doesn't send it again. */
export interface DiskAlertMark {
  level: Exclude<DiskLevel, 'ok'>;
  at: number;
  freeMb: number;
}

/** The mark from a saved state, if it is one. */
export function loadDiskAlert(raw: unknown): DiskAlertMark | null {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Partial<DiskAlertMark>;
  return (m.level === 'warn' || m.level === 'hold') && Number.isFinite(m.at) && Number.isFinite(m.freeMb) ? { level: m.level, at: m.at!, freeMb: m.freeMb! } : null;
}

/** While a disk stays low, a reminder at most this often. */
export const DISK_REMIND_MS = 24 * 3_600_000;
/** The share of the disk free, above the warning's, that counts as recovered (rearmGb is the GB margin). */
const REARM_PCT = 2;

/** Every disk is back above the warning by the margin: the next low stretch rings again. */
function diskRecovered(disks: readonly DiskReading[], s: DiskSettings): boolean {
  return disks.every((d) => d.freeMb >= (s.warnGb + s.rearmGb) * 1024 && (d.totalMb <= 0 || (d.freeMb / d.totalMb) * 100 >= s.warnPct + REARM_PCT));
}

/**
 * Ring the manager's devices? When the disks get worse (ok → warn, warn → hold), or a reminder after DISK_REMIND_MS while
 * they stay low. Only recovering past the margin forgets the last one, so free space hovering at the line rings once.
 */
export function diskAlert(disks: readonly DiskReading[], s: DiskSettings, last: DiskAlertMark | null, now: number): { send: boolean; last: DiskAlertMark | null } {
  if (!disks.length) return { send: false, last }; // not read yet
  const level = worstLevel(disks, s);
  if (level === 'ok') return { send: false, last: last && !diskRecovered(disks, s) ? last : null };
  const worse = !last || (level === 'hold' && last.level === 'warn');
  if (!worse && now - last.at < DISK_REMIND_MS) return { send: false, last };
  return { send: true, last: { level, at: now, freeMb: Math.min(...disks.map((d) => d.freeMb)) } };
}

/** The warning's words: the fullest disk, what happens next, and what helps. */
export function diskWarning(disks: readonly DiskReading[], s: DiskSettings): { title: string; body: string } | null {
  const bad = disks.filter((d) => diskLevel(d, s) !== 'ok').sort((a, b) => a.freeMb - b.freeMb)[0];
  if (!bad) return null;
  const pct = bad.totalMb > 0 ? Math.round((bad.freeMb / bad.totalMb) * 100) : 0;
  const held = diskLevel(bad, s) === 'hold';
  return {
    title: held ? `Disk almost full: new work waits` : `Disk getting full: ${gb(bad.freeMb)} left`,
    body: `${bad.label} (${bad.path}) has ${gb(bad.freeMb)} free (${pct}%). ${held ? 'New builds, QA and previews wait until there is room; running work carries on.' : `Below ${s.holdGb} GB new builds, QA and previews wait.`} ${HOLD_HELP}`,
  };
}

/** What the health strip shows of the disks. */
export interface DiskView {
  disks: (DiskReading & { level: DiskLevel })[];
  level: DiskLevel;
  lastClean: CleanResult | null;
}

// ---------- cleanup ----------

export type CleanKind = 'machine' | 'worktree' | 'temp' | 'outside';

/** Something a cleanup removes, keeps or leaves alone, with its size and why. */
export interface CleanItem {
  id: string;
  kind: CleanKind;
  label: string;
  path: string;
  mb: number;
  why: string;
  machine?: string;
  repo?: string;
}

/** A cleanup's preview: what goes, what stays (and why), and big folders outside the office's that it never touches. */
export interface CleanPlan {
  go: CleanItem[];
  kept: CleanItem[];
  outside: CleanItem[];
  at: number;
}

export interface CleanResult {
  at: number;
  freedMb: number;
  removed: number;
  kept: number;
  failed: string[];
  auto: boolean;
}

/** One worktree of an agent's machine (work/<repo>), as the cleanup sees it. */
interface WorktreeFacts {
  repo: string;
  path: string;
  mb: number;
  branch: string | null;
  /** Commits on no remote branch, or changes not committed: never removed. */
  unpushed: boolean;
}

/** A temp entry in a machine's tmp folder (demo offices' homes, previews', browsers'). */
interface TempFacts {
  name: string;
  path: string;
  mb: number;
  ageMs: number;
}

/** An agent's machine on this computer: who it belongs to and whether anything runs in it. */
export interface MachineFacts {
  machine: string;
  path: string;
  mb: number;
  /** null: its agent is on no team any more. */
  agent: { name: string; repo: string | null; busy: boolean } | null;
  /** A process still works in it. */
  live: boolean;
  worktrees: WorktreeFacts[];
  temps: TempFacts[];
}

const DAY_MS = 86_400_000;

/**
 * What a cleanup removes and keeps. Never a busy agent's machine, a worktree whose branch is a PR in QA or being fixed
 * (`heldBranches`), one with work on no remote branch, or anything a process still runs in. Kept items say why.
 */
export function pickCleanup(machines: readonly MachineFacts[], heldBranches: ReadonlySet<string>, keepDays: number): Pick<CleanPlan, 'go' | 'kept'> {
  const go: CleanItem[] = [];
  const kept: CleanItem[] = [];
  const wtWhy = (w: WorktreeFacts) => (w.branch && heldBranches.has(w.branch) ? `its PR (${w.branch}) is in QA or being fixed` : w.unpushed ? 'it has work on no GitHub branch' : null);
  for (const m of machines) {
    const who = m.agent ? `${m.agent.name}'s` : "A former agent's";
    const block = m.live ? 'a process still runs in it' : m.agent?.busy ? `${m.agent.name} is working` : null;
    if (!m.agent) {
      const why = block ?? m.worktrees.map(wtWhy).find(Boolean) ?? null;
      const item = { id: `machine:${m.machine}`, kind: 'machine' as const, label: `${who} machine (${m.machine})`, path: m.path, mb: m.mb, machine: m.machine };
      (why ? kept : go).push({ ...item, why: why ?? 'its agent is on no team any more' });
      continue;
    }
    for (const w of m.worktrees) {
      if (w.repo === m.agent.repo) continue; // their current floor's: node_modules go when idle (Free idle desks after)
      const why = block ?? wtWhy(w);
      const item = { id: `worktree:${m.machine}:${w.repo}`, kind: 'worktree' as const, label: `${who} copy of ${w.repo}`, path: w.path, mb: w.mb, machine: m.machine, repo: w.repo };
      (why ? kept : go).push({ ...item, why: why ?? `${m.agent.name} works on another floor now` });
    }
    if (block) continue;
    for (const t of m.temps) {
      if (t.ageMs < keepDays * DAY_MS) continue;
      go.push({ id: `temp:${m.machine}:${t.name}`, kind: 'temp', label: `${who} temp files (${t.name})`, path: t.path, mb: t.mb, machine: m.machine, why: `untouched for ${Math.floor(t.ageMs / DAY_MS)} days` });
    }
  }
  return { go, kept };
}

/** A cleanup's size: in all, and by kind, MB. */
export function cleanTotals(items: readonly CleanItem[]): { mb: number; count: number; byKind: Partial<Record<CleanKind, number>> } {
  const byKind: Partial<Record<CleanKind, number>> = {};
  let mb = 0;
  for (const i of items) {
    mb += i.mb;
    byKind[i.kind] = (byKind[i.kind] ?? 0) + i.mb;
  }
  return { mb: Math.round(mb), count: items.length, byKind };
}

/** "850 MB", "4.2 GB". */
export const sizeText = (mb: number) => (mb < 1024 ? `${Math.max(0, Math.round(mb))} MB` : gb(mb));

/** The daily log's and the office feed's line for a finished cleanup. */
export function cleanLine(r: CleanResult, items: readonly CleanItem[]): string {
  const what = items.map((i) => `${i.label}: ${sizeText(i.mb)} (${i.why})`).join('; ');
  return `🧹 ${r.auto ? 'Hourly cleanup' : 'Free up space'}: freed ${sizeText(r.freedMb)} from ${r.removed} item${r.removed === 1 ? '' : 's'}${r.kept ? `, kept ${r.kept}` : ''}${r.failed.length ? `, could not remove ${r.failed.length}` : ''}${what && `. ${what}`}`;
}

// ---------- a second disk ----------

/** What the server found at a candidate folder for working copies. */
export interface WorkRootFacts {
  path: string;
  absolute: boolean;
  /** The device of the folder or its nearest existing parent; null when nothing is there. */
  dev: number | null;
  /** The devices of the system disk and of the office's own folder. */
  rootDev: number;
  homeDev: number;
  freeMb: number | null;
}

/** Why working copies can't go there (null: they can; '' always can: the office folder). */
export function workRootProblem(f: WorkRootFacts, s: Pick<DiskSettings, 'holdGb'>): string | null {
  if (!f.path) return null;
  if (!f.absolute) return `Give the full path of a folder on another disk, like /mnt/disk2/cubefarm.`;
  if (f.dev === null) return `Nothing is there: ${f.path} isn't on a mounted disk.`;
  if (f.dev === f.rootDev || f.dev === f.homeDev) return `${f.path} is on the same disk as the office. Pick a folder on another mounted disk, like /mnt/disk2/cubefarm.`;
  const need = Math.max(10, s.holdGb * 2) * 1024;
  if (f.freeMb !== null && f.freeMb < need) return `That disk has only ${gb(f.freeMb)} free; working copies need at least ${gb(need)}.`;
  return null;
}
