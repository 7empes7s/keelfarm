// The demo office's notification centre (#107): a made-up mix of the last day, one of every kind, so the bell, the
// centre's groups and filters and each action have something to show before the demo's own events arrive.
import { makeNotice, type NoticeInput } from '../shared/notices.ts';
import { CEO_ID, type NoticeView } from '../shared/types.ts';

const MIN = 60_000;

export function sampleNotices(repos: { id: string; floor: number }[], agents: { id: string; name: string; repoId: string; role: string }[], now: number): NoticeView[] {
  const r = repos[0];
  if (!r) return [];
  const r2 = repos[1] ?? r;
  const devs = agents.filter((a) => a.role !== 'ceo');
  const dev = devs[0] ?? { id: CEO_ID, name: 'Someone', repoId: r.id };
  const other = devs.find((a) => a.repoId === r2.id) ?? dev;
  const at = (minsAgo: number) => now - minsAgo * MIN;
  const floorOf = (id: string) => repos.find((x) => x.id === id)?.floor;
  const list: [number, NoticeInput, boolean][] = [
    [3, { kind: 'needsYou', title: 'PR #12 needs you', text: 'It failed QA 3 times: the login form still overflows at 390 px.', target: { kind: 'qa', repoId: r.id, number: 12 }, actions: ['openQa', 'openPr'] }, false],
    [9, { kind: 'ceo', title: 'CEO', text: 'Floor 1 merged three PRs this morning; I queued the next two issues.', actions: ['reply'] }, false],
    [21, { kind: 'qaPass', title: `${other.name} passed PR #8`, text: "It merges once GitHub's checks are green", target: { kind: 'qa', repoId: r2.id, number: 8 }, actions: ['openQa', 'openPr'] }, false],
    [34, { kind: 'stuck', title: `${dev.name} needs help`, text: 'In an error for 12 minutes: npm ci failed with ENOSPC.', target: { kind: 'agent', agentId: dev.id, terminal: true }, actions: ['terminal', 'retry'] }, false],
    [52, { kind: 'approval', title: `Floor ${r.floor}: 3 → 4 agents?`, text: 'The CEO would add a developer: the backlog grew by six issues.', target: { kind: 'floor', repoId: r.id }, actions: ['approvals'] }, true],
    [80, { kind: 'merge', title: 'Merged PR #7 into main', text: 'Dark mode for the settings page', target: { kind: 'issue', repoId: r.id, number: 7 }, actions: ['openPr'] }, true],
    [130, { kind: 'qaFail', title: `${other.name} failed PR #9`, text: 'Back to the developer with the findings', target: { kind: 'qa', repoId: r2.id, number: 9 }, actions: ['openQa', 'openPr'] }, true],
    [200, { kind: 'error', title: `${dev.name} hit a problem`, text: 'On #14: the session ended without a pull request.', target: { kind: 'agent', agentId: dev.id, terminal: true }, actions: ['terminal', 'retry'] }, true],
    [26 * 60, { kind: 'usage', title: 'Pacing new work', text: 'Claude warned that usage is high, so new issues start slowly until 18:00.' }, true],
    [28 * 60, { kind: 'update', level: 'success', title: 'The office updated', text: 'Three new commits; every agent carried on.' }, true],
  ];
  return list.map(([mins, input, read], i) => {
    const t = input.target;
    const floor = !t ? undefined : t.kind === 'agent' ? floorOf(agents.find((a) => a.id === t.agentId)?.repoId ?? '') : floorOf(t.repoId);
    return { ...makeNotice({ ...input, floor }, `demo-${i}`, at(mins)), read };
  });
}
