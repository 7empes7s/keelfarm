// The demo's chat with the CEO (#118): a made-up thread showing every status reaction (✅ ⚠️ ⏳ 👀 🕓), a job that
// ended with only the CEO's reaction, two messages in a row each answered with its own quote, the manager's reactions,
// and a reply with one action card of each kind (#151), each landing on what it names. Before it, a long history
// (#145): the chat opens on its latest page and loads the rest as the manager scrolls up.
import { actionCards } from '../shared/ceoActions.ts';
import type { OfficeCall } from '../shared/ceoStream.ts';
import type { PhoneMessage } from '../shared/types.ts';
import { CHAT_KEEP } from '../shared/chatPage.ts';
import { demoEditedChat } from './demoChat.ts';

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
    ...(cards ? [msg('ceo', `Done: floor ${cards.floor}'s team, charter and QA brief are sorted. Tap a card to see each.`, 9.5, { actions: sampleCards(cards) })] : []),
    msg('manager', 'How do I see what landed on main and where the merge happens?', 9, done),
    // code blocks (#200): a long one-line command and a TypeScript block long enough to fold
    msg('ceo', [
      'Run this in the floor\'s folder:',
      '```bash',
      'git -C /root/Projects/keelfarm log --oneline --first-parent origin/main --since="2 days ago" --author="cubefarm" -- server/swarm/merge.ts server/swarm/qa.ts',
      '```',
      'The merge itself is in `server/swarm/merge.ts`:',
      '```ts',
      'async function autoMerge(pr: PullRequest): Promise<MergeResult> {',
      '  if (!pr.qaPassed) return { merged: false, reason: \'QA has not signed off\' };',
      '  if (pr.checks !== \'passing\') return { merged: false, reason: \'checks are not green\' };',
      '  const head = await github.headSha(pr.number);',
      '  if (head !== pr.testedSha) {',
      '    // a new push since QA: test it again',
      '    return { merged: false, reason: \'new commits since QA\' };',
      '  }',
      '  await github.merge(pr.number, { method: \'squash\', sha: head });',
      '  await syncFloorFolder(pr.floor);',
      '  ledger.merged(pr);',
      '  return { merged: true };',
      '}',
      '',
      'export { autoMerge };',
      '```',
    ].join('\n'), 8.5),
    msg('manager', 'The server feels slow, what can I run?', 8, done),
    // a long reply with three command blocks (#339): it folds after a whole block, its first commands in view
    msg('ceo', [
      "Memory is the bottleneck: agents' test browsers and old demo offices stay around after their sessions. Three things to paste, quickest first. Each one is safe to run while agents work; none of them touches the live office or its state.",
      '',
      '## A. Quick wins (a minute)',
      'See what is using memory and swap right now, biggest first:',
      '```bash',
      'free -h',
      'ps -eo pid,rss,etime,cmd --sort=-rss | head -15',
      'swapon --show',
      '```',
      '',
      '## B. Old previews and demo offices',
      'List what listens on the agents\' preview ports and how long it has been running, so you can stop the leftovers by pid:',
      '```bash',
      'ss -ltnp | grep -E ":(5[0-9]{3}|6[34][0-9]{2})"',
      'pgrep -af "server/index.ts --demo"',
      '```',
      '',
      '## C. The disk',
      'Free space and the biggest working copies:',
      '```bash',
      'df -h /',
      'du -sh ~/.cubefarm/machines/* | sort -h | tail',
      '```',
      '',
      '## D. If swap stays full',
      'Watch it for a minute: if `si` and `so` stay above zero, the box is swapping and agents will slow down until something is stopped.',
      '```bash',
      'vmstat 5 12',
      '```',
      '',
      'After A, tell me the top three and I\'ll say which are safe to stop. Nothing here needs a restart.',
    ].join('\n'), 7.5),
    msg('manager', 'Restart the stuck preview on floor 2', 7, { delivery: 'replied', status: 'failed' }),
    msg('office', "⚠️ The CEO hit a problem while replying to you: floor 2's preview didn't answer.", 6.8),
    msg('manager', 'What did the nightly review find?', 3, { delivery: 'read', status: 'working' }),
    msg('manager', 'Is floor 2 on budget this week?', 2, { delivery: 'read', status: 'seen' }),
    msg('manager', "Then draft next week's plan", 1, { delivery: 'sent', status: 'queued' }),
  ];
}

const PAST: [PhoneMessage['from'], string][] = [
  ['manager', 'Morning! Anything I should know about?'],
  ['ceo', 'Morning. Floor 1 merged **2 pull requests** overnight and QA passed the login fix. Nothing needs you yet.'],
  ['manager', "What's next on floor 2?"],
  ['ceo', 'Floor 2 is on the search page next:\n- the filters bar\n- the empty state\n- paging the results'],
  ['office', 'The office updated itself and is back on main.'],
  ['manager', 'Can you keep an eye on the preview?'],
  ['ceo', "Will do: I'll tell you if it stops answering."],
  ['manager', 'thanks 👍'],
];

/** `count` messages over the days before today, oldest first, ids from 1: the long history before the sample. */
export function pastChat(now: number, count: number): PhoneMessage[] {
  const day = 86_400_000;
  const start = now - 3 * day;
  return Array.from({ length: count }, (_, i) => {
    const [from, text] = PAST[i % PAST.length];
    return { id: i + 1, from, text, at: start + Math.round((i * 2 * day) / count), ...(from === 'manager' && { delivery: 'replied' as const }) };
  });
}

/** The demo's thread: a full one (#145, it opens on the latest page), then the edited messages and the sample. */
export function demoThread(now: number, cards?: SampleFloor): PhoneMessage[] {
  const past = pastChat(now, CHAT_KEEP - demoEditedChat(now).length - sampleChat(now, 1, cards).length);
  const edits = demoEditedChat(now).map((m, i) => ({ ...m, id: past.length + i + 1 }));
  return [...past, ...edits, ...sampleChat(now, past.length + edits.length + 1, cards)];
}
