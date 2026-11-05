import { describe, expect, it } from 'vitest';
import { QUOTE_CHARS, RESEARCH_PREFIX, excerpt, forwardText, isQuestion, nextDelivery, parseForwarded, researchTopic, settleOutbox, yesNoFor, type OutgoingMessage } from './chat.ts';
import type { PhoneMessage } from './types.ts';

describe('forwardText', () => {
  it('quotes the message the manager replies to', () => {
    expect(forwardText('Yes, go ahead', { from: 'ceo', text: 'Shall I grow floor 2?' })).toBe('Replying to your message: «Shall I grow floor 2?»\nYes, go ahead');
    expect(forwardText('and this', { from: 'manager', text: 'first' })).toBe('Replying to my earlier message: «first»\nand this');
  });

  it('trims a long quote to about 300 characters, on one line', () => {
    const long = `1- ${'word '.repeat(200)}`;
    const quote = parseForwarded(forwardText('ok', { from: 'ceo', text: `line one\n\n${long}` }))!.quote;
    expect(quote.length).toBeLessThanOrEqual(QUOTE_CHARS);
    expect(quote.startsWith('line one 1- word')).toBe(true);
    expect(quote.endsWith('…')).toBe(true);
    expect(excerpt('  short\ttext  ')).toBe('short text');
  });

  it('quotes Markdown as plain words', () => {
    expect(excerpt('**Quick status:** see [docs](https://x.io)\n\n- one\n- `two`\n```bash\nnpm i\n```\n> done')).toBe('Quick status: see docs one two … done');
    expect(excerpt('| a | b |\n| --- | ---: |\n| 1 | 2 |')).toBe('a · b · 1 · 2');
  });

  it('forwards just the text when the original is gone', () => {
    expect(forwardText('Yes', undefined)).toBe('Yes');
    expect(forwardText('Yes', null)).toBe('Yes');
  });

  it('reads the quote back (the demo CEO answers with it)', () => {
    expect(parseForwarded('Message from the manager: Replying to your message: «Go?» Yes')).toEqual({ quote: 'Go?', reply: 'Yes' });
    expect(parseForwarded('Just a message')).toBeNull();
  });
});

describe('researchTopic', () => {
  it("reads the topic of the 🔎 button's message and a typed one", () => {
    expect(researchTopic(`${RESEARCH_PREFIX}voice notes on phones`)).toBe('voice notes on phones');
    expect(researchTopic('  research:   how others do onboarding ')).toBe('how others do onboarding');
    expect(researchTopic('🔎 Research: dark mode')).toBe('dark mode');
  });

  it('is null for other messages', () => {
    expect(researchTopic('Can you research dark mode?')).toBeNull();
    expect(researchTopic('Research:   ')).toBeNull();
  });
});

describe('nextDelivery', () => {
  it('moves forward: sending → sent → read → replied', () => {
    expect(nextDelivery('sending', 'posted')).toBe('sent');
    expect(nextDelivery('sent', 'read')).toBe('read');
    expect(nextDelivery('read', 'replied')).toBe('replied');
  });

  it('never moves back', () => {
    expect(nextDelivery('replied', 'read')).toBe('replied');
    expect(nextDelivery('read', 'posted')).toBe('read');
    expect(nextDelivery('replied', 'failed')).toBe('replied');
  });

  it('a reply needs the CEO to have read it, and a read needs it to have arrived', () => {
    expect(nextDelivery('sent', 'replied')).toBe('sent');
    expect(nextDelivery('sending', 'read')).toBe('sending');
    expect(nextDelivery('failed', 'read')).toBe('failed');
  });

  it('a failed send goes back to sending only by a retry', () => {
    expect(nextDelivery('sending', 'failed')).toBe('failed');
    expect(nextDelivery('failed', 'posted')).toBe('failed');
    expect(nextDelivery('failed', 'retry')).toBe('sending');
    expect(nextDelivery('sent', 'retry')).toBe('sent');
  });
});

describe('quick Yes / No', () => {
  const m = (id: number, from: PhoneMessage['from'], text: string, extra: Partial<PhoneMessage> = {}): PhoneMessage => ({ id, from, text, at: id, ...extra });

  it('spots questions, past trailing emphasis', () => {
    expect(isQuestion('Shall I grow floor 2?')).toBe(true);
    expect(isQuestion('**Merge it?**  ')).toBe(true);
    expect(isQuestion('Done. Anything else? No rush.')).toBe(false);
  });

  it('offers them on the CEO’s latest message while it is an unanswered question', () => {
    expect(yesNoFor([m(1, 'manager', 'hi'), m(2, 'ceo', 'Grow floor 1?')])).toBe(2);
    expect(yesNoFor([m(2, 'ceo', 'Grow floor 1?'), m(3, 'office', 'note')])).toBe(2);
    expect(yesNoFor([m(2, 'ceo', 'Grow floor 1?'), m(3, 'manager', 'yes')])).toBeNull();
    expect(yesNoFor([m(2, 'ceo', 'Hire Ada?', { requestId: 'r1' })])).toBeNull();
    expect(yesNoFor([m(2, 'ceo', 'All good.')])).toBeNull();
  });
});

describe('settleOutbox', () => {
  const out = (key: number, text: string, extra: Partial<OutgoingMessage> = {}): OutgoingMessage => ({ key, text, at: key, delivery: 'sending', ...extra });

  it('drops the send the office now has, and only that one', () => {
    const box = [out(1, 'hi'), out(2, 'hi', { replyTo: 4 }), out(3, 'hi')];
    expect(settleOutbox(box, { from: 'manager', text: 'hi', replyTo: 4 }).map((o) => o.key)).toEqual([1, 3]);
    expect(settleOutbox(box, { from: 'manager', text: 'hi' }).map((o) => o.key)).toEqual([2, 3]);
    expect(settleOutbox(box, { from: 'ceo', text: 'hi' })).toHaveLength(3);
  });

  it('keeps failed sends for their retry', () => {
    expect(settleOutbox([out(1, 'hi', { delivery: 'failed' })], { from: 'manager', text: 'hi' })).toHaveLength(1);
  });
});
