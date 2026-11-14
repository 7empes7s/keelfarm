import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneMessage } from '../shared/types.ts';
import type { SessionHandle } from './agentRunner.ts';
import { ceoJobPrompt, jobLabel, nextCeoJob, queueCeoJob, type CeoJob } from './ceo.ts';
import { guideItems } from '../client/src/ui/guide.ts';
import { clampResearchMin, pastResearch, ResearchGuard, researchHandoff, researchJob, researchPrompt, researchRef, researchWrapUp } from './research.ts';

const floor = { floor: 2, fullName: 'acme/shop', clone: '/clones/acme/shop/main', mission: 'Sell socks', backlog: 5 };

describe('research prompt', () => {
  it('names the topic, the floor, the time budget, sources and the no-filing rule', () => {
    const p = ceoJobPrompt({ kind: 'research', repoId: 'r1', topic: 'Gift wrapping at checkout', at: 0 }, floor, null, [], 25);
    expect(p).toContain('"Gift wrapping at checkout"');
    expect(p).toContain('floor 2 (acme/shop, clone at /clones/acme/shop/main)');
    expect(p).toContain('about 25 minutes');
    expect(p).toMatch(/WebSearch and WebFetch/);
    expect(p).toMatch(/Notion, Drive\/Docs, Gmail, Figma\): read only/);
    expect(p).toMatch(/File nothing/);
    expect(p).toContain('```artifact title="Research: Gift wrapping at checkout"');
    expect(p).toContain('```suggestions');
    expect(p).toMatch(/question for the manager/);
  });

  it('relates research without a floor to the floors in company_status', () => {
    expect(researchPrompt('Voice notes', null, 20)).toMatch(/not tied to a floor/);
  });

  it('tells the CEO to wrap up when the budget runs out', () => {
    expect(researchWrapUp('Voice notes', 20)).toMatch(/Time is up .*"Voice notes" \(20 minutes\)/);
    expect(clampResearchMin(0)).toBe(20);
    expect(clampResearchMin(2)).toBe(5);
    expect(clampResearchMin(500)).toBe(120);
  });

  it('labels the job for the presence line', () => {
    expect(jobLabel({ kind: 'research', topic: 'Voice notes', at: 0 }, null)).toBe('Researching "Voice notes"');
  });

  it('asks plan jobs to hand web research to the Researcher, and to cite the brief it brings back (#664)', () => {
    expect(ceoJobPrompt({ kind: 'plan', repoId: 'r1', at: 0 }, floor)).toMatch(/request_research \(floor 2\) and end this job.*Never search the web yourself/);
    expect(ceoJobPrompt({ kind: 'plan', repoId: 'r1', brief: '/ceo/research/9.md', at: 0 }, floor)).toContain("The Researcher's brief you asked for: /ceo/research/9.md. Read it first and cite it in the issues.");
  });
});

describe('research queue', () => {
  it('queues research per topic and merges a repeat of the same one', () => {
    const q: CeoJob[] = [];
    queueCeoJob(q, { kind: 'research', topic: 'A', messageIds: [1], at: 0 });
    queueCeoJob(q, { kind: 'research', topic: 'B', messageIds: [2], at: 1 });
    queueCeoJob(q, { kind: 'research', topic: 'A', messageIds: [3], at: 2 });
    expect(q.map((j) => [j.topic, j.messageIds])).toEqual([
      ['A', [1, 3]],
      ['B', [2]],
    ]);
  });

  it('keeps one plan per floor and merges chat messages as before', () => {
    const q: CeoJob[] = [];
    queueCeoJob(q, { kind: 'plan', repoId: 'r1', at: 0 });
    queueCeoJob(q, { kind: 'plan', repoId: 'r1', at: 1 });
    queueCeoJob(q, { kind: 'chat', text: 'hi', messageIds: [1], at: 0 });
    queueCeoJob(q, { kind: 'chat', text: 'there', messageIds: [2], at: 1 });
    expect(q).toEqual([
      { kind: 'plan', repoId: 'r1', at: 1 },
      { kind: 'chat', text: 'hi\nthere', messageIds: [1, 2], at: 0 },
    ]);
  });
});

describe('the next CEO job', () => {
  it('starts research like a plan: after replies and triage, before reviews', () => {
    const q: CeoJob[] = [
      { kind: 'review', at: 0 },
      { kind: 'research', topic: 'A', at: 1 },
      { kind: 'chat', text: 'hi', at: 2 },
    ];
    expect(nextCeoJob(q, () => true)?.kind).toBe('chat');
    expect(nextCeoJob(q.slice(0, 2), () => true)?.kind).toBe('research');
    expect(nextCeoJob(q.slice(0, 2), (j) => j.kind !== 'research')?.kind).toBe('review');
  });
});

describe('research handoff', () => {
  const forward = 'Replying to your message: «I recommend B»\nGo with B';

  it("turns a pick into a plan job for the research's floor, with the brief", () => {
    const job = researchHandoff({ topic: 'Gift wrapping', repoId: 'r1' }, 'Go with B', forward, '/ceo/research/7.md', [9], 5);
    expect(job).toEqual({ kind: 'plan', repoId: 'r1', topic: 'Gift wrapping', pick: 'Go with B', brief: '/ceo/research/7.md', messageIds: [9], at: 5 });
    const p = ceoJobPrompt(job, { ...floor, mission: '' });
    expect(p).toContain('"""Gift wrapping"""');
    expect(p).toContain('They picked from your research on it: "Go with B". Your research brief: /ceo/research/7.md');
  });

  it('researches again for "dig deeper"', () => {
    expect(researchHandoff({ topic: 'Gift wrapping', repoId: 'r1' }, 'Dig deeper on C', forward, null, [9], 5)).toEqual({ kind: 'research', topic: 'Gift wrapping · Dig deeper on C', repoId: 'r1', messageIds: [9], at: 5 });
  });

  it('asks the CEO to plan on the floor it fits when the research had none', () => {
    const job = researchHandoff({ topic: 'Gift wrapping' }, 'Plan A and B', forward, '/ceo/research/7.md', [9], 5);
    expect(job.kind).toBe('chat');
    expect(job.text).toContain(forward);
    expect(job.text).toMatch(/research on "Gift wrapping".*\/ceo\/research\/7\.md.*file the issues/s);
  });
});

describe('research from the chat', () => {
  const base = { forward: 'f', id: 9, dir: '' };

  it('starts research for "Research: <topic>" only', async () => {
    expect(await researchJob({ ...base, text: 'Research: voice notes' })).toMatchObject({ kind: 'research', topic: 'voice notes', messageIds: [9] });
    expect(await researchJob({ ...base, text: 'How is it going?' })).toBeNull();
  });

  it('a reply to a queued or running research card is ordinary chat, not a plan from a brief (#679)', async () => {
    const quoted = { id: 3, from: 'office' as const, text: 'running', at: 1, research: { topic: 'X', job: 1, state: 'running' as const } };
    expect(await researchJob({ ...base, text: 'also look at Y', quoted })).toBeNull();
    expect(await researchJob({ ...base, text: 'also look at Y', quoted: { ...quoted, research: { ...quoted.research, state: 'queued' as const } } })).toBeNull();
  });

  it('saves the research brief and plans the pick on the only floor', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-'));
    const quoted: PhoneMessage = { id: 7, from: 'ceo', text: 'I recommend B', at: 0, research: { topic: 'Voice notes' }, artifacts: [{ id: '7-0', title: 'Research: Voice notes', lead: 'Q', markdown: '## Question' }] };
    const job = await researchJob({ ...base, dir, text: 'Go with B', quoted, onlyRepo: 'r1' });
    expect(job).toMatchObject({ kind: 'plan', repoId: 'r1', pick: 'Go with B', brief: path.join(dir, '7.md') });
    expect(await fs.readFile(path.join(dir, '7.md'), 'utf8')).toBe('# Research: Voice notes\n\n## Question');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('tags the CEO replies of a research job only', () => {
    expect(researchRef({ kind: 'research', topic: 'A', repoId: 'r1', at: 0 })).toEqual({ research: { topic: 'A', repoId: 'r1' } });
    expect(researchRef({ kind: 'chat', at: 0 })).toEqual({});
    expect(researchRef(null)).toEqual({});
  });
});

describe('research time budget', () => {
  afterEach(() => vi.useRealTimers());

  it('asks the CEO to wrap up at the budget and stops the session 5 minutes later', () => {
    vi.useFakeTimers();
    const session = { send: vi.fn(), stop: vi.fn() } as unknown as SessionHandle;
    const stopping = vi.fn();
    const guard = new ResearchGuard();
    guard.start(20, 'Voice notes', () => session, stopping);
    vi.advanceTimersByTime(20 * 60_000);
    expect(session.send).toHaveBeenCalledWith(researchWrapUp('Voice notes', 20));
    expect(session.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5 * 60_000);
    expect(stopping).toHaveBeenCalledWith(expect.stringMatching(/20-minute budget/));
    expect(session.stop).toHaveBeenCalled();
  });

  it('does nothing once the job has ended', () => {
    vi.useFakeTimers();
    const session = { send: vi.fn(), stop: vi.fn() } as unknown as SessionHandle;
    const guard = new ResearchGuard();
    guard.start(20, 'Voice notes', () => session, vi.fn());
    guard.clear();
    vi.advanceTimersByTime(30 * 60_000);
    expect(session.send).not.toHaveBeenCalled();
    expect(session.stop).not.toHaveBeenCalled();
  });
});

describe('research for the guide (#496)', () => {
  it("the guide's Do it starts a research job", async () => {
    const office = { repos: [], settings: { notify: { channels: {} }, ceoMandates: [] }, notifyChannels: { pushDevices: 0, webhooks: { ntfy: { set: false } }, telegram: { linked: false } }, experiments: { experiments: [] }, ceo: { job: null, queue: [], researchedAt: null }, installed: false } as unknown as Parameters<typeof guideItems>[0];
    const target = guideItems(office).find((i) => i.id === 'research')!.target;
    const text = target.kind === 'ceo' ? (target.text ?? '') : '';
    const job = await researchJob({ text, forward: text, id: 7, dir: os.tmpdir() });
    expect(job).toMatchObject({ kind: 'research', messageIds: [7] });
    expect(job?.topic).toMatch(/^how comparable projects/);
  });

  it('backfills the latest research from the jobs log, kept jobs and research replies', () => {
    const none = { history: [], jobs: [], messages: [] };
    expect(pastResearch(none)).toBeUndefined();
    expect(pastResearch({ ...none, history: [{ at: 4, ceo: { kind: 'chat' } as never }], jobs: [{ at: 5, kind: 'plan' }], messages: [{ at: 6 }] })).toBeUndefined();
    expect(pastResearch({ history: [{ at: 4, ceo: { kind: 'research' } as never }], jobs: [{ at: 9, kind: 'research' }], messages: [{ at: 6, research: { topic: 'x' } }] })).toBe(9);
    expect(pastResearch({ ...none, messages: [{ at: 6, research: { topic: 'x' } }] })).toBe(6);
    expect(pastResearch({ ...none, messages: [{ at: 6, research: { topic: 'x', job: 1, state: 'queued' } }] })).toBeUndefined(); // still going (#679)
  });
});
