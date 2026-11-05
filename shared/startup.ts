// A session's startup context (#50): how many tokens its first turn sent before any work (Claude Code's own prompt
// and tools, MCP servers and skills, CLAUDE.md files, the office's instructions and the task), what made it up, and
// what each kind of task averaged. Pure, shared by the server (the cost ledger) and the client (the usage view).
import type { TaskKind } from './costs.ts';

export interface StartupPart {
  label: string;
  tokens: number;
}

/** Measured from the first turn's usage; `parts` estimated from the texts' sizes, largest first, summing to `tokens`. */
export interface StartupContext {
  tokens: number;
  parts: StartupPart[];
}

/** What each kind of task loads before its first step, on average, and its largest parts. */
export interface StartupRow {
  kind: TaskKind;
  sessions: number;
  avg: number; // tokens
  top: StartupPart[]; // averages, largest first
}

/** What's left of the measurement once the office's texts are taken out. */
export const REST_LABEL = 'Claude Code, tools and skills';

/** Roughly 4 characters a token. */
export const charTokens = (chars: number) => Math.round(Math.max(0, chars) / 4);

/** Every input token of one API call: fresh, written to the cache and read from it. */
export function usageTokens(u: unknown): number | null {
  if (!u || typeof u !== 'object') return null;
  const n = (k: string) => Number((u as Record<string, unknown>)[k]) || 0;
  const total = n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens');
  return total > 0 ? total : null;
}

/** The first API call's input tokens in a Claude Code transcript (JSON lines): the session's startup context. */
export function firstTurnTokens(jsonl: string): number | null {
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"assistant"')) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; message?: { usage?: unknown } };
      const tokens = entry.type === 'assistant' ? usageTokens(entry.message?.usage) : null;
      if (tokens) return tokens;
    } catch {
      // a line cut off at the end of what was read
    }
  }
  return null;
}

/** The office's texts a session starts with, by size: its instructions (the playbooks and QA brief apart) and the task. */
export function officeParts(x: { system: string; prompt: string; officePlaybook?: string; playbook?: string; qaBrief?: string }): StartupPart[] {
  const named: [string, string | undefined][] = [
    ['Office playbook', x.officePlaybook],
    ["Floor's playbook", x.playbook],
    ['QA brief', x.qaBrief],
  ];
  const inSystem = named.filter(([, t]) => t && x.system.includes(t)) as [string, string][];
  const own = x.system.length - inSystem.reduce((n, [, t]) => n + t.length, 0);
  return [{ label: 'Office instructions', tokens: charTokens(own) }, ...inSystem.map(([label, t]) => ({ label, tokens: charTokens(t.length) })), { label: 'Task prompt', tokens: charTokens(x.prompt.length) }];
}

/** The measured total split into the office's known parts (by size) and the rest, largest first. */
export function startupParts(tokens: number, known: StartupPart[]): StartupContext {
  const parts = known.filter((p) => p.tokens > 0).map((p) => ({ ...p }));
  const sum = parts.reduce((n, p) => n + p.tokens, 0);
  // Estimates over the measurement (a short first turn, rounding) shrink to fit it.
  if (sum > tokens) for (const p of parts) p.tokens = Math.round((p.tokens * tokens) / sum);
  const rest = tokens - parts.reduce((n, p) => n + p.tokens, 0);
  if (rest > 0) parts.push({ label: REST_LABEL, tokens: rest });
  return { tokens, parts: parts.sort((a, b) => b.tokens - a.tokens) };
}

/** Per kind of task, over the sessions that measured it: the average startup and its three largest parts. */
export function startupRows(sessions: { kind: TaskKind; startup?: StartupContext }[]): StartupRow[] {
  const rows: StartupRow[] = [];
  const measured = sessions.filter((s) => typeof s.startup?.tokens === 'number' && Array.isArray(s.startup.parts));
  for (const kind of new Set(measured.map((s) => s.kind))) {
    const of = measured.filter((s) => s.kind === kind).map((s) => s.startup!);
    const parts = new Map<string, number>();
    for (const s of of) for (const p of s.parts) parts.set(p.label, (parts.get(p.label) ?? 0) + p.tokens);
    const avg = (n: number) => Math.round(n / of.length);
    rows.push({
      kind,
      sessions: of.length,
      avg: avg(of.reduce((n, s) => n + s.tokens, 0)),
      top: [...parts].map(([label, t]) => ({ label, tokens: avg(t) })).sort((a, b) => b.tokens - a.tokens).slice(0, 3),
    });
  }
  return rows.sort((a, b) => b.avg - a.avg);
}
