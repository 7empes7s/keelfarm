import { afterEach, describe, expect, it, vi } from 'vitest';
import { CEO_ID, type ServerEvent, type VoiceLine } from '../shared/types.ts';
import type { CeoLive } from '../shared/ceoStream.ts';
import { ACKS, TALK_PACE } from '../shared/voiceTalk.ts';
import { managerHeader } from './ceo.ts';
import { CeoTalk } from './ceoTalk.ts';
import { CeoChat } from './ceoChat.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import { DEFAULT_VOICE } from './voice.ts';

// The CEO talking while it works (#286): a manager's message mid-job is acked out loud at once, as a voiceLine event
// (never a chat message), only while the CEO has a voice; its steps become paced progress lines.

type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  schedule(): void;
  broadcast(ev: ServerEvent): void;
  agentRt: Map<string, { session: unknown }>;
  state: { ceo: { queue: { kind: string; at: number }[]; job: { kind: string } | null }; messages: { from: string }[] };
};

let open: Swarm[] = [];
afterEach(() => {
  for (const s of open) s.stopAgent(CEO_ID);
  open = [];
});

/** A demo office with the CEO mid-review, and every voiceLine it sends. */
async function busyOffice(provider: 'off' | 'browser') {
  const swarm = new Swarm(createDemoBackend());
  open.push(swarm);
  await swarm.connectRepo('demo-co/pixel-todo');
  swarm.updateSettings({ voice: { ...DEFAULT_VOICE, provider } });
  const i = swarm as unknown as Internals;
  const lines: VoiceLine[] = [];
  const broadcast = i.broadcast.bind(swarm);
  i.broadcast = (ev) => {
    if (ev.type === 'voiceLine') lines.push(ev.line);
    broadcast(ev);
  };
  i.ensureCeo([]);
  i.state.ceo.queue = [{ kind: 'review', at: Date.now() }];
  i.schedule();
  for (let n = 0; n < 200 && !i.agentRt.get(CEO_ID)?.session; n++) await new Promise((r) => setTimeout(r, 10));
  expect(i.state.ceo.job?.kind).toBe('review');
  return { swarm, i, acks: () => lines.filter((l) => l.kind === 'ack') };
}

describe("the CEO's spoken ack", () => {
  it('comes once for a message that finds the CEO mid-job, with no chat message of its own', async () => {
    const { swarm, i, acks } = await busyOffice('browser');
    const before = i.state.messages.length;
    await swarm.messageCeo('Also check the login page');
    expect(acks()).toHaveLength(1);
    expect(ACKS).toContain(acks()[0].text);
    expect(i.state.messages.length).toBe(before + 1); // only the manager's own message
    await swarm.messageCeo('And the footer'); // moments later: no second ack
    expect(acks()).toHaveLength(1);
  });

  it('never comes while the CEO has no voice', async () => {
    const { swarm, acks } = await busyOffice('off');
    await swarm.messageCeo('Also check the login page');
    expect(acks()).toHaveLength(0);
  });

  it('never comes when the CEO is free', async () => {
    const swarm = new Swarm(createDemoBackend());
    open.push(swarm);
    await swarm.connectRepo('demo-co/pixel-todo');
    swarm.updateSettings({ voice: { ...DEFAULT_VOICE, provider: 'browser' } });
    const i = swarm as unknown as Internals;
    i.ensureCeo([]);
    i.state.ceo.queue = [];
    const lines: ServerEvent[] = [];
    i.broadcast = (ev) => void (ev.type === 'voiceLine' && lines.push(ev));
    await swarm.messageCeo('Hello?');
    expect(lines).toEqual([]);
  });
});

describe('CeoTalk progress', () => {
  const live = (label: string, stepCount: number, icon = '📖'): CeoLive => ({ blocks: [], open: false, steps: [{ label, icon, state: 'running', at: 0 }], stepCount, since: 0 });

  it('sends paced progress lines in a job, and none outside one or without a voice', () => {
    const said: VoiceLine[] = [];
    let on = true;
    const talk = new CeoTalk(() => on, (l) => said.push(l));
    talk.steps(live('Reading a file', 1), 0); // no job yet
    talk.started(0);
    talk.steps(live('Reading a file', 1), TALK_PACE.regularMs - 1);
    expect(said).toEqual([]);
    talk.steps(live("Reading PR #4's changes on floor 2", 2), TALK_PACE.regularMs);
    expect(said.map((l) => [l.kind, l.milestone])).toEqual([['progress', false]]);
    expect(said[0].text).not.toMatch(/[#\d]/);
    talk.steps(live("Waiting for QA's verdict on PR #4 on floor 2", 3, '⏳'), TALK_PACE.regularMs + 1000);
    expect(said.at(-1)).toMatchObject({ milestone: true, text: 'Waiting on QA now.' });
    on = false;
    talk.steps(live('Reading a file', 4), 10 * TALK_PACE.regularMs);
    expect(said).toHaveLength(2);
    on = true;
    talk.ended();
    talk.steps(live('Reading a file', 5), 20 * TALK_PACE.regularMs);
    expect(said).toHaveLength(2);
  });
});

it('keeps offering progress during a quiet long-running step and stops with the job', () => {
  vi.useFakeTimers();
  try {
    const said: VoiceLine[] = [];
    const talk = new CeoTalk(() => true, (line) => said.push(line));
    const chat = new CeoChat('', '', () => undefined, undefined, undefined, undefined, talk);
    chat.startJob();
    chat.log([{ kind: 'tool', tool: 'Read', text: '⏺ Read server/ceo.ts' }]);
    vi.advanceTimersByTime(TALK_PACE.regularMs - 1);
    expect(said).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ kind: 'progress', milestone: false });
    vi.advanceTimersByTime(TALK_PACE.regularMs);
    expect(said).toHaveLength(2);
    chat.endJob();
    vi.advanceTimersByTime(TALK_PACE.regularMs * 2);
    expect(said).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

describe('a message typed into the running session', () => {
  it('asks the CEO, mid-job, to answer at once with reply and carry on', () => {
    expect(managerHeader(true)).toMatch(/answer now with reply in one or two sentences, then carry on/);
    expect(managerHeader(true)).toMatch(/you'll do it next/);
    expect(managerHeader(false)).not.toMatch(/reply in one or two/);
    expect(managerHeader(true).length).toBeLessThan(220); // paid on every message it carries
  });
});
