// Account rotation with automatic fallback (#248, docs/accounts.md): every session starts on an account (#247), and one
// that ends on a usage limit, a 429 or an expired login starts again straight away on the next account (then, if the
// manager allows it, another coding agent's), with nothing counted against its task. The CEO's switches show in the
// chat as a pill, agents' go to the CEO's next job; when every account is out the office pauses until the first is back.
import path from 'node:path';
import type { SessionCallbacks, SessionHandle, SessionOptions, SessionResult } from '../agentRunner.ts';
import type { AccountUse } from '../accounts.ts';
import { HttpError } from '../httpError.ts';
import { builtInPrefs, prepareLogin } from '../cliSetup.ts';
import { cliLabel } from '../clis.ts';
import { backText, defaultAccount, defaultsBack, defaultText, pruneTaskAccounts, switchNow, taskKey, tasksLeft } from '../../shared/accountDefault.ts';
import { allOutText, detectLimit, switchesForCeo, switchHandover, switchText, type LimitHit } from '../../shared/accountRotation.ts';
import { ACCOUNT_CLIS, LOGIN_ENV } from '../../shared/accounts.ts';
import type { AccountCli, AccountSwitch, AccountsView, AgentCli } from '../../shared/types.ts';
import { canResume, heldElsewhere } from '../sessionResume.ts';
import { BUSY, CEO_DIR, LIMIT_PAUSE_MS, type PersistedAgent } from './model.ts';
import { SwarmUsage } from './usage.ts';

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
/** The demo's "Simulate a limit": that long. */
const DEMO_LIMIT_MS = 3 * 60_000;
/** One sign-in notice per account this often (#360). */
const SIGN_IN_NOTICE_MS = 60 * 60_000;
/** What an agent's fresh session on another account (a limit, or Switch now) hears first: its worktree is as the last one left it. */
export const SWITCHED_NOTE = 'Your previous session on this task ran on another account; this is a fresh session on a new one. Your worktree and branch are as it left them: check git status and carry on.';
/** What a fresh session hears when the one it was to resume isn't there (#401). */
const LOST_NOTE = "Your previous session on this task couldn't be resumed; this is a fresh session. Your worktree and branch are as it left them: check git status and carry on.";
/** What an agent's session resumed on the next account hears: the task is already above. */
const RESUMED_NOTE = 'Your session stopped at an account limit and now continues on another account. Carry on with the task from where you stopped.';

export abstract class SwarmRotation extends SwarmUsage {
  /** Sessions running on each account: what the demo's "Simulate a limit" ends. */
  private onAccount = new Map<string, Set<(hit: LimitHit) => void>>();
  /** The account each agent's latest session started on (null: the built-in login): where a stuck CEO is (#375). */
  protected sessionAccount = new Map<string, string | null>();
  /** Which account's folder holds each agent's latest session (its id, the built-in login's too), for resuming it there (#401). */
  protected sessionOn = new Map<string, string>();
  /** Coding agents' defaults that were out at the last look: one "is back" line when they're free again (#390). */
  private defaultsOut = new Set<string>();

  /**
   * A session on the account its agent (or the CEO) is pinned to, else the rotation's: the account's folder or key goes
   * into its environment, its usage and limit hits to the account, and its line in the cost ledger says which it was.
   * When it ends on a limit or a sign-out and rotation has somewhere to go, it starts again there instead of finishing.
   * A cloud agent's runs on the cloud's credentials (docs/cloud.md), OpenCode on its own setup.
   */
  protected startOnAccount(a: PersistedAgent, opts: SessionOptions, cb: SessionCallbacks): SessionHandle {
    // A session its CLI can't find starts again fresh on the same task, once, with nothing counted (#401); if someone
    // else has the task meanwhile, it's let go instead.
    let current: SessionHandle;
    let stopped = false;
    let again = false;
    const go = (o: SessionOptions) => {
      current = this.rotating(a, o, {
        ...cb,
        finished: (result) => {
          if (!result.lostSession || again || stopped) return cb.finished(result);
          again = true;
          const holder = heldElsewhere(a, this.state.agents.map((x) => ({ ...x, busy: BUSY.includes(x.status) })));
          if (holder) return cb.finished({ ...result, errors: [`${holder.name} already has it, so ${a.name} let it go`] });
          this.appendLog(a, [{ kind: 'system', text: `↻ ${result.errors[0] ?? "The session to resume isn't there."} Starting a fresh one on the same task.` }]);
          go(this.fresh(a, o, LOST_NOTE));
        },
      });
    };
    go(opts);
    return {
      send: (text) => current.send(text),
      stop: () => {
        stopped = true;
        current.stop();
      },
      get kept() {
        return current.kept;
      },
    };
  }

  /** The session itself: on its account, moving to the next one on a limit. */
  private rotating(a: PersistedAgent, opts: SessionOptions, cb: SessionCallbacks): SessionHandle {
    const cli = opts.terminal ? (opts.cli ?? 'claude') : 'claude';
    if (a.host === 'box' || cli === 'opencode') {
      this.sessionOn.delete(a.id);
      return this.backend.startSession(this.resumable(a, opts, cli, undefined), cb);
    }
    const others = this.fallbackClis(a, opts);
    if (!this.accounts.canRotate(cli, others)) {
      const use = this.accounts.use(a.account, cli);
      return this.onUse(a, this.resumable(a, opts, cli, use?.id), cb, use, null); // one account: as before rotation
    }
    // A build or fix task stays on the account it started on (#390); Switch now moves it here, to a fresh session.
    const key = taskKey(a);
    const rec = key ? this.state.taskAccounts[key] : undefined;
    if (rec?.move) opts = { ...opts, resumeSessionId: undefined, prompt: this.freshPrompt(a, { ...opts, resumeSessionId: undefined }) };
    // Else a session to resume goes back to the account holding it while it's usable (#401).
    const first = this.accounts.use(a.account, cli, rec && !rec.move ? rec.account : opts.resumeSessionId ? a.sessionAccount : undefined);
    opts = this.resumable(a, opts, cli, first?.id);
    const tried: string[] = [];
    let current: SessionHandle;
    let stopped = false;
    let conversation = opts.resumeSessionId; // the session's conversation so far, for the next account to resume (#377)
    const attempt = (o: SessionOptions, oc: AccountCli, c: SessionCallbacks, use: AccountUse | null, sw: AccountSwitch | null) => {
      if (use) tried.push(use.id);
      if (use && key) this.recordTask(key, use.id);
      const tracked: SessionCallbacks = {
        ...c,
        sessionId: (id) => {
          conversation = id ?? undefined;
          c.sessionId(id);
        },
      };
      current = this.onUse(a, o, tracked, use, (result, hit) => {
        const why = result.ok || stopped || result.interrupted ? null : (hit ?? detectLimit([...result.errors, ...(o.terminal?.tail(8) ?? [])].join('\n'), Date.now()));
        if (sw?.api) sw.usd += result.costUsd;
        if (!use || !why) return cb.finished(result);
        // The built-in login isn't polled, so a sign-out read from its output only rests it a while.
        if (why.kind === 'signed-out' && !use.builtIn) this.accounts.signedOut(use.id);
        else if (why.kind === 'signed-out') this.accounts.limited(use.id, Date.now() + LIMIT_PAUSE_MS);
        else if (!hit) this.accounts.limited(use.id, why.until);
        const until = why.kind === 'limited' ? why.until : null;
        const next = this.nextUse(a, oc, others, tried);
        if (!next) return this.allOut(cli, use.id, cb, result);
        // Claude logins share their conversations (#377), so the next one resumes this one's; else a fresh session with a
        // handover, and on another coding agent its model and tools.
        const crossed = next.cli !== oc;
        const resumeId = !crossed && oc === 'claude' && conversation && this.accounts.sharesConversations(use.id) && this.accounts.sharesConversations(next.use.id) ? conversation : undefined;
        const s = this.accounts.switched({ at: Date.now(), agentId: a.id, agentName: a.name, fromId: use.id, from: this.accounts.label(use.id), toId: next.use.id, to: this.accounts.label(next.use.id), why: why.kind, until, api: next.api, usd: 0, carried: resumeId ? 'conversation' : 'handover' });
        this.tellSwitch(a, s);
        const retry: SessionOptions = { ...o, resumeSessionId: resumeId, typed: false, reattach: false, prompt: resumeId ? (a.role === 'ceo' || opts.readOnly ? opts.prompt : RESUMED_NOTE) : this.freshPrompt(a, opts) };
        if (!crossed) return attempt(retry, oc, c, next.use, s);
        const onCli: SessionCallbacks = {
          ...c,
          sessionId: (id) => {
            c.sessionId(id);
            if (id) a.sessionCli = next.cli; // resumed with that one next time
          },
        };
        attempt({ ...retry, cli: next.cli, model: this.modelFor(a, next.cli), tools: this.sessionToolsFor(a, next.cli) }, next.cli, onCli, next.use, s);
      });
    };
    attempt(opts, cli, cb, first, null);
    return {
      send: (text) => current.send(text),
      stop: () => {
        stopped = true;
        current.stop();
      },
      get kept() {
        return current.kept;
      },
    };
  }

  /**
   * The agent's saved session is resumed only by the CLI that made it, on the account holding it (#401): else a fresh
   * session. (A session id that isn't the agent's own, a fix resuming the PR's author's, can't be checked here.)
   */
  private resumable(a: PersistedAgent, opts: SessionOptions, cli: AgentCli, account: string | undefined): SessionOptions {
    if (!opts.resumeSessionId || opts.reattach || opts.resumeSessionId !== a.sessionId) return opts;
    if (canResume({ cli: a.sessionCli, account: a.sessionAccount }, { cli, account }, (id) => this.accounts.sharesConversations(id))) return opts;
    this.appendLog(a, [{ kind: 'system', text: `↻ The last session was ${cliLabel(a.sessionCli ?? 'claude')}'s${a.sessionAccount && a.sessionAccount !== account ? ` on ${this.accounts.label(a.sessionAccount)}` : ''}: starting a fresh one.` }]);
    Object.assign(a, { sessionId: null, sessionCli: null, sessionAccount: undefined });
    return this.fresh(a, opts, LOST_NOTE);
  }

  /** The session started fresh instead of resuming: what it hears first. */
  private fresh(a: PersistedAgent, opts: SessionOptions, note: string): SessionOptions {
    return { ...opts, resumeSessionId: undefined, typed: false, reattach: false, prompt: this.freshPrompt(a, opts, note) };
  }

  // ---------- the default and task stickiness (#390) ----------

  /** A task's sessions run on `account` from now on; records of tasks no longer open go. */
  private recordTask(key: string, account: string) {
    const tasks = [...this.state.agents, ...this.state.qa.map((q) => ({ role: 'agent', repoId: q.repoId, task: 'fix', issueNumber: q.issueNumber, prNumber: q.prNumber }))]; // a PR in QA is still open
    const open = new Set([key, ...tasks.map((x) => taskKey(x)).filter((k) => k !== null)]);
    this.state.taskAccounts = { ...pruneTaskAccounts(this.state.taskAccounts, open), [key]: { account } };
  }

  /** The accounts the tasks running now started on: Mission control's "tasks left". */
  protected runningTaskAccounts(): string[] {
    return this.state.agents.map((x) => taskKey(x)).flatMap((k) => (k && this.state.taskAccounts[k] ? [this.state.taskAccounts[k].account] : []));
  }

  /** A task that ends off its coding agent's default changes Mission control's count. */
  protected clearTask(a: PersistedAgent) {
    const key = taskKey(a);
    super.clearTask(a);
    const id = key ? this.state.taskAccounts[key]?.account : undefined;
    const list = this.accounts.list();
    const cli = list.find((x) => x.id === id)?.cli;
    if (cli && defaultAccount(list, cli)?.id !== id) this.accounts.emit();
  }

  /**
   * Make default (#390): new tasks start on this account; open tasks finish on theirs, or with `now` (Switch now)
   * move at their next session. One chat line says which, and is returned.
   */
  makeDefaultAccount(id: string, now = false): string {
    const a = this.accounts.makeDefault(id);
    if (now) this.state.taskAccounts = switchNow(this.state.taskAccounts, this.accounts.list(), id);
    this.defaultsOut.delete(id);
    const text = defaultText(a.label, tasksLeft(this.runningTaskAccounts(), this.accounts.view().accounts, a.cli), now);
    this.postMessage('office', text);
    this.save();
    return text;
  }

  /** Every minute: a default that was limited or signed out and is free again gets one chat line (new tasks go back to it by priority). */
  protected watchDefaults() {
    const { back, out } = defaultsBack(this.defaultsOut, this.accounts.view().accounts, ACCOUNT_CLIS);
    this.defaultsOut = out;
    for (const a of back) this.postMessage('office', backText(a.label));
  }

  /** A fresh session's prompt after a switch: an agent hears its worktree is as it was, a CEO that was mid-conversation gets a handover. */
  private freshPrompt(a: PersistedAgent, opts: SessionOptions, note = SWITCHED_NOTE): string {
    if (opts.readOnly) return opts.prompt;
    if (a.role !== 'ceo') return `${note}\n\n${opts.prompt}`;
    return opts.resumeSessionId ? `${switchHandover(this.state.messages, path.join(CEO_DIR, 'NOTES.md'))}\n\n${opts.prompt}` : opts.prompt;
  }

  /** One session on `use` (null: as before accounts). `ended`: the caller decides what its end means, given a limit it reported. */
  private onUse(a: PersistedAgent, opts: SessionOptions, cb: SessionCallbacks, use: AccountUse | null, ended: ((r: SessionResult, hit: LimitHit | null) => void) | null): SessionHandle {
    const cli = opts.terminal ? (opts.cli ?? 'claude') : 'claude';
    // Gemini CLI on the manager's own login: its limit is its own, not a pause for the office (paced on Claude's).
    const own = cli === 'gemini' ? { ...cb, limited: undefined } : cb;
    if (!use) {
      this.sessionOn.delete(a.id);
      return this.backend.startSession(opts, ended ? { ...own, finished: (r) => ended(r, null) } : own);
    }
    this.readyLogin(a, use, cli, opts.cwd);
    this.sessionAccount.set(a.id, use.builtIn ? null : use.id);
    this.sessionOn.set(a.id, use.id);
    this.spend.account(a.id, use.id);
    this.accounts.emit();
    const env = { ...opts.env, ...use.env };
    let hit: LimitHit | null = null;
    let handle: SessionHandle | null = null;
    const live = this.onAccount.get(use.id) ?? new Set();
    this.onAccount.set(use.id, live);
    const simulate = (h: LimitHit) => {
      hit = h;
      handle?.stop();
    };
    live.add(simulate);
    handle = this.backend.startSession(
      { ...opts, account: use.id, ...(Object.keys(env).length ? { env } : {}), ...(use.keyEnv && cli === 'claude' ? { apiKeyEnv: use.keyEnv } : {}) },
      {
        ...cb,
        usage: (readings) => (use.builtIn ? cb.usage?.(readings) : this.accounts.readings(use.id, readings)),
        limited: (at) => {
          this.accounts.limited(use.id, at);
          if (ended) hit = { kind: 'limited', until: at ?? Date.now() + 60 * 60_000 };
          // Only the login everyone shared stops the whole office: another account's limit is that account's.
          else if (use.builtIn) cb.limited?.(at);
        },
        finished: (result) => {
          live.delete(simulate);
          use.release();
          if (result.signedOut) this.signInLost(a, use, cli);
          if (ended) ended(result, hit);
          else cb.finished(result);
        },
      },
    );
    return handle;
  }

  /**
   * An account's own login folder, set up before a session starts in it (#360): onboarding done, the built-in login's
   * theme, the worktree trusted, so the CLI opens on the task; a Claude login's linked to the shared set (#377). The built-in login is the manager's own setup: untouched.
   */
  private readyLogin(a: PersistedAgent, use: AccountUse, cli: AgentCli, cwd: string) {
    if (use.builtIn || cli === 'opencode') return;
    const dir = use.env[LOGIN_ENV[cli]];
    if (!dir) return;
    try {
      const version = /\d+\.\d+\.\d+/.exec(this.clis.find((c) => c.id === cli)?.version ?? '')?.[0] ?? null;
      if (prepareLogin(cli, dir, [cwd], { version, prefs: builtInPrefs() })) this.appendLog(a, [{ kind: 'system', text: `✓ Set up ${this.accounts.label(use.id)}'s login folder: onboarding done, this worktree trusted.` }]);
      const missing = cli === 'claude' ? this.accounts.share(use.id) : [];
      if (missing.length) this.appendLog(a, [{ kind: 'error', text: `⚠ ${this.accounts.label(use.id)} doesn't share ${missing.join(', ')} with this computer's login: Repair it in Settings → Providers.` }]);
    } catch (err) {
      this.appendLog(a, [{ kind: 'error', text: `⚠ Couldn't set up ${this.accounts.label(use.id)}'s login folder: ${(err as Error).message}` }]);
    }
  }

  /** Pinned to a login that's signed out, with rotation off: no work for them until it's signed in again (#360), rather than a sign-in screen per task. */
  protected pinnedSignedOut(a: PersistedAgent): boolean {
    if (!a.account || a.host === 'box' || this.accounts.rotation().on) return false;
    return this.accounts.view().accounts.some((x) => x.id === a.account && x.status === 'signed-out');
  }

  /** Accounts whose sign-in the manager was told about, and when: one notice per account an hour, however many sessions hit it. */
  private signInTold = new Map<string, number>();

  /** A session showed its CLI's sign-in (cliRunner.ts): the account reads signed out, and the manager hears once. */
  private signInLost(a: PersistedAgent, use: AccountUse, cli: AgentCli) {
    if (!use.builtIn) this.accounts.signedOut(use.id);
    const now = Date.now();
    if (now - (this.signInTold.get(use.id) ?? 0) < SIGN_IN_NOTICE_MS) return;
    this.signInTold.set(use.id, now);
    const label = this.accounts.label(use.id);
    const where = use.builtIn ? `run "${cli}" in a terminal on this computer and sign in` : 'sign it in from Settings → Providers';
    this.notice({ kind: 'stuck', title: `${label} needs signing in`, text: `${a.name}'s session opened on ${cliLabel(cli)}'s sign-in, so it ended: the task carries on on another account, or waits in line. To use this account again, ${where}.`, target: { kind: 'agent', agentId: a.id, terminal: true }, actions: ['terminal'] }, { event: 'agentError', line: a.name });
  }

  /**
   * Other coding agents a session may fall back to (terminal runtime only, installed here): the CEO's the manager
   * allowed; an agent's, ones the office already uses (an agent runs it, or it has an account added), never onto Gemini
   * CLI, which isn't a builder (#365). Consults never do.
   */
  private fallbackClis(a: PersistedAgent, opts: SessionOptions): AccountCli[] {
    if (!opts.terminal || opts.readOnly) return [];
    const r = this.accounts.rotation();
    const inUse = (c: AccountCli) => this.state.agents.some((x) => x.host !== 'box' && x.role !== 'ceo' && (x.cli || this.state.settings.defaultCli) === c) || this.accounts.list().some((x) => x.cli === c && !x.builtIn);
    const allowed = a.role === 'ceo' ? r.ceoClis : r.agentsSwitchCli ? ACCOUNT_CLIS.filter((c) => c !== 'gemini' && inUse(c)) : [];
    return allowed.filter((c) => this.clis.some((x) => x.id === c && x.installed));
  }

  /** The next account: the same coding agent's first, then the others'. */
  private nextUse(a: PersistedAgent, cli: AccountCli, others: AccountCli[], tried: string[]): { use: AccountUse; cli: AccountCli; api: boolean } | null {
    for (const c of [cli, ...others.filter((x) => x !== cli)]) {
      const use = this.accounts.next(c === cli ? a.account : undefined, c, tried);
      if (use) return { use, cli: c, api: this.accounts.list().find((x) => x.id === use.id)?.kind === 'api-key' };
    }
    return null;
  }

  /** The CEO's switch is a pill in the chat; an agent's is one log line and goes to the CEO's next job. */
  private tellSwitch(a: PersistedAgent, s: AccountSwitch) {
    const text = switchText(s, clock);
    this.appendLog(a, [{ kind: 'system', text }]);
    if (a.role === 'ceo') this.postMessage('office', text, undefined, { switch: { from: s.from, to: s.to, until: s.until } });
    else this.ceoTold.push(...switchesForCeo([s], clock));
  }

  /**
   * Every account is out: the office pauses until the first is back, with one message (the API key the manager can
   * turn on, if one is paused). The session ends as a limit, so nothing counts against its task and the CEO's job waits.
   */
  private allOut(cli: AccountCli, lastId: string, cb: SessionCallbacks, result: SessionResult) {
    const first = this.accounts.firstBack(cli);
    const key = this.accounts.pausedKey(cli);
    if (!this.limited()) this.postMessage('office', allOutText(cliLabel(cli), first, clock, key?.label ?? null), undefined, { switch: { from: this.accounts.label(lastId), to: null, until: first, ...(key && { useKey: key.id }) } });
    this.pauseForLimit(first, true);
    cb.finished({ ...result, ok: false, outOfAccounts: true });
  }

  /** POST /api/accounts/:id/simulate-limit, the demo's: that account is limited for a few minutes, and the sessions on it switch. */
  simulateAccountLimit(id: string): AccountsView {
    if (!this.backend.demo) throw new HttpError(404, 'A limit can only be simulated in the demo office.');
    if (!this.accounts.list().some((x) => x.id === id)) throw new HttpError(404, 'No such account.');
    const until = Date.now() + DEMO_LIMIT_MS;
    this.accounts.limited(id, until);
    const live = [...(this.onAccount.get(id) ?? [])];
    for (const end of live) end({ kind: 'limited', until });
    if (!live.length) this.toast('info', `${this.accounts.label(id)} is limited for 3 minutes: new sessions start on the next account.`);
    return this.accounts.view();
  }
}
