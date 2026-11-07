// The CEO's reply as it is written (#51): its text blocks and tool steps folded into one live bubble, the step log a
// finished reply keeps (#150), and what a stopped job says it did. Pure: the server folds, the phone draws.
import { filedWords, stepNote, stepWords, type NameOf } from './ceoSteps.ts';
import type { LogKind } from './types.ts';

export interface LiveStep {
  label: string; // in plain words (shared/ceoSteps.ts): "Reading PR #122's changes on floor 3"
  icon: string;
  state: 'running' | 'done' | 'failed';
  at: number; // when it started
  ms?: number; // how long it took, once it ended
  note?: string; // its result in a line, or why it failed (masked)
}

/** The CEO's reply in progress. */
export interface CeoLive {
  blocks: string[]; // its text so far, a block per message (the last one may still grow while `open`)
  open: boolean;
  steps: LiveStep[]; // the latest MAX_STEPS
  stepCount: number; // every step this turn, also the ones dropped off the front
  since: number;
}

/** The steps a finished reply keeps (PhoneMessage.log): the latest MAX_STEPS, how many there were and how long it took. */
export interface StepLog {
  steps: LiveStep[];
  count: number;
  ms: number;
}

/** What a session reports while the CEO writes: a text block (done: it won't grow), or one of its log lines. */
export type StreamEvent = { kind: 'text'; text: string; done: boolean } | { kind: 'log'; entry: { kind: LogKind; text: string; tool?: string } };

export const MAX_STEPS = 50;
const MAX_BLOCKS = 4;
const BLOCK_MAX = 4000;

const fresh = (now: number): CeoLive => ({ blocks: [], open: false, steps: [], stepCount: 0, since: now });
const ended = (s: LiveStep, now: number, state: 'done' | 'failed' = 'done'): LiveStep => ({ ...s, state, ms: Math.max(0, now - s.at) });

/** The live reply with one more event folded in (a new object; `live` null: the first of a turn). `nameOf`: agents' names. */
export function foldStream(live: CeoLive | null, ev: StreamEvent, now: number, nameOf?: NameOf): CeoLive {
  const l = live ?? fresh(now);
  if (ev.kind === 'text') {
    const text = ev.text.trim().slice(0, BLOCK_MAX);
    if (!text) return l;
    const blocks = l.open ? [...l.blocks.slice(0, -1), text] : [...l.blocks, text];
    return { ...l, blocks: blocks.slice(-MAX_BLOCKS), open: !ev.done };
  }
  const e = ev.entry;
  const last = l.steps[l.steps.length - 1];
  if (e.kind === 'tool' && e.tool) {
    const done = l.steps.map((s) => (s.state === 'running' ? ended(s, now) : s));
    const w = stepWords(e.tool, e.text, nameOf);
    return { ...l, open: false, steps: [...done, { label: w.text, icon: w.icon, state: 'running' as const, at: now }].slice(-MAX_STEPS), stepCount: l.stepCount + 1 };
  }
  if (!last || last.state !== 'running' || (e.kind !== 'result' && e.kind !== 'error')) return l;
  const note = stepNote(e.text);
  // A filed issue says its number: "Filed floor 3 #149".
  const filed = last.icon === '📝' && e.kind === 'result' ? filedWords(e.text, Number(last.label.match(/floor (\d+)/)?.[1]) || null) : null;
  const step: LiveStep = { ...ended(last, now, e.kind === 'error' ? 'failed' : 'done'), ...(filed && { label: filed }), ...(note && { note }) };
  return { ...l, steps: [...l.steps.slice(0, -1), step] };
}

/** The text the live bubble shows. */
export const liveText = (l: CeoLive) => l.blocks.join('\n\n');

/** The step the live line shows: the one running, else the last. */
export const currentStep = (l: CeoLive): LiveStep | null => l.steps.find((s) => s.state === 'running') ?? l.steps[l.steps.length - 1] ?? null;

/** The step log a finished reply keeps: a step still running counts as done now; null when it took none. */
export function finishedLog(l: CeoLive | null, now: number): StepLog | null {
  if (!l?.steps.length) return null;
  return { steps: l.steps.map((s) => (s.state === 'running' ? ended(s, now) : s)), count: l.stepCount, ms: Math.max(0, now - l.since) };
}

/** One office tool call of a CEO job, as it ended (or still running: `out` null). */
export interface OfficeCall {
  tool: string; // office tool name, e.g. file_issue
  ok: boolean;
  out: string | null;
  args?: Record<string, unknown>; // its input, for the reply's action cards (shared/ceoActions.ts)
}

// The office tools that only read: a stopped job's reply leaves them out of what it did.
const READS = new Set(['company_status', 'agent_detail', 'agent_log', 'qa_report', 'worktree_file', 'pr_diff', 'session_history']);

/**
 * What a stopped job's reply says (#51). Tools the CEO called stay done (the office finishes a call it started, so
 * nothing is half-filed); the reply names them, and any still finishing when it was written.
 */
export function stopReply(calls: readonly OfficeCall[]): string {
  const acts = calls.filter((c) => !READS.has(c.tool));
  const done = acts.filter((c) => c.out !== null && c.ok).map((c) => c.out!.split('\n')[0].replace(/[.\s]+$/, '').slice(0, 160));
  const refused = acts.filter((c) => c.out !== null && !c.ok).length;
  const pending = acts.filter((c) => c.out === null).map((c) => stepWords(`mcp__office__${c.tool}`).text.toLowerCase());
  const parts = ['■ Stopped.'];
  parts.push(done.length ? `Done before you stopped me:\n${done.map((d) => `- ${d}`).join('\n')}` : 'Nothing was changed.');
  if (pending.length) parts.push(`Still finishing: ${pending.join(', ')}.`);
  if (refused) parts.push(`${refused} call${refused === 1 ? ' was' : 's were'} refused, so ${refused === 1 ? 'it' : 'they'} changed nothing.`);
  return parts.join('\n\n');
}
