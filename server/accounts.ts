// Providers & accounts (#247, docs/accounts.md): the registry of logins and keys the coding agents on this computer run
// on, in <SWARM_HOME>/accounts.json without a secret. API keys live in secrets.json (`account:<id>`); setup tokens are read from
// the office's environment and never written down (cloud.ts). A subscription login has its own folder under
// <SWARM_HOME>/accounts/<id>/, which its sign-in terminal and its sessions use as CLAUDE_CONFIG_DIR or CODEX_HOME.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from './httpError.ts';
import { mergeSecrets, readSecrets } from './secrets.ts';
import { AgentTerminal } from './terminal.ts';
import { POLL_MS } from './usagePoll.ts';
import type { AccountCheck } from './accountCheck.ts';
import type { BoxSignIn } from './cliRunner.ts';
import {
  accountDir,
  accountSetup,
  accountSpend,
  accountStatus,
  ACCOUNT_CLIS,
  ACCOUNT_KINDS,
  applyPatch,
  builtInDir,
  cleanTags,
  ENV_NAME,
  LABEL_MAX,
  LOGIN_ENV,
  moveAccount,
  newAccountId,
  normaliseAccounts,
  pinnedTo,
  planWarning,
  recentHits,
  removal,
  resolveAccount,
  type AccountPatch,
  type AccountSetup,
} from '../shared/accounts.ts';
import { addSpan, NEAR_OUT_PCT, pickAccount, rotationStats, type Candidate } from '../shared/accountRotation.ts';
import { mergeReadings } from '../shared/usage.ts';
import { codeProblem, inputShape, menuKeys, signInCode, signInEnd, signInScreen } from '../shared/signIn.ts';
import { secretMismatch } from '../shared/secretFormats.ts';
import type { AccountCli, AccountKind, AccountsView, AccountSwitch, AccountView, ProviderAccount, RotationSettings, SignInMode, SignInRun, UsageReading } from '../shared/types.ts';

const secretKey = (id: string) => `account:${id}`;
const hint = (s: string) => (s ? s.slice(-4) : '');

export interface AccountsDeps {
  secretsFile: string;
  home: string; // SWARM_HOME
  env: Record<string, string | undefined>;
  homedir?: string;
  /** The registry's file (<SWARM_HOME>/accounts.json): no secrets in it. */
  file: string;
  /** Test an account (accountCheck.ts; the demo's is fake). */
  check: (a: ProviderAccount, dir: string, secret: string) => Promise<AccountCheck>;
  /** A login's CLI signing in in a terminal, with its folder (localSignIn.ts; the demo's is fake). */
  signIn: (o: { cli: AccountCli; env: Record<string, string>; term: AgentTerminal; mode: SignInMode }, exited: (code: number) => void) => BoxSignIn;
  /** The cost ledger's sessions, for today's spend per account. */
  spend: () => { at: number; usd: number; account?: string }[];
  /** Agents (and the CEO) with what they're pinned to. */
  agents: () => { id: string; account?: string }[];
  /** The built-in Claude login's readings: the office already keeps them (claudeUsage). */
  builtInUsage: () => UsageReading[];
  changed: (view: AccountsView) => void;
  /** The demo's made-up accounts, for a registry with only the built-in ones. */
  seed?: () => { accounts: ProviderAccount[]; keys: Record<string, string> };
  /** Check the logins now and every POLL_MS (off in tests). */
  poll?: boolean;
  /** Rotation's settings (#248); absent: off, sessions run on their binding's account as before. */
  rotation?: () => RotationSettings;
}

/** One session on an account: what it adds to the session's environment, and release() once it ends. */
export interface AccountUse extends AccountSetup {
  id: string;
  builtIn: boolean;
  release: () => void;
}

export interface NewAccount {
  cli?: unknown;
  kind?: unknown;
  label?: unknown;
  tags?: unknown;
  plan?: unknown;
  key?: unknown; // an API key
  tokenEnv?: unknown; // a setup token's environment variable
}

export class Accounts {
  private secrets = new Map<string, string>();
  private usage = new Map<string, UsageReading[]>();
  private signedIn = new Map<string, boolean>();
  private sessionOut = new Set<string>(); // a session found it signed out: a poll's expired-but-refreshable token doesn't put it back (#442)
  private refresh = new Set<string>(); // Claude logins whose access token expired, for their next session to refresh (#442)
  private plans = new Map<string, string | null>(); // the plan each Claude login really has (#442)
  private running = new Map<string, number>();
  private terms = new Map<string, AgentTerminal>();
  private signIns = new Map<string, BoxSignIn>();
  private runs = new Map<string, SignInRun>();
  private timer: NodeJS.Timeout | null = null;
  private switches: AccountSwitch[] = []; // today's and yesterday's automatic switches (#248), newest last
  private registry: ProviderAccount[] = normaliseAccounts([]);
  private writing: Promise<void> = Promise.resolve();

  constructor(private deps: AccountsDeps) {}

  async init() {
    const saved = await fs.readFile(this.deps.file, 'utf8').then((t) => JSON.parse(t) as unknown, () => null);
    this.registry = normaliseAccounts(saved);
    const seed = this.deps.seed && this.list().every((a) => a.builtIn) ? this.deps.seed() : null;
    if (seed) {
      this.registry = normaliseAccounts([...this.registry, ...seed.accounts]);
      await mergeSecrets(this.deps.secretsFile, Object.fromEntries(Object.entries(seed.keys).map(([id, k]) => [secretKey(id), k])));
    }
    const s = await readSecrets(this.deps.secretsFile);
    for (const a of this.list()) {
      const v = s[secretKey(a.id)];
      if (typeof v === 'string' && v) this.secrets.set(a.id, v);
    }
    if (seed || saved === null) void this.write(); // the built-ins are there from the first start
    if (!this.deps.poll) return;
    // Every login but the built-in one (the office reads that one already) is checked now, then every POLL_MS.
    void this.pollAll();
    this.timer ??= setInterval(() => void this.pollAll(), POLL_MS);
    this.timer.unref?.();
  }

  list(): ProviderAccount[] {
    return this.registry.map((a) => ({ ...a }));
  }

  private find(id: string): ProviderAccount {
    const a = this.list().find((x) => x.id === id);
    if (!a) throw new HttpError(404, 'No such account.');
    return a;
  }

  private save(list: ProviderAccount[]) {
    this.registry = normaliseAccounts(list);
    void this.write();
    this.emit();
  }

  /** The registry to its file (temp file + rename), one write after another. */
  private write(): Promise<void> {
    const text = JSON.stringify(this.registry, null, 2);
    const tmp = `${this.deps.file}.tmp`;
    this.writing = this.writing
      .then(async () => {
        await fs.mkdir(path.dirname(this.deps.file), { recursive: true });
        await fs.writeFile(tmp, text);
        await fs.rename(tmp, this.deps.file);
      })
      .catch((err) => console.warn('could not save the accounts', err));
    return this.writing;
  }

  /** Every write so far is on disk (tests). */
  flushed(): Promise<void> {
    return this.writing;
  }

  private replace(next: ProviderAccount) {
    this.save(this.list().map((a) => (a.id === next.id ? next : a)));
  }

  /** The folder a login uses: the built-in one's own, else <SWARM_HOME>/accounts/<id>/<cli>. */
  dirOf(a: ProviderAccount): string {
    return a.builtIn ? builtInDir(path.join, a.cli, this.deps.env, this.deps.homedir ?? os.homedir()) : accountDir(path.join, this.deps.home, a);
  }

  private secretOf(a: ProviderAccount): string {
    if (a.kind === 'setup-token') return (a.tokenEnv ? this.deps.env[a.tokenEnv] : '')?.trim() ?? '';
    return this.secrets.get(a.id) ?? '';
  }

  // ---------- views ----------

  /** Each account with what its status is read from: signed in, usage, today's spend (and sessions). */
  private candidates(now: number, lines = this.deps.spend()): (Candidate & { sessions: number })[] {
    return this.list().map((a) => {
      const usage = a.builtIn && a.cli === 'claude' ? this.deps.builtInUsage() : (this.usage.get(a.id) ?? []);
      const spend = accountSpend(lines, a, now);
      const signedIn = a.kind === 'subscription-login' ? (this.signedIn.get(a.id) ?? !!a.builtIn) : !!this.secretOf(a) && this.signedIn.get(a.id) !== false;
      return { account: a, signedIn, usage, todayUsd: spend.usd, sessions: spend.sessions };
    });
  }

  view(now = Date.now()): AccountsView {
    const agents = this.deps.agents();
    return {
      accounts: this.candidates(now)
        .sort((x, y) => x.account.cli.localeCompare(y.account.cli) || x.account.priority - y.account.priority)
        .map(({ account: a, signedIn, usage, todayUsd, sessions }): AccountView => {
          const secret = this.secretOf(a);
          const plan = this.plans.get(a.id);
          const warning = planWarning(a, plan);
          return {
            ...a,
            ...accountStatus({ account: a, signedIn, usage, todayUsd, now }),
            usage: [...usage],
            keyHint: a.kind === 'api-key' ? hint(secret) : '',
            configDir: a.kind === 'subscription-login' ? this.dirOf(a) : null,
            todayUsd,
            todaySessions: sessions,
            limitHits7d: recentHits(a.limitHits, now).length,
            agents: agents.filter((x) => pinnedTo(a, x.account)).map((x) => x.id),
            running: this.running.get(a.id) ?? 0,
            signIn: this.runs.get(a.id) ?? null,
            ...(plan ? { loginPlan: plan } : {}),
            ...(warning ? { planWarning: warning } : {}),
            ...(this.refresh.has(a.id) && signedIn ? { tokenRefresh: true } : {}),
          };
        }),
      rotation: rotationStats(this.switches, now),
    };
  }

  /** Tell the tabs (an agent's binding changed, a session started or ended). */
  emit() {
    this.deps.changed(this.view());
  }

  /** Every saved key and token, so they're scrubbed from anything the office writes or shows. */
  secretValues(): string[] {
    return this.list()
      .map((a) => this.secretOf(a))
      .filter((s) => !!s);
  }

  // ---------- sessions ----------

  /**
   * The account a new session of an agent pinned to `binding` runs on, with what it adds to the session's
   * environment; null: it runs as before accounts. Its running count goes up until release().
   */
  use(binding: string | undefined, cli: AccountCli): AccountUse | null {
    const now = Date.now();
    const r = this.rotation();
    const a = (r.on ? pickAccount(binding, this.candidates(now), now, { cli, apiLast: r.apiLast }) : null) ?? resolveAccount(this.list(), binding, cli);
    return a ? this.take(a) : null;
  }

  /** Rotation's next account for a session whose account was out (#248), skipping the ones it tried; null: none is left. */
  next(binding: string | undefined, cli: AccountCli, tried: readonly string[]): AccountUse | null {
    const now = Date.now();
    const a = pickAccount(binding, this.candidates(now), now, { cli, apiLast: this.rotation().apiLast, skip: tried });
    return a ? this.take(a) : null;
  }

  /**
   * Whether rotation would start a new session of `cli` on some account right now: rotation is on and one is ready
   * (or near its limit). A full window on one login then only rests that login, not the office.
   */
  hasFree(cli: AccountCli, now = Date.now()): boolean {
    const r = this.rotation();
    return r.on && !!pickAccount(undefined, this.candidates(now), now, { cli, apiLast: r.apiLast });
  }

  rotation(): RotationSettings {
    return this.deps.rotation?.() ?? { on: false, apiLast: true, ceoClis: [], agentsSwitchCli: false };
  }

  /** Whether rotation has anywhere to go for a session of `cli`: another account of it, or of a coding agent it may fall back to. */
  canRotate(cli: AccountCli, others: readonly AccountCli[]): boolean {
    if (!this.rotation().on) return false;
    const live = this.list().filter((a) => !a.removing);
    return live.filter((a) => a.cli === cli).length > 1 || others.some((c) => c !== cli && live.some((a) => a.cli === c));
  }

  private take(a: ProviderAccount): AccountUse {
    this.running.set(a.id, (this.running.get(a.id) ?? 0) + 1);
    let done = false;
    return {
      id: a.id,
      builtIn: !!a.builtIn,
      ...accountSetup(a, this.dirOf(a), this.secretOf(a)),
      release: () => {
        if (done) return;
        done = true;
        this.running.set(a.id, Math.max(0, (this.running.get(a.id) ?? 1) - 1));
        this.settle();
      },
    };
  }

  /** A session on an account reported its usage. */
  readings(id: string, readings: UsageReading[]) {
    this.usage.set(id, mergeReadings(this.usage.get(id) ?? [], readings));
    this.refresh.delete(id); // its session ran, so its token is fresh again
    this.emit();
  }

  /** A session on an account hit its usage limit. */
  limited(id: string, resetsAt: number | null, now = Date.now()) {
    const a = this.list().find((x) => x.id === id);
    if (!a) return;
    const until = resetsAt ?? now + 60 * 60_000;
    this.replace({ ...a, limitedUntil: until, limitHits: [...recentHits(a.limitHits, now), now], limitSpans: addSpan(a.limitSpans, now, until, now) });
  }

  /** A session on an account found its login expired or its key turned away: out of the rotation until a Test or sign-in says otherwise. */
  signedOut(id: string) {
    this.signedIn.set(id, false);
    this.sessionOut.add(id);
    this.refresh.delete(id);
    this.emit();
  }

  label(id: string): string {
    return this.list().find((a) => a.id === id)?.label ?? id;
  }

  /** When the first account of `cli` that's out is back (null: none says, e.g. all signed out). */
  firstBack(cli: AccountCli, now = Date.now()): number | null {
    const backs = this.view(now).accounts.filter((a) => a.cli === cli && a.status === 'limited' && a.until).map((a) => a.until!);
    return backs.length ? Math.min(...backs) : null;
  }

  /** A paused API key of `cli` with a key saved: what "Use API key" turns on when every account is out. */
  pausedKey(cli: AccountCli): ProviderAccount | null {
    return this.list().find((a) => a.cli === cli && a.kind === 'api-key' && !a.enabled && !a.removing && !!this.secretOf(a)) ?? null;
  }

  /** An automatic switch, for the numbers; returns it so its session's API cost can be added when it ends. */
  switched(s: AccountSwitch): AccountSwitch {
    const dayAgo = s.at - 2 * 24 * 60 * 60_000;
    this.switches = [...this.switches.filter((x) => x.at > dayAgo), s];
    this.emit();
    return s;
  }

  /** Accounts removed while sessions ran on them go once those have finished. */
  private settle() {
    const gone = this.list().filter((a) => a.removing && !(this.running.get(a.id) ?? 0));
    for (const a of gone) void this.drop(a);
    if (!gone.length) this.emit();
  }

  // ---------- the manager's actions ----------

  /** POST /api/accounts: a new login (signed in next), API key (tested first) or setup token. */
  async add(x: NewAccount): Promise<{ id: string; note: string }> {
    const cli = String(x.cli ?? '') as AccountCli;
    const kind = String(x.kind ?? '') as AccountKind;
    if (!ACCOUNT_CLIS.includes(cli)) throw new HttpError(400, 'Pick Claude Code, Codex or Gemini CLI.');
    if (cli === 'gemini' && kind !== 'subscription-login') throw new HttpError(400, 'Gemini CLI signs in with your Google account: pick a subscription login.');
    if (!ACCOUNT_KINDS.includes(kind) || (cli === 'codex' && kind === 'setup-token')) throw new HttpError(400, 'Pick a subscription login, an API key or (Claude) a setup token.');
    const list = this.list();
    const name = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' }[cli];
    const label = String(x.label ?? '').trim().slice(0, LABEL_MAX) || (kind === 'api-key' ? `${cli === 'claude' ? 'Anthropic' : 'OpenAI'} API key` : `${name} account ${list.filter((a) => a.cli === cli).length + 1}`);
    const a: ProviderAccount = {
      id: newAccountId(cli),
      cli,
      kind,
      label,
      tags: cleanTags(x.tags),
      priority: Math.max(-1, ...list.filter((o) => o.cli === cli).map((o) => o.priority)) + 1,
      enabled: true,
      ...(x.plan ? { plan: String(x.plan).trim().slice(0, 20) } : kind === 'api-key' ? { plan: 'API' } : {}),
    };
    if (kind === 'api-key') {
      const key = checkKey(cli, x.key);
      const check = await this.deps.check(a, '', key);
      if (!check.signedIn) throw new HttpError(400, check.note);
      this.secrets.set(a.id, key);
      await mergeSecrets(this.deps.secretsFile, { [secretKey(a.id)]: key });
      this.signedIn.set(a.id, true);
    } else if (kind === 'setup-token') {
      const name = String(x.tokenEnv ?? '').trim();
      if (!ENV_NAME.test(name)) throw new HttpError(400, 'Name the environment variable that holds the token, e.g. CUBEFARM_CLAUDE_TOKEN_2.');
      a.tokenEnv = name;
    } else await fs.mkdir(this.dirOf(a), { recursive: true });
    this.save([...list, a]);
    return { id: a.id, note: kind === 'subscription-login' ? 'Added: sign it in next.' : kind === 'setup-token' && !this.secretOf(a) ? `Added: set ${a.tokenEnv} in the office's environment and restart it.` : '✓ Added.' };
  }

  /** PATCH /api/accounts/:id: name, tags, plan, daily cost cap, pause or resume. */
  update(id: string, p: AccountPatch): AccountsView {
    try {
      this.replace(applyPatch(this.find(id), p));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, (err as Error).message);
    }
    return this.view();
  }

  /** POST /api/accounts/:id/move: one place up or down. */
  move(id: string, by: number): AccountsView {
    this.find(id);
    this.save(moveAccount(this.list(), id, by < 0 ? -1 : 1));
    return this.view();
  }

  /** PUT /api/accounts/:id/key: a new key for an API key account, tested first. */
  async setKey(id: string, raw: unknown): Promise<string> {
    const a = this.find(id);
    if (a.kind !== 'api-key') throw new HttpError(400, 'Only API key accounts take a key.');
    const key = checkKey(a.cli, raw);
    const check = await this.deps.check(a, '', key);
    if (!check.signedIn) throw new HttpError(400, check.note);
    this.secrets.set(id, key);
    this.signedIn.set(id, true);
    await mergeSecrets(this.deps.secretsFile, { [secretKey(id)]: key });
    this.emit();
    return check.note;
  }

  /** POST /api/accounts/:id/test: is it signed in (and its usage), or does the provider take the key. */
  async test(id: string): Promise<string> {
    const a = this.find(id);
    const r = await this.deps.check(a, this.dirOf(a), this.secretOf(a));
    // An expired token to refresh counts as signed in (#442), unless a session already failed to sign in with it.
    const out = !!r.refresh && this.sessionOut.has(id);
    if (r.signedIn && !r.refresh) this.sessionOut.delete(id);
    this.signedIn.set(id, r.signedIn && !out);
    if (r.refresh && !out) this.refresh.add(id);
    else this.refresh.delete(id);
    if (r.plan !== undefined) this.plans.set(id, r.plan);
    if (r.readings.length) this.usage.set(id, mergeReadings(this.usage.get(id) ?? [], r.readings));
    // A limit a session hit is over once the poll shows room again (#248).
    const now = Date.now();
    const cur = this.list().find((x) => x.id === id);
    if (cur?.limitedUntil && cur.limitedUntil > now && r.readings.length && r.readings.every((x) => x.pct < NEAR_OUT_PCT)) this.replace({ ...cur, limitedUntil: null });
    this.emit();
    return out ? "Its last session couldn't sign in: tap Sign in again." : r.note;
  }

  private async pollAll() {
    for (const a of this.list()) if (!a.builtIn && a.kind !== 'api-key' && a.enabled) await this.test(a.id).catch(() => undefined);
    // The built-in Codex login's rate limits (#361): nothing else reads them. Only its readings: whether it counts as
    // signed in stays as it was (Codex may run on OPENAI_API_KEY with no login file).
    const codex = this.list().find((a) => a.builtIn && a.cli === 'codex' && a.enabled);
    const r = codex && (await this.deps.check(codex, this.dirOf(codex), '').catch(() => null));
    if (codex && r?.readings.length) this.readings(codex.id, r.readings);
  }

  /** The terminal a login signs in in (/ws/term?agent=account:<id>), made when it's first asked for. */
  terminal(id: string): AgentTerminal | null {
    if (!this.list().some((a) => a.id === id)) return null;
    let t = this.terms.get(id);
    if (!t) this.terms.set(id, (t = this.signInTerminal(id)));
    return t;
  }

  /**
   * A sign-in terminal: what's typed at the prompt is logged by its shape only (the value is a sign-in code, dropped at
   * Enter), and keys typed after the sign-in ended get told so rather than vanish.
   */
  private signInTerminal(id: string): AgentTerminal {
    const t = new AgentTerminal();
    let line = '';
    let told = false;
    t.onInput = (data) => {
      if (!t.live) {
        if (!told) t.note('This sign-in has ended: tap Try again for a new one.');
        told = true;
        line = '';
        return;
      }
      told = false;
      for (const ch of data) {
        if (ch !== '\r') line += ch;
        else if (line) {
          console.log(`account ${id}: sign-in code sent (${inputShape(line)})`);
          line = '';
        }
      }
    };
    return t;
  }

  /**
   * POST /api/accounts/:id/signin: the CLI's own login (or `claude setup-token`), in the account's terminal, with the
   * account's folder. How it ended goes on the account's card (`signIn`).
   */
  signIn(id: string, mode: SignInMode = 'login'): void {
    const a = this.find(id);
    if (a.kind !== 'subscription-login') throw new HttpError(400, a.kind === 'api-key' ? 'An API key account has no sign-in: paste a new key.' : `A setup token comes from ${a.tokenEnv}: run claude setup-token and set it there.`);
    if (mode === 'setup-token' && a.cli !== 'claude') throw new HttpError(400, 'Setup tokens are for Claude Code only.');
    this.signIns.get(id)?.stop();
    const dir = this.dirOf(a);
    const env: Record<string, string> = a.builtIn ? {} : { [LOGIN_ENV[a.cli]]: dir };
    const term = this.terminal(id)!;
    const run = this.deps.signIn({ cli: a.cli, env, term, mode }, (code) => {
      if (this.signIns.get(id) !== run) return; // replaced by a newer one
      this.signIns.delete(id);
      void term.flush().then(() => {
        if (this.signIns.has(id)) return;
        const end = signInEnd(mode, code, term.unwrapped().split('\n')); // joined: a narrow phone's terminal wraps the reason (#350)
        this.runs.set(id, { mode, running: false, ...end });
        if (!end.ok) term.note(end.note);
        this.emit();
        void this.test(id).catch(() => undefined);
      });
    });
    this.signIns.set(id, run);
    this.runs.set(id, { mode, running: true, ok: false, note: '' });
    this.watchSignIn(id, term, run);
    this.emit();
  }

  /**
   * The guided sign-in (#350): its screen read as it changes, for the link, Codex's code and whether the prompt waits,
   * and the menus the sign-in needs answered (login method, theme, folder trust) answered by the office itself.
   */
  private watchSignIn(id: string, term: AgentTerminal, run: BoxSignIn) {
    let queued = false;
    let answered = '';
    let answeredAt = 0;
    term.onOutput = () => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        void term.flush().then(() => {
          queued = false;
          const was = this.runs.get(id);
          if (this.signIns.get(id) !== run || !was?.running) return;
          const s = signInScreen(term.unwrapped());
          const menu = s.menu && `${s.menu.text}|${s.menu.at}`;
          if (s.menu && s.pick !== null && (menu !== answered || Date.now() - answeredAt > 3000)) {
            answered = menu!;
            answeredAt = Date.now();
            term.input(menuKeys(s.menu.at, s.pick, term.appCursor), false);
          }
          const next: SignInRun = { mode: was.mode, running: true, ok: false, note: '' };
          if (s.url) next.url = s.url;
          if (s.deviceCode) next.deviceCode = s.deviceCode;
          if (s.waiting) next.waiting = true;
          if (s.menu && s.pick === null) next.question = { text: s.menu.text, options: s.menu.options };
          if (JSON.stringify(next) === JSON.stringify(was)) return;
          this.runs.set(id, next);
          this.emit();
        });
      }, 100);
    };
    term.onOutput(); // what it printed as it started
  }

  /** POST /api/accounts/:id/signin/code: the guided sign-in's pasted code to its prompt, exactly, then Enter (#350). */
  signInCodeIn(id: string, raw: unknown): void {
    const term = this.runningSignIn(id);
    const text = typeof raw === 'string' ? raw : '';
    const problem = codeProblem(text);
    if (problem) throw new HttpError(400, problem);
    const code = signInCode(text);
    // As xterm's paste sends it (#302's path): wrapped when the prompt asked for bracketed paste.
    term.input(term.bracketedPaste ? `\x1b[200~${code}\x1b[201~` : code);
    term.input('\r');
  }

  /** POST /api/accounts/:id/signin/answer: an option of the menu the sign-in shows, chosen in the guide (#350). */
  signInAnswer(id: string, option: unknown): void {
    const term = this.runningSignIn(id);
    const menu = signInScreen(term.unwrapped()).menu;
    const n = Number(option);
    if (!menu || !Number.isInteger(n) || n < 0 || n >= menu.options.length) throw new HttpError(409, 'That question has gone: look at the terminal for what it asks now.');
    term.input(menuKeys(menu.at, n, term.appCursor), false);
  }

  private runningSignIn(id: string): AgentTerminal {
    this.find(id);
    const term = this.terms.get(id);
    if (!this.signIns.has(id) || !term?.live) throw new HttpError(409, 'This sign-in has ended: tap Try again for a new one.');
    return term;
  }

  /** DELETE /api/accounts/:id: at once, or once the sessions on it finish (paused meanwhile). */
  async remove(id: string): Promise<'removed' | 'waiting'> {
    const a = this.find(id);
    const r = removal(a, this.running.get(id) ?? 0);
    if (r === 'refused') throw new HttpError(400, "The login on this computer stays: pause it instead, and the other accounts take its place.");
    if (r === 'wait') {
      this.replace({ ...a, removing: true, enabled: false });
      return 'waiting';
    }
    await this.drop(a);
    return 'removed';
  }

  private async drop(a: ProviderAccount) {
    this.signIns.get(a.id)?.stop();
    this.signIns.delete(a.id);
    this.runs.delete(a.id);
    this.terms.delete(a.id);
    this.secrets.delete(a.id);
    this.usage.delete(a.id);
    this.signedIn.delete(a.id);
    this.sessionOut.delete(a.id);
    this.refresh.delete(a.id);
    this.plans.delete(a.id);
    this.running.delete(a.id);
    this.save(this.list().filter((x) => x.id !== a.id));
    await mergeSecrets(this.deps.secretsFile, { [secretKey(a.id)]: undefined });
    // The login's folder (its credentials) goes with it.
    if (a.kind === 'subscription-login') await fs.rm(path.join(this.deps.home, 'accounts', a.id), { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }
}

/** An API key as pasted: trimmed, the right provider's, never a setup token. */
function checkKey(cli: AccountCli, raw: unknown): string {
  const key = String(raw ?? '').trim();
  if (!key || key.length > 400 || /\s/.test(key)) throw new HttpError(400, "That doesn't look like an API key.");
  if (cli === 'claude' && key.startsWith('sk-ant-oat')) throw new HttpError(400, "That's a claude setup-token token: add it as a setup token account (it's read from your environment, never saved).");
  const wrong = secretMismatch(cli === 'claude' ? 'anthropic' : 'openai', key);
  if (wrong) throw new HttpError(400, wrong);
  return key;
}
