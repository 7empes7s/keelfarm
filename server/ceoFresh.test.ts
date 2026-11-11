import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import { HANDOVER_PROMPT } from './ceoDigest.ts';
import type { SessionCallbacks, SessionOptions } from './agentRunner.ts';
import type { AgentStatus, PhoneMessage } from '../shared/types.ts';

// Background jobs start fresh with the office's digest, only chat carries on (#330), in a demo office; a full chat
// session hands over to the next one.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  enqueueCeo(job: unknown): void;
  backend: { startSession(opts: SessionOptions, cb: SessionCallbacks): unknown };
  state: { ceo: { queue: unknown[]; kept: { turns: number }; handover?: { text: string } | null }; messages: PhoneMessage[]; agents: { id: string; status: AgentStatus; sessionId: string | null }[] };
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
  i.state.ceo.queue = []; // no onboarding
  i.ensureCeo([]);
  const runs: { prompt: string; resume?: string; id: string }[] = [];
  const start = i.backend.startSession.bind(i.backend);
  i.backend.startSession = (opts, cb) => {
    const id = opts.resumeSessionId ?? `session-${runs.length + 1}`;
    runs.push({ prompt: opts.prompt, resume: opts.resumeSessionId, id });
    cb.sessionId(id); // the demo's CEO reports none
    return start(opts, cb);
  };
  const ceo = () => i.state.agents.find((a) => a.id === 'ceo')!;
  return { swarm, i, runs, ceo };
}

describe('fresh background jobs (#330)', () => {
  it('runs a review and a follow-up fresh, and the next chat carries on its own session knowing what the review did', { timeout: 90_000 }, async () => {
    const { swarm, i, runs, ceo } = await office();
    await swarm.messageCeo('How are things going?');
    await until(() => runs.length === 1 && ceo().status === 'done');
    const chat = runs[0].id;

    swarm.requestReview();
    await until(() => runs.length === 2 && ceo().status === 'done');
    expect(runs[1].resume).toBeUndefined();
    expect(runs[1].prompt).toMatch(/^Digest from the office/);
    expect(runs[1].prompt).toContain('- Manager: How are things going?');
    expect(ceo().sessionId).toBe(chat); // the review's session isn't the chat's

    i.enqueueCeo({ kind: 'followup', events: [{ id: 'e1', kind: 'merged', key: 'k', label: '#3 merged', text: 'floor 1: PR #3 merged', at: Date.now() }], at: Date.now() });
    await until(() => runs.length === 3 && ceo().status === 'done');
    expect(runs[2].resume).toBeUndefined();
    expect(runs[2].prompt).toMatch(/^Digest from the office[\s\S]*Your latest background job \(Reviewing the company\)/);

    await swarm.messageCeo('What did the review do?');
    await until(() => runs.length === 4 && ceo().status === 'done');
    expect(runs[3].resume).toBe(chat);
    expect(runs[3].prompt).toContain('Since your last chat, your background job');
    const reply = i.state.messages.filter((m) => m.from === 'ceo').at(-1)!;
    expect(reply.text).toMatch(/^From my last background job \((reviewing the company|following up)/);
    expect(reply.log?.steps[0].label).toBe('Carried on in its chat session');
  });

  it('runs every job in the kept session with the setting off', { timeout: 60_000 }, async () => {
    const { swarm, runs, ceo } = await office();
    swarm.updateSettings({ ceoAwake: { freshJobs: false, models: { review: '' } } as never });
    await swarm.messageCeo('How are things going?');
    await until(() => runs.length === 1 && ceo().status === 'done');
    swarm.requestReview();
    await until(() => runs.length === 2 && ceo().status === 'done');
    expect(runs[1].resume).toBe(runs[0].id);
  });

  it('asks a full chat session for a handover and starts the next one with it and the digest', { timeout: 60_000 }, async () => {
    const { swarm, i, runs, ceo } = await office();
    await swarm.messageCeo('How are things going?');
    await until(() => runs.length === 1 && ceo().status === 'done');
    i.state.ceo.kept.turns = 10_000;
    await swarm.messageCeo('And floor 1?');
    await until(() => runs.length === 3 && ceo().status === 'done');
    expect(runs[1]).toMatchObject({ prompt: HANDOVER_PROMPT, resume: runs[0].id });
    expect(runs[2].resume).toBeUndefined();
    expect(runs[2].prompt).toMatch(/^Handover from your previous session:\nIn flight: the company review[\s\S]*Digest from the office/);
    expect(i.state.ceo.handover).toBeNull(); // the new session has it
    expect(i.state.messages.some((m) => m.text.includes('In flight'))).toBe(false); // never on the phone
  });

  it('uses a handover saved before an office restart instead of asking again', { timeout: 60_000 }, async () => {
    const { swarm, i, runs, ceo } = await office();
    await swarm.messageCeo('How are things going?');
    await until(() => runs.length === 1 && ceo().status === 'done');
    Object.assign(i.state.ceo, JSON.parse(JSON.stringify({ handover: { text: 'Saved before the restart: #41 waits for QA.', at: 1 } }))); // as state.json loads it
    i.state.ceo.kept.turns = 10_000;
    await swarm.messageCeo('And floor 1?');
    await until(() => runs.length === 2 && ceo().status === 'done');
    expect(runs[1].prompt).toMatch(/^Handover from your previous session:\nSaved before the restart: #41 waits for QA\./);
  });
});
