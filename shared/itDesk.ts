// The IT desk (#506): the CEO's commands on this machine. Reads run at once through it_run (an allowlist of read-only
// programs); changes come to the manager as cards (it_propose) and run only on their Run. The rules are in
// server/itDesk.ts; this file has what both sides show: the cards, the log and the read-only list.
import type { CfChange } from './cloudflare';
import type { ProviderChange } from './providerActions';

export type ItRisk = 'low' | 'medium' | 'high';

/** A change the CEO proposed, waiting for the manager's Run or Not now. */
export interface ItProposal {
  id: string;
  argv: string[];
  why: string;
  affects: string; // what it changes or frees
  undo: string; // how to undo it, or "backed up to X"
  risk: ItRisk;
  at: number;
  by?: string; // who proposed it: the IT lead (#524); absent: the CEO, before the IT department
  rec?: string; // a recommendation's option the manager picked (#525): the office measures before and after, IT isn't woken
  cf?: CfChange; // a Cloudflare write (#586): applied through the API on Approve, not run as a command
  pa?: ProviderChange; // another provider's write (#602), the same way
  diff?: string; // its before and after, "+ " on added lines
}

/** One command the IT desk ran (or refused at Run). */
export interface ItLogEntry {
  id: string;
  at: number;
  kind: 'read' | 'change';
  by: string; // who asked: the CEO's name; for a change, "<manager>, proposed by <CEO>"
  argv: string[];
  code: number | null; // null: it didn't run (refused) or was killed
  out: string; // its output, short and masked
  why?: string;
  auto?: true; // run by auto-approve (#585), without the manager's tap
  undo?: string[][]; // an auto step's undo, run on the manager's Undo
  undone?: true;
}

/** What the office keeps in its state file. */
export interface ItDeskState {
  waiting: ItProposal[];
  log: ItLogEntry[]; // newest first, IT_LOG_KEPT at most
  units?: string[]; // systemd units IT installed itself (#585): routine auto-approve may start and restart them
}

/** What a tab sees: whether it's on, the waiting cards, and the latest IT_LOG_SHOWN log lines. */
export interface ItDeskView extends ItDeskState {
  on: boolean;
}

export const IT_LOG_KEPT = 200;
export const IT_LOG_SHOWN = 30;

/** The read-only programs it_run runs, as Settings shows them. */
export const IT_READ_ONLY: { program: string; what: string }[] = [
  { program: 'df', what: 'free space per disk' },
  { program: 'du', what: 'folder sizes (one disk, low priority, 2 min at most)' },
  { program: 'free', what: 'memory and swap' },
  { program: 'ls, stat', what: 'files and folders' },
  { program: 'find', what: 'files by name, size or age (never -exec or -delete)' },
  { program: 'ps', what: 'running processes' },
  { program: 'systemctl', what: 'status, is-active, is-enabled, list-units, list-timers, cat' },
  { program: 'journalctl', what: '--disk-usage, or a unit\'s last lines' },
  { program: 'docker', what: 'ps, images, system df, volume ls' },
  { program: 'snap', what: 'list' },
  { program: 'git', what: 'status, log, remote -v, branch -vv' },
  { program: 'uptime, lsblk, mount', what: 'load, disks and mounts' },
];

/** The command as one line, for cards and the log. */
export function argvLine(argv: readonly string[]): string {
  return argv.map((a) => (a === '' || /[\s'"\\$`]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a)).join(' ');
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string');

/** The state file's IT desk, keeping only well-formed cards and log lines. */
export function loadItDesk(v: unknown): ItDeskState {
  const d = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof ItDeskState, unknown>>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && strings(e.argv) && Number.isFinite(e.at)) : []);
  const units = Array.isArray(d.units) ? d.units.filter((u): u is string => typeof u === 'string').slice(0, 100) : [];
  return { waiting: list(d.waiting) as ItProposal[], log: (list(d.log) as ItLogEntry[]).slice(0, IT_LOG_KEPT), ...(units.length && { units }) };
}
