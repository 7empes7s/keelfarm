import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import type { SessionOptions } from './agentRunner.ts';
import type { CeoLive } from '../shared/ceoStream.ts';
import type { AgentStatus, PhoneMessage, ServerEvent } from '../shared/types.ts';

// The CEO chat closer to Claude's (#51), in a demo office: the reply streams in with its steps, Stop says what was
// done, an edit re-asks, conversations start fresh and carry on, and the manager's notes reach every job.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  broadcast(ev: ServerEvent): void;
  backend: { startSession(opts: SessionOptions, cb: unknown): unknown };
  state: { ceo: { queue: { kind: string; text?: string }[]; job: { text?: string } | null }; messages: PhoneMessage[]; agents: { id: string; status: AgentStatus; sessionId: string | null }[] };
};

const until = async (ok: () => boolean, ms = 25_000) => {
  for (let t = 0; t < ms && !ok(); t += 25) await new Promise((r) => setTimeout(r, 25));
  expect(ok()).toBe(true);
};

afterEach(() => vi.restoreAllMocks());

async function office() {
  for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  const swarm = new Swarm(createDemoBackend());
  await swarm.connectRepo('demo-co/pixel-todo');
  const i = swarm as unknown as Internals;
  i.state.ceo.queue = []; // no onboarding: the chat is the CEO's only job
  i.ensureCeo([]);
  const lives: CeoLive[] = [];
  const prompts: string[] = [];
  const broadcast = i.broadcast.bind(swarm);
  i.broadcast = (ev) => {
    if (ev.type === 'ceoChat' && ev.live) lives.push(ev.live);
    broadcast(ev);
  };
  const start = i.backend.startSession.bind(i.backend);
  i.backend.startSession = (opts, cb) => (prompts.push(opts.prompt), start(opts, cb));
  const ceo = () => i.state.agents.find((a) => a.id === 'ceo')!;
  const replies = () => i.state.messages.filter((m) => m.from === 'ceo');
  return { swarm, i, lives, prompts, ceo, replies };
}

describe('a resent message (#216)', () => {
  it('is saved once: the same client id answers with the first copy', { timeout: 60_000 }, async () => {
    const { swarm, i } = await office();
    const first = await swarm.messageFromTab('Ship it?', undefined, [], 'tab-1');
    const again = await swarm.messageFromTab('Ship it?', undefined, [], 'tab-1');
    const other = await swarm.messageFromTab('Ship it?', undefined, [], 'tab-2');
    expect(again.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
    expect(i.state.messages.filter((m) => m.from === 'manager' && m.text === 'Ship it?')).toHaveLength(2);
  });
});

describe('the CEO chat', () => {
  it('streams the reply with its steps, keeps them on it, and carries conversations apart', { timeout: 60_000 }, async () => {
    const { swarm, lives, prompts, ceo, replies } = await office();
    swarm.addMemory('No releases on Fridays');
    await swarm.messageCeo('How are things going?');
    await until(() => replies().length > 0);
    expect(prompts[0]).toContain('The manager asked you to always remember:\n- No releases on Fridays');
    expect(lives.some((l) => l.steps.some((s) => s.label === 'Reading company status'))).toBe(true);
    expect(lives.some((l) => l.open && l.blocks.length > 0)).toBe(true); // text arrived before the reply did
    const reply = replies()[0];
    expect(reply.steps).toContain('Reading company status');
    await until(() => swarm.snapshot().chat?.live === null && ceo().status === 'done');

    // A new conversation starts empty, with a fresh CEO session; the old one is found and carried on.
    const first = swarm.snapshot().chat!.current;
    const session = ceo().sessionId;
    await swarm.newConversation();
    expect(swarm.snapshot().messages).toEqual([]);
    expect(ceo().sessionId).toBeNull();
    expect(swarm.snapshot().chat!.conversations.map((c) => c.id)).toContain(first);
    expect((await swarm.searchConversations('things going')).hits.map((h) => h.id)).toEqual([first]);
    await swarm.openConversation(first);
    expect(swarm.snapshot().messages.map((m) => m.id)).toContain(reply.id);
    expect(ceo().sessionId).toBe(session);
  });

  it('stops a reply: nothing is left half-done, and the reply says so', { timeout: 60_000 }, async () => {
    const { swarm, lives, ceo, replies } = await office();
    await expect(swarm.stopCeo()).rejects.toThrow(/isn't working/);
    await swarm.messageCeo('Can we grow the team?');
    await until(() => lives.some((l) => l.steps.length > 0));
    await swarm.stopCeo();
    expect(ceo().status).toBe('stopped');
    expect(replies().at(-1)?.text).toMatch(/^■ Stopped\./);
    await new Promise((r) => setTimeout(r, 300));
    expect(replies()).toHaveLength(1); // no answer after the stop
    expect(swarm.snapshot().chat?.live).toBeNull();
  });

  it('re-asks an edited last message', { timeout: 60_000 }, async () => {
    const { swarm, i, lives } = await office();
    const { id: first } = await swarm.messageCeo('Plan a bakery');
    expect(() => swarm.editMessage(first + 999, 'x')).toThrow(/no longer in this conversation/);
    await expect(swarm.newConversation()).rejects.toThrow(/still answering you/); // the reply belongs to this conversation
    await until(() => lives.some((l) => l.steps.length > 0));
    swarm.editMessage(first, 'Plan a cake shop');
    expect(i.state.messages.find((m) => m.id === first)).toMatchObject({ text: 'Plan a cake shop', edited: expect.any(Number), versions: [{ text: 'Plan a bakery' }] });
    await until(() => [i.state.ceo.job, ...i.state.ceo.queue].some((j) => j?.text?.includes('Answer this version instead:\nPlan a cake shop')));
    await swarm.stopCeo().catch(() => undefined);
  });

  it("edits any of the manager's messages (#125): queued ones carry the new text, answered ones reach the CEO as a note", { timeout: 60_000 }, async () => {
    const { swarm, i, replies } = await office();
    const { id: first } = await swarm.messageCeo('How is floor 1?');
    await until(() => replies().length > 0 && !i.state.ceo.job);
    const { id: second } = await swarm.messageCeo('Plan a bakery');
    swarm.editMessage(first, 'How is floor 2?'); // answered, and not the last: a note, after the queued message
    expect(i.state.messages.find((m) => m.id === first)).toMatchObject({ text: 'How is floor 2?', versions: [{ text: 'How is floor 1?' }] });
    const jobs = () => [i.state.ceo.job, ...i.state.ceo.queue].map((j) => j?.text ?? '').join('\n');
    await until(() => jobs().includes(`[manager edited message #${first}: "How is floor 1?" → "How is floor 2?"]`));
    swarm.editMessage(second, 'Plan a cake shop'); // still queued (or being answered): the CEO gets the new text, or is asked again
    await until(() => /Plan a cake shop/.test(jobs()));
    await swarm.stopCeo().catch(() => undefined);
  });

  it('puts what a reply changed on it as action cards, with its artifact and idea (#108)', { timeout: 60_000 }, async () => {
    const { swarm, replies } = await office();
    await swarm.messageCeo('Plan the next milestone for floor 1');
    await until(() => replies().some((m) => !m.requestId)); // a hire request posts a message of its own
    const reply = replies().find((m) => !m.requestId)!;
    expect(reply.actions?.map((a) => a.tool)).toEqual(['file_issue', 'scale_team']);
    expect(reply.actions?.[0]).toMatchObject({ icon: '📝', text: expect.stringMatching(/^Filed floor 1 #\d+ · Polish: phone layout/), ref: { kind: 'issue', repoId: 'demo-co/pixel-todo' } });
    expect(reply.actions?.[1].ref).toEqual({ kind: 'floor', repoId: 'demo-co/pixel-todo' });
    expect(reply.steps).toContain('Reading company status'); // the reads stay in the steps, not on cards
    expect(reply.artifacts?.map((a) => a.title)).toEqual(['Milestone plan']);
    expect(reply.idea).toMatchObject({ kind: 'objective', message: expect.stringContaining("floor 1's charter") });
  });
});
