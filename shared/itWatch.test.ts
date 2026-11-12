import { describe, expect, it } from 'vitest';
import {
  addDiskSample,
  backupsCheck,
  certsCheck,
  digestLine,
  diskCheck,
  diskTrend,
  dockerCheck,
  failedCheck,
  IT_WATCH_DEFAULTS as S,
  itWatchSettings,
  loadCheck,
  memoryCheck,
  parseDockerDf,
  parseFailed,
  parseJournalUsage,
  parseNewest,
  parseUnits,
  sizeBytes,
  sizeCheck,
  unitsCheck,
  wakeFor,
  wakes,
  WAKE_EVERY_MS,
  type ItCheck,
} from './itWatch.ts';

const GB = 1024;
const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 12, 12);

describe('IT monitoring: parsing what commands print', () => {
  it('reads sizes in docker (decimal) and journalctl (binary) units', () => {
    expect(sizeBytes('11.2GB')).toBe(11.2e9);
    expect(sizeBytes('3.9G')).toBeCloseTo(3.9 * 1024 ** 3);
    expect(sizeBytes('0B')).toBe(0);
    expect(sizeBytes('210MB')).toBe(210e6);
    expect(sizeBytes('n/a')).toBeNaN();
  });

  it('reads systemctl show blocks, telling missing units apart', () => {
    const out = 'Id=caddy.service\nLoadState=loaded\nActiveState=active\n\nId=keel-portal.service\nLoadState=loaded\nActiveState=failed\n\nId=nope.service\nLoadState=not-found\nActiveState=inactive\n';
    expect(parseUnits(out)).toEqual([
      { id: 'caddy.service', loaded: true, active: 'active' },
      { id: 'keel-portal.service', loaded: true, active: 'failed' },
      { id: 'nope.service', loaded: false, active: 'inactive' },
    ]);
  });

  it('reads failed units, docker system df, journal usage and the newest backup', () => {
    expect(parseFailed('● keel-backup-tier2.service loaded failed failed KEEL backup\nsnap.foo.timer loaded failed failed x\n')).toEqual(['keel-backup-tier2.service', 'snap.foo.timer']);
    expect(parseFailed('')).toEqual([]);
    const df = 'TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE\nImages          23        4         11.2GB    8.9GB (79%)\nContainers      4         4         210MB     0B (0%)\nLocal Volumes   3         2         2.4GB     2.4GB (100%)\nBuild Cache     41        0         1.6GB     1.6GB\n';
    expect(parseDockerDf(df)).toEqual([
      { type: 'Images', size: 11.2e9, reclaimable: 8.9e9 },
      { type: 'Containers', size: 210e6, reclaimable: 0 },
      { type: 'Local Volumes', size: 2.4e9, reclaimable: 2.4e9 },
      { type: 'Build Cache', size: 1.6e9, reclaimable: 1.6e9 },
    ]);
    expect(parseJournalUsage('Archived and active journals take up 3.9G in the file system.')).toBeCloseTo(3.9 * 1024 ** 3);
    expect(parseNewest('1762900000.5 /opt/backups/2026-11-11\n1762990000.25 /opt/backups/2026-11-12\n')).toEqual({ at: 1762990000250, name: '2026-11-12' });
    expect(parseNewest('')).toBeNull();
  });
});

describe('IT monitoring: each check → its level', () => {
  const disk = (freeGb: number) => [{ label: 'System disk', path: '/', totalMb: 150 * GB, freeMb: freeGb * GB }];

  it('disk: warn under 15 GB, bad under the 10 GB reserve, with the trend and days left', () => {
    expect(diskCheck(disk(40), [], S, NOW).level).toBe('good');
    expect(diskCheck(disk(14), [], S, NOW).level).toBe('warn');
    const bad = diskCheck(disk(7.9), [{ at: NOW - 24 * H, freeMb: 10 * GB }], S, NOW);
    expect(bad).toMatchObject({ level: 'bad', line: '7.9 GB free on system disk (/)', trend: '−2.1 GB/day · full in 3 days' });
    expect(diskCheck([], [], S, NOW).level).toBe('off');
  });

  it('disk trend: needs 6 hours of samples; one sample an hour, a week at most', () => {
    expect(diskTrend([{ at: NOW - H, freeMb: 9 * GB }], { at: NOW, freeMb: 8 * GB })).toBeNull();
    expect(diskTrend([{ at: NOW - 12 * H, freeMb: 20 * GB }], { at: NOW, freeMb: 21 * GB })).toEqual({ gbPerDay: 2, fullInDays: null });
    let samples = addDiskSample([], { at: NOW, freeMb: 1 });
    samples = addDiskSample(samples, { at: NOW + 10 * 60_000, freeMb: 2 });
    expect(samples).toHaveLength(1);
    for (let i = 1; i <= 200; i++) samples = addDiskSample(samples, { at: NOW + i * H, freeMb: i });
    expect(samples).toHaveLength(168);
  });

  it('memory and swap, and load per CPU', () => {
    const m = { availableMb: 2 * GB, totalMb: 7.6 * GB, swapFreeMb: 8 * GB, swapTotalMb: 8 * GB, load: 1, cpus: 4, at: NOW };
    expect(memoryCheck(m, S).level).toBe('good');
    expect(memoryCheck({ ...m, swapFreeMb: 3 * GB }, S).level).toBe('warn'); // 62% used
    expect(memoryCheck({ ...m, swapFreeMb: 1 * GB }, S).level).toBe('bad'); // 87%
    expect(memoryCheck(null, S).level).toBe('off');
    expect(loadCheck({ ...m, load: 10 }, S).level).toBe('warn');
    expect(loadCheck({ ...m, load: 20 }, S).level).toBe('bad');
    expect(loadCheck({ ...m, load: null }, S).level).toBe('off');
  });

  it('services: a unit down is bad; missing ones are skipped; no systemd is off', () => {
    expect(unitsCheck([{ id: 'caddy.service', loaded: true, active: 'active' }, { id: 'x.service', loaded: false, active: 'inactive' }])).toMatchObject({ level: 'good', line: '1 running' });
    expect(unitsCheck([{ id: 'caddy.service', loaded: true, active: 'active' }, { id: 'keel-portal.service', loaded: true, active: 'failed' }])).toMatchObject({ level: 'bad', line: 'Down: keel-portal.service' });
    expect(unitsCheck([{ id: 'x.service', loaded: false, active: 'inactive' }]).level).toBe('off');
    expect(unitsCheck(null).level).toBe('off');
    expect(failedCheck(['a.service']).level).toBe('warn');
    expect(failedCheck([]).level).toBe('good');
  });

  it('docker: warns over 10 GB reclaimable, never counting volumes (keel-postgres)', () => {
    expect(dockerCheck([{ type: 'Images', size: 20e9, reclaimable: 12e9 }], S).level).toBe('warn');
    expect(dockerCheck([{ type: 'Local Volumes', size: 30e9, reclaimable: 30e9 }], S).level).toBe('good');
    expect(dockerCheck(null, S).level).toBe('off');
  });

  it('sizes: QA screenshots, logs, files and leftovers warn past their line; unmeasured is off', () => {
    expect(sizeCheck('qaShots', 'QA screenshots', 4 * 1024 ** 3, 2, 'of QA screenshots')).toMatchObject({ level: 'warn', line: '4.0 GB of QA screenshots' });
    expect(sizeCheck('logs', 'System logs', 1024 ** 3, 2, 'of logs').level).toBe('good');
    expect(sizeCheck('files', 'Files store', NaN, 10, 'of files').level).toBe('off');
  });

  it('backups: warn over 36 h, bad over 72 h, off without any', () => {
    expect(backupsCheck({ at: NOW - 10 * H, name: 'd' }, S, NOW).level).toBe('good');
    expect(backupsCheck({ at: NOW - 40 * H, name: 'd' }, S, NOW).level).toBe('warn');
    expect(backupsCheck({ at: NOW - 80 * H, name: 'd' }, S, NOW)).toMatchObject({ level: 'bad', line: 'Newest d, 3 days old' });
    expect(backupsCheck(null, S, NOW).level).toBe('off');
  });

  it('certificates: warn under 14 days or unreadable, bad under 3', () => {
    const day = 24 * H;
    expect(certsCheck([{ host: 'a.example', expires: NOW + 60 * day }], S, NOW).level).toBe('good');
    expect(certsCheck([{ host: 'a.example', expires: NOW + 10 * day }], S, NOW).level).toBe('warn');
    expect(certsCheck([{ host: 'a.example', expires: NOW + day }], S, NOW).level).toBe('bad');
    expect(certsCheck([{ host: 'a.example', expires: null, error: 'timed out' }], S, NOW).level).toBe('warn');
  });

  it('keeps thresholds in range and falls back to what was there', () => {
    expect(itWatchSettings(undefined, {})).toEqual(S);
    expect(itWatchSettings(S, { diskWarnGb: 20, swapWarnPct: -1, units: ['caddy', 'bad name;rm'], backupDir: 'relative' })).toMatchObject({ diskWarnGb: 20, swapWarnPct: 50, units: ['caddy'], backupDir: '/opt/backups' });
  });
});

describe('IT monitoring: waking IT', () => {
  it('a crossing wakes once, the same level never, a worse level once more', () => {
    let r = wakeFor(undefined, 'warn', NOW);
    expect(r.wake).toBe(true);
    r = wakeFor(r.mark, 'warn', NOW + 2 * H);
    expect(r.wake).toBe(false);
    r = wakeFor(r.mark, 'bad', NOW + 3 * H);
    expect(r.wake).toBe(true);
    expect(wakeFor(r.mark, 'bad', NOW + 9 * H).wake).toBe(false);
    expect(wakeFor(undefined, 'good', NOW).wake).toBe(false);
    expect(wakeFor(undefined, 'off', NOW).wake).toBe(false);
  });

  it('at most one wake per check an hour: worse within the hour waits for it', () => {
    const first = wakeFor(undefined, 'warn', NOW);
    const soon = wakeFor(first.mark, 'bad', NOW + 10 * 60_000);
    expect(soon).toEqual({ wake: false, mark: first.mark });
    expect(wakeFor(soon.mark, 'bad', NOW + WAKE_EVERY_MS).wake).toBe(true);
  });

  it('getting better lowers the mark, so crossing again wakes again', () => {
    const a = wakeFor(undefined, 'warn', NOW);
    const b = wakeFor(a.mark, 'good', NOW + H);
    expect(b).toEqual({ wake: false, mark: { level: 'good', wokeAt: NOW } });
    expect(wakeFor(b.mark, 'warn', NOW + 2 * H).wake).toBe(true);
  });

  it('a round wakes for the checks that got worse, never for snoozed ones', () => {
    const c = (id: ItCheck['id'], level: ItCheck['level']): ItCheck => ({ id, label: id, level, line: '', facts: [], at: NOW });
    const r = wakes([c('disk', 'bad'), c('docker', 'warn'), c('load', 'good')], {}, new Set(['docker']), NOW);
    expect(r.woken.map((x) => x.id)).toEqual(['disk']);
    expect(r.marks.docker).toEqual({ level: 'warn', wokeAt: NOW }); // snoozed: no wake now, nor right after the snooze
  });

  it('the daily digest is one line when all is well', () => {
    const c = (level: ItCheck['level'], label = 'Disk'): ItCheck => ({ id: 'disk', label, level, line: '7.9 GB free', facts: [], at: NOW });
    expect(digestLine([c('good'), c('off')])).toBe('🩺 Daily check: all good (1 check).');
    expect(digestLine([c('bad'), c('good')])).toBe('🩺 Daily check: 1 needs a look: Disk (bad): 7.9 GB free.');
  });
});
