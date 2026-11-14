import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import type { SessionCallbacks, SessionOptions } from './agentRunner.ts';
import type { CeoJob } from './ceo.ts';
import type { CeoJobRecord } from './ceoRedo.ts';
import { followupEvents } from '../shared/followups.ts';
import type { HistoryEntry } from '../shared/history.ts';
import type { AgentStatus, PhoneMessage } from '../shared/types.ts';

// Redo on Opus and the CEO jobs log (#332), in a demo office: a follow-up on Sonnet, its redo on the CEO model with the
// same inputs in a fresh session, the links between their replies, and a log row for each.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  enqueueCeo(job: CeoJob): void;
  backend: { startSession(opts: SessionOptions, cb: SessionCallbacks): unknown };
  history: { all(): readonly HistoryEntry[] };
  state: { ceo: { queue: unknown[]; jobs?: CeoJobRecord[] }; messages: PhoneMessage[]; agents: { id: string; name: string; role: string; status: AgentStatus }[]; settings: { ceoAwake: { automatedOnCeo: boolean } } };
};

const until = async (ok: () => boolean, ms = 25_000) => {
  for (let t = 0; t < ms && !ok(); t += 25) await new Promise((r) => setTimeout(r, 25));
  expect(ok()).toBe(true);
};

afterEach(() => vi.restoreAllMocks());

async function office() {
  for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  const swarm = new Swarm(createDemoBackend());
  const repo = await swarm.connectRepo('demo-co/pixel-todo');
  const i = swarm as unknown as Internals;
  i.state.ceo.queue = []; // no onboarding
  i.ensureCeo([]);
  const runs: { model: string; resume?: string; prompt: string }[] = [];
  const start = i.backend.startSession.bind(i.backend);
  i.backend.startSession = (opts, cb) => {
    runs.push({ model: opts.model ?? '', resume: opts.resumeSessionId, prompt: opts.prompt });
    return start(opts, cb);
  };
  const ceo = () => i.state.agents.find((a) => a.id === 'ceo')!;
  const worker = i.state.agents.find((a) => a.role !== 'ceo')!;
  const stalled: FollowupEvent = { ...followupEvents.stalled(worker, '#12', 25, repo.id, `floor ${repo.floor}`), id: 'e1', at: Date.now() };
  return { swarm, i, runs, ceo, stalled };
}
type FollowupEvent = NonNullable<CeoJob['events']>[number];

describe('Redo on Opus', () => {
  it('runs a Sonnet follow-up again on the CEO model with its inputs, fresh, linking the two replies and logging both', { timeout: 60_000 }, async () => {
    const { swarm, i, runs, ceo, stalled } = await office();
    i.enqueueCeo({ kind: 'followup', events: [stalled], at: Date.now() });
    await until(() => runs.length === 1 && ceo().status === 'done' && !!i.state.ceo.jobs?.length);
    const first = i.state.messages.find((m) => m.ceoJob)!;
    expect(first.ceoJob).toMatchObject({ kind: 'followup', model: 'claude-sonnet-5' });
    const job = first.ceoJob!.job;
    expect(i.state.ceo.jobs!.find((r) => r.id === job)).toMatchObject({ kind: 'followup', model: 'claude-sonnet-5', message: first.id, inputs: { events: [stalled] } });

    const { job: redo } = swarm.redoCeoJob(job);
    expect(first.ceoJob!.redoneBy).toEqual({ job: redo, message: null });
    expect(() => swarm.redoCeoJob(job)).toThrow(/already redone/); // once
    await until(() => runs.length === 2 && ceo().status === 'done' && i.history.all().filter((e) => e.ceo).length === 2);
    expect(runs[1]).toMatchObject({ model: 'claude-opus-5-5', resume: undefined });
    expect(runs[1].prompt).toContain(`- [e1] ${stalled.text}`); // the same event
    const second = i.state.messages.find((m) => m.ceoJob?.job === redo)!;
    expect(second.ceoJob).toMatchObject({ model: 'claude-opus-5-5', redoOf: { job, message: first.id } });
    expect(first.ceoJob!.redoneBy).toEqual({ job: redo, message: second.id });

    const rows = i.history.all().filter((e) => e.ceo);
    expect(rows.map((e) => [e.ceo!.job, e.model, e.ceo!.fresh, e.ceo!.reply])).toEqual([
      [job, 'claude-sonnet-5', true, 'replied'],
      [redo, 'claude-opus-5-5', true, 'replied'],
    ]);
    expect(rows[0].ceo).toMatchObject({ kind: 'followup', trigger: 'Event e1: ' + stalled.label, message: first.id, tools: { agent_log: 1 }, inputTokens: expect.any(Number), outputTokens: expect.any(Number) });
    expect(rows[1].ceo).toMatchObject({ trigger: `Redo of job #${job}`, redoOf: job, message: second.id });
  });

  it('refuses a redo of a chat with a plain reason, and the quick switch runs automated jobs on the CEO model', { timeout: 60_000 }, async () => {
    const { swarm, i, runs, ceo } = await office();
    await swarm.messageCeo('How are things going?');
    await until(() => runs.length === 1 && ceo().status === 'done' && !!i.state.ceo.jobs?.length);
    const chat = i.state.ceo.jobs!.find((r) => r.kind === 'chat')!;
    expect(() => swarm.redoCeoJob(chat.id)).toThrow(/Only jobs the office starts by itself/);
    expect(i.state.messages.some((m) => m.ceoJob)).toBe(false); // a chat reply has no Redo

    swarm.updateSettings({ ceoAwake: { automatedOnCeo: true } as never });
    swarm.requestReview();
    await until(() => runs.length === 2 && ceo().status === 'done');
    expect(runs[1].model).toBe('claude-opus-5-5');
  });
});

describe('the guide\'s research tick (#496)', () => {
  it("a research started from the chat runs at the Researcher's desk while the CEO answers chat, then is kept as done (#664)", { timeout: 90_000 }, async () => {
    const { swarm, i, runs, ceo } = await office();
    expect(swarm.snapshot().ceo.researchedAt).toBeNull();
    await swarm.messageCeo('Research: how comparable projects solve our biggest open problem, then propose a plan');
    await until(() => runs.length === 1 && !!swarm.snapshot().research?.job);
    expect(runs[0].prompt).toMatch(/^Research for the manager: "how comparable projects/);
    expect(swarm.snapshot().ceo).toMatchObject({ job: null, researchedAt: null });
    // The CEO's chat stays free: a message gets its reply while the research still runs.
    const { id } = await swarm.messageCeo('How is it going?');
    await until(() => i.state.messages.some((m) => m.from === 'ceo' && m.id > id && !m.research));
    expect(swarm.snapshot().research?.job?.topic).toMatch(/^how comparable projects/);
    expect(ceo().status).toBe('done');
    await until(() => !!swarm.snapshot().ceo.researchedAt, 60_000);
    expect(i.state.messages.find((m) => m.research)?.artifacts?.[0].title).toMatch(/^Research: how comparable/);
    expect(swarm.snapshot().research).toMatchObject({ job: null, last: { topic: expect.stringMatching(/^how comparable/), partial: false } });
  });
});
