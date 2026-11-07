// The office's side of the version-control practices (#24), per floor: the files each open swarm PR changes (asked
// once per head commit), the floor's hot files (from its history, at most every half hour), and which ready issues
// leases hold back, since when. The rules are pure, in shared/practices.ts.
import { hotFiles, normPath, type FileCommit, type LeaseHold } from '../shared/practices.ts';
import type { PullInfo } from '../shared/types.ts';

const HOT_EVERY_MS = 30 * 60_000;

export class FloorPractice {
  prFiles = new Map<number, { sha: string; files: string[] }>();
  hot: ReturnType<typeof hotFiles> = [];
  private hotAt = 0;
  private heldSince = new Map<number, number>();
  holds: LeaseHold[] = [];
  issueFiles = new Map<number, string[]>(); // the files earlier PRs for each issue changed, closed ones too (#256)

  /** Paths the floor is known to have: what bare file names in an issue resolve to. */
  known(): string[] {
    return [...new Set([...[...this.prFiles.values()].flatMap((p) => p.files), ...this.hot.map((h) => h.path)])];
  }

  /** The changed files of open swarm PRs whose head moved since the last look; closed ones are forgotten. True when any changed. */
  async refreshPrFiles(pulls: PullInfo[], read: (pr: number) => Promise<string[]>): Promise<boolean> {
    const open = pulls.filter((p) => p.state === 'OPEN' && p.headRefName.startsWith('swarm/'));
    let changed = false;
    for (const n of this.prFiles.keys()) {
      if (open.some((p) => p.number === n)) continue;
      this.prFiles.delete(n);
      changed = true;
    }
    for (const p of open) {
      if (this.prFiles.get(p.number)?.sha === p.headSha) continue;
      const files = await read(p.number).catch(() => null);
      if (!files) continue;
      this.prFiles.set(p.number, { sha: p.headSha, files: files.map(normPath) });
      for (const i of p.closesIssues) this.issueFiles.set(i, [...new Set([...(this.issueFiles.get(i) ?? []), ...files.map(normPath)])].slice(0, 30));
      changed = true;
    }
    return changed;
  }

  /** The hot files again, when they're due. True when they changed. */
  async refreshHot(read: () => Promise<FileCommit[]>, now: number): Promise<boolean> {
    if (now - this.hotAt < HOT_EVERY_MS) return false;
    this.hotAt = now;
    const log = await read().catch(() => null);
    if (!log) return false;
    const before = JSON.stringify(this.hot);
    this.hot = hotFiles(log, 10);
    return JSON.stringify(this.hot) !== before;
  }

  /** When each held issue was first held back: chooseIssue's clock, so a held issue starts after LEASE_WAIT_MS. */
  since(): ReadonlyMap<number, number> {
    return this.heldSince;
  }

  /** The scheduler's latest holds. True when they changed (the floor's view shows them). */
  setHolds(held: LeaseHold[]): boolean {
    this.heldSince = new Map(held.map((h) => [h.issue, h.since]));
    const before = JSON.stringify(this.holds);
    this.holds = held;
    return JSON.stringify(held) !== before;
  }
}
