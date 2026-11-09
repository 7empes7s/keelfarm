// company_status's views (#329): the compact one the CEO reads at the start of nearly every job, and floor_detail's
// one floor in full. Pure: both cut down the full status companyStatus() builds, which full: true still returns.
import { clip } from './notify.ts';

interface StatusBacklogItem { number: number; title: string; waitsFor: number[]; inProgress: boolean; waitsForManager?: string }
interface StatusAgent { id: string; name: string; status: string; doing: string | null; waitsForManager?: string; codingAgent: string; model: string; effort: string }
interface StatusPull { number: number; title: string; qa: string; merge: string | null; checks: string }
interface StatusDecision { id: string; kind: string; floor: number | null; name: string; reason: string; status: string; managerNote: string | null }

/** One floor as the full company_status has it; the fields the views keep or drop are typed, the rest pass through. */
export interface StatusFloor {
  floor: number;
  repo: string;
  description: string;
  clone: string;
  charter: string | null;
  charterProposalWaiting: boolean;
  profile: string | null;
  qaBrief: string | null;
  playbook: string | null;
  preview: { command: string | null; env: Record<string, string>; status: string };
  agents: StatusAgent[];
  backlog: StatusBacklogItem[];
  pullRequests: StatusPull[];
  mergedRecently: string[];
  [rest: string]: unknown;
}

export interface FullStatus {
  company: { officePlaybook: string | null; [rest: string]: unknown };
  floors: StatusFloor[];
  pendingChanges: StatusDecision[];
  recentDecisions: StatusDecision[];
  openDecisions: unknown[];
}

/** What the compact view needs besides the full status: each floor's current focus, and the defaults an agent's setup is left out at. */
export interface CompactContext {
  focus: (floor: number) => string;
  defaultEffort: string;
}

const READY_SHOWN = 10;
const MERGED_SHOWN = 5;
const DECISIONS_SHOWN = 3;
const TITLE_MAX = 70;
const REASON_MAX = 120;
/** agentSetup's words for no model picked. */
export const DEFAULT_MODEL = 'the coding agent default';

type BacklogState = 'in progress' | 'waiting' | 'ready';
const item = (i: StatusBacklogItem, state: BacklogState) => ({ number: i.number, title: clip(i.title, TITLE_MAX), state, ...(i.waitsFor.length > 0 && { waitsFor: i.waitsFor }), ...(!!i.waitsForManager && { waitsForManager: i.waitsForManager }) });

/** A floor's backlog as counts, and by name only what's being built, what waits, and the first ready issues. */
function backlogView(backlog: StatusBacklogItem[]) {
  const inProgress = backlog.filter((i) => i.inProgress);
  const waiting = backlog.filter((i) => !i.inProgress && (i.waitsFor.length > 0 || !!i.waitsForManager));
  const ready = backlog.filter((i) => !i.inProgress && !i.waitsFor.length && !i.waitsForManager);
  return {
    backlogCounts: { open: backlog.length, ready: ready.length, waiting: waiting.length, inProgress: inProgress.length },
    backlog: [...inProgress.map((i) => item(i, 'in progress')), ...waiting.map((i) => item(i, 'waiting')), ...ready.slice(0, READY_SHOWN).map((i) => item(i, 'ready'))],
  };
}

function compactFloor(f: StatusFloor, o: CompactContext) {
  const { charter: _c, qaBrief: _q, playbook: _p, preview: _v, agents, backlog, pullRequests, mergedRecently, description, ...rest } = f;
  return {
    ...rest,
    description: clip(description ?? '', 140),
    focus: o.focus(f.floor) || null,
    agents: agents.map(({ model, effort, ...a }) => ({ ...a, ...(model !== DEFAULT_MODEL && { model }), ...(effort !== o.defaultEffort && { effort }) })),
    ...backlogView(backlog),
    pullRequests: pullRequests.map((p) => ({ ...p, title: clip(p.title, TITLE_MAX) })),
    mergedRecently: mergedRecently.slice(0, MERGED_SHOWN).map((m) => clip(m, TITLE_MAX)),
  };
}

/** company_status by default: every floor without its long texts (charter, QA brief, playbooks, preview), lists cut to what's actionable. */
export function compactStatus(full: FullStatus, o: CompactContext) {
  const { officePlaybook: _o, ...company } = full.company;
  return {
    company,
    floors: full.floors.map((f) => compactFloor(f, o)),
    pendingChanges: full.pendingChanges,
    recentDecisions: full.recentDecisions.slice(-DECISIONS_SHOWN).map(({ id: _id, reason, ...d }) => ({ ...d, reason: clip(reason, REASON_MAX) })),
    openDecisions: full.openDecisions,
  };
}

/** floor_detail: one floor as the full company_status has it, with the office playbook. Unknown floor: an error naming the floors. */
export function floorDetail(full: FullStatus, floor: number) {
  const f = full.floors.find((x) => x.floor === floor);
  if (!f) throw new Error(`No floor ${floor}; ${full.floors.length ? `floors are ${full.floors.map((x) => x.floor).join(', ')}` : 'there are no floors yet'}.`);
  return { ...f, officePlaybook: full.company.officePlaybook };
}
