import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MEMORY, heldNote, memorySettings, type HealthView, type MemoryReading, type MemorySettings } from '../shared/health.ts';
import { createDemoBackend } from './demo.ts';
import { admission, checkRestart, heldMessage, heldPing, idlePreview, KILL_RETRIES, killRetry, learnEstimate, MEMORY_PING_GAP_MS, memoryRelief, memoryVictim, OfficeHealth, requeueMessage, reservedMb, sessionKilled, stopDigest, type LiveSession } from './health.ts';
import { Swarm } from './swarm.ts';

// The office never takes its computer down (#55): sessions start only when memory allows, sessions killed for memory
// resume (at most twice) and then go back to the queue, and the CEO can restart and guide stuck agents.

const mem = (availableMb: number, swapFreeMb = 0): MemoryReading => ({ availableMb, totalMb: 7800, swapFreeMb, swapTotalMb: 8192, load: 2, cpus: 4, at: 0 });
const est = () => 1536;

describe('admission', () => {
  const ask = (kind: 'build' | 'ceo', memory: MemoryReading | null, reserved = 0) => admission({ kind, memory, estimateMb: 1536, headroomMb: 1536, reservedMb: reserved });

  it('starts a session when memory and swap leave the headroom free after it', () => {
    expect(ask('build', mem(2000, 1100))).toBeNull();
    expect(ask('build', mem(3072))).toBeNull();
  });

  it('holds it, saying why, when they would not', () => {
    expect(ask('build', mem(3000))).toBe('Waiting for memory: 2.9 GB free, a build session needs about 1.5 GB and 1.5 GB stays free.');
    expect(ask('build', mem(6000), 3000)).toMatch(/^Waiting for memory: 2\.9 GB free once running sessions grow/);
  });

  it('always admits the CEO, and everything before the first reading', () => {
    expect(ask('ceo', mem(10))).toBeNull();
    expect(ask('build', null)).toBeNull();
  });

  it('reserves what running sessions are still expected to grow by', () => {
    expect(reservedMb([{ kind: 'build', rssMb: 500, ageMs: 600_000 }], est)).toBe(1036);
    expect(reservedMb([{ kind: 'build', rssMb: 2000, ageMs: 600_000 }], est)).toBe(0);
    // Unmeasured (not Linux): the whole estimate while young, nothing once it has had time to grow.
    expect(reservedMb([{ kind: 'qa', rssMb: null, ageMs: 10_000 }, { kind: 'qa', rssMb: null, ageMs: 600_000 }], est)).toBe(1536);
  });
});

describe('estimates', () => {
  it('grow quickly towards a bigger peak and shrink slowly', () => {
    expect(learnEstimate(1536, 2536)).toBe(2036);
    expect(learnEstimate(1536, 536)).toBe(1436);
    expect(learnEstimate(1536, 0)).toBe(1536);
    expect(learnEstimate(300, 1)).toBe(270);
    expect(learnEstimate(256, 1)).toBe(256);
  });

  it('come from settings, which keep only sane numbers', () => {
    const s = memorySettings(DEFAULT_MEMORY, { headroomMb: '2048', sessionMaxMb: 100, estimates: { build: 3000, qa: 'x', nope: 5 } });
    expect(s).toEqual({ headroomMb: 2048, sessionMaxMb: 512, estimates: { build: 3000 }, alertAfterMin: 15 });
    expect(memorySettings(s, { sessionMaxMb: 0 }).sessionMaxMb).toBe(0);
    expect(memorySettings(s, { headroomMb: 'lots' }).headroomMb).toBe(2048);
    expect(memorySettings(s, { alertAfterMin: 30 }).alertAfterMin).toBe(30);
    expect(memorySettings({ headroomMb: 1, sessionMaxMb: 0, estimates: {} } as unknown as MemorySettings, {}).alertAfterMin).toBe(15); // a state saved before #115
  });
});

describe('memory pings (#115)', () => {
  const MIN = 60_000;
  const ping = (waitedMin: number, lastPingAt: number | null = null, told = false) => heldPing({ since: 0, told, now: waitedMin * MIN, delayMs: 15 * MIN, lastPingAt });

  it('never ring for a wait under the threshold, ring once after it, and at most once an hour', () => {
    expect(ping(1)).toBe(false);
    expect(ping(14.9)).toBe(false);
    expect(ping(15)).toBe(true);
    expect(ping(40, null, true)).toBe(false); // that wait was told
    expect(ping(15, 15 * MIN - MEMORY_PING_GAP_MS + MIN)).toBe(false); // another wait pinged under an hour ago
    expect(ping(15, 15 * MIN - MEMORY_PING_GAP_MS)).toBe(true);
  });

  it('say what waits, that there is nothing to do, and what helps', () => {
    const m = heldMessage({ tasks: 2, freeMb: 3277, needMb: 3584 }, 15 * MIN);
    expect(m.title).toBe('Work has waited 15 min for memory');
    expect(m.body).toMatch(/^2 tasks wait: 3\.2 GB free, 3\.5 GB needed\. Nothing to do: .*fewer agents on a floor.*Memory kept free/);
    expect(heldNote({ tasks: 2, freeMb: 3277, needMb: 3584 })).toBe('⏳ 2 tasks waiting for memory · 3.2 GB free, 3.5 GB needed');
    expect(heldNote({ tasks: 1, freeMb: 900, needMb: 3072 })).toMatch(/^⏳ 1 task waiting/);
    expect(heldNote(null)).toBeNull();
  });

  it('group stopped sessions into one digest an hour', () => {
    expect(stopDigest([], 0, null)).toBeNull();
    expect(stopDigest(['Ada'], 0, null)?.title).toBe("Ada's session was stopped to free memory and will resume");
    const two = stopDigest(['Ada', 'Bo'], MEMORY_PING_GAP_MS, 0);
    expect(two?.title).toBe('2 sessions were stopped to free memory and will resume');
    expect(two?.body).toMatch(/^Ada, Bo\. Nothing to do: they resume by themselves/);
    expect(stopDigest(['Ada', 'Bo'], MEMORY_PING_GAP_MS - 1, 0)).toBeNull();
  });

  it('say when work went back to the queue', () => {
    expect(requeueMessage('Ada', 'Their session was killed', 'Resumed 2 times already, so the work goes back to the queue.')).toMatchObject({ title: "Ada's work went back to the queue", body: expect.stringMatching(/progress is lost/) });
  });
});

describe('killed sessions', () => {
  it('are the ones a signal or a dead terminal keeper ended', () => {
    expect(sessionKilled(['Claude Code exited with code -1 before finishing.'])).toBe(true);
    expect(sessionKilled(['Claude Code exited with code 137 before finishing.'])).toBe(true);
    expect(sessionKilled(['Claude Code exited with code 1 before finishing.'])).toBe(false);
    expect(sessionKilled(['Stopped by manager'])).toBe(false);
  });

  it('resume at most twice, then go back to the queue; what cannot resume goes back at once', () => {
    expect([0, 1, 2].map((n) => killRetry(n, true))).toEqual(['resume', 'resume', 'requeue']);
    expect(killRetry(0, false)).toBe('requeue');
  });

  it('stop the session over its ceiling, else the biggest only when memory is about to run out', () => {
    const sessions = [{ id: 'a', rssMb: 900 }, { id: 'b', rssMb: 1800 }];
    expect(memoryVictim({ memory: mem(4000), headroomMb: 1536, sessionMaxMb: 1024, sessions })?.id).toBe('b');
    expect(memoryVictim({ memory: mem(4000), headroomMb: 1536, sessionMaxMb: 0, sessions })).toBeNull();
    expect(memoryVictim({ memory: mem(500, 100), headroomMb: 1536, sessionMaxMb: 0, sessions })).toMatchObject({ id: 'b', why: expect.stringMatching(/running out of memory/) });
  });

  it('stop an idle preview before any session when memory is about to run out (#204)', () => {
    const sessions = [{ id: 'a', rssMb: 900 }, { id: 'b', rssMb: 1800 }];
    const previews = [
      { key: 'o/r#main', rssMb: 300, idle: true },
      { key: 'o/r#4', rssMb: 700, idle: true },
      { key: 'o/r#5', rssMb: 900, idle: false }, // on screen, or an agent tests in it
    ];
    expect(idlePreview(previews)).toBe('o/r#4');
    expect(idlePreview([previews[2]])).toBeNull();
    expect(memoryRelief({ memory: mem(500, 100), headroomMb: 1536, sessionMaxMb: 0, sessions, previews })).toEqual({ preview: 'o/r#4' });
    // No idle preview: the biggest session, as before.
    expect(memoryRelief({ memory: mem(500, 100), headroomMb: 1536, sessionMaxMb: 0, sessions, previews: [previews[2]] })).toMatchObject({ session: { id: 'b' } });
    // A session over its ceiling is that session's problem; plenty of memory: nothing stops.
    expect(memoryRelief({ memory: mem(500, 100), headroomMb: 1536, sessionMaxMb: 1024, sessions, previews })).toMatchObject({ session: { id: 'b' } });
    expect(memoryRelief({ memory: mem(4000), headroomMb: 1536, sessionMaxMb: 0, sessions, previews })).toBeNull();
  });
});

describe('OfficeHealth', () => {
  function rig(available = 9000) {
    const settings: MemorySettings = { ...DEFAULT_MEMORY, estimates: {} };
    const memory = { now: mem(available) };
    const sessions: LiveSession[] = [];
    const usage = new Map<string, { rssMb: number; pids: number[] }>();
    const out = { lines: [] as string[], alerts: [] as string[], bodies: [] as string[], retried: [] as [string, boolean][], killed: [] as number[], views: [] as HealthView[] };
    const health = new OfficeHealth({
      probe: () => ({ memory: async () => memory.now, usage: async () => usage, kill: (pids) => out.killed.push(...pids) }),
      settings: () => settings,
      sessions: () => sessions,
      log: (_, text) => out.lines.push(text),
      alert: (title, body) => (out.alerts.push(title), out.bodies.push(body)),
      emit: (v) => out.views.push(v),
      save: () => undefined,
      retry: (id, _, requeue) => out.retried.push([id, requeue]),
      schedule: () => undefined,
    });
    return { health, settings, memory, sessions, usage, out };
  }
  const killed = ['Claude Code exited with code 137 before finishing.'];
  const ada = { id: 'a1', name: 'Ada' };

  it('resumes a killed session twice once memory is back, then puts the work back in the queue', async () => {
    const { health, memory, out } = rig(1000);
    await health.tick();
    expect(health.ended(ada, 'build', killed, true, true)).toMatch(/retry 1 of 2/);
    await health.tick();
    expect(out.retried).toEqual([]); // no memory yet: it waits
    expect(health.view().waiting).toBe(1);
    memory.now = mem(9000);
    await health.tick();
    expect(out.retried).toEqual([['a1', false]]);
    expect(health.ended(ada, 'build', killed, true, true)).toMatch(/retry 2 of 2/);
    expect(health.ended(ada, 'build', killed, true, true)).toMatch(/goes back to the queue/);
    await health.tick();
    expect(out.retried.at(-1)).toEqual(['a1', true]);
    // Two resumes in one digest (the second within the hour waits for the next); the requeue rang at once.
    expect(out.alerts).toEqual(["Ada's session was stopped to free memory and will resume", "Ada's work went back to the queue"]);
    // A session that ends as usual starts the count again.
    expect(health.ended(ada, 'build', [], true, true)).toBeNull();
    expect(health.ended(ada, 'build', killed, true, true)).toMatch(new RegExp(`retry 1 of ${KILL_RETRIES}`));
  });

  it('leaves alone sessions that ended as usual, were stopped by the manager, or ran out of memory on a task not to retry', () => {
    const { health } = rig();
    expect(health.ended(ada, 'build', ['Claude Code exited with code 1 before finishing.'], true, true)).toBeNull();
    expect(health.ended(ada, 'build', killed, false, true)).toBeNull();
  });

  it('stops the session over the ceiling, retries it, and learns from its peak', async () => {
    const { health, settings, sessions, usage, out } = rig();
    settings.sessionMaxMb = 2048;
    sessions.push({ id: 'a1', kind: 'build', dir: '/m/a1', startedAt: Date.now() });
    usage.set('/m/a1', { rssMb: 3000, pids: [11, 12] });
    await health.tick();
    expect(out.killed).toEqual([11, 12]);
    expect(out.lines[0]).toMatch(/^⚠ Stopping this session: its processes used 2\.9 GB/);
    sessions.pop();
    expect(health.ended(ada, 'build', ['Claude Code exited with code 0 before finishing.'], true, true)).toMatch(/^The office stopped their session/);
    expect(settings.estimates.build).toBe(2268); // halfway from 1.5 GB to its 2.9 GB peak
  });

  it('holds new work while memory is short with a note, rings once after 15 minutes and not again within the hour', async () => {
    const { health, memory, out } = rig(2000);
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.now();
    const at = (ms: number) => vi.setSystemTime(t0 + ms);
    try {
      await health.tick();
      expect(health.admit('build', 'r1')).toBe(false);
      expect(health.admit('qa', 'r2')).toBe(false);
      expect(health.view().held).toMatch(/^Waiting for memory/);
      expect(health.view().heldWork).toEqual({ tasks: 2, freeMb: 2000, needMb: 3072 });
      expect(health.admit('ceo')).toBe(true);
      expect(() => health.ensure('qa')).toThrow(/Waiting for memory/);
      at(14 * 60_000);
      await health.tick();
      expect(out.alerts).toEqual([]); // the note shows in the office; no ping yet
      at(15 * 60_000);
      await health.tick();
      await health.tick();
      expect(out.alerts).toEqual(['Work has waited 15 min for memory']);
      expect(out.bodies[0]).toMatch(/^2 tasks wait: 2\.0 GB free, 3\.0 GB needed\. Nothing to do/);
      memory.now = mem(9000);
      await health.tick();
      expect(health.view()).toMatchObject({ held: null, heldWork: null });
      expect(health.admit('build')).toBe(true);
      // Another long wait within the hour: no second ping; after the hour, one.
      memory.now = mem(2000);
      await health.tick();
      at(20 * 60_000);
      expect(health.admit('build', 'r1')).toBe(false);
      at(40 * 60_000);
      await health.tick();
      expect(out.alerts).toHaveLength(1);
      at(75 * 60_000);
      await health.tick();
      expect(out.alerts).toEqual(['Work has waited 15 min for memory', 'Work has waited 55 min for memory']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never rings for a short wait that clears by itself', async () => {
    const { health, memory, out } = rig(2000);
    await health.tick();
    expect(health.admit('build', 'r1')).toBe(false);
    memory.now = mem(9000);
    await health.tick();
    expect(health.view().heldWork).toBeNull();
    expect(out.alerts).toEqual([]);
  });

  it('groups stopped sessions into one digest an hour, and rings at once when work goes back to the queue', async () => {
    const { health, out } = rig(9000);
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.now();
    try {
      health.ended(ada, 'build', killed, true, true);
      health.ended({ id: 'b1', name: 'Bo' }, 'qa', killed, true, true);
      await health.tick();
      expect(out.alerts).toEqual(['2 sessions were stopped to free memory and will resume']);
      health.ended({ id: 'c1', name: 'Cy' }, 'build', killed, true, true);
      vi.setSystemTime(t0 + 30 * 60_000);
      await health.tick();
      expect(out.alerts).toHaveLength(1); // within the hour: it waits for the next digest
      health.ended({ id: 'd1', name: 'Di' }, 'build', killed, true, false); // can't resume: back to the queue
      expect(out.alerts.at(-1)).toBe("Di's work went back to the queue");
      vi.setSystemTime(t0 + 61 * 60_000);
      await health.tick();
      expect(out.alerts.at(-1)).toBe("Cy's session was stopped to free memory and will resume");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('restart_agent', () => {
  it('restarts only a stopped or errored agent that has a task', () => {
    const a = { name: 'Ada', role: 'agent', status: 'error', task: 'issue' };
    expect(checkRestart(a)).toBe(a);
    expect(() => checkRestart({ ...a, status: 'working' })).toThrow(/message_agent/);
    expect(() => checkRestart({ ...a, task: null })).toThrow(/no task/);
    expect(() => checkRestart({ ...a, role: 'ceo' })).toThrow(/That is you/);
  });
});

type Internals = {
  state: { repos: { id: string; autoAssign: boolean }[]; agents: { id: string; name: string; repoId: string; status: string; role: string; task: string | null; lastError: string | null }[] };
  onFinished(a: unknown, repo: unknown, result: { ok: boolean; text: string; costUsd: number; turns: number; errors: string[] }): Promise<void>;
  startIssueWork(repo: unknown): boolean;
  officeTools(): { call(name: string, args: Record<string, unknown>): Promise<string> };
  ensureCeo(interrupted: unknown[]): void;
};

describe('a demo office short of memory', () => {
  it('holds new sessions with the reason shown, and starts them when memory is back', async () => {
    const swarm = new Swarm(createDemoBackend());
    await swarm.connectRepo('demo-co/pixel-todo');
    const x = swarm as unknown as Internals;
    const repo = x.state.repos[0];
    repo.autoAssign = true;
    const busy = () => x.state.agents.filter((a) => a.role !== 'ceo' && a.status === 'preparing').length;
    await swarm.health.simulate(true);
    expect(x.startIssueWork(repo)).toBe(false);
    expect(busy()).toBe(0);
    expect(swarm.snapshot().health?.held).toMatch(/^Waiting for memory: 0\.9 GB free, a build session needs/);
    expect(heldNote(swarm.snapshot().health?.heldWork)).toBe('⏳ 1 task waiting for memory · 0.9 GB free, 3.0 GB needed · the test browser is using 0.6 GB');
    await swarm.health.simulate(false);
    expect(swarm.snapshot().health?.held).toBeNull();
    expect(swarm.snapshot().health?.heldWork).toBeNull();
    if (!busy()) x.startIssueWork(repo); // the release may already have started it
    expect(busy()).toBe(1);
  });
});

describe('a demo office short of memory, with a cloud agent (#263)', () => {
  it('gives the ready issue to the Box agent while local agents wait, and counts nothing as waiting', async () => {
    const swarm = new Swarm(createDemoBackend());
    await swarm.connectRepo('demo-co/pixel-todo');
    const x = swarm as unknown as Internals;
    const repo = x.state.repos[0];
    repo.autoAssign = true;
    swarm.hireAgent(repo.id, { name: 'Radia' });
    const team = x.state.agents.filter((a) => a.role !== 'ceo');
    const box = team.find((a) => a.name === 'Radia')! as (typeof team)[number] & { host?: string };
    box.host = 'box'; // the demo has no Upstash account: what matters here is only where the scheduler thinks they work
    await swarm.health.simulate(true);
    expect(x.startIssueWork(repo)).toBe(true);
    expect(team.filter((a) => a.status === 'preparing').map((a) => a.id)).toEqual([box.id]);
    expect(swarm.snapshot().health?.heldWork).toBeNull();
    expect(x.startIssueWork(repo)).toBe(false); // the local agents still wait
    expect(heldNote(swarm.snapshot().health?.heldWork)).toMatch(/^⏳ 1 task waiting for memory/);
  });
});

describe('an agent whose session was killed', () => {
  it('is never left in an error: it waits to resume, or its work goes back to the queue and they are free', async () => {
    const swarm = new Swarm(createDemoBackend());
    await swarm.connectRepo('demo-co/pixel-todo');
    const x = swarm as unknown as Internals;
    const a = x.state.agents.find((g) => g.role !== 'ceo')!;
    Object.assign(a, { status: 'working', task: 'issue', issueNumber: 1, issueTitle: 'Add dark mode', branch: 'swarm/issue-1-ada', startedAt: Date.now() });
    await x.onFinished(a, x.state.repos[0], { ok: false, text: '', costUsd: 0, turns: 3, errors: ['Claude Code exited with code -1 before finishing.'] });
    expect(a.status).toBe('stopped'); // not 'error'
    expect(a.lastError).toMatch(/^Their session was killed .*goes back to the queue/); // the demo's sessions can't be resumed
    await swarm.health.tick();
    expect(a).toMatchObject({ status: 'idle', task: null });
  });
});

describe('message_agent', () => {
  it('never reaches an agent on another floor than the one named', async () => {
    const swarm = new Swarm(createDemoBackend());
    await swarm.connectRepo('demo-co/pixel-todo');
    await swarm.connectRepo('demo-co/weather-api');
    const x = swarm as unknown as Internals;
    x.ensureCeo([]);
    const onTwo = x.state.agents.find((a) => a.repoId === x.state.repos[1].id)!;
    const tools = x.officeTools();
    expect(await tools.call('message_agent', { floor: 1, agent_id: onTwo.id, text: 'Rerun the flaky test.' })).toBe(`Refused: ${onTwo.name} is not on floor 1: check their floor in company_status.`);
    // On their own floor it goes through to them (with nothing to resume, they say so).
    expect(await tools.call('message_agent', { floor: 2, agent_id: onTwo.id, text: 'Rerun the flaky test.' })).toMatch(/^Refused: .* has no session to continue/);
    expect(await tools.call('restart_agent', { agent_id: onTwo.id })).toMatch(/^Refused: .* has no task to restart/);
  });
});
