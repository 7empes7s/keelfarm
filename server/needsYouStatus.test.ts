import { describe, expect, it } from 'vitest';
import { newQuestion, escalated, type AgentQuestion } from '../shared/questions.ts';
import type { AgentStatus } from '../shared/types.ts';
import type { OfficeTools } from './ceo.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// company_status's agent lines (#307): an agent waiting on the manager reads "needs you" and says what for; one that
// finished with nothing to do reads "free", not "done".
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  officeTools(): OfficeTools;
  agentRt: Map<string, { blocked?: { reason: string; since: number; told: boolean } | null }>;
  state: { agents: { id: string; name: string; role: string; repoId: string; status: AgentStatus; issueNumber: number | null }[]; questions: AgentQuestion[] };
};

type Line = { id: string; status: string; waitsForManager?: string };

describe("company_status's agent lines", () => {
  it('says "needs you" for a question to the manager or a blocked prompt, and "free" for a finished agent', async () => {
    const swarm = new Swarm(createDemoBackend());
    const view = await swarm.connectRepo('demo-co/pixel-todo', {});
    const internals = swarm as unknown as Internals;
    internals.ensureCeo([]);
    for (const name of ['Ada', 'Bo', 'Cy']) swarm.hireAgent(view.id, { name });
    const [asker, stuck, finished] = internals.state.agents.filter((a) => a.role !== 'ceo' && a.repoId === view.id);
    asker.status = 'done';
    stuck.status = 'working';
    stuck.issueNumber = 3;
    finished.status = 'done';
    const q = newQuestion('q1', { text: 'Which colour?', options: [] }, { agentId: asker.id, agentName: asker.name, repoId: view.id, floor: 1, issue: 1, pr: null }, 0);
    internals.state.questions = [escalated(q, { question: 'Which colour?', options: [], recommendation: '' }, 0)];
    internals.agentRt.get(stuck.id)!.blocked = { reason: 'a permission prompt', since: 0, told: false };
    const status = JSON.parse(await internals.officeTools().call('company_status', {})) as { floors: { agents: Line[] }[] };
    const lines = status.floors[0].agents;
    const line = (id: string) => lines.find((l) => l.id === id);
    expect(line(asker.id)).toMatchObject({ status: 'needs you', waitsForManager: `answer ${asker.name}'s question` });
    expect(line(stuck.id)).toMatchObject({ status: 'needs you', waitsForManager: `answer the prompt in ${stuck.name}'s terminal` });
    expect(line(finished.id)).toMatchObject({ status: 'free' });
    expect(line(finished.id)?.waitsForManager).toBeUndefined();
    expect(lines.map((l) => l.status)).not.toContain('done');
  });
});
