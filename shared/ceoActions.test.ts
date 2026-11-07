import { describe, expect, it } from 'vitest';
import { actionCards, MAX_ACTIONS } from './ceoActions.ts';
import type { OfficeCall } from './ceoStream.ts';

const repoOf = (floor: number) => (floor === 3 ? 'acme/shop' : null);
const call = (tool: string, out: string | null, args: Record<string, unknown> = {}, ok = true): OfficeCall => ({ tool, ok, out, args });

describe('actionCards (#108)', () => {
  it('turns the calls that changed something into cards, reads left out', () => {
    const cards = actionCards(
      [
        call('company_status', '{}'),
        call('file_issue', 'Filed #104 on floor 3: Pocket mode for desktop.', { floor: 3, title: 'Pocket mode for desktop', body: '' }),
        call('scale_team', 'Floor 3 goes from 2 to 3 agents once the manager agrees: a hire request.', { floor: 3, size: 3, reason: 'x' }),
        call('pr_diff', 'diff', { floor: 3, pr: 7 }),
      ],
      repoOf,
    );
    expect(cards).toEqual([
      { tool: 'file_issue', icon: '📝', text: 'Filed floor 3 #104 · Pocket mode for desktop', ref: { kind: 'issue', repoId: 'acme/shop', number: 104 } },
      { tool: 'scale_team', icon: '👥', text: 'Floor 3 goes from 2 to 3 agents once the manager agrees: a hire request.', ref: { kind: 'floor', repoId: 'acme/shop', section: 'team' } },
    ]);
  });

  it('links PRs, issues and agents, and marks refused calls', () => {
    const [back, close, msg, refused] = actionCards(
      [
        call('send_back', 'Sent back for a fix.', { floor: 3, pr: 12, note: 'n' }),
        call('close_issue', 'Closed #9 on floor 3 as not planned.', { floor: 3, number: 9, reason: 'r' }),
        call('message_agent', 'Sent to Grace.', { floor: 3, agent_id: 'grace', text: 'hi' }),
        call('set_mandate', "Only the manager gives standing mandates.", { text: 'x' }, false),
      ],
      repoOf,
    );
    expect(back.ref).toEqual({ kind: 'issue', repoId: 'acme/shop', number: 12 });
    expect(close.ref).toEqual({ kind: 'issue', repoId: 'acme/shop', number: 9 });
    expect(msg.ref).toEqual({ kind: 'agent', agentId: 'grace' });
    expect(refused).toMatchObject({ refused: true, text: 'Refused: Only the manager gives standing mandates.' });
    expect(refused.ref).toBeUndefined();
  });

  it('leaves out calls still running, unknown floors and long tails', () => {
    expect(actionCards([call('file_issue', null, { floor: 3 })], repoOf)).toEqual([]);
    expect(actionCards([call('scale_team', 'Floor 9 …', { floor: 9 })], repoOf)[0].ref).toBeUndefined();
    const many = Array.from({ length: 12 }, () => call('restart_agent', `Restarted.\n${'x'.repeat(500)}`, { agent_id: 'a' }));
    const cards = actionCards(many, repoOf);
    expect(cards).toHaveLength(MAX_ACTIONS);
    expect(cards[0].text).toBe('Restarted.');
  });

  // #151: every tool that makes a card, and the exact thing its card opens.
  it.each([
    ['file_issue', 'Filed #104 on floor 3: X.', { floor: 3 }, { kind: 'issue', repoId: 'acme/shop', number: 104 }],
    ['close_issue', 'Closed #9.', { floor: 3, number: 9 }, { kind: 'issue', repoId: 'acme/shop', number: 9 }],
    ['set_dependencies', 'Set.', { floor: 3, number: 9, depends_on: [4] }, { kind: 'issue', repoId: 'acme/shop', number: 9 }],
    ['scale_team', 'Floor 3 goes from 4 to 5 agents: Linus joined.', { floor: 3, size: 5 }, { kind: 'floor', repoId: 'acme/shop', section: 'team' }],
    ['configure_agent', 'Grace uses opus from her next task.', { agent_id: 'grace', model: 'opus' }, { kind: 'agent', agentId: 'grace', section: 'team' }],
    ['message_agent', 'Sent.', { agent_id: 'grace' }, { kind: 'agent', agentId: 'grace' }],
    ['answer_agent', 'Answered.', { agent_id: 'grace' }, { kind: 'agent', agentId: 'grace' }],
    ['restart_agent', 'Restarted.', { agent_id: 'grace' }, { kind: 'agent', agentId: 'grace' }],
    ['retry_qa', 'QA again.', { floor: 3, pr: 12 }, { kind: 'qa', repoId: 'acme/shop', number: 12 }],
    ['send_back', 'Sent back.', { floor: 3, pr: 12 }, { kind: 'issue', repoId: 'acme/shop', number: 12 }],
    ['rerun_checks', 'Rerun.', { floor: 3, pr: 12 }, { kind: 'issue', repoId: 'acme/shop', number: 12 }],
    ['close_pull', 'Closed.', { floor: 3, pr: 12 }, { kind: 'issue', repoId: 'acme/shop', number: 12 }],
    ['escalate', 'Escalated.', { floor: 3, pr: 12 }, { kind: 'issue', repoId: 'acme/shop', number: 12 }],
    ['propose_charter', 'Proposed.', { floor: 3, reason: 'r' }, { kind: 'floor', repoId: 'acme/shop', section: 'charter' }],
    ['set_floor_profile', 'Saved.', { floor: 3, qa_brief: 'b' }, { kind: 'floor', repoId: 'acme/shop', section: 'brief' }],
    ['set_mandate', 'Mandate set.', { text: 'x' }, undefined],
    ['resolve_decision', 'Resolved.', { id: 'd1' }, undefined],
    ['define_experiment', 'Defined.', { name: 'x' }, undefined],
    ['set_office_playbook', 'Saved.', { text: 'x' }, undefined],
    ['send_telegram', 'Sent.', { text: 'x' }, undefined],
  ])('%s opens what it changed', (tool, out, args, ref) => {
    expect(actionCards([call(tool, out, args)], repoOf)[0].ref).toEqual(ref);
  });
});
