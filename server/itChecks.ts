// IT monitoring's readings (#525): each check's commands (fixed argv through the IT desk's runner, no shell, nothing that
// changes the machine) and measurements, turned into levels by shared/itWatch.ts. No model call: this runs every few
// minutes. A check whose command is missing here (no systemd, no Docker) is "off", never an error.
import tls from 'node:tls';
import { backupsCheck, certsCheck, diskCheck, dockerCheck, failedCheck, loadCheck, memoryCheck, parseDockerDf, parseFailed, parseJournalUsage, parseNewest, parseUnits, sizeCheck, unitsCheck, type DiskSample, type ItCheck, type ItWatchSettings } from '../shared/itWatch.ts';
import type { DiskReading } from '../shared/disk.ts';
import type { MemoryReading } from '../shared/health.ts';
import type { ItExecResult } from './itExec.ts';

const TIMEOUT_MS = 30_000;
const MB = 1024 ** 2;

export interface ItCheckDeps {
  exec(argv: string[], timeoutMs: number): Promise<ItExecResult>;
  disks(): Promise<DiskReading[]>;
  memory(): MemoryReading | null;
  /** MB the office's own cleanup would free now (agents' idle machines, worktrees and temp files). */
  leftoversMb(): Promise<number>;
  /** MB of each folder (diskCare's measure). */
  measure(paths: string[]): Promise<number[]>;
  certExpiry(host: string): Promise<number>;
  settings: ItWatchSettings;
  samples: readonly DiskSample[];
  dirs: { qaShots: string; files: string };
  now: number;
}

/** A command's output when it ran and exited 0; null when it isn't here or failed. */
async function out(d: ItCheckDeps, argv: string[]): Promise<string | null> {
  const r = await d.exec(argv, TIMEOUT_MS).catch(() => null);
  return r && r.code === 0 ? r.out : null;
}

const settle = async <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

/** Every check, read now. */
export async function readItChecks(d: ItCheckDeps): Promise<ItCheck[]> {
  const s = d.settings;
  const [disks, units, failed, docker, journal, backups, leftovers, sizes, certs] = await Promise.all([
    settle(d.disks(), []),
    s.units.length ? out(d, ['systemctl', 'show', '--no-pager', '-p', 'Id,LoadState,ActiveState', ...s.units]) : Promise.resolve(null),
    out(d, ['systemctl', 'list-units', '--state=failed', '--no-legend', '--plain', '--no-pager']),
    out(d, ['docker', 'system', 'df']),
    out(d, ['journalctl', '--disk-usage']),
    out(d, ['find', s.backupDir, '-mindepth', '1', '-maxdepth', '1', '-printf', '%T@ %p\\n']),
    settle(d.leftoversMb(), NaN),
    settle(d.measure([d.dirs.qaShots, d.dirs.files]), [NaN, NaN]),
    Promise.all(s.hosts.map(async (host) => d.certExpiry(host).then((expires) => ({ host, expires }), (err: Error) => ({ host, expires: null, error: err.message })))),
  ]);
  const m = d.memory();
  return [
    diskCheck(disks, d.samples, s, d.now),
    memoryCheck(m, s),
    loadCheck(m, s),
    unitsCheck(units === null ? null : parseUnits(units)),
    failedCheck(failed === null ? null : parseFailed(failed)),
    dockerCheck(docker === null ? null : parseDockerDf(docker), s),
    sizeCheck('leftovers', "Agents' leftovers", leftovers * MB, s.leftoversWarnGb, 'the cleanup would free'),
    sizeCheck('qaShots', 'QA screenshots', sizes[0] * MB, s.qaShotsWarnGb, 'of QA screenshots'),
    sizeCheck('logs', 'System logs', journal === null ? NaN : parseJournalUsage(journal), s.logsWarnGb, 'of journal logs'),
    sizeCheck('files', 'Files store', sizes[1] * MB, s.filesWarnGb, 'of uploaded files'),
    backupsCheck(backups === null ? null : parseNewest(backups), s, d.now),
    certsCheck(certs, s, d.now),
  ].map((c) => ({ ...c, at: d.now }));
}

/** When a host's TLS certificate expires (ms), read from its handshake; throws when it can't be reached. */
export function certExpiry(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 8000, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const at = cert?.valid_to ? Date.parse(cert.valid_to) : NaN;
      if (Number.isFinite(at)) resolve(at);
      else reject(new Error('no certificate'));
    });
    socket.on('timeout', () => socket.destroy(new Error('timed out')));
    socket.on('error', (err) => reject(err));
  });
}
