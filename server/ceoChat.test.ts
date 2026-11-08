import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CeoChat } from './ceoChat.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import { loadChats } from '../shared/conversations.ts';
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
    expect(lives.some((l) => l.steps.some((s) => s.label === 'Checking the floors'))).toBe(true);
    expect(lives.some((l) => l.open && l.blocks.length > 0)).toBe(true); // text arrived before the reply did
    const reply = replies()[0];
    expect(reply.log?.steps.map((st) => st.label)).toContain('Checking the floors');
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

  it("keeps the round's step log on the reply: plain words, timed, a failed step's reason (#150)", { timeout: 60_000 }, async () => {
    const { swarm, replies } = await office();
    await swarm.messageCeo('Look into the joystick on phones');
    await until(() => replies().some((m) => !m.requestId));
    const log = replies().find((m) => !m.requestId)!.log!;
    const labels = log.steps.map((st) => st.label);
    expect(labels).toEqual(expect.arrayContaining(['Reading client/src/pocket/touch/joystickThumbZone.tsx', 'Searching the web: mobile joystick UX', "Waiting for Claude's usage to be normal (up to 1 min)"]));
    expect(labels.some((l) => /^Filed floor 1 #\d+$/.test(l))).toBe(true);
    expect(log.steps.find((st) => st.label === 'Reading example.com')).toMatchObject({ state: 'failed', note: '403 Forbidden' });
    expect(log.steps.every((st) => st.state !== 'running' && typeof st.ms === 'number')).toBe(true);
    expect(log.count).toBe(log.steps.length);
    expect(log.ms).toBeGreaterThan(0);
  });

  it('takes a message resent with the same client id once (#216)', { timeout: 60_000 }, async () => {
    const { swarm, i } = await office();
    const { id } = await swarm.messageCeo('Ship the bakery', undefined, undefined, [], undefined, 'c-1');
    expect(await swarm.messageCeo('Ship the bakery', undefined, undefined, [], undefined, 'c-1')).toEqual({ id });
    expect(i.state.messages.filter((m) => m.from === 'manager').map((m) => m.clientId)).toEqual(['c-1']);
    await swarm.messageCeo('Ship the bakery'); // without one, sending it again is a new message
    expect(i.state.messages.filter((m) => m.from === 'manager')).toHaveLength(2);
    await swarm.stopCeo().catch(() => undefined);
  });

  it('puts what a reply changed on it as action cards, with its artifact and idea (#108)', { timeout: 60_000 }, async () => {
    const { swarm, replies } = await office();
    await swarm.messageCeo('Plan the next milestone for floor 1');
    await until(() => replies().some((m) => !m.requestId)); // a hire request posts a message of its own
    const reply = replies().find((m) => !m.requestId)!;
    expect(reply.actions?.map((a) => a.tool)).toEqual(['file_issue', 'scale_team']);
    expect(reply.actions?.[0]).toMatchObject({ icon: '📝', text: expect.stringMatching(/^Filed floor 1 #\d+ · Polish: phone layout/), ref: { kind: 'issue', repoId: 'demo-co/pixel-todo' } });
    expect(reply.actions?.[1].ref).toEqual({ kind: 'section', section: 'team', repoId: 'demo-co/pixel-todo' });
    expect(reply.log?.steps.map((st) => st.label)).toContain('Checking the floors'); // the reads stay in the steps, not on cards
    expect(reply.artifacts?.map((a) => a.title)).toEqual(['Milestone plan']);
    expect(reply.idea).toMatchObject({ kind: 'objective', message: expect.stringContaining("floor 1's charter") });
  });
});

describe('threads (#132)', () => {
  it('starts a thread in a project, tells the CEO its floor, and finds its artifacts from another thread', { timeout: 60_000 }, async () => {
    const { swarm, prompts, replies, ceo } = await office();
    await expect(swarm.newConversation('demo-co/nope')).rejects.toThrow(/no longer in the office/);
    await swarm.newConversation('demo-co/pixel-todo');
    const first = swarm.snapshot().chat!.current;
    expect(swarm.snapshot().chat!.conversations.find((c) => c.id === first)?.repoId).toBe('demo-co/pixel-todo');
    await swarm.messageCeo('Plan the next milestone for floor 1');
    await until(() => replies().some((m) => m.artifacts?.length));
    expect(prompts[0]).toContain('(This thread is in the project of floor 1, demo-co/pixel-todo.)');
    await until(() => ceo().status === 'done');
    expect(swarm.snapshot().chat!.conversations.find((c) => c.id === first)).toMatchObject({ files: 1, floors: ['demo-co/pixel-todo'] });

    swarm.editConversation(first, { title: 'Milestones', archived: true });
    expect(swarm.snapshot().chat!.conversations.find((c) => c.id === first)).toMatchObject({ title: 'Milestones', archived: true });
    expect(() => swarm.editConversation(first, { title: '' })).toThrow(/title/);
    expect(() => swarm.editConversation('cgone', { pinned: true })).toThrow(/no longer saved/);

    await swarm.newConversation();
    const project = await swarm.library({ scope: 'demo-co/pixel-todo', filter: 'artifact' });
    expect(project.items.map((i) => [i.title, i.conversationId])).toEqual([['Milestone plan', first]]);
    expect(project.items[0].artifact?.markdown).toContain('##'); // another thread's: its text comes with it
    expect((await swarm.library({ scope: 'company', filter: 'all' })).items).toEqual([]);
    await expect(swarm.library({ scope: 'demo-co/gone', filter: 'all' })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/No floor/) });
  });

  it("fills threads saved before #132 from their messages, and seeds the demo's", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'threads-'));
    const chat = new CeoChat(dir, path.join(dir, 'NOTES.md'), () => undefined);
    await chat.saveThread('cold', [{ id: 1, from: 'ceo', text: 'x', at: 5, artifacts: [{ id: '1-0', title: 'A', lead: '' }] }]);
    const s = loadChats({ current: 'cnow', list: [{ id: 'cnow', title: 'Now' }, { id: 'cold', title: 'Old' }] }, [], 1);
    expect(await chat.backfill(s, ['cnow', 'cold'])).toBe(1); // the open one came from state.messages
    expect(s.list.find((c) => c.id === 'cold')).toMatchObject({ files: 1, ceoAt: 5 });

    const added: string[] = [];
    const store = { addStream: async (_: unknown, meta: { name: string; type: string; from: 'ceo' }) => (added.push(meta.name), { id: `f${added.length}`, ...meta, size: 3, at: 1, keep: false }) };
    const open = [{ id: 0, from: 'manager' as const, text: 'Hello', at: 1 }];
    const next = await chat.seed(s, open, [{ repoId: 'r1', pinned: true, messages: [{ from: 'ceo', text: 'Shot', at: 2, image: { name: 'a.png', png: Buffer.from('png') }, artifacts: [{ id: '', title: 'Plan', lead: '', markdown: '# P' }] }] }], store as never, 10);
    expect(next).toBe(11);
    expect(s.current).toBe('cnow');
    expect(s.list.find((c) => c.id === 'cnow')).toMatchObject({ title: 'Now', count: 1 }); // the demo's open chat is counted, so switching away keeps it
    const seeded = s.list.find((c) => c.repoId === 'r1')!;
    expect(seeded).toMatchObject({ pinned: true, files: 2, count: 1 });
    expect(await chat.loadThread(seeded.id)).toMatchObject([{ id: 10, attachments: [{ id: 'f1', name: 'a.png' }], artifacts: [{ id: '10-0', title: 'Plan' }] }]);
    expect(added).toEqual(['a.png']);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('CeoChat.noteMessage (#215)', () => {
  it("keeps the agent chat item a tool call posted on that call's card, even with calls running at once", async () => {
    const chat = new CeoChat('', '', () => undefined, () => 'r1', (ref) => (ref === 'Linus' ? 'a7' : null));
    chat.noteMessage(1); // outside any call: nothing
    const tools = chat.track({
      messageAgent: async (a: { agent_id: string; id: number; floor: number }) => {
        await new Promise((r) => setTimeout(r, a.id === 5 ? 20 : 0));
        chat.noteMessage(a.id);
        return 'Sent.';
      },
    });
    await Promise.all([tools.messageAgent({ agent_id: 'Linus', id: 5, floor: 1 }), tools.messageAgent({ agent_id: 'Linus', id: 6, floor: 1 })]);
    expect(chat.turnActions(await chat.settled(100)).map((c) => c.ref)).toEqual([
      { kind: 'agent', agentId: 'a7', messageId: 5 },
      { kind: 'agent', agentId: 'a7', messageId: 6 },
    ]);
  });
});

