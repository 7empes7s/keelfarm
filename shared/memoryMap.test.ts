import { describe, expect, it } from 'vitest';
import { buildGraph, capGraph, filterGraph, localIds, mapChanges, mapInsights, nodeId, searchNodes, textRefs, type MapSource, type MemoryGraph } from './memoryMap.ts';
import { emptyCharterView } from './charter.ts';
import type { IssueInfo, PullInfo } from './types.ts';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const issue = (number: number, title: string, body = '', daysAgo = 1): IssueInfo => ({ number, title, body, url: '', labels: [], createdAt: iso(daysAgo) });
const pull = (number: number, closes: number[], p: Partial<PullInfo> = {}): PullInfo => ({
  number,
  title: `PR ${number}`,
  url: '',
  headRefName: `swarm/issue-${closes[0]}-ada`,
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: null,
  closesIssues: closes,
  createdAt: iso(1),
  mergedAt: null,
  additions: 10,
  deletions: 2,
  checks: 'passing',
  headSha: 'x',
  mergeState: 'CLEAN',
  failedChecks: [],
  pendingChecks: [],
  ...p,
});

function source(): MapSource {
  const charter = { ...emptyCharterView(), objectives: [{ id: 'O1', outcome: 'Works on a phone', measure: '390px' }, { id: 'O2', outcome: 'Fast', measure: 'p95' }], standards: ['Tests pass'] };
  return {
    now: NOW,
    company: 'Demo Co.',
    repos: [
      {
        id: 'o/web',
        fullName: 'o/web',
        floor: 1,
        summary: 'web',
        charter,
        issues: [issue(1, 'Dark mode', 'Objective: O1'), issue(2, 'Due dates', 'Depends on #1\n\nObjective: O1'), issue(3, 'Old thing', '', 10)],
        pulls: [
          pull(10, [1], { files: ['src/App.tsx', 'src/a.ts'] }),
          pull(11, [2], { files: ['src/App.tsx'] }),
          pull(12, [9], { state: 'MERGED', mergedAt: iso(2), files: ['src/App.tsx'], additions: 900, deletions: 0 }),
        ],
      },
      { id: 'o/api', fullName: 'o/api', floor: 2, summary: 'api', charter: emptyCharterView(), issues: [issue(1, 'Rate limit')], pulls: [] },
    ],
    agents: [
      { id: 'ceo', name: 'Mimoun', role: 'ceo', repoId: '', status: 'working', task: null, issueNumber: null, prNumber: null, costUsd: 3, startedAt: null },
      { id: 'a1', name: 'Ada', role: 'agent', repoId: 'o/web', status: 'working', task: 'issue', issueNumber: 1, prNumber: null, costUsd: 2, startedAt: null },
      { id: 'a2', name: 'Grace', role: 'agent', repoId: 'o/web', status: 'working', task: 'qa', issueNumber: 2, prNumber: 11, costUsd: 1, startedAt: null },
    ],
    qa: [{ repoId: 'o/web', prNumber: 11, status: 'testing', round: 2, devAgentId: 'a1', qaAgentId: 'a2', updatedAt: NOW, summary: null }],
    messages: [
      {
        id: 5,
        from: 'ceo',
        at: NOW - DAY,
        text: 'Plan',
        refs: [{ kind: 'floor', repoId: 'o/api', start: 0, end: 1 }],
        actions: [
          { tool: 'file_issue', icon: '📝', text: 'Filed floor 1 #2', ref: { kind: 'issue', repoId: 'o/web', number: 2 } },
          { tool: 'set_focus', icon: '🎯', text: 'Focus on O1', ref: { kind: 'floor', repoId: 'o/web' } },
          { tool: 'close_issue', icon: '🗂️', text: 'No', refused: true },
        ],
        artifacts: [{ id: '5-1', title: 'Plan for #3', lead: 'Ada first', markdown: 'Then floor 1 #10 and Grace.' }],
      },
    ],
    experiments: {
      experiments: [{ id: 'e1', name: 'Short prompts', hypothesis: 'h', variants: [], floors: ['o/web'], kinds: [], status: 'running', createdAt: NOW - DAY, startedAt: NOW - DAY, stoppedAt: null, seed: 1, minSample: 3, assigned: 1, result: {} as never }] as never,
      tags: [{ repoId: 'o/web', issue: 1, pr: null, experimentId: 'e1', variantId: 'b' }],
    },
  };
}

const has = (g: MemoryGraph, source: string, target: string, kind: string) => g.edges.some((e) => e.source === source && e.target === target && e.kind === kind);
const node = (g: MemoryGraph, id: string) => g.nodes.find((n) => n.id === id);

describe('buildGraph', () => {
  const g = buildGraph(source());
  const web = (n: number) => nodeId.issue('o/web', n);
  const pr = (n: number) => nodeId.pr('o/web', n);

  it('has the company, floors, objectives, standards, issues, PRs, QA, agents, the CEO, decisions, artifacts, files and experiments', () => {
    const types = new Set(g.nodes.map((n) => n.type));
    expect([...types].sort()).toEqual(['agent', 'artifact', 'ceo', 'company', 'decision', 'experiment', 'file', 'floor', 'issue', 'objective', 'pr', 'qa', 'standard'].sort());
    expect(g.edges.every((e) => node(g, e.source) && node(g, e.target))).toBe(true);
  });

  it('links issues to the objective they name, PRs to the issues they close and issues to what they wait for', () => {
    expect(has(g, web(1), nodeId.objective('o/web', 'O1'), 'serves')).toBe(true);
    expect(node(g, web(3))!.objective).toBeNull();
    expect(has(g, pr(10), web(1), 'closes')).toBe(true);
    expect(node(g, pr(10))!.objective).toBe('O1'); // a PR serves its issue's objective
    expect(has(g, web(2), web(1), 'depends')).toBe(true);
  });

  it('knows a closed issue through the PR that merged it, and the floor it merged into', () => {
    expect(node(g, web(9))).toMatchObject({ status: 'closed' });
    expect(has(g, pr(12), nodeId.floor('o/web'), 'merged')).toBe(true);
  });

  it('links agents to what they build, test and fix, and gives statuses for the rings', () => {
    expect(has(g, nodeId.agent('a1'), web(1), 'built')).toBe(true);
    expect(has(g, nodeId.agent('a1'), pr(11), 'built')).toBe(true); // QA's dev agent
    expect(has(g, nodeId.agent('a2'), nodeId.qa('o/web', 11), 'tested')).toBe(true);
    expect(has(g, nodeId.qa('o/web', 11), pr(11), 'round')).toBe(true);
    expect(node(g, web(1))!.status).toBe('building'); // an agent is on it
    expect(node(g, pr(11))!.status).toBe('qa');
    expect(node(g, pr(12))!.status).toBe('merged');
    expect(node(g, web(2))!.status).toBe('qa'); // its PR is in QA
  });

  it('turns the CEO actions into filed issues and decisions, skipping refused ones', () => {
    expect(has(g, nodeId.agent('ceo'), web(2), 'filed')).toBe(true);
    expect(has(g, nodeId.agent('ceo'), 'decision:5-1', 'decided')).toBe(true);
    expect(has(g, 'decision:5-1', nodeId.floor('o/web'), 'decided')).toBe(true);
    expect(node(g, 'decision:5-2')).toBeUndefined();
  });

  it("links an artifact to what its message's refs and its text name", () => {
    const art = 'art:5-1';
    expect(has(g, art, nodeId.floor('o/api'), 'mentions')).toBe(true); // the message's ref
    expect(has(g, art, web(3), 'mentions')).toBe(true); // "#3": only floor 1 has it
    expect(has(g, art, pr(10), 'mentions')).toBe(true); // "floor 1 #10"
    expect(has(g, art, nodeId.agent('a1'), 'mentions')).toBe(true); // Ada
    expect(has(g, art, nodeId.agent('a2'), 'mentions')).toBe(true); // Grace
  });

  it('makes file nodes only for files several PRs change, and marks open PRs on the same file as overlapping', () => {
    expect(node(g, nodeId.file('o/web', 'src/App.tsx'))).toBeDefined();
    expect(node(g, nodeId.file('o/web', 'src/a.ts'))).toBeUndefined();
    expect(has(g, pr(12), nodeId.file('o/web', 'src/App.tsx'), 'touches')).toBe(true);
    expect(has(g, pr(10), pr(11), 'overlap')).toBe(true);
    expect(g.edges.some((e) => e.kind === 'overlap' && (e.source === pr(12) || e.target === pr(12)))).toBe(false); // merged: no conflict risk
  });

  it('links experiments to their issues', () => {
    expect(has(g, 'exp:e1', web(1), 'trial')).toBe(true);
  });

  it('weighs nodes by links, size, QA rounds and cost', () => {
    expect(node(g, pr(12))!.weight).toBeGreaterThan(node(g, pr(10))!.weight); // 900 lines
    expect(node(g, pr(11))!.weight).toBeGreaterThan(node(g, pr(10))!.weight); // a second QA round
    expect(node(g, 'company')!.weight).toBeGreaterThan(node(g, web(3))!.weight);
  });
});

describe('textRefs', () => {
  const src = source();
  it('leaves a bare #N two floors share alone, and resolves it with the floor named', () => {
    expect(textRefs('see #1', src)).toEqual([]);
    expect(textRefs('see floor 2 #1', src)).toEqual([nodeId.issue('o/api', 1)]);
  });
  it('finds agents by name, not inside other words', () => {
    expect(textRefs('Adamant', src)).toEqual([]);
    expect(textRefs('@Ada did it', src)).toEqual([nodeId.agent('a1')]);
  });
});

describe('caps', () => {
  it('drops work older than the window but keeps the skeleton and open work', () => {
    const g = buildGraph(source(), { sinceDays: 5, maxNodes: 999 });
    expect(node(g, nodeId.issue('o/web', 3))).toBeDefined(); // open, 10 days old
    const old = buildGraph({ ...source(), messages: source().messages.map((m) => ({ ...m, at: NOW - 30 * DAY })) }, { sinceDays: 5, maxNodes: 999 });
    expect(node(old, 'art:5-1')).toBeUndefined();
    expect(old.hidden).toBeGreaterThan(0);
  });

  it('keeps the heaviest when there are too many, and never a dangling edge', () => {
    const full = buildGraph(source(), { sinceDays: 999, maxNodes: 999 });
    const g = capGraph(full, { sinceDays: 999, maxNodes: 12 }, NOW);
    expect(g.nodes.length).toBe(12);
    expect(g.hidden).toBe(full.nodes.length - 12);
    for (const t of ['company', 'floor', 'objective', 'agent', 'ceo']) expect(g.nodes.filter((n) => n.type === t).length).toBe(full.nodes.filter((n) => n.type === t).length);
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(g.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });
});

describe('navigating', () => {
  const g = buildGraph(source());
  it('local graph depth 1-3 grows outwards', () => {
    const one = localIds(g, nodeId.issue('o/web', 1), 1);
    const two = localIds(g, nodeId.issue('o/web', 1), 2);
    expect(one.has(nodeId.pr('o/web', 10))).toBe(true);
    expect(one.has(nodeId.floor('o/web'))).toBe(false);
    expect(two.has(nodeId.floor('o/web'))).toBe(true);
    expect(localIds(g, nodeId.issue('o/web', 1), 3).size).toBeGreaterThan(two.size);
    expect(localIds(g, nodeId.issue('o/web', 1), 9).size).toBe(localIds(g, nodeId.issue('o/web', 1), 3).size);
  });

  it('filters by type, floor, status, objective, agent and time', () => {
    const ids = (f: Parameters<typeof filterGraph>[1]) => new Set(filterGraph(g, f).nodes.map((n) => n.id));
    expect([...ids({ hiddenTypes: ['issue'] })].some((id) => id.startsWith('issue:'))).toBe(false);
    expect([...ids({ repoId: 'o/api' })].every((id) => id.includes('o/api'))).toBe(true);
    expect(ids({ status: 'merged' })).toEqual(new Set(['company', nodeId.floor('o/web'), nodeId.floor('o/api'), nodeId.pr('o/web', 12)]));
    expect(ids({ objective: nodeId.objective('o/web', 'O1') }).has(nodeId.pr('o/web', 10))).toBe(true);
    expect(ids({ objective: nodeId.objective('o/web', 'O1') }).has(nodeId.floor('o/api'))).toBe(false);
    expect(ids({ agentId: nodeId.agent('a2') }).has(nodeId.pr('o/web', 11))).toBe(true);
    const then = ids({ until: NOW - 5 * DAY });
    expect(then.has(nodeId.issue('o/web', 3))).toBe(true);
    expect(then.has(nodeId.issue('o/web', 1))).toBe(false);
    const f = filterGraph(g, { repoId: 'o/api' });
    expect(f.edges.every((e) => f.nodes.some((n) => n.id === e.source) && f.nodes.some((n) => n.id === e.target))).toBe(true);
  });

  it('searches by number, title and name', () => {
    expect(searchNodes(g, '#12')[0].id).toBe(nodeId.pr('o/web', 12));
    expect(searchNodes(g, 'dark')[0].id).toBe(nodeId.issue('o/web', 1));
    expect(searchNodes(g, 'grace')[0].id).toBe(nodeId.agent('a2'));
    expect(searchNodes(g, '')).toEqual([]);
    expect(searchNodes(g, 'nothing like it')).toEqual([]);
  });
});

describe('mapInsights', () => {
  it('finds the busiest objective, hottest files, stalled and untagged issues and the most connected agents', () => {
    const by = Object.fromEntries(mapInsights(buildGraph(source()), NOW).map((i) => [i.id, i]));
    expect(by.objective.value).toBe('O1 · 2 issues');
    expect(by.files.ids[0]).toBe(nodeId.file('o/web', 'src/App.tsx'));
    expect(by.files.value).toBe('App.tsx · 3 PRs');
    expect(by.stalled.ids).toEqual([nodeId.issue('o/web', 3)]);
    expect(by.untagged.ids).toEqual([nodeId.issue('o/web', 3)]); // floor 2 has no charter; #9 is closed
    expect(by.agents.ids[0]).toBe(nodeId.agent('a1'));
  });
});

describe('mapChanges', () => {
  it('pulses new nodes and changed statuses, and bursts merges', () => {
    const before = buildGraph(source());
    const src = source();
    src.repos[0].pulls[0] = { ...src.repos[0].pulls[0], state: 'MERGED', mergedAt: iso(0) };
    src.repos[1].issues.push(issue(7, 'New'));
    const after = buildGraph(src);
    const changes = mapChanges(before, after);
    expect(changes).toContainEqual({ id: nodeId.pr('o/web', 10), kind: 'merged' });
    expect(changes).toContainEqual({ id: nodeId.issue('o/api', 7), kind: 'new' });
    expect(mapChanges(null, after)).toEqual([]);
    expect(mapChanges(after, after)).toEqual([]);
  });
});
