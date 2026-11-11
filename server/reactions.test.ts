import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import { sampleChat } from './chatSample.ts';
import { taggedMessages } from './demoReactions.ts';
import type { SessionOptions } from './agentRunner.ts';
import type { AgentStatus, PhoneMessage, ServerEvent, StatusReaction } from '../shared/types.ts';

// Reactions and quoted replies in the CEO chat (#118), in a demo office: the status reaction follows the job, a job can
// end with only a reaction (no bubble, no notification), several messages each get their own quoted answer, and the
// manager's 👎 reaches the CEO's next job.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  broadcast(ev: ServerEvent): void;
  backend: { startSession(opts: SessionOptions, cb: unknown): unknown };
  state: { ceo: { queue: unknown[] }; messages: PhoneMessage[]; agents: { id: string; status: AgentStatus }[]; settings: { statusReactions: boolean } };
};

const until = async (ok: () => boolean, ms = 25_000) => {
  for (let t = 0; t < ms && !ok(); t += 25) await new Promise((r) => setTimeout(r, 25));
  expect(ok()).toBe(true);
};

afterEach(() => vi.restoreAllMocks());

async function office(statusReactions = true) {
  for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  const swarm = new Swarm(createDemoBackend());
  await swarm.connectRepo('demo-co/pixel-todo');
  const i = swarm as unknown as Internals;
  i.state.ceo.queue = []; // no onboarding: the chat is the CEO's only job
  i.state.settings.statusReactions = statusReactions; // off by default (#193)
  i.ensureCeo([]);
  const statuses = new Map<number, StatusReaction[]>();
  const toasts: string[] = [];
  const broadcast = i.broadcast.bind(swarm);
  i.broadcast = (ev) => {
    if (ev.type === 'status') for (const id of ev.ids) statuses.set(id, [...(statuses.get(id) ?? []), ev.status]);
    if (ev.type === 'toast' && ev.kind === 'ceo') toasts.push(ev.text); // a CEO message's notification
    broadcast(ev);
  };
  const prompts: string[] = [];
  const start = i.backend.startSession.bind(i.backend);
  i.backend.startSession = (opts, cb) => (prompts.push(opts.prompt), start(opts, cb));
  const ceo = () => i.state.agents.find((a) => a.id === 'ceo')!;
  const byId = (id: number) => i.state.messages.find((m) => m.id === id)!;
  const replies = () => i.state.messages.filter((m) => m.from === 'ceo');
  return { swarm, statuses, toasts, prompts, ceo, byId, replies, state: i.state };
}

describe('reactions in the CEO chat', () => {
  it('shows 👀 → ⏳ → ✅ as the job runs, and ⚠️ when the manager stops it', { timeout: 60_000 }, async () => {
    const { swarm, statuses, ceo, byId, replies } = await office();
    const { id } = await swarm.messageCeo('How are things going?');
    await until(() => byId(id).status === 'done');
    expect(statuses.get(id)).toEqual(['seen', 'working', 'done']);
    expect(replies().at(-1)?.replyTo).toBeUndefined(); // right under it: no quote
    await until(() => ceo().status === 'done');

    const next = await swarm.messageCeo('Plan the next milestone for floor 1');
    await until(() => byId(next.id).status === 'working');
    await swarm.stopCeo();
    await until(() => byId(next.id).status === 'failed');
  });

  it("leaves the manager's messages alone when a background job ends: only a job holding them answers them", { timeout: 60_000 }, async () => {
    const { swarm, ceo, byId } = await office();
    const push = (id: number, status: StatusReaction) => (swarm as unknown as Internals).state.messages.push({ id, from: 'manager', text: 'Is floor 2 on budget?', at: Date.now(), delivery: 'read', status });
    push(900, 'working');
    push(901, 'seen');
    swarm.requestReview();
    await until(() => ceo().status === 'done');
    expect(byId(900).status).toBe('working');
    expect(byId(901).status).toBe('seen'); // its tool calls aren't work on them
  });

  it('ends a job with only a reaction: no bubble, no notification, the reaction is on the message', { timeout: 60_000 }, async () => {
    const { swarm, toasts, ceo, byId, replies } = await office();
    const { id } = await swarm.messageCeo('ok thanks');
    await until(() => ceo().status === 'done');
    expect(byId(id).reactions).toEqual([{ by: 'ceo', emoji: '👍' }]);
    expect(byId(id).status).toBe('done');
    expect(replies()).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('answers several messages sent in a row each with its own quote', { timeout: 60_000 }, async () => {
    const { swarm, ceo, byId, replies } = await office();
    const [a, b] = await Promise.all([swarm.messageCeo('Plan the checkout fix'), swarm.messageCeo('And check the phone layout first')]);
    await until(() => ceo().status === 'done');
    expect(replies().map((m) => m.replyTo)).toEqual([a.id, b.id]); // its closing recap is no third bubble (#378)
    expect(replies().every((m) => m.text.trim())).toBe(true);
    expect(replies()[1]).toMatchObject({ summary: 'Both messages are answered on your phone.', log: { count: expect.any(Number) } });
    expect([byId(a.id).status, byId(b.id).status]).toEqual(['done', 'done']);
  });

  it("sends the manager's 👎 and what was wrong to the CEO's next job, and toggles reactions", { timeout: 60_000 }, async () => {
    const { swarm, ceo, prompts, replies } = await office();
    await swarm.messageCeo('How are things going?');
    await until(() => ceo().status === 'done' && replies().length === 1);
    const r = replies()[0];
    expect(swarm.reactToMessage(r.id, '❤️').reactions).toEqual([{ by: 'manager', emoji: '❤️' }]);
    expect(swarm.reactToMessage(r.id, '❤️').reactions).toEqual([]);
    swarm.reactToMessage(r.id, '👎', 'too long');
    expect(() => swarm.reactToMessage(r.id, '🦄')).toThrow(/Pick a reaction/);
    await swarm.messageCeo('Shorter please');
    await until(() => prompts.length === 2);
    expect(prompts[1]).toMatch(/The manager reacted to your replies[\s\S]*👎 on your reply «.+»: too long/);
    expect(prompts[1]).not.toContain('❤️');
  });
});

describe('a quiet chat (#193)', () => {
  const notice = '<task-notification>\n<task-id>ksyddpqvg</task-id>\n<status>completed</status>\n<summary>MCP task ksyddpqv (office/wait_for) completed.</summary>\n<result>\nThe job ended.\n</result>\n</task-notification>';

  it("puts no status reaction on the manager's message unless Settings turns them on", { timeout: 60_000 }, async () => {
    const { swarm, statuses, ceo, byId, replies } = await office(false);
    const { id } = await swarm.messageCeo('How are things going?');
    await until(() => ceo().status === 'done' && replies().length === 1);
    expect(byId(id).status).toBeUndefined();
    expect(statuses.get(id)).toBeUndefined();
  });

  it("keeps the CEO session's task notification out of the chat: no message, no job", async () => {
    const { swarm, state } = await office(false);
    const before = state.messages.length;
    await expect(swarm.messageCeo(notice)).rejects.toThrow(/own output/);
    expect(state.messages.length).toBe(before);
    expect(state.ceo.queue).toEqual([]);
  });
});

describe("the demo's chat sample", () => {
  it('shows every status, a reaction-only ending and quoted replies', () => {
    const thread = sampleChat(Date.now());
    expect(new Set(thread.map((m) => m.status).filter(Boolean))).toEqual(new Set(['done', 'failed', 'working', 'seen', 'queued']));
    const thanks = thread.find((m) => m.text === 'ok thanks')!;
    expect(thanks.reactions).toEqual([{ by: 'ceo', emoji: '👍' }]);
    expect(thread[thread.indexOf(thanks) + 1].from).toBe('manager'); // no CEO bubble after it
    const quotes = thread.filter((m) => m.from === 'ceo' && m.replyTo !== undefined).map((m) => thread.find((x) => x.id === m.replyTo)?.from);
    expect(quotes).toEqual(['manager', 'manager']);
  });

  it('has a reply with one action card of each kind (#151)', () => {
    const reply = sampleChat(Date.now(), 1, { floor: 3, repoId: 'o/shop', agent: { id: 'ada', name: 'Ada' }, size: 4 }).find((m) => m.actions)!;
    expect(reply.actions!.map((a) => a.ref)).toEqual([
      { kind: 'section', section: 'team', repoId: 'o/shop' },
      { kind: 'agent', agentId: 'ada', details: 'setup' },
      { kind: 'agent', agentId: 'ada' },
      { kind: 'issue', repoId: 'o/shop', number: 1 },
      { kind: 'issue', repoId: 'o/shop', number: 2 },
      { kind: 'qa', repoId: 'o/shop', number: 2 },
      { kind: 'section', section: 'charter', repoId: 'o/shop' },
      { kind: 'section', section: 'ceo', repoId: 'o/shop' },
    ]);
  });
});

describe("the demo CEO's tagged messages", () => {
  it('splits a chat job into its messages, without the notes after them', () => {
    expect(taggedMessages('(message 4) Plan the fix (message 5) And the layout  The manager asked you to always remember: x')).toEqual([
      { id: 4, text: 'Plan the fix' },
      { id: 5, text: 'And the layout' },
    ]);
  });
});
