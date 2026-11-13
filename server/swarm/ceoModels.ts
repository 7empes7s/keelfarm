// The CEO's model per kind of job (#331): which model a job runs on, whether it may carry on in the kept session (a
// session can't change model), and the one retry on the CEO's own model when a job's model isn't available. And the
// coding agent it runs on, picked by hand (#418, rules in shared/ceoRunsOn.ts): from its next job, with a chat pill.
import type { SessionResult } from '../agentRunner.ts';
import type { CeoJob } from '../ceo.ts';
import { cliLabel } from '../clis.ts';
import { HttpError } from '../httpError.ts';
import { jobWaitsForAccount } from '../../shared/accountRotation.ts';
import { ceoKeepsSession, ceoModelFor, ceoModelRetry } from '../../shared/ceoModels.ts';
import { CEO_CLIS, ceoCli, ceoModelOn, ceoRunsText, type CeoRunsOn } from '../../shared/ceoRunsOn.ts';
import type { AgentCli } from '../../shared/types.ts';
import { BUSY, CEO_MODEL, type PersistedAgent } from './model.ts';
import { SwarmReactions } from './reactions.ts';

export abstract class SwarmCeoModels extends SwarmReactions {
  protected ceoRunModel = ''; // the model the CEO's current job runs on
  protected ceoFresh = false; // the current job runs in a fresh session of its own, apart from the chat's kept one (#330)

  // ---------- what the CEO runs on (#418) ----------

  /** The CEO's coding agent now: the one the manager picked, in the terminal runtime. */
  protected ceoCliOf(a: PersistedAgent): AgentCli {
    return ceoCli(a.cli, this.state.settings.runtime === 'terminal' && this.backend.terminals);
  }

  /** The CEO's own model on its coding agent: a job on another one runs on it ('' its default). */
  protected ceoModel(a: PersistedAgent): string {
    return ceoModelOn(this.ceoCliOf(a), a.model, this.state.settings, CEO_MODEL);
  }

  /** The CEO's setup changes like any agent's, and its coding agent too: a pill with Undo when it moved to another one. */
  updateAgent(id: string, patch: Parameters<SwarmReactions['updateAgent']>[1]) {
    const a = this.agent(id);
    if (a.role !== 'ceo') return super.updateAgent(id, patch);
    const was: CeoRunsOn = { cli: this.ceoCliOf(a), model: a.model, effort: a.effort, account: a.account ?? '' };
    if (patch.cli !== undefined) this.setCeoCli(a, patch.cli, patch.account !== undefined);
    super.updateAgent(id, patch);
    const cli = this.ceoCliOf(a);
    // A running job finishes where it started: the next one starts on the new coding agent.
    if (cli !== was.cli) this.postMessage('office', ceoRunsText(a.name, cli, this.ceoModel(a), BUSY.includes(a.status)), undefined, { ceoRuns: { back: was } });
  }

  /** The manager moves the CEO to another coding agent. A pinned account of the old one goes back to the rotation. */
  private setCeoCli(a: PersistedAgent, raw: string, accountToo: boolean) {
    const cli = (raw || 'claude') as AgentCli;
    if (!CEO_CLIS.includes(cli)) throw new HttpError(400, `${a.name} can run on ${CEO_CLIS.map(cliLabel).join(', ')}.`);
    if (cli !== 'claude' && !(this.state.settings.runtime === 'terminal' && this.backend.terminals)) throw new HttpError(400, `${a.name} runs on ${cliLabel(cli)} only in the terminal runtime (Settings → Agents).`);
    if (!this.cliReady(cli)) throw new HttpError(400, `${cliLabel(cli)} isn't installed on this computer.`);
    a.cli = cli;
    const b = (a.account ?? '').toLowerCase();
    if (b && !accountToo && !this.accounts.list().some((x) => (x.id === b || x.tags.includes(b)) && x.cli === cli)) a.account = undefined;
  }

  /** The model `job` runs on: an automated kind's (CEO settings), or the CEO's own for the rest, a retry and a redo. */
  protected ceoJobModel(a: PersistedAgent, job: CeoJob): string {
    const ceoModel = this.ceoModel(a);
    const awake = this.state.settings.ceoAwake;
    // Model per job names Claude models: on another coding agent (#418) every job runs on the CEO's own.
    this.ceoRunModel = job.onCeoModel || this.ceoCliOf(a) !== 'claude' ? ceoModel : ceoModelFor(job.kind, awake.models, ceoModel, awake.automatedOnCeo);
    return this.ceoRunModel;
  }

  /** Whether the job carries on in the kept session (`want`, from ceoSessionStep): only on the model it started on. A fresh session starts the count over. */
  protected ceoResume(a: PersistedAgent, want: { resume: boolean; why: string | null }, model: string): boolean {
    const keep = ceoKeepsSession(want.resume, this.state.ceo.kept.model ?? null, model, this.ceoModel(a));
    if (!keep.resume || !this.state.ceo.kept.startedAt) this.state.ceo.kept = { turns: 0, costUsd: 0, startedAt: Date.now(), lastEndedAt: null, model };
    const why = want.why ?? keep.why;
    if (why) this.appendLog(a, [{ kind: 'system', text: `↻ A fresh session: ${why}.` }]);
    return keep.resume;
  }

  /** A job that failed for its model goes back to the queue for the CEO's own model, with one office note; one that ran out of accounts, as it is. */
  protected retryOnCeoModel(a: PersistedAgent, job: CeoJob | null, result: SessionResult, preempted: boolean): boolean {
    // Every account is out (#248): it waits for the first one back; a reply to the manager fails fast with Retry (#637).
    if (job && !preempted && a.status !== 'stopped' && result.outOfAccounts) return jobWaitsForAccount(job.kind);
    const ceoModel = this.ceoModel(a);
    if (!job || preempted || a.status === 'stopped' || !ceoModelRetry({ ok: result.ok, errors: result.errors, model: this.ceoRunModel, ceoModel, retried: !!job.onCeoModel })) return false;
    job.onCeoModel = true;
    if (!this.ceoFresh) a.sessionId = null; // the failed session was on the other model (a fresh job's never was the chat's)
    this.postMessage('office', `⚠️ ${a.name} couldn't use ${this.ceoRunModel} (${result.errors.join('; ').slice(0, 160)}), so this job runs again on ${ceoModel}. Change it in CEO settings → Model per job.`);
    return true;
  }
}
