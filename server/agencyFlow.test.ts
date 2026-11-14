import { describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { heardAtStart } from './managerAsks.ts';
import { Swarm } from './swarm.ts';
import type { OfficeTools } from './ceo.ts';
import type { PersistedRepo } from './swarm/model.ts';
import type { PhoneMessage } from '../shared/types.ts';
import { AGENCY_PLAYBOOK, AGENCY_QA_BRIEF, SCOUT_TOPIC, type AgencyState } from '../shared/agency.ts';

// #667 through the office: create_floor (gh faked by the demo backend) and the agency floor's approvals.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  officeTools(): OfficeTools;
  postMessage(from: PhoneMessage['from'], text: string): PhoneMessage;
  scoutTick(now: number): number[];
  ceoHeard: number[];
  state: { repos: PersistedRepo[]; messages: PhoneMessage[]; agency: AgencyState; requests: { repoId: string; kind: string; status: string }[]; research: { queue: { topic: string; repoId?: string }[]; job: { topic: string } | null }; ceo: { queue: { kind: string; text?: string }[] } };
};

async function office() {
  const backend = createDemoBackend();
  const createProject = vi.spyOn(backend, 'createProject');
  const createIssue = vi.spyOn(backend, 'createIssue');
  const swarm = new Swarm(backend);
  const o = swarm as unknown as Internals;
  o.ensureCeo([]);
  const ask = o.postMessage('manager', 'Open an agency floor');
  o.ceoHeard = heardAtStart({ kind: 'chat', messageIds: [ask.id] });
  const tools = o.officeTools();
  const floor = (name: string) => o.state.repos.find((r) => r.id.split('/')[1] === name);
  return { swarm, o, ask, tools, createProject, createIssue, floor };
}

const AGENCY = { name: 'Agency', repo_slug: 'agency', use_case: 'agency', description: 'Market research and plans' };

describe('create_floor', () => {
  it('refuses without the manager asking, and changes nothing', async () => {
    const { tools, createProject, floor } = await office();
    expect(await tools.call('create_floor', AGENCY)).toMatch(/^Refused: Only the manager can ask for this: pass asked_in/);
    expect(createProject).not.toHaveBeenCalled();
    expect(floor('agency')).toBeUndefined();
  });

  it('creates the private repo, registers the floor with its use case, QA brief, playbook and charter, and is idempotent', async () => {
    const { tools, ask, createProject, floor, o } = await office();
    const out = await tools.call('create_floor', { ...AGENCY, asked_in: ask.id });
    expect(out).toMatch(/^Created demo-co\/agency \(private\) as floor 1, Agency/);
    expect(createProject).toHaveBeenCalledWith(expect.any(String), 'agency', expect.objectContaining({ visibility: 'private', description: 'Market research and plans' }));
    const r = floor('agency')!;
    expect(r.setup?.useCase).toBe('agency');
    expect(r.qaBrief).toBe(AGENCY_QA_BRIEF);
    expect(r.playbook).toBe(AGENCY_PLAYBOOK);
    expect(r.mission).toBe('Market research and plans');
    expect(r.charter.standards).toContain('Each claim and price has a source link');
    expect(r.charter.nonGoals.join()).toMatch(/without the manager’s approval/);
    // Again, by name or by owner/name: the same floor, no second repo.
    expect(await tools.call('create_floor', { ...AGENCY, asked_in: ask.id })).toBe('Floor 1 is demo-co/agency already: nothing changed.');
    expect(await tools.call('create_floor', { ...AGENCY, repo_slug: 'demo-co/agency', asked_in: ask.id })).toMatch(/already/);
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(o.state.repos).toHaveLength(1);
  });

  it('connects a repo GitHub already has instead of creating it, and hires the team it asks for', async () => {
    const { tools, ask, createProject, floor, o } = await office();
    const out = await tools.call('create_floor', { name: 'Stars', repo_slug: 'demo-co/star-hopper', use_case: 'game-3d', description: 'A space game', team_size: 3, asked_in: ask.id });
    expect(out).toMatch(/^Connected demo-co\/star-hopper/);
    expect(createProject).not.toHaveBeenCalled();
    const r = floor('star-hopper')!;
    expect(r.setup?.useCase).toBe('game-3d');
    expect(r.qaBrief).toMatch(/3D \/ browser game checks/);
    expect(o.state.requests.filter((q) => q.repoId === r.id && q.kind === 'hire')).toHaveLength(2); // the first agent came with the floor
  });
});

describe('the agency floor', () => {
  async function agency() {
    const t = await office();
    const made = await t.tools.call('create_floor', { ...AGENCY, asked_in: t.ask.id });
    if (!t.floor('agency')) throw new Error(made);
    return { ...t, r: t.floor('agency')! };
  }
  const OPPS = [
    { slug: 'audits', title: 'Landing-page audits', revenue_month: 2000, cost_month: 200, effort_days: 4, days_to_first_dollar: 6, confidence: 0.5 },
    { slug: 'widget', title: 'Changelog widget', revenue_month: 900, effort_days: 20, days_to_first_dollar: 30 },
  ];

  it('ranks opportunities, shortlists the new top ones to the manager once, and files a plan on approval', async () => {
    const { tools, ask, r, o, createIssue } = await agency();
    const out = await tools.call('agency_opportunities', { floor: r.floor, opportunities: OPPS });
    expect(out.split('\n')[0]).toMatch(/^1\. Landing-page audits \(audits\): \$1,800\/mo profit.*score 90 \[shortlisted\]/);
    expect(out).toMatch(/Sent 2 to the manager/);
    const card = o.state.messages.at(-1)!;
    expect(card.suggestions).toEqual(['Approve audits', 'Approve widget', 'Not now']);
    expect(await tools.call('agency_opportunities', { floor: r.floor, opportunities: OPPS })).not.toMatch(/Sent/); // shown already
    expect(await tools.call('agency_decide', { id: 'audits', approve: true })).toMatch(/^Refused: Only the manager/);
    const decided = await tools.call('agency_decide', { id: 'audits', approve: true, route: 'build', asked_in: ask.id });
    expect(decided).toMatch(/^Approved Landing-page audits: filed #\d+ for plans\/audits\.md\. Once it merges, create_floor/);
    expect(createIssue).toHaveBeenCalledWith('demo-co/agency', 'Plan: Landing-page audits', expect.stringMatching(/Route: build[\s\S]*Expected earnings: \$1800 a month/));
    expect(o.state.agency.opportunities.find((x) => x.slug === 'audits')).toMatchObject({ status: 'approved', route: 'build' });
  });

  it('refuses agency tools on a floor that is not an agency', async () => {
    const { tools, ask } = await office();
    await tools.call('create_floor', { name: 'Shop', repo_slug: 'shop', use_case: 'web-app', description: 'A shop', asked_in: ask.id });
    expect(await tools.call('agency_opportunities', { floor: 1 })).toMatch(/^Refused: Floor 1 isn't an agency floor/);
  });

  it('keeps every external action behind the manager: proposed, refused until approved, done once', async () => {
    const { swarm, tools, ask, r, o } = await agency();
    await tools.call('agency_opportunities', { floor: r.floor, opportunities: OPPS });
    const proposal = { floor: r.floor, opportunity: 'audits', kind: 'proposal', target: 'Upwork job 123', summary: 'A $300 audit', draft: 'Hi! We audit landing pages.' };
    expect(await tools.call('agency_propose_action', proposal)).toMatch(/^Queued: ax-1 waits for the manager's Approve/);
    expect(await tools.call('agency_propose_action', proposal)).toMatch(/^Already waiting: ax-1/);
    expect(o.state.messages.at(-1)!.suggestions).toEqual(['Approve ax-1', 'Not now ax-1']);
    expect(await tools.call('agency_action_done', { id: 'ax-1', result: 'Sent' })).toMatch(/^Refused: ax-1 waits for the manager's approval/);
    // The manager taps Approve on the Company page: the CEO gets a job to do it.
    swarm.decideActionByManager('ax-1', { approve: true });
    expect(o.state.ceo.queue.at(-1)).toMatchObject({ kind: 'chat', text: expect.stringMatching(/approved ax-1/) });
    expect(await tools.call('agency_action_done', { id: 'ax-1', result: 'Sent' })).toBe('ax-1 marked done.');
    expect(await tools.call('agency_action_done', { id: 'ax-1', result: 'Sent' })).toMatch(/^Refused: ax-1 went out already/);
    // Not now from the manager's message: never goes out.
    await tools.call('agency_propose_action', { ...proposal, draft: 'Another draft' });
    expect(await tools.call('agency_decide', { id: 'ax-2', approve: false, asked_in: ask.id })).toBe("Not now: ax-2 won't go out.");
    expect(await tools.call('agency_action_done', { id: 'ax-2', result: 'Sent' })).toMatch(/^Refused: The manager said Not now/);
  });

  it('asks the Researcher for a market scan once a day per agency floor, from 8:00', async () => {
    const { o, r } = await agency();
    const at = (h: number) => new Date(2026, 10, 14, h).getTime();
    expect(o.scoutTick(at(6))).toEqual([]);
    expect(o.scoutTick(at(9))).toEqual([r.floor]);
    expect(o.scoutTick(at(15))).toEqual([]);
    const asked = [o.state.research.job, ...o.state.research.queue].filter((j) => j?.topic === SCOUT_TOPIC);
    expect(asked).toHaveLength(1);
  });

  it('puts the pipeline in the snapshot only once there is one', async () => {
    const { swarm, tools, r } = await agency();
    expect(swarm.snapshot()).not.toHaveProperty('agency');
    await tools.call('agency_opportunities', { floor: r.floor, opportunities: OPPS });
    expect(swarm.snapshot().agency?.opportunities.map((x) => x.slug)).toEqual(['audits', 'widget']);
  });
});
