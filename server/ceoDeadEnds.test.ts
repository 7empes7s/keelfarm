import { afterEach, describe, expect, it } from 'vitest';
import { CEO_ID, type IssueInfo, type PhoneMessage, type PullInfo } from '../shared/types.ts';
import { createDemoBackend } from './demo.ts';
import { heardAtStart } from './managerAsks.ts';
import { Swarm } from './swarm.ts';
import type { OfficeTools } from './ceo.ts';
import type { PersistedAgent, PersistedRepo, QaRecord } from './swarm/model.ts';

// #663: the CEO's dead ends from one session: a draft PR merge_pull refused, guidance for an idle agent lost, no way to
// edit an issue, assign right after file_issue refused by sync lag, and IT's answer cut off and only in the next job.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  officeTools(): OfficeTools;
  postMessage(from: PhoneMessage['from'], text: string): PhoneMessage;
  seedDemoQa(): void;
  advanceMerges(repo: PersistedRepo): Promise<void>;
  prepare(...a: unknown[]): Promise<{ cwd: string; deps: 'none' } | null>;
  startAgentSession(a: PersistedAgent, repo: PersistedRepo, cwd: string, prompt: string): void;
  ceoHeard: number[];
  holds: { check(): void };
  ceoAsked: boolean;
  itAnswers: Map<number, { question: string; parts: string[]; done: boolean }>;
  repoRt: Map<string, { issues: IssueInfo[]; pulls: PullInfo[] }>;
  state: { repos: PersistedRepo[]; agents: PersistedAgent[]; qa: QaRecord[]; ceo: { queue: unknown[] }; settings: { itDept: { on: boolean } } };
};

let open: Swarm[] = [];
afterEach(() => {
  for (const s of open) s.stopAgent(CEO_ID);
  open = [];
});

async function office() {
  const backend = createDemoBackend();
  const swarm = new Swarm(backend);
  open.push(swarm);
  const connected = await swarm.connectRepo('demo-co/pixel-todo', {});
  const o = swarm as unknown as Internals;
  for (let n = 0; n < 100 && !o.repoRt.get(connected.id)?.issues.length; n++) await new Promise((r) => setTimeout(r, 50)); // the first sync
  o.ensureCeo([]);
  o.state.ceo.queue = [];
  const repo = o.state.repos.find((r) => r.id === connected.id)!;
  repo.autoAssign = false;
  const ask = o.postMessage('manager', 'Please do it');
  o.ceoHeard = heardAtStart({ kind: 'chat', messageIds: [ask.id] });
  o.ceoAsked = true;
  return { swarm, backend, o, repo, ask, tools: o.officeTools() };
}

const until = async (ok: () => boolean) => {
  for (let n = 0; n < 100 && !ok(); n++) await new Promise((r) => setTimeout(r, 20));
};

describe('merge_pull on a draft PR (#663)', () => {
  it('marks a QA-passed draft ready, then merges it', async () => {
    const { swarm, backend, o, repo, ask, tools } = await office();
    o.seedDemoQa();
    const rec = o.state.qa.find((q) => q.repoId === repo.id)!;
    for (let i = 0; i < 50 && !o.repoRt.get(repo.id)?.pulls.some((p) => p.number === rec.prNumber); i++) {
      await swarm.syncRepo(repo.id);
      await new Promise((r) => setTimeout(r, 10));
    }
    rec.status = 'passed';
    const pr = o.repoRt.get(repo.id)!.pulls.find((p) => p.number === rec.prNumber)!;
    pr.isDraft = true;
    const steps: string[] = [];
    let draft = true;
    const ready = backend.readyPull;
    backend.readyPull = async (fullName, n) => {
      steps.push(`ready #${n}`);
      draft = false;
      await ready(fullName, n);
    };
    const merge = backend.mergePull;
    backend.mergePull = async (fullName, n, method, sha) => {
      if (draft) throw new Error('Pull Request is still a draft');
      steps.push(`merge #${n}`);
      await merge(fullName, n, method, sha);
    };
    expect(await tools.call('merge_pull', { floor: repo.floor, pr: rec.prNumber, asked_in: ask.id })).toBe(`Merged PR #${rec.prNumber} on floor 1 (it was a draft: marked ready first).`);
    expect(steps).toEqual([`ready #${rec.prNumber}`, `merge #${rec.prNumber}`]);
  });
});

describe('auto-merge and drafts (#663)', () => {
  it("marks the office's own QA-passed draft ready, and leaves anyone else's draft alone", async () => {
    const { swarm, backend, o, repo } = await office();
    o.seedDemoQa();
    const rec = o.state.qa.find((q) => q.repoId === repo.id)!;
    await until(() => (void swarm.syncRepo(repo.id), !!o.repoRt.get(repo.id)?.pulls.some((p) => p.number === rec.prNumber)));
    Object.assign(rec, { status: 'passed', updatedAt: 0, ciOutage: null });
    repo.autoMerge = true;
    const readied: number[] = [];
    backend.readyPull = async (_f, n) => void readied.push(n);
    const pr = o.repoRt.get(repo.id)!.pulls.find((p) => p.number === rec.prNumber)!;
    Object.assign(pr, { isDraft: true, headRefName: 'wip/by-hand' });
    await o.advanceMerges(repo);
    expect(readied).toEqual([]);
    Object.assign(pr, { isDraft: true, headRefName: `swarm/issue-${rec.issueNumber}-ada` });
    await o.advanceMerges(repo);
    expect(readied).toEqual([rec.prNumber]);
  });
});

describe('message_agent to an agent with no session (#663)', () => {
  it("queues the guidance into their next task's prompt instead of refusing", async () => {
    const { swarm, o, repo, tools } = await office();
    const worker = o.state.agents.find((a) => a.role !== 'ceo' && a.repoId === repo.id)!;
    Object.assign(worker, { status: 'idle', sessionId: null, branch: null, task: null });
    const out = await tools.call('message_agent', { floor: repo.floor, agent_id: worker.name, text: 'Run the e2e suite before pushing.' });
    expect(out).toMatch(new RegExp(`^${worker.name} has no session now: they get it in their next task's prompt\\.`));
    const prompts: string[] = [];
    o.prepare = async () => ({ cwd: '/desk', deps: 'none' }); // the worktree itself isn't the point here
    o.startAgentSession = (_a, _r, _c, prompt) => void prompts.push(prompt);
    const issue = o.repoRt.get(repo.id)!.issues[0].number;
    await swarm.assignIssue(repo.id, issue, worker.name);
    await until(() => prompts.length > 0);
    expect(prompts[0]).toContain('Run the e2e suite before pushing.');
    expect(worker.queuedNotes ?? []).toEqual([]); // used once
  });

  it('also posts it on an open issue it names, for whoever builds it', async () => {
    const { backend, o, repo, tools } = await office();
    const worker = o.state.agents.find((a) => a.role !== 'ceo' && a.repoId === repo.id)!;
    Object.assign(worker, { status: 'idle', sessionId: null, branch: null, task: null });
    const comments: string[] = [];
    backend.commentIssue = async (_f, n, body) => (comments.push(`#${n}: ${body}`), 'https://example.test/c');
    const issue = o.repoRt.get(repo.id)!.issues[0].number;
    const out = await tools.call('message_agent', { floor: repo.floor, agent_id: worker.id, text: `On #${issue}: keep the old API working.` });
    expect(out).toContain(`posted on #${issue}`);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatch(new RegExp(`^#${issue}: .*keep the old API working\\.`));
  });
});

describe('edit_issue (#663)', () => {
  it("changes an issue's title and appends to its body, keeping what was there", async () => {
    const { o, repo, tools } = await office();
    const issue = o.repoRt.get(repo.id)!.issues[0];
    const before = issue.body;
    const out = await tools.call('edit_issue', { floor: repo.floor, number: issue.number, title: 'A sharper title', append: 'Also: works at 390 px.' });
    expect(out).toBe(`Edited #${issue.number} on floor 1: new title, body appended.`);
    const now = o.repoRt.get(repo.id)!.issues.find((i) => i.number === issue.number)!;
    expect(now.title).toBe('A sharper title');
    expect(now.body.startsWith(before)).toBe(true);
    expect(now.body).toContain('Also: works at 390 px.');
    expect(await tools.call('edit_issue', { floor: repo.floor, number: issue.number })).toMatch(/^Refused: Nothing to change/);
    expect(await tools.call('edit_issue', { floor: repo.floor, number: 99999, title: 'x' })).toMatch(/^Refused: There is no open issue #99999 on floor 1/);
  });
});

describe('file_issue then assign_issue (#663)', () => {
  it('assigns and prioritises a just-filed issue even while GitHub does not list it yet', async () => {
    const { backend, o, repo, ask, tools } = await office();
    const list = backend.listIssues;
    let hidden = 0;
    backend.listIssues = async (fullName) => (await list(fullName)).filter((i) => i.number !== hidden); // GitHub's search index lags
    const filed = await tools.call('file_issue', { floor: repo.floor, title: 'A new thing', body: 'Build it.' });
    hidden = Number(filed.match(/#(\d+)/)![1]);
    await (o as unknown as Swarm).syncRepo(repo.id);
    const worker = o.state.agents.find((a) => a.role !== 'ceo' && a.repoId === repo.id)!;
    Object.assign(worker, { status: 'working', task: 'issue', issueNumber: 1, startedAt: Date.now() });
    expect(await tools.call('assign_issue', { floor: repo.floor, number: hidden, agent: worker.name })).toMatch(new RegExp(`takes #${hidden}`));
    expect(await tools.call('set_issue_priority', { floor: repo.floor, number: hidden, priority: true, asked_in: ask.id })).toMatch(new RegExp(`^#${hidden} on floor 1 is a priority`));
  });
});

describe("IT's answer to ask_it (#663)", () => {
  it('is readable whole with it_answer, and wait_for it_answer returns once IT is done', async () => {
    const { o, tools } = await office();
    o.state.settings.itDept.on = true;
    const asked = await tools.call('ask_it', { question: 'What do the voice traces say?' });
    const id = Number(asked.match(/message (\d+)/)![1]);
    expect(await tools.call('it_answer', { message: id })).toMatch(/still working/);
    const long = `{"traces":[${Array.from({ length: 80 }, (_, i) => `{"id":${i},"stage":"stt","ms":${100 + i}}`).join(',')}]}`;
    const waiting = tools.call('wait_for', { conditions: [{ kind: 'it_answer', message: id }], timeout_min: 1 });
    const entry = o.itAnswers.get(id)!;
    entry.parts.push(long);
    entry.done = true;
    o.holds.check(); // what IT's session ending does
    expect(await waiting).toContain(`IT answered (message ${id})`);
    const full = await tools.call('it_answer', { message: id });
    expect(full).toContain(long); // whole, not cut mid-object
    expect(await tools.call('it_answer', { message: 99999 })).toMatch(/^Refused: No ask_it has message 99999/);
  });
});
