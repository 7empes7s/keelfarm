// The Researcher (#664): research never runs in the CEO's session; request_research queues and returns at once; the
// brief reaches the manager's chat and comes back to the CEO; the Researcher's tools refuse every write.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhoneMessage } from '../shared/types.ts';
import { CEO_ID } from '../shared/types.ts';
import type { ResearchState } from '../shared/research.ts';
import type { CeoJob, OfficeHandlers } from './ceo.ts';
import { createDemoBackend } from './demo.ts';
import { RESEARCH_NO_FILING, researchReadOnly } from './research.ts';
import { Swarm } from './swarm.ts';
import { researcherTools } from './swarm/researcher.ts';

type Job = NonNullable<ResearchState['job']>;
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  requestResearch(a: { topic: string; floor?: number; questions?: string[]; deadline_min?: number }): string;
  officeHandlers(): OfficeHandlers;
  deliverBrief(job: Job, text: string, o: { costUsd: number; why: string | null; partial: boolean; now: number }): Promise<void>;
  agentRt: Map<string, { session: unknown }>;
  state: { ceo: { queue: CeoJob[]; followups: { pending: { kind: string; text: string }[] } }; research: ResearchState; messages: PhoneMessage[]; repos: { id: string }[] };
};

async function office() {
  const swarm = new Swarm(createDemoBackend());
  await swarm.connectRepo('demo-co/pixel-todo');
  const i = swarm as unknown as Internals;
  i.ensureCeo([]);
  i.state.ceo.queue = [];
  return { swarm, i };
}

const BRIEF = ['I recommend B: it fits the stack.', '```artifact title="Research: Offline mode"', '## Options', '- B: a service worker ([MDN](https://developer.mozilla.org))', '```', '```suggestions', 'Go with B', 'Dig deeper on A', '```'].join('\n');

describe('the Researcher', () => {
  beforeEach(() => vi.useFakeTimers()); // no session starts: only what queued is checked
  afterEach(() => vi.useRealTimers());

  it('takes the manager\'s "Research: …" and Plan → Research first; the CEO never gets a research job', async () => {
    const { swarm, i } = await office();
    await swarm.messageCeo('Research: offline mode for the todo app');
    swarm.planFloor(i.state.repos[0].id, 'A cozy todo app', true);
    expect(i.state.ceo.queue.filter((j) => j.kind === 'research')).toEqual([]);
    expect(i.state.research.queue.map((r) => [r.topic, r.by])).toEqual([
      ['offline mode for the todo app', 'manager'],
      ['A cozy todo app', 'manager'],
    ]);
    expect(i.agentRt.get(CEO_ID)?.session ?? null).toBeNull();
    expect(i.state.messages.at(-1)?.text).toMatch(/stays free to chat/);
  });

  it('queues request_research and returns at once with its number', async () => {
    const { i } = await office();
    const out = i.requestResearch({ topic: 'How do todo apps sync offline?', floor: 1, questions: ['Which libraries?'], deadline_min: 15 });
    expect(out).toMatch(/^Queued research #1 .*starting now, up to 15 min.*research_done/);
    expect(i.state.research.queue).toMatchObject([{ id: 1, topic: 'How do todo apps sync offline?', by: 'ceo', minutes: 15, questions: ['Which libraries?'], repoId: i.state.repos[0].id }]);
    expect(i.state.ceo.queue).toEqual([]);
    expect(() => i.requestResearch({ topic: 'x', floor: 9 })).toThrow(/floor 9/i);
  });

  it("brings the brief to the manager's chat, as a file, and back to the CEO as a plan job for its floor", async () => {
    const { i } = await office();
    const repoId = i.state.repos[0].id;
    const job: Job = { id: 4, topic: 'Offline mode', repoId, by: 'ceo', minutes: 20, at: 0, startedAt: Date.now() - 12 * 60_000 };
    i.state.research.job = job;
    await i.deliverBrief(job, BRIEF, { costUsd: 0.42, why: null, partial: false, now: Date.now() });
    const m = i.state.messages.at(-1)!;
    expect(m.from).toBe('ceo');
    expect(m.text).toMatch(/Sage's research on "Offline mode" · 12 min · \$0\.42/);
    expect(m.research).toEqual({ topic: 'Offline mode', repoId });
    expect(m.artifacts?.[0].title).toBe('Research: Offline mode');
    expect(m.suggestions).toEqual(['Go with B', 'Dig deeper on A']);
    const done = i.state.research.done.at(-1)!;
    expect(done).toMatchObject({ id: 4, partial: false, costUsd: 0.42 });
    expect(done.file).toMatch(/research[\\/]\d+\.md$/);
    expect(i.state.research.job).toBeNull();
    expect(i.state.ceo.queue).toEqual([expect.objectContaining({ kind: 'plan', repoId, brief: done.file })]);
  });

  it('brings research not tied to a floor back as a follow-up, and a stopped job as a partial brief', async () => {
    const { i } = await office();
    const job: Job = { id: 5, topic: 'Pricing pages', by: 'ceo', minutes: 20, at: 0, startedAt: Date.now() };
    i.state.research.job = job;
    await i.deliverBrief(job, 'Found two patterns so far.', { costUsd: 0.1, why: 'the manager stopped it', partial: true, now: Date.now() });
    expect(i.state.messages.at(-1)?.text).toMatch(/stopped early \(the manager stopped it\): a partial brief\n\nFound two patterns so far\./);
    expect(i.state.ceo.followups.pending).toEqual([expect.objectContaining({ kind: 'research', text: expect.stringMatching(/request_research #5 "Pricing pages" \(a partial brief\)/) })]);
    expect(i.state.ceo.queue).toEqual([]);
  });

  it('never drops a job that wrote nothing: the manager still hears', async () => {
    const { i } = await office();
    const job: Job = { id: 6, topic: 'Nothing', by: 'manager', minutes: 5, at: 0, startedAt: Date.now() };
    i.state.research.job = job;
    await i.deliverBrief(job, '', { costUsd: 0, why: 'the research ran past its 5-minute budget', partial: true, now: Date.now() });
    expect(i.state.messages.at(-1)?.text).toMatch(/partial brief\n\nNothing written yet/);
  });

  it('offers only read-only office tools, and refuses writes all the same', async () => {
    const { i } = await office();
    const h = i.officeHandlers();
    const tools = researcherTools(h);
    const names = tools.defs.map((d) => d.name).sort();
    expect(names).toEqual(['agent_detail', 'agent_log', 'company_status', 'floor_detail', 'pr_diff', 'problems', 'qa_report', 'session_history', 'worktree_file']);
    await expect(tools.call('file_issue', { floor: 1, title: 't', body: 'b' })).rejects.toThrow(/No office tool/);
    expect(await tools.call('company_status', {})).toMatch(/floors/);
  });

  it('refuses file_issue with the no-filing rule when reached anyway', async () => {
    const { i } = await office();
    const h = researchReadOnly(i.officeHandlers(), () => true);
    expect(() => h.fileIssue({ floor: 1, title: 't', body: 'b' } as never)).toThrow(RESEARCH_NO_FILING);
    expect(() => h.requestResearch({ topic: 'more' })).toThrow(/only reads/);
  });
});
