// The phone chat with the CEO, its pure rules: what a reply forwards to the CEO, how a manager's message moves
// through its delivery states, which CEO messages offer quick Yes / No replies, and which message starts research.

import type { CeoHeld, Delivery, PhoneMessage } from './types.ts';
import type { FileRef } from './files.ts';

/** How much of a quoted message is forwarded to the CEO (and shown in the reply's quote). */
export const QUOTE_CHARS = 300;

/** The CEO's Markdown as plain words for a quote: no emphasis, link syntax, list, heading or table marks, code shown as "…". */
export function plainQuote(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' … ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2')
    .replace(/^\s*(?:[-*+]|\d+\.|#{1,6}|>)\s+/gm, '')
    .replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, '')
    .replace(/\s*\|\s*/g, ' · ');
}

/** A message's text on one line as plain words, cut to `max` characters with an ellipsis. */
export function excerpt(text: string, max = QUOTE_CHARS): string {
  const t = plainQuote(text).replace(/\s+/g, ' ').replace(/(?: ·)+ /g, ' · ').replace(/^ · | · $/g, '').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** What the CEO gets for the manager's message: with a quote of the message it replies to, when that's still saved. */
export function forwardText(text: string, quoted?: Pick<PhoneMessage, 'from' | 'text'> | null): string {
  if (!quoted) return text;
  const what = quoted.from === 'ceo' ? 'your message' : quoted.from === 'manager' ? 'my earlier message' : "the office's note";
  return `Replying to ${what}: «${excerpt(quoted.text)}»\n${text}`;
}

/** The quote line forwardText puts first: what was quoted, and the reply under it. Null for a message without one. */
export function parseForwarded(text: string): { quote: string; reply: string } | null {
  const m = text.match(/Replying to (?:your message|my earlier message|the office's note): «([^»]*)»\s*([\s\S]*)/);
  return m ? { quote: m[1], reply: m[2].trim() } : null;
}

/** What the chat's 🔎 button puts before the message box's text: a message starting with it starts a research job. */
export const RESEARCH_PREFIX = 'Research: ';

/** The topic of a "Research: <topic>" message (the 🔎 button's, or typed), or null for any other message. */
export function researchTopic(text: string): string | null {
  const m = text.match(/^\s*(?:🔎\s*)?research\s*:\s*([\s\S]+)/i);
  return m ? m[1].trim().slice(0, 1000) || null : null;
}

/** What moves a manager's message along: the POST answered (or not), a retry, the CEO took it, the CEO replied. */
export type DeliveryEvent = 'posted' | 'failed' | 'retry' | 'read' | 'replied';

const ORDER: Delivery[] = ['sending', 'sent', 'read', 'replied'];

/** The delivery state after `ev`. It only moves forward (sending → sent → read → replied); a failed send goes back to sending only by a retry. */
export function nextDelivery(d: Delivery, ev: DeliveryEvent): Delivery {
  switch (ev) {
    case 'failed':
      return d === 'sending' ? 'failed' : d;
    case 'retry':
      return d === 'failed' ? 'sending' : d;
    case 'posted':
      return d === 'sending' ? 'sent' : d;
    case 'read':
    case 'replied': {
      const to = ev === 'read' ? 'read' : 'replied';
      const at = ORDER.indexOf(d);
      // The CEO only reads what reached the office, and only replies to what they read.
      if (at < 1) return d;
      if (to === 'replied' && d === 'sent') return d;
      return ORDER.indexOf(to) > at ? to : d;
    }
  }
}

/** The words a screen reader and the bubble's tick say for a delivery state. */
export const DELIVERY_LABEL: Record<Delivery, string> = {
  sending: 'Sending…',
  sent: 'Queued',
  read: 'Read',
  replied: 'Replied',
  failed: 'Failed, tap to retry',
};

/** The banner above the composer while the CEO can't take the manager's message (#46): why, and when it can. */
export function heldBanner(held: CeoHeld): string {
  const at = new Date(held.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `Usage limit: resumes ${at}. Your message waits until then.`;
}

/** True when a CEO message ends with a question, so the phone offers Yes / No. Trailing emphasis and quotes are ignored. */
export function isQuestion(text: string): boolean {
  return /\?[\s*_`)"'»”]*$/.test(text.trim());
}

/** The CEO message the phone offers quick Yes / No replies to: their latest, if it's a question nobody has answered yet. */
export function yesNoFor(messages: readonly PhoneMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.from === 'manager') return null;
    if (m.from === 'ceo') return !m.requestId && isQuestion(m.text) ? m.id : null;
  }
  return null;
}

/** A message the phone is sending (or failed to send): shown at the end of the thread until the office has it. */
export interface OutgoingMessage {
  key: number; // this phone's own id for it
  clientId: string; // sent with it: the office saves it once however often it arrives (#216)
  text: string;
  replyTo?: number;
  files?: FileRef[]; // uploaded already: the message carries their ids
  at: number;
  delivery: Extract<Delivery, 'sending' | 'failed'>;
}

/** The outbox once the office's copy of a message arrived: the send it came from (same text, reply and files) is done. */
export function settleOutbox(outbox: readonly OutgoingMessage[], m: Pick<PhoneMessage, 'from' | 'text' | 'replyTo' | 'attachments' | 'clientId'>): OutgoingMessage[] {
  if (m.from !== 'manager') return [...outbox];
  if (m.clientId && outbox.some((o) => o.clientId === m.clientId)) return outbox.filter((o) => o.clientId !== m.clientId);
  const ids = (fs?: readonly FileRef[]) => (fs ?? []).map((f) => f.id).join();
  const i = outbox.findIndex((o) => o.delivery === 'sending' && o.text.trim() === m.text && o.replyTo === m.replyTo && ids(o.files) === ids(m.attachments));
  return i < 0 ? [...outbox] : outbox.filter((_, j) => j !== i);
}

/** The manager's message already saved for this client id (a resend after a reload or a lost answer, #216), if any. */
export function alreadySent(messages: readonly PhoneMessage[], clientId: string | undefined): PhoneMessage | undefined {
  return clientId ? messages.find((m) => m.from === 'manager' && m.clientId === clientId) : undefined;
}

// ---------- backend stays backend (#193) ----------

/** The CLI's own markup: background-task results, system reminders, slash-command output. Never the manager's words. */
const HARNESS_TAGS = 'task-notification|system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|command-name|command-message|command-args|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook';
const HARNESS_START = new RegExp(`^\\s*<(${HARNESS_TAGS})>`);
const HARNESS_BLOCK = new RegExp(`<(${HARNESS_TAGS})>[\\s\\S]*?(?:</\\1>|$)`, 'g');

/** True for text that is only the CLI session's harness output (a task notification…), not something a person wrote. */
export const isHarnessText = (text: string) => HARNESS_START.test(text) && !stripHarness(text);

/** The text without the harness's blocks (a CEO reply that echoed one); '' when nothing else is left. */
export const stripHarness = (text: string) => text.replace(HARNESS_BLOCK, '').trim();

/**
 * The thread without harness output stored as the manager's messages (before #193 they could be), and without the
 * CEO's answers to them: its replies quoting one, and the CEO message straight after one.
 */
export function hideHarness(messages: readonly PhoneMessage[]): PhoneMessage[] {
  const gone = new Set<number>();
  let after: number | null = null; // the harness message the CEO's next message would answer
  for (const m of messages) {
    if (m.from === 'manager' && isHarnessText(m.text)) {
      gone.add(m.id);
      after = m.id;
    } else if (m.from === 'ceo' && (after !== null || (m.replyTo !== undefined && gone.has(m.replyTo)))) {
      gone.add(m.id);
      after = null;
    } else if (m.from === 'manager') after = null;
  }
  return gone.size ? messages.filter((m) => !gone.has(m.id)) : [...messages];
}

/** How the chat shows a message: the office's notes as a one-line pill (a notice with buttons as a card), harness output not at all. */
export function messageLook(m: Pick<PhoneMessage, 'from' | 'text' | 'notice'>): 'bubble' | 'pill' | 'card' | 'hidden' {
  if (m.from === 'office') return m.notice ? 'card' : 'pill';
  return isHarnessText(m.text) ? 'hidden' : 'bubble';
}
