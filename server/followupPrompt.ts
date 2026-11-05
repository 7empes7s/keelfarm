// The CEO's follow-up job prompt (#27): the office events that woke it, the mandates in force, what it may do.
import { mandateWhere, type CeoMandate, type FollowupEvent } from '../shared/followups.ts';

/** The follow-up's prompt: the events with their ids, the mandates in force, and what the CEO may do. */
export function followupPrompt(events: FollowupEvent[], mandates: CeoMandate[]): string {
  const until = (m: CeoMandate) => (m.expiresAt ? `, until ${new Date(m.expiresAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '');
  return [
    'Follow-up: the office woke you because of these events since you last looked:',
    ...events.map((e) => `- [${e.id}] ${e.text}`),
    '',
    mandates.length
      ? `Standing mandates from the manager:\n${mandates.map((m) => `- "${m.text}" (${mandateWhere(m)}${until(m)})`).join('\n')}`
      : 'There are no standing mandates: file no issues.',
    '',
    'Check each event, e.g. a merged PR against its issue\'s acceptance criteria (pr_diff, qa_report), a stuck agent through agent_log and worktree_file. Then, only where it helps:',
    '- file follow-up issues (file_issue) for gaps, only on floors a mandate covers, at most 12;',
    ...(events.some((e) => e.kind === 'question') ? ["- agents' questions: answer_agent what the issue, repo and notes settle; ask_manager_choice, with your pick, only for unclear choices;"] : []),
    '- scale_team when work keeps waiting for free agents;',
    '- the triage tools, if a pull request is stuck (needs-human).',
    `Your final message reaches the manager only when it says what you did or what they need to decide. If nothing needs doing, reply exactly "Nothing to do."`,
  ].join('\n');
}
