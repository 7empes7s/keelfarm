// What a coding agent is good for, where the manager or the CEO picks one (#365): the add-agent form, an agent's
// setup and configure_agent. Gemini CLI runs on a Google AI plan's login, but it isn't a builder.
import type { AgentCli } from './types.ts';

export const CLI_NOTES: Partial<Record<AgentCli, string>> = {
  gemini: 'Good for QA second opinions, docs and README work, research and triage summaries, and small fixes. Not a builder: keep Claude Code or Codex for features.',
};

/** A coding agent the office's default may be: every one but Gemini CLI. */
export const builderCli = (cli: AgentCli) => cli !== 'gemini';
