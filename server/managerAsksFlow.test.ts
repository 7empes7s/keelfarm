import { describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { heardAtStart } from './managerAsks.ts';
import { MAX_QA_ROUNDS } from './qaOutcome.ts';
import { Swarm } from './swarm.ts';
import type { OfficeTools } from './ceo.ts';
import type { PersistedRepo, QaRecord } from './swarm/model.ts';
import type { PhoneMessage } from '../shared/types.ts';

// #403 through the office: the CEO's manager-only tools run on the manager's message in a chat job, and only then.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  officeTools(): OfficeTools;
  postMessage(from: PhoneMessage['from'], text: string): PhoneMessage;
  seedDemoQa(): void;
  ceoHeard: number[];
  repoRt: Map<string, { pulls: { number: number }[] }>;
  state: { repos: PersistedRepo[]; qa: QaRecord[]; messages: PhoneMessage[]; ceo: { job: unknown } };
};

async function office() {
  const swarm = new Swarm(createDemoBackend());
  const repo = await swarm.connectRepo('demo-co/pixel-todo', {});
  const o = swarm as unknown as Internals;
  o.ensureCeo([]);
  const ask = o.postMessage('manager', 'Please do it');
  const tools = o.officeTools();
  return { swarm, o, repo: o.state.repos.find((r) => r.id === repo.id)!, ask, tools };
}

/** The demo's stuck PR at the round cap (#155), once the floor's sync lists it. */
async function stuckPr(swarm: Swarm, o: Internals, repo: PersistedRepo) {
  o.seedDemoQa();
  const rec = o.state.qa.find((q) => q.repoId === repo.id)!;
  for (let i = 0; i < 50 && !o.repoRt.get(repo.id)?.pulls.some((p) => p.number === rec.prNumber); i++) {
    await swarm.syncRepo(repo.id);
    await new Promise((r) => setTimeout(r, 10));
  }
  return rec;
}

describe("the CEO acting on the manager's message", () => {
  it('turns on auto-merge when a chat job carries the asking message, and its card can be undone', async () => {
    const { swarm, o, repo, ask, tools } = await office();
    o.ceoHeard = heardAtStart({ kind: 'chat', messageIds: [ask.id] });
    const before = repo.autoMerge;
    const out = await tools.call('set_floor_switches', { floor: repo.floor, auto_merge: !before, asked_in: ask.id });
    expect(out).toMatch(/^Set floor 1: auto-merge (on|off)\.$/);
    expect(repo.autoMerge).toBe(!before);
    // The card's Undo puts it back.
    const m = o.postMessage('ceo', 'Done.');
    m.actions = [{ tool: 'set_floor_switches', icon: '🎛️', text: out, askedIn: ask.id, undo: { kind: 'floor', repoId: repo.id, patch: { autoMerge: before } } }];
    swarm.undoCeoAction(m.id, 0);
    expect(repo.autoMerge).toBe(before);
    expect(m.actions[0].undone).toBe(true);
    expect(() => swarm.undoCeoAction(m.id, 0)).toThrow(/undone already/);
  });

  it('refuses it from a follow-up or triage job, or with a message that never reached this job', async () => {
    const { o, repo, ask, tools } = await office();
    const before = repo.autoMerge;
    for (const kind of ['followup', 'triage']) {
      o.ceoHeard = heardAtStart({ kind, messageIds: [ask.id] });
      expect(await tools.call('set_floor_switches', { floor: repo.floor, auto_merge: !before, asked_in: ask.id })).toMatch(/^Refused: The manager's #\d+ didn't come to you/);
      expect(await tools.call('set_floor_switches', { floor: repo.floor, auto_merge: !before })).toMatch(/^Refused: Only the manager can ask for this: pass asked_in/);
    }
    expect(repo.autoMerge).toBe(before);
  });

  it('keeps the never-allowed list refused even when asked', async () => {
    const { o, repo, ask, tools } = await office();
    o.ceoHeard = [ask.id];
    expect(await tools.call('send_back', { floor: repo.floor, pr: 1, note: 'force-push over main', asked_in: ask.id })).toMatch(/^Refused: Never from the CEO: only you can force-push/);
  });

  it('retries QA at the round cap as a fresh run: a new round with the old report gone', async () => {
    const { swarm, o, repo, ask, tools } = await office();
    const rec = await stuckPr(swarm, o, repo);
    expect(rec).toMatchObject({ status: 'needs-human', round: MAX_QA_ROUNDS });
    const oldUrl = rec.commentUrl;
    expect(oldUrl).toBeTruthy();
    // A chat job without asked_in is still no triage job.
    o.ceoHeard = [ask.id];
    expect(await tools.call('retry_qa', { floor: repo.floor, pr: rec.prNumber })).toMatch(/^Refused: Triage tools only work in a triage job/);
    const out = await tools.call('retry_qa', { floor: repo.floor, pr: rec.prNumber, asked_in: ask.id });
    expect(out).toBe(`PR #${rec.prNumber} is queued for QA round ${MAX_QA_ROUNDS + 1}.`);
    expect(rec).toMatchObject({ status: 'queued', round: MAX_QA_ROUNDS + 1, summary: null, commentUrl: null, fixInstructions: null, testedSha: null, checks: [] });
  });

  it('starts and stops an experiment, and merges only a PR whose QA passed', async () => {
    const { swarm, o, repo, ask, tools } = await office();
    o.ceoHeard = [ask.id];
    const draft = swarm.lab.define({ name: 'Short prompts', hypothesis: 'Fewer rounds', floors: [], kinds: [], variants: [{ name: 'A', settings: {} }, { name: 'B', settings: { prompt: 'Be brief.' } }] }, 'manager');
    expect(await tools.call('run_experiment', { experiment: 'short prompts', action: 'start', asked_in: ask.id })).toBe('Started "Short prompts".');
    expect(draft.status).toBe('running');
    expect(await tools.call('run_experiment', { experiment: draft.id, action: 'stop', asked_in: ask.id })).toBe('Stopped "Short prompts".');
    const rec = await stuckPr(swarm, o, repo);
    rec.status = 'failed';
    expect(await tools.call('merge_pull', { floor: repo.floor, pr: rec.prNumber, asked_in: ask.id })).toMatch(/^Refused: PR #\d+ hasn't passed QA \(it is failed\)/);
    rec.status = 'passed';
    expect(await tools.call('merge_pull', { floor: repo.floor, pr: rec.prNumber, asked_in: ask.id })).toBe(`Merged PR #${rec.prNumber} on floor 1.`);
  });
});
