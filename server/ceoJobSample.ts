// The demo's CEO jobs (#332): a fresh demo office's CEO jobs log has a morning of jobs (a review on Sonnet and its redo
// on Opus, a quiet follow-up, a chat), and the chat ends on a Sonnet follow-up whose reply offers Redo on Opus, kept
// with its inputs so the redo really runs. Pure.
import type { CeoJobRecord } from './ceoRedo.ts';
import type { CeoJobInfo } from '../shared/ceoJobLog.ts';
import { historyId, type HistoryEntry } from '../shared/history.ts';
import { followupEvents } from '../shared/followups.ts';
import type { CeoJobTag } from '../shared/types.ts';

const MIN = 60_000;
const SONNET = 'claude-sonnet-5';

/**
 * The made-up jobs, numbered 1 to 5: their history rows, the kept inputs of the automated ones, and the last one's
 * reply for the chat. `worker`: an agent whose stalled work the last follow-up is about.
 */
export function sampleCeoJobs(now: number, ceo: { id: string; name: string; model: string }, worker: { id: string; name: string; repoId: string; floor: string }) {
  const stalled = { ...followupEvents.stalled(worker, '#12', 25, worker.repoId, worker.floor), id: 'e1', at: now - 40 * MIN };
  const merged = { ...followupEvents.merged(worker.repoId, worker.floor, 9, 'Cache the issue list per floor', [8]), id: 'e2', at: now - 150 * MIN };
  const jobs: { job: number; kind: CeoJobInfo['kind']; model: string; ago: number; mins: number; usd: number; trigger: string; reply: CeoJobInfo['reply']; tools: Record<string, number>; inTok: number; outTok: number; redoOf?: number; title: string }[] = [
    { job: 1, kind: 'review', model: SONNET, ago: 240, mins: 3, usd: 0.28, trigger: 'Schedule', reply: 'replied', tools: { company_status: 1, agent_log: 2 }, inTok: 61_000, outTok: 2_100, title: 'Company review' },
    { job: 2, kind: 'review', model: ceo.model, ago: 225, mins: 4, usd: 0.52, trigger: 'Redo of job #1', reply: 'replied', tools: { company_status: 1, agent_log: 3, scale_team: 1 }, inTok: 64_000, outTok: 2_600, redoOf: 1, title: 'Company review' },
    { job: 3, kind: 'followup', model: SONNET, ago: 150, mins: 1, usd: 0.09, trigger: `Event e2: ${merged.label}`, reply: 'quiet', tools: { pr_diff: 1 }, inTok: 38_000, outTok: 400, title: 'Follow-up' },
    { job: 4, kind: 'chat', model: ceo.model, ago: 90, mins: 2, usd: 0.41, trigger: 'Your message', reply: 'replied', tools: { company_status: 1 }, inTok: 72_000, outTok: 1_300, title: 'Chat with the manager' },
    { job: 5, kind: 'followup', model: SONNET, ago: 38, mins: 2, usd: 0.31, trigger: `Event e1: ${stalled.label}`, reply: 'replied', tools: { agent_log: 1, worktree_file: 1 }, inTok: 41_000, outTok: 900, title: 'Follow-up' },
  ];
  const entries: HistoryEntry[] = jobs.map((j) => {
    const at = now - j.ago * MIN;
    return {
      id: historyId(at, ceo.id, `ceo-${j.kind}`), at, startedAt: at - j.mins * MIN, repoId: '', repo: '', floor: null, agentId: ceo.id, agent: ceo.name, kind: `ceo-${j.kind}`, issue: null, pr: null, title: j.title,
      outcome: j.reply === 'replied' ? 'ceo-acted' : 'ceo-idle', note: '', usd: j.usd, tokens: null, model: j.model, effort: 'medium', account: j.job === 2 ? 'claude-keelop' : 'claude-login', sessionId: null, transcript: null,
      ceo: { job: j.job, kind: j.kind, trigger: j.trigger, fresh: j.kind !== 'chat', reply: j.reply, message: null, tools: j.tools, issues: 0, inputTokens: j.inTok, outputTokens: j.outTok, ...(j.redoOf && { redoOf: j.redoOf }) },
    };
  });
  const record = (j: (typeof jobs)[number], inputs: CeoJobRecord['inputs'], redoneBy?: number): CeoJobRecord => ({ id: j.job, kind: j.kind, model: j.model, at: now - j.ago * MIN, usd: j.usd, message: null, inputs, ...(redoneBy && { redoneBy }) });
  const inputs: CeoJobRecord['inputs'][] = [{ kind: 'review', at: now - 243 * MIN }, { kind: 'review', at: now - 229 * MIN }, { kind: 'followup', events: [merged], at: merged.at }, { kind: 'chat', at: now - 92 * MIN }, { kind: 'followup', events: [stalled], at: stalled.at }];
  const records = jobs.map((j, n) => record(j, inputs[n], j.job === 1 ? 2 : undefined));
  const tag: CeoJobTag = { job: 5, kind: 'followup', model: SONNET, usd: 0.31 };
  const reply = { text: `${worker.name} stalled on #12 on ${worker.floor}: the watchdog put it back in line after 25 minutes. Their log shows the tests were still running, so I left it with them.`, at: now - 38 * MIN, tag };
  return { entries, records, reply, seq: 5 };
}
