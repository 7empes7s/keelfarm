import { describe, expect, it } from 'vitest';
import { avgFixRounds, badges, careerOfRow, careerRow, compareToFloor, costPerMerge, DAY_MS, deskItems, deskToy, durationText, firstRoundRate, highlights, keyStats, knownFor, legacyCareer, medianToPr, mvpOfWeek, newCareer, packCareers, passRate, plantGrowth, profileStats, rank, roundsPerMerge, spendShare, tenureDays, wasteShare, addWeek, weekOf, weekOfRow, weeklySeries, WEEK_MS, workIdle, type CareerView } from './careers.ts';
import { CATALOGUE, DECOR_SLOTS, priceOf, slotKind, stored } from './progress.ts';

const NOW = Date.UTC(2026, 9, 4, 12);
const career = (c: Partial<CareerView> = {}): CareerView => ({ ...newCareer(NOW), ...c });

describe('the profile (#117)', () => {
  it('rates first rounds, QA rounds, cost per merge and time to PR, waiting for data', () => {
    expect([firstRoundRate(career()), roundsPerMerge(career()), costPerMerge(career()), medianToPr(career())]).toEqual([null, null, null, null]);
    expect(firstRoundRate(career({ firstPass: 3, firstQa: 4 }))).toBe(0.75);
    expect(firstRoundRate(career({ firstPass: 2 }))).toBe(1); // a record from before firstQa
    expect(roundsPerMerge(career({ merged: 2, qaPass: 2, qaFail: 1 }))).toBe(1.5);
    expect(costPerMerge(career({ merged: 4, costUsd: 6 }))).toBe(1.5);
    expect(medianToPr(career({ toPr: [30, 10, 20] }))).toBe(20);
    expect(medianToPr(career({ toPr: [40, 10, 20, 30] }))).toBe(25);
    expect([durationText(5 * 60_000), durationText(90 * 60_000), durationText(2 * DAY_MS)]).toEqual(['5m', '1.5h', '2d']);
  });

  it('keeps eight weeks of totals and draws them oldest first, gaps where a week had no data', () => {
    const c = career();
    for (const ago of [0, 0, 1, 3, 9]) addWeek(c, NOW - ago * WEEK_MS, { merged: 1 });
    addWeek(c, NOW, { usd: 6 });
    addWeek(c, NOW - WEEK_MS, { firstQa: 2, firstPass: 1 });
    expect(c.weeks.map((r) => r[0])).toEqual([weekOf(NOW) - 3, weekOf(NOW) - 1, weekOf(NOW)]); // nine weeks back fell off
    expect(weekOfRow(c.weeks[2])).toEqual({ w: weekOf(NOW), merged: 2, usd: 6, waste: 0, sessions: 0, firstQa: 0, firstPass: 0, min: 0 });
    const s = weeklySeries(c, NOW);
    expect(s.merges).toEqual([0, 0, 0, 0, 1, 0, 1, 2]);
    expect(s.costPerMerge.slice(-2)).toEqual([0, 3]);
    expect(s.firstPass.slice(-3)).toEqual([null, 0.5, null]);
  });

  it('compares with the floor: higher or lower is better per stat, within 5% is even', () => {
    expect(compareToFloor(0.9, 0.75, true)).toBe('better');
    expect(compareToFloor(0.9, 0.75, false)).toBe('worse');
    expect(compareToFloor(0.76, 0.75, true)).toBe('even');
    expect(compareToFloor(0, 0, true)).toBe('even');
    expect(compareToFloor(null, 0.75, true)).toBeNull();
    expect(compareToFloor(0.5, null, true)).toBeNull();
  });

  it("puts each stat beside the floor's average", () => {
    const ada = career({ merged: 4, firstPass: 3, firstQa: 3, qaPass: 4, qaFail: 0, costUsd: 4 });
    const bob = career({ merged: 2, firstPass: 1, firstQa: 2, qaPass: 2, qaFail: 2, costUsd: 6 });
    const stats = Object.fromEntries(profileStats(ada, [ada, bob], 1, NOW).map((x) => [x.key, x]));
    expect(stats.firstRound).toMatchObject({ text: '100%', verdict: 'better', vsFloor: "↑ better than floor 1's 75%" });
    expect(stats.rounds).toMatchObject({ text: '1.0', verdict: 'better', vsFloor: "↑ better than floor 1's 1.5" });
    expect(stats.cost).toMatchObject({ text: '$1.00', verdict: 'better' });
    expect(Object.fromEntries(profileStats(bob, [ada, bob], 1, NOW).map((x) => [x.key, x])).cost).toMatchObject({ text: '$3.00', verdict: 'worse', vsFloor: "↓ under floor 1's $2.00" });
    expect(stats.toPr).toMatchObject({ text: '—', verdict: null, vsFloor: '' });
    // alone on the floor: nothing to compare with
    expect(profileStats(ada, [ada], 1, NOW).every((x) => x.vsFloor === '')).toBe(true);
  });

  it('gives badges and the team list its key stats', () => {
    expect(badges(career())).toEqual([]);
    expect(badges(career({ firstPass: 10, best: 4, merged: 10 }))).toEqual(['⭐ 10 first-time passes', '🔥 4 in a row', '✨ Never needed a fix']);
    expect(keyStats(career(), NOW)).toBe('0 merged this week');
    expect(keyStats(career({ merged: 2, firstPass: 1, firstQa: 2, costUsd: 3, week: [NOW - DAY_MS] }), NOW)).toBe('1 merged this week · 50% first-round QA · $1.50 / merge');
  });
});

describe('usage and cost (#205)', () => {
  it('compares cost per merge and waste share with the floor average', () => {
    const me = career({ merged: 4, costUsd: 4, wasteUsd: 0.4 }); // $1 a merge, 10% waste
    const floor = [me, career({ merged: 2, costUsd: 6, wasteUsd: 1.5 }), career({ merged: 1, costUsd: 2, wasteUsd: 0.5 })]; // $3 and $2, 25% each
    expect(wasteShare(me)).toBeCloseTo(0.1);
    expect(wasteShare(career())).toBeNull();
    const stats = profileStats(me, floor, 2, NOW);
    const cost = stats.find((x) => x.key === 'cost')!;
    const waste = stats.find((x) => x.key === 'waste')!;
    expect(cost).toMatchObject({ text: '$1.00', verdict: 'better', vsFloor: "↑ better than floor 2's $2.00" });
    expect(waste).toMatchObject({ text: '10%', verdict: 'better', vsFloor: "↑ better than floor 2's 20%" });
    const spendy = profileStats(floor[1], floor, 2, NOW);
    expect(spendy.find((x) => x.key === 'waste')!.verdict).toBe('worse');
  });

  it('sums time working and idle over every stint, never more work than time on the team', () => {
    const c = career({ since: NOW - 2 * DAY_MS, served: 3 * DAY_MS, workMs: 30 * 3_600_000 });
    expect(tenureDays(c, NOW)).toBe(5);
    expect(workIdle(c, NOW)).toEqual({ work: 30 * 3_600_000, idle: 5 * DAY_MS - 30 * 3_600_000 });
    expect(workIdle(career({ since: NOW - 3_600_000, workMs: 2 * 3_600_000 }), NOW)).toEqual({ work: 3_600_000, idle: 0 });
  });

  it("shares this week's spend across everyone", () => {
    const a = career();
    const b = career();
    addWeek(a, NOW, { usd: 3 });
    addWeek(b, NOW, { usd: 1 });
    addWeek(b, NOW - WEEK_MS, { usd: 50 }); // last week doesn't count
    expect(spendShare(a, [a, b], NOW)).toBe(0.75);
    expect(spendShare(career(), [career()], NOW)).toBeNull();
  });

  it('picks the highlights, leaving out cards without a candidate', () => {
    const people = [
      { id: 'a', name: 'Ada', idleSince: null, career: career({ merged: 4, costUsd: 8, firstQa: 4, firstPass: 4, reviews: 1, wasteUsd: 2, wasted: 3, week: [NOW - DAY_MS] }) },
      { id: 'b', name: 'Bob', idleSince: NOW - 2 * 3_600_000, career: career({ merged: 2, costUsd: 2, firstQa: 2, firstPass: 2, reviews: 5 }) },
      { id: 'c', name: 'Cy', idleSince: NOW - 3_600_000, career: null },
    ];
    expect(highlights(people, NOW).map((h) => [h.key, h.name, h.text])).toEqual([
      ['mvp', 'Ada', '1 merge this week'],
      ['cheapest', 'Bob', '$1.00 / merge'],
      ['firstPass', 'Ada', '100% of 4 PRs'], // Bob's 2 are too few
      ['reviews', 'Bob', '5 QA reviews'],
      ['waste', 'Ada', '$2.00 on 3 sessions that came to nothing'],
      ['idle', 'Bob', 'idle for 2h'],
    ]);
    expect(highlights([{ id: 'x', name: 'X', idleSince: null, career: career() }], NOW)).toEqual([]);
  });

  it('reads an older career with its numbers kept and the new fields empty', () => {
    const old = legacyCareer({ since: NOW - DAY_MS, merged: 7, costUsd: 3.5, recent: [{ n: 1, title: 'x', at: NOW }], bySpecialty: { dev: 1 }, hires: 'two' });
    expect(old).toEqual({ ...newCareer(NOW - DAY_MS), merged: 7, costUsd: 3.5, recent: [[1, 'x', NOW]] }); // merged PRs become rows
    expect(legacyCareer({ rig: ['claude', 'opus', 'high', NOW] }).rig).toEqual(['claude', 'opus', 'high', NOW]); // a replay keeps what they run
  });

  it('goes into a snapshot as a row of values and comes back whole (#291)', () => {
    const c = career({ merged: 3, costUsd: 4.5, recent: [[7, 'Dark mode', NOW]], weeks: [[weekOf(NOW), 3, 4.5, 0, 5, 2, 1, 90]], rig: ['claude', 'opus', 'high', NOW] });
    const row = careerRow(c);
    expect(row.every((v) => typeof v !== 'object' || v === null || Array.isArray(v))).toBe(true);
    expect(JSON.stringify(row).length).toBeLessThan(JSON.stringify(c).length / 2);
    expect(careerOfRow(JSON.parse(JSON.stringify(row)))).toEqual(c);
    const packed = packCareers({ agents: [{ id: 'a1', career: c }, { id: 'ceo', career: null }] });
    expect(packed).toEqual({ agents: [{ id: 'a1', career: null }, { id: 'ceo', career: null }], careers: { a1: row } });
  });
});

describe('career stats', () => {
  it('pass rate and fix rounds wait for data', () => {
    expect(passRate(career())).toBeNull();
    expect(passRate(career({ qaPass: 3, qaFail: 1 }))).toBe(0.75);
    expect(avgFixRounds(career())).toBeNull();
    expect(avgFixRounds(career({ merged: 4, fixRounds: 2 }))).toBe(0.5);
  });

  it('ranks by merges and reviews together', () => {
    expect(rank(career())).toBe('Rookie');
    expect(rank(career({ merged: 3, reviews: 2 }))).toBe('Regular');
    expect(rank(career({ merged: 15 }))).toBe('Veteran');
    expect(rank(career({ merged: 10, reviews: 5 }))).toBe('Veteran');
    expect(rank(career({ reviews: 40 }))).toBe('Legend');
  });

  it('is known for its best line', () => {
    expect(knownFor(career())).toBe('Fresh on the team: first task coming up');
    expect(knownFor(career({ opened: 1 }))).toBe('First PR in review, fingers crossed');
    expect(knownFor(career({ merged: 9, best: 9, run: 9 }))).toBe('First-time QA passes: 9 in a row');
    expect(knownFor(career({ merged: 2, qaPass: 3, best: 1 }))).toBe('Never failed QA: 3 rounds passed');
    expect(knownFor(career({ merged: 1, qaPass: 1, qaFail: 1, fixRounds: 1 }))).toBe('Shipped 1 PR so far');
    expect(knownFor(career({ merged: 2, qaPass: 2, qaFail: 1 }))).toBe('Clean shipper: 2 PRs merged without a fix round');
    expect(knownFor(career({ reviews: 12 }))).toBe('QA reviews: 12 and counting');
    expect(knownFor(career({ merged: 4, reviews: 3, qaPass: 4, qaFail: 1, fixRounds: 1 }))).toBe('Shipped 4 PRs so far');
  });

  it('picks the MVP of the week from merges in the last 7 days', () => {
    const people = [
      { name: 'ada', career: career({ merged: 30, week: [NOW - 8 * DAY_MS, NOW - DAY_MS] }) },
      { name: 'linus', career: career({ merged: 3, week: [NOW - 2 * DAY_MS, NOW - DAY_MS] }) },
      { name: 'grace', career: career({ merged: 9, week: [NOW - 3 * DAY_MS, NOW - 60_000] }) },
      { name: 'ceo', career: null },
    ];
    expect(mvpOfWeek(people, NOW)).toEqual({ who: people[2], merges: 2 });
    expect(mvpOfWeek([people[3]], NOW)).toBeNull();
  });
});

describe('the desk', () => {
  it('shows a plaque per recent merge, a +N for the rest and the star at ten first-time passes', () => {
    const recent = Array.from({ length: 8 }, (_, i): [number, string, number] => [40 - i, '', NOW]);
    const items = deskItems(career({ merged: 11, firstPass: 10, recent }), 'ada', NOW);
    expect(items.plaques).toEqual([40, 39, 38, 37, 36, 35, 34, 33]);
    expect(items.more).toBe(3);
    expect(items.star).toBe(true);
    expect(deskItems(career({ firstPass: 9 }), 'ada', NOW).star).toBe(false);
  });

  it('grows personal items with tenure', () => {
    const fresh = deskItems(career(), 'grace', NOW);
    expect(fresh).toMatchObject({ photo: false, toy: null, plant: 0.7 });
    const old = deskItems(career({ since: NOW - 4 * DAY_MS }), 'grace', NOW);
    expect(old).toMatchObject({ photo: true, toy: 'speaker' });
    expect(old.plant).toBeCloseTo(1.22);
    expect(plantGrowth(30)).toBe(1.6);
  });

  it('picks the desk toy from the id, the same every time, and the magnifier for someone who mostly reviews', () => {
    expect(deskToy('ada')).toBe('duck');
    expect(deskToy('grace')).toBe('speaker');
    expect(deskToy('agent-2')).toBe('cradle');
    expect(deskToy('grace', career({ merged: 2, reviews: 1 }))).toBe('speaker');
    expect(deskToy('grace', career({ merged: 2, reviews: 3 }))).toBe('magnifier');
    expect(deskToy('grace', career({ reviews: 2 }))).toBe('speaker');
  });
});

describe('the catalogue', () => {
  it('prices rise a quarter per one owned, in fives', () => {
    expect(priceOf('arcade')).toBe(200);
    expect(priceOf('arcade', 2)).toBe(300);
    expect(priceOf('poster-ship', 1)).toBe(30);
  });

  it('has a slot of every kind its items need', () => {
    for (const item of CATALOGUE) expect(DECOR_SLOTS.some((s) => s.kind === item.kind)).toBe(true);
    expect(new Set(DECOR_SLOTS.map((s) => s.id)).size).toBe(DECOR_SLOTS.length);
    expect(slotKind('b-lounge')).toBe('big');
  });

  it('counts what is still in the decor box', () => {
    expect(stored({ owned: { plant: 3 }, placed: { 'f-ne': 'plant', 'f-se': 'plant' } }, 'plant')).toBe(1);
    expect(stored({ owned: {}, placed: {} }, 'plant')).toBe(0);
  });
});
