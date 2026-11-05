import { describe, expect, it } from 'vitest';
import { charterOf } from '../shared/charter.ts';
import { createDemoBackend } from './demo.ts';
import { demoCharter } from './demoCharters.ts';
import type { OfficeTools } from './ceo.ts';
import type { PersistedRepo } from './swarm/model.ts';
import { Swarm } from './swarm.ts';

// The CEO proposes, the manager decides (#48): propose_charter never changes a charter by itself.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  officeTools(): OfficeTools;
  fileIssue(x: { floor: number; title: string; body: string }): Promise<string>;
  ceoAsked: boolean;
  state: { repos: PersistedRepo[] };
};

async function office() {
  const swarm = new Swarm(createDemoBackend());
  const view = await swarm.connectRepo('demo-co/pixel-todo', { mission: 'A cheerful todo app' });
  const internals = swarm as unknown as Internals;
  internals.ensureCeo([]);
  const repo = () => internals.state.repos[0];
  return { swarm, id: view.id, internals, repo, charter: () => charterOf(repo().mission, repo().charter) };
}

const proposal = { floor: 1, reason: 'Make contrast a standard.', focus: 'O1', objectives: [{ outcome: 'Quick capture', measure: 'under 2 seconds' }], standards: ['Text meets WCAG AA contrast'] };

describe('propose_charter', () => {
  it('waits for the manager: the charter stays as it was', async () => {
    const { internals, repo, charter } = await office();
    const before = charter();
    const out = await internals.officeTools().call('propose_charter', proposal);
    expect(out).toMatch(/^Proposed for floor 1\. Nothing changes until the manager approves or edits it\./);
    expect(charter()).toEqual(before);
    expect(repo().charter.history).toEqual([]);
    expect(repo().charter.proposal).toMatchObject({ reason: 'Make contrast a standard.', charter: { mission: 'A cheerful todo app', focus: 'O1', standards: ['Text meets WCAG AA contrast'] } });
    expect(repo().charter.proposal!.charter.objectives).toEqual([{ id: 'O1', outcome: 'Quick capture', measure: 'under 2 seconds' }]);
  });

  it('applies on approval, with who changed what, and not after a dismissal', async () => {
    const { swarm, id, internals, repo, charter } = await office();
    await internals.officeTools().call('propose_charter', proposal);
    const proposed = repo().charter.proposal!.charter;
    swarm.decideCharter(id, false);
    expect(repo().charter.proposal).toBeNull();
    expect(charter().standards).toEqual([]);

    await internals.officeTools().call('propose_charter', proposal);
    const view = swarm.decideCharter(id, true);
    expect(charter()).toEqual(proposed);
    expect(view.charter.proposal).toBeNull();
    expect(view.charter.history[0]).toMatchObject({ by: expect.stringMatching(/, approved by /), parts: ['focus', 'objectives', 'standards'], note: 'Make contrast a standard.' });
    expect(() => swarm.decideCharter(id, true)).toThrow(/no charter proposal/);
  });

  it("applies the manager's edits instead when they edit before approving", async () => {
    const { swarm, id, internals, charter } = await office();
    await internals.officeTools().call('propose_charter', proposal);
    swarm.decideCharter(id, true, { ...charter(), focus: 'O1 and nothing else' });
    expect(charter().focus).toBe('O1 and nothing else');
  });

  it('refuses a proposal that changes nothing', async () => {
    const { internals } = await office();
    expect(await internals.officeTools().call('propose_charter', { floor: 1, reason: 'Same', mission: 'A cheerful todo app' })).toMatch(/^Refused: .*already/);
  });
});

describe('the manager edits the charter', () => {
  it('saves it with a history line, and the brief stays its mission', async () => {
    const { swarm, id, repo } = await office();
    const view = swarm.setCharter(id, { mission: 'A cheerful todo app', standards: ['Tests pass'] });
    expect(view.mission).toBe('A cheerful todo app');
    expect(view.charter.standards).toEqual(['Tests pass']);
    expect(repo().charter.history).toEqual([expect.objectContaining({ parts: ['standards'], note: 'edited' })]);
    swarm.updateRepo(id, { mission: 'A todo app for families' });
    expect(repo().charter.history[0]).toMatchObject({ parts: ['mission'], note: 'brief edited' });
  });
});

describe("the CEO's issues name an objective", () => {
  it('on a floor whose charter has objectives', async () => {
    const { swarm, id, internals } = await office();
    swarm.setCharter(id, demoCharter('demo-co/pixel-todo').charter);
    internals.ceoAsked = true;
    await expect(internals.fileIssue({ floor: 1, title: 'Add a dark mode', body: 'The manager asked.' })).rejects.toThrow(/Objective: <id>.*O1, O2, O3/);
    await expect(internals.fileIssue({ floor: 1, title: 'Add a dark mode', body: 'The manager asked.\n\nObjective: O1' })).resolves.toMatch(/^Filed #\d+/);
  });
});
