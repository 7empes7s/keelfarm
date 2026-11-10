import { describe, expect, it } from 'vitest';
import { queueCeoJob, type CeoJob } from './ceo.ts';
import { ceoJobSession } from './ceoDigest.ts';
import { jobTrigger, keepJob, KEEP_JOBS, redoJob, type CeoJobRecord } from './ceoRedo.ts';
import type { FollowupEvent } from '../shared/followups.ts';

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5';
const ev = (id: string, label: string): FollowupEvent => ({ id, kind: 'stalled', key: `k-${id}`, label, text: `${label} on floor 1`, at: 1 });
const rec = (id: number, inputs: CeoJob, over: Partial<CeoJobRecord> = {}): CeoJobRecord => ({ id, kind: inputs.kind, model: SONNET, at: 10, usd: 0.3, message: 40, inputs, ...over });

describe('Redo on Opus (#332)', () => {
  it('reuses the first job’s inputs, on the CEO model, in a fresh session, linked to it', () => {
    const events = [ev('e1', 'Ada stalled'), ev('e2', '#9 merged')];
    const list = keepJob([], rec(7, { kind: 'followup', events, id: 7, at: 5 }));
    const r = redoJob(list, 7, OPUS, 99);
    if (!('job' in r)) throw new Error(r.error);
    expect(r.job).toEqual({ kind: 'followup', events, onCeoModel: true, redo: { job: 7, message: 40 }, at: 99 });
    expect(ceoJobSession(r.job.kind, { freshJobs: false }, { resume: true, why: null }, !!r.job.redo)).toEqual({ fresh: true, resume: false, why: null }); // fresh, even with fresh jobs off
    expect(ceoJobSession('followup', { freshJobs: false }, { resume: true, why: null })).toMatchObject({ fresh: false });
    const triage = redoJob([rec(3, { kind: 'triage', repoId: 'r1', prNumber: 12, at: 1 })], 3, OPUS, 5);
    expect('job' in triage && triage.job).toMatchObject({ kind: 'triage', repoId: 'r1', prNumber: 12, onCeoModel: true });
  });

  it('refuses chat, plans, research, a job on the CEO model, a second redo and a forgotten job', () => {
    const list = [rec(1, { kind: 'chat', text: 'hi', at: 1 }), rec(2, { kind: 'research', topic: 'x', at: 1 }), rec(3, { kind: 'review', at: 1 }, { model: OPUS }), rec(4, { kind: 'review', at: 1 }, { redoneBy: 5 })];
    for (const id of [1, 2, 3, 4]) expect(redoJob(list, id, OPUS, 9)).toMatchObject({ status: 400 });
    expect(redoJob(list, 1, OPUS, 9)).toMatchObject({ error: expect.stringMatching(/chat, plans and research already run on the CEO model/) });
    expect(redoJob(list, 42, OPUS, 9)).toMatchObject({ status: 404 });
  });

  it('keeps the latest jobs, a chat without its text', () => {
    let list: CeoJobRecord[] = [];
    for (let i = 1; i <= KEEP_JOBS + 3; i++) list = keepJob(list, rec(i, { kind: 'review', at: i }));
    expect(list).toHaveLength(KEEP_JOBS);
    expect(list[0].id).toBe(4);
    expect(keepJob([], rec(1, { kind: 'chat', text: 'secret plans', messageIds: [3], at: 1 }))[0].inputs).toEqual({ kind: 'chat', at: 1 });
  });

  it('never merges a redo into a queued job of its kind', () => {
    const q: CeoJob[] = [{ kind: 'followup', events: [ev('e3', 'later')], at: 1 }];
    queueCeoJob(q, { kind: 'followup', events: [ev('e1', 'first')], redo: { job: 7, message: 40 }, onCeoModel: true, at: 2 });
    queueCeoJob(q, { kind: 'followup', events: [ev('e4', 'more')], at: 3 });
    expect(q.map((j) => [j.redo?.job ?? null, j.events?.map((e) => e.id)])).toEqual([[null, ['e3', 'e4']], [7, ['e1']]]);
  });

  it('says what started a job', () => {
    expect(jobTrigger({ kind: 'review', at: 1 })).toBe('Schedule');
    expect(jobTrigger({ kind: 'review', by: 'manager', at: 1 })).toBe('You asked (Review now)');
    expect(jobTrigger({ kind: 'followup', events: [ev('e1', 'Ada stalled'), ev('e2', '#9 merged')], at: 1 })).toBe('Events e1, e2: Ada stalled, #9 merged');
    expect(jobTrigger({ kind: 'triage', prNumber: 12, at: 1 })).toBe('PR #12 stuck');
    expect(jobTrigger({ kind: 'chat', messageIds: [3, 4], at: 1 })).toBe('Your messages #3, #4');
    expect(jobTrigger({ kind: 'followup', events: [], redo: { job: 7, message: null }, at: 1 })).toBe('Redo of job #7');
  });
});
