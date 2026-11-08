import fs from 'node:fs';
import path from 'node:path';

// The previews' processes, owned across office restarts (#225). Each preview's app is recorded in
// <SWARM_HOME>/previews.json (its pid, process group, port and worktree), so one the office left running before a
// restart is reclaimed instead of being taken for "another program". A process is only ever the office's when its
// working folder is one of the office's preview worktrees (or, where the OS doesn't say, the file recorded it); anything
// else on a preview port is left alone and named. The file also remembers a floor's port after "Use another port".

export interface PreviewPid {
  key: string; // prTheatre's mainKey / prKey
  floor: number;
  kind: 'main' | 'pr';
  slot: number; // 0 for the floor's main preview
  pid: number;
  pgid: number;
  port: number;
  cwd: string; // the preview worktree it was started in
  startedAt: number;
  viewedAt?: number; // its last use (#252), so an office restart doesn't count as time unused
}

interface PidFile {
  entries: PreviewPid[];
  ports: Record<string, number>; // floor id -> its preview port, picked by "Use another port"
}

/** A process as the OS describes it. cwd and startedAt are null where the OS doesn't say (cwd on Windows and macOS). */
export interface ProcInfo {
  pid: number;
  pgid: number; // its process group (Windows: its parent)
  command: string;
  startedAt: number | null;
  cwd: string | null;
}

const PREVIEW_DESK = /^preview(-pr-\d+)?$/;
/** How far apart the recorded start and the OS's may be for a pid to still be the same process (no cwd to go by). */
const SAME_START_MS = 60_000;
/** A floor's lane: its port, then +100, +200 … */
const LANE_STEP = 100;
const LANE_STEPS = 20;

const inside = (dir: string, p: string) => {
  const rel = path.relative(dir, p);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Whether `cwd` is in a preview worktree (desks/preview, desks/preview-pr-N) of one of these desks folders. */
export function inPreviewDesk(cwd: string, desksDirs: string[]): boolean {
  return desksDirs.some((d) => {
    const rel = path.relative(d, cwd);
    return !!rel && inside(d, cwd) && PREVIEW_DESK.test(rel.split(/[\\/]/)[0]);
  });
}

/** Whether a process holding a preview port is the office's own: its folder is a preview worktree, or (no folder known) the file has it. */
export function owned(p: ProcInfo, desksDirs: string[], entries: readonly PreviewPid[]): boolean {
  if (p.cwd) return inPreviewDesk(p.cwd, desksDirs);
  return entries.some((e) => e.pid === p.pid || e.pid === p.pgid);
}

/** A recorded preview found alive after a restart: still the office's (in its own worktree, or started when it was recorded), so it's reclaimed. */
export function stillOurs(e: PreviewPid, now: ProcInfo | null): boolean {
  if (!now) return false;
  if (now.cwd) return inside(e.cwd, now.cwd);
  return now.startedAt !== null && Math.abs(now.startedAt - e.startedAt) < SAME_START_MS;
}

/** The next port in a floor's lane after `from` that `free` accepts, or null within 20 steps. */
export async function nextInLane(from: number, free: (port: number) => boolean | Promise<boolean>): Promise<number | null> {
  for (let i = 1; i <= LANE_STEPS; i++) {
    const p = from + i * LANE_STEP;
    if (p > 65535) break;
    if (await free(p)) return p;
  }
  return null;
}

const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);

/** "pid 12345 `node`, started 11:02, not the office's" */
export function ownerText(p: ProcInfo): string {
  return `pid ${p.pid} \`${p.command}\`${p.startedAt ? `, started ${clock(p.startedAt)}` : ''}, not the office's`;
}

/** The error of a preview whose port something else holds. */
export function portBusyText(port: number, owner: ProcInfo | null): string {
  return `Port ${port} is in use by ${owner ? ownerText(owner) : 'another program'}. The office won't stop it: use another port, or free this one and try again.`;
}

/** How often a preview's last use is written to previews.json at most. */
const USED_SAVE_MS = 15_000;

/** previews.json: read once, written (temp file, then rename) after every change. */
export class PreviewPids {
  private data: PidFile = { entries: [], ports: {} };
  private savedUse = new Map<number, number>(); // pid -> the last use written

  constructor(private file: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<PidFile>;
      if (Array.isArray(raw.entries)) this.data.entries = raw.entries.filter((e) => Number.isInteger(e?.pid) && Number.isInteger(e?.port) && typeof e?.cwd === 'string');
      if (raw.ports && typeof raw.ports === 'object') this.data.ports = Object.fromEntries(Object.entries(raw.ports).filter(([, p]) => Number.isInteger(p)));
    } catch {
      // none yet, or unreadable: nothing recorded
    }
  }

  get entries(): readonly PreviewPid[] {
    return this.data.entries;
  }

  record(e: PreviewPid) {
    this.data.entries = [...this.data.entries.filter((x) => x.pid !== e.pid), e];
    this.save();
  }

  /** A preview's last use, written at most every 15 s. */
  used(pid: number, at: number) {
    const e = this.data.entries.find((x) => x.pid === pid);
    if (!e) return;
    e.viewedAt = at;
    if (at - (this.savedUse.get(pid) ?? 0) < USED_SAVE_MS) return;
    this.savedUse.set(pid, at);
    this.save();
  }

  /** A preview's last use as recorded (from before a restart too). */
  viewedAt(key: string): number | null {
    return this.data.entries.filter((e) => e.key === key && typeof e.viewedAt === 'number').reduce<number | null>((n, e) => Math.max(n ?? 0, e.viewedAt!), null);
  }

  drop(pid: number) {
    this.savedUse.delete(pid);
    if (!this.data.entries.some((e) => e.pid === pid)) return;
    this.data.entries = this.data.entries.filter((e) => e.pid !== pid);
    this.save();
  }

  port(floorId: string): number | undefined {
    return this.data.ports[floorId];
  }

  setPort(floorId: string, port: number) {
    this.data.ports = { ...this.data.ports, [floorId]: port };
    this.save();
  }

  private save() {
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn(`previews: couldn't save ${this.file}: ${(err as Error).message}`);
    }
  }
}
