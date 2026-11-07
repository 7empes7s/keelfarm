// The demo's chat with the CEO (#118): a made-up thread showing every status reaction (✅ ⚠️ ⏳ 👀 🕓), a job that
// ended with only the CEO's reaction, two messages in a row each answered with its own quote, and the manager's reactions.
import type { PhoneMessage } from '../shared/types.ts';

/** Ids from `first`; it starts after #125's edited chat (20 minutes ago). */
export function sampleChat(now: number, first = 1): PhoneMessage[] {
  let id = first - 1;
  const msg = (from: PhoneMessage['from'], text: string, minAgo: number, extra: Partial<PhoneMessage> = {}): PhoneMessage => ({ id: ++id, from, text, at: now - minAgo * 60_000, ...extra });
  const done = { delivery: 'replied', status: 'done' } as const;
  return [
    msg('manager', 'How is floor 1 doing?', 19, done),
    msg('ceo', 'Floor 1 merged 3 pull requests today and QA is on the next one. Nothing needs you.', 18.5),
    msg('manager', 'ok thanks', 18, { ...done, reactions: [{ by: 'ceo', emoji: '👍' }] }),
    msg('manager', 'Plan the checkout fix for floor 1', 15, done),
    msg('manager', 'And can QA check the phone layout first?', 14.8, done),
    msg('ceo', 'Filed the checkout fix; the next free agent picks it up.', 14, { replyTo: first + 3 }),
    msg('ceo', "Yes: floor 1's QA brief now checks 390 px before anything else.", 13.5, { replyTo: first + 4, reactions: [{ by: 'manager', emoji: '❤️' }, { by: 'manager', emoji: '👍' }] }),
    msg('manager', 'Go ahead and merge it once the checks are green', 10, { ...done, reactions: [{ by: 'ceo', emoji: '✅' }] }),
    msg('manager', 'Restart the stuck preview on floor 2', 7, { delivery: 'replied', status: 'failed' }),
    msg('office', "⚠️ The CEO hit a problem while replying to you: floor 2's preview didn't answer.", 6.8),
    msg('manager', 'What did the nightly review find?', 3, { delivery: 'read', status: 'working' }),
    msg('manager', 'Is floor 2 on budget this week?', 2, { delivery: 'read', status: 'seen' }),
    msg('manager', "Then draft next week's plan", 1, { delivery: 'sent', status: 'queued' }),
  ];
}
