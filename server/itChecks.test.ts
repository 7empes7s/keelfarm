import { describe, expect, it } from 'vitest';
import { readItChecks, type ItCheckDeps } from './itChecks.ts';
import { IT_WATCH_DEFAULTS } from '../shared/itWatch.ts';

// #525: every check from fixture readings (what systemctl, docker, journalctl and find print), with a fake runner.
const NOW = Date.UTC(2026, 10, 12, 12);
const GB = 1024;

function deps(out: Record<string, string | null>, over: Partial<ItCheckDeps> = {}): ItCheckDeps & { ran: string[][] } {
  const ran: string[][] = [];
  return {
    ran,
    exec: async (argv) => {
      ran.push(argv);
      const key = Object.keys(out).find((k) => argv.join(' ').startsWith(k));
      const o = key === undefined ? null : out[key];
      return o === null ? { code: null, out: '', err: 'spawn ENOENT' } : { code: 0, out: o, err: '' };
    },
    disks: async () => [{ label: 'System disk', path: '/', totalMb: 150 * GB, freeMb: 7.9 * GB }],
    memory: () => ({ availableMb: 2 * GB, totalMb: 7.6 * GB, swapFreeMb: 6 * GB, swapTotalMb: 8 * GB, load: 1.2, cpus: 4, at: NOW }),
    leftoversMb: async () => 18 * GB,
    measure: async () => [4 * GB, 1 * GB],
    certExpiry: async () => NOW + 40 * 86_400_000,
    settings: IT_WATCH_DEFAULTS,
    samples: [],
    dirs: { qaShots: '/x/qa-shots', files: '/x/files' },
    now: NOW,
    ...over,
  };
}

const KEEL = {
  'systemctl show': IT_WATCH_DEFAULTS.units.map((u, i) => `Id=${u}\nLoadState=loaded\nActiveState=${i === 2 ? 'failed' : 'active'}`).join('\n\n'),
  'systemctl list-units': '● keel-backup-tier2.service loaded failed failed KEEL backup\n',
  'docker system df': 'TYPE TOTAL ACTIVE SIZE RECLAIMABLE\nImages          23        4         11.2GB    8.9GB (79%)\nBuild Cache     41        0         9GB       9GB\n',
  'journalctl --disk-usage': 'Archived and active journals take up 3.9G in the file system.',
  find: `${(NOW - 50 * 3_600_000) / 1000} /opt/backups/2026-11-10\n`,
};

describe('IT monitoring: reading the checks', () => {
  it('turns fixture readings into each check\'s level', async () => {
    const checks = await readItChecks(deps(KEEL));
    expect(Object.fromEntries(checks.map((c) => [c.id, c.level]))).toEqual({
      disk: 'bad',
      memory: 'good',
      load: 'good',
      units: 'bad',
      failed: 'warn',
      docker: 'warn',
      leftovers: 'warn',
      qaShots: 'warn',
      logs: 'warn',
      files: 'good',
      backups: 'warn',
      certs: 'good',
    });
    expect(checks.find((c) => c.id === 'units')!.line).toBe('Down: keel-portal');
    expect(checks.every((c) => c.at === NOW)).toBe(true);
  });

  it('only reads: fixed argv, no shell, nothing that changes the machine', async () => {
    const d = deps(KEEL);
    await readItChecks(d);
    expect(d.ran.map((a) => a.slice(0, 2).join(' ')).sort()).toEqual(['docker system', 'find /opt/backups', 'journalctl --disk-usage', 'systemctl list-units', 'systemctl show']);
    expect(d.ran.flat().some((a) => /[|;&]|prune|rm|restart|vacuum/.test(a))).toBe(false);
  });

  it('a machine without systemd, Docker or backups shows those checks as off, never failing', async () => {
    const checks = await readItChecks(deps({}, { certExpiry: async () => Promise.reject(new Error('getaddrinfo ENOTFOUND')), measure: async () => Promise.reject(new Error('no')) }));
    const level = (id: string) => checks.find((c) => c.id === id)!.level;
    for (const id of ['units', 'failed', 'docker', 'logs', 'backups', 'qaShots', 'files']) expect(level(id)).toBe('off');
    expect(checks.find((c) => c.id === 'certs')!.facts[0]).toMatch(/couldn't read \(getaddrinfo ENOTFOUND\)/);
  });
});
