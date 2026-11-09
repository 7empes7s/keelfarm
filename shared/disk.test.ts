import { describe, expect, it } from 'vitest';
import { cleanTotals, DEFAULT_DISK, diskAlert, diskHold, diskLevel, diskSettings, pickCleanup, uniqueDisks, workRootProblem, worstLevel, type MachineFacts, type WorkRootFacts } from './disk.ts';

const GB = 1024;
const DAY = 86_400_000;
const disk = (freeGb: number, totalGb = 150) => ({ label: 'Office data', path: '/root/.cubefarm', totalMb: totalGb * GB, freeMb: freeGb * GB });

describe('disk thresholds', () => {
  it('warns below 15% or 10 GB free and holds below 5 GB', () => {
    expect(diskLevel(disk(60), DEFAULT_DISK)).toBe('ok');
    expect(diskLevel(disk(20), DEFAULT_DISK)).toBe('warn'); // 13% of 150 GB
    expect(diskLevel(disk(9, 50), DEFAULT_DISK)).toBe('warn'); // 18%, but under 10 GB
    expect(diskLevel(disk(4.9), DEFAULT_DISK)).toBe('hold');
    expect(diskLevel(disk(0), DEFAULT_DISK)).toBe('hold');
  });

  it('holds new work on the fullest disk and says where', () => {
    expect(diskHold([disk(60)], DEFAULT_DISK)).toBeNull();
    const why = diskHold([disk(60), { ...disk(3), label: 'Temp files', path: '/tmp' }], DEFAULT_DISK);
    expect(why).toMatch(/^Waiting for disk space: 3\.0 GB free on temp files \(\/tmp\)/);
    expect(worstLevel([disk(60), disk(12)], DEFAULT_DISK)).toBe('warn');
  });

  it('rings once per low stretch, again only after it recovered', () => {
    let told = false;
    const seen: boolean[] = [];
    for (const level of ['ok', 'warn', 'warn', 'hold', 'ok', 'warn'] as const) {
      const r = diskAlert(level, told);
      told = r.told;
      seen.push(r.send);
    }
    expect(seen).toEqual([false, true, false, false, false, true]);
  });

  it('takes valid settings and keeps the rest', () => {
    const s = diskSettings(DEFAULT_DISK, { warnPct: 120, holdGb: 'x', keepDays: 3.4, workRoot: ' /mnt/x ' });
    expect(s).toEqual({ ...DEFAULT_DISK, warnPct: 90, keepDays: 3, workRoot: '/mnt/x' });
  });

  it('shows one disk once when its folders share it', () => {
    expect(uniqueDisks([disk(60), { ...disk(60), label: 'Temp files' }]).map((d) => d.label)).toEqual(['Office data & temp files']);
  });
});

describe('cleanup selection', () => {
  const wt = (repo: string, extra: Partial<MachineFacts['worktrees'][number]> = {}) => ({ repo, path: `/m/work/${repo}`, mb: 900, branch: null, unpushed: false, ...extra });
  const machine = (extra: Partial<MachineFacts>): MachineFacts => ({ machine: 'ada', path: '/m', mb: 2000, agent: { name: 'Ada', repo: 'o/a', busy: false }, live: false, worktrees: [], temps: [], ...extra });
  const ids = (p: ReturnType<typeof pickCleanup>) => ({ go: p.go.map((i) => i.id), kept: p.kept.map((i) => `${i.id}: ${i.why}`) });

  it("removes a former agent's machine and an agent's copy of a floor they left", () => {
    const p = pickCleanup([machine({ machine: 'old', agent: null, worktrees: [wt('o/a')] }), machine({ worktrees: [wt('o/a'), wt('o/b')] })], new Set(), 2);
    expect(ids(p)).toEqual({ go: ['machine:old', 'worktree:ada:o/b'], kept: [] });
  });

  it("never picks a running task's machine, a PR in QA or fixing, or unpushed work", () => {
    const p = pickCleanup(
      [
        machine({ machine: 'busy', agent: { name: 'Bo', repo: 'o/a', busy: true }, worktrees: [wt('o/b')], temps: [{ name: 'x', path: '/t/x', mb: 5, ageMs: 9 * DAY }] }),
        machine({ machine: 'qa', worktrees: [wt('o/b', { branch: 'swarm/issue-7-ada' })] }),
        machine({ machine: 'wip', worktrees: [wt('o/b', { unpushed: true })] }),
        machine({ machine: 'gone', agent: null, worktrees: [wt('o/b', { unpushed: true })] }),
        machine({ machine: 'held', agent: null, worktrees: [wt('o/b', { branch: 'swarm/issue-7-ada' })] }),
        machine({ machine: 'run', agent: null, live: true }),
      ],
      new Set(['swarm/issue-7-ada']),
      2,
    );
    expect(p.go).toEqual([]);
    expect(ids(p).kept).toEqual([
      'worktree:busy:o/b: Bo is working',
      'worktree:qa:o/b: its PR (swarm/issue-7-ada) is in QA or being fixed',
      'worktree:wip:o/b: it has work on no GitHub branch',
      'machine:gone: it has work on no GitHub branch',
      'machine:held: its PR (swarm/issue-7-ada) is in QA or being fixed',
      'machine:run: a process still runs in it',
    ]);
  });

  it('removes temp files untouched for the retention days, only while idle', () => {
    const temps = [
      { name: 'old', path: '/t/old', mb: 300, ageMs: 3 * DAY },
      { name: 'new', path: '/t/new', mb: 300, ageMs: DAY },
    ];
    expect(ids(pickCleanup([machine({ temps })], new Set(), 2)).go).toEqual(['temp:ada:old']);
    expect(pickCleanup([machine({ temps, live: true })], new Set(), 2).go).toEqual([]);
  });

  it('adds up what goes, by kind', () => {
    const p = pickCleanup([machine({ machine: 'old', agent: null }), machine({ worktrees: [wt('o/b')], temps: [{ name: 'x', path: '/t/x', mb: 100.4, ageMs: 5 * DAY }] })], new Set(), 2);
    expect(cleanTotals(p.go)).toEqual({ mb: 3000, count: 3, byKind: { machine: 2000, worktree: 900, temp: 100.4 } });
  });
});

describe('a second disk for working copies', () => {
  const facts = (f: Partial<WorkRootFacts>): WorkRootFacts => ({ path: '/mnt/keel-copy/cubefarm', absolute: true, dev: 2049, rootDev: 2048, homeDev: 2048, freeMb: 90 * GB, ...f });

  it('takes a folder on another mounted disk with room', () => {
    expect(workRootProblem(facts({}), DEFAULT_DISK)).toBeNull();
    expect(workRootProblem(facts({ path: '' }), DEFAULT_DISK)).toBeNull(); // back to the office folder
  });

  it('refuses the root disk, a relative path, nothing mounted and a full disk', () => {
    expect(workRootProblem(facts({ dev: 2048 }), DEFAULT_DISK)).toMatch(/same disk as the office/);
    expect(workRootProblem(facts({ dev: 7, homeDev: 7 }), DEFAULT_DISK)).toMatch(/same disk as the office/);
    expect(workRootProblem(facts({ path: 'disk2', absolute: false }), DEFAULT_DISK)).toMatch(/full path/);
    expect(workRootProblem(facts({ dev: null }), DEFAULT_DISK)).toMatch(/isn't on a mounted disk/);
    expect(workRootProblem(facts({ freeMb: 4 * GB }), DEFAULT_DISK)).toMatch(/only 4\.0 GB free/);
  });
});
