// The daily work log and session history (#49): one entry per session the office ran (and per PR it merged), the
// Markdown each one adds to the machine's daily log, the day's totals, filtering for the History screen and the CEO's
// session_history, the retention rules, and a Claude Code transcript turned into something readable. Pure, shared by
// the server (server/history.ts) and the client (ui/HistoryTab.tsx).
import { redact } from './journal.ts';
import { TASK_KIND_LABELS, type SessionOutcome, type TaskKind } from './costs.ts';
import type { CeoJobInfo } from './ceoJobLog.ts';

export type HistoryKind = TaskKind | 'merge';
export type HistoryOutcome = SessionOutcome | 'merged';

/** One finished session, or a PR the office merged. Never holds a prompt or anything from the environment. */
export interface HistoryEntry {
  id: string;
  at: number; // when it ended
  startedAt: number;
  repoId: string; // '' for the CEO's company-wide jobs
  repo: string; // owner/name, '' for the company
  floor: number | null;
  agentId: string; // '' for the office's own merges
  agent: string;
  kind: HistoryKind;
  issue: number | null;
  pr: number | null;
  title: string; // the issue's or PR's title, or the CEO's job
  outcome: HistoryOutcome;
  note: string; // one line on why: QA's summary, the error
  usd: number;
  tokens: number | null;
  model: string;
  effort: string;
  account?: string; // the account (id) it ran on, when it ran on one (#376)
  sessionId: string | null;
  transcript: string | null; // the kept copy, relative to the history folder ('/'-separated), when there was one
  ceo?: CeoJobInfo; // a CEO job's: what started it and came of it, for the CEO jobs log (#332)
}

/** The History screen's and session_history's filters; every field narrows. */
export interface HistoryFilter {
  repoId?: string;
  agent?: string; // an id or a name
  kind?: string; // a HistoryKind, or 'fix' / 'ceo' for all of them
  outcome?: string;
  issue?: number;
  pr?: number;
  q?: string; // words in the title, outcome, note, agent or repo
  since?: number;
  until?: number;
  offset?: number;
  limit?: number;
}

export interface HistoryPage {
  entries: HistoryEntry[]; // newest first
  total: number;
  offset: number;
  more: boolean;
}

/** One step of a transcript as the History screen shows it. Tool calls and their results come collapsed. */
export interface TranscriptItem {
  role: 'user' | 'assistant' | 'tool' | 'result' | 'error';
  text: string;
  tool?: string;
  at?: number;
}

export interface HistoryDetail {
  entry: HistoryEntry;
  transcript: TranscriptItem[] | null; // null: none was kept
  cut: boolean; // the transcript was longer than what's shown
}

/** Settings → Daily log & history: where things go, and how much disk the kept transcripts take. */
export interface HistoryUsage {
  dailyDir: string;
  historyDir: string;
  bytes: number;
  files: number;
  sessions: number;
}

export const DEFAULT_HISTORY_DAYS = 90;
const MAX_HISTORY_DAYS = 3650;
const PAGE = 25;
const MAX_PAGE = 100;
const DAY_MS = 86_400_000;

export const clampHistoryDays = (n: unknown) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(0, Math.min(MAX_HISTORY_DAYS, v)) : DEFAULT_HISTORY_DAYS;
};

export const OUTCOME_LABELS: Record<HistoryOutcome, string> = {
  pr: 'PR opened',
  'no-pr': 'ended without a PR',
  commit: 'pushed a fix',
  'no-commit': 'pushed nothing',
  'no-change': 'said no change was needed',
  'qa-pass': 'QA passed',
  'qa-fail': 'QA failed',
  'ceo-acted': 'acted',
  'ceo-idle': 'changed nothing',
  done: 'done',
  interrupted: 'interrupted',
  stopped: 'stopped',
  watchdog: 'stopped by the watchdog',
  limited: "cut off by Claude's usage limit",
  error: 'failed',
  merged: 'merged',
};

export const kindLabel = (k: HistoryKind) => (k === 'merge' ? 'Merge' : TASK_KIND_LABELS[k]);

const pad = (n: number) => String(n).padStart(2, '0');
/** The UTC day a time falls on: the daily log's file name and the history's folders. */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utcTime = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const historyId = (at: number, agentId: string, kind: HistoryKind) => `${at.toString(36)}-${(agentId || 'office').replace(/[^\w-]/g, '')}-${kind}`;

/** The kept transcript's place under the history folder: YYYY/MM/DD/<agent>-<kind>-<session>.jsonl.gz (UTC). */
export function transcriptPath(e: Pick<HistoryEntry, 'at' | 'agent' | 'kind'>, sessionId: string): string {
  const d = new Date(e.at);
  const agent = e.agent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${agent}-${e.kind}-${sessionId.replace(/[^\w-]/g, '')}.jsonl.gz`;
}

/** A session id Claude Code could have made: safe to put in a file name. */
export const safeSessionId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);

function duration(ms: number) {
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${pad(min % 60)}m`;
}

const tokensText = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k tokens` : `${n} tokens`);

/** What an entry's work was: "#49 Daily work log", "PR #63", "the company". */
export function workLabel(e: Pick<HistoryEntry, 'issue' | 'pr' | 'title'>) {
  const ref = e.issue !== null ? `#${e.issue}` : e.pr !== null ? `PR #${e.pr}` : '';
  return [ref, e.title].filter(Boolean).join(' ') || 'the company';
}

/** The outcome in words, with its note: "QA failed: the panel overflows at 390 px". */
function outcomeLine(e: Pick<HistoryEntry, 'outcome' | 'note' | 'pr' | 'kind'>) {
  const label = e.outcome === 'pr' && e.pr !== null ? `PR #${e.pr} opened` : OUTCOME_LABELS[e.outcome];
  return e.note ? `${label}: ${oneLine(e.note, 200)}` : label;
}

/**
 * An entry as the daily log has it: a heading with the time range (UTC), who and what, then its outcome, links, cost
 * and the kept transcript. Everything free-form is scrubbed of `secrets` and anything shaped like a token.
 */
export function formatEntry(e: HistoryEntry, o: { transcriptFile: string | null; secrets: readonly string[] }): string {
  const clean = (s: string) => redact(s, o.secrets);
  const where = e.repo ? `${e.repo}${e.floor !== null ? ` (floor ${e.floor})` : ''}` : 'the company';
  const base = e.repo ? `https://github.com/${e.repo}` : '';
  const links = [e.issue !== null && base ? `${base}/issues/${e.issue}` : '', e.pr !== null && base ? `${base}/pull/${e.pr}` : ''].filter(Boolean);
  const cost = [e.kind === 'merge' ? '' : duration(e.at - e.startedAt), e.usd > 0 ? `$${e.usd.toFixed(2)}` : '', e.tokens ? tokensText(e.tokens) : '', e.model, e.effort ? `${e.effort} effort` : ''].filter(Boolean);
  const lines = [
    `### ${e.kind === 'merge' ? utcTime(e.at) : `${utcTime(e.startedAt)}–${utcTime(e.at)}`} UTC · ${clean(e.agent)} · ${kindLabel(e.kind)} · ${clean(oneLine(workLabel(e), 120))}`,
    `- Outcome: ${clean(outcomeLine(e))}`,
    `- Where: ${where}${links.length ? ` · ${links.join(' · ')}` : ''}`,
    ...(cost.length ? [`- Ran: ${cost.join(' · ')}`] : []),
    ...(o.transcriptFile ? [`- Transcript: ${o.transcriptFile}`] : []),
  ];
  return `${lines.join('\n')}\n\n`;
}

/** The heading the office puts in a day's log before its first entry (the file may hold other people's notes too). */
export const dayHeading = (day: string) => `## cubefarm office · ${day} (UTC)\n\n`;

/** A finished day's totals, appended after its last entry: sessions, merges, QA's pass rate, cost and usage. */
export function dayTotals(entries: readonly HistoryEntry[], day: string, usage: string | null): string {
  const of = entries.filter((e) => utcDay(e.at) === day);
  const sessions = of.filter((e) => e.kind !== 'merge');
  const merged = of.filter((e) => e.kind === 'merge').length;
  const passed = sessions.filter((e) => e.outcome === 'qa-pass').length;
  const failed = sessions.filter((e) => e.outcome === 'qa-fail').length;
  const usd = sessions.reduce((n, e) => n + e.usd, 0);
  const qa = passed + failed ? `${Math.round((passed / (passed + failed)) * 100)}% (${passed} of ${passed + failed})` : 'no QA verdicts';
  const parts = [`${sessions.length} session${sessions.length === 1 ? '' : 's'}`, `${merged} merged`, `QA pass rate ${qa}`, ...(usd > 0 ? [`$${usd.toFixed(2)}`] : []), ...(usage ? [`usage at end of day: ${usage}`] : [])];
  return `### cubefarm totals · ${day}\n- ${parts.join(' · ')}\n\n`;
}

// ---------- filtering ----------

const matchesKind = (k: HistoryKind, want: string) => k === want || (want === 'fix' && k.startsWith('fix-')) || (want === 'ceo' && k.startsWith('ceo-'));

/** The entries a filter keeps, newest first, a page at a time. */
export function filterHistory(entries: readonly HistoryEntry[], f: HistoryFilter): HistoryPage {
  const agent = f.agent?.trim().toLowerCase();
  const words = (f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const kept = entries.filter(
    (e) =>
      (f.repoId === undefined || e.repoId === f.repoId) &&
      (!agent || e.agentId.toLowerCase() === agent || e.agent.toLowerCase() === agent) &&
      (!f.kind || matchesKind(e.kind, f.kind)) &&
      (!f.outcome || e.outcome === f.outcome) &&
      (f.issue === undefined || e.issue === f.issue) &&
      (f.pr === undefined || e.pr === f.pr) &&
      (f.since === undefined || e.at >= f.since) &&
      (f.until === undefined || e.at < f.until) &&
      (!words.length || words.every((w) => [e.title, outcomeLine(e), e.agent, e.repo, e.issue !== null ? `#${e.issue}` : '', e.pr !== null ? `#${e.pr}` : ''].join(' ').toLowerCase().includes(w))),
  );
  kept.sort((a, b) => b.at - a.at);
  const offset = Math.max(0, Math.floor(f.offset ?? 0));
  const limit = Math.max(1, Math.min(MAX_PAGE, Math.floor(f.limit ?? PAGE)));
  return { entries: kept.slice(offset, offset + limit), total: kept.length, offset, more: offset + limit < kept.length };
}

// ---------- retention ----------

/** The entries a retention of `keepDays` keeps (0 keeps everything). */
export const keptEntries = (entries: readonly HistoryEntry[], now: number, keepDays: number) => (keepDays > 0 ? entries.filter((e) => now - e.at <= keepDays * DAY_MS) : [...entries]);

/** Day folders ("YYYY/MM/DD") whose whole day is older than `keepDays`: the nightly sweep removes them. */
export function expiredDays(days: readonly string[], now: number, keepDays: number): string[] {
  if (keepDays <= 0) return [];
  const oldest = utcDay(now - keepDays * DAY_MS);
  return days.filter((d) => /^\d{4}\/\d{2}\/\d{2}$/.test(d) && d.replace(/\//g, '-') < oldest);
}

/** The days before today that have entries and no totals in the log yet. */
export const daysToTotal = (entries: readonly HistoryEntry[], now: number, totalled: string | null) => [...new Set(entries.map((e) => utcDay(e.at)))].filter((d) => d < utcDay(now) && (totalled === null || d > totalled)).sort();

// ---------- transcripts ----------

const ITEM_CHARS = 4000;
const TOOL_CHARS = 600;
const MAX_TRANSCRIPT_ITEMS = 1500;

type Block = { type?: string; text?: string; name?: string; input?: unknown; content?: unknown; is_error?: boolean };

const blockText = (c: unknown): string =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c
          .map((b: Block) => (typeof b === 'string' ? b : b?.type === 'text' ? (b.text ?? '') : b?.type === 'image' ? '[image]' : ''))
          .filter(Boolean)
          .join('\n')
      : '';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What a tool was asked to do, in a line: its command, file or pattern when it has one, else its input as JSON. */
function toolInputText(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  for (const k of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt']) if (typeof o[k] === 'string') return o[k] as string;
  return JSON.stringify(o);
}

/**
 * A Claude Code transcript (.jsonl) as the History screen shows it: the prompts, Claude's replies, each tool call and
 * its result, every text cut and scrubbed of `secrets`. Lines that aren't messages (summaries, snapshots, a torn last
 * line) are skipped; past `max` items it stops and says so.
 */
export function readTranscript(jsonl: string, secrets: readonly string[], max = MAX_TRANSCRIPT_ITEMS): { items: TranscriptItem[]; cut: boolean } {
  const items: TranscriptItem[] = [];
  let cut = false;
  const add = (it: TranscriptItem, n: number) => {
    if (!it.text.trim() && !it.tool) return;
    if (items.length >= max) cut = true;
    else items.push({ ...it, text: clip(redact(it.text.slice(0, n + 256), secrets), n) });
  };
  for (const line of jsonl.split('\n')) {
    if (cut) break;
    if (!line.trim()) continue;
    let row: { type?: string; message?: { role?: string; content?: unknown }; timestamp?: string; isMeta?: boolean };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if ((row.type !== 'user' && row.type !== 'assistant') || !row.message || row.isMeta) continue;
    const at = row.timestamp ? Date.parse(row.timestamp) || undefined : undefined;
    const content = row.message.content;
    if (typeof content === 'string') {
      add({ role: row.type, text: content, at }, ITEM_CHARS);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const b of content as Block[]) {
      if (b?.type === 'text') add({ role: row.type, text: b.text ?? '', at }, ITEM_CHARS);
      else if (b?.type === 'tool_use') add({ role: 'tool', tool: String(b.name ?? 'tool'), text: toolInputText(b.input), at }, TOOL_CHARS);
      else if (b?.type === 'tool_result') add({ role: b.is_error ? 'error' : 'result', text: blockText(b.content), at }, ITEM_CHARS);
    }
  }
  return { items, cut };
}

// ---------- the CEO's session_history ----------

/** session_history's output: a line per entry, newest first, and how to get the next page. */
export function historyText(p: HistoryPage, page: number, perPage: number): string {
  if (!p.total) return 'No sessions match. Widen the filters (more days, no outcome) or check the floor and agent names.';
  const pages = Math.ceil(p.total / perPage);
  const lines = p.entries.map((e) => {
    const when = e.kind === 'merge' ? `${utcDay(e.at)} ${utcTime(e.at)}` : `${utcDay(e.startedAt)} ${utcTime(e.startedAt)}–${utcTime(e.at)}`;
    const where = e.floor !== null ? `floor ${e.floor} ` : '';
    const cost = [e.kind === 'merge' ? '' : duration(e.at - e.startedAt), e.usd > 0 ? `$${e.usd.toFixed(2)}` : ''].filter(Boolean).join(' · ');
    return `- ${when} UTC · ${e.agent} · ${e.kind} · ${where}${oneLine(workLabel(e), 80)} → ${oneLine(outcomeLine(e), 160)}${cost ? ` · ${cost}` : ''}${e.transcript ? ' · transcript kept' : ''}`;
  });
  return [`${p.total} session${p.total === 1 ? '' : 's'}, page ${page} of ${pages}${p.more ? ` (page ${page + 1} next)` : ''}:`, ...lines].join('\n');
}
