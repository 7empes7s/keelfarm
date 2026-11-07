import { describe, expect, it } from 'vitest';
import { avgFixRounds, badges, compareToFloor, costPerMerge, DAY_MS, deskItems, deskToy, durationText, firstRoundRate, keyStats, knownFor, medianToPr, mvpOfWeek, newCareer, passRate, plantGrowth, profileStats, rank, roundsPerMerge, weeklyMerges, WEEK_MS, type CareerView } from './careers.ts';
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

  it('counts merges per week over four weeks, oldest first', () => {
    const week = [NOW - 60_000, NOW - DAY_MS, NOW - WEEK_MS - DAY_MS, NOW - 3 * WEEK_MS - DAY_MS, NOW - 5 * WEEK_MS, NOW + DAY_MS];
    expect(weeklyMerges(career({ week }), NOW)).toEqual([1, 0, 1, 2]);
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
    const recent = Array.from({ length: 8 }, (_, i) => ({ n: 40 - i, title: '', at: NOW }));
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
