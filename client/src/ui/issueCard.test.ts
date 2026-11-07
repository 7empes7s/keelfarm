import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../../../shared/history';
import { acceptanceProgress, checklist, issueCost, issueTimeline, splitSections, stageAt } from './issueCard';

const BODY = [
  'Objective: O1',
  '',
  '## Why',
  'The card cuts the body.',
  '',
  '## Build',
  '1. Header',
  '```md',
  '## not a heading',
  '```',
  '## Acceptance',
  '- Whole title readable',
  '- [x] Tests fail without the change',
].join('\n');

describe('splitSections', () => {
  it('splits on ## headings, keeping the intro and headings inside code blocks', () => {
    const { intro, sections } = splitSections(BODY, false);
    expect(intro).toBe('Objective: O1');
    expect(sections.map((s) => s.title)).toEqual(['Why', 'Build', 'Acceptance']);
    expect(sections[1].text).toContain('## not a heading');
    expect(sections.every((s) => s.open)).toBe(true);
  });

  it('folds Build on a phone, keeps Why and Acceptance open', () => {
    expect(splitSections(BODY, true).sections.map((s) => [s.title, s.open])).toEqual([
      ['Why', true],
      ['Build', false],
      ['Acceptance', true],
    ]);
  });

  it('a body without headings is all intro', () => {
    expect(splitSections('Just do it.\n\nPlease.', true)).toEqual({ intro: 'Just do it.\n\nPlease.', sections: [] });
  });
});

describe('acceptanceProgress', () => {
  const acceptance = splitSections(BODY, false).sections[2].text;

  it('reads list items and their ticks', () => {
    expect(checklist(acceptance)).toEqual([
      { text: 'Whole title readable', ticked: false },
      { text: 'Tests fail without the change', ticked: true },
    ]);
  });

  it('counts items ticked in the issue or by a report', () => {
    expect(acceptanceProgress(acceptance, [])).toEqual({ done: 1, total: 2 });
    expect(acceptanceProgress(acceptance, ['QA:\n- [x] **Whole title readable** at 390 px'])).toEqual({ done: 2, total: 2 });
  });

  it('is null with no list or nothing ticked, so the stage shows', () => {
    expect(acceptanceProgress('No list here.', ['- [x] anything'])).toBeNull();
    expect(acceptanceProgress('- one\n- two', ['- [ ] one'])).toBeNull();
  });
});

describe('stageAt', () => {
  it('maps the columns to filed → building → PR → QA → merged', () => {
    expect([stageAt('backlog', false), stageAt('progress', false), stageAt('qa', false), stageAt('qa', true), stageAt('ready', true), stageAt('merged', true)]).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

const entry = (e: Partial<HistoryEntry>): HistoryEntry => ({
  id: String(e.at),
  at: 0,
  startedAt: 0,
  repoId: 'o/r',
  repo: 'o/r',
  floor: 1,
  agentId: 'a',
  agent: 'Grace',
  kind: 'issue',
  issue: 7,
  pr: null,
  title: '',
  outcome: 'pr',
  note: '',
  usd: 1,
  tokens: null,
  model: '',
  effort: '',
  sessionId: null,
  transcript: null,
  ...e,
});

describe('issueTimeline', () => {
  const t0 = Date.parse('2026-11-01T10:00:00Z');
  const min = 60_000;
  const entries = [
    entry({ kind: 'qa', at: t0 + 40 * min, startedAt: t0 + 30 * min, outcome: 'qa-fail', agent: 'Linus', pr: 9 }),
    entry({ kind: 'issue', at: t0 + 20 * min, startedAt: t0 + 5 * min }),
    entry({ kind: 'fix-qa', at: t0 + 50 * min, startedAt: t0 + 42 * min, outcome: 'commit', pr: 9 }),
    entry({ kind: 'qa', at: t0 + 60 * min, startedAt: t0 + 52 * min, outcome: 'qa-pass', agent: 'Linus', pr: 9 }),
  ];

  it('builds filed, started, PR, each QA round, fixes and the merge in order', () => {
    const tl = issueTimeline({
      issue: { createdAt: new Date(t0).toISOString(), author: 'mimoun' },
      pull: { number: 9, createdAt: new Date(t0 + 21 * min).toISOString(), mergedAt: new Date(t0 + 70 * min).toISOString() },
      entries,
    });
    expect(tl.map((e) => e.text)).toEqual([
      'Filed by @mimoun',
      'Grace started building',
      'PR #9 opened',
      'QA round 1 failed · Linus',
      "Grace: fixing QA's findings, pushed",
      'QA round 2 passed · Linus',
      'Merged',
    ]);
    expect(tl.map((e) => e.tone)).toEqual([undefined, undefined, undefined, 'bad', undefined, 'good', 'good']);
  });

  it('shows who is building now before any session has ended', () => {
    expect(issueTimeline({ issue: { createdAt: new Date(t0).toISOString() }, entries: [], live: { agent: 'Ada', at: t0 + min } }).map((e) => e.text)).toEqual(['Filed', 'Ada started building']);
  });
});

describe('issueCost', () => {
  const work = (e: HistoryEntry) => (e.issue !== null ? `#${e.issue}` : null);
  const mine = [entry({ at: 10 * 60_000, startedAt: 0, usd: 2 }), entry({ kind: 'qa', at: 20 * 60_000, startedAt: 15 * 60_000, usd: 0.5 }), entry({ kind: 'merge', usd: 0, at: 1, startedAt: 1 })];
  const floor = [...mine, entry({ issue: 1, usd: 1 }), entry({ issue: 2, usd: 3 }), entry({ issue: 2, usd: 1 }), entry({ issue: 3, usd: 2 }), entry({ issue: null, usd: 50 })];

  it("sums this work's sessions, time and spend against the floor's median", () => {
    expect(issueCost(mine, floor, work, '#7')).toEqual({ sessions: 2, ms: 15 * 60_000, usd: 2.5, median: 2 });
  });

  it('has no median with too little to compare', () => {
    expect(issueCost(mine, mine, work, '#7').median).toBeNull();
  });
});
