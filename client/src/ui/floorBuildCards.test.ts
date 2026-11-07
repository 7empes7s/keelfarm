import { describe, expect, it } from 'vitest';
import type { PrPreviewView, PullInfo, QaView, RepoView } from '../../../shared/types';
import { cardAction, cardActionLabel, floorBuilds, type BuildCard } from './floorBuildCards';

const pull = (number: number, state: PullInfo['state'], at: string) =>
  ({ number, title: `PR ${number}`, state, createdAt: at, mergedAt: state === 'MERGED' ? at : null }) as PullInfo;
const repo = (...pulls: PullInfo[]) => ({ id: 'acme/app', fullName: 'acme/app', pulls, preview: { status: 'running' } }) as RepoView;
const agent = (id: string, over: Record<string, unknown> = {}) => ({ id, repoId: 'acme/app', role: 'agent', status: 'idle', task: null, issueNumber: null, issueTitle: null, prNumber: null, startedAt: null, ...over });

describe("a floor's build cards", () => {
  it('put the live app first, then the newest work', () => {
    const r = repo(pull(4, 'OPEN', '2026-11-01T10:00:00Z'), pull(3, 'MERGED', '2026-11-02T10:00:00Z'), pull(2, 'CLOSED', '2026-11-03T10:00:00Z'));
    const builder = agent('ada', { status: 'working', task: 'issue', issueNumber: 9, issueTitle: 'Dark mode', startedAt: Date.parse('2026-11-05T10:00:00Z') });
    const cards = floorBuilds(r, [builder], {}, {});
    expect(cards.map((c) => [c.key, c.status, c.preview])).toEqual([
      ['main', 'live', 'running'],
      ['issue-9', 'building', null],
      ['pr-3', 'merged', 'running'], // on main now
      ['pr-4', 'open', 'stopped'],
    ]);
    expect(cards[1].agentId).toBe('ada');
  });

  it("show QA's state, its screenshot, the author and the PR's own preview", () => {
    const r = repo(pull(5, 'OPEN', '2026-11-01T10:00:00Z'));
    const qa = { 'acme/app#5': { status: 'testing', devAgentId: 'bo', updatedAt: 42, shots: [{ caption: 'Desktop', page: null, mime: 'image/png' }] } as QaView };
    const previews = { 'acme/app#5': { status: 'error' } as PrPreviewView };
    const [, card] = floorBuilds(r, [], qa, previews);
    expect(card).toMatchObject({ pr: 5, status: 'qa', agentId: 'bo', preview: 'error', shot: '/api/repos/acme%2Fapp/pulls/5/qa-shots/0?v=42' });
  });

  it("leave out an open PR from outside, which the office never previews (#185)", () => {
    const r = repo(pull(6, 'OPEN', '2026-11-01T10:00:00Z'), { ...pull(7, 'OPEN', '2026-11-01T11:00:00Z'), untrusted: true });
    expect(floorBuilds(r, [], {}, {}).map((c) => c.key)).toEqual(['main', 'pr-6']);
  });

  it('keep only the latest merges', () => {
    const r = repo(...[1, 2, 3, 4, 5].map((n) => pull(n, 'MERGED', `2026-11-0${n}T10:00:00Z`)));
    expect(floorBuilds(r, [], {}, {}).map((c) => c.pr)).toEqual([null, 5, 4, 3]);
  });
});

describe('tapping a build card (#225)', () => {
  const card = (over: Partial<BuildCard>): BuildCard => ({ key: 'k', pr: null, title: 't', status: 'open', agentId: null, shot: null, preview: 'stopped', at: 0, ...over });

  it('opens something for every kind of card, or the card is not a button', () => {
    const cases: [Partial<BuildCard>, ReturnType<typeof cardAction>, string | null][] = [
      [{ status: 'live', preview: 'running' }, { kind: 'app', pr: null }, 'Open preview'],
      [{ status: 'building', preview: null, agentId: 'ada' }, { kind: 'terminal', agentId: 'ada' }, 'Watch them build'],
      [{ status: 'building', preview: null }, null, null], // nobody's terminal to watch: nothing to open
      [{ status: 'qa', pr: 5, preview: 'starting' }, { kind: 'app', pr: 5 }, 'Starting…'],
      [{ status: 'open', pr: 6, preview: 'error' }, { kind: 'app', pr: 6 }, "Didn't run: see why"],
      [{ status: 'merged', pr: 3, preview: 'running', merged: { sha: 'abc1234', path: '/settings' } }, { kind: 'app', pr: null, merged: { pr: 3, sha: 'abc1234', path: '/settings' } }, 'Open on main'],
      [{ status: 'merged', pr: 3, preview: 'error' }, { kind: 'app', pr: null, merged: { pr: 3, sha: '', path: '/' } }, "Didn't run: see why"], // main's error and log
    ];
    for (const [over, action, label] of cases) {
      const c = card(over);
      expect(cardAction(c)).toEqual(action);
      expect(cardActionLabel(c, cardAction(c))).toBe(label);
    }
  });

  it("gives a merged PR's card its commit and first changed page, where main opens", () => {
    const p = { ...pull(3, 'MERGED', '2026-11-02T10:00:00Z'), headSha: 'abc1234def', files: ['client/src/pages/Settings.tsx'] };
    const [, merged] = floorBuilds(repo(p), [], {}, {});
    expect(merged.merged?.sha).toBe('abc1234');
    expect(cardAction(merged)).toMatchObject({ kind: 'app', pr: null, merged: { pr: 3, sha: 'abc1234' } });
  });
});
