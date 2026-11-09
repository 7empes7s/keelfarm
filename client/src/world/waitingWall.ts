// The manager's "Waiting on you" wall screen (#326), the pure side: what waits on the manager (open decisions, team
// changes, needs-human PRs per floor, agents who need them), the lines the screen paints, and where E/click goes.
// The console's own stats are on the desk monitor (#324); this screen only shows what waits.

import { waitingDecisions, type Decision } from '../../../shared/decisions';
import { needsYou, type NeedsYouInput } from '../../../shared/needsYou';
import type { AgentRole, HireRequestView, QaView, RepoView } from '../../../shared/types';
import { floorPrCounts } from '../floorCounts';
import type { Overlay } from '../store';

/** Decision titles the screen lists. */
const WALL_TITLES = 3;

export interface WaitingWall {
  /** Open, unsnoozed decisions other than team changes (those count under team), newest first. */
  decisions: { count: number; titles: string[] };
  team: number;
  prs: { count: number; floors: { floor: number; count: number }[] };
  agents: { count: number; names: string[] };
  mergedToday: number;
}

export interface WaitingWorld {
  decisions: readonly Decision[];
  requests: readonly HireRequestView[];
  repos: readonly RepoView[];
  qa: Record<string, QaView>;
  agents: Record<string, NeedsYouInput & { name: string; role: AgentRole }>;
  mergedToday: number;
}

export function waitingWall(w: WaitingWorld, now: number): WaitingWall {
  const open = waitingDecisions(w.decisions, now).filter((d) => d.kind !== 'team');
  const floors = w.repos.map((r) => ({ floor: r.floor, count: floorPrCounts(r, w.qa).needsYou })).filter((f) => f.count > 0).sort((a, b) => a.floor - b.floor);
  const agents = Object.values(w.agents).filter((a) => a.role !== 'ceo' && needsYou(a) !== null);
  return {
    decisions: { count: open.length, titles: open.slice(0, WALL_TITLES).map((d) => d.question) },
    team: w.requests.filter((r) => r.status === 'pending').length,
    prs: { count: floors.reduce((n, f) => n + f.count, 0), floors },
    agents: { count: agents.length, names: agents.map((a) => a.name).sort() },
    mergedToday: w.mergedToday,
  };
}

export const waitingTotal = (s: WaitingWall) => s.decisions.count + s.team + s.prs.count + s.agents.count;

export interface WallRow {
  label: string;
  value: number;
  /** Lines under the row: decision titles, floors, names. */
  details: string[];
}

/** The screen's rows, only for what waits; none means "Nothing waiting on you". */
export function wallRows(s: WaitingWall): WallRow[] {
  const rows: WallRow[] = [];
  if (s.decisions.count) rows.push({ label: s.decisions.count === 1 ? 'Decision' : 'Decisions', value: s.decisions.count, details: s.decisions.titles });
  if (s.team) rows.push({ label: s.team === 1 ? 'Team change to approve' : 'Team changes to approve', value: s.team, details: [] });
  if (s.prs.count) rows.push({ label: s.prs.count === 1 ? 'PR needs you' : 'PRs need you', value: s.prs.count, details: [s.prs.floors.map((f) => `Floor ${f.floor}: ${f.count}`).join(' · ')] });
  if (s.agents.count) rows.push({ label: s.agents.count === 1 ? 'Agent needs you' : 'Agents need you', value: s.agents.count, details: [s.agents.names.join(', ')] });
  return rows;
}

/** The calm line when nothing waits. */
export const calmLine = (mergedToday: number) => (mergedToday ? `${mergedToday} merged today` : 'No merges yet today');

/** E/click: the chat's decisions tray if a decision waits, the approvals for a team change, else Mission control's needs-you. */
export function waitingTarget(s: WaitingWall): Overlay {
  if (s.decisions.count) return { kind: 'phone', tab: 'chat' };
  if (s.team) return { kind: 'phone', tab: 'hires' };
  return { kind: 'manager', tab: 'ops' };
}
