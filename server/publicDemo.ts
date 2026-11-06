// The public demo (#95, docs/public-demo.md): `--demo --public-demo` for visitors over a tunnel. Its pure rules: when it
// may start, which requests it refuses, host paths scrubbed from what goes out, per-visitor rate limits, the upload cap
// and when the office resets itself. index.ts wires them in.

import path from 'node:path';
import { fileKind } from '../shared/files.ts';

const PUBLIC_DEMO_IDLE_MS = 30 * 60_000;
export const PUBLIC_DEMO_FILE_BYTES = 5 * 1024 * 1024;
const PUBLIC_DEMO_FILES_BYTES = 50 * 1024 * 1024;
/** Where the demo's pretend project folders live (server/demo.ts). */
const FAKE_FOLDERS = '/demo/projects';
/** What host paths read as instead. */
const SCRUBBED = '~/demo';

/** Why the public demo can't start (null: it can): only over the demo, on loopback, with a SWARM_HOME of its own (it wipes it). */
export function publicDemoProblem(o: { demo: boolean; loopback: boolean; home: string | undefined; defaultHome: string }): string | null {
  if (!o.demo) return '--public-demo needs --demo';
  if (!o.loopback) return '--public-demo only listens on loopback (127.0.0.1): unset SWARM_HOST, the tunnel connects locally';
  if (!o.home?.trim()) return '--public-demo needs a SWARM_HOME of its own: it is wiped at every reset';
  if (path.resolve(o.home) === path.resolve(o.defaultHome)) return `--public-demo won't wipe ${o.defaultHome}: give it a SWARM_HOME of its own`;
  return null;
}

// ---------- the route guard ----------

/** Settings a visitor may change: how the demo office looks and behaves. Everything else (models, CLIs, folders, notifications, keys) is refused. */
const OPEN_SETTINGS = new Set([
  'sessionLimit', 'defaultEffort', 'taskEffort', 'scaling', 'maxAgents', 'ceoHeartbeatMin', 'researchMin', 'ceoFollowups', 'ceoMandates', 'ceoAwake',
  'managerName', 'companyName', 'dogName', 'setupDone', 'tutorialStep', 'pacingSessions', 'historyDays', 'voice', 'listen', 'themes', 'weather',
  'worldEvents', 'everyProject', 'officePlaybook',
]);

/** Refused outright: keys, tokens, notification setup, the office's own update. The demo's own Telegram scene stays. */
const CLOSED = [/^\/api\/notify\/(?!telegram\/demo$)/, /^\/api\/office\//, /^\/api\/voice\/key$/, /^\/api\/cloud\/(key|token)$/];

/** A path as Express routes it (case-insensitive, trailing slashes ignored), so `/API/Settings/` is checked as `/api/settings`. */
export const routePath = (p: string) => p.toLowerCase().replace(/\/+$/, '') || '/';

const notInDemo = (what: string) => `Not in the demo: ${what} in your own office (npx cubefarm).`;

/** Why the public demo refuses this request (a friendly 403), or null to let it through. */
export function publicDemoBlock(method: string, url: string, body: unknown): string | null {
  const u = new URL(url, 'http://demo');
  const p = routePath(u.pathname);
  if (method === 'PATCH' && p === '/api/settings') {
    const keys = body && typeof body === 'object' ? Object.keys(body) : [];
    return keys.some((k) => !OPEN_SETTINGS.has(k)) ? notInDemo('this setting only works') : null;
  }
  if (method !== 'GET' && CLOSED.some((re) => re.test(p))) return notInDemo('keys, notifications and updates only work');
  if (p === '/api/folders') {
    const dir = u.searchParams.get('dir');
    if (dir && !fakeFolder(dir)) return notInDemo("this machine's folders only open");
  }
  return null;
}

/** A folder among the demo's pretend ones. */
function fakeFolder(dir: string): boolean {
  const d = path.posix.normalize(dir.trim().replace(/\\/g, '/'));
  return d === FAKE_FOLDERS || d.startsWith(`${FAKE_FOLDERS}/`);
}

// ---------- host paths ----------

/** The folders worth hiding, longest first: one-segment ones like `/` or `C:\` would turn every slash into the placeholder. */
export function scrubRoots(dirs: string[]): string[] {
  const all = dirs.map((d) => d.replace(/[\\/]+$/, '')).filter((d) => d.length >= 4);
  // Their JSON-escaped spellings too (Windows' backslashes come out doubled in a JSON body).
  const withJson = all.flatMap((d) => (d.includes('\\') ? [d, d.replace(/\\/g, '\\\\')] : [d]));
  return [...new Set(withJson)].sort((a, b) => b.length - a.length);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A scrubber for these roots: every one of them, as a whole path segment, becomes `~/demo`. */
export function pathScrubber(roots: string[]): (text: string) => string {
  if (!roots.length) return (t) => t;
  // Whole paths only (not `/root` inside github.com/root or /rooted), right after a terminal colour too.
  const re = new RegExp(`(?<=^|[^A-Za-z0-9._-]|\\[[0-9;]*m)(?:${roots.map(escape).join('|')})(?![A-Za-z0-9._-])`, 'g');
  return (text) => text.replace(re, SCRUBBED);
}

// ---------- rate limits ----------

/** Per-visitor token buckets: `burst` at once, refilled at `perSec`. Old visitors are forgotten so the map stays small. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private burst: number,
    private perSec: number,
    private maxKeys = 10_000,
  ) {}

  /** Whether `key` may go ahead now (taking a token). */
  take(key: string, now = Date.now()): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.forget(now);
      b = { tokens: this.burst, at: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.perSec);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Drops full buckets (visitors who've been quiet long enough); if none are, the oldest. */
  private forget(now: number) {
    const full = (this.burst / this.perSec) * 1000;
    for (const [k, b] of this.buckets) if (now - b.at >= full) this.buckets.delete(k);
    if (this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
  }
}

/** Who's asking: Cloudflare's CF-Connecting-IP when the request came through the local tunnel, else the socket's address. */
export function clientIp(remote: string | undefined, header: string | string[] | undefined): string {
  const r = (remote ?? '').replace(/^::ffff:/, '');
  const loop = r === '::1' || r.startsWith('127.');
  const cf = Array.isArray(header) ? header[0] : header;
  return loop && cf?.trim() ? cf.trim() : r || 'unknown';
}

// ---------- uploads ----------

/** Why a visitor's upload is refused before a byte is read (null: it may go): images, PDFs and plain text only. */
export function demoUploadProblem(name: string, type: string): string | null {
  const kind = fileKind(name, type);
  const scripted = /\.(svg|html?)$/i.test(name) || /svg|html/i.test(type);
  return (kind === 'image' || kind === 'pdf' || kind === 'text') && !scripted ? null : 'In the demo you can attach images, PDFs and text files.';
}

/** The files to drop, oldest first, until the store is back under `total` bytes. `files` newest first, like FileStore.list(). */
export function filesOverCap(files: readonly { id: string; size: number }[], total = PUBLIC_DEMO_FILES_BYTES): string[] {
  let sum = files.reduce((n, f) => n + f.size, 0);
  const drop: string[] = [];
  for (let i = files.length - 1; i >= 0 && sum > total; i--) {
    drop.push(files[i].id);
    sum -= files[i].size;
  }
  return drop;
}

// ---------- reset ----------

/**
 * Whether the demo resets now: every `everyMs` since it started, and once the last visitor has been gone `idleMs`
 * (`goneAt`: when the last one left; null while someone is here or nobody has come since the start).
 */
export function resetDue(o: { now: number; startedAt: number; visitors: number; goneAt: number | null; everyMs: number; idleMs?: number }): 'schedule' | 'idle' | null {
  if (o.now - o.startedAt >= o.everyMs) return 'schedule';
  if (o.visitors === 0 && o.goneAt !== null && o.now - o.goneAt >= (o.idleMs ?? PUBLIC_DEMO_IDLE_MS)) return 'idle';
  return null;
}
