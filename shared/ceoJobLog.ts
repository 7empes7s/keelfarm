// The CEO jobs log (#332): one row per CEO job in the session history (its `ceo` part), with what started it, how it
// ran (model, effort, fresh or resumed, tokens, cost, time), what came of it (replied, quiet or failed, tools used,
// issues filed) and the links between a job and its redo on the CEO model. Pure, shared by the server (what a row
// holds) and the client (the log in CEO → Sessions).
import type { HistoryEntry } from './history.ts';
import type { CeoJobKind } from './types.ts';

export type CeoJobReply = 'replied' | 'quiet' | 'failed';

/** What a CEO job's history entry adds to the session's. */
export interface CeoJobInfo {
  job: number; // its number (redo links name it)
  kind: CeoJobKind; // the session's kind can be ceo-wait instead
  trigger: string; // what started it: "Schedule", "Events e3, e4: #12 merged…", "Your message #40", "Redo of job #7"
  fresh: boolean; // a fresh session, else it carried on in the kept one
  reply: CeoJobReply;
  message: number | null; // its last chat message, when it replied
  tools: Record<string, number>; // tool calls by name
  issues: number; // issues filed
  inputTokens: number | null; // from its transcript, when one was kept
  outputTokens: number | null;
  redoOf?: number; // the job this one redid
}

export const REPLY_LABELS: Record<CeoJobReply, string> = { replied: 'Replied', quiet: 'Quiet', failed: 'Failed' };

/** A tool's short name: "mcp__office__file_issue" → "file_issue". */
const toolName = (name: string) => name.split('__').pop() || name;

/** `tools` with the log's tool calls counted in (entries with a `tool`). */
export function countTools(tools: Record<string, number>, entries: readonly { kind: string; tool?: string }[]): Record<string, number> {
  for (const e of entries) if (e.kind === 'tool' && e.tool) tools[toolName(e.tool)] = (tools[toolName(e.tool)] ?? 0) + 1;
  return tools;
}

/** The job's outcome in the log: failed when its session did, else whether it said anything in the chat. */
export const jobReply = (ok: boolean, message: number | null): CeoJobReply => (!ok ? 'failed' : message !== null ? 'replied' : 'quiet');

/**
 * Input and output tokens of the API calls in a Claude Code transcript (JSON lines) made at or after `since`: a
 * resumed session's file holds its earlier jobs too. Input counts fresh, cache-written and cache-read tokens. Null
 * when none were reported.
 */
export function transcriptTokens(jsonl: string, since: number): { input: number; output: number } | null {
  let input = 0, output = 0, seen = false;
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"usage"')) continue;
    try {
      const e = JSON.parse(line) as { type?: string; timestamp?: string; message?: { usage?: Record<string, unknown> } };
      const u = e.type === 'assistant' ? e.message?.usage : undefined;
      if (!u || (e.timestamp && Date.parse(e.timestamp) < since)) continue;
      const n = (k: string) => Number(u[k]) || 0;
      input += n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens');
      output += n('output_tokens');
      seen = true;
    } catch {
      // a line cut off at the end of what was read
    }
  }
  return seen ? { input, output } : null;
}

/** The log's filters: a CEO job kind ('' = any) and a model ('' = any). */
export interface CeoLogFilter {
  kind: CeoJobKind | '';
  model: string;
}

/** A row of the log: the entry, and the job that redid it when one did. */
export interface CeoLogRow {
  entry: HistoryEntry & { ceo: CeoJobInfo };
  redoneBy: number | null;
}

/** The CEO jobs among `entries` that the filter keeps, newest first, each linked to its redo (found among all of them). */
export function ceoLogRows(entries: readonly HistoryEntry[], f: CeoLogFilter): CeoLogRow[] {
  const jobs = entries.filter((e): e is HistoryEntry & { ceo: CeoJobInfo } => !!e.ceo && e.kind.startsWith('ceo-'));
  const redone = new Map<number, number>();
  for (const e of jobs) if (e.ceo.redoOf !== undefined) redone.set(e.ceo.redoOf, e.ceo.job);
  return jobs
    .filter((e) => (!f.kind || e.ceo.kind === f.kind) && (!f.model || e.model === f.model))
    .sort((a, b) => b.at - a.at)
    .map((entry) => ({ entry, redoneBy: redone.get(entry.ceo.job) ?? null }));
}

/** The tools a row used, most used first: "file_issue ×2 · agent_log". */
export const toolsLine = (tools: Record<string, number>) =>
  Object.entries(tools)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, n]) => (n > 1 ? `${t} ×${n}` : t))
    .join(' · ');
