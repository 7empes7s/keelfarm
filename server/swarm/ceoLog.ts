// The CEO jobs log and "Redo on Opus" (#332): each job's number, the tools it called and its last reply, its row in the
// session history, its inputs kept for a redo, and the redo itself on the CEO's own model with the links between the
// two replies; a turn's closing recap folded into its last reply (#378). The rules are pure, in server/ceoRedo.ts,
// shared/ceoJobLog.ts and shared/reactions.ts.
import type { SessionResult } from '../agentRunner.ts';
import type { CeoJob } from '../ceo.ts';
import type { CostRun } from '../costLedger.ts';
import { HttpError } from '../httpError.ts';
import { jobTrigger, keepJob, redoJob } from '../ceoRedo.ts';
import { sampleCeoJobs } from '../ceoJobSample.ts';
import { jobReply } from '../../shared/ceoJobLog.ts';
import { parseMessage } from '../../shared/chatParts.ts';
import { foldedReply, turnEnding } from '../../shared/reactions.ts';
import { isAutomatedJob } from '../../shared/ceoModels.ts';
import { CEO_ID, type CeoJobTag, type PhoneMessage } from '../../shared/types.ts';
import { CEO_MODEL, type PersistedAgent } from './model.ts';
import { SwarmCeoFresh } from './ceoFresh.ts';

export abstract class SwarmCeoLog extends SwarmCeoFresh {
  private jobMessage: number | null = null;

  /** A job starts with its model: its number too (kept through a preemption, a retry or a redo's queueing), nothing said yet. */
  protected override ceoJobModel(a: PersistedAgent, job: CeoJob): string {
    const c = this.state.ceo;
    job.id ??= c.jobSeq = (c.jobSeq ?? 0) + 1;
    this.jobMessage = null;
    this.turnAnswer = null;
    return super.ceoJobModel(a, job);
  }

  /** What a reply to the current job carries: an automated job's tag, so the chat can offer Redo on Opus. */
  protected ceoJobTag(): { ceoJob?: CeoJobTag } {
    const job = this.state.ceo.job;
    if (!job?.id || !isAutomatedJob(job.kind)) return {};
    return { ceoJob: { job: job.id, kind: job.kind, model: this.ceoRunModel, ...(job.redo && { redoOf: job.redo }) } };
  }

  /** The current job replied: its last message; a redo's first reply links the first job's to it. */
  protected ceoJobReplied(m: PhoneMessage) {
    const job = this.state.ceo.job;
    if (!job?.id) return;
    if (job.redo && this.jobMessage === null) this.retag(job.redo.message, { redoneBy: { job: job.id, message: m.id } });
    this.jobMessage = m.id;
  }

  /**
   * A turn's closing text (shared/reactions.ts turnEnding): after the turn answered with the reply tool, it folds into
   * that reply's steps row, one bubble per answer with no push and nothing more to Telegram (#378); after only a
   * reaction it is a quiet note. True when it needs no bubble of its own.
   */
  protected foldTurn(text: string, extra: Pick<PhoneMessage, 'attachments' | 'actions' | 'research' | 'log' | 'used'>): boolean {
    const answered = this.turnAnswer;
    this.turnAnswer = null;
    const ending = turnEnding(text, extra, answered?.by ?? null);
    const last = ending === 'fold' ? this.state.messages.find((m) => m.id === answered?.message) : undefined;
    if (last) {
      Object.assign(last, foldedReply(last, text, extra), this.ceoJobTag());
      this.broadcast({ type: 'ceoChat', message: last });
      this.save();
      this.ceoJobReplied(last);
    } else if (ending === 'pill') this.postMessage('office', `${this.ceo().name}: ${parseMessage('ceo', text).text.trim()}`);
    return !!last || ending === 'pill' || ending === 'quiet'; // quiet: a reaction said it, or nothing needed saying: no blank bubble, no push
  }

  /**
   * The job's session ended: its row in the CEO jobs log goes on `run` (logSession), and, unless it runs again
   * (`again`: preempted or retried), its inputs are kept for a redo and its reply learns what it cost.
   */
  protected ceoJobEnds(job: CeoJob | null, run: CostRun | null, result: SessionResult, issues: number, again: boolean) {
    if (!job?.id) return;
    if (run) run.ceo = { job: job.id, kind: job.kind, trigger: jobTrigger(job), fresh: !run.resumed, reply: jobReply(result.ok, this.jobMessage), message: this.jobMessage, tools: { ...this.ceoChat.tools }, issues, inputTokens: null, outputTokens: null, ...(job.redo && { redoOf: job.redo.job }) };
    if (again) return;
    const c = this.state.ceo;
    c.jobs = keepJob(c.jobs ?? [], { id: job.id, kind: job.kind, model: this.ceoRunModel, at: Date.now(), usd: result.costUsd, message: this.jobMessage, inputs: job });
    this.retag(this.jobMessage, { usd: Math.round(result.costUsd * 100) / 100 });
  }

  /** POST /api/ceo/jobs/:id/redo: job `id` again with the same inputs on the CEO's own model, in a fresh session. */
  redoCeoJob(id: number): { job: number } {
    const c = this.state.ceo;
    const ceoModel = this.state.agents.find((a) => a.id === CEO_ID)?.model || CEO_MODEL;
    const r = redoJob(c.jobs ?? [], id, ceoModel, Date.now());
    if ('error' in r) throw new HttpError(r.status, r.error);
    if (r.job.kind === 'triage' && !this.stuckRecord(r.job)) throw new HttpError(400, `PR #${r.job.prNumber} isn't waiting on triage any more, so there's nothing to redo.`);
    const next = (r.job.id = c.jobSeq = (c.jobSeq ?? 0) + 1);
    c.jobs = (c.jobs ?? []).map((x) => (x.id === id ? { ...x, redoneBy: next } : x));
    this.retag(r.job.redo!.message, { redoneBy: { job: next, message: null } });
    this.enqueueCeo(r.job);
    return { job: next };
  }

  /** A fresh demo office's CEO jobs (server/ceoJobSample.ts): a morning in the log, and a Sonnet follow-up's reply with Redo on Opus. */
  protected seedCeoJobs(now: number) {
    const ceo = this.state.agents.find((a) => a.id === CEO_ID);
    const worker = this.state.agents.find((a) => a.role !== 'ceo' && a.repoId);
    const repo = this.state.repos.find((r) => r.id === worker?.repoId);
    if (!ceo || !worker || !repo || this.state.ceo.jobSeq) return;
    const s = sampleCeoJobs(now, { id: ceo.id, name: ceo.name, model: ceo.model || CEO_MODEL }, { id: worker.id, name: worker.name, repoId: repo.id, floor: this.floorName(repo) });
    const m: PhoneMessage = { id: this.messageSeq++, from: 'ceo', text: s.reply.text, at: now, ceoJob: s.reply.tag };
    this.state.messages.push(m);
    Object.assign(this.state.ceo, { jobSeq: s.seq, jobs: s.records.map((r) => (r.id === s.reply.tag.job ? { ...r, message: m.id } : r)) });
    void this.history.seed(s.entries.map((e) => (e.ceo?.job === s.reply.tag.job ? { ...e, ceo: { ...e.ceo, message: m.id } } : e)));
  }

  /** A job's reply in the chat, its tag changed, to every tab. */
  private retag(messageId: number | null, patch: Partial<CeoJobTag>) {
    const m = messageId === null ? undefined : this.state.messages.find((x) => x.id === messageId);
    if (!m?.ceoJob) return;
    m.ceoJob = { ...m.ceoJob, ...patch };
    this.broadcast({ type: 'ceoChat', message: m });
    this.save();
  }
}
