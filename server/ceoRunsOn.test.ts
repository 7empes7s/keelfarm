import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import type { SessionCallbacks, SessionOptions, SessionResult } from './agentRunner.ts';
import type { AgentStatus, PhoneMessage } from '../shared/types.ts';

// The CEO on another coding agent by hand (#418), in a demo office: picking Codex starts its next job on Codex with
// the office's tools, a job already running finishes where it started, the chat says so with Undo, and picking Claude
// Code again puts it back.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  pausedUntil: number;
  backend: { startSession(opts: SessionOptions, cb: SessionCallbacks): unknown };
  state: { ceo: { queue: unknown[] }; messages: PhoneMessage[]; agents: { id: string; status: AgentStatus; sessionCli: string | null }[] };
};

const until = async (ok: () => boolean, ms = 25_000) => {
  for (let t = 0; t < ms && !ok(); t += 25) await new Promise((r) => setTimeout(r, 25));
  expect(ok()).toBe(true);
};

afterEach(() => vi.restoreAllMocks());

type Run = { cli: string; model: string; office: boolean; tools: boolean; resume?: string; stopped: boolean; finish: (r?: Partial<SessionResult>) => void };

/** A demo office whose CEO sessions wait until the test finishes them. */
async function office() {
  for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  const swarm = new Swarm(createDemoBackend());
  await swarm.connectRepo('demo-co/pixel-todo');
  const i = swarm as unknown as Internals;
  i.state.ceo.queue = []; // no onboarding
  i.ensureCeo([]);
  const runs: Run[] = [];
  i.backend.startSession = (opts, cb) => {
    const run: Run = {
      cli: opts.cli ?? 'claude',
      model: opts.model ?? '',
      office: !!opts.office,
      tools: !!opts.tools,
      resume: opts.resumeSessionId,
      stopped: false,
      finish: (r) => cb.finished({ ok: true, text: 'Done.', costUsd: 0, turns: 1, errors: [], ...r }),
    };
    runs.push(run);
    cb.sessionId(opts.resumeSessionId ?? `session-${runs.length}`);
    return { send: () => undefined, stop: () => (run.stopped = true) };
  };
  const ceo = () => i.state.agents.find((a) => a.id === 'ceo')!;
  const pills = () => i.state.messages.filter((m) => m.ceoRuns);
  return { swarm, i, runs, ceo, pills };
}

describe('the CEO on another coding agent, picked by hand', () => {
  it('starts the next job on Codex with the office tools, lets a running job finish, and goes back to Claude Code', { timeout: 60_000 }, async () => {
    const { swarm, runs, ceo, pills } = await office();
    await swarm.messageCeo('Hello');
    await until(() => runs.length === 1);
    expect(runs[0]).toMatchObject({ cli: 'claude', model: 'claude-opus-5-5', office: true, tools: true });

    // Picked while that job runs: it isn't stopped, and it finishes on Claude Code.
    swarm.updateAgent('ceo', { cli: 'codex', model: '' });
    expect(runs[0].stopped).toBe(false);
    expect(pills()).toHaveLength(1);
    expect(pills()[0].text).toContain('now runs on Codex from the next job');
    expect(pills()[0].ceoRuns?.back).toMatchObject({ cli: 'claude', model: 'claude-opus-5-5' });
    runs[0].finish();
    await until(() => ceo().status === 'done');
    expect(ceo().sessionCli).toBe('claude');

    // The next job: Codex, the office's MCP tools, no Claude-only switches, and a fresh session (the kept one was Claude Code's).
    await swarm.messageCeo('And now?');
    await until(() => runs.length === 2);
    expect(runs[1]).toMatchObject({ cli: 'codex', model: '', office: true, tools: false, resume: undefined });
    runs[1].finish();
    await until(() => ceo().status === 'done');

    // Undo: the pill's way back.
    swarm.updateAgent('ceo', pills()[0].ceoRuns!.back);
    expect(pills()).toHaveLength(2);
    await swarm.messageCeo('Back?');
    await until(() => runs.length === 3);
    expect(runs[2]).toMatchObject({ cli: 'claude', model: 'claude-opus-5-5', office: true, tools: true, resume: undefined });
    runs[2].finish();
    await until(() => ceo().status === 'done');
  });

  it("runs through Claude's usage pause on Codex, and waits on Claude Code", { timeout: 60_000 }, async () => {
    const { swarm, i, runs } = await office();
    i.pausedUntil = Date.now() + 60 * 60_000;
    await swarm.messageCeo('Paused?');
    await new Promise((r) => setTimeout(r, 400));
    expect(runs).toHaveLength(0); // Claude Code: held by the pause

    swarm.updateAgent('ceo', { cli: 'codex' });
    await swarm.messageCeo('On Codex?');
    await until(() => runs.length === 1);
    expect(runs[0].cli).toBe('codex');
    runs[0].finish();
  });

  it('refuses a coding agent the CEO cannot run on', async () => {
    const { swarm } = await office();
    expect(() => swarm.updateAgent('ceo', { cli: 'vim' })).toThrow(/can run on/);
  });
});
