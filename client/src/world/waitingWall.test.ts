import { describe, expect, it } from 'vitest';
import type { Decision } from '../../../shared/decisions';
import type { AgentView, HireRequestView, PullInfo, QaView, RepoView } from '../../../shared/types';
import { calmLine, waitingTarget, waitingTotal, waitingWall, wallRows, type WaitingWorld } from './waitingWall';

const NOW = 1_000_000;
const decision = (id: string, question: string, p: Partial<Decision> = {}) =>
  ({ id, kind: 'question', question, options: [], repoIds: [], about: [], messageId: null, askedAt: 0, lastAskedAt: 0, raised: 1, status: 'open', snoozedUntil: null, closedAt: null, outcome: null, ...p }) as Decision;
const pr = (number: number, state: PullInfo['state'] = 'OPEN') => ({ number, state }) as PullInfo;
const repo = (id: string, floor: number, pulls: PullInfo[]) => ({ id, floor, pulls, issues: [] }) as unknown as RepoView;
const qa = (repoId: string, prNumber: number, status: QaView['status'], ceoLooking = false) => ({ [`${repoId}#${prNumber}`]: { repoId, prNumber, status, ceoLooking } as QaView });
const agent = (id: string, name: string, p: Partial<AgentView> = {}) => ({ id, name, role: 'agent', status: 'idle', ...p }) as AgentView;

const EMPTY: WaitingWorld = { decisions: [], requests: [], repos: [], qa: {}, agents: {}, mergedToday: 0 };

const busy: WaitingWorld = {
  decisions: [
    decision('msg:1', 'Ship the dark theme?', { lastAskedAt: 10 }),
    decision('msg:2', 'Drop Windows CI?', { lastAskedAt: 40 }),
    decision('msg:3', 'Hire for floor 2?', { lastAskedAt: 30, kind: 'suggestion' }),
    decision('msg:4', 'Rename the repo?', { lastAskedAt: 20 }),
    decision('team:r1', 'Hire Ada?', { kind: 'team', lastAskedAt: 50 }), // counted as a team change
    decision('msg:5', 'Snoozed one', { lastAskedAt: 60, snoozedUntil: NOW + 1 }),
    decision('msg:6', 'Answered one', { lastAskedAt: 70, status: 'resolved' }),
  ],
  requests: [{ id: 'r1', status: 'pending' }, { id: 'r2', status: 'approved' }] as HireRequestView[],
  repos: [repo('acme/web', 3, [pr(1), pr(2), pr(3, 'MERGED')]), repo('acme/app', 1, [pr(7), pr(8)])],
  qa: { ...qa('acme/web', 1, 'needs-human'), ...qa('acme/web', 2, 'needs-human'), ...qa('acme/web', 3, 'needs-human'), ...qa('acme/app', 7, 'needs-human'), ...qa('acme/app', 8, 'needs-human', true) },
  agents: {
    a: agent('a', 'Grace', { status: 'done', waiting: 'manager' }),
    b: agent('b', 'Ada', { needsSignIn: true }),
    c: agent('c', 'Linus', { status: 'working', waiting: 'manager' }), // answered: back at work
    ceo: agent('ceo', 'Mimoun', { role: 'ceo', needsSignIn: true }),
  },
  mergedToday: 4,
};

describe('the "Waiting on you" wall screen', () => {
  it('counts open decisions with the newest three titles, team changes, needs-human PRs per floor and agents', () => {
    const s = waitingWall(busy, NOW);
    expect(s.decisions).toEqual({ count: 4, titles: ['Drop Windows CI?', 'Hire for floor 2?', 'Rename the repo?'] });
    expect(s.team).toBe(1);
    expect(s.prs).toEqual({ count: 3, floors: [{ floor: 1, count: 1 }, { floor: 3, count: 2 }] }); // the CEO triages #8; #3 merged
    expect(s.agents).toEqual({ count: 2, names: ['Ada', 'Grace'] });
    expect(waitingTotal(s)).toBe(10);
    expect(wallRows(s)).toEqual([
      { label: 'Decisions', value: 4, details: ['Drop Windows CI?', 'Hire for floor 2?', 'Rename the repo?'] },
      { label: 'Team change to approve', value: 1, details: [] },
      { label: 'PRs need you', value: 3, details: ['Floor 1: 1 · Floor 3: 2'] },
      { label: 'Agents need you', value: 2, details: ['Ada, Grace'] },
    ]);
  });

  it('a snoozed decision comes back when its snooze ends', () => {
    expect(waitingWall(busy, NOW + 2).decisions.titles[0]).toBe('Snoozed one');
  });

  it('shows nothing waiting, with the day’s merges as a calm stat', () => {
    const s = waitingWall({ ...EMPTY, mergedToday: 2 }, NOW);
    expect(waitingTotal(s)).toBe(0);
    expect(wallRows(s)).toEqual([]);
    expect(calmLine(s.mergedToday)).toBe('2 merged today');
    expect(calmLine(0)).toBe('No merges yet today');
  });

  it('opens the decisions in the chat first, then the approvals, then Mission control’s needs-you', () => {
    expect(waitingTarget(waitingWall(busy, NOW))).toEqual({ kind: 'phone', tab: 'chat' });
    const noDecisions = { ...busy, decisions: [] };
    expect(waitingTarget(waitingWall(noDecisions, NOW))).toEqual({ kind: 'phone', tab: 'hires' });
    expect(waitingTarget(waitingWall({ ...noDecisions, requests: [] }, NOW))).toEqual({ kind: 'manager', tab: 'ops' });
    expect(waitingTarget(waitingWall(EMPTY, NOW))).toEqual({ kind: 'manager', tab: 'ops' });
  });
});
