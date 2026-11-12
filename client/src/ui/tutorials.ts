// Task tutorials (#517): short chains of real jobs (sign in, add a floor, ship a feature, answer what needs you, keep
// it running). Each step opens its page through a deep link (routes.ts), rings one control and moves on only once the
// manager really uses it (a tap inside the ring, or a sent chat message). Pure: TaskTutorial.tsx runs and draws them,
// tutorials.test.ts checks every target is a control the client renders.
import type { AgentView, QaView, RepoView } from '../../../shared/types';
import { CEO_ID } from '../../../shared/types';
import type { IconName } from './icons';

export type Mode = 'pocket' | 'office';

/** What finishes a step: a tap on a control inside its ring, or a message sent to the CEO. */
type Done = 'tap' | 'sent';

/** The office a step's link is picked from. */
export interface World {
  repos: readonly Pick<RepoView, 'id' | 'floor' | 'pulls'>[];
  agents: Readonly<Record<string, Pick<AgentView, 'id' | 'name' | 'repoId' | 'status'>>>;
  qa: Readonly<Record<string, Pick<QaView, 'repoId' | 'prNumber' | 'status'>>>;
}

export interface TutorialStep {
  id: string;
  title: string;
  /** One plain sentence. `{ceo}` is the CEO's name. */
  text: string;
  /** The page to open first: a deep link, 'plan' (the chat with a /plan ready to send), or none (where you are). */
  open?: string | ((w: World, mode: Mode) => string | null);
  /** CSS selectors of the control to ring, best first: the first one on screen gets it. */
  targets: string[];
  done: Done;
  /** The tap opens a form to finish: the step ticks but waits for Next instead of moving on by itself. */
  stay?: boolean;
}

export interface Tutorial {
  id: string;
  title: string;
  icon: IconName;
  blurb: string;
  steps: TutorialStep[];
}

// ---------- what a step opens ----------

const floors = (w: World) => [...w.repos].sort((a, b) => a.floor - b.floor);

/** The open PR to show: one QA has a say on (needing you first), else any open one from the team. */
export function pickPr(w: World, needsYou = false): { floor: number; number: number } | null {
  const open = floors(w).flatMap((r) => r.pulls.filter((p) => p.state === 'OPEN' && !p.untrusted).map((p) => ({ r, p, q: w.qa[`${r.id}#${p.number}`] })));
  const rank = (q: (typeof open)[number]['q']) => (!q ? 3 : needsYou && (q.status === 'needs-human' || q.status === 'failed') ? 0 : q.status === 'passed' ? 1 : 2);
  const best = open.sort((a, b) => rank(a.q) - rank(b.q))[0];
  return best ? { floor: best.r.floor, number: best.p.number } : null;
}

/** An agent at work on a floor (busy first), for their window. */
export function pickAgent(w: World): string | null {
  const team = Object.values(w.agents).filter((a) => a.id !== CEO_ID && w.repos.some((r) => r.id === a.repoId));
  const busy = team.find((a) => a.status !== 'idle') ?? team[0];
  return busy?.name ?? null;
}

const firstFloor = (w: World) => floors(w)[0]?.floor ?? null;
const kanban = (w: World) => (firstFloor(w) == null ? null : `#floor/${firstFloor(w)}/kanban`);
const prLink = (needsYou: boolean) => (w: World) => {
  const pr = pickPr(w, needsYou);
  return pr ? `#pr/${pr.floor}/${pr.number}` : null;
};
const agentLink = (w: World) => {
  const name = pickAgent(w);
  return name ? `#agent/${encodeURIComponent(name)}/terminal` : null;
};

/** A step's link here, or null when it stays where you are (or the office has nothing to show it on yet). */
export function stepLink(s: TutorialStep, w: World, mode: Mode): string | null {
  if (!s.open || s.open === 'plan') return null;
  return typeof s.open === 'string' ? s.open : s.open(w, mode);
}

/** Whether a step needs something the office doesn't have yet (no floor, PR or agent): it can only be skipped. */
export const stepBlocked = (s: TutorialStep, w: World, mode: Mode) => typeof s.open === 'function' && s.open(w, mode) === null;

// ---------- the tutorials ----------

const PR_ACTIONS = ['.pr-actions'];
const AGENT_PANES = ['.aw-panes', '.aw-pane-toggle'];

export const TUTORIALS: Tutorial[] = [
  {
    id: 'start',
    title: 'Get started',
    icon: 'rocket',
    blurb: 'Sign in a coding agent, add a project, write its charter and QA brief.',
    steps: [
      { id: 'sign-in', title: 'Sign in a coding agent', text: 'Tap Add account (or Sign in again) under Claude Code so agents can work on your plan.', open: '#settings/accounts', targets: ['.acc-cli'], done: 'tap', stay: true },
      { id: 'add-floor', title: 'Add a project', text: 'Pick a repo here: it becomes a floor with its own team.', open: '#work/floors', targets: ['#add-project'], done: 'tap', stay: true },
      { id: 'charter', title: 'Write its charter', text: "Tap Edit to set the floor's mission and goals, or ask {ceo} in the chat to draft them.", open: '#company/charter', targets: ['[data-tour="charter-edit"]'], done: 'tap', stay: true },
      { id: 'qa-brief', title: 'Tell QA what to check', text: 'Open QA brief and write what every pull request must pass.', open: '#ceo/ceo', targets: ['[data-tour="qa-brief"]'], done: 'tap', stay: true },
    ],
  },
  {
    id: 'feature',
    title: 'Your first feature',
    icon: 'sparkles',
    blurb: 'Plan it with the CEO, watch it get built and tested, then merge it.',
    steps: [
      { id: 'plan', title: 'Ask the CEO to plan it', text: 'Finish the message with what you want built and send it: {ceo} files the issues.', open: 'plan', targets: ['.chat-input'], done: 'sent' },
      { id: 'issues', title: 'The issues it filed', text: "New issues wait in Backlog: tap one to read what's planned.", open: kanban, targets: ['[data-tour="kanban-backlog"]'], done: 'tap' },
      { id: 'agent', title: 'An agent picks one up', text: 'This is their window, live: switch between their chat and their terminal.', open: agentLink, targets: AGENT_PANES, done: 'tap' },
      { id: 'qa', title: 'QA tests it', text: 'Each pull request gets a QA pass: open the preview to try it yourself.', open: prLink(false), targets: ['[data-tour="pr-preview"]'], done: 'tap' },
      { id: 'merge', title: 'Merge it', text: 'Merge (or Merge anyway) once you like it; Send back if it needs work.', open: prLink(false), targets: PR_ACTIONS, done: 'tap' },
      { id: 'live', title: 'It goes live', text: 'Merged work lands in Merged and its issue closes: tap it to see.', open: kanban, targets: ['[data-tour="kanban-merged"]'], done: 'tap' },
    ],
  },
  {
    id: 'needs-you',
    title: 'When something needs you',
    icon: 'bell',
    blurb: 'Notifications, the approvals page, and answering so agents carry on.',
    steps: [
      { id: 'bell', title: 'The bell', text: 'Every notification waits here with its buttons: tap the bell.', targets: ['[data-tour="bell"]'], done: 'tap' },
      { id: 'approvals', title: 'What waits on you', text: 'Approvals lists every decision that waits on you (on the 3D phone, its Team tab): tap one.', open: '#tab/approvals', targets: ['.apr-rows', '.phone-tabs', '.pk-main'], done: 'tap' },
      { id: 'answer', title: 'Answer it', text: 'Retry QA, Send back with a note or Merge anyway: the agent takes it from there.', open: prLink(true), targets: PR_ACTIONS, done: 'tap' },
      { id: 'carry-on', title: 'They carry on', text: "Open their chat to watch them pick up your answer.", open: agentLink, targets: AGENT_PANES, done: 'tap' },
    ],
  },
  {
    id: 'running',
    title: 'Keep it running',
    icon: 'activity',
    blurb: 'Usage and accounts, pacing, team size, disk and memory, Telegram alerts.',
    steps: [
      { id: 'usage', title: 'Usage and accounts', text: "Claude's usage for every account: tap a row for its limits.", open: '#usage', targets: ['#ops-card-usage'], done: 'tap' },
      { id: 'pacing', title: 'Pacing', text: 'Pick what the office does when usage runs high.', open: '#settings/agents', targets: ['[data-tour="pacing"]'], done: 'tap' },
      { id: 'team-size', title: 'Team size', text: 'Set the most agents a floor may have.', open: '#settings/agents', targets: ['[data-tour="team-size"]'], done: 'tap' },
      { id: 'health', title: 'Disk and memory', text: 'Free space and memory at a glance: tap the disk card for what takes room.', open: '#company/ops', targets: ['#ops-card-disk', '#ops-card-server'], done: 'tap' },
      { id: 'telegram', title: 'Alerts on Telegram', text: 'Add your Telegram bot to get alerts on your phone.', open: '#settings/notifications', targets: ['.telegram'], done: 'tap' },
    ],
  },
];

export const tutorialById = (id: string) => TUTORIALS.find((t) => t.id === id);

// ---------- what finishes a step ----------

/** Controls a tap can be on: buttons, links, fields and folds, not the page around them. */
const CONTROL = 'button, a[href], input, select, textarea, summary, label, [role="button"], [role="tab"], [role="option"]';

/** Whether a click on `el` uses the step's control: on something you can press inside one of its targets. */
export function tapUses(el: Element | null, targets: readonly string[]): boolean {
  const control = el?.closest(CONTROL);
  if (!control || control.closest('.tour')) return false;
  return targets.some((t) => {
    const ring = control.closest(t);
    return !!ring || control.matches(t);
  });
}

/** The manager's messages so far: a new one finishes a 'sent' step. */
export const sentCount = (messages: readonly { from: string }[]) => messages.filter((m) => m.from === 'manager').length;

// ---------- progress, per device ----------

export interface Progress {
  /** Where each tutorial is: the next step to do, and whether it reached the end. */
  at: Record<string, { step: number; done: boolean }>;
  /** The tutorial on screen (Resume after a reload continues it), or null. */
  running: string | null;
}

export const NO_PROGRESS: Progress = { at: {}, running: null };

/** Saved progress, tolerating anything unreadable or out of date. */
export function readProgress(raw: string | null): Progress {
  if (!raw) return NO_PROGRESS;
  try {
    const v = JSON.parse(raw) as Partial<Progress>;
    const at: Progress['at'] = {};
    for (const t of TUTORIALS) {
      const p = v.at?.[t.id];
      if (p && Number.isInteger(p.step)) at[t.id] = { step: Math.min(Math.max(0, p.step), t.steps.length), done: !!p.done };
    }
    const running = typeof v.running === 'string' && tutorialById(v.running) ? v.running : null;
    return { at, running };
  } catch {
    return NO_PROGRESS;
  }
}

/** Steps done of a tutorial, for its "3/7". */
export function doneOf(p: Progress, id: string): { done: number; total: number; finished: boolean } {
  const t = tutorialById(id);
  const total = t?.steps.length ?? 0;
  const at = p.at[id];
  return { done: at?.done ? total : Math.min(at?.step ?? 0, total), total, finished: !!at?.done };
}

/** Moves a tutorial to `step`; past its last step it's finished and leaves the screen. */
export function moveTo(p: Progress, id: string, step: number): Progress {
  const t = tutorialById(id);
  if (!t) return p;
  const finished = step >= t.steps.length;
  const done = finished || !!p.at[id]?.done;
  return { at: { ...p.at, [id]: { step: finished ? t.steps.length : Math.max(0, step), done } }, running: finished ? null : id };
}

/** Starts (or resumes) a tutorial; `restart` from its first step. */
export function startTutorial(p: Progress, id: string, restart = false): Progress {
  const t = tutorialById(id);
  if (!t) return p;
  const at = p.at[id];
  const step = restart || !at || at.step >= t.steps.length ? 0 : at.step;
  return { at: { ...p.at, [id]: { step, done: !!at?.done && !restart } }, running: id };
}

/** Puts the running tutorial away, keeping its place for Resume. */
export const pauseTutorial = (p: Progress): Progress => ({ ...p, running: null });

/** Whether this device has never opened a tutorial: the first launch offers Get started. */
export const neverStarted = (p: Progress) => !p.running && Object.keys(p.at).length === 0;
