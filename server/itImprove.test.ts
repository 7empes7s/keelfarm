import { describe, expect, it, vi } from 'vitest';
import type { ItJob } from '../shared/itDept.ts';
import type { ItImproveState } from '../shared/itImprove.ts';
import type { TicketsState } from '../shared/itTickets.ts';
import type { Backend } from './backend.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// IT's continuous improvement (#543): closed tickets become records, the review's proposal is a card, and Approve files
// the issue on its floor (fake GitHub) or adds the line through the CEO's own set_office_playbook / set_floor_profile.
type Agent = { id: string; name: string; role: string; repoId: string };
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  itReport(raw: unknown, who: { id: string; name: string }): string;
  itTicket(a: { id: number; close?: string; cause?: string }): Promise<string>;
  itReview(a: { days?: number }): string;
  itImprove(a: { proposals: unknown[] }): string;
  itDecide(verdict: 'approve' | 'decline', id: string): Promise<string>;
  enqueueIt(job: ItJob): void;
  setOfficePlaybook(text: unknown): string;
  setFloorProfile(x: { floor: number; qa_brief?: string; playbook?: string }): string;
  state: { agents: Agent[]; itTickets: TicketsState; itImprove: ItImproveState; settings: { officePlaybook: string }; repos: { id: string; floor: number; fullName: string; qaBrief?: string }[] };
};

async function office() {
  const backend = createDemoBackend();
  const filed: { fullName: string; title: string; body: string }[] = [];
  const create = backend.createIssue;
  (backend as Backend).createIssue = async (fullName, title, body, labels) => {
    filed.push({ fullName, title, body });
    return create(fullName, title, body, labels);
  };
  const swarm = new Swarm(backend);
  await swarm.connectRepo('demo-co/pixel-todo', {});
  const second = await swarm.connectRepo('demo-co/star-hopper', {});
  swarm.hireAgent(second.id, { name: 'Dennis' });
  const x = swarm as unknown as Internals;
  x.ensureCeo([]);
  x.enqueueIt = () => undefined; // IT's session is the demo's: here its tool calls are made by the test
  const dennis = x.state.agents.find((a) => a.name === 'Dennis')!;
  return { swarm, x, dennis, filed };
}

const oom = { what: 'Test lab: oom', where: 'lab', evidence: 'npm test: exit code 137', blocking: true };

describe("IT's records and the weekly review's cards", () => {
  it('a closed ticket is a record with its cause and minutes; a repeat after the close is recurring', async () => {
    const { x, dennis } = await office();
    x.itReport(oom, dennis);
    await x.itTicket({ id: 1, close: 'Asked for two workers.', cause: 'Lab OOM: too many workers' });
    x.itReport({ ...oom, what: 'vitest killed (137)' }, dennis);
    await x.itTicket({ id: 2, close: 'Again.', cause: 'Lab OOM: too many workers' });
    const [second, first] = x.state.itImprove.records;
    expect(first).toMatchObject({ id: 1, key: 'lab:lab oom too many workers', fix: 'Asked for two workers.', agents: [dennis.id] });
    expect(second).toMatchObject({ id: 2, recurOf: 1 });
    expect(x.itReview({})).toMatch(/1\. \[recurring\] cause "lab:lab oom too many workers" \(Lab OOM: too many workers\): 2 tickets/);
  });

  it("Approve on an issue card files it on the card's floor and the record links to it", async () => {
    const { swarm, x, dennis, filed } = await office();
    x.itReport(oom, dennis);
    await x.itTicket({ id: 1, close: 'Two workers.' });
    const floor2 = x.state.repos.find((r) => r.floor === 2)!;
    expect(x.itImprove({ proposals: [{ cause: 'lab:test lab oom', kind: 'issue', floor: 2, title: 'Run the lab suite with 2 workers', why: '1 ticket', body: 'What, where, acceptance.' }] })).toMatch(/^1 card for the manager/);
    const card = x.state.itImprove.cards[0];
    expect(filed).toEqual([]); // nothing changes without a tap
    const { change } = await swarm.improveApprove(card.id);
    expect(filed).toEqual([expect.objectContaining({ fullName: floor2.fullName, title: 'Run the lab suite with 2 workers', body: expect.stringContaining('What, where, acceptance.') })]);
    expect(change).toMatchObject({ floor: 2, issue: expect.any(Number), url: `https://github.com/${floor2.fullName}/issues/${change.issue}` });
    expect(x.state.itImprove.cards).toEqual([]);
    expect(x.state.itImprove.records[0].change).toBe(card.id);
    expect(swarm.improveView().causes[0]).toMatchObject({ status: 'fixed', change: { issue: change.issue } });
    await expect(swarm.improveApprove(card.id)).rejects.toThrow(/handled or replaced/);
  });

  it("an approved playbook line goes through the CEO's set_office_playbook; a QA-brief line through set_floor_profile; Not now changes nothing", async () => {
    const { swarm, x, dennis } = await office();
    const playbook = vi.spyOn(x, 'setOfficePlaybook');
    const profile = vi.spyOn(x, 'setFloorProfile');
    x.itReport(oom, dennis);
    await x.itTicket({ id: 1, close: 'ok' });
    x.itImprove({
      proposals: [
        { cause: 'lab:test lab oom', kind: 'office_playbook', title: 'Workers', why: '', line: 'Run vitest with --maxWorkers=2.' },
        { cause: 'lab:test lab oom', kind: 'qa_brief', floor: 1, title: 'QA', why: '', line: 'Check the lab ran with 2 workers.' },
        { cause: 'lab:test lab oom', kind: 'floor_playbook', floor: 1, title: 'Skip', why: '', line: 'Never mind.' },
      ],
    });
    const [pb, qa, skip] = x.state.itImprove.cards;
    expect(await x.itDecide('approve', pb.id)).toBe('✅ Added.'); // a Telegram Approve
    expect(playbook).toHaveBeenCalledWith(expect.stringMatching(/- Run vitest with --maxWorkers=2\.$/));
    expect(x.state.settings.officePlaybook).toContain('- Run vitest with --maxWorkers=2.');
    await swarm.improveApprove(qa.id);
    expect(profile).toHaveBeenCalledWith({ floor: 1, qa_brief: expect.stringContaining('- Check the lab ran with 2 workers.') });
    expect(await x.itDecide('decline', skip.id)).toBe('✋ Not now.');
    expect(x.state.itImprove.cards).toEqual([]);
    expect(x.state.itImprove.changes.map((c) => c.kind).sort()).toEqual(['office_playbook', 'qa_brief']);
  });

  it("Review now: the demo's IT lead reads it_review and puts the top cause on a card", async () => {
    const { swarm, x, dennis } = await office();
    x.itReport(oom, dennis);
    await x.itTicket({ id: 1, close: 'ok' });
    delete (x as Partial<Internals>).enqueueIt; // the real queue: the demo's IT session runs
    expect(swarm.improveReviewNow()).toEqual({ queued: true });
    await vi.waitFor(() => expect(x.state.itImprove.cards).toEqual([expect.objectContaining({ key: 'lab:test lab oom', kind: 'issue' })]), { timeout: 8000, interval: 100 });
  }, 10_000);

  it('refuses a proposal for a cause the review never saw', async () => {
    const { x } = await office();
    expect(() => x.itImprove({ proposals: [{ cause: 'disk:full', kind: 'office_playbook', title: 't', why: '', line: 'l' }] })).toThrow(/Proposal 1: No cause "disk:full"/);
  });
});
