import { describe, expect, it } from 'vitest';
import type { OfficeTools } from './ceo.ts';
import { ceoSystemPrompt } from './ceo.ts';
import { createDemoBackend } from './demo.ts';
import { compactStatus, DEFAULT_MODEL, floorDetail, type FullStatus, type StatusFloor } from './statusViews.ts';
import { Swarm } from './swarm.ts';

// company_status's compact view and floor_detail (#329).

const words = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w} ${i}`).join(' ');

/** A busy floor as the full company_status has it: long texts, 30 issues, 6 PRs, 8 merges. */
function floor(n: number): StatusFloor {
  return {
    floor: n,
    repo: `acme/app-${n}`,
    description: 'A shop for socks',
    clone: `/clones/acme/app-${n}`,
    charter: `# Charter\n${words(200, 'objective')}`,
    charterProposalWaiting: false,
    profile: 'Web shop · React + Express',
    qaBrief: words(250, 'check'),
    playbook: words(250, 'rule'),
    preview: { command: 'npm run dev', env: { PORT: '6301' }, status: 'running' },
    autoAssign: true,
    autoMerge: true,
    team: { size: 3, max: 10, free: 1, pendingHires: 0, pendingLetGos: 0 },
    throughput: { mergedToday: 4 },
    spend: { todayUsd: 3 },
    capacity: { issuesReadyToStart: 20, prsAwaitingQa: 2 },
    agents: [
      { id: `a${n}1`, name: 'Ada', status: 'working', doing: 'issue #1', codingAgent: 'claude', model: DEFAULT_MODEL, effort: 'medium' },
      { id: `a${n}2`, name: 'Bo', status: 'free', doing: null, codingAgent: 'codex', model: 'gpt-5', effort: 'high' },
    ],
    backlog: Array.from({ length: 30 }, (_, i) => ({
      number: i + 1,
      title: `Issue ${i + 1}: ${words(12, 'detail')}`,
      waitsFor: i === 2 ? [1] : [],
      inProgress: i < 2,
      ...(i === 3 && { waitsForManager: 'untrusted author @x; never built until the manager trusts it' }),
    })),
    pullRequests: Array.from({ length: 6 }, (_, i) => ({ number: 100 + i, title: `PR ${i}: ${words(15, 'change')}`, qa: 'passed', merge: null, checks: 'passing' })),
    mergedRecently: Array.from({ length: 8 }, (_, i) => `#${90 + i} ${words(14, 'merged')}`),
    questions: [],
  };
}

const decision = (i: number) => ({ id: `r${i}`, kind: 'hire', floor: 1, name: `Agent ${i}`, reason: words(60, 'because'), status: 'approved', managerNote: null });

const full: FullStatus = {
  company: { ceo: 'Mimoun', scaling: 'the manager approves every team change', usage: 'normal', accounts: ['main (claude, login): ok'], officePlaybook: words(150, 'office') },
  floors: [floor(1), floor(2), floor(3)],
  pendingChanges: [decision(0)],
  recentDecisions: Array.from({ length: 10 }, (_, i) => decision(i + 1)),
  openDecisions: [{ id: 'd1', question: 'Ship it?' }],
};

const ctx = { focus: (n: number) => `O${n} first`, defaultEffort: 'medium' };

describe('compactStatus', () => {
  const compact = compactStatus(full, ctx);
  const text = JSON.stringify(compact);

  it('drops the long texts: charter, QA brief, playbooks and preview', () => {
    for (const f of compact.floors) for (const key of ['charter', 'qaBrief', 'playbook', 'preview']) expect(f).not.toHaveProperty(key);
    expect(compact.company).not.toHaveProperty('officePlaybook');
    expect(text).not.toContain('objective 1');
    expect(text).not.toContain('check 1');
    expect(text).not.toContain('rule 1');
    expect(text).not.toContain('npm run dev');
  });

  it('keeps each floor, its focus, team, numbers and agents, with model and effort only when not the default', () => {
    const f = compact.floors[1];
    expect(f).toMatchObject({ floor: 2, repo: 'acme/app-2', clone: '/clones/acme/app-2', profile: 'Web shop · React + Express', focus: 'O2 first', autoAssign: true, autoMerge: true });
    expect(f).toHaveProperty('team.free', 1);
    expect(f).toHaveProperty('throughput.mergedToday', 4);
    expect(f).toHaveProperty('capacity.prsAwaitingQa', 2);
    expect(f).toHaveProperty('spend.todayUsd', 3);
    expect(f.agents).toEqual([
      { id: 'a21', name: 'Ada', status: 'working', doing: 'issue #1', codingAgent: 'claude' },
      { id: 'a22', name: 'Bo', status: 'free', doing: null, codingAgent: 'codex', model: 'gpt-5', effort: 'high' },
    ]);
  });

  it('counts the backlog and names only what is in progress, what waits and the first 10 ready', () => {
    const f = compact.floors[0];
    expect(f.backlogCounts).toEqual({ open: 30, ready: 26, waiting: 2, inProgress: 2 });
    expect(f.backlog.map((i) => [i.number, i.state])).toEqual([
      [1, 'in progress'],
      [2, 'in progress'],
      [3, 'waiting'],
      [4, 'waiting'],
      ...Array.from({ length: 10 }, (_, i) => [i + 5, 'ready']),
    ]);
    expect(f.backlog[2]).toMatchObject({ waitsFor: [1] });
    expect(f.backlog[3].waitsForManager).toMatch(/untrusted/);
  });

  it('keeps PRs and 5 merges with short titles, the company line and only the last 3 decisions', () => {
    const f = compact.floors[0];
    expect(f.pullRequests).toHaveLength(6);
    expect(f.pullRequests[0]).toMatchObject({ number: 100, qa: 'passed', merge: null, checks: 'passing' });
    expect(f.pullRequests[0].title.length).toBeLessThanOrEqual(70);
    expect(f.mergedRecently).toHaveLength(5);
    expect(compact.company).toMatchObject({ usage: 'normal', accounts: ['main (claude, login): ok'] });
    expect(compact.pendingChanges).toHaveLength(1);
    expect(compact.openDecisions).toEqual([{ id: 'd1', question: 'Ship it?' }]);
    expect(compact.recentDecisions.map((d) => d.name)).toEqual(['Agent 8', 'Agent 9', 'Agent 10']);
    expect(compact.recentDecisions[0]).toEqual({ kind: 'hire', floor: 1, name: 'Agent 8', status: 'approved', managerNote: null, reason: expect.any(String) });
    expect(compact.recentDecisions[0].reason.length).toBeLessThanOrEqual(120);
  });

  it('is at least 60% smaller than the full status for 3 floors', () => {
    const before = JSON.stringify(full, null, 1).length;
    const after = JSON.stringify(compact, null, 1).length;
    expect(after / before).toBeLessThanOrEqual(0.4);
  });
});

describe('floorDetail', () => {
  it("returns one floor as the full status has it, with the office playbook", () => {
    expect(floorDetail(full, 2)).toEqual({ ...full.floors[1], officePlaybook: full.company.officePlaybook });
  });

  it('names the floors when there is no such floor', () => {
    expect(() => floorDetail(full, 7)).toThrow('No floor 7; floors are 1, 2, 3.');
    expect(() => floorDetail({ ...full, floors: [] }, 1)).toThrow('No floor 1; there are no floors yet.');
  });
});

describe('company_status and floor_detail as the CEO calls them', () => {
  type Internals = { ensureCeo(interrupted: unknown[]): void; officeTools(): OfficeTools };

  it('gives the compact view by default, the full one with full: true, and one floor in floor_detail', async () => {
    const swarm = new Swarm(createDemoBackend());
    await swarm.connectRepo('demo-co/pixel-todo', {});
    const internals = swarm as unknown as Internals;
    internals.ensureCeo([]);
    swarm.setOfficePlaybook('- Run the tests first');
    const tools = internals.officeTools();
    const compact = JSON.parse(await tools.call('company_status', {})) as FullStatus;
    const whole = JSON.parse(await tools.call('company_status', { full: true })) as FullStatus;
    expect(compact.floors[0]).not.toHaveProperty('qaBrief');
    expect(compact.company).not.toHaveProperty('officePlaybook');
    expect(Object.keys(whole.floors[0])).toEqual(expect.arrayContaining(['charter', 'profile', 'qaBrief', 'playbook', 'preview', 'backlog', 'pullRequests']));
    expect(whole.company.officePlaybook).toBe('- Run the tests first');
    const detail = JSON.parse(await tools.call('floor_detail', { floor: 1 })) as StatusFloor;
    const { charter, profile, qaBrief, playbook, preview, backlog } = whole.floors[0]; // the demo's numbers move on between calls
    expect(detail).toMatchObject({ charter, profile, qaBrief, playbook, preview, backlog, officePlaybook: '- Run the tests first' });
    expect(await tools.call('floor_detail', { floor: 4 })).toBe('Refused: No floor 4; floors are 1.');
  });

  it("puts the office playbook in the CEO's system prompt instead", () => {
    const o = { name: 'Mimoun', company: 'Acme', manager: '', notesFile: 'NOTES.md', sessionLimit: 0, maxAgents: 10, scaling: 'approve' as const };
    expect(ceoSystemPrompt({ ...o, officePlaybook: '- Run the tests first' })).toContain('The office playbook (every build, fix and QA prompt starts with it; set_office_playbook replaces it whole):\n- Run the tests first');
    expect(ceoSystemPrompt(o)).not.toContain('The office playbook (');
    expect(ceoSystemPrompt(o)).toContain('floor_detail');
  });
});
