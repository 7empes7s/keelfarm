// The IT department (#524): a named IT lead with its own session, chat, Telegram bot and setup, owning this machine's
// health with #506's it_run / it_propose. The CEO hands machine questions over with ask_it. What both sides share: the
// settings, the chat's view and the saved state's rules. Pure.
import type { PhoneMessage } from './types/chat.ts';
import type { AgentCli, EffortLevel } from './types/agents.ts';
import type { TelegramView } from './types/notify.ts';

/** The IT lead's agent id: never in the office's agent list, so no floor, desk or task is ever theirs. */
export const IT_ID = 'it-lead';

/** Settings → The IT department. */
export interface ItDeptSettings {
  on: boolean;
  name: string; // the IT lead's name; the chat is headed "IT"
  cli: AgentCli;
  account: string; // an account id or tag (Providers & accounts); '' = the coding agent's default (the rotation)
  model: string; // '' = the coding agent's default
  effort: EffortLevel;
}

/** A mid model and effort: IT reads a few commands and writes a short answer, so cost stays low. */
export const IT_DEPT_DEFAULTS: ItDeptSettings = { on: true, name: 'Iris', cli: 'claude', account: '', model: 'claude-sonnet-5-5', effort: 'medium' };

const CLIS: readonly AgentCli[] = ['claude', 'codex', 'opencode', 'gemini'];
const EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const IT_NAME_MAX = 24;

/** A settings patch over `prev`, every field checked; anything wrong keeps what was there. */
export function itDeptSettings(prev: ItDeptSettings | undefined, raw: unknown): ItDeptSettings {
  const p = { ...IT_DEPT_DEFAULTS, ...prev };
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, IT_NAME_MAX) : '';
  return {
    on: typeof r.on === 'boolean' ? r.on : p.on,
    name: name || p.name,
    cli: CLIS.includes(r.cli as AgentCli) ? (r.cli as AgentCli) : p.cli,
    account: typeof r.account === 'string' ? r.account.trim().slice(0, 60) : p.account,
    model: typeof r.model === 'string' ? r.model.trim().slice(0, 120) : p.model,
    effort: EFFORTS.includes(r.effort as EffortLevel) ? (r.effort as EffortLevel) : p.effort,
  };
}

/** What wakes IT: the manager's message, the CEO's ask_it, a change the manager ran (to check and report), or a ticket (#542). */
export type ItJob =
  | { kind: 'chat'; text: string; messageIds: number[]; at: number }
  | { kind: 'ask'; from: string; text: string; messageId: number; at: number }
  | { kind: 'ran'; line: string; code: number | null; out: string; at: number }
  | { kind: 'ticket'; id: number; text: string; at: number }; // text: the ticket's brief when it woke IT

/** The saved IT department: its chat, its queue and the session it resumes. */
export interface ItState {
  messages: PhoneMessage[];
  queue: ItJob[];
  job: ItJob | null;
  sessionId: string | null;
  sessionCli: AgentCli | null;
  costUsd: number;
}

export const IT_MESSAGES_KEPT = 200;
/** The snapshot's share of the chat: the latest ones (the rest stay saved for IT's own reading). */
export const IT_MESSAGES_SHOWN = 60;
const QUEUE_MAX = 20;

/** The saved state, cleaned; a job cut off by a restart goes back to the front of the queue. */
export function loadIt(raw: unknown): ItState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ItState>;
  const queue = (Array.isArray(r.queue) ? r.queue : []).filter((j) => j && typeof j.kind === 'string');
  if (r.job && typeof r.job.kind === 'string') queue.unshift(r.job);
  return {
    messages: (Array.isArray(r.messages) ? r.messages : []).filter((m) => m && typeof m.id === 'number').slice(-IT_MESSAGES_KEPT),
    queue: queue.slice(0, QUEUE_MAX),
    job: null,
    sessionId: typeof r.sessionId === 'string' ? r.sessionId : null,
    sessionCli: CLIS.includes(r.sessionCli as AgentCli) ? (r.sessionCli as AgentCli) : null,
    costUsd: Number(r.costUsd) || 0,
  };
}

/** Queues a job: the manager's messages join one waiting chat job, so a burst is one turn; the queue stays short. */
export function queueItJob(queue: ItJob[], job: ItJob): void {
  const waiting = job.kind === 'chat' ? queue.find((j): j is Extract<ItJob, { kind: 'chat' }> => j.kind === 'chat') : undefined;
  if (waiting && job.kind === 'chat') {
    waiting.text = `${waiting.text}\n${job.text}`;
    waiting.messageIds.push(...job.messageIds);
    return;
  }
  // A ticket already waiting: its newer brief replaces the old one.
  const same = job.kind === 'ticket' ? queue.findIndex((j) => j.kind === 'ticket' && j.id === job.id) : -1;
  if (same >= 0) return void (queue[same] = job);
  if (queue.length >= QUEUE_MAX) queue.splice(0, 1);
  queue.push(job);
}

/** The next job: the manager's messages first, then the oldest. */
export function nextItJob(queue: ItJob[]): ItJob | undefined {
  const i = queue.findIndex((j) => j.kind === 'chat');
  return queue.splice(i >= 0 ? i : 0, 1)[0];
}

/** The IT chat for the phone: the lead's name, whether they are working, the latest messages and their own Telegram bot. */
export interface ItView {
  on: boolean;
  name: string;
  busy: boolean;
  messages: PhoneMessage[];
  telegram: TelegramView;
}

/** Text for Telegram when IT has no bot of its own: on the CEO's, labelled. */
export const viaCeoBot = (text: string) => `IT: ${text}`;
