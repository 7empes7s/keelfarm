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

  it('re-asks an edited last message, and only the last one', { timeout: 60_000 }, async () => {
    const { swarm, i, lives } = await office();
    const { id: first } = await swarm.messageCeo('Plan a bakery');
    expect(() => swarm.editMessage(first + 999, 'x')).toThrow(/last message/);
    await until(() => lives.some((l) => l.steps.length > 0));
    swarm.editMessage(first, 'Plan a cake shop');
    expect(i.state.messages.find((m) => m.id === first)).toMatchObject({ text: 'Plan a cake shop', edited: expect.any(Number) });
    await until(() => [i.state.ceo.job, ...i.state.ceo.queue].some((j) => j?.text?.includes('Answer this version instead:\nPlan a cake shop')));
    await swarm.stopCeo().catch(() => undefined);
  });
});
