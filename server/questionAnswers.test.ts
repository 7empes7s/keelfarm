import { describe, expect, it, vi } from 'vitest';
import type { AgentQuestion, PhoneMessage, PullInfo } from '../shared/types.ts';
import type { SessionResult } from './agentRunner.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import type { QaRecord } from './swarm/model.ts';

// #508: the manager's answer to an agent's question reaches the agent (an ended session resumes with it), the issue
// they asked on, and every view; the CEO may pass on an answer the manager gave in chat; no QA rounds while they wait.
type Agent = { id: string; name: string; role: string; status: string; task: string | null; issueNumber: number | null; issueTitle: string | null; branch: string | null; prNumber: number | null; sessionId: string | null; startedAt: number | null; repoId: string };
type Internals = {
  state: { agents: Agent[]; repos: { id: string; floor: number; fullName: string; autoAssign: boolean }[]; questions: AgentQuestion[]; messages: PhoneMessage[]; qa: QaRecord[]; settings: { ceoFollowups: { kinds: Record<string, boolean> } } };
  repoRt: Map<string, { pulls: PullInfo[] }>;
  onFinished(a: Agent, repo: unknown, r: SessionResult): Promise<void>;
  officeTools(): { call(name: string, args: Record<string, unknown>): Promise<string> };
  ensureCeo(interrupted: unknown[]): void;
  postMessage(from: PhoneMessage['from'], text: string): PhoneMessage;
  startAgentSession(...a: unknown[]): void;
  startPipelineWork(repo: unknown): boolean;
  runQa(...a: unknown[]): Promise<void>;
  runFix(...a: unknown[]): Promise<void>;
  queueQa(repo: unknown, pr: number, dev: Agent | null, issue: number | null): void;
  ceoHeard: number[];
};

const finished = (text: string): SessionResult => ({ ok: true, text, costUsd: 0.1, turns: 5, errors: [] });

async function office() {
  const backend = createDemoBackend();
  const swarm = new Swarm(backend);
  const repo = await swarm.connectRepo('demo-co/pixel-todo');
  swarm.hireAgent(repo.id, {});
  const x = swarm as unknown as Internals;
  x.state.repos[0].autoAssign = false; // nobody starts other work under the test's feet
  x.state.settings.ceoFollowups.kinds.question = false; // questions go straight to the manager
  x.ensureCeo([]);
  const [ada, bob] = x.state.agents.filter((a) => a.role !== 'ceo');
  const started = vi.spyOn(x, 'startAgentSession').mockImplementation(() => undefined);
  const comments = vi.spyOn(backend, 'commentIssue');
  // Ada built #3, asked, and her session ended.
  Object.assign(ada, { status: 'working', task: 'issue', issueNumber: 3, issueTitle: 'Issue 3', branch: 'swarm/issue-3', sessionId: 's-ada', startedAt: Date.now() });
  await x.onFinished(ada, x.state.repos[0], finished('BLOCKED: approve G2 onward?'));
  return { swarm, x, ada, bob, started, comments };
}

const viewOf = (swarm: Swarm, id: string) => swarm.snapshot().agents.find((a) => a.id === id)!;

describe("the manager's answer to an agent's question", () => {
  it('resumes the ended session with it, goes on the issue, and every view says it was delivered', async () => {
    const { swarm, x, ada, started, comments } = await office();
    const q = x.state.questions[0];
    expect(q).toMatchObject({ agentId: ada.id, to: 'manager', issue: 3 });
    expect(viewOf(swarm, ada.id)).toMatchObject({ waiting: 'manager' });
    await swarm.messageCeo('Approve G2 onward; keep storage held', q.messageId!);
    // The ended session picks back up with the answer.
    expect(started).toHaveBeenCalledTimes(1);
    expect(started.mock.calls[0][0]).toBe(ada);
    expect(started.mock.calls[0][3]).toMatch(/to your question about #3: Approve G2 onward; keep storage held\n/);
    expect(started.mock.calls[0][5]).toBe('s-ada');
    // Where the agent looks on GitHub.
    expect(comments).toHaveBeenCalledWith('demo-co/pixel-todo', 3, expect.stringMatching(/^\*\*Manager's answer via the office:\*\* Approve G2 onward; keep storage held/));
    // Gone from the questions, and the card and chat say when it arrived.
    expect(x.state.questions).toEqual([]);
    expect(swarm.snapshot().ceo.questions).toEqual([]);
    const view = viewOf(swarm, ada.id);
    expect(view.waiting).toBeFalsy();
    expect(view.answered).toEqual(expect.any(Number));
    expect(x.state.messages.find((m) => m.id === q.messageId)?.answered).toEqual(view.answered);
  });

  it("answer_agent passes on the manager's answer in chat with asked_in, and still refuses without it", async () => {
    const { swarm, x, ada, started, comments } = await office();
    expect(await x.officeTools().call('answer_agent', { agent_id: ada.id, text: 'Go ahead with G2.' })).toMatch(/^Refused: .*pass asked_in/);
    expect(started).not.toHaveBeenCalled();
    const said = x.postMessage('manager', 'Approve G2 onward; keep storage and drill held');
    x.ceoHeard = [said.id];
    expect(await x.officeTools().call('answer_agent', { agent_id: ada.id, text: 'Approve G2 onward; keep storage and drill held.', asked_in: said.id })).toBe(`Sent: ${ada.name} carries on with your answer.`);
    expect(started.mock.calls[0][3]).toMatch(/through .+ \(CEO\) to your question about #3: Approve G2/);
    expect(comments).toHaveBeenCalledTimes(1);
    expect(x.state.questions).toEqual([]);
    expect(viewOf(swarm, ada.id).waiting).toBeFalsy();
  });
});

describe('a draft PR whose agent waits on an answer', () => {
  async function waitingPr() {
    const o = await office();
    const { x, ada } = o;
    const repo = x.state.repos[0];
    ada.prNumber = 42;
    x.state.questions[0].pr = 42;
    const pull = { number: 42, title: 'G2', url: '', headRefName: 'swarm/issue-3', headSha: 'abc', state: 'OPEN', isDraft: true, closesIssues: [3], checks: 'none', failedChecks: [], pendingChecks: [] } as unknown as PullInfo;
    x.repoRt.get(repo.id)!.pulls.push(pull);
    x.queueQa(repo, 42, ada, 3);
    const qa = vi.spyOn(x, 'runQa').mockResolvedValue(undefined);
    const fix = vi.spyOn(x, 'runFix').mockResolvedValue(undefined);
    return { ...o, repo, pull, qa, fix, rec: x.state.qa.find((q) => q.prNumber === 42)! };
  }

  it('gets no QA or fix round until the answer arrives', async () => {
    const { x, repo, qa, fix, rec } = await waitingPr();
    expect(x.startPipelineWork(repo)).toBe(false);
    rec.status = 'failed';
    expect(x.startPipelineWork(repo)).toBe(false);
    expect(qa).not.toHaveBeenCalled();
    expect(fix).not.toHaveBeenCalled();
    x.state.questions = []; // answered
    rec.status = 'queued';
    expect(x.startPipelineWork(repo)).toBe(true);
    expect(qa).toHaveBeenCalledTimes(1);
  });

  it("is not held by another floor's question about its own PR with the same number", async () => {
    const { x, repo, qa } = await waitingPr();
    Object.assign(x.state.questions[0], { repoId: 'other/repo', agentId: 'someone-else' });
    expect(x.startPipelineWork(repo)).toBe(true);
    expect(qa).toHaveBeenCalledTimes(1);
  });

  it('is tested as before once it is ready for review, question or not', async () => {
    const { x, repo, pull, qa } = await waitingPr();
    pull.isDraft = false;
    expect(x.startPipelineWork(repo)).toBe(true);
    expect(qa).toHaveBeenCalledTimes(1);
  });
});
