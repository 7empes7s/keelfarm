// A stuck CEO, shown to the manager (#375): the CEO's sessions report the sign-in, setup and other screens they're
// blocked on (liveState.ts, #359), a message with nothing back for a minute counts too, and a session that ended on a
// sign-in says so. Each is a card in the chat (Open terminal, Sign in, Switch back) and one notification per job.
// The words and Switch back's target are pure, in server/ceoStuck.ts.
import type { SessionCallbacks, SessionHandle, SessionOptions } from '../agentRunner.ts';
import { CEO_SILENT_MS, ceoStuckKind, ceoStuckText, switchBackTo } from '../ceoStuck.ts';
import type { CeoJob } from '../ceo.ts';
import type { StuckKind } from '../liveState.ts';
import { HttpError } from '../httpError.ts';
import { CEO_ID } from '../../shared/types.ts';
import type { PersistedAgent } from './model.ts';
import { SwarmCeo } from './ceoJobs.ts';

export abstract class SwarmCeoStuck extends SwarmCeo {
  /** The account the CEO last answered on (null: the built-in login): where Switch back goes. */
  private ceoAnsweredOn: string | null | undefined;
  /** The manager's messages a stuck session held: Switch back runs them again. */
  private ceoStuckJobs: CeoJob[] = [];
  /** What the manager was told (account:kind), until the CEO answers again or switches back: one card however many jobs hit it. */
  private ceoStuckTold = new Set<string>();

  /** The CEO's job session (runCeoJob): on the account as any session, watched for being stuck. */
  protected startCeoSession(a: PersistedAgent, opts: SessionOptions, cb: SessionCallbacks): SessionHandle {
    const rt = this.agentRt.get(a.id)!;
    const job = this.state.ceo.job;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const quiet = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const stuck = (kind: StuckKind | 'silent', reason: string) => {
      rt.blocked = { reason, since: Date.now(), told: true, kind: kind === 'silent' ? 'not-started' : kind };
      this.emitAgent(a);
      this.tellCeoStuck(a, ceoStuckKind(kind), job);
    };
    const arm = () => {
      quiet();
      timer = setTimeout(() => stuck('silent', "hasn't answered in a minute"), CEO_SILENT_MS);
    };
    const alive = () => {
      quiet();
      this.ceoAnsweredOn = this.sessionAccount.get(a.id) ?? null;
      this.ceoStuckTold.clear();
      if (!rt.blocked) return;
      rt.blocked = null;
      this.emitAgent(a);
    };
    if (job?.kind === 'chat') arm();
    const handle = this.startOnAccount(a, opts, {
      ...cb,
      text: (text, done) => {
        alive();
        cb.text?.(text, done);
      },
      tool: (name) => {
        if (name) alive();
        cb.tool(name);
      },
      turn: (text) => {
        alive();
        cb.turn?.(text);
      },
      blocked: (reason, kind) => {
        if (reason) stuck(kind ?? 'prompt', reason);
        else if (rt.blocked) {
          rt.blocked = null;
          this.emitAgent(a);
        }
      },
      finished: (result) => {
        quiet();
        rt.blocked = null;
        if (result.signedOut) this.tellCeoStuck(a, 'sign-in', job, false); // signInLost (rotation.ts) already notified
        cb.finished(result);
      },
    });
    return {
      send: (text) => {
        arm(); // the manager's message into the running session
        handle.send(text);
      },
      stop: () => handle.stop(),
      get kept() {
        return handle.kept;
      },
    };
  }

  /** The card in the chat and a notification, once per account and kind (ceoStuckTold). */
  private tellCeoStuck(a: PersistedAgent, kind: ReturnType<typeof ceoStuckKind>, job: CeoJob | null, notify = true) {
    if (job?.kind === 'chat' && !this.ceoStuckJobs.includes(job)) this.ceoStuckJobs.push(job);
    const on = this.sessionAccount.get(a.id) ?? null;
    if (this.ceoStuckTold.has(`${on}:${kind}`)) return;
    this.ceoStuckTold.add(`${on}:${kind}`);
    const back = switchBackTo(on, this.ceoAnsweredOn ?? null, a.account);
    const backLabel = back === null ? null : back ? this.accounts.label(back) : 'the office default';
    const words = ceoStuckText(a.name, kind, on && this.accounts.label(on), backLabel);
    this.postMessage('office', words.line, undefined, { ceoStuck: { kind, account: on, back, ...(backLabel && { backLabel }) } });
    if (notify) this.notice({ kind: 'stuck', title: words.title, text: words.body, target: { kind: 'agent', agentId: a.id, terminal: true }, actions: ['terminal'] }, { event: 'agentError', line: a.name });
  }

  /** POST /api/ceo/switch-back: the stuck card's Switch back. The CEO goes back to `account`, and the messages it was stuck on run again there. */
  ceoSwitchBack(account: unknown) {
    const a = this.agent(CEO_ID);
    if (typeof account !== 'string') throw new HttpError(400, 'Which account? Pass account (an id, or "" for the office default).');
    this.updateAgent(a.id, { account });
    const running = this.state.ceo.job;
    const jobs = this.ceoStuckJobs.filter((j) => j !== running && !this.state.ceo.queue.includes(j));
    this.ceoStuckJobs = [];
    this.ceoStuckTold.clear();
    if (running && this.agentRt.get(a.id)?.session) this.preemptCeo(a); // the stuck session stops; its job goes back to the queue
    for (const job of jobs) {
      if (job.messageIds?.length) this.markStatus(job.messageIds, 'queued');
      this.enqueueCeo(job);
    }
    return { account: a.account ?? '' };
  }
}
