import { describe, expect, it } from 'vitest';
import { pullSkip } from './officePulls.ts';

// #632: the office takes on every trusted PR from the repo's own branches, whatever the branch is called.
const pr = (over: Partial<Parameters<typeof pullSkip>[0]> = {}) => ({ headRefName: 'fix/limit-clears-on-signin', isDraft: false, ...over });

describe('pullSkip', () => {
  it("owns a trusted fix/ PR like a swarm/ one", () => {
    expect(pullSkip(pr(), false)).toBeNull();
    expect(pullSkip(pr({ headRefName: 'swarm/issue-1-ada' }), false)).toBeNull();
  });

  it('leaves drafts, outsiders and manual PRs alone, and says why', () => {
    expect(pullSkip(pr({ isDraft: true }), false)).toBe('draft');
    expect(pullSkip(pr({ untrusted: true }), false)).toBe('outside');
    expect(pullSkip(pr({ untrusted: true, isDraft: true }), false)).toBe('outside');
    expect(pullSkip(pr({ manual: true }), false)).toBe('manual');
    expect(pullSkip(pr({ manual: true, headRefName: 'swarm/issue-1-ada' }), false)).toBe('manual');
  });

  it("with \"Leave my own PRs alone\" on, skips only branches the office didn't make", () => {
    expect(pullSkip(pr(), true)).toBe('own');
    expect(pullSkip(pr({ headRefName: 'swarm/issue-1-ada' }), true)).toBeNull();
  });
});
