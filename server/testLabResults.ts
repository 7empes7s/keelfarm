// The test lab's kept results (#562): every finished job's report and files in `.lab/<job>/result.json` of the
// requester's worktree, written whether or not the call that asked is still connected, so a caller the MCP client cut
// off reads it with lab_result instead of running the job again. Kept 24 h, the newest 20 per worktree.
import fs from 'node:fs';
import path from 'node:path';
import { labFile, labOutDir } from './testLab.ts';
import type { LabJobKind } from '../shared/testLab.ts';

const RESULT_KEEP_MS = 24 * 3600_000;
const RESULT_KEEP_MAX = 20;
/** A retry of the same request after a cut-off call gets the stored result when its job ended this recently. */
export const REUSE_MS = 30 * 60_000;

export interface LabStored {
  id: string;
  kind: LabJobKind;
  title: string;
  /** The request, as a key for a retry of the same one (requestKey). */
  key: string;
  ok: boolean;
  summary: string;
  report: string;
  artifacts: string[];
  queuedAt: number;
  startedAt: number | null;
  endedAt: number;
  /** The call that asked was gone when the job ended: nobody read the report yet. */
  callerGone: boolean;
}

/** The same request: its kind and every argument, in a stable order. */
export function requestKey(input: object): string {
  const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)])) : v);
  return JSON.stringify(sort(input));
}

/** The kept results to remove: older than RESULT_KEEP_MS, or past the newest RESULT_KEEP_MAX. */
export function expiredResults(rs: readonly Pick<LabStored, 'id' | 'endedAt'>[], now: number): string[] {
  const newest = [...rs].sort((a, b) => b.endedAt - a.endedAt);
  return newest.filter((r, i) => i >= RESULT_KEEP_MAX || now - r.endedAt > RESULT_KEEP_MS).map((r) => r.id);
}

/** lab_result's answer: what ran, when, and its report as the call would have returned it. */
export function resultText(r: LabStored, now: number): string {
  return [`Lab job ${r.id}: ${r.title}, ended ${Math.max(0, Math.round((now - r.endedAt) / 60_000))} min ago (${r.ok ? 'passed' : 'failed'}: ${r.summary}).`, r.report].join('\n');
}

const resultFile = (worktree: string, id: string, forbidden: readonly string[]) => labFile(labOutDir(worktree, id, forbidden), 'result.json');

/** A kept result, or null when there is none (never ran here, removed, or unreadable). */
export function readResult(worktree: string, id: string, forbidden: readonly string[]): LabStored | null {
  try {
    return JSON.parse(fs.readFileSync(resultFile(worktree, id, forbidden), 'utf8')) as LabStored;
  } catch {
    return null;
  }
}

/** Every kept result in a worktree's .lab/, newest first. Folders without one (older jobs, running ones) are left alone. */
export function listResults(worktree: string, forbidden: readonly string[]): LabStored[] {
  let ids: string[];
  try {
    ids = fs.readdirSync(path.join(worktree, '.lab'), { withFileTypes: true }).filter((d) => d.isDirectory() && /^[\w-]+$/.test(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
  return ids.flatMap((id) => readResult(worktree, id, forbidden) ?? []).sort((a, b) => b.endedAt - a.endedAt);
}

/** Keep a finished job's result (temp file, then rename), then remove the expired ones' folders. */
export function saveResult(worktree: string, r: LabStored, forbidden: readonly string[], now = Date.now()) {
  const file = resultFile(worktree, r.id, forbidden);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(path.join(worktree, '.lab', '.gitignore'), '*\n'); // .lab/ never shows up in git status
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(r, null, 1));
  fs.renameSync(`${file}.tmp`, file);
  for (const id of expiredResults(listResults(worktree, forbidden), now)) fs.rmSync(labOutDir(worktree, id, forbidden), { recursive: true, force: true, maxRetries: 3 });
}
