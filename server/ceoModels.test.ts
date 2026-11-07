import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import type { SessionCallbacks, SessionOptions } from './agentRunner.ts';
import type { AgentStatus, PhoneMessage } from '../shared/types.ts';

// The CEO's model per kind of job (#331), in a demo office: a job runs on its kind's model, a kept session on another
// model means a fresh one, and a model error runs the job once more on the CEO's own model.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  backend: { startSession(opts: SessionOptions, cb: SessionCallbacks): unknown };
  state: { ceo: { queue: unknown[] }; messages: PhoneMessage[]; agents: { id: string; status: AgentStatus }[] };
};

const until = async (ok: () => boolean, ms = 25_000) => {
  for (let t = 0; t < ms && !ok(); t += 25) await new Promise((r) => setTimeout(r, 25));
  expect(ok()).toBe(true);
};

afterEach(() => vi.restoreAllMocks());

async function office(failOn?: string) {
  for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  const swarm = new Swarm(createDemoBackend());
  await swarm.connectRepo('demo-co/pixel-todo');
  const i = swarm as unknown as Internals;
  i.state.ceo.queue = []; // no onboarding
  i.ensureCeo([]);
  const runs: { model: string; resume?: string }[] = [];
  const start = i.backend.startSession.bind(i.backend);
  i.backend.startSession = (opts, cb) => {
    runs.push({ model: opts.model ?? '', resume: opts.resumeSessionId });
    cb.sessionId(opts.resumeSessionId ?? `session-${runs.length}`); // the demo's CEO reports none
    if (opts.model !== failOn) return start(opts, cb);
    setTimeout(() => cb.finished({ ok: false, text: '', costUsd: 0, turns: 0, errors: [`There's an issue with the selected model (${failOn}). It may not exist or you may not have access to it.`] }), 10);
    return { send: () => undefined, stop: () => undefined };
  };
  const ceo = () => i.state.agents.find((a) => a.id === 'ceo')!;
  return { swarm, runs, ceo, state: i.state };
}

describe("the CEO's model per job kind", () => {
  it('runs a review on its kind’s model, follows a settings change, and starts the chat fresh on the CEO model', { timeout: 60_000 }, async () => {
    const { swarm, runs, ceo } = await office();
    swarm.requestReview();
    await until(() => runs.length === 1 && ceo().status === 'done');
    expect(runs[0].model).toBe('claude-sonnet-5');

    swarm.updateSettings({ ceoAwake: { models: { review: 'claude-fable-5-1' } } as never });
    swarm.requestReview();
    await until(() => runs.length === 2 && ceo().status === 'done');
    expect(runs[1].model).toBe('claude-fable-5-1');

    await swarm.messageCeo('How are things going?');
    await until(() => runs.length === 3 && ceo().status === 'done');
    expect(runs[2]).toEqual({ model: 'claude-opus-5-5', resume: undefined }); // the kept session ran on Fable: a fresh one
    await swarm.messageCeo('And floor 1?');
    await until(() => runs.length === 4 && ceo().status === 'done');
    expect(runs[3].model).toBe('claude-opus-5-5');
    expect(runs[3].resume).toBeTruthy(); // same model: it carries on
  });

  it('runs a job once more on the CEO model when its model is not available, with one office note', { timeout: 60_000 }, async () => {
    const { swarm, runs, ceo, state } = await office('claude-sonnet-5');
    swarm.requestReview();
    await until(() => runs.length === 2 && ceo().status === 'done');
    expect(runs.map((r) => r.model)).toEqual(['claude-sonnet-5', 'claude-opus-5-5']);
    expect(runs[1].resume).toBeUndefined();
    expect(state.messages.filter((m) => m.from === 'office' && m.text.includes("couldn't use claude-sonnet-5"))).toHaveLength(1);
  });
});
