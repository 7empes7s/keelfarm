// The CEO's model per kind of job (#331): which model a job runs on, whether it may carry on in the kept session (a
// session can't change model), and the one retry on the CEO's own model when a job's model isn't available.
import type { SessionResult } from '../agentRunner.ts';
import type { CeoJob } from '../ceo.ts';
import { ceoKeepsSession, ceoModelFor, ceoModelRetry } from '../../shared/ceoModels.ts';
import { CEO_MODEL, type PersistedAgent } from './model.ts';
import { SwarmReactions } from './reactions.ts';

export abstract class SwarmCeoModels extends SwarmReactions {
  protected ceoRunModel = ''; // the model the CEO's current job runs on

  /** The model `job` runs on: its kind's (CEO settings), or the CEO's own for a retry. */
  protected ceoJobModel(a: PersistedAgent, job: CeoJob): string {
    const ceoModel = a.model || CEO_MODEL;
    this.ceoRunModel = job.onCeoModel ? ceoModel : ceoModelFor(job.kind, this.state.settings.ceoAwake.models, ceoModel);
    return this.ceoRunModel;
  }

  /** Whether the job carries on in the kept session (`want`, from ceoSessionStep): only on the model it started on. A fresh session starts the count over. */
  protected ceoResume(a: PersistedAgent, want: { resume: boolean; why: string | null }, model: string): boolean {
    const keep = ceoKeepsSession(want.resume, this.state.ceo.kept.model ?? null, model, a.model || CEO_MODEL);
    if (!keep.resume || !this.state.ceo.kept.startedAt) this.state.ceo.kept = { turns: 0, costUsd: 0, startedAt: Date.now(), lastEndedAt: null, model };
    const why = want.why ?? keep.why;
    if (why) this.appendLog(a, [{ kind: 'system', text: `↻ A fresh session: ${why}.` }]);
    return keep.resume;
  }

  /** A job that failed for its model goes back to the queue for the CEO's own model, with one office note. */
  protected retryOnCeoModel(a: PersistedAgent, job: CeoJob | null, result: SessionResult, preempted: boolean): boolean {
    const ceoModel = a.model || CEO_MODEL;
    if (!job || preempted || a.status === 'stopped' || !ceoModelRetry({ ok: result.ok, errors: result.errors, model: this.ceoRunModel, ceoModel, retried: !!job.onCeoModel })) return false;
    job.onCeoModel = true;
    a.sessionId = null; // the failed session was on the other model
    this.postMessage('office', `⚠️ ${a.name} couldn't use ${this.ceoRunModel} (${result.errors.join('; ').slice(0, 160)}), so this job runs again on ${ceoModel}. Change it in CEO settings → Model per job.`);
    return true;
  }
}
