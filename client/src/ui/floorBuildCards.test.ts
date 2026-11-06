import { describe, expect, it } from 'vitest';
import type { PrPreviewView, PullInfo, QaView, RepoView } from '../../../shared/types';
import { floorBuilds } from './floorBuildCards';

const pull = (number: number, state: PullInfo['state'], at: string) =>
  ({ number, title: `PR ${number}`, state, createdAt: at, mergedAt: state === 'MERGED' ? at : null }) as PullInfo;
const repo = (...pulls: PullInfo[]) => ({ id: 'acme/app', pulls, preview: { status: 'running' } }) as RepoView;
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

  it('keep only the latest merges', () => {
    const r = repo(...[1, 2, 3, 4, 5].map((n) => pull(n, 'MERGED', `2026-11-0${n}T10:00:00Z`)));
    expect(floorBuilds(r, [], {}, {}).map((c) => c.pr)).toEqual([null, 5, 4, 3]);
  });
});
