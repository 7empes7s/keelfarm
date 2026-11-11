import { describe, expect, it } from 'vitest';
import type { PullInfo } from '../../../shared/types';
import { prPage, prPreview } from './prNav';

const repo = { id: 'r1', pulls: [{ number: 7, state: 'OPEN' }, { number: 5, state: 'MERGED', headSha: 'abcdef1234' }, { number: 3, state: 'CLOSED' }] as PullInfo[] };

describe('prPage', () => {
  it("opens an open PR's page, not the preview", () => {
    expect(prPage(repo, 7)).toEqual({ kind: 'card', repoId: 'r1', key: 'pr-7', number: 7, pr: true });
  });
  it("opens a merged PR's card", () => {
    expect(prPage(repo, 5)).toEqual({ kind: 'card', repoId: 'r1', key: 'm-5', number: 5, pr: true });
  });
  it("is null for a closed or unknown PR (it's only on GitHub)", () => {
    expect(prPage(repo, 3)).toBeNull();
    expect(prPage(repo, 99)).toBeNull();
  });
});

describe('prPreview', () => {
  it('opens the app viewer on an open PR', () => {
    expect(prPreview(repo, 7)).toEqual({ kind: 'app', repoId: 'r1', pr: 7 });
  });
  it('opens main, where it is now, for a merged PR, and for anything else', () => {
    expect(prPreview(repo, 5)).toEqual({ kind: 'app', repoId: 'r1', pr: null, merged: { pr: 5, sha: 'abcdef1', path: '/' } });
    expect(prPreview(repo, 3)).toEqual({ kind: 'app', repoId: 'r1', pr: null });
  });
});
