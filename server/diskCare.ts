// The office's disk care on this computer (#340, rules in shared/disk.ts): free space on the disks it writes to, what
// its agents' machines hold (worktrees with their branch and unpushed work, temp folders), removing what a cleanup
// picked (only inside the machines' folders), and a second disk for working copies: a new machine's folder is made
// there and linked from <HOME_DIR>/machines/<machine> (a junction on Windows), so every path the office knows stays
// the same; an idle machine moves there (or back) by copying without node_modules, then the link swaps.
import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CleanItem, DiskReading, MachineFacts, WorkRootFacts } from '../shared/disk.ts';
import { HOME_DIR } from './config.ts';
import { git } from './exec.ts';
import { realResources } from './health.ts';
import { dirSize, listMachines, MACHINES_DIR, machineDir, removeMachine } from './workspace.ts';

/** A machine as the cleanup reads it from disk; the office adds whose it is. */
export type MachineScan = Omit<MachineFacts, 'agent'>;

export interface DiskBackend {
  /** Free space where each folder is (its nearest existing parent). */
  read(dirs: { label: string; path: string }[]): Promise<DiskReading[]>;
  /** The machines on this computer: worktrees, temp folders and whether a process works in them; sizes 0 (measure). */
  scan(): Promise<MachineScan[]>;
  /** The size of each folder, MB. */
  measure(paths: string[]): Promise<number[]>;
  /** Big folders outside the office's that a cleanup never touches, with their size: reported only. */
  outside(): Promise<CleanItem[]>;
  /** Remove what a cleanup picked; returns the MB freed. Refuses anything outside the machines' folders. */
  remove(item: CleanItem): Promise<number>;
  /** What's at a folder offered for working copies. */
  inspectRoot(dir: string): Promise<WorkRootFacts>;
  /** Where new machines go from now on ('' = the office folder). */
  setWorkRoot(dir: string): void;
  /** Move an idle machine to the working-copies disk (or back home); false when it's there already or stopped being idle. */
  move(machine: string, stillIdle: () => boolean): Promise<boolean>;
  /** The demo only: pretend the disk is nearly full, or has room again. */
  simulate?(low: boolean): void;
}

const MB = 1024 * 1024;
let workRoot = '';

/** Where machines' folders may be: the office's own, and the working-copies disk. */
export const machineRoots = () => [MACHINES_DIR, ...(workRoot ? [workRoot] : [])];

const inside = (root: string, p: string) => {
  const rel = path.relative(root, p);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** The folder or its nearest existing parent (statfs and stat need one that exists). */
async function existing(dir: string): Promise<string | null> {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (await fs.stat(d).then(() => true, () => false)) return d;
    if (path.dirname(d) === d) return null;
  }
}

const linked = (p: string) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** A new machine on the working-copies disk: its folder there, linked from machines/<machine>. */
export function ensureMachineHome(machine: string) {
  const dir = machineDir(machine);
  if (!workRoot || existsSync(dir) || linked(dir)) return;
  const target = path.join(workRoot, machine);
  mkdirSync(target, { recursive: true });
  mkdirSync(MACHINES_DIR, { recursive: true });
  symlinkSync(target, dir, 'junction');
}

const moves = new Map<string, Promise<unknown>>();
/** Resolves once a move of the machine (if any) is over: a task waits for it before preparing its worktree. */
export const moved = (machine: string) => moves.get(machine) ?? Promise.resolve();

const removeDir = (dir: string) => fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });

/** removeMachine, and the machine's folder on the working-copies disk when it lives there. */
export async function removeMachineAnywhere(machine: string) {
  const link = machineDir(machine);
  const real = linked(link) ? await fs.realpath(link).catch(() => null) : null;
  const r = await removeMachine(machine);
  if (r.removed && real && machineRoots().some((root) => inside(root, real))) await removeDir(real).catch(() => undefined);
  return r;
}

async function moveMachine(machine: string, stillIdle: () => boolean): Promise<boolean> {
  const link = machineDir(machine);
  if (!existsSync(link)) return false;
  const isLink = linked(link);
  const real = await fs.realpath(link);
  const target = workRoot ? path.join(workRoot, machine) : link;
  if (!isLink && !workRoot) return false;
  if (isLink && workRoot && path.dirname(real) === (await fs.realpath(workRoot).catch(() => workRoot))) return false;
  if (!stillIdle()) return false;
  const stage = `${target}.moving`;
  await removeDir(stage);
  await fs.mkdir(path.dirname(target), { recursive: true });
  // node_modules stay behind: the next task installs them again from the warm npm cache.
  await fs.cp(real, stage, { recursive: true, verbatimSymlinks: true, filter: (src) => path.basename(src) !== 'node_modules' });
  if (!stillIdle()) {
    await removeDir(stage);
    return false;
  }
  const old = isLink ? real : `${link}.old`;
  if (isLink) await fs.unlink(link);
  else await fs.rename(link, old);
  await fs.rename(stage, target);
  if (target !== link) await fs.symlink(target, link, 'junction');
  await removeDir(old).catch(() => undefined);
  // Git may have kept the worktrees' real paths: point the clones and their worktrees at each other again.
  for (const name of await fs.readdir(path.join(link, 'repos')).catch(() => [] as string[])) {
    await git(['worktree', 'repair', path.join(link, 'work', name)], { cwd: path.join(link, 'repos', name), timeoutMs: 60_000 }).catch(() => undefined);
  }
  return true;
}

async function worktreeOf(dir: string, repo: string) {
  const g = (args: string[]) => git(args, { cwd: dir, timeoutMs: 60_000 });
  try {
    const branch = (await g(['rev-parse', '--abbrev-ref', 'HEAD'])) || null;
    const dirty = await g(['status', '--porcelain']);
    const commits = Number(await g(['rev-list', '--count', 'HEAD', '--not', '--remotes']));
    return { repo, path: dir, mb: 0, branch, unpushed: !!dirty || commits > 0 };
  } catch {
    return { repo, path: dir, mb: 0, branch: null, unpushed: true }; // unreadable: kept, to be safe
  }
}

async function scan(): Promise<MachineScan[]> {
  const out: MachineScan[] = [];
  const now = Date.now();
  for (const machine of await listMachines()) {
    const home = await fs.realpath(machineDir(machine)).catch(() => null);
    if (!home) continue;
    const used = await realResources.usage([home]);
    const work = await fs.readdir(path.join(home, 'work')).catch(() => [] as string[]);
    const worktrees = await Promise.all(work.map((name) => worktreeOf(path.join(machineDir(machine), 'work', name), name.replace('__', '/'))));
    const tmp = path.join(machineDir(machine), 'tmp');
    const temps = await Promise.all(
      (await fs.readdir(tmp).catch(() => [] as string[])).map(async (name) => {
        const st = await fs.lstat(path.join(tmp, name)).catch(() => null);
        return { name, path: path.join(tmp, name), mb: 0, ageMs: st ? now - st.mtimeMs : 0 };
      }),
    );
    out.push({ machine, path: machineDir(machine), mb: 0, live: !!used.get(home)?.pids.length, worktrees, temps });
  }
  return out;
}

/** Caches and downloads the office's tools use but doesn't own: shown with their size, never removed. */
function outsideFolders(): { label: string; path: string }[] {
  const home = os.homedir();
  return [
    { label: 'npm cache', path: path.join(home, '.npm', '_cacache') },
    { label: 'npx downloads', path: path.join(home, '.npm', '_npx') },
    { label: 'Playwright browsers', path: path.join(home, '.cache', 'ms-playwright') },
    { label: 'Puppeteer browsers', path: path.join(home, '.cache', 'puppeteer') },
    ...(process.platform === 'linux' ? [{ label: 'Demo releases', path: '/opt/cubefarm-demo-releases' }] : []),
  ];
}

async function remove(item: CleanItem): Promise<number> {
  const p = path.resolve(item.path);
  const real = await fs.realpath(p).catch(() => p);
  if (item.kind === 'outside' || !item.machine || ![p, real].some((x) => machineRoots().some((root) => inside(root, x)))) throw new Error(`not the office's to remove: ${item.path}`);
  const before = await dirSize(real);
  if (item.kind === 'machine') {
    if (!(await removeMachineAnywhere(item.machine)).removed) throw new Error('still in use');
  } else if (item.kind === 'worktree' && item.repo) {
    const folder = item.repo.replace('/', '__');
    await removeDir(path.join(machineDir(item.machine), 'work', folder));
    await removeDir(path.join(machineDir(item.machine), 'repos', folder));
  } else await removeDir(p);
  return before / MB;
}

export const realDisk: DiskBackend = {
  read: (dirs) =>
    Promise.all(
      dirs.map(async (d) => {
        const at = await existing(d.path);
        const s = at ? await fs.statfs(at).catch(() => null) : null;
        return { label: d.label, path: d.path, totalMb: s ? Math.round((s.blocks * s.bsize) / MB) : 0, freeMb: s ? Math.round((s.bavail * s.bsize) / MB) : 0 };
      }),
    ).then((list) => list.filter((d) => d.totalMb > 0)),
  scan,
  measure: (paths) => Promise.all(paths.map(async (p) => (await dirSize(await fs.realpath(p).catch(() => p))) / MB)),
  outside: async () => {
    const out: CleanItem[] = [];
    for (const f of outsideFolders()) {
      if (!existsSync(f.path)) continue;
      out.push({ id: `outside:${f.path}`, kind: 'outside', label: f.label, path: f.path, mb: (await dirSize(f.path)) / MB, why: "outside the office's folders: left alone" });
    }
    return out;
  },
  remove,
  inspectRoot: async (dir) => {
    const at = dir && path.isAbsolute(dir) ? await existing(dir) : null;
    const st = at ? await fs.stat(at) : null;
    const s = at ? await fs.statfs(at).catch(() => null) : null;
    return {
      path: dir,
      absolute: path.isAbsolute(dir),
      dev: st?.dev ?? null,
      rootDev: (await fs.stat(path.parse(HOME_DIR).root)).dev,
      homeDev: (await fs.stat(HOME_DIR).catch(() => fs.stat(path.parse(HOME_DIR).root))).dev,
      freeMb: s ? Math.round((s.bavail * s.bsize) / MB) : null,
    };
  },
  setWorkRoot: (dir) => {
    workRoot = dir ? path.resolve(dir) : '';
  },
  move: (machine, stillIdle) => {
    const p = moveMachine(machine, stillIdle);
    moves.set(machine, p.catch(() => undefined));
    return p;
  },
};
