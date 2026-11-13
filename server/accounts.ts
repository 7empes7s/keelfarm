// Providers & accounts (#247, docs/accounts.md): the registry of logins and keys the coding agents on this computer run
// on, in <SWARM_HOME>/accounts.json without a secret. API keys live in secrets.json (`account:<id>`); setup tokens are read from
// the office's environment and never written down (cloud.ts). A subscription login has its own folder under
// <SWARM_HOME>/accounts/<id>/, which its sign-in terminal and its sessions use as CLAUDE_CONFIG_DIR or CODEX_HOME.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from './httpError.ts';
import { builtInPrefs, prepareLogin } from './cliSetup.ts';
import { shareLogin, shareStatus, unshareLogin } from './sharedLogin.ts';
import { mergeSecrets, readSecrets } from './secrets.ts';
import { AgentTerminal } from './terminal.ts';
import { POLL_MS } from './usagePoll.ts';
import type { AccountCheck, LoginFile } from './accountCheck.ts';
import { authAfter, authNote, authUsable, type AuthEvidence, type AuthProbe, type AuthRecord } from '../shared/accountAuth.ts';
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
  sameSubscription,
  type AccountPatch,
  type AccountSetup,
} from '../shared/accounts.ts';
import { defaultAccount, makeDefault, tasksLeft } from '../shared/accountDefault.ts';
import { addSpan, hasRoom, NEAR_OUT_PCT, pickAccount, rotationStats, type Candidate } from '../shared/accountRotation.ts';
import { livePct, mergeReadings } from '../shared/usage.ts';
import { codeProblem, inputShape, menuKeys, signInCode, signInEnd, signInScreen } from '../shared/signIn.ts';
import { secretMismatch } from '../shared/secretFormats.ts';
import type { AccountCli, AccountKind, AccountsView, AccountSwitch, AccountView, ProviderAccount, RotationSettings, SignInMode, SignInRun, UsageReading } from '../shared/types.ts';

/** How long after a session hit a limit its login's usage is read again (a limit Anthropic doesn't show is lifted then). */
const RECHECK_MS = 60_000;

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
  /** The built-in Claude login's plan and owner, read from its files without a request (#460; the demo's is fake). */
  login?: (a: ProviderAccount, dir: string) => Promise<{ plan: string | null; who: string | null; file?: LoginFile | null }>;
  /** A login's CLI signing in in a terminal, with its folder (localSignIn.ts; the demo's is fake). */
  signIn: (o: { cli: AccountCli; env: Record<string, string>; term: AgentTerminal; mode: SignInMode }, exited: (code: number) => void) => BoxSignIn;
  /** The cost ledger's sessions, for today's spend per account. */
  spend: () => { at: number; usd: number; account?: string }[];
  /** Agents (and the CEO) with what they're pinned to. */
  agents: () => { id: string; account?: string; role?: string }[];
  /** The built-in Claude login's readings: the office already keeps them (claudeUsage). */
  builtInUsage: () => UsageReading[];
  changed: (view: AccountsView) => void;
  /** The demo's made-up accounts, for a registry with only the built-in ones. */
  seed?: () => { accounts: ProviderAccount[]; keys: Record<string, string> };
  /** Check the logins now and every POLL_MS (off in tests). */
  poll?: boolean;
  /** Rotation's settings (#248); absent: off, sessions run on their binding's account as before. */
  rotation?: () => RotationSettings;
  /** The folder every Claude login shares memory, conversations and settings with (#377); absent: the built-in login's. */
  shareFrom?: string;
  /** The accounts the tasks running now started on (#390): Mission control's "tasks left" after Make default. */
  tasks?: () => string[];
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
  /** Each account's sign-in, from every probe, session, sign-in and login file (#637, shared/accountAuth.ts): the one state everything reads. */
  private auth = new Map<string, AuthRecord>();
  private plans = new Map<string, string | null>(); // the plan each Claude login really has (#442)
  private owners = new Map<string, string | null>(); // who each Claude login belongs to, never sent to tabs (#460)
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
    for (const a of this.list()) this.share(a.id);
    if (!this.deps.poll) return;
    // Every login but the built-in ones (the office reads Claude's usage already; its sign-in from its file) is checked now, then every POLL_MS.
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

  // ---------- the shared set (#377) ----------

  private shareSource(): string {
    return this.deps.shareFrom ?? builtInDir(path.join, 'claude', this.deps.env, this.deps.homedir ?? os.homedir());
  }

  /** A Claude login with a folder of its own, which shares the built-in login's set. */
  private ownsFolder(a: ProviderAccount | undefined): a is ProviderAccount {
    return !!a && a.cli === 'claude' && a.kind === 'subscription-login' && !a.builtIn;
  }

  /**
   * Links a Claude login's folder to the shared set (memory, conversations, skills, settings), merging what it had into
   * it first; logs what moved. Returns the items it couldn't share; [] for every other account (it shares already).
   */
  share(id: string): string[] {
    const a = this.list().find((x) => x.id === id);
    if (!this.ownsFolder(a)) return [];
    try {
      const r = shareLogin(this.dirOf(a), this.shareSource(), a.id);
      for (const m of r.moved) console.log(`account ${a.id}: merged into the shared set: ${m}`);
      return r.missing;
    } catch (err) {
      console.warn(`account ${a.id}: couldn't link its folder to the shared set: ${(err as Error).message}`);
      return shareStatus(this.dirOf(a), this.shareSource());
    }
  }

  /** Whether a session on this account sees the built-in login's conversations, so --resume works across accounts. */
  sharesConversations(id: string): boolean {
    return !this.share(id).includes('projects');
  }

  /** POST /api/accounts/:id/share: Repair, the links made again. */
  repairShare(id: string): string {
    this.find(id);
    const missing = this.share(id);
    this.emit();
    return missing.length ? `Still not shared: ${missing.join(', ')} (see the office's log).` : '✓ Repaired: it shares everything again.';
  }

  private secretOf(a: ProviderAccount): string {
    if (a.kind === 'setup-token') return (a.tokenEnv ? this.deps.env[a.tokenEnv] : '')?.trim() ?? '';
    return this.secrets.get(a.id) ?? '';
  }

  // ---------- sign-in state (#637) ----------

  /** Whether a session may start on it: its auth record, else a built-in login (or a saved key) counts as signed in until something says otherwise. */
  private usable(a: ProviderAccount): boolean {
    if (a.kind !== 'subscription-login' && !this.secretOf(a)) return false;
    return authUsable(this.auth.get(a.id), a.kind !== 'subscription-login' || !!a.builtIn);
  }

  private evidence(id: string, ev: AuthEvidence) {
    this.auth.set(id, authAfter(this.auth.get(id), ev));
  }

  /** The account's sign-in record (tests, company_status). */
  authOf(id: string): AuthRecord | undefined {
    return this.auth.get(id);
  }

  // ---------- views ----------

  /** Each account with what its status is read from: signed in, usage, today's spend (and sessions). */
  private candidates(now: number, lines = this.deps.spend()): (Candidate & { sessions: number })[] {
    return this.list().map((a) => {
      const usage = a.builtIn && a.cli === 'claude' ? this.deps.builtInUsage() : (this.usage.get(a.id) ?? []);
      const spend = accountSpend(lines, a, now);
      const signedIn = this.usable(a);
      return { account: a, signedIn, usage, todayUsd: spend.usd, sessions: spend.sessions };
    });
  }

  view(now = Date.now()): AccountsView {
    const agents = this.deps.agents();
    const shared = sameSubscription(this.list().filter((a) => a.enabled && !a.removing).map((a) => ({ id: a.id, label: a.label, plan: this.plans.get(a.id), who: this.owners.get(a.id) })));
    const accounts = this.candidates(now)
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
            ...(shared.has(a.id) ? { sameAs: shared.get(a.id) } : {}),
            ...(this.auth.get(a.id)?.state === 'refresh' ? { tokenRefresh: true } : {}),
            ...(authNote(this.auth.get(a.id)) && this.auth.get(a.id)?.state !== 'refresh' ? { authNote: authNote(this.auth.get(a.id))! } : {}),
            ...(this.ownsFolder(a) ? { shareMissing: shareStatus(this.dirOf(a), this.shareSource()) } : {}),
          };
        });
    const running = this.deps.tasks?.() ?? [];
    const switching = ACCOUNT_CLIS.map((cli) => ({ cli, to: defaultAccount(accounts, cli)?.label ?? '', left: tasksLeft(running, accounts, cli) })).filter((x) => x.left.length);
    return {
      accounts,
      rotation: rotationStats(this.switches, now),
      next: { claude: this.pick(undefined, 'claude', now)?.id ?? null, ceo: this.pick(this.deps.agents().find((x) => x.role === 'ceo')?.account, 'claude', now)?.id ?? null },
      ...(switching.length ? { switching } : {}),
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
   * The account a new session of an agent pinned to `binding` runs on (its task's account first, `sticky`, while
   * it's usable), with what it adds to the session's environment; null: it runs as before accounts. Its running count goes up until release().
   */
  use(binding: string | undefined, cli: AccountCli, sticky?: string): AccountUse | null {
    const a = this.pick(binding, cli, Date.now(), sticky);
    return a ? this.take(a) : null;
  }

  /** The account a new session pinned to `binding` would start on (rotation's pick, else the binding's), without starting one. */
  private pick(binding: string | undefined, cli: AccountCli, now: number, sticky?: string): ProviderAccount | null {
    const r = this.rotation();
    return (r.on ? pickAccount(binding, this.candidates(now), now, { cli, apiLast: r.apiLast, sticky }) : null) ?? resolveAccount(this.list(), binding, cli);
  }

  /** The account the next unpinned session of `cli` would start on, with its readings: what pacing and company.usage name (#383). */
  upNext(cli: AccountCli, now = Date.now()): { id: string; label: string; usage: UsageReading[] } | null {
    const a = this.pick(undefined, cli, now);
    const c = a && this.candidates(now).find((x) => x.account.id === a.id);
    return c ? { id: c.account.id, label: c.account.label, usage: [...c.usage] } : null;
  }

  /** Whether rotation has another account of `cli` with room, besides `except`: a warning on that one then paces only it (#383). */
  hasRoom(cli: AccountCli, except: string, now = Date.now()): boolean {
    const r = this.rotation();
    return r.on && hasRoom(this.candidates(now), now, { cli, apiLast: r.apiLast, skip: [except] });
  }

  /** Rotation's next account for a session whose account was out (#248), skipping the ones it tried; null: none is left. */
  next(binding: string | undefined, cli: AccountCli, tried: readonly string[]): AccountUse | null {
    const now = Date.now();
    const a = pickAccount(binding, this.candidates(now), now, { cli, apiLast: this.rotation().apiLast, skip: tried });
    return a ? this.take(a) : null;
  }

  /** The same account once more (#637): a session's sign-in failure the probe didn't confirm; null once it's gone or out. */
  again(id: string): AccountUse | null {
    const a = this.list().find((x) => x.id === id);
    return a && !a.removing && this.usable(a) ? this.take(a) : null;
  }

  /**
   * Whether rotation would start a new session of `cli` on some account right now: rotation is on and one is ready
   * (or near its limit). A full window on one login then only rests that login, not the office.
   */
  hasFree(cli: AccountCli, now = Date.now()): boolean {
    const r = this.rotation();
    return r.on && !!pickAccount(undefined, this.candidates(now), now, { cli, apiLast: r.apiLast });
  }

  /** Whether a session pinned to `binding` (or the rotation's) would start on an account of `cli` with room now: the CEO's own pick runs through the office's pause (#418). */
  ready(binding: string | undefined, cli: AccountCli, now = Date.now()): boolean {
    return !!pickAccount(binding, this.candidates(now), now, { cli, apiLast: this.rotation().apiLast });
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
    this.evidence(id, { kind: 'ok', from: 'session', at: Date.now() }); // its session ran, so its token is fresh again
    this.roomAgain(id, this.usage.get(id) ?? []);
    this.emit();
  }

  /** A session on it finished its work: it's signed in, whatever was said before (#637). */
  ran(id: string) {
    const was = this.auth.get(id)?.state;
    this.evidence(id, { kind: 'ok', from: 'session', at: Date.now() });
    if (was !== 'ready') this.emit();
  }

  /** The built-in Claude login's readings (the office keeps them, claudeUsage) changed: its limit may be over. */
  builtInReadings() {
    const a = this.list().find((x) => x.builtIn && x.cli === 'claude');
    if (a) this.roomAgain(a.id, this.deps.builtInUsage());
  }

  /** A limit is over once every limit's latest reading (not just the newest one) shows room, as a poll's do in test(). */
  private roomAgain(id: string, merged: readonly UsageReading[], now = Date.now()) {
    const cur = this.list().find((x) => x.id === id);
    if (cur?.limitedUntil && cur.limitedUntil > now && merged.length && merged.every((r) => livePct(r, now) < NEAR_OUT_PCT)) this.replace({ ...cur, limitedUntil: null });
  }

  /** A session on an account hit its usage limit. */
  limited(id: string, resetsAt: number | null, now = Date.now()) {
    const a = this.list().find((x) => x.id === id);
    if (!a) return;
    const until = resetsAt ?? now + 60 * 60_000;
    this.replace({ ...a, limitedUntil: until, limitHits: [...recentHits(a.limitHits, now), now], limitSpans: addSpan(a.limitSpans, now, until, now) });
    // A session's message isn't the last word: the provider's own usage, read a minute later, lifts a limit that isn't there.
    if (this.deps.poll && a.kind === 'subscription-login' && !a.builtIn) setTimeout(() => void this.test(id).catch(() => undefined), RECHECK_MS).unref?.();
  }

  /** Its limit is over (the demo's "End the limit"): back in the rotation now. */
  back(id: string) {
    const a = this.list().find((x) => x.id === id);
    if (a?.limitedUntil) this.replace({ ...a, limitedUntil: null });
  }

  /**
   * A session on an account ended on a sign-in, an expired login or a turned-away key (#637): it's re-probed before it
   * reads Signed out (`screen`: its CLI showed its own sign-in screen, which is out at once; only a rewritten login file or a sign-in brings it back). Resolves to whether a session may start on it again (the probe found a token, or couldn't reach
   * the provider) — at most SESSION_TRIES sessions in a row, then it's Signed out until a sign-in or a session that ran.
   */
  async sessionSignedOut(id: string, screen = false, now = Date.now()): Promise<boolean> {
    const a = this.list().find((x) => x.id === id);
    if (!a) return false;
    this.evidence(id, { kind: 'out', from: 'session', at: now, ...(screen && { hard: true }) });
    this.emit();
    await this.test(id).catch(() => undefined);
    return this.usable(this.list().find((x) => x.id === id) ?? a);
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
      this.evidence(a.id, { kind: 'ok', from: 'signin', at: Date.now() });
    } else if (kind === 'setup-token') {
      const name = String(x.tokenEnv ?? '').trim();
      if (!ENV_NAME.test(name)) throw new HttpError(400, 'Name the environment variable that holds the token, e.g. CUBEFARM_CLAUDE_TOKEN_2.');
      a.tokenEnv = name;
    } else await fs.mkdir(this.dirOf(a), { recursive: true });
    this.save([...list, a]);
    this.share(a.id);
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

  /** Make default (#390): first of its coding agent's, so new tasks start on it. Returns it. */
  makeDefault(id: string): ProviderAccount {
    const a = this.list().find((x) => x.id === id);
    if (!a) throw new HttpError(404, `No account "${id}". Accounts: ${this.list().map((x) => `${x.id} (${x.label})`).join(', ')}.`);
    if (!a.enabled || a.removing) throw new HttpError(400, `${a.label} is paused: resume it first.`);
    this.save(makeDefault(this.list(), id));
    return a;
  }

  /** PUT /api/accounts/:id/key: a new key for an API key account, tested first. */
  async setKey(id: string, raw: unknown): Promise<string> {
    const a = this.find(id);
    if (a.kind !== 'api-key') throw new HttpError(400, 'Only API key accounts take a key.');
    const key = checkKey(a.cli, raw);
    const check = await this.deps.check(a, '', key);
    if (!check.signedIn) throw new HttpError(400, check.note);
    this.secrets.set(id, key);
    this.evidence(id, { kind: 'ok', from: 'signin', at: Date.now() });
    await mergeSecrets(this.deps.secretsFile, { [secretKey(id)]: key });
    this.emit();
    return check.note;
  }

  /** POST /api/accounts/:id/test: is it signed in (and its usage), or does the provider take the key. */
  async test(id: string): Promise<string> {
    const a = this.find(id);
    const at = Date.now(); // the probe's start: evidence that comes in meanwhile is newer and wins (#637)
    const r = await this.deps.check(a, this.dirOf(a), this.secretOf(a));
    if (!this.list().some((x) => x.id === id)) return r.note; // removed meanwhile
    // Its login file rewritten after the newest evidence is a fresh login (a sign-in, or its CLI's refresh); then the probe.
    if (r.fileAt !== undefined && probeOf(r) !== 'out') this.evidence(id, { kind: r.refresh ? 'refresh' : 'ok', from: 'file', at: r.fileAt });
    this.evidence(id, { kind: probeOf(r), from: 'probe', at });
    if (r.plan !== undefined) this.plans.set(id, r.plan);
    if (r.who !== undefined) this.owners.set(id, r.who);
    if (r.readings.length) this.usage.set(id, mergeReadings(this.usage.get(id) ?? [], r.readings));
    // No 5-hour window on this plan (a verified Ultra): an old 5-hour reading or limit is out of date, never a reason to wait.
    if (r.noFiveHour) this.usage.set(id, (this.usage.get(id) ?? []).filter((x) => x.type !== 'five_hour'));
    // A limit a session hit is over once the poll shows room again (#248).
    const now = Date.now();
    const cur = this.list().find((x) => x.id === id);
    if (cur?.limitedUntil && cur.limitedUntil > now && r.readings.length && r.readings.every((x) => x.pct < NEAR_OUT_PCT)) this.replace({ ...cur, limitedUntil: null });
    this.emit();
    const rec = this.auth.get(id);
    return rec?.state === 'signed-out' && probeOf(r) !== 'out' ? (authNote(rec) ?? r.note) : r.note;
  }

  private async pollAll() {
    for (const a of this.list()) if (!a.builtIn && a.kind !== 'api-key' && a.enabled) await this.test(a.id).catch(() => undefined);
    // The built-in Claude login's plan and owner (#460): its usage the office reads already.
    const claude = this.list().find((a) => a.builtIn && a.cli === 'claude' && a.enabled);
    const own = claude && (await this.deps.login?.(claude, this.dirOf(claude)).catch(() => null));
    if (claude && own) {
      this.plans.set(claude.id, own.plan);
      this.owners.set(claude.id, own.who);
      if (own.file !== undefined) this.builtInFile(claude.id, own.file);
      this.emit();
    }
    // The built-in Codex login's rate limits (#361): nothing else reads them. Only its readings: whether it counts as
    // signed in stays as it was (Codex may run on OPENAI_API_KEY with no login file).
    const codex = this.list().find((a) => a.builtIn && a.cli === 'codex' && a.enabled);
    const r = codex && (await this.deps.check(codex, this.dirOf(codex), '').catch(() => null));
    if (codex && r?.readings.length) this.readings(codex.id, r.readings);
  }

  /** The built-in Claude login's sign-in from its credentials file (#579): signed out, limited and signed in told apart without a request. */
  private builtInFile(id: string, file: LoginFile | null) {
    if (!file) return; // a keychain or a token in the environment: nothing to judge by
    // A token in it counts from when the file was written: a session's sign-in failure after that still stands (#579).
    if (file.state === 'out') this.evidence(id, { kind: 'out', from: 'file', at: Math.max(Date.now(), file.changedAt) });
    else this.evidence(id, { kind: file.state === 'in' ? 'ok' : 'refresh', from: 'file', at: file.changedAt });
    // A session's sign-in failure the file can't settle (it hasn't changed since): the usage endpoint can.
    if (this.auth.get(id)?.state === 'signed-out' && file.state !== 'out') void this.test(id).catch(() => undefined);
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
    // A new login starts with the built-in one's theme and its onboarding done (Gemini CLI's: the Google sign-in picked), so its sign-in opens on the sign-in (#360, #365).
    if (!a.builtIn && a.cli !== 'codex') {
      try {
        prepareLogin(a.cli, dir, [], { prefs: builtInPrefs() });
        this.share(id);
      } catch (err) {
        console.warn(`account ${id}: couldn't set up its login folder: ${(err as Error).message}`);
      }
    }
    const term = this.terminal(id)!;
    const run = this.deps.signIn({ cli: a.cli, env, term, mode }, (code) => {
      if (this.signIns.get(id) !== run) return; // replaced by a newer one
      this.signIns.delete(id);
      void term.flush().then(() => {
        if (this.signIns.has(id)) return;
        const end = signInEnd(mode, code, term.unwrapped().split('\n')); // joined: a narrow phone's terminal wraps the reason (#350)
        this.runs.set(id, { mode, running: false, ...end });
        if (!end.ok) term.note(end.note);
        else {
          this.back(id); // a new login, maybe another account: its old limit isn't its (a real one comes back on its next session)
          this.evidence(id, { kind: 'ok', from: 'signin', at: Date.now() }); // obsolete sign-out evidence goes; the Test below has the last word
        }
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
    this.auth.delete(a.id);
    this.plans.delete(a.id);
    this.owners.delete(a.id);
    this.running.delete(a.id);
    this.save(this.list().filter((x) => x.id !== a.id));
    await mergeSecrets(this.deps.secretsFile, { [secretKey(a.id)]: undefined });
    // The login's folder (its credentials) goes with it; the shared set it links to stays.
    if (this.ownsFolder(a)) {
      try {
        unshareLogin(this.dirOf(a));
      } catch (err) {
        console.warn(`account ${a.id}: couldn't unlink its folder from the shared set, so it's kept: ${(err as Error).message}`);
        return;
      }
    }
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

/** What a check found for its sign-in: its own word, else read from signedIn and refresh (the demo's checks). */
const probeOf = (r: AccountCheck): AuthProbe => r.auth ?? (!r.signedIn ? 'out' : r.refresh ? 'refresh' : 'ok');
