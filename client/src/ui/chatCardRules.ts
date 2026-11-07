// The CEO chat's cards and helpers (#108), pure: an action card's live status from the store's state, the "working on
// it" strip's words, the starter chips that fit the office, and the "/" commands with their templates.
// ChatCards.tsx draws them.

import type { ActionRef } from '../../../shared/ceoActions';
import type { LiveStep, StepLog } from '../../../shared/ceoStream';
import { shortDuration } from '../../../shared/ceoSteps';
import { RESEARCH_PREFIX } from '../../../shared/chat';
import { CEO_ID, type PhoneMessage } from '../../../shared/types';
import { matchPicks, pickText, type QuickPicks } from '../../../shared/used';
import type { IconName } from './icons';
import { agentFor, type RefWorld } from './chatRefs';

export interface ActionStatus {
  label: string;
  tone?: 'good' | 'warn' | 'bad';
  merged?: true;
}

const BUSY = new Set(['working', 'preparing']);

/** Where an action card's issue, PR, floor or agent stands now, or null when it's gone from the office. */
export function actionStatus(ref: ActionRef, w: RefWorld): ActionStatus | null {
  if (ref.kind === 'decision' || ref.kind === 'approvals' || (ref.kind === 'section' && (ref.section !== 'team' || !ref.repoId))) return null;
  if (ref.kind === 'agent') {
    const a = agentFor(w, ref.agentId);
    if (!a) return null;
    const on = a.prNumber ?? a.issueNumber;
    return { label: `${a.status}${on && a.status !== 'idle' ? ` · #${on}` : ''}`, ...(a.status === 'error' ? { tone: 'bad' as const } : BUSY.has(a.status) && { tone: 'good' as const }) };
  }
  const repo = w.repos.find((r) => r.id === ref.repoId);
  if (!repo) return null;
  const team = Object.values(w.agents).filter((a) => a.repoId === repo.id && a.id !== CEO_ID);
  if (ref.kind === 'floor' || ref.kind === 'section') return { label: `${team.length} agent${team.length === 1 ? '' : 's'} · ${team.filter((a) => BUSY.has(a.status)).length} busy` };
  const n = ref.number;
  // The PR itself, else the PR that closes the issue (a merged one first, then an open one).
  const closing = repo.pulls.filter((p) => p.closesIssues.includes(n) && p.state !== 'CLOSED').sort((a, b) => Number(b.state === 'MERGED') - Number(a.state === 'MERGED'));
  const pull = repo.pulls.find((p) => p.number === n) ?? closing[0];
  if (pull?.state === 'MERGED') return { label: 'merged', tone: 'good', merged: true };
  if (pull?.state === 'CLOSED') return { label: 'closed' };
  const by = (pick: (a: RefWorld['agents'][string]) => boolean) => team.find((a) => BUSY.has(a.status) && pick(a))?.name;
  if (pull) {
    const qa = w.qa[`${repo.id}#${pull.number}`];
    const fixer = by((a) => a.prNumber === pull.number);
    if (qa?.status === 'fixing' || (fixer && qa?.status !== 'testing')) return { label: fixer ? `fixing by ${fixer}` : 'fixing', tone: 'warn' };
    if (qa?.status === 'passed') return { label: 'QA passed', tone: 'good' };
    if (qa?.status === 'failed' || qa?.status === 'needs-human') return { label: qa.status === 'failed' ? 'QA failed' : 'needs you', tone: 'bad' };
    return { label: qa ? 'in QA' : `PR #${pull.number} open`, tone: 'warn' };
  }
  const builder = by((a) => a.issueNumber === n);
  if (builder) return { label: `building by ${builder}`, tone: 'good' };
  return repo.issues.some((i) => i.number === n) ? { label: 'queued' } : { label: 'closed' };
}

// ---------- the "working on it" strip ----------

/** "12s", "3m 05s", "1h 02m". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** What the strip says while the CEO is on a job: the step running (else the job), its icon, and the next job waiting. */
export function workingLine(job: { label: string } | null, step: LiveStep | null, queue: readonly { label: string }[]): { now: string; icon: string | null; next: string | null } | null {
  if (!job) return null;
  const running = step?.state === 'running';
  return { now: running ? step.label : job.label, icon: running ? step.icon : null, next: queue[0]?.label ?? null };
}

// ---------- a reply's step log (#150) ----------

/** A reply's step log: its own, else one made from the labels a reply kept before #150 (untimed); null when it took no steps. */
export function replyLog(m: Pick<PhoneMessage, 'log' | 'steps'>): StepLog | null {
  if (m.log?.steps.length) return m.log;
  if (!m.steps?.length) return null;
  const steps = m.steps.map((s): LiveStep => (s.startsWith('✗ ') ? { label: s.slice(2), icon: '•', state: 'failed', at: 0 } : { label: s, icon: '•', state: 'done', at: 0 }));
  return { steps, count: steps.length, ms: 0 };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The reply's one-line steps row: "6 steps · 1 action · 42 s" (no time for an untimed one). */
export function stepsSummary(log: StepLog | null, actions: number): string {
  const parts = [plural(log?.count ?? 0, 'step')];
  if (actions) parts.push(plural(actions, 'action'));
  if (log?.ms) parts.push(shortDuration(log.ms));
  return parts.join(' · ');
}

/** A step's time in the log: how long it took, or has been running (`now`); none for an untimed one. */
export function stepTime(s: LiveStep, now: number): string {
  if (s.ms !== undefined) return shortDuration(s.ms);
  return s.state === 'running' && s.at ? shortDuration(now - s.at) : '';
}

// ---------- starters and "/" commands ----------

export interface StarterFloor {
  floor: number;
  issues: number;
  objectives: number;
  proposal: boolean; // a charter change waits for the manager
}

/** The starter chips for an empty message box: what fits the office now, at most `max`. Tapping one fills the box. */
export function starterChips(o: { floors: readonly StarterFloor[]; busy: number }, max = 4): string[] {
  if (!o.floors.length) return ['Help me add my first project', 'What can you do for me?'];
  const out: string[] = [];
  const idle = o.floors.find((f) => f.issues === 0);
  out.push(`Plan the next milestone for floor ${(idle ?? o.floors[0]).floor}`);
  if (o.busy > 0) out.push("What's everyone working on?");
  const proposal = o.floors.find((f) => f.proposal);
  const bare = o.floors.find((f) => f.objectives === 0);
  if (proposal) out.push(`Review the charter proposal for floor ${proposal.floor}`);
  else if (bare) out.push(`Draft a charter for floor ${bare.floor}`);
  else out.push(`Review the charter for floor ${o.floors[o.floors.length > 1 ? 1 : 0].floor}`);
  out.push('Where did the money go this week?');
  out.push(`${RESEARCH_PREFIX}how others do `);
  return out.slice(0, max);
}

export interface SlashCommand {
  cmd: string; // without the "/"
  hint: string;
  template: (floor: number) => string; // what picking it puts in the box
}

/** The office's "/" commands: picking one fills a template the manager edits, never sends. */
const SLASH_COMMANDS: readonly SlashCommand[] = [
  { cmd: 'plan', hint: 'Turn a goal into issues', template: (f) => `Plan the next milestone for floor ${f}: ` },
  { cmd: 'status', hint: "What's everyone working on", template: () => "What's everyone working on, floor by floor?" },
  { cmd: 'charter', hint: "Review a floor's charter", template: (f) => `Review floor ${f}'s charter and propose changes: ` },
  { cmd: 'objective', hint: 'Add an objective to a charter', template: (f) => `Add an objective to floor ${f}'s charter: ` },
  { cmd: 'research', hint: 'Options with sources, nothing filed', template: () => RESEARCH_PREFIX },
  { cmd: 'mandate', hint: 'Keep working on a floor on your own', template: (f) => `Keep working on floor ${f} until ` },
  { cmd: 'team', hint: 'Grow or shrink a team', template: (f) => `Should floor ${f}'s team grow or shrink? ` },
  { cmd: 'experiment', hint: 'A/B test a practice', template: () => 'Set up an experiment to test whether ' },
  { cmd: 'costs', hint: 'Where the plan went', template: () => 'Where did the money go this week?' },
];

/** The commands matching what follows the "/", those starting with it first. */
export function matchCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.cmd.includes(q)).sort((a, b) => Number(!a.cmd.startsWith(q)) - Number(!b.cmd.startsWith(q)));
}

// ---------- the thread's days and groups ----------

const GROUP_MS = 5 * 60_000;
const dayOf = (t: number) => new Date(t).toDateString();

/** The separator above a message that starts a new day ("Today", "Yesterday", "Mon, Nov 3"), else null. */
export function daySeparator(prev: number | undefined, at: number, now: number): string | null {
  if (prev !== undefined && dayOf(prev) === dayOf(at)) return null;
  if (dayOf(at) === dayOf(now)) return 'Today';
  if (dayOf(at) === dayOf(now - 86_400_000)) return 'Yesterday';
  return new Date(at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** A message that follows one from the same sender within a few minutes, the same day: drawn as one group. */
export const continuesGroup = (prev: { from: string; at: number } | undefined, m: { from: string; at: number }) =>
  !!prev && prev.from === m.from && m.from !== 'office' && m.at - prev.at < GROUP_MS && dayOf(prev.at) === dayOf(m.at);

export interface SlashItem {
  key: string;
  icon: IconName;
  name: string;
  hint: string;
  example?: string;
  text: string; // what picking it puts in the message box
}

/** The "/" list: the office's commands first (templates for `floor`), then the manager's skills and apps. */
export function slashItems(p: QuickPicks | null, query: string, floor: number): SlashItem[] {
  const cmds = matchCommands(query).map((c): SlashItem => ({ key: `cmd-${c.cmd}`, icon: 'zap', name: `/${c.cmd}`, hint: c.hint, example: c.template(floor).trim(), text: c.template(floor) }));
  const picks = (p ? matchPicks(p, query) : []).map((x): SlashItem => ({ key: `${x.kind}-${x.name}`, icon: x.kind === 'skill' ? 'sparkles' : 'plug', name: x.name, hint: x.kind === 'skill' ? 'skill' : 'app', text: pickText(x.kind, x.name) }));
  return [...cmds, ...picks];
}
