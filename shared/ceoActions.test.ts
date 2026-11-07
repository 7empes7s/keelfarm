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
      { tool: 'scale_team', icon: '👥', text: 'Floor 3 goes from 2 to 3 agents once the manager agrees: a hire request.', ref: { kind: 'section', section: 'team', repoId: 'acme/shop' } },
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
    expect(refused.ref).toEqual({ kind: 'section', section: 'ceo' });
  });

  it('leaves out calls still running, unknown floors and long tails', () => {
    expect(actionCards([call('file_issue', null, { floor: 3 })], repoOf)).toEqual([]);
    expect(actionCards([call('set_dependencies', 'Floor 9 …', { floor: 9, number: 4 })], repoOf)[0].ref).toBeUndefined();
    expect(actionCards([call('scale_team', 'Floor 9 …', { floor: 9 })], repoOf)[0].ref).toEqual({ kind: 'section', section: 'team' });
    const many = Array.from({ length: 12 }, () => call('restart_agent', `Restarted.\n${'x'.repeat(500)}`, { agent_id: 'a' }));
    const cards = actionCards(many, repoOf);
    expect(cards).toHaveLength(MAX_ACTIONS);
    expect(cards[0].text).toBe('Restarted.');
  });
});

describe('every action card opens what it is about (#215)', () => {
  const agentOf = (ref: string) => ({ linus: 'a7', a7: 'a7' })[ref.toLowerCase()] ?? null;

  it("opens message_agent's agent chat at the message it posted, by id even when the CEO gave a name", () => {
    const [msg, answer] = actionCards(
      [
        { ...call('message_agent', 'Sent: Linus reads it after their current step.', { floor: 3, agent_id: 'Linus', text: 'rerun it' }), messageId: 42 },
        { ...call('answer_agent', 'Sent: Linus carries on with your answer.', { agent_id: 'a7', text: 'yes' }), messageId: 43 },
      ],
      repoOf,
      agentOf,
    );
    expect(msg.ref).toEqual({ kind: 'agent', agentId: 'a7', messageId: 42 });
    expect(answer.ref).toEqual({ kind: 'agent', agentId: 'a7', messageId: 43 });
  });

  it('sends agent changes to their details, sections to the console and decisions to the log', () => {
    const refs = actionCards(
      [
        call('restart_agent', 'Restarted.', { agent_id: 'linus' }),
        call('configure_agent', 'Linus now runs opus.', { agent_id: 'linus', model: 'opus' }),
        call('set_floor_profile', 'Saved.', { floor: 3, summary: 's' }),
        call('set_mandate', 'Recorded.', { text: 't', floors: [3] }),
        call('resolve_decision', 'Closed "Ship it?": yes.', { id: 'msg:12', outcome: 'yes' }),
        call('wait_for', 'PR #7 on floor 3 merged.', { conditions: [{ kind: 'pr_merged', floor: 3, pr: 7 }] }),
        call('wait_for', 'Usage is back to normal.', { conditions: [{ kind: 'usage', usage: 'normal' }] }),
      ],
      repoOf,
      agentOf,
    ).map((c) => c.ref);
    expect(refs).toEqual([
      { kind: 'agent', agentId: 'a7', details: 'now' },
      { kind: 'agent', agentId: 'a7', details: 'setup' },
      { kind: 'section', section: 'ceo', repoId: 'acme/shop' },
      { kind: 'section', section: 'ceo', repoId: 'acme/shop' },
      { kind: 'decision', id: 'msg:12' },
      { kind: 'issue', repoId: 'acme/shop', number: 7 },
      { kind: 'section', section: 'ops' },
    ]);
  });
});
