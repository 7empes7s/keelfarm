import { describe, expect, it } from 'vitest';
import { ASKED_IN_MAX_MS, askedInRefusal, heardAtStart, liveStandardsRefusal, neverAllowed } from './managerAsks.ts';
import { freshRetry, MAX_QA_ROUNDS } from './qaOutcome.ts';
import { qaInstructions } from './qaPrompt.ts';

// #403: a manager-only CEO tool runs when the manager's own recent message in the CEO's current job asks for it.
const now = 10 * ASKED_IN_MAX_MS;
const messages = [
  { id: 4, from: 'manager', at: now - 60_000 },
  { id: 5, from: 'ceo', at: now - 30_000 },
  { id: 6, from: 'manager', at: now - ASKED_IN_MAX_MS - 1 },
  { id: 7, from: 'manager', at: now - 10_000 },
];

describe('askedInRefusal', () => {
  it("lets a call run that names the manager's message of this chat job", () => {
    expect(askedInRefusal({ askedIn: 4, heard: heardAtStart({ kind: 'chat', messageIds: [4] }), messages, now })).toBeNull();
  });

  it('refuses the same call from a follow-up, triage, research or plan job, with or without asked_in', () => {
    for (const kind of ['followup', 'triage', 'research', 'plan', 'review', 'onboard']) {
      const heard = heardAtStart({ kind, messageIds: [4] });
      expect(askedInRefusal({ askedIn: 4, heard, messages, now }), kind).toMatch(/didn't come to you in this job/);
      expect(askedInRefusal({ askedIn: undefined, heard, messages, now }), kind).toMatch(/pass asked_in/);
    }
  });

  it("refuses a stale message, someone else's, an unknown one, and one from another job", () => {
    const heard = [4, 5, 6];
    expect(askedInRefusal({ askedIn: 6, heard, messages, now })).toMatch(/over 4 hours old/);
    expect(askedInRefusal({ askedIn: 5, heard, messages, now })).toMatch(/isn't the manager's message/);
    expect(askedInRefusal({ askedIn: 99, heard, messages, now })).toMatch(/no message #99/);
    expect(askedInRefusal({ askedIn: 7, heard, messages, now })).toMatch(/didn't come to you in this job/);
    expect(askedInRefusal({ askedIn: 'four', heard, messages, now })).toMatch(/pass asked_in/);
  });
});

describe('neverAllowed', () => {
  it('keeps refusing what only the manager may do, even when asked', () => {
    for (const text of [
      'restart the office in /root/Projects/keelfarm',
      'serve it on port 4317',
      'force-push the branch',
      'git push --force origin main',
      'delete the branch swarm/issue-3',
      'gh repo delete acme/app',
      'show me the API key',
      'write the policy to the M365 tenant',
      'enforce Conditional Access',
    ]) {
      expect(neverAllowed({ note: text }), text).toMatch(/^Never from the CEO: /);
      expect(neverAllowed({ deep: [{ text }] }), text).not.toBeNull();
    }
  });

  it('lets ordinary asks through', () => {
    expect(neverAllowed({ floor: 1, pr: 4317, note: 'Merge main and keep both changes.', asked_in: 4 })).toBeNull();
    expect(neverAllowed({ experiment: 'x53b5b6f1', action: 'start' })).toBeNull();
  });
});

describe('liveStandardsRefusal', () => {
  const live = 'Never stop, restart or edit the live office (/root/Projects/keelfarm, port 4317)';
  it("keeps the standards that protect the live office word for word, and lets the rest change", () => {
    expect(liveStandardsRefusal([live, 'Tests stay green'], ['Tests stay green'])).toMatch(/protects the live office/);
    expect(liveStandardsRefusal([live, 'Tests stay green'], [live.replace('Never', 'Rarely'), 'Tests stay green'])).toMatch(/protects the live office/);
    expect(liveStandardsRefusal([live, 'Tests stay green'], [live])).toBeNull();
  });
});

describe('freshRetry', () => {
  it('drops the last report at the round cap, so QA tests it afresh with a new report', () => {
    const atCap = { round: MAX_QA_ROUNDS, retests: 0, mergeFixes: 0 };
    expect(freshRetry(atCap)).toEqual({ summary: null, checks: [], commentUrl: null, fixInstructions: null, testedSha: null, fixReason: null, shots: [] });
    const rec = { ...atCap, summary: 'Old findings', fixInstructions: 'Fix the toolbar', testedSha: 'abc', fixReason: 'qa' as const };
    const next = { ...rec, ...freshRetry(rec), round: rec.round + 1 };
    const pr = { headSha: 'def', checks: 'passing' as const, checkNames: ['ci'], failedChecks: [], pendingChecks: [], defaultBranch: 'main' };
    const asIs = qaInstructions({ ...pr, round: next.round, fixReason: 'qa', lastTestedSha: rec.testedSha, summary: rec.summary, fixInstructions: rec.fixInstructions });
    expect(asIs.retest).toContain('Old findings'); // without it, the same findings come back
    const fresh = qaInstructions({ ...pr, round: next.round, fixReason: next.fixReason, lastTestedSha: next.testedSha, summary: next.summary, fixInstructions: next.fixInstructions });
    expect(fresh.retest).toBe('');
  });

  it('changes nothing below the cap', () => {
    expect(freshRetry({ round: 2, retests: 0, mergeFixes: 0 })).toEqual({});
    expect(freshRetry({ round: MAX_QA_ROUNDS, retests: 1, mergeFixes: 0 })).toEqual({});
  });
});
