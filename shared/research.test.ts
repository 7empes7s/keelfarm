import { describe, expect, it } from 'vitest';
import { emptyResearch, finishResearch, loadResearch, nextResearch, queueResearch, RESEARCH_QUEUE_MAX, researcherView, researchLine, researchStatus, type ResearchBrief } from './research.ts';

const ask = (topic: string, by: 'manager' | 'ceo' = 'manager', messageIds?: number[]) => ({ topic, by, minutes: 20, at: 0, ...(messageIds && { messageIds }) });
const brief = (id: number, o: Partial<ResearchBrief> = {}): ResearchBrief => ({ id, topic: 'A', by: 'ceo', file: '/b.md', summary: 'S', minutes: 3, costUsd: 0.5, partial: false, at: 9, ...o });

describe("the Researcher's queue", () => {
  it('runs one job at a time, in order', () => {
    const s = emptyResearch();
    expect(queueResearch(s, ask('A')).ahead).toBe(0);
    expect(queueResearch(s, ask('B')).ahead).toBe(1);
    expect(nextResearch(s, 100)).toMatchObject({ id: 1, topic: 'A', startedAt: 100 });
    expect(nextResearch(s, 200)).toBeNull(); // the desk is busy
    expect(queueResearch(s, ask('C')).ahead).toBe(2);
    finishResearch(s, brief(1));
    expect(nextResearch(s, 300)?.topic).toBe('B');
  });

  it('joins a repeat of a topic running or waiting, keeping the manager as asker', () => {
    const s = emptyResearch();
    queueResearch(s, ask('Voice notes', 'ceo'));
    const again = queueResearch(s, ask('voice notes ', 'manager', [7]));
    expect(again.joined).toBe(true);
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0]).toMatchObject({ by: 'manager', messageIds: [7] });
    nextResearch(s, 0);
    expect(queueResearch(s, ask('Voice notes', 'ceo')).ahead).toBe(0);
  });

  it("drops the oldest CEO request past the cap, never the manager's", () => {
    const s = emptyResearch();
    queueResearch(s, ask('mine'));
    for (let i = 0; i < RESEARCH_QUEUE_MAX; i++) queueResearch(s, ask(`ceo ${i}`, 'ceo'));
    expect(s.queue).toHaveLength(RESEARCH_QUEUE_MAX);
    expect(s.queue[0].topic).toBe('mine');
    expect(s.queue.some((r) => r.topic === 'ceo 0')).toBe(false);
  });

  it('shows the job, its minutes against the budget, the queue, the cost and the last brief', () => {
    const s = emptyResearch();
    queueResearch(s, ask('A'));
    queueResearch(s, ask('B'));
    nextResearch(s, 0);
    const v = researcherView(s);
    expect(v.job).toMatchObject({ topic: 'A', minutes: 20 });
    expect(researchLine(v, 4 * 60_000 + 5)).toBe('4 of 20 min · 1 waiting');
    expect(researchLine(null, 0)).toBe('free');
    finishResearch(s, brief(1, { costUsd: 0.25 }));
    expect(researcherView(s)).toMatchObject({ job: null, costUsd: 0.25, last: { id: 1, costUsd: 0.25 } });
  });

  it('tells wait_for whether a request is done', () => {
    const s = emptyResearch();
    queueResearch(s, ask('A'));
    expect(researchStatus(s, 1)).toEqual({ topic: 'A', done: null });
    nextResearch(s, 0);
    finishResearch(s, brief(1));
    expect(researchStatus(s, 1)).toEqual({ topic: 'A', done: { file: '/b.md', summary: 'S', partial: false } });
    expect(researchStatus(s, 2)).toBeNull();
  });

  it('puts a job a restart cut off back at the front', () => {
    const s = emptyResearch();
    queueResearch(s, ask('A'));
    queueResearch(s, ask('B'));
    nextResearch(s, 0);
    const back = loadResearch(JSON.parse(JSON.stringify(s)));
    expect(back.job).toBeNull();
    expect(back.queue.map((r) => r.topic)).toEqual(['A', 'B']);
    expect(back.seq).toBe(3);
    expect(loadResearch(undefined)).toEqual(emptyResearch());
  });
});
