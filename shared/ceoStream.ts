// The CEO's reply as it is written (#51): its text blocks and tool steps folded into one live bubble, the "Steps" list
// a finished reply keeps, and what a stopped job says it did. Pure: the server folds, the phone draws.
import type { LogKind } from './types.ts';

export interface LiveStep {
  label: string; // "Reading company status", "Filing #47"
  state: 'running' | 'done' | 'failed';
}

/** The CEO's reply in progress. */
export interface CeoLive {
  blocks: string[]; // its text so far, a block per message (the last one may still grow while `open`)
  open: boolean;
  steps: LiveStep[]; // the latest MAX_STEPS
  stepCount: number; // every step this turn, also the ones dropped off the front
  since: number;
}

/** What a session reports while the CEO writes: a text block (done: it won't grow), or one of its log lines. */
export type StreamEvent = { kind: 'text'; text: string; done: boolean } | { kind: 'log'; entry: { kind: LogKind; text: string; tool?: string } };

export const MAX_STEPS = 30;
const MAX_BLOCKS = 4;
const BLOCK_MAX = 4000;

const OFFICE_STEPS: Record<string, string> = {
  company_status: 'Reading company status',
  agent_detail: 'Checking on an agent',
  agent_log: "Reading an agent's log",
  set_floor_profile: 'Writing a floor profile',
  scale_team: 'Sizing a team',
  configure_agent: 'Setting up an agent',
  file_issue: 'Filing an issue',
  set_dependencies: 'Ordering issues',
  close_issue: 'Closing an issue',
  retry_qa: 'Sending a PR back to QA',
  send_back: 'Sending a PR back for a fix',
  rerun_checks: 'Re-running checks',
  close_pull: 'Closing a pull request',
  escalate: 'Escalating a pull request',
  attach_file: 'Attaching a file',
  keep_file: 'Keeping a file',
  set_mandate: 'Setting a mandate',
  define_experiment: 'Setting up an experiment',
  restart_agent: 'Restarting an agent',
  message_agent: 'Messaging an agent',
  qa_report: 'Reading a QA report',
  worktree_file: "Reading an agent's file",
  pr_diff: 'Reading a pull request',
  send_telegram: 'Sending to Telegram',
  session_history: 'Reading session history',
};

const TOOL_STEPS: Record<string, string> = {
  WebSearch: 'Searching the web',
  WebFetch: 'Reading a web page',
  Grep: 'Searching files',
  Glob: 'Searching files',
  Bash: 'Running a command',
  TodoWrite: 'Planning',
  Task: 'Asking a helper',
  Agent: 'Asking a helper',
  Skill: 'Using a skill',
};

/** A tool call in a few plain words. `detail`: its log line, e.g. "⏺ Read ceo/NOTES.md". */
export function stepLabel(tool: string, detail = ''): string {
  const office = tool.match(/^mcp__office__(\w+)$/);
  if (office) return OFFICE_STEPS[office[1]] ?? office[1].replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const notes = /NOTES\.md/i.test(detail);
  if (tool === 'Read') return notes ? 'Reading its notes' : 'Reading files';
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') return notes ? 'Updating its notes' : 'Writing a file';
  const mcp = tool.match(/^mcp__(.+?)__/);
  if (mcp) return `Using ${mcp[1].replace(/^claude_ai_/, '').replace(/[_-]+/g, ' ')}`;
  return TOOL_STEPS[tool] ?? `Using ${tool}`;
}

const fresh = (now: number): CeoLive => ({ blocks: [], open: false, steps: [], stepCount: 0, since: now });

/** The live reply with one more event folded in (a new object; `live` null: the first of a turn). */
export function foldStream(live: CeoLive | null, ev: StreamEvent, now: number): CeoLive {
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
    const done = l.steps.map((s) => (s.state === 'running' ? { ...s, state: 'done' as const } : s));
    return { ...l, open: false, steps: [...done, { label: stepLabel(e.tool, e.text), state: 'running' as const }].slice(-MAX_STEPS), stepCount: l.stepCount + 1 };
  }
  if (!last || last.state !== 'running' || (e.kind !== 'result' && e.kind !== 'error')) return l;
  // A filed issue says its number: "Filing #47".
  const filed = last.label === OFFICE_STEPS.file_issue && e.kind === 'result' ? e.text.match(/#(\d+)/) : null;
  const step: LiveStep = { label: filed ? `Filing #${filed[1]}` : last.label, state: e.kind === 'error' ? 'failed' : 'done' };
  return { ...l, steps: [...l.steps.slice(0, -1), step] };
}

/** The text the live bubble shows. */
export const liveText = (l: CeoLive) => l.blocks.join('\n\n');

/** The step the live line shows: the one running, else the last. */
export const currentStep = (l: CeoLive): LiveStep | null => l.steps.find((s) => s.state === 'running') ?? l.steps[l.steps.length - 1] ?? null;

/** The "Steps" a finished reply keeps: their labels, a failed one marked. */
export const finishedSteps = (l: CeoLive | null): string[] => (l ? l.steps.map((s) => (s.state === 'failed' ? `✗ ${s.label}` : s.label)) : []);

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
  const pending = acts.filter((c) => c.out === null).map((c) => OFFICE_STEPS[c.tool]?.toLowerCase() ?? c.tool);
  const parts = ['■ Stopped.'];
  parts.push(done.length ? `Done before you stopped me:\n${done.map((d) => `- ${d}`).join('\n')}` : 'Nothing was changed.');
  if (pending.length) parts.push(`Still finishing: ${pending.join(', ')}.`);
  if (refused) parts.push(`${refused} call${refused === 1 ? ' was' : 's were'} refused, so ${refused === 1 ? 'it' : 'they'} changed nothing.`);
  return parts.join('\n\n');
}
