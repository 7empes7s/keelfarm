import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionCallbacks, SessionHandle, SessionOptions, SessionResult } from './agentRunner.ts';
import type { PersistedAgent, PersistedRepo } from './swarm/model.ts';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-resume-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

// #401 in a demo office: a saved session goes only to the CLI and account that have it, and one its CLI can't find
// starts again fresh on the same task, once, with no error and no strike.

type Internals = {
  backend: { startSession(opts: SessionOptions, cb: SessionCallbacks): SessionHandle };
  startOnAccount(a: PersistedAgent, opts: SessionOptions, cb: SessionCallbacks): SessionHandle;
  onFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult): Promise<void>;
  issueFailures: Map<string, number>;
  state: { agents: PersistedAgent[]; repos: PersistedRepo[] };
};

beforeEach(() => {
  fs.rmSync(path.join(home, 'demo-state.json'), { force: true });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
let last: InstanceType<typeof Swarm> | null = null;
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await last?.accounts.flushed();
});

const LOST: SessionResult = { ok: false, text: '', costUsd: 0, turns: 0, errors: ["Codex couldn't find the session it was resuming."], lostSession: true };
const DONE: SessionResult = { ok: true, text: 'Pushed the fix.', costUsd: 0.2, turns: 3, errors: [] };

/** Radia fixing PR #394, and the sessions started for her: a resumed one ends as its CLI not finding it, a fresh one finishes. */
async function office() {
  const swarm = (last = new Swarm(createDemoBackend()));
  const i = swarm as unknown as Internals;
  const connecting = swarm.connectRepo('demo-co/pixel-todo');
  await vi.advanceTimersByTimeAsync(2_000);
  const repo = await connecting;
  await swarm.accounts.init();
  const hired = swarm.hireAgent(repo.id, { name: 'Radia', strict: true });
  const radia = i.state.agents.find((a) => a.id === hired.id)!;
  Object.assign(radia, { status: 'working', task: 'fix', prNumber: 394, issueNumber: 12, repoId: repo.id });
  const runs: SessionOptions[] = [];
  const demo = i.backend.startSession.bind(i.backend);
  i.backend.startSession = (opts, cb) => {
    runs.push(opts);
    const t = setTimeout(() => cb.finished(opts.resumeSessionId ? LOST : DONE), 10);
    return { send: () => undefined, stop: () => clearTimeout(t) };
  };
  const finished = vi.fn<(r: SessionResult) => void>();
  const cb: SessionCallbacks = { log: () => undefined, tool: () => undefined, sessionId: () => undefined, browserUrl: () => undefined, screenshot: () => undefined, finished };
  const start = (saved: Partial<PersistedAgent>, o: Partial<SessionOptions> = {}) => {
    Object.assign(radia, { sessionId: 'thread-1', ...saved });
    i.startOnAccount(radia, { cwd: home, prompt: 'Fix PR #394.', systemAppend: '', role: 'agent', task: 'fix', agentId: radia.id, resumeSessionId: 'thread-1', ...o } as SessionOptions, cb);
  };
  return { swarm, i, repo: repo as unknown as PersistedRepo, radia, runs, finished, start, demo };
}

const terminal = { cli: 'codex', terminal: { tail: () => [] } } as unknown as Partial<SessionOptions>;

describe('resuming only a session that is there (#401)', { timeout: 30_000 }, () => {
  it("never passes a Codex thread to Claude Code: a fresh session instead, told its worktree is as it was", async () => {
    const { runs, finished, start } = await office();
    start({ sessionCli: 'codex', sessionAccount: 'codex-login' });
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toHaveLength(1);
    expect(runs[0].resumeSessionId).toBeUndefined();
    expect(runs[0].prompt).toMatch(/couldn't be resumed; this is a fresh session[\s\S]*Fix PR #394\.$/);
    expect(finished.mock.calls).toEqual([[DONE]]);
  });

  it("never resumes one account's Codex session on another, and does on the same one", async () => {
    const { runs, start } = await office();
    start({ sessionCli: 'codex', sessionAccount: 'codex-other' }, terminal);
    await vi.advanceTimersByTimeAsync(100);
    start({ sessionCli: 'codex', sessionAccount: 'codex-login' }, terminal);
    await vi.advanceTimersByTimeAsync(100);
    expect(runs.map((r) => [r.cli, r.account, r.resumeSessionId])).toEqual([
      ['codex', 'codex-login', undefined],
      ['codex', 'codex-login', 'thread-1'],
      ['codex', 'codex-login', undefined], // it wasn't there after all: one fresh restart
    ]);
  });

  it("a session its CLI can't find starts again fresh on the same task once: no error, no strike, no loop", async () => {
    const { i, runs, finished, start } = await office();
    i.backend.startSession = (opts, cb) => {
      runs.push(opts);
      const t = setTimeout(() => cb.finished(LOST), 10); // even the fresh one: no loop
      return { send: () => undefined, stop: () => clearTimeout(t) };
    };
    start({ sessionCli: 'codex', sessionAccount: 'codex-login' }, terminal);
    await vi.advanceTimersByTimeAsync(100);
    expect(runs.map((r) => r.resumeSessionId)).toEqual(['thread-1', undefined]);
    expect(runs[1].prompt).toMatch(/fresh session/);
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('lets the task go instead when another agent already holds the PR, with no error state', async () => {
    const { swarm, i, radia, repo, runs, finished, start } = await office();
    const hired = swarm.hireAgent(repo.id, { name: 'Alan', strict: true });
    const alan = i.state.agents.find((a) => a.id === hired.id)!;
    Object.assign(alan, { status: 'working', task: 'fix', prNumber: 394, repoId: repo.id });
    start({ sessionCli: 'codex', sessionAccount: 'codex-login' }, terminal);
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toHaveLength(1);
    const [[result]] = finished.mock.calls;
    expect(result).toMatchObject({ lostSession: true, errors: ['Alan already has it, so Radia let it go'] });
    await i.onFinished(radia, repo, result);
    expect(radia).toMatchObject({ status: 'idle', task: null, prNumber: null, lastError: null });
    expect(i.issueFailures.size).toBe(0);
  });

  it("the demo's session another CLI made, or one from before a restart, isn't there: the fix carries on fresh", async () => {
    const { i, runs, finished, start, demo } = await office();
    const lines: string[] = [];
    i.backend.startSession = (opts, cb) => {
      runs.push(opts);
      return demo(opts, { ...cb, log: (entries) => lines.push(...entries.map((e) => e.text)) });
    };
    start({ sessionId: 'demo-fix-gone', sessionCli: 'claude', sessionAccount: 'claude-login' }, { resumeSessionId: 'demo-fix-gone' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(lines).toContain('No conversation found with session ID: demo-fix-gone');
    expect(runs.map((r) => r.resumeSessionId)).toEqual(['demo-fix-gone', undefined]);
    expect(finished).not.toHaveBeenCalled(); // the fresh fix session is at work
  });
});
