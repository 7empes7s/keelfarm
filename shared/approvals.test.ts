import { describe, expect, it } from 'vitest';
import { impactOf, impactScore, mergeConfirmText, prDecision, prWhy, span, stuckSince, waitLine, whySummary } from './approvals.ts';
import type { QaCheck } from './types.ts';

const H = 3_600_000;
const qa = (status: 'needs-human' | 'passed', checks: QaCheck['result'][] = [], mergeNote: string | null = null) => ({
  status,
  checks: checks.map((result, i) => ({ name: `c${i}`, result, details: '' })),
  mergeNote,
  summary: null,
});
const pr = (checks: 'failing' | 'passing' | 'pending', failed: { neverStarted?: boolean }[] = []) => ({ checks, failedChecks: failed.map((f, i) => ({ name: `CI ${i}`, url: null, ...f })) });

describe('why it needs you', () => {
  it('tells a CI outage (checks that never started, or GitHub refusing) from red checks', () => {
    expect(prWhy(qa('needs-human', ['pass']), pr('failing', [{ neverStarted: true }, { neverStarted: true }]))).toBe('outage');
    expect(prWhy(qa('passed', [], 'waiting for CI to run again: recent account payments have failed (billing)'), pr('failing', [{}]))).toBe('outage');
    expect(prWhy(qa('needs-human'), pr('failing', [{ neverStarted: true }, {}]))).toBe('checks');
  });

  it('only CI: QA passed or found nothing, and checks are red', () => {
    expect(prWhy(qa('passed'), pr('failing', [{}]))).toBe('checks');
    expect(prWhy(qa('needs-human', ['pass', 'skip']), pr('failing', [{}]))).toBe('checks');
  });

  it('QA blocked when QA found a failure, ready when it passed and CI is fine', () => {
    expect(prWhy(qa('needs-human', ['fail']), pr('failing', [{}]))).toBe('qa');
    expect(prWhy(qa('needs-human', ['fail']), pr('passing'))).toBe('qa');
    expect(prWhy(qa('needs-human'), pr('passing'))).toBe('qa');
    expect(prWhy(qa('passed'), pr('passing'))).toBe('ready');
  });

  it('counts the groups, biggest first', () => {
    expect(whySummary(['checks', 'design', 'checks', 'product', 'checks', 'product'])).toEqual({
      total: 6,
      parts: [
        { why: 'checks', n: 3 },
        { why: 'product', n: 2 },
        { why: 'design', n: 1 },
      ],
    });
  });
});

describe('asked and waiting times', () => {
  it('says a span in minutes, hours or days', () => {
    expect(span(20_000)).toBe('just now');
    expect(span(5 * 60_000)).toBe('5 min');
    expect(span(2 * H + 59 * 60_000)).toBe('2 h');
    expect(span(25 * H)).toBe('1 day');
    expect(span(3 * 24 * H)).toBe('3 days');
    expect(span(-5)).toBe('just now');
  });

  it('says when it was asked and, when the PR is older, how long it has been open', () => {
    const now = 10 * 24 * H;
    expect(waitLine(now - 2 * H, now - 3 * 24 * H, now)).toBe('asked 2 h ago · open 3 days');
    expect(waitLine(now - 2 * H, now - 2 * H, now)).toBe('asked 2 h ago');
    expect(waitLine(now - 10_000, null, now)).toBe('asked just now');
  });
});

describe('impact', () => {
  it('groups changed files by area and names the screens', () => {
    const i = impactOf(['client/src/pocket/PocketApprovals.tsx', 'client/src/ui/Decisions.tsx', 'client/src/pocket/pocket.css', 'shared/approvals.ts', 'shared/approvals.test.ts', 'docs/pocket.md', 'vite.config.ts'], 120, 30);
    expect(i.areas).toEqual([
      { area: 'client', files: 3 },
      { area: 'shared', files: 1 },
      { area: 'tests', files: 1 },
      { area: 'docs', files: 1 },
      { area: 'other', files: 1 },
    ]);
    expect(i.screens).toEqual(['PocketApprovals', 'Decisions']);
    expect(i.risks).toEqual([]);
  });

  it('flags the office parts that can take it down', () => {
    expect(impactOf(['scripts/office.mjs'], 1, 1).risks).toEqual(['self-update']);
    expect(impactOf(['scripts/officeSteps.mjs', 'server/swarm/update.ts'], 1, 1).risks).toEqual(['self-update']);
    expect(impactOf(['server/swarm/scheduling.ts'], 1, 1).risks).toEqual(['scheduler']);
    expect(impactOf(['server/swarm/merge.ts', 'server/swarm/qa.ts'], 1, 1).risks).toEqual(['merge loop']);
    expect(impactOf(['server/ceo.ts', 'package.json', '.github/workflows/ci.yml'], 1, 1).risks).toEqual(['CEO tools', 'dependencies', 'CI']);
    expect(impactOf(['server/swarm/qa.test.ts'], 1, 1).risks).toEqual([]);
  });

  it('sorts risky changes above bigger ones', () => {
    expect(impactScore(impactOf(['server/swarm/merge.ts'], 2, 1))).toBeGreaterThan(impactScore(impactOf(['client/src/App.tsx'], 900, 400)));
  });
});

describe('stuck since', () => {
  it('starts when a PR becomes needs-human, holds while it stays, and clears when it leaves', () => {
    expect(stuckSince('testing', 'needs-human', null, 500)).toBe(500);
    expect(stuckSince('testing', 'needs-human', null, 500, 200)).toBe(200);
    expect(stuckSince('needs-human', 'needs-human', 300, 900)).toBe(300);
    expect(stuckSince('needs-human', 'queued', 300, 900)).toBeNull();
  });
});

describe('the decision', () => {
  it('recommends what fits why it needs you', () => {
    expect(prDecision('outage', 1, true).recommend).toBeNull();
    expect(prDecision('outage', 1, false).recommend).toBe('merge');
    expect(prDecision('checks', 1, true).recommend).toBe('sendBack');
    expect(prDecision('ready', 1, false).recommend).toBe('merge');
    expect(prDecision('qa', 1, true).recommend).toBe('retry');
    expect(prDecision('qa', 3, true)).toMatchObject({ recommend: 'sendBack', text: expect.stringContaining('3 rounds') });
  });
});

describe('the Merge confirmation', () => {
  const repo = { defaultBranch: 'main', floor: 3 };
  const p = (failed: { name: string; neverStarted?: boolean }[]) => ({ number: 12, title: 'Fix it', failedChecks: failed.map((f) => ({ url: null, ...f })) });

  it('a CI-only PR: says QA passed, names the red checks and that the floor goes live', () => {
    const t = mergeConfirmText('checks', qa('passed'), p([{ name: 'CI / windows' }]), repo);
    expect(t.body).not.toContain('not passed QA');
    expect(t.body).toContain('passed QA');
    expect(t.body).toContain('Red: CI / windows.');
    expect(t.body).toContain("floor 3's main goes live with it.");
    expect(t.warn).toBe(true);
    expect(mergeConfirmText('outage', qa('needs-human', ['pass']), p([{ name: 'CI / ubuntu', neverStarted: true }]), repo).body).toContain('passed QA; only CI is red. Red: CI / ubuntu (never ran).');
  });

  it('a QA-failed PR: says it has not passed QA, with its red checks and that the floor goes live', () => {
    const t = mergeConfirmText('qa', qa('needs-human', ['fail']), p([{ name: 'CI / ubuntu' }]), repo);
    expect(t.title).toBe('Merge PR #12 without QA?');
    expect(t.body).toBe("“Fix it” has not passed QA. Red: CI / ubuntu. It will be squash-merged into main anyway, and floor 3's main goes live with it.");
    expect(mergeConfirmText('qa', qa('needs-human', ['fail']), p([]), repo).body).not.toContain('Red:');
  });

  it('ready to merge stays the plain confirmation', () => {
    const t = mergeConfirmText('ready', qa('passed'), p([]), repo);
    expect(t).toMatchObject({ warn: false, confirm: 'Squash & merge' });
    expect(t.body).toContain("floor 3's main goes live with it.");
  });
});
