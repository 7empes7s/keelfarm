// Reactions in the CEO chat (#118), their pure rules: the status reaction the office keeps under the manager's
// messages as the CEO's job on them moves (no CEO tokens), the reactions the CEO and the manager add, which message a
// CEO reply quotes, when a turn ends without a bubble, the manager's 👍 / 👎 as feedback for the CEO's next job, and
// Telegram's nearest reaction.
import { excerpt } from './chat.ts';
import type { MessageReaction, PhoneMessage, StatusReaction } from './types.ts';

/** What the CEO's react tool may put under a message. */
export const CEO_REACTIONS = ['👍', '👀', '✅', '❤️', '🎉', '🤔', '⚠️'] as const;
/** The manager's reaction bar, and its "more" row. */
export const MANAGER_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '🙏', '👎'] as const;
export const MORE_REACTIONS = ['🔥', '💯', '👏', '🚀', '😮', '😢', '🤔', '✅'] as const;
const ALLOWED = new Set<string>([...CEO_REACTIONS, ...MANAGER_REACTIONS, ...MORE_REACTIONS]);
/** The most reactions the manager keeps under one message. */
const MANAGER_MAX = 4;

export const isReaction = (emoji: string) => ALLOWED.has(emoji);

export const STATUS_EMOJI: Record<StatusReaction, string> = { queued: '🕓', seen: '👀', working: '⏳', done: '✅', failed: '⚠️' };
export const STATUS_WORDS: Record<StatusReaction, string> = { queued: 'queued', seen: 'seen', working: 'working on it', done: 'done', failed: 'failed or stopped' };

/** What moves a status reaction: queued behind another job, the CEO took it, it is using tools, it answered, it failed or was stopped. */
export type StatusEvent = 'queued' | 'read' | 'working' | 'replied' | 'failed';

/** The status after `ev`. Taking a message again (a retry, an edit) starts it over; ✅ and ⚠️ otherwise stay. */
export function nextStatus(s: StatusReaction | undefined, ev: StatusEvent): StatusReaction | undefined {
  switch (ev) {
    case 'queued':
      return s === 'seen' || s === 'working' ? s : 'queued';
    case 'read':
      return s === 'working' ? s : 'seen';
    case 'working':
      return s === 'seen' ? 'working' : s;
    case 'replied':
      return s === 'seen' || s === 'working' ? 'done' : s;
    case 'failed':
      return s === 'seen' || s === 'working' || s === 'queued' ? 'failed' : s;
  }
}

/** The CEO has this message in hand: picked up and not answered yet. */
export const isOpen = (m: Pick<PhoneMessage, 'from' | 'status'>) => m.from === 'manager' && (m.status === 'seen' || m.status === 'working');

/**
 * The manager's message a CEO reply at the end of its turn quotes: the one it has in hand, when other messages came
 * after it (several in a row, or one sent mid-job). Right under it, or with several in hand, the reply quotes none.
 */
export function replyTarget(messages: readonly PhoneMessage[]): number | undefined {
  const open = messages.filter(isOpen);
  if (open.length !== 1) return undefined;
  return messages[messages.length - 1] === open[0] ? undefined : open[0].id;
}

/** The message the CEO's react tool means: the one named (a manager message still in the thread), else the newest it has in hand, else the manager's latest. */
export function reactTarget(messages: readonly PhoneMessage[], id?: number): PhoneMessage | string {
  const mine = messages.filter((m) => m.from === 'manager');
  if (id !== undefined) return mine.find((m) => m.id === id) ?? `There is no message ${id} from the manager in this conversation: use the id from "(message N)".`;
  return mine.filter(isOpen).at(-1) ?? mine.at(-1) ?? 'The manager has sent nothing to react to yet.';
}

/** A turn's ending: a bubble when it says something, sends files or did something (its action cards); else it ends quietly (a reaction, or nothing to add). */
export function turnEnding(text: string, extra: Pick<PhoneMessage, 'attachments' | 'actions'>): 'reply' | 'quiet' {
  return text.trim() || extra.attachments?.length || extra.actions?.length ? 'reply' : 'quiet';
}

/** The reactions after `by` reacts with `emoji`: the CEO keeps one (a new one replaces it), the manager toggles theirs (at most MANAGER_MAX). */
export function react(list: readonly MessageReaction[] | undefined, by: MessageReaction['by'], emoji: string): MessageReaction[] {
  const all = list ?? [];
  if (by === 'ceo') return [...all.filter((r) => r.by !== 'ceo'), { by, emoji }];
  if (all.some((r) => r.by === by && r.emoji === emoji)) return all.filter((r) => !(r.by === by && r.emoji === emoji));
  const mine = all.filter((r) => r.by === by);
  return [...all.filter((r) => r.by !== by), ...mine.slice(Math.max(0, mine.length - MANAGER_MAX + 1)), { by, emoji }];
}

/** The reactions under a bubble: each emoji once, with its count and who added it, in the order they came. */
export function reactionCounts(list: readonly MessageReaction[] | undefined): { emoji: string; count: number; mine: boolean; ceo: boolean }[] {
  const out: { emoji: string; count: number; mine: boolean; ceo: boolean }[] = [];
  for (const r of list ?? []) {
    let c = out.find((x) => x.emoji === r.emoji);
    if (!c) out.push((c = { emoji: r.emoji, count: 0, mine: false, ceo: false }));
    c.count += 1;
    if (r.by === 'manager') c.mine = true;
    else c.ceo = true;
  }
  return out;
}

/** What a screen reader says for a reaction under a message. */
export function reactionLabel(c: { emoji: string; mine: boolean; ceo: boolean }, ceoName: string): string {
  const who = [c.mine && 'You', c.ceo && ceoName].filter(Boolean).join(' and ');
  return `${who} reacted ${c.emoji}${c.mine ? ', tap to remove yours' : ''}`;
}

/** What a screen reader says for a status reaction. */
export const statusLabel = (s: StatusReaction, ceoName: string) => `${ceoName} reacted ${STATUS_EMOJI[s]} ${STATUS_WORDS[s]}`;

/** The manager's 👍 / 👎 on a CEO message as a line for the CEO's next job; other reactions aren't feedback. */
export function feedbackLine(m: Pick<PhoneMessage, 'from' | 'text'>, emoji: string, note = ''): string | null {
  if (m.from !== 'ceo' || (emoji !== '👍' && emoji !== '👎')) return null;
  const why = note.trim().replace(/\s+/g, ' ').slice(0, 300);
  return `${emoji} on your reply «${excerpt(m.text, 100)}»${why ? `: ${why}` : ''}`;
}

/** The feedback lines in a job's prompt (the latest few), or '' for none. */
export function feedbackPrompt(lines: readonly string[]): string {
  if (!lines.length) return '';
  return `\n\nThe manager reacted to your replies since your last job (light feedback, no answer needed):\n${lines.slice(-5).map((l) => `- ${l}`).join('\n')}`;
}

/** The reaction Telegram shows for a message (its bots may use only some emoji): the CEO's own, else the status. Null: none fits. */
export function telegramReaction(m: Pick<PhoneMessage, 'status' | 'reactions'>): string | null {
  const ceo = m.reactions?.findLast((r) => r.by === 'ceo')?.emoji;
  const e = ceo ?? (m.status ? STATUS_EMOJI[m.status] : null);
  return e ? (TELEGRAM[e] ?? null) : null;
}
const TELEGRAM: Record<string, string> = { '👍': '👍', '👀': '👀', '✅': '👌', '❤️': '❤', '🎉': '🎉', '🤔': '🤔', '⚠️': '🤷', '⏳': '✍' };

// ---------- agent chats (#120) ----------
// The manager's emoji on an agent's message or step, and what the agent is told. Only the ones that ask for something
// reach the session, as a short typed note; the rest are shown and cost nothing.

/** The agent chat's reaction bar, in its order. */
export const REACTIONS = ['👍', '❤️', '🎉', '👀', '🤔', '👎', '⚠️'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** What each sent reaction asks the agent to do; the others need no action and aren't sent. */
const MEANING: Partial<Record<Reaction, string>> = {
  '👍': 'carry on',
  '👎': 'rethink',
  '🤔': 'explain',
  '⚠️': 'stop and check',
};

export const isAgentReaction = (x: unknown): x is Reaction => typeof x === 'string' && (REACTIONS as readonly string[]).includes(x);

/** Whether the agent is told about this reaction (a no-action one only shows). */
export const sendsNote = (r: Reaction) => r in MEANING;

/** The note typed into the agent's session: `[manager reacted 👎 to: "I'll skip the UI test"]`; null when not sent. */
export function reactionNote(r: Reaction, quote: string): string | null {
  if (!sendsNote(r)) return null;
  const one = quote.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  const q = one.length > 90 ? `${one.slice(0, 89)}…` : one;
  return `[manager reacted ${r} to: "${q}"]`;
}

/** The agent prompt's one line on reactions (paid every session: keep it short). */
export const REACTION_PROMPT = `Reactions arrive as [manager reacted 👍 to: "…"]: ${Object.entries(MEANING)
  .map(([e, m]) => `${e} ${m}`)
  .join(', ')}.`;

/** The office's status reaction on a manager's message to an agent: 👀 seen, ⏳ working on it, ✅ answered. */
export type AgentStatusReaction = '👀' | '⏳' | '✅';
