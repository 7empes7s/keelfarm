import { describe, expect, it, vi } from 'vitest';
import type { ItJob, ItState } from '../shared/itDept.ts';
import type { TicketsState } from '../shared/itTickets.ts';
import type { AgentView } from '../shared/types.ts';
import type { OfficeTools } from './ceo.ts';
import { createDemoBackend } from './demo.ts';
import { devSystemPrompt, qaSystemPrompt } from './prompts.ts';
import { Swarm } from './swarm.ts';

// IT tickets (#542): an agent's it_report, IT woken with the evidence, IT's answer to the agent, and the ticket closed.
type Agent = { id: string; name: string; role: string; repoId: string };
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  officeTools(): OfficeTools;
  itReport(raw: unknown, who: { id: string; name: string }): string;
  itTicket(a: { id: number; tell?: string; close?: string }): Promise<string>;
  alertBlocked(a: Agent): void;
  agentView(a: Agent, withLog: boolean): AgentView;
  enqueueIt(job: ItJob): void;
  agentRt: Map<string, { session: { send(t: string): void; stop(): void } | null; blocked?: { reason: string; since: number; told: boolean; kind?: string } | null }>;
  state: { agents: Agent[]; itTickets: TicketsState; it: ItState };
};

async function office() {
  const swarm = new Swarm(createDemoBackend());
  const view = await swarm.connectRepo('demo-co/pixel-todo', {});
  swarm.hireAgent(view.id, { name: 'Dennis' });
  const x = swarm as unknown as Internals;
  x.ensureCeo([]);
  const dennis = x.state.agents.find((a) => a.name === 'Dennis')!;
  const sent: string[] = [];
  x.agentRt.get(dennis.id)!.session = { send: (t) => sent.push(t), stop: () => undefined }; // a running session, so IT's message reaches it
  return { swarm, x, dennis, sent };
}

const lost = { what: 'Lab result lost', where: 'lab', evidence: 'lab_run never answered for job lab-7', blocking: true };

describe('an agent reports a lost lab result to IT', () => {
  it('wakes IT with the evidence; IT tells the agent and closes the ticket; the card waits, then clears', async () => {
    const { x, dennis, sent } = await office();
    const jobs: ItJob[] = [];
    x.enqueueIt = (job) => jobs.push(job); // IT's session itself is the demo's: here, its tool calls are made below
    expect(x.itReport(lost, dennis)).toMatch(/^Opened ticket #1\. Iris \(IT\) looks now and messages you/);
    expect(jobs).toEqual([expect.objectContaining({ kind: 'ticket', id: 1, text: expect.stringContaining('lab_run never answered for job lab-7') })]);
    expect(x.state.it.messages.at(-1)?.text).toMatch(/^🎫 Ticket #1 \(lab, blocking, 1×, from Dennis\): Lab result lost/);
    expect(x.agentView(dennis, false).itWait).toBe(1);

    expect(await x.itTicket({ id: 1, tell: 'Run job lab-7 again: the lab restarted and lost its result.', close: 'Told Dennis to run job lab-7 again.' })).toBe('Ticket #1: told Dennis, closed it.');
    expect(sent).toEqual(['IT ticket #1: Run job lab-7 again: the lab restarted and lost its result.']);
    expect(x.state.itTickets.list[0]).toMatchObject({ status: 'closed', resolution: 'Told Dennis to run job lab-7 again.' });
    expect(x.agentView(dennis, false).itWait).toBeNull();
    await expect(x.itTicket({ id: 1, close: 'again' })).rejects.toThrow(/closed already/);
  });

  it("is answered by the demo's IT lead through its own tools", async () => {
    const { x, dennis, sent } = await office();
    x.itReport(lost, dennis);
    await vi.waitFor(() => expect(x.state.itTickets.list[0].status).toBe('closed'), { timeout: 8000, interval: 100 });
    expect(sent[0]).toMatch(/^IT ticket #1: .*lab-7/);
    expect(x.agentView(dennis, false).itWait).toBeNull();
  }, 10_000);

  it("lets a single non-blocking report sleep: no wake, nobody waits, and a repeat joins it", async () => {
    const { x, dennis } = await office();
    const jobs: ItJob[] = [];
    x.enqueueIt = (job) => jobs.push(job);
    expect(x.itReport({ ...lost, blocking: false }, dennis)).toMatch(/^Opened ticket #1\. Noted: carry on/);
    expect(x.itReport({ ...lost, blocking: false }, dennis)).toMatch(/^Joined open ticket #1 \(2 reports\)/);
    expect(jobs).toEqual([]);
    expect(x.agentView(dennis, false).itWait).toBeUndefined();
    expect(() => x.itReport({ ...lost, where: 'kitchen' }, dennis)).toThrow(/where is one of/);
  });

  it('files tickets by itself for a sign-in screen and a stuck agent', async () => {
    const { x, dennis } = await office();
    x.enqueueIt = () => undefined;
    x.agentRt.get(dennis.id)!.blocked = { reason: 'the login screen', since: 0, told: false, kind: 'sign-in' };
    x.alertBlocked(dennis);
    expect(x.state.itTickets.list[0]).toMatchObject({ where: 'sign-in', auto: true, blocking: false, evidence: ['Dennis: the login screen'] });
  });

  it("is the CEO's tool too", async () => {
    const { x } = await office();
    x.enqueueIt = () => undefined;
    expect(await x.officeTools().call('it_report', { what: 'CI is down', where: 'ci', evidence: 'checks never started', blocking: false })).toMatch(/^Opened ticket #1/);
    expect(x.state.itTickets.list[0].by[0].id).toBe('ceo');
  });
});

describe("the agents' prompts", () => {
  it('send office problems to IT only in sessions that have it_report', () => {
    const base = { agent: { name: 'Ada' }, repo: { fullName: 'o/r', defaultBranch: 'main', autoMerge: true, browserTesting: true, summary: '', mission: '', qaBrief: '', playbook: '' }, port: 5678, cwd: '/w', branch: 'b' };
    const pr = { number: 1, title: 't', headRefName: 'h', url: 'u' };
    expect(devSystemPrompt({ ...base, linked: [], it: true })).toMatch(/report them with it_report .* never sleep-loop or retry blindly/);
    expect(qaSystemPrompt({ ...base, pr, it: true })).toMatch(/it_report/);
    expect(devSystemPrompt({ ...base, linked: [] })).not.toMatch(/it_report/);
  });
});
