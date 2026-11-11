// What the CEO runs on, picked by hand (#418), pure: its coding agent (Claude Code unless the manager chose another in
// The CEO's card), the model a job gets on it, what the picker says each one can't do, and the chat pill's words.
// Automatic fallback when every account is out (rotation.ceoClis, shared/accountRotation.ts) stays a separate switch.
import { effectiveModel, modelLabel } from './models.ts';
import { CLI_NAMES } from './sessionRun.ts';
import type { AgentCli, EffortLevel } from './types.ts';

/** The coding agents the CEO can run on: each gets the office's tools over MCP (server/clis.ts). */
export const CEO_CLIS: readonly AgentCli[] = ['claude', 'codex', 'gemini', 'opencode'];

/** The CEO's coding agent: the one picked, in the terminal runtime only (the SDK runtime is Claude Code's). */
export function ceoCli(picked: string | undefined, terminal: boolean): AgentCli {
  return terminal && CEO_CLIS.includes(picked as AgentCli) ? (picked as AgentCli) : 'claude';
}

/** The CEO's own model on `cli`: its pick, else the CEO's Claude default, or another coding agent's default ('' its own). */
export function ceoModelOn(cli: AgentCli, own: string, office: { defaultCli: AgentCli; defaultModel: string }, claudeDefault: string): string {
  return cli === 'claude' ? own.trim() || claudeDefault : effectiveModel(own, cli, office, claudeDefault);
}

/**
 * What works differently on each coding agent, for the picker. The office's tools, notes, threads, attachments and
 * artifacts are the office's own and work on every one; voice is read aloud by the office.
 */
export const CEO_CLI_NOTES: Record<AgentCli, string> = {
  claude: 'Everything works: office tools, notes, threads, attachments, artifacts, Tools & skills and Model per job.',
  codex: 'Office tools, notes, threads, attachments and artifacts work. Its steps show once you trust its hooks (/hooks in its terminal). No voice of its own; voice still works through the office. Tools & skills and Model per job are Claude Code’s: every job runs on this model.',
  gemini: 'Office tools, notes, threads, attachments and artifacts work. No voice of its own; voice still works through the office. Tools & skills and Model per job are Claude Code’s: every job runs on this model.',
  opencode: 'Office tools, notes, threads, attachments and artifacts work, on OpenCode’s own setup (no office accounts). The office sees its turns, not each step. No voice of its own; voice still works through the office. Every job runs on this model.',
};

/** What the CEO runs on, as the pill's Undo puts it back. */
export interface CeoRunsOn {
  cli: AgentCli;
  model: string;
  effort: EffortLevel | '';
  account: string;
}

/** The chat pill when the manager moves the CEO to another coding agent: from its next job; a running one finishes where it is. */
export function ceoRunsText(name: string, cli: AgentCli, model: string, busy: boolean): string {
  return `🔀 ${name} now runs on ${CLI_NAMES[cli]}${model ? ` (${modelLabel(model)})` : ''}${busy ? ' from the next job: the one running now finishes where it started' : ''}.`;
}
