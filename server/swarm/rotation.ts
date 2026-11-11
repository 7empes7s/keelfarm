// Account rotation with automatic fallback (#248, docs/accounts.md): every session starts on an account (#247), and one
// that ends on a usage limit, a 429 or an expired login starts again straight away on the next account (then, if the
// manager allows it, another coding agent's), with nothing counted against its task. The CEO's switches show in the
// chat as a pill, agents' go to the CEO's next job; when every account is out the office pauses until the first is back.
import type { SessionCallbacks, SessionHandle, SessionOptions, SessionResult } from '../agentRunner.ts';
import type { AccountUse } from '../accounts.ts';
import { HttpError } from '../httpError.ts';
import { builtInPrefs, prepareLogin } from '../cliSetup.ts';
import { cliLabel } from '../clis.ts';
import { allOutText, detectLimit, switchesForCeo, switchText, type LimitHit } from '../../shared/accountRotation.ts';
import { ACCOUNT_CLIS } from '../../shared/accounts.ts';
import type { AccountCli, AccountSwitch, AccountsView, AgentCli } from '../../shared/types.ts';
import { LIMIT_PAUSE_MS, type PersistedAgent } from './model.ts';
import { SwarmUsage } from './usage.ts';

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
/** The demo's "Simulate a limit": that long. */
const DEMO_LIMIT_MS = 3 * 60_000;
/** One sign-in notice per account this often (#360). */
const SIGN_IN_NOTICE_MS = 60 * 60_000;
/** What an agent's fresh session on the next account hears first: its worktree is as the last one left it. */
const SWITCHED_NOTE = 'Your previous session on this task stopped at an account limit; this is a fresh session on another account. Your worktree and branch are as it left them: check git status and carry on.';

export abstract class SwarmRotation extends SwarmUsage {
  /** Sessions running on each account: what the demo's "Simulate a limit" ends. */
  private onAccount = new Map<string, Set<(hit: LimitHit) => void>>();
  /** The account each agent's latest session started on (null: the built-in login): where a stuck CEO is (#375). */
  protected sessionAccount = new Map<string, string | null>();

  /**
   * A session on the account its agent (or the CEO) is pinned to, else the rotation's: the account's folder or key goes
   * into its environment, its usage and limit hits to the account, and its line in the cost ledger says which it was.
   * When it ends on a limit or a sign-out and rotation has somewhere to go, it starts again there instead of finishing.
   * A cloud agent's runs on the cloud's credentials (docs/cloud.md), OpenCode on its own setup.
   */
  protected startOnAccount(a: PersistedAgent, opts: SessionOptions, cb: SessionCallbacks): SessionHandle {
    const cli = opts.terminal ? (opts.cli ?? 'claude') : 'claude';
    if (a.host === 'box' || cli === 'opencode') return this.backend.startSession(opts, cb);
    const others = this.fallbackClis(a, opts);
    if (!this.accounts.canRotate(cli, others)) return this.onUse(a, opts, cb, this.accounts.use(a.account, cli), null); // one account: as before rotation
    const tried: string[] = [];
    let current: SessionHandle;
    let stopped = false;
    const attempt = (o: SessionOptions, oc: AccountCli, c: SessionCallbacks, use: AccountUse | null, sw: AccountSwitch | null) => {
      if (use) tried.push(use.id);
      current = this.onUse(a, o, c, use, (result, hit) => {
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
        const s = this.accounts.switched({ at: Date.now(), agentId: a.id, agentName: a.name, fromId: use.id, from: this.accounts.label(use.id), toId: next.use.id, to: this.accounts.label(next.use.id), why: why.kind, until, api: next.api, usd: 0 });
        this.tellSwitch(a, s);
        // A fresh session (another account can't resume this one's conversation); on another coding agent, its model and tools.
        const crossed = next.cli !== oc;
        const retry: SessionOptions = { ...o, resumeSessionId: undefined, typed: false, reattach: false, ...(a.role === 'ceo' || o.readOnly || o.prompt.startsWith(SWITCHED_NOTE) ? {} : { prompt: `${SWITCHED_NOTE}\n\n${o.prompt}` }) };
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
    attempt(opts, cli, cb, this.accounts.use(a.account, cli), null);
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

  /** One session on `use` (null: as before accounts). `ended`: the caller decides what its end means, given a limit it reported. */
  private onUse(a: PersistedAgent, opts: SessionOptions, cb: SessionCallbacks, use: AccountUse | null, ended: ((r: SessionResult, hit: LimitHit | null) => void) | null): SessionHandle {
    if (!use) return this.backend.startSession(opts, ended ? { ...cb, finished: (r) => ended(r, null) } : cb);
    const cli = opts.terminal ? (opts.cli ?? 'claude') : 'claude';
    this.readyLogin(a, use, cli, opts.cwd);
    this.sessionAccount.set(a.id, use.builtIn ? null : use.id);
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
   * theme, the worktree trusted, so the CLI opens on the task. The built-in login is the manager's own setup: untouched.
   */
  private readyLogin(a: PersistedAgent, use: AccountUse, cli: AgentCli, cwd: string) {
    const dir = cli === 'claude' ? use.env.CLAUDE_CONFIG_DIR : use.env.CODEX_HOME;
    if (use.builtIn || !dir || cli === 'opencode') return;
    try {
      const version = /\d+\.\d+\.\d+/.exec(this.clis.find((c) => c.id === cli)?.version ?? '')?.[0] ?? null;
      if (prepareLogin(cli, dir, [cwd], { version, prefs: builtInPrefs() })) this.appendLog(a, [{ kind: 'system', text: `✓ Set up ${this.accounts.label(use.id)}'s login folder: onboarding done, this worktree trusted.` }]);
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
   * allowed; an agent's, ones the office already uses (an agent runs it, or it has an account added). Consults never do.
   */
  private fallbackClis(a: PersistedAgent, opts: SessionOptions): AccountCli[] {
    if (!opts.terminal || opts.readOnly) return [];
    const r = this.accounts.rotation();
    const inUse = (c: AccountCli) => this.state.agents.some((x) => x.host !== 'box' && x.role !== 'ceo' && (x.cli || this.state.settings.defaultCli) === c) || this.accounts.list().some((x) => x.cli === c && !x.builtIn);
    const allowed = a.role === 'ceo' ? r.ceoClis : r.agentsSwitchCli ? ACCOUNT_CLIS.filter(inUse) : [];
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
