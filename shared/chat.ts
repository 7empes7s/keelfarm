// The phone chat with the CEO, its pure rules: what a reply forwards to the CEO, how a manager's message moves
// through its delivery states, and which CEO messages offer quick Yes / No replies.

import type { Delivery, PhoneMessage } from './types.ts';

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
  sent: 'Sent',
  read: 'Read',
  replied: 'Replied',
  failed: 'Failed, tap to retry',
};

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
  text: string;
  replyTo?: number;
  at: number;
  delivery: Extract<Delivery, 'sending' | 'failed'>;
}

/** The outbox once the office's copy of a message arrived: the send it came from (same text and reply) is done. */
export function settleOutbox(outbox: readonly OutgoingMessage[], m: Pick<PhoneMessage, 'from' | 'text' | 'replyTo'>): OutgoingMessage[] {
  if (m.from !== 'manager') return [...outbox];
  const i = outbox.findIndex((o) => o.delivery === 'sending' && o.text.trim() === m.text && o.replyTo === m.replyTo);
  return i < 0 ? [...outbox] : outbox.filter((_, j) => j !== i);
}
