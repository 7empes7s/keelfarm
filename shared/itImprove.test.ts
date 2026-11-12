import { describe, expect, it } from 'vitest';
import type { CostSession } from './costs.ts';
import { closeTicket, emptyTickets, fileTicket } from './itTickets.ts';
import { addRecord, approveCard, causeKey, emptyImprove, groupCauses, improveView, lostIn, makeCard, makeRecord, reviewBrief, reviewWeek, WEEK, weekStart, withLine, type ItRecord } from './itImprove.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = new Date(2026, 10, 12, 12).getTime(); // a Thursday

const rec = (id: number, where: ItRecord['where'], cause: string, at: number, o: Partial<ItRecord> = {}): ItRecord => ({ id, cause, key: causeKey(where, cause), where, at, closedAt: at + 60 * MIN, reports: 1, agents: [], minutes: 0, qaRounds: 0, usd: 0, fix: 'fixed', ...o });
const session = (agentId: string, at: number, o: Partial<CostSession> = {}): CostSession => ({ type: 'session', at, ms: 1000, repoId: 'r', agentId, agent: agentId, kind: 'issue', issue: 1, pr: null, round: null, model: 'm', effort: '', usd: 1, tokens: null, outcome: 'no-pr', ...o });

describe('a closed ticket as a record', () => {
  it('keeps the agent minutes blocked, the wasted dollars and failed QA rounds while it was open, and the fix', () => {
    const s = emptyTickets();
    const ada = { id: 'a1', name: 'Ada' };
    const t = fileTicket(s, { what: 'Lab result lost', where: 'lab', evidence: 'job 7', blocking: true }, ada, NOW).ticket;
    closeTicket(s, t.id, 'Restarted the lab.', NOW + 30 * MIN);
    const sessions = [
      session('a1', NOW + 10 * MIN), // wasted, in the window: counts
      session('a1', NOW + 20 * MIN, { kind: 'qa', outcome: 'qa-fail', usd: 0.5 }), // a failed QA round
      session('a1', NOW + 20 * MIN, { outcome: 'pr', usd: 9 }), // productive: not waste
      session('b2', NOW + 20 * MIN), // another agent's
      session('a1', NOW - DAY), // before the ticket
    ];
    const r = makeRecord(t, [], [ada], sessions);
    expect(r).toMatchObject({ id: 1, cause: 'Lab result lost', key: 'lab:lab result lost', minutes: 30, usd: 1.5, qaRounds: 1, fix: 'Restarted the lab.', agents: ['a1'] });
    expect(r.recurOf).toBeUndefined();
  });

  it("counts the agents the office's own evidence names", () => {
    const s = emptyTickets();
    const t = fileTicket(s, { what: 'Test lab: oom', where: 'lab', evidence: 'Ada · job x · exit 137', blocking: false }, { id: 'office', name: 'The office' }, NOW, true).ticket;
    closeTicket(s, t.id, 'ok', NOW + MIN);
    expect(makeRecord(t, [], [{ id: 'a1', name: 'Ada' }, { id: 'b2', name: 'Bo' }], []).agents).toEqual(['a1']);
  });

  it('uses IT\'s cause over the what, so differently worded tickets group', () => {
    const s = emptyTickets();
    const t = fileTicket(s, { what: 'EADDRINUSE 5644', where: 'ports', evidence: 'x', blocking: false }, { id: 'a1', name: 'Ada' }, NOW).ticket;
    t.cause = 'Port taken by a leftover dev server';
    closeTicket(s, t.id, 'ok', NOW + MIN);
    expect(makeRecord(t, [], [], []).key).toBe(causeKey('ports', 'port taken by a leftover dev server'));
  });

  it('marks it recurring when the same cause was closed before it opened (it came back after a fix)', () => {
    const first = rec(1, 'lab', 'Test lab: oom', NOW - 3 * DAY);
    const s = emptyTickets();
    s.seq = 1;
    const t = fileTicket(s, { what: 'Test lab: oom', where: 'lab', evidence: 'x', blocking: false }, { id: 'office', name: 'o' }, NOW).ticket;
    closeTicket(s, t.id, 'ok', NOW + MIN);
    expect(makeRecord(t, [first], [], []).recurOf).toBe(1);
    // Another cause, or one still open when this opened, isn't a repeat.
    expect(makeRecord(t, [rec(1, 'lab', 'Lab result lost', NOW - 3 * DAY)], [], []).recurOf).toBeUndefined();
    expect(makeRecord(t, [{ ...first, closedAt: NOW + 1 }], [], []).recurOf).toBeUndefined();
  });

  it('wasted dollars only count within the window plus its grace', () => {
    expect(lostIn(['a'], NOW, NOW + MIN, [session('a', NOW + 20 * MIN), session('a', NOW + 40 * MIN)])).toEqual({ usd: 1, qaRounds: 0 });
  });
});

describe('grouping and ranking by time and money lost', () => {
  const records = [
    rec(1, 'lab', 'Test lab: oom', NOW - 1 * DAY, { usd: 1, minutes: 10 }),
    rec(2, 'lab', 'Test lab: OOM', NOW - 2 * DAY, { usd: 1, minutes: 10, recurOf: 9 }), // same cause, other case
    rec(3, 'ports', 'Port taken', NOW - 1 * DAY, { minutes: 100 }), // $5 of agent time
    rec(4, 'disk', 'Disk nearly full', NOW - 1 * DAY, { usd: 0.5 }),
    rec(5, 'disk', 'Disk nearly full', NOW - 20 * DAY, { usd: 50 }), // outside the window
  ];

  it('sums each cause and ranks dollars plus blocked minutes, the costliest first', () => {
    const rows = groupCauses(records, NOW - 7 * DAY, NOW, []);
    expect(rows.map((r) => [r.key, r.tickets, r.minutes, r.usd])).toEqual([
      ['ports:port taken', 1, 100, 0],
      ['lab:test lab oom', 2, 20, 2],
      ['disk:disk nearly full', 1, 0, 0.5],
    ]);
    expect(rows[1]).toMatchObject({ status: 'recurring', ids: [1, 2] });
    expect(rows[0].status).toBe('new');
  });

  it('a change with no ticket after it is fixed; a ticket after it is recurring', () => {
    const change = { id: 'c', key: 'lab:test lab oom', cause: 'x', kind: 'issue' as const, title: 'Two workers', at: NOW - 36 * 60 * MIN }; // ticket 1 came after it
    expect(groupCauses(records, NOW - 7 * DAY, NOW, [change]).find((r) => r.key === change.key)).toMatchObject({ status: 'recurring', change: { title: 'Two workers' } });
    expect(groupCauses(records, NOW - 7 * DAY, NOW, [{ ...change, at: NOW - 10 }]).find((r) => r.key === change.key)?.status).toBe('fixed');
  });

  it("the brief lists the top causes with their keys, numbers and status, and the floors", () => {
    const text = reviewBrief(groupCauses(records, NOW - 7 * DAY, NOW, []), { days: 7, floors: [{ floor: 1, fullName: 'o/r' }] });
    expect(text).toMatch(/^Review of the last 7 days: 4 tickets, 120 agent-minutes blocked, \$2\.50 of wasted sessions/);
    expect(text).toContain('1. [new] cause "ports:port taken" (Port taken): 1 ticket (#3), 100 min, $0.00');
    expect(text).toContain('[recurring] cause "lab:test lab oom"');
    expect(text).toMatch(/Floors: 1 o\/r$/);
    expect(reviewBrief([], { days: 7, floors: [] })).toMatch(/^No IT tickets/);
  });
});

describe('the weekly schedule', () => {
  it('weeks start Monday; the review is due from Monday 9:00, once per week', () => {
    expect(new Date(weekStart(NOW)).getDay()).toBe(1);
    const monday = weekStart(NOW);
    expect(reviewWeek(monday + 8 * 60 * MIN)).toBeNull();
    expect(reviewWeek(monday + 9 * 60 * MIN)).toBe(reviewWeek(NOW));
    expect(reviewWeek(NOW + WEEK)).not.toBe(reviewWeek(NOW));
  });
});

describe('cards: a proposal, approved', () => {
  const rows = groupCauses([rec(1, 'lab', 'Test lab: oom', NOW - DAY, { usd: 2 })], NOW - 7 * DAY, NOW, []);
  const opts = { id: 'i-x-1', at: NOW, by: 'Iris', rows, floors: [1, 2] };

  it('checks the cause, the floor and what each kind needs', () => {
    expect(makeCard({ cause: 'lab:test lab oom', kind: 'issue', title: 'Two workers', why: '$2', floor: 2, body: 'What, where, acceptance' }, opts)).toMatchObject({ key: 'lab:test lab oom', status: 'new', floor: 2, body: 'What, where, acceptance' });
    expect(() => makeCard({ cause: 'nope', kind: 'issue', title: 't', why: '', floor: 1, body: 'b' }, opts)).toThrow(/No cause "nope"/);
    expect(() => makeCard({ cause: 'lab:test lab oom', kind: 'issue', title: 't', why: '', floor: 3, body: 'b' }, opts)).toThrow(/floor is one of 1, 2/);
    expect(() => makeCard({ cause: 'lab:test lab oom', kind: 'issue', title: 't', why: '', floor: 1 }, opts)).toThrow(/needs a body/);
    expect(() => makeCard({ cause: 'lab:test lab oom', kind: 'office_playbook', title: 't', why: '' }, opts)).toThrow(/needs the line/);
    expect(makeCard({ cause: 'lab:test lab oom', kind: 'office_playbook', title: 't', why: '', floor: 9, line: 'Use 2 workers.' }, opts).floor).toBeUndefined();
  });

  it('approve moves it into the changes and links its cause\'s records to it; later records of that cause link too', () => {
    const s = emptyImprove();
    addRecord(s, rec(1, 'lab', 'Test lab: oom', NOW - DAY), NOW);
    addRecord(s, rec(2, 'ports', 'Port taken', NOW - DAY), NOW);
    const card = makeCard({ cause: 'lab:test lab oom', kind: 'issue', title: 'Two workers', why: '', floor: 1, body: 'b' }, opts);
    s.cards = [card];
    const change = approveCard(s, card, NOW, { issue: 12, url: 'https://github.com/o/r/issues/12' });
    expect(s.cards).toEqual([]);
    expect(s.changes).toEqual([change]);
    expect(s.records.map((r) => [r.id, r.change])).toEqual([[2, undefined], [1, 'i-x-1']]);
    addRecord(s, rec(3, 'lab', 'Test lab: oom', NOW), NOW);
    expect(s.records[0].change).toBe('i-x-1');
  });

  it('a line is added as a bullet, once', () => {
    expect(withLine('- one', 'two')).toBe('- one\n- two');
    expect(withLine('', '- two')).toBe('- two');
    expect(withLine('- one\n- two', 'two')).toBeNull();
  });
});

describe('the trends', () => {
  it('problems per week, recurring vs resolved, and a change measured before and after', () => {
    const s = emptyImprove();
    const at = weekStart(NOW) - 2 * WEEK; // the change, two weeks ago
    for (const d of [27, 20, 13, 6]) addRecord(s, rec(100 + d, 'lab', 'oom', at - d * DAY), NOW); // 4 in the 4 weeks before
    addRecord(s, rec(1, 'lab', 'oom', at + DAY, { recurOf: 106 }), NOW); // 1 since
    s.changes = [{ id: 'c', key: causeKey('lab', 'oom'), cause: 'oom', kind: 'issue', title: 'Fix', at, issue: 3 }];
    const v = improveView(s, [rec(2, 'ports', 'Port', NOW - MIN, { fix: 'still open' })], NOW);
    expect(v.weeks).toHaveLength(8);
    expect(v.weeks.at(-1)).toMatchObject({ problems: 1, resolved: 0 });
    expect(v.weeks.find((w) => w.start === weekStart(at + DAY))).toMatchObject({ problems: 1, recurring: 1 });
    expect(v.changes[0]).toMatchObject({ before: 1, after: 0.4 });
    expect(v.causes[0]).toMatchObject({ key: 'lab:oom', status: 'recurring', change: { issue: 3 } });
  });
});
