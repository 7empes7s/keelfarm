// "+ Agent"'s pure parts (#243): the new agent's setup and what's sent for it, and a floor's team line and stats.
import type { AgentCli, AgentStatus, EffortLevel } from '../../../shared/types';

/** A new agent's optional name and their coding agent, model and effort ('' = the office's defaults). */
export interface NewAgent {
  name: string;
  cli: AgentCli | '';
  model: string;
  effort: EffortLevel | '';
}

export const NO_SETUP: NewAgent = { name: '', cli: '', model: '', effort: '' };

/** What api.hireAgent gets: the setup as picked ('' stays '', the office's default), the name trimmed or left out. */
export function hirePayload({ name, ...setup }: NewAgent) {
  return { ...setup, name: name.trim() || undefined };
}

/** A floor's team against its most agents: "Floor 3 · 6 of 10 agents", how full, and whether Add is off. */
export function teamFill(floor: number, size: number, max: number) {
  return { label: `Floor ${floor}`, value: `${size} of ${max} agents`, pct: max > 0 ? size / max : 1, full: size >= max };
}

/** "6 agents · 5 busy · 1 free" (busy: setting up or working); "0 agents" for an empty floor. */
export function teamStats(team: { status: AgentStatus }[]) {
  const busy = team.filter((a) => a.status === 'working' || a.status === 'preparing').length;
  if (team.length === 0) return '0 agents';
  return `${team.length} ${team.length === 1 ? 'agent' : 'agents'} · ${busy} busy · ${team.length - busy} free`;
}
