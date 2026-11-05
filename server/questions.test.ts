import { describe, expect, it, vi } from 'vitest';
import type { AgentQuestion, PhoneMessage } from '../shared/types.ts';
import type { FollowupState } from '../shared/followups.ts';
import type { SessionResult } from './agentRunner.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// Agents' questions (#36) through a demo office: a session that ends asking waits for the CEO, the CEO answers or
// brings it to the manager, and every answer reaches the asking agent's session only.
type Agent = { id: string; name: string; role: string; status: string; task: string | null; issueNumber: number | null; issueTitle: string | null; branch: string | null; prNumber: number | null; sessionId: string | null; startedAt: number | null; repoId: string };
type Internals = {
  state: { agents: Agent[]; repos: { id: string; floor: number; autoAssign: boolean }[]; questions: AgentQuestion[]; messages: PhoneMessage[]; settings: { ceoFollowups: { kinds: Record<string, boolean> } }; ceo: { queue: { kind: string }[]; followups: FollowupState } };
  onFinished(a: Agent, repo: unknown, r: SessionResult): Promise<void>;
  officeTools(): { call(name: string, args: Record<string, unknown>): Promise<string> };
  isFree(a: Agent): boolean;
  ensureCeo(interrupted: unknown[]): void;
};

const finished = (text: string): SessionResult => ({ ok: true, text, costUsd: 0.1, turns: 5, errors: [] });

async function office() {
  const swarm = new Swarm(createDemoBackend());
  const repo = await swarm.connectRepo('demo-co/pixel-todo');
  swarm.hireAgent(repo.id, {});
  const x = swarm as unknown as Internals;
  x.state.repos[0].autoAssign = false; // nobody starts other work under the test's feet
  x.ensureCeo([]);
  const [ada, bob] = x.state.agents.filter((a) => a.role !== 'ceo');
  // Both building, both stopping with a question; message() is where the office types into a session.
  const sent = vi.spyOn(swarm, 'message').mockResolvedValue(undefined);
  const notes = vi.spyOn(swarm.notifier, 'notify');
  const ask = async (a: Agent, n: number, text: string) => {
    Object.assign(a, { status: 'working', task: 'issue', issueNumber: n, issueTitle: `Issue ${n}`, branch: `swarm/issue-${n}`, sessionId: `s-${a.id}`, startedAt: Date.now() });
    await x.onFinished(a, x.state.repos[0], finished(text));
  };
  return { swarm, x, ada, bob, sent, notes, ask };
}

describe("an agent's question", () => {
  it('goes to the CEO first: the agent waits and takes no other work, and a follow-up is queued', async () => {
    const { swarm, x, ada, ask } = await office();
    await ask(ada, 3, 'Should the badge be red or blue?\n1. Red\n2. Blue');
    expect(x.state.questions).toEqual([expect.objectContaining({ agentId: ada.id, issue: 3, to: 'ceo', options: ['Red', 'Blue'] })]);
    expect(x.state.ceo.followups.pending.map((e) => e.kind)).toEqual(['question']);
    expect(x.isFree(ada)).toBe(false);
    expect(swarm.snapshot().agents.find((a) => a.id === ada.id)).toMatchObject({ waiting: 'ceo', activity: { kind: 'waiting', detail: 'the CEO' } });
  });

  it('is not raised by a turn that just finished', async () => {
    const { x, ada, ask } = await office();
    await ask(ada, 3, 'Done: the badge is in, with tests.');
    expect(x.state.questions).toEqual([]);
  });

  it("answer_agent types the CEO's answer into the asking agent's session only", async () => {
    const { x, ada, bob, sent, ask } = await office();
    await ask(ada, 3, 'Red or blue?');
    await ask(bob, 4, 'Tests next to the code or in __tests__?');
    const out = await x.officeTools().call('answer_agent', { agent_id: bob.id, text: 'Next to the code.' });
    expect(out).toBe(`Sent: ${bob.name} carries on with your answer.`);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0][0]).toBe(bob.id);
    expect(sent.mock.calls[0][1]).toMatch(/^Answer from .+ \(CEO\) to your question about #4: Next to the code\.\n/);
    expect(x.state.questions.map((q) => q.agentId)).toEqual([ada.id]); // Ada still waits
    expect(await x.officeTools().call('answer_agent', { agent_id: bob.id, text: 'again' })).toMatch(/^Refused: .* has no open question/);
  });

  it('reaches the manager only through ask_manager_choice: a notification, one-tap options, and their answer goes to the agent', async () => {
    const { swarm, x, ada, sent, notes, ask } = await office();
    await ask(ada, 3, 'Red or blue?');
    expect(notes.mock.calls.filter(([kind]) => kind === 'question')).toEqual([]);
    const out = await x.officeTools().call('ask_manager_choice', { agent_id: ada.id, question: 'Should the badge be red or blue?', options: ['Red', 'Blue'], recommendation: 'Blue: the brand colour.' });
    expect(out).toMatch(/^Asked the manager/);
    const q = x.state.questions[0];
    expect(q).toMatchObject({ to: 'manager', options: ['Red', 'Blue'], recommendation: 'Blue: the brand colour.' });
    const m = x.state.messages.find((x) => x.id === q.messageId)!;
    expect(m).toMatchObject({ from: 'ceo', question: q.id });
    expect(notes.mock.calls.filter(([kind]) => kind === 'question').map(([, title]) => title)).toEqual([`${ada.name} asks you`]);
    expect(notes.mock.calls.some(([kind]) => kind === 'ceoMessage')).toBe(false);
    // The manager taps "Blue" (a reply to that message): it goes to Ada, not to a CEO chat job.
    await swarm.messageCeo('Blue', m.id);
    expect(sent.mock.calls.map((c) => c[0])).toEqual([ada.id]);
    expect(sent.mock.calls[0][1]).toMatch(/to your question about #3: Blue\n/);
    expect(x.state.questions).toEqual([]);
    expect(x.state.ceo.queue.some((j) => j.kind === 'chat')).toBe(false);
  });

  it('goes straight to the manager when follow-ups for questions are off', async () => {
    const { x, ada, notes, ask } = await office();
    x.state.settings.ceoFollowups.kinds.question = false;
    await ask(ada, 3, 'Red or blue?');
    expect(x.state.questions[0]).toMatchObject({ to: 'manager' });
    expect(notes.mock.calls.filter(([kind]) => kind === 'question')).toHaveLength(1);
  });
});

describe("the follow-up prompt's question guidance", () => {
  it('is there only when an agent asked something, so other follow-ups pay nothing for it', async () => {
    const { followupPrompt } = await import('./followupPrompt.ts');
    const ev = (kind: 'question' | 'merged') => ({ id: 'e1', kind, key: kind, label: kind, text: 'x', at: 0 });
    expect(followupPrompt([ev('question')], [])).toContain('ask_manager_choice, with your pick, only for unclear choices');
    expect(followupPrompt([ev('merged')], [])).not.toContain('ask_manager_choice');
  });
});
