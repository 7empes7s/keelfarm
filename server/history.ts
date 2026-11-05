// The daily work log and session history (#49). After every session the office runs (and every PR it merges) an entry
// goes to <daily dir>/YYYY-MM-DD.md (UTC; the machine's /opt/ai-vault/daily when it exists, else <SWARM_HOME>/daily),
// and the session's Claude Code transcript is copied, gzipped, to <history>/YYYY/MM/DD/<agent>-<kind>-<session>.jsonl.gz
// so it outlives Claude Code's own cleanup and the worktree. The entries are indexed in <history>/index.jsonl (kept in
// memory) for the History screen and the CEO's session_history; a nightly sweep drops what's past the retention and
// writes finished days' totals. Writes go one at a time, each entry in a single append, so parallel sessions never
// interleave lines. The rules and formats are pure, in shared/history.ts.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import {
  dayHeading,
  daysToTotal,
  dayTotals,
  expiredDays,
  filterHistory,
  formatEntry,
  keptEntries,
  readTranscript,
  safeSessionId,
  transcriptPath,
  utcDay,
  type HistoryDetail,
  type HistoryEntry,
  type HistoryFilter,
  type HistoryPage,
  type HistoryUsage,
} from '../shared/history.ts';

/** The machine's daily log folder (/root/CLAUDE.md's rule): the default when it exists, outside the demo and tests. */
export const MACHINE_DAILY_DIR = '/opt/ai-vault/daily';

/**
 * Where the daily log goes: the manager's folder from Settings, else the machine's when it has one, else
 * <home>/daily. The demo always writes inside its own home (demo-daily), whatever the setting says.
 */
export function dailyLogDir(setting: string, o: { demo: boolean; home: string; machineDir: string | null }): string {
  if (o.demo) return path.join(o.home, 'demo-daily');
  if (setting.trim()) return path.resolve(setting.trim());
  return o.machineDir ?? path.join(o.home, 'daily');
}

/** Claude Code's folder of transcripts: <CLAUDE_CONFIG_DIR or ~/.claude>/projects. */
export const claudeProjectsDir = (env: NodeJS.ProcessEnv = process.env, home = os.homedir()) => path.join(env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, '.claude'), 'projects');

/** The folder Claude Code keeps a working directory's sessions in: every character but letters and digits becomes "-". */
export const projectFolder = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

// Claude Code shortens folder names past this many characters (adding a hash), so a long path is looked up by its start.
const LONG_FOLDER = 200;

/**
 * The transcript of session `sessionId` run in `cwd`: <projects>/<folder of cwd>/<id>.jsonl, else (a long path's
 * shortened folder, or a session that moved) the first project folder that has <id>.jsonl. Null when there's none.
 */
export async function findTranscript(projectsDir: string, cwd: string, sessionId: string): Promise<string | null> {
  if (!safeSessionId(sessionId)) return null;
  const file = `${sessionId}.jsonl`;
  const folder = projectFolder(cwd);
  const exists = (p: string) => fsp.stat(p).then((s) => s.isFile(), () => false);
  const direct = path.join(projectsDir, folder, file);
  if (await exists(direct)) return direct;
  const dirs = await fsp.readdir(projectsDir).catch(() => [] as string[]);
  const prefix = folder.slice(0, LONG_FOLDER);
  const ordered = [...dirs.filter((d) => d.startsWith(prefix)), ...dirs.filter((d) => !d.startsWith(prefix))];
  for (const d of ordered) {
    const p = path.join(projectsDir, d, file);
    if (await exists(p)) return p;
  }
  return null;
}

const int = (v: unknown) => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) ? n : undefined;
};
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined);

/** GET /api/history's query as a filter: repo, agent, kind, outcome, q, issue, pr, since, until, offset, limit. */
export function historyFilter(q: Record<string, unknown>): HistoryFilter {
  return {
    repoId: typeof q.repo === 'string' && q.repo ? q.repo : undefined,
    agent: text(q.agent),
    kind: text(q.kind),
    outcome: text(q.outcome),
    q: text(q.q),
    issue: int(q.issue),
    pr: int(q.pr),
    since: int(q.since),
    until: int(q.until),
    offset: int(q.offset),
    limit: int(q.limit),
  };
}

/** One file's appends, in order, each as a single write: concurrent writers never interleave their lines. */
export class Appender {
  private chains = new Map<string, Promise<void>>();

  append(file: string, text: () => Promise<string> | string): Promise<void> {
    const prev = this.chains.get(file) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.appendFile(file, await text());
      })
      .catch((err) => console.warn(`could not write ${file}`, err));
    this.chains.set(file, next);
    void next.then(() => this.chains.get(file) === next && this.chains.delete(file));
    return next;
  }
}

// What opening a session reads of its transcript at most: the view shows its first steps, not hundreds of megabytes.
const READ_BYTES = 8 * 1024 * 1024;

/** The start of a gzipped file, unzipped; `more` when it goes on past READ_BYTES (its last, torn line is skipped later). */
async function readStart(file: string): Promise<{ text: string; more: boolean }> {
  const parts: Buffer[] = [];
  let size = 0;
  const source = fs.createReadStream(file);
  const stream = zlib.createGunzip();
  source.on('error', (err) => stream.destroy(err)); // pipe() alone would leave a missing file's error unhandled
  source.pipe(stream);
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    parts.push(chunk);
    size += chunk.length;
    if (size >= READ_BYTES) {
      source.destroy();
      stream.destroy();
      return { text: Buffer.concat(parts).subarray(0, READ_BYTES).toString('utf8'), more: true };
    }
  }
  return { text: Buffer.concat(parts).toString('utf8'), more: false };
}

interface Meta {
  totalled: string | null; // the last day whose totals are in the daily log
}

export class SessionHistory {
  private entries: HistoryEntry[] = [];
  private meta: Meta = { totalled: null };
  private writes = new Appender();
  private headed = new Set<string>(); // daily files known to have the office's heading

  constructor(
    private o: {
      dir: string; // the history folder
      dailyDir: () => string;
      secrets: () => string[];
      now?: () => number;
    },
  ) {}

  private now = () => (this.o.now ?? Date.now)();
  private get index() {
    return path.join(this.o.dir, 'index.jsonl');
  }
  private get metaFile() {
    return path.join(this.o.dir, 'meta.json');
  }
  /** The kept transcript's file on disk. */
  file = (rel: string) => path.join(this.o.dir, ...rel.split('/'));

  async load() {
    const text = await fsp.readFile(this.index, 'utf8').catch(() => '');
    this.entries = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as HistoryEntry;
        if (e && typeof e.id === 'string' && typeof e.at === 'number') this.entries.push(e);
      } catch {
        // a torn last line
      }
    }
    const meta = await fsp.readFile(this.metaFile, 'utf8').then((t) => JSON.parse(t) as Meta, () => null);
    this.meta = { totalled: typeof meta?.totalled === 'string' ? meta.totalled : null };
  }

  all(): readonly HistoryEntry[] {
    return this.entries;
  }

  /**
   * A finished session (or merge): its transcript copied from `source` when there is one, then its index line and its
   * daily log entry. Never throws.
   */
  async record(entry: HistoryEntry, source: string | null): Promise<HistoryEntry> {
    const e = { ...entry };
    if (source && e.sessionId && safeSessionId(e.sessionId)) {
      const rel = transcriptPath(e, e.sessionId);
      const ok = await this.copy(source, this.file(rel)).then(() => true, (err) => (console.warn(`could not keep the transcript ${source}`, err), false));
      e.transcript = ok ? rel : null;
    }
    this.entries.push(e);
    await Promise.all([this.writes.append(this.index, () => `${JSON.stringify(e)}\n`), this.daily(e)]);
    return e;
  }

  /** Gzips a transcript to `to`, through a temp file so a half-written copy never shows. */
  private async copy(from: string, to: string) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    const tmp = `${to}.${process.pid}.tmp`;
    await pipeline(fs.createReadStream(from), zlib.createGzip(), fs.createWriteStream(tmp));
    await fsp.rename(tmp, to);
  }

  private daily(e: HistoryEntry) {
    const day = utcDay(e.at);
    const file = path.join(this.o.dailyDir(), `${day}.md`);
    return this.writes.append(file, async () => {
      let head = '';
      if (!this.headed.has(file)) {
        const had = await fsp.readFile(file, 'utf8').catch(() => '');
        if (!had.includes(dayHeading(day).trim())) head = `${had && !had.endsWith('\n\n') ? '\n' : ''}${dayHeading(day)}`;
        this.headed.add(file);
      }
      return head + formatEntry(e, { transcriptFile: e.transcript ? this.file(e.transcript) : null, secrets: this.o.secrets() });
    });
  }

  page(f: HistoryFilter): HistoryPage {
    return filterHistory(this.entries, f);
  }

  /** One entry with its transcript, readable and scrubbed. */
  async detail(id: string): Promise<HistoryDetail | null> {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return null;
    if (!entry.transcript) return { entry, transcript: null, cut: false };
    const read = await readStart(this.file(entry.transcript)).catch(() => null);
    if (read === null) return { entry, transcript: null, cut: false };
    const { items, cut } = readTranscript(read.text, this.o.secrets());
    return { entry, transcript: items, cut: cut || read.more };
  }

  /**
   * The nightly sweep: entries and day folders older than `keepDays` go (0 keeps everything), and each finished day's
   * totals go to its daily log once. `usage`: Claude's usage now, for the day that just ended.
   */
  async sweep(keepDays: number, usage: string | null) {
    const now = this.now();
    for (const day of daysToTotal(this.entries, now, this.meta.totalled)) {
      await this.writes.append(path.join(this.o.dailyDir(), `${day}.md`), () => dayTotals(this.entries, day, day === utcDay(now - 86_400_000) ? usage : null));
      this.meta.totalled = day;
    }
    await this.writeFile(this.metaFile, JSON.stringify(this.meta));
    const kept = keptEntries(this.entries, now, keepDays);
    if (kept.length !== this.entries.length) {
      this.entries = kept;
      await this.writeFile(this.index, kept.map((e) => `${JSON.stringify(e)}\n`).join(''));
    }
    for (const d of expiredDays(await this.dayFolders(), now, keepDays)) await fsp.rm(path.join(this.o.dir, ...d.split('/')), { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }

  /** The rewritten file through a temp file and a rename, in line with the appends. */
  private writeFile(file: string, text: string) {
    return this.writes.append(file, async () => {
      const tmp = `${file}.tmp`;
      await fsp.writeFile(tmp, text);
      await fsp.rename(tmp, file);
      return '';
    });
  }

  private async dayFolders(): Promise<string[]> {
    const out: string[] = [];
    const sub = (p: string) => fsp.readdir(p).then((l) => l.filter((n) => /^\d+$/.test(n)), () => [] as string[]);
    for (const y of await sub(this.o.dir)) for (const m of await sub(path.join(this.o.dir, y))) for (const d of await sub(path.join(this.o.dir, y, m))) out.push(`${y}/${m}/${d}`);
    return out;
  }

  /** Settings' disk-usage line: the folders, and the size of the kept transcripts. */
  async usage(): Promise<HistoryUsage> {
    let bytes = 0;
    let files = 0;
    for (const d of await this.dayFolders()) {
      const dir = path.join(this.o.dir, ...d.split('/'));
      for (const f of await fsp.readdir(dir).catch(() => [] as string[])) {
        const s = await fsp.stat(path.join(dir, f)).catch(() => null);
        if (s?.isFile()) {
          bytes += s.size;
          files++;
        }
      }
    }
    return { dailyDir: this.o.dailyDir(), historyDir: this.o.dir, bytes, files, sessions: this.entries.length };
  }
}
