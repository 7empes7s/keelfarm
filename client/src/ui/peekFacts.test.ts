import { describe, expect, it } from 'vitest';
import { agoText, bodyLines, firstFailing, mergesToday, prAdvice, sharesNote, shareStats, whoIsOn } from './peekFacts';

const agent = (id: string, task: string | null, issueNumber: number | null, prNumber: number | null, repoId = 'r1') => ({ id, name: id.toUpperCase(), repoId, task, issueNumber, prNumber });

describe('whoIsOn', () => {
  it('names who builds, tests or fixes it on that floor only', () => {
    const agents = [agent('ada', 'issue', 12, null), agent('bo', 'qa', 12, 40), agent('cy', 'fix', 7, 41), agent('di', 'issue', 12, null, 'r2'), agent('ed', null, 12, null)];
    expect(whoIsOn('r1', 12, agents)).toEqual(['ADA building', 'BO testing']);
    expect(whoIsOn('r1', 41, agents)).toEqual(['CY fixing']);
  });
  it('falls back to its author when nobody is on it', () => {
    expect(whoIsOn('r1', 40, [agent('ada', null, null, null)], { devAgentId: 'ada', qaAgentId: null })).toEqual(['ADA wrote it']);
    expect(whoIsOn('r1', 40, [], null)).toEqual([]);
  });
});

describe('firstFailing', () => {
  it('gives the first failing check and its first line', () => {
    expect(firstFailing([{ name: 'typecheck', result: 'pass', details: '' }, { name: 'test', result: 'fail', details: '\n  FAIL a.test.ts > x\nmore' }])).toEqual({ name: 'test', line: 'FAIL a.test.ts > x' });
    expect(firstFailing([{ name: 'build', result: 'pass', details: 'ok' }])).toBe(null);
    expect(firstFailing(undefined)).toBe(null);
  });
});

describe('bodyLines', () => {
  it('keeps the first lines of prose', () => {
    expect(bodyLines('<!-- tpl -->\n## Why\n\nManager: **faster** merges\n- [ ] one `x`\n![s](a.png)\n3. three\nfour', 3)).toEqual(['Why', 'Manager: faster merges', 'one x']);
  });
});

describe('agoText', () => {
  it('says how long ago', () => {
    const now = 1_000_000_000;
    expect(agoText(now - 30_000, now)).toBe('just now');
    expect(agoText(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(agoText(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(agoText(now - 50 * 3_600_000, now)).toBe('2 d ago');
  });
});

describe('mergesToday', () => {
  it('counts merges since midnight', () => {
    const now = new Date(2026, 10, 7, 15, 0).getTime();
    expect(mergesToday({ week: [new Date(2026, 10, 7, 1).getTime(), new Date(2026, 10, 6, 23).getTime(), now - 60_000] }, now)).toBe(2);
  });
});

describe('shareStats', () => {
  it('names the floors and the CEO with % and $, then others', () => {
    const usd = (n: number) => `$${n}`;
    const rows = shareStats({ rows: [{ repoId: 'a', usd: 412, pct: 61 }, { repoId: '', usd: 100, pct: 15 }, { repoId: 'gone', usd: 50, pct: 7 }], others: { count: 2, usd: 110, pct: 17 } }, (id) => (id === 'a' ? 'Floor 3 · keelfarm' : undefined), usd);
    expect(rows).toEqual([['Floor 3 · keelfarm', '61% · $412'], ['CEO (lobby)', '15% · $100'], ['A removed floor', '7% · $50'], ['Others (2)', '17% · $110']]);
    expect(sharesNote({ since: Date.now() - 60_000, usd: 672 }, Date.now(), usd)).toMatch(/^Office share of the office’s spend since \d\d:\d\d \(\$672 in all\)\. Other \(outside the office\)/);
  });
});

describe('prAdvice', () => {
  it('recommends merging a passed PR, retrying a stuck QA, then sending it back', () => {
    expect(prAdvice({ status: 'passed', round: 1, ceoLooking: false }, true).recommend).toBe('Merge it');
    expect(prAdvice({ status: 'needs-human', round: 1, ceoLooking: true }, false)).toEqual({ why: 'QA couldn’t finish round 1 on its own; the CEO is looking at it.', recommend: 'Retry QA' });
    expect(prAdvice({ status: 'needs-human', round: 3, ceoLooking: false }, false).recommend).toBe('Send it back with a note');
    expect(prAdvice({ status: 'failed', round: 2, ceoLooking: false }, false).recommend).toBe('Send it back with a note');
  });
});
