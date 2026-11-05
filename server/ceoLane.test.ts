import { afterEach, describe, expect, it } from 'vitest';
import { CEO_ID, type CeoInfo } from '../shared/types.ts';
import { heldBanner } from '../shared/chat.ts';
import { ceoHeld, ceoStep, messageGoesIn, type CeoLaneInput } from './ceoLane.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// The CEO is always responsive (#46): the manager's chat starts a turn through a drain, full slots and a background
// job. Only Claude's usage limit holds it, and then the phone says why and until when.

const NOW = 1_000_000;
const free: CeoLaneInput = { now: NOW, pausedUntil: 0, draining: false, handingOver: false, busy: false, job: null, session: false, chatQueued: true };

describe('ceoStep', () => {
  it('starts any job when nothing holds the CEO', () => {
    expect(ceoStep(free)).toEqual({ do: 'start', only: 'any' });
  });

  it('starts only chat while the office drains for its update, and nothing once it is handed over', () => {
    expect(ceoStep({ ...free, draining: true })).toEqual({ do: 'start', only: 'chat' });
    expect(ceoStep({ ...free, draining: true, handingOver: true })).toEqual({ do: 'wait' });
  });

  it('waits under the usage limit', () => {
    expect(ceoStep({ ...free, pausedUntil: NOW + 60_000 })).toEqual({ do: 'wait' });
  });

  it('preempts a background job for a queued chat, but never a chat, and not under the limit', () => {
    const working = { ...free, busy: true, session: true };
    for (const job of ['review', 'plan', 'onboard', 'triage', 'followup'] as const) expect(ceoStep({ ...working, job })).toEqual({ do: 'preempt' });
    expect(ceoStep({ ...working, job: 'chat' })).toEqual({ do: 'wait' });
    expect(ceoStep({ ...working, job: 'review', chatQueued: false })).toEqual({ do: 'wait' });
    expect(ceoStep({ ...working, job: 'review', pausedUntil: NOW + 1 })).toEqual({ do: 'wait' });
    expect(ceoStep({ ...working, job: 'review', session: false })).toEqual({ do: 'wait' }); // nothing to stop yet
  });
});

describe('ceoHeld and messageGoesIn', () => {
  it('holds a queued chat only under the usage limit, with its reset time', () => {
    expect(ceoHeld({ now: NOW, pausedUntil: NOW + 5000, chatQueued: true })).toEqual({ reason: 'usage', until: NOW + 5000 });
    expect(ceoHeld({ now: NOW, pausedUntil: NOW + 5000, chatQueued: false })).toBeNull();
    expect(ceoHeld({ now: NOW, pausedUntil: NOW - 1, chatQueued: true })).toBeNull();
  });

  it("sends a message into a chat session, and queues it beside a background job unless the limit is on", () => {
    expect(messageGoesIn({ now: NOW, pausedUntil: 0, job: 'chat', session: true })).toBe(true);
    expect(messageGoesIn({ now: NOW, pausedUntil: 0, job: 'review', session: true })).toBe(false);
    expect(messageGoesIn({ now: NOW, pausedUntil: NOW + 1, job: 'review', session: true })).toBe(true);
    expect(messageGoesIn({ now: NOW, pausedUntil: 0, job: null, session: false })).toBe(false);
  });

  it('words the banner with the reset time', () => {
    const until = new Date(2026, 10, 5, 3, 10).getTime();
    const at = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(heldBanner({ reason: 'usage', until })).toBe(`Usage limit: resumes ${at}. Your message waits until then.`);
  });
});

// ---------- in a demo office: schedule() with each gate on ----------

type Job = { kind: string; text?: string; messageIds?: number[]; at: number; repoId?: string };
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  schedule(): void;
  pausedUntil: number;
  officeHead: string | null;
  officeUpdate: { behind: number; drainingSince: number | null };
  agentRt: Map<string, { session: unknown }>;
  state: { ceo: { queue: Job[]; job: Job | null }; agents: { id: string; role: string; status: string }[]; settings: { sessionLimit: number } };
};

let open: Swarm[] = [];
afterEach(() => {
  for (const s of open) s.stopAgent(CEO_ID);
  open = [];
});

async function office(launcher = false) {
  const backend = createDemoBackend();
  backend.office = { ...backend.office, launcher };
  const swarm = new Swarm(backend);
  open.push(swarm);
  await swarm.connectRepo('demo-co/pixel-todo');
  const i = swarm as unknown as Internals;
  i.ensureCeo([]);
  i.state.ceo.queue = [];
  const worker = i.state.agents.find((a) => a.role !== 'ceo')!;
  return { swarm, i, worker, ceo: () => i.state.agents.find((a) => a.id === CEO_ID)! };
}
const chat = (text: string): Job => ({ kind: 'chat', text, messageIds: [], at: Date.now() });

describe('a manager message starts a CEO turn within one schedule() tick', () => {
  it('while the office drains for its update, starting no other work', async () => {
    const { swarm, i, worker } = await office(true);
    worker.status = 'working'; // the drain waits for this session
    i.officeHead = 'abc1234';
    i.officeUpdate.behind = 2;
    i.state.ceo.queue = [{ kind: 'review', at: Date.now() }, chat('Hello?')];
    i.schedule();
    expect(i.officeUpdate.drainingSince).not.toBeNull();
    expect(i.state.ceo.job?.kind).toBe('chat');
    expect(i.state.ceo.queue.map((j) => j.kind)).toEqual(['review']); // background jobs wait for the restart
    expect(swarm.snapshot().agents.filter((a) => a.role !== 'ceo' && a.status === 'preparing')).toEqual([]);
  });

  it('when every session slot is busy', async () => {
    const { i, worker } = await office();
    i.state.settings.sessionLimit = 1;
    worker.status = 'working';
    i.state.ceo.queue = [chat('Status?')];
    i.schedule();
    expect(i.state.ceo.job?.kind).toBe('chat');
  });

  it('when a background job runs: it goes back to the queue', async () => {
    const { swarm, i, ceo } = await office();
    i.state.ceo.queue = [{ kind: 'review', at: Date.now() }];
    i.schedule();
    expect(i.state.ceo.job?.kind).toBe('review');
    for (let n = 0; n < 200 && !i.agentRt.get(CEO_ID)?.session; n++) await new Promise((r) => setTimeout(r, 10));
    expect(i.agentRt.get(CEO_ID)?.session).toBeTruthy();
    await swarm.messageCeo('File the 3 cleanups');
    i.schedule();
    expect(i.state.ceo.job?.kind).toBe('chat');
    expect(i.state.ceo.queue.map((j) => j.kind)).toEqual(['review']);
    expect(ceo().status).toBe('working');
  });

  it('but not under the usage limit: the phone gets why, and when it resets', async () => {
    const { swarm, i } = await office();
    const until = Date.now() + 3_600_000;
    i.pausedUntil = until;
    await swarm.messageCeo('Hello?');
    i.schedule();
    expect(i.state.ceo.job).toBeNull();
    const info: CeoInfo = swarm.snapshot().ceo;
    expect(info.held).toEqual({ reason: 'usage', until });
    expect(swarm.snapshot().agents.filter((a) => a.role !== 'ceo' && a.status === 'preparing')).toEqual([]);
  });
});
