import { describe, expect, it } from 'vitest';
import { feedbackLine, feedbackPrompt, nextStatus, react, reactionCounts, reactTarget, replyTarget, statusLabel, telegramReaction, turnEnding, type StatusEvent } from './reactions.ts';
import type { PhoneMessage, StatusReaction } from './types.ts';

const msg = (id: number, from: PhoneMessage['from'], extra: Partial<PhoneMessage> = {}): PhoneMessage => ({ id, from, text: `message ${id}`, at: id, ...extra });

describe('status reactions', () => {
  const run = (evs: StatusEvent[], from?: StatusReaction) => evs.reduce<StatusReaction | undefined>((s, ev) => nextStatus(s, ev), from);

  it('goes 🕓 → 👀 → ⏳ → ✅ as the job moves, and ⚠️ when it fails or is stopped', () => {
    expect(run(['queued'])).toBe('queued');
    expect(run(['queued', 'read'])).toBe('seen');
    expect(run(['queued', 'read', 'working'])).toBe('working');
    expect(run(['read', 'working', 'replied'])).toBe('done');
    expect(run(['read', 'replied'])).toBe('done'); // answered without a tool call
    expect(run(['read', 'working', 'failed'])).toBe('failed');
    expect(run(['queued', 'failed'])).toBe('failed'); // stopped before it started
  });

  it('keeps ✅ and ⚠️ until the CEO takes the message again (a retry or an edit)', () => {
    expect(run(['working', 'failed'], 'done')).toBe('done');
    expect(run(['replied', 'working'], 'failed')).toBe('failed');
    expect(run(['read'], 'failed')).toBe('seen');
    expect(run(['queued'], 'done')).toBe('queued');
    expect(run(['read'], 'working')).toBe('working'); // a second read mid-job doesn't step back
    expect(run(['working', 'replied'])).toBeUndefined(); // a message never picked up gets none
  });

  it('labels them for screen readers', () => {
    expect(statusLabel('done', 'Mimoun')).toBe('Mimoun reacted ✅ done');
    expect(statusLabel('queued', 'Mimoun')).toBe('Mimoun reacted 🕓 queued');
  });
});

describe('which message a CEO reply quotes', () => {
  it('quotes none when it answers the message right above it', () => {
    expect(replyTarget([msg(1, 'manager', { status: 'done' }), msg(2, 'ceo'), msg(3, 'manager', { status: 'working' })])).toBeUndefined();
  });

  it('quotes the one in hand when others came after it (a message sent mid-job, or the answer to another)', () => {
    expect(replyTarget([msg(1, 'manager', { status: 'working' }), msg(2, 'manager', { status: 'queued' })])).toBe(1);
    expect(replyTarget([msg(1, 'manager', { status: 'done' }), msg(2, 'manager', { status: 'seen' }), msg(3, 'ceo', { replyTo: 1 })])).toBe(2);
  });

  it('quotes none when it has several in hand: each gets its own answer through reply', () => {
    expect(replyTarget([msg(1, 'manager', { status: 'seen' }), msg(2, 'manager', { status: 'seen' })])).toBeUndefined();
    expect(replyTarget([msg(1, 'manager'), msg(2, 'ceo')])).toBeUndefined(); // nothing in hand
  });

  it("finds the message the CEO's react means", () => {
    const thread = [msg(1, 'manager', { status: 'done' }), msg(2, 'ceo'), msg(3, 'manager', { status: 'seen' }), msg(4, 'manager', { status: 'queued' })];
    expect(reactTarget(thread)).toMatchObject({ id: 3 }); // the one in hand
    expect(reactTarget(thread, 1)).toMatchObject({ id: 1 });
    expect(reactTarget(thread, 2)).toMatch(/no message 2 from the manager/);
    expect(reactTarget([msg(1, 'manager', { status: 'done' })])).toMatchObject({ id: 1 });
    expect(reactTarget([])).toMatch(/nothing to react to/);
  });
});

describe('a turn that ends without words', () => {
  it('posts no bubble for a blank reply (a reaction said it), but does for files or action cards', () => {
    expect(turnEnding('', {})).toBe('quiet');
    expect(turnEnding('  \n', {})).toBe('quiet');
    expect(turnEnding('Done.', {})).toBe('reply');
    expect(turnEnding('', { attachments: [{ id: 'f1', name: 'plan.md', type: 'text/markdown', size: 10, from: 'ceo', at: 1, keep: false }] })).toBe('reply');
    expect(turnEnding('', { actions: [{} as NonNullable<PhoneMessage['actions']>[number]] })).toBe('reply');
  });
});

describe('reactions', () => {
  it('gives the CEO one reaction (a new one replaces it) and toggles the manager’s, at most four', () => {
    let r = react(undefined, 'ceo', '👀');
    r = react(r, 'ceo', '✅');
    expect(r).toEqual([{ by: 'ceo', emoji: '✅' }]);
    r = react(r, 'manager', '👍');
    r = react(r, 'manager', '❤️');
    expect(reactionCounts(r)).toEqual([
      { emoji: '✅', count: 1, mine: false, ceo: true },
      { emoji: '👍', count: 1, mine: true, ceo: false },
      { emoji: '❤️', count: 1, mine: true, ceo: false },
    ]);
    expect(react(r, 'manager', '👍').map((x) => x.emoji)).toEqual(['✅', '❤️']); // tapped again: removed
    for (const e of ['🎉', '🙏', '😂']) r = react(r, 'manager', e);
    expect(r.filter((x) => x.by === 'manager').map((x) => x.emoji)).toEqual(['❤️', '🎉', '🙏', '😂']);
    expect(reactionCounts([...react(undefined, 'ceo', '👍'), { by: 'manager', emoji: '👍' }])).toEqual([{ emoji: '👍', count: 2, mine: true, ceo: true }]);
  });

  it("turns the manager's 👍 / 👎 on a CEO reply into light feedback for its next job", () => {
    const m = { from: 'ceo' as const, text: 'I filed **#4** for the fix.' };
    expect(feedbackLine(m, '👍')).toBe('👍 on your reply «I filed #4 for the fix.»');
    expect(feedbackLine(m, '👎', '  too   vague ')).toBe('👎 on your reply «I filed #4 for the fix.»: too vague');
    expect(feedbackLine(m, '❤️')).toBeNull();
    expect(feedbackLine({ from: 'manager', text: 'hi' }, '👍')).toBeNull();
    expect(feedbackPrompt([])).toBe('');
    const p = feedbackPrompt(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(p).toMatch(/no answer needed/);
    expect(p).not.toContain('- a');
    expect(p).toContain('- f');
  });

  it("picks Telegram's nearest reaction: the CEO's own, else the status", () => {
    expect(telegramReaction({ status: 'working' })).toBe('✍');
    expect(telegramReaction({ status: 'done' })).toBe('👌');
    expect(telegramReaction({ status: 'done', reactions: [{ by: 'ceo', emoji: '❤️' }] })).toBe('❤');
    expect(telegramReaction({ status: 'queued' })).toBeNull(); // Telegram has nothing like 🕓
    expect(telegramReaction({})).toBeNull();
  });
});
