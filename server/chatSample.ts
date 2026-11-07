// The demo's chat with the CEO (#118): a made-up thread showing every status reaction (✅ ⚠️ ⏳ 👀 🕓), a job that
// ended with only the CEO's reaction, two messages in a row each answered with its own quote, the manager's reactions,
// and a reply with one action card of each kind (#151), each landing on what it names.
import { actionCards } from '../shared/ceoActions.ts';
import type { OfficeCall } from '../shared/ceoStream.ts';
import type { PhoneMessage } from '../shared/types.ts';

/** The floor the action cards are about, and one of its agents. */
export interface SampleFloor {
  floor: number;
  repoId: string;
  agent: { id: string; name: string };
  size: number; // its team's size
}

/** The cards of a reply that touched every part of `f` (#151), made the way a real reply's are. */
function sampleCards(f: SampleFloor) {
  const n = f.floor;
  const calls: OfficeCall[] = [
    { tool: 'scale_team', ok: true, out: `Floor ${n} goes from ${f.size - 1} to ${f.size} agents: ${f.agent.name} joined.`, args: { floor: n, size: f.size } },
    { tool: 'configure_agent', ok: true, out: `${f.agent.name} uses opus from their next task.`, args: { agent_id: f.agent.id, model: 'opus' } },
    { tool: 'message_agent', ok: true, out: `Sent to ${f.agent.name}.`, args: { agent_id: f.agent.id } },
    { tool: 'file_issue', ok: true, out: `Filed #1 on floor ${n}: Checkout fix.`, args: { floor: n } },
    { tool: 'send_back', ok: true, out: 'Sent back for a fix.', args: { floor: n, pr: 2 } },
    { tool: 'retry_qa', ok: true, out: 'QA runs again.', args: { floor: n, pr: 2 } },
    { tool: 'propose_charter', ok: true, out: 'Proposed: it waits for the manager.', args: { floor: n } },
    { tool: 'set_floor_profile', ok: true, out: `Saved floor ${n}'s QA brief.`, args: { floor: n } },
  ];
  return actionCards(calls, (x) => (x === n ? f.repoId : null));
}

/** Ids from `first`; it starts after #125's edited chat (20 minutes ago). `cards`: the floor of the action cards' reply. */
export function sampleChat(now: number, first = 1, cards?: SampleFloor): PhoneMessage[] {
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
    ...(cards ? [msg('ceo', `Done: floor ${cards.floor}'s team, charter and QA brief are sorted. Tap a card to see each.`, 9, { actions: sampleCards(cards) })] : []),
    msg('manager', 'Restart the stuck preview on floor 2', 7, { delivery: 'replied', status: 'failed' }),
    msg('office', "⚠️ The CEO hit a problem while replying to you: floor 2's preview didn't answer.", 6.8),
    msg('manager', 'What did the nightly review find?', 3, { delivery: 'read', status: 'working' }),
    msg('manager', 'Is floor 2 on budget this week?', 2, { delivery: 'read', status: 'seen' }),
    msg('manager', "Then draft next week's plan", 1, { delivery: 'sent', status: 'queued' }),
  ];
}
