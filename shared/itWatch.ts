// IT monitoring (#525): the office's own checks on this machine (disk and its trend, memory and swap, load, services,
// failed units, Docker, agents' leftovers, QA screenshots, logs, the files store, backups, certificates), read in plain
// code every few minutes with no model call. Only a check getting worse wakes the IT lead, once per level and at most
// once an hour per check; IT answers with a recommendation (1-4 ranked options) the manager picks from. Pure: readings
// in, levels, wakes and words out. The office's side is server/itChecks.ts and server/swarm/itWatch.ts.
import { gb } from './health.ts';
import type { DiskReading } from './disk.ts';
import type { MemoryReading } from './health.ts';
import type { ItRisk } from './itDesk.ts';

type ItLevel = 'good' | 'warn' | 'bad';
/** off: the check has nothing to read on this machine (no Docker, no systemd, no backups folder). */
export type ItCheckLevel = ItLevel | 'off';
export type ItCheckId = 'disk' | 'memory' | 'load' | 'units' | 'failed' | 'docker' | 'leftovers' | 'qaShots' | 'logs' | 'files' | 'backups' | 'certs';

/** One check's latest reading, as the Health page and IT see it. */
export interface ItCheck {
  id: ItCheckId;
  label: string;
  level: ItCheckLevel;
  line: string; // one line: the numbers, e.g. "7.9 GB free on the system disk (/)"
  facts: string[]; // the evidence IT gets when woken (sizes, unit names)
  trend?: string; // e.g. "−2.1 GB/day · full in 4 days"
  at: number;
}

/** Settings → The IT department → Health: the checks' thresholds. */
export interface ItWatchSettings {
  on: boolean;
  diskWarnGb: number;
  diskBadGb: number; // the reserve
  swapWarnPct: number;
  swapBadPct: number;
  loadWarn: number; // 1-minute load per CPU
  loadBad: number;
  dockerWarnGb: number; // reclaimable
  leftoversWarnGb: number;
  qaShotsWarnGb: number;
  logsWarnGb: number;
  filesWarnGb: number;
  backupHours: number; // the newest backup older than this warns, twice this is bad
  certWarnDays: number;
  units: string[]; // systemd units that should be running; ones not on this machine are skipped
  hosts: string[]; // public hostnames whose certificates are checked
  backupDir: string;
}

export const IT_WATCH_DEFAULTS: ItWatchSettings = {
  on: true,
  diskWarnGb: 15,
  diskBadGb: 10,
  swapWarnPct: 50,
  swapBadPct: 80,
  loadWarn: 2,
  loadBad: 4,
  dockerWarnGb: 10,
  leftoversWarnGb: 5,
  qaShotsWarnGb: 2,
  logsWarnGb: 2,
  filesWarnGb: 10,
  backupHours: 36,
  certWarnDays: 14,
  units: ['caddy', 'cloudflared', 'keel-portal', 'keel-postgres', 'keel-status-generate.timer', 'keel-deploy.timer', 'keel-backup-tier1.timer', 'mimule-backup.timer'],
  hosts: ['keel.techinsiderbytes.com'],
  backupDir: '/opt/backups',
};

const NUMS = ['diskWarnGb', 'diskBadGb', 'swapWarnPct', 'swapBadPct', 'loadWarn', 'loadBad', 'dockerWarnGb', 'leftoversWarnGb', 'qaShotsWarnGb', 'logsWarnGb', 'filesWarnGb', 'backupHours', 'certWarnDays'] as const;
const names = (raw: unknown, re: RegExp) => (Array.isArray(raw) ? [...new Set(raw.map((x) => String(x).trim()).filter((x) => re.test(x)))].slice(0, 30) : null);

/** A settings patch over `prev`, field by field; anything wrong keeps what was there. */
export function itWatchSettings(prev: ItWatchSettings | undefined, raw: unknown): ItWatchSettings {
  const p = { ...IT_WATCH_DEFAULTS, ...prev };
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: ItWatchSettings = { ...p, on: typeof r.on === 'boolean' ? r.on : p.on };
  for (const k of NUMS) {
    const n = Number(r[k]);
    if (r[k] !== undefined && r[k] !== null && r[k] !== '' && Number.isFinite(n) && n >= 0) out[k] = Math.min(n, 100_000);
  }
  out.units = names(r.units, /^[\w@.:-]{1,80}$/) ?? p.units;
  out.hosts = names(r.hosts, /^[a-z0-9.-]{1,253}$/i) ?? p.hosts;
  if (typeof r.backupDir === 'string' && r.backupDir.trim().startsWith('/')) out.backupDir = r.backupDir.trim();
  return out;
}

// ---------- parsing what commands print ----------

const UNITS: Record<string, number> = { '': 1, B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
const DECIMAL: Record<string, number> = { '': 1, B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };

/** "11.2GB" (docker, decimal) or "3.9G" (journalctl, binary) → bytes; NaN when it isn't a size. */
export function sizeBytes(text: string): number {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGT]?B?)$/i);
  if (!m) return NaN;
  const unit = m[2].toUpperCase();
  return Number(m[1]) * (unit.length === 2 ? (DECIMAL[unit] ?? NaN) : (UNITS[unit.replace('B', '')] ?? 1));
}

const GiB = 1024 ** 3;
const gbOf = (bytes: number) => gb(bytes / 1024 ** 2);

/** `systemctl show -p Id,LoadState,ActiveState u1 u2…`: one block per unit, blank lines between. */
export function parseUnits(out: string): { id: string; loaded: boolean; active: string }[] {
  return out
    .split(/\r?\n\s*\r?\n/)
    .map((block) => Object.fromEntries(block.split(/\r?\n/).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) as Record<string, string>)
    .filter((u) => u.Id)
    .map((u) => ({ id: u.Id, loaded: u.LoadState !== 'not-found', active: u.ActiveState ?? 'unknown' }));
}

/** `systemctl list-units --state=failed --no-legend --plain`: the failed units' names. */
export function parseFailed(out: string): string[] {
  return out
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^●\s*/, '').split(/\s+/)[0])
    .filter((u) => !!u && /\.\w+$/.test(u));
}

/** `docker system df`: each row's size and what can be reclaimed, in bytes. */
export function parseDockerDf(out: string): { type: string; size: number; reclaimable: number }[] {
  const rows: { type: string; size: number; reclaimable: number }[] = [];
  for (const l of out.split(/\r?\n/)) {
    const m = l.match(/^(Images|Containers|Local Volumes|Build Cache)\s+\d+\s+\d+\s+(\S+)\s+(\S+)/);
    if (m) rows.push({ type: m[1], size: sizeBytes(m[2]) || 0, reclaimable: sizeBytes(m[3]) || 0 });
  }
  return rows;
}

/** `journalctl --disk-usage`: "Archived and active journals take up 3.9G in the file system." → bytes. */
export function parseJournalUsage(out: string): number {
  const m = out.match(/take up (\S+?)\s+in/);
  return m ? sizeBytes(m[1]) : NaN;
}

/** `find <dir> -mindepth 1 -maxdepth 1 -printf '%T@ %p\n'`: the newest entry (ms) and its name. */
export function parseNewest(out: string): { at: number; name: string } | null {
  let best: { at: number; name: string } | null = null;
  for (const l of out.split(/\r?\n/)) {
    const m = l.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (m && (!best || Number(m[1]) * 1000 > best.at)) best = { at: Math.round(Number(m[1]) * 1000), name: m[2].split('/').pop() ?? m[2] };
  }
  return best;
}

// ---------- checks: a reading → a level ----------

type Made = Omit<ItCheck, 'at'>;
const off = (id: ItCheckId, label: string, line: string): Made => ({ id, label, level: 'off', line, facts: [] });

/** One free-space sample (the fullest disk), for the trend. */
export interface DiskSample {
  at: number;
  freeMb: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SAMPLES_KEPT = 7 * 24;

/** Keeps one sample an hour for a week. */
export function addDiskSample(samples: DiskSample[], s: DiskSample): DiskSample[] {
  const last = samples.at(-1);
  if (last && s.at - last.at < HOUR) return samples;
  return [...samples, s].slice(-SAMPLES_KEPT);
}

/** GB a day (negative: filling) from the oldest sample at least 6 hours back, and the days left at that pace. */
export function diskTrend(samples: readonly DiskSample[], now: DiskSample): { gbPerDay: number; fullInDays: number | null } | null {
  const from = samples.find((x) => now.at - x.at >= 6 * HOUR);
  if (!from) return null;
  const gbPerDay = ((now.freeMb - from.freeMb) / 1024) * (DAY / (now.at - from.at));
  return { gbPerDay, fullInDays: gbPerDay < -0.05 ? Math.floor(now.freeMb / 1024 / -gbPerDay) : null };
}

/** The disks the office writes to: the fullest one sets the level. */
export function diskCheck(disks: readonly DiskReading[], samples: readonly DiskSample[], s: ItWatchSettings, now: number): Made {
  if (!disks.length) return off('disk', 'Disk', 'No reading yet');
  const worst = [...disks].sort((a, b) => a.freeMb - b.freeMb)[0];
  const level: ItLevel = worst.freeMb < s.diskBadGb * 1024 ? 'bad' : worst.freeMb < s.diskWarnGb * 1024 ? 'warn' : 'good';
  const t = diskTrend(samples, { at: now, freeMb: worst.freeMb });
  const trend = t && `${t.gbPerDay < 0 ? '−' : '+'}${Math.abs(t.gbPerDay).toFixed(1)} GB/day${t.fullInDays !== null ? ` · full in ${t.fullInDays} day${t.fullInDays === 1 ? '' : 's'}` : ''}`;
  return {
    id: 'disk',
    label: 'Disk',
    level,
    line: `${gb(worst.freeMb)} free on ${worst.label.toLowerCase()} (${worst.path})`,
    facts: disks.map((d) => `${d.label} (${d.path}): ${gb(d.freeMb)} free of ${gb(d.totalMb)}`).concat(`warn under ${s.diskWarnGb} GB, bad under ${s.diskBadGb} GB`),
    ...(trend && { trend }),
  };
}

/** Memory and swap: swap in use sets the level. */
export function memoryCheck(m: MemoryReading | null, s: ItWatchSettings): Made {
  if (!m) return off('memory', 'Memory and swap', 'No reading yet');
  const swapPct = m.swapTotalMb > 0 ? Math.round(((m.swapTotalMb - m.swapFreeMb) / m.swapTotalMb) * 100) : 0;
  const level: ItLevel = swapPct > s.swapBadPct ? 'bad' : swapPct > s.swapWarnPct ? 'warn' : 'good';
  return { id: 'memory', label: 'Memory and swap', level, line: `${gb(m.availableMb)} of ${gb(m.totalMb)} memory free · swap ${swapPct}% used`, facts: [`swap ${gb(m.swapTotalMb - m.swapFreeMb)} of ${gb(m.swapTotalMb)}`, `warn over ${s.swapWarnPct}%, bad over ${s.swapBadPct}%`] };
}

/** The 1-minute load per CPU. */
export function loadCheck(m: MemoryReading | null, s: ItWatchSettings): Made {
  if (!m || m.load === null) return off('load', 'Load', 'No load average on this machine');
  const per = m.load / Math.max(1, m.cpus);
  const level: ItLevel = per > s.loadBad ? 'bad' : per > s.loadWarn ? 'warn' : 'good';
  return { id: 'load', label: 'Load', level, line: `${m.load.toFixed(2)} on ${m.cpus} CPU${m.cpus === 1 ? '' : 's'}`, facts: [`warn over ${s.loadWarn} per CPU, bad over ${s.loadBad}`] };
}

/** The office's services: any unit on this machine that isn't running is bad. */
export function unitsCheck(units: ReturnType<typeof parseUnits> | null): Made {
  if (!units) return off('units', 'Services', 'systemd isn\'t on this machine');
  const here = units.filter((u) => u.loaded);
  if (!here.length) return off('units', 'Services', 'None of the listed units are on this machine');
  const down = here.filter((u) => !['active', 'activating', 'reloading'].includes(u.active));
  const missing = units.filter((u) => !u.loaded).map((u) => u.id);
  return {
    id: 'units',
    label: 'Services',
    level: down.length ? 'bad' : 'good',
    line: down.length ? `Down: ${down.map((u) => u.id).join(', ')}` : `${here.length} running`,
    facts: [...here.map((u) => `${u.id}: ${u.active}`), ...(missing.length ? [`not on this machine: ${missing.join(', ')}`] : [])],
  };
}

export function failedCheck(failed: string[] | null): Made {
  if (!failed) return off('failed', 'Failed units', 'systemd isn\'t on this machine');
  return { id: 'failed', label: 'Failed units', level: failed.length ? 'warn' : 'good', line: failed.length ? failed.join(', ') : 'None', facts: failed };
}

export function dockerCheck(rows: ReturnType<typeof parseDockerDf> | null, s: ItWatchSettings): Made {
  if (!rows?.length) return off('docker', 'Docker disk', 'Docker isn\'t on this machine');
  const size = rows.reduce((n, r) => n + r.size, 0);
  const free = rows.filter((r) => r.type !== 'Local Volumes').reduce((n, r) => n + r.reclaimable, 0); // volumes hold data (keel-postgres)
  return { id: 'docker', label: 'Docker disk', level: free > s.dockerWarnGb * GiB ? 'warn' : 'good', line: `${gbOf(size)} used · ${gbOf(free)} reclaimable`, facts: rows.map((r) => `${r.type}: ${gbOf(r.size)}, ${gbOf(r.reclaimable)} reclaimable`).concat(`warn over ${s.dockerWarnGb} GB reclaimable`) };
}

/** A folder or store that only warns when it grows past its line (bytes; NaN: couldn't be read). */
export function sizeCheck(id: ItCheckId, label: string, bytes: number, warnGb: number, what: string): Made {
  if (!Number.isFinite(bytes)) return off(id, label, `Couldn't measure ${what}`);
  return { id, label, level: bytes > warnGb * GiB ? 'warn' : 'good', line: `${gbOf(bytes)} ${what}`, facts: [`${gbOf(bytes)} ${what}`, `warn over ${warnGb} GB`] };
}

export function backupsCheck(newest: { at: number; name: string } | null, s: ItWatchSettings, now: number): Made {
  if (!newest) return off('backups', 'Backups', `No backups in ${s.backupDir}`);
  const hours = Math.max(0, Math.round((now - newest.at) / HOUR));
  const level: ItLevel = hours > s.backupHours * 2 ? 'bad' : hours > s.backupHours ? 'warn' : 'good';
  return { id: 'backups', label: 'Backups', level, line: `Newest ${newest.name}, ${hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`} old`, facts: [`${s.backupDir}/${newest.name}`, `warn over ${s.backupHours} h`] };
}

/** Each host's certificate: expires (ms), or why it couldn't be read. */
export function certsCheck(certs: { host: string; expires: number | null; error?: string }[], s: ItWatchSettings, now: number): Made {
  if (!certs.length) return off('certs', 'Certificates', 'No public hostnames listed');
  const days = certs.map((c) => ({ ...c, days: c.expires === null ? null : Math.floor((c.expires - now) / DAY) }));
  const bad = days.some((c) => c.days !== null && c.days < 3);
  const warn = days.some((c) => c.days === null || c.days < s.certWarnDays);
  const soonest = days.filter((c) => c.days !== null).sort((a, b) => a.days! - b.days!)[0];
  return {
    id: 'certs',
    label: 'Certificates',
    level: bad ? 'bad' : warn ? 'warn' : 'good',
    line: soonest ? `${soonest.host} expires in ${soonest.days} days` : `Couldn't read ${certs[0].host}`,
    facts: days.map((c) => (c.days === null ? `${c.host}: couldn't read (${c.error ?? 'no answer'})` : `${c.host}: ${c.days} days left`)),
  };
}

// ---------- waking IT ----------

const RANK: Record<ItLevel, number> = { good: 0, warn: 1, bad: 2 };
/** At most one wake per check this often. */
export const WAKE_EVERY_MS = HOUR;

/** The level a check last woke IT at (or fell back to), and when it last woke them. */
export interface ItWatchMark {
  level: ItLevel;
  wokeAt: number;
}

/**
 * Wake IT for this check? Only when it gets worse than its mark (good → warn, warn → bad), and not within an hour of its
 * last wake (it stays marked lower, so the next tick after the hour wakes). Getting better lowers the mark, so crossing
 * again later wakes again. The same level never wakes: no model call while nothing changes.
 */
export function wakeFor(mark: ItWatchMark | undefined, level: ItCheckLevel, now: number, everyMs = WAKE_EVERY_MS): { wake: boolean; mark: ItWatchMark | undefined } {
  if (level === 'off') return { wake: false, mark };
  const was = mark ?? { level: 'good' as ItLevel, wokeAt: 0 };
  if (RANK[level] < RANK[was.level]) return { wake: false, mark: { ...was, level } };
  if (RANK[level] === RANK[was.level] || now - was.wokeAt < everyMs) return { wake: false, mark };
  return { wake: true, mark: { level, wokeAt: now } };
}

/** The checks that wake IT this round, and the marks after it. Snoozed checks ("Not now") wake nobody until it ends. */
export function wakes(checks: readonly ItCheck[], marks: Partial<Record<ItCheckId, ItWatchMark>>, snoozed: ReadonlySet<ItCheckId>, now: number, everyMs = WAKE_EVERY_MS) {
  const next = { ...marks };
  const woken: ItCheck[] = [];
  for (const c of checks) {
    const r = wakeFor(marks[c.id], c.level, now, everyMs);
    if (r.mark) next[c.id] = r.mark;
    if (r.wake && !snoozed.has(c.id)) woken.push(c);
  }
  return { woken, marks: next };
}

/** What IT is told when woken: each check's level, line and evidence. */
export function wakeFacts(woken: readonly ItCheck[]): string {
  return woken.map((c) => `- ${c.label} is ${c.level.toUpperCase()}: ${c.line}${c.trend ? ` (${c.trend})` : ''}\n  ${c.facts.join('; ')}`).join('\n');
}

/** The daily digest's day key (local date), due once a day from 9 o'clock. */
export function digestDay(now: number): string | null {
  const d = new Date(now);
  return d.getHours() >= 9 ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null;
}

/** The daily digest: one line when all is well, else what needs a look. */
export function digestLine(checks: readonly ItCheck[]): string {
  const live = checks.filter((c) => c.level !== 'off');
  const wrong = live.filter((c) => c.level !== 'good');
  if (!wrong.length) return `🩺 Daily check: all good (${live.length} check${live.length === 1 ? '' : 's'}).`;
  return `🩺 Daily check: ${wrong.length} need${wrong.length === 1 ? 's' : ''} a look: ${wrong.map((c) => `${c.label} (${c.level}): ${c.line}`).join('; ')}.`;
}

// ---------- recommendations ----------

/** One option on a recommendation: one program, as argv, run through it_propose's approved path when picked. */
export interface ItOption {
  argv: string[];
  does: string; // what it does, in a few words
  frees: string; // what it frees or fixes, e.g. "frees 18 GB"
  risk: ItRisk;
  undo: string; // how to undo it, or "can't be undone"
}

/** IT's recommendation for a check: what's wrong, the evidence and 1-4 ranked options (best first). */
export interface ItRecommendation {
  id: string;
  check: ItCheckId;
  title: string;
  evidence: string;
  options: ItOption[];
  at: number;
  by: string;
  snoozedUntil: number | null; // "Not now": hidden and quiet until then
}

export const IT_OPTIONS_MAX = 4;
export const SNOOZE_MS = DAY;

/** Recommendations open now (not snoozed), newest first. */
export const openRecs = (recs: readonly ItRecommendation[], now: number) => recs.filter((r) => !r.snoozedUntil || r.snoozedUntil <= now).sort((a, b) => b.at - a.at);

/** Checks whose recommendation is snoozed now. */
export const snoozedChecks = (recs: readonly ItRecommendation[], now: number) => new Set(recs.filter((r) => r.snoozedUntil && r.snoozedUntil > now).map((r) => r.check));

/** Telegram's text for a recommendation: the problem, the evidence and the options in order. */
export function recText(r: ItRecommendation): string {
  return [`🩺 ${r.by}: ${r.title}`, r.evidence, ...r.options.map((o, i) => `${i + 1}. ${o.does}: ${o.frees} · ${o.risk} risk · ${o.undo}`)].join('\n');
}

/** What the manager sees after a pick ran and the checks were read again. */
export function beforeAfter(before: ItCheck | undefined, after: ItCheck | undefined): string {
  if (!before || !after) return '';
  return `Before: ${before.line} (${before.level}) → after: ${after.line} (${after.level})`;
}

/** The saved monitoring: the latest checks, their marks, the open recommendations, the digest and the disk's samples. */
export interface ItWatchState {
  checks: ItCheck[];
  marks: Partial<Record<ItCheckId, ItWatchMark>>;
  recs: ItRecommendation[];
  digestDay: string;
  samples: DiskSample[];
}

export function loadItWatch(raw: unknown): ItWatchState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ItWatchState>;
  return {
    checks: Array.isArray(r.checks) ? r.checks.filter((c) => c && typeof c.id === 'string') : [],
    marks: r.marks && typeof r.marks === 'object' ? r.marks : {},
    recs: Array.isArray(r.recs) ? r.recs.filter((x) => x && typeof x.id === 'string' && Array.isArray(x.options)) : [],
    digestDay: typeof r.digestDay === 'string' ? r.digestDay : '',
    samples: Array.isArray(r.samples) ? r.samples.filter((x) => x && Number.isFinite(x.at) && Number.isFinite(x.freeMb)).slice(-SAMPLES_KEPT) : [],
  };
}

/** What a tab sees: the checks, every recommendation (snoozed ones say until when) and the last run. */
export interface ItWatchView {
  on: boolean;
  checks: ItCheck[];
  recs: ItRecommendation[];
  running: boolean;
}
