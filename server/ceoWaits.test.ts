import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anyMet, ceoSessionStep, NO_ANSWER, routeReply, waitMet, waitMs, waitProblem, type CeoQuestion, type WaitWorld } from './ceoWaits.ts';
import { CeoHolds } from './ceoHold.ts';
import { ceoAwakeSettings, DEFAULT_CEO_AWAKE } from '../shared/ceoAwake.ts';

const world = (o: Partial<WaitWorld> = {}): WaitWorld => ({
  floors: [1],
  qa: () => ({ status: 'testing', summary: null }),
  pr: () => 'OPEN',
  issue: () => 'OPEN',
  agent: (id) => (id === 'ada' ? { name: 'Ada', status: 'working' } : null),
  preview: () => 'starting',
  usage: () => 'pacing',
  ...o,
});

describe('wait conditions', () => {
  it('holds once the thing waited for happened', () => {
    expect(waitMet({ kind: 'pr_merged', floor: 1, pr: 7 }, world())).toBeNull();
    expect(waitMet({ kind: 'pr_merged', floor: 1, pr: 7 }, world({ pr: () => 'MERGED' }))).toBe('PR #7 on floor 1 merged.');
    expect(waitMet({ kind: 'pr_merged', floor: 1, pr: 7 }, world({ pr: () => 'CLOSED' }))).toMatch(/closed without merging/);
    expect(waitMet({ kind: 'pr_qa', floor: 1, pr: 7 }, world())).toBeNull();
    expect(waitMet({ kind: 'pr_qa', floor: 1, pr: 7 }, world({ qa: () => ({ status: 'failed', summary: 'The build breaks' }) }))).toBe('PR #7 on floor 1: QA failed: The build breaks');
    expect(waitMet({ kind: 'pr_qa', floor: 1, pr: 7 }, world({ qa: () => ({ status: 'fixing', summary: null }) }))).toBe('PR #7 on floor 1: QA failed (being fixed)');
    expect(waitMet({ kind: 'issue_closed', floor: 1, issue: 3 }, world({ issue: () => 'CLOSED' }))).toMatch(/#3 on floor 1 is closed/);
    expect(waitMet({ kind: 'agent_idle', agent_id: 'ada' }, world())).toBeNull();
    expect(waitMet({ kind: 'agent_idle', agent_id: 'ada' }, world({ agent: () => ({ name: 'Ada', status: 'done' }) }))).toBe('Ada is free.');
    expect(waitMet({ kind: 'preview_running', floor: 1 }, world({ preview: () => 'running' }))).toMatch(/is running/);
    expect(waitMet({ kind: 'usage', usage: 'normal' }, world())).toBeNull();
    expect(waitMet({ kind: 'usage' }, world({ usage: () => 'normal' }))).toMatch(/normal/);
  });

  it('returns when any of several holds', () => {
    const cs = [{ kind: 'pr_merged' as const, floor: 1, pr: 7 }, { kind: 'usage' as const, usage: 'pacing' as const }];
    expect(anyMet(cs, world())).toMatch(/usage is pacing/);
    expect(anyMet(cs.slice(0, 1), world())).toBeNull();
  });

  it('refuses what there is nothing to wait for', () => {
    expect(waitProblem({ kind: 'pr_merged', floor: 2, pr: 7 }, world())).toBe('There is no floor 2.');
    expect(waitProblem({ kind: 'pr_merged', floor: 1 }, world())).toBe('pr_merged needs pr.');
    expect(waitProblem({ kind: 'pr_qa', floor: 1, pr: 9 }, world({ pr: () => null }))).toMatch(/no PR #9/);
    expect(waitProblem({ kind: 'agent_idle', agent_id: 'bob' }, world())).toMatch(/no agent bob/);
    expect(waitProblem({ kind: 'issue_closed', floor: 1, issue: 3 }, world())).toBeNull();
  });

  it('times out after 10 minutes by default, never past the setting', () => {
    expect(waitMs(undefined, 30)).toBe(10 * 60_000);
    expect(waitMs(45, 30)).toBe(30 * 60_000);
    expect(waitMs(undefined, 5)).toBe(5 * 60_000);
  });
});

describe('CeoHolds', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves a wait when its condition comes true, and shows what it waits on meanwhile', async () => {
    let merged = false;
    const holds = new CeoHolds(() => undefined, 1000);
    const p = holds.wait('PR #7 to merge', () => (merged ? 'merged' : null), 60_000);
    expect(holds.waiting()).toBe('PR #7 to merge');
    merged = true;
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe('merged');
    expect(holds.waiting()).toBeNull();
  });

  it('times out, and cancels everything when the office drains', async () => {
    const holds = new CeoHolds(() => undefined);
    const late = holds.wait('x', () => null, 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(late).resolves.toMatch(/^Timed out after 1 min/);
    const a = holds.wait('y', () => null, 60_000);
    const q = holds.ask({ id: 'q1', messageId: 5, text: 'Ship?', at: 0, waiting: true }, 60_000);
    holds.cancel('Cancelled: update');
    await expect(Promise.all([a, q])).resolves.toEqual(['Cancelled: update', 'Cancelled: update']);
  });

  it('hands the manager reply to the waiting question; after a timeout it resumes as a new job', async () => {
    const holds = new CeoHolds(() => undefined);
    const q = holds.ask({ id: 'q1', messageId: 5, text: 'Ship?', at: 0, waiting: true }, 60_000);
    expect(holds.answer(5, 'yes')).toMatchObject({ resume: false });
    await expect(q).resolves.toBe('The manager answered: yes');
    const q2 = holds.ask({ id: 'q2', messageId: 8, text: 'Again?', at: 1, waiting: true }, 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(q2).resolves.toBe(NO_ANSWER);
    expect(holds.answer(8, 'yes now')).toMatchObject({ resume: true, to: { id: 'q2' } });
  });
});

describe('routeReply (ask_manager)', () => {
  const qs: CeoQuestion[] = [
    { id: 'a', messageId: 3, text: 'A?', at: 1, waiting: true },
    { id: 'b', messageId: 4, text: 'B?', at: 2, waiting: true },
    { id: 'c', messageId: 6, text: 'C?', at: 0, waiting: false },
  ];
  it('matches replyTo first, then the oldest waiting question', () => {
    expect(routeReply(qs, 4)?.to.id).toBe('b');
    expect(routeReply(qs, undefined)?.to.id).toBe('a');
    expect(routeReply(qs, 6)).toEqual({ to: qs[2], resume: true });
    expect(routeReply(qs, 99)).toBeNull();
    expect(routeReply([qs[2]], undefined)).toBeNull();
  });
});

describe('the kept session', () => {
  const s = ceoAwakeSettings(undefined, { restartTurns: 100, idleHours: 2 });
  it('carries on until its context fills or it sits idle, and not at all with keep-alive off', () => {
    expect(ceoSessionStep(s, { sessionId: 'x', turns: 10, lastEndedAt: 0 }, 3_600_000)).toEqual({ resume: true, why: null });
    expect(ceoSessionStep(s, { sessionId: 'x', turns: 100, lastEndedAt: 0 }, 1)).toMatchObject({ resume: false, handover: true }); // a full session hands over (#330)
    expect(ceoSessionStep(s, { sessionId: 'x', turns: 1, lastEndedAt: 1 }, 2 * 3_600_000 + 1).why).toMatch(/idle/);
    expect(ceoSessionStep({ ...s, keepAlive: false }, { sessionId: 'x', turns: 1, lastEndedAt: 0 }, 1)).toEqual({ resume: false, why: null });
    expect(ceoSessionStep(s, { sessionId: null, turns: 0, lastEndedAt: null }, 1).resume).toBe(false);
  });

  it('keeps the settings in range', () => {
    expect(ceoAwakeSettings(DEFAULT_CEO_AWAKE, { maxWaitMin: 90, consultMax: 0, keepAlive: 'yes' })).toMatchObject({ maxWaitMin: 30, consultMax: 1, keepAlive: true });
  });
});
