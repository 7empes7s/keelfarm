// Whether a new session picks up the CLI an agent's terminal keeps at its prompt (cliRunner.ts), pure.
import type { AgentCli } from '../shared/types.ts';

/** A follow-up picks up the waiting CLI on the same host, coding agent, conversation and account (#390: a new default or a task's fallback moves a kept CLI at its next session; unknown counts as the same), or one that kept working through a restart. */
export const adoptsCli = (prev: { cli: AgentCli; resumeId: string | null; account?: string; boxId: string | null }, o: { cli?: AgentCli; resumeSessionId?: string; reattach?: boolean; account?: string; boxId: string | null }) =>
  !!o.reattach || (prev.boxId === o.boxId && prev.cli === (o.cli ?? 'claude') && !!o.resumeSessionId && prev.resumeId === o.resumeSessionId && (!prev.account || !o.account || prev.account === o.account));
