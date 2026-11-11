// Who is on an account, for its usage sheet (#409): the sessions running on it now (each agent's run, #376, not the
// pin), the pinned agents with nothing running there, and the words of each row. Pure.
import { modelLabel } from '../../../shared/models';
import { CEO_ID, type RepoView, type SessionRun } from '../../../shared/types';
import type { Agent, Overlay } from '../store';
import { CLI_NAMES } from './floorRows';

/** A session on the account now, with whose it is. */
export interface OnItRow {
  agent: Agent;
  run: SessionRun;
}

/** "On it now": sessions really running on the account, oldest first; "Pinned": pinned agents with none running there. */
export function onIt(accountId: string, pinned: readonly string[], agents: Record<string, Agent>): { now: OnItRow[]; pinned: Agent[] } {
  const now = Object.values(agents)
    .flatMap((agent) => (agent.run && agent.run.account === accountId ? [{ agent, run: agent.run }] : []))
    .sort((a, b) => a.run.at - b.run.at);
  const on = new Set(now.map((r) => r.agent.id));
  return { now, pinned: pinned.flatMap((id) => (!on.has(id) && agents[id] ? [agents[id]] : [])) };
}

/** "Codex · GPT-6.1-Sol · medium": the coding agent, model and effort a session really runs. */
export const runWords = (r: Pick<SessionRun, 'cli' | 'model' | 'effort'>) => [CLI_NAMES[r.cli], r.model && modelLabel(r.model), r.effort].filter(Boolean).join(' · ');

/** What someone is working on, and the page it opens: their PR or issue card; the CEO's job has none. */
export function taskOf(a: Pick<Agent, 'id' | 'repoId' | 'task' | 'issueNumber' | 'prNumber' | 'issueTitle'>): { words: string; open: Overlay | null } {
  if (a.id === CEO_ID) return { words: a.issueTitle ?? 'CEO job', open: null };
  const pr = a.task !== 'issue' && a.prNumber !== null;
  const n = pr ? a.prNumber : a.issueNumber;
  if (n === null || !a.task) return { words: 'Between tasks', open: null };
  const verb = a.task === 'qa' ? 'Testing PR' : a.task === 'fix' ? 'Fixing PR' : 'Building';
  return { words: `${verb} #${n}`, open: { kind: 'card', repoId: a.repoId, key: pr ? `pr-${n}` : `i-${n}`, number: n, pr } };
}

/** A floor's short name ("Floor 2 · shop"), '' for the CEO's company-wide work. */
export function floorName(repoId: string, repos: readonly Pick<RepoView, 'id' | 'floor' | 'fullName'>[]): string {
  if (!repoId) return 'CEO';
  const r = repos.find((x) => x.id === repoId);
  return r ? `Floor ${r.floor} · ${r.fullName.split('/')[1]}` : repoId.split('/')[1] ?? repoId;
}
