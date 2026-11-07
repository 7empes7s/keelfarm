// The demo's chat with the CEO (#118): a made-up thread showing every status reaction (✅ ⚠️ ⏳ 👀 🕓), a job that
// ended with only the CEO's reaction, two messages in a row each answered with its own quote, and the manager's reactions.
import type { PhoneMessage } from '../shared/types.ts';

export function sampleChat(now: number): PhoneMessage[] {
  let id = 0;
  const msg = (from: PhoneMessage['from'], text: string, minAgo: number, extra: Partial<PhoneMessage> = {}): PhoneMessage => ({ id: ++id, from, text, at: now - minAgo * 60_000, ...extra });
  const done = { delivery: 'replied', status: 'done' } as const;
  return [
    msg('manager', 'How is floor 1 doing?', 95, done),
    msg('ceo', 'Floor 1 merged 3 pull requests today and QA is on the next one. Nothing needs you.', 94),
    msg('manager', 'ok thanks', 93, { ...done, reactions: [{ by: 'ceo', emoji: '👍' }] }),
    msg('manager', 'Plan the checkout fix for floor 1', 60, done),
    msg('manager', 'And can QA check the phone layout first?', 59, done),
    msg('ceo', 'Filed the checkout fix; the next free agent picks it up.', 57, { replyTo: 4 }),
    msg('ceo', "Yes: floor 1's QA brief now checks 390 px before anything else.", 56, { replyTo: 5, reactions: [{ by: 'manager', emoji: '❤️' }, { by: 'manager', emoji: '👍' }] }),
    msg('manager', 'Go ahead and merge it once the checks are green', 40, { ...done, reactions: [{ by: 'ceo', emoji: '✅' }] }),
    msg('manager', 'Restart the stuck preview on floor 2', 20, { delivery: 'replied', status: 'failed' }),
    msg('office', "⚠️ The CEO hit a problem while replying to you: floor 2's preview didn't answer.", 19),
    msg('manager', 'What did the nightly review find?', 3, { delivery: 'read', status: 'working' }),
    msg('manager', 'Is floor 2 on budget this week?', 2, { delivery: 'read', status: 'seen' }),
    msg('manager', "Then draft next week's plan", 1, { delivery: 'sent', status: 'queued' }),
  ];
}
