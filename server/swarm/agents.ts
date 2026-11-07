// The staff: hiring and firing, agent commands, cloud agents' machines and sign-ins, Tools & skills.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { BoxCliRecord, BoxTarget } from '../boxCli.ts';
import { redact } from '../cloud.ts';
import { HttpError } from '../httpError.ts';
import { issueTaken } from '../issueClaims.ts';
import { cliLabel, isCli } from '../clis.ts';
import { machineName } from '../machines.ts';
import type { SessionKind } from '../health.ts';
import { apply as applyLedger } from '../ledger.ts';
import type { AgentTerminal } from '../terminal.ts';
import {
  isToolId,
  mergeSwitches,
  sessionTools,
  setSwitch,
  toolArgsLine,
  type SessionTools,
} from '../../shared/tooling.ts';
import { blockers, waitsMessage } from '../../shared/issues.ts';
import { ChatLog, quoteOf, type TranscriptEvent } from '../../shared/agentChat.ts';
import { redact as scrub } from '../../shared/journal.ts';
import { isAgentReaction, reactionNote } from '../../shared/reactions.ts';
import { cleanStyle } from '../../shared/looks.ts';
import { effectiveModel } from '../../shared/models.ts';
import { FLOOR_SEATS } from '../../shared/types.ts';
import type { AgentCli, AgentLook, AgentView, EffortLevel, MachineHost } from '../../shared/types.ts';
import {
  type PersistedRepo,
  type PersistedAgent,
  DEFAULT_MODEL,
  EFFORTS,
  BUSY,
  oneLine,
  SIGN_IN_POLL_MS,
  SIGN_IN_IDLE_POLL_MS,
  type BoxCliId,
  SignInNeeded,
  type SignIn,
  terminalFile,
} from './model.ts';
import { SHIRTS, HAIR, SKIN, NAMES, lookFor, LOOKS, pick } from './flavour.ts';
import { removeScreens } from './screens.ts';
import { SwarmMerge } from './merge.ts';

export abstract class SwarmAgents extends SwarmMerge {
  // ---------- agents ----------

  /** Answering one of the CEO's consults (#28): working to everyone, though their saved status stays as it was. */
  protected consulting(a: PersistedAgent) {
    return this.consults.some((c) => c.runningOn === a.id);
  }

  protected agentView(a: PersistedAgent, withLog: boolean): AgentView {
    const v = super.agentView(a, withLog);
    return this.consulting(a) ? { ...v, status: 'working', issueTitle: `Consult for ${this.ceo().name}` } : v;
  }

  hireAgent(
    repoId: string,
    opts: {
      name?: string;
      model?: string;
      effort?: string;
      look?: string;
      cli?: string;
      /** Where they work: 'local', 'box', or '' / absent for the office default (Settings → Cloud agents). */
      host?: string;
      /** Refuse rather than fall back to this computer when they can't be a cloud agent (the manager chose). */
      strict?: boolean;
      appearance?: { color: string; hair: string; skin: string };
      /** Their id, when it's known before they're hired (a team change's): their look is seeded from it. */
      id?: string;
    },
  ) {
    const repo = this.repo(repoId);
    const team = this.state.agents.filter((a) => a.repoId === repo.id);
    const max = this.state.settings.maxAgents;
    if (team.length >= max) throw new HttpError(409, `Floor ${repo.floor} already has ${team.length} agents, its most (${max}). Raise "Most agents per floor" in Settings to add more.`);
    const used = new Set(team.map((a) => a.desk));
    let desk = 0;
    while (used.has(desk)) desk++;
    if (desk >= FLOOR_SEATS) throw new HttpError(409, `Floor ${repo.floor} has no free desk (${FLOOR_SEATS} desks)`);
    const name = opts.name?.trim().slice(0, 24) || this.freeName();
    const cli = isCli(opts.cli) ? opts.cli : '';
    const host = this.hostFor(opts.host, cli || this.state.settings.defaultCli, !!opts.strict);
    // A cloud agent's CLI is the one the office installs in their Box, not this computer's.
    if (cli && host === 'local' && !this.cliReady(cli)) throw new HttpError(400, `${cliLabel(cli)} isn't installed on this computer.`);
    const id = opts.id && !this.state.agents.some((a) => a.id === opts.id) ? opts.id : crypto.randomUUID();
    const agent: PersistedAgent = {
      id,
      name,
      repoId: repo.id,
      role: 'agent',
      look: LOOKS.includes(opts.look as AgentLook) ? (opts.look as AgentLook) : lookFor(name),
      task: null,
      desk,
      color: opts.appearance?.color ?? pick(SHIRTS),
      hair: opts.appearance?.hair ?? pick(HAIR),
      skin: opts.appearance?.skin ?? pick(SKIN),
      style: null,
      model: opts.model ?? '',
      effort: EFFORTS.includes(opts.effort as EffortLevel) ? (opts.effort as EffortLevel) : '',
      cli,
      machine: machineName(id),
      ...(host === 'box' ? { host } : {}),
      status: 'idle',
      issueNumber: null,
      issueTitle: null,
      branch: null,
      prNumber: null,
      prUrl: null,
      startedAt: null,
      endedAt: null,
      costUsd: 0,
      turns: 0,
      sessionId: null,
      sessionCli: null,
      lastError: null,
      logTail: [],
    };
    this.state.agents.push(agent);
    applyLedger(this.state.progress, { kind: 'hired', agentId: agent.id, at: Date.now() });
    this.agentRt.set(agent.id, { log: [], session: null, currentTool: null, browserUrl: null, screenshot: null, shots: [], terminal: null });
    this.appendLog(agent, [{ kind: 'system', text: `👋 ${name} joined floor ${repo.floor} (${repo.fullName})${host === 'box' ? ', working in the cloud' : ''}.` }]);
    this.save();
    this.broadcast({ type: 'agent', agent: this.agentView(agent, false) });
    if (host === 'box') this.bringUpBox(agent);
    setTimeout(() => this.schedule(), 200);
    return this.agentView(agent, true);
  }

  // ---------- cloud agents (docs/cloud.md) ----------

  /**
   * Where a new (or moving) agent works: what was asked, else the office default. A cloud agent needs the Upstash key,
   * room under the plan's Box limit and a CLI a Box can run (Claude Code or Codex). `strict`: the manager asked for the
   * cloud, so say why not; otherwise (a floor's first agent, the demo) they work on this computer instead.
   */
  protected hostFor(asked: string | undefined, cli: AgentCli, strict: boolean, moving?: PersistedAgent): MachineHost {
    const want: MachineHost = asked === 'box' || asked === 'local' ? asked : this.state.settings.cloud.machineKind;
    if (want === 'local') return 'local';
    const why = !this.cloud.boxApi()
      ? 'Cloud agents need your Upstash Box API key first: Settings → Cloud agents.'
      : cli === 'opencode'
        ? "OpenCode can't run in a cloud machine yet: give this agent Claude Code or Codex."
        : !this.boxRoom(moving)
          ? `Your Upstash plan's Box limit (${this.state.settings.cloud.boxLimit}) is reached. Raise it in Settings → Cloud agents if your plan allows more, or delete Boxes you don't need.`
          : null;
    if (!why) return 'box';
    if (strict || asked === 'box') throw new HttpError(409, why);
    return 'local';
  }

  /** There's room for one more Box under the plan's limit (Boxes on the account, or cloud agents, whichever is more). */
  protected boxRoom(moving?: PersistedAgent) {
    const agents = this.state.agents.filter((a) => a.host === 'box' && a !== moving).length;
    return Math.max(this.cloud.view().boxes?.total ?? 0, agents) < this.state.settings.cloud.boxLimit;
  }

  /** Create and set up a new cloud agent's Box in the background, so their first task doesn't wait for it. */
  protected bringUpBox(a: PersistedAgent) {
    const machine = this.machineOf(a);
    const note = (text: string) => this.appendLog(a, [{ kind: 'system', text: `☁ ${text}` }]);
    void this.boxMachines
      .ensure(machine, note)
      .then(() => {
        note('Their cloud machine is ready.');
        void this.cloud.count().catch(() => undefined);
        void this.checkSignIn(a);
      })
      .catch((err) => {
        const why = redact(oneLine(err), this.secrets());
        this.appendLog(a, [{ kind: 'error', text: `✗ Their cloud machine couldn't be set up: ${why}` }]);
        this.postMessage('office', `⚠️ ${a.name}'s cloud machine couldn't be set up: ${why.slice(0, 240)}`);
      });
  }

  /**
   * Move an agent between this computer and the cloud, while they have no task. Their old machine goes (unpushed work
   * saved to leftovers); sessions can't move between machines, so their next one starts fresh.
   */
  protected moveAgent(a: PersistedAgent, to: MachineHost) {
    if ((a.host ?? 'local') === to) return;
    if (a.task || BUSY.includes(a.status)) throw new HttpError(409, `${a.name} is on a task: move them once it's done.`);
    const host = this.hostFor(to, a.cli || this.state.settings.defaultCli, true, a);
    const from = a.host ?? 'local';
    this.agentRt.get(a.id)?.terminal?.releaseIdle?.(); // a CLI still waiting at its prompt stays where it was
    if (a.machine) void this.removeMachine(a.machine, a.name, from);
    if (host === 'box') a.host = 'box';
    else delete a.host;
    a.boxCli = null;
    this.dropSignIn(a.id);
    delete a.needsSignIn;
    a.sessionId = null;
    a.sessionCli = null;
    for (const q of this.state.qa) if (q.devAgentId === a.id) q.devSessionId = null;
    this.appendLog(a, [{ kind: 'system', text: host === 'box' ? '☁ Moving to the cloud: an Upstash Box of their own.' : '🖥️ Moving back to this computer.' }]);
    if (host === 'box') this.bringUpBox(a);
  }

  /**
   * What a cloud agent's session runs with: their Box, set up and awake, and the credentials their CLI signs in with.
   * Without a key from the office, their CLI uses its own login in the Box: it's checked first (a signed-out one throws
   * SignInNeeded), except for a prompt the manager already typed into the CLI.
   */
  protected async boxTarget(a: PersistedAgent, cli: AgentCli, browserTesting: boolean, check = true): Promise<BoxTarget> {
    const api = this.cloud.boxApi();
    if (!api) throw new Error('Cloud agents need your Upstash Box API key: Settings → Cloud agents.');
    const machine = this.machineOf(a);
    const boxId = await this.boxMachines.ensure(machine, (text) => this.appendLog(a, [{ kind: 'system', text: `☁ ${text}` }]));
    const creds = await this.cloud.credentials(cli);
    if (creds.missing.length) throw new Error(`Cloud agents can't sign in yet. Missing: ${creds.missing.join('; ')}.`);
    if (check && creds.ownLogin && cli !== 'opencode' && (await this.boxMachines.signedIn(machine, cli).catch(() => null)) === false) throw new SignInNeeded(cli);
    // The Box's own Chromium starts with a first tab; Playwright attaches to it.
    const browser = browserTesting ? await api.browser(boxId).catch(() => false) : false;
    return { api, boxId, env: creds.env, apiKeyHelper: creds.apiKeyHelper, browser, record: (rec) => this.boxCliRecord(a.id, rec), connection: (up) => this.boxMachines.connection(machine, up) };
  }

  /** A cloud agent's live CLI record changed: kept with them, so a restart picks the CLI up. Gone with no task: the Box can pause. */
  protected boxCliRecord(agentId: string, rec: BoxCliRecord | null) {
    const a = this.state.agents.find((x) => x.id === agentId);
    if (!a) return;
    const was = a.boxCli;
    a.boxCli = rec;
    if (rec && was && was.token === rec.token && was.offset === rec.offset && was.busy === rec.busy && was.resumeId === rec.resumeId) return;
    this.save();
    if (!rec && was && !a.task && a.machine && a.host === 'box') void this.boxMachines.pause(a.machine).catch(() => undefined);
  }

  /** A machine's Box changed state: its agent's card shows it. */
  protected boxState(machine: string) {
    const a = this.state.agents.find((x) => x.host === 'box' && x.machine === machine);
    if (a) this.emitAgent(a);
  }

  // Settings → Cloud agents (REST)

  setCloudKey(key: string) {
    return this.cloud.setKey(key).then((view) => {
      if (!view.keySet && this.state.settings.cloud.machineKind === 'box') {
        // No key, no cloud: new agents work on this computer until it's back.
        this.state.settings.cloud = { ...this.state.settings.cloud, machineKind: 'local' };
        this.broadcast({ type: 'settings', settings: this.state.settings });
        this.save();
      }
      return view;
    });
  }

  setCloudToken(kind: string, value: string) {
    if (kind !== 'github' && kind !== 'anthropic' && kind !== 'openai') throw new HttpError(400, 'kind must be github, anthropic or openai');
    return this.cloud.setToken(kind, value).then((view) => {
      // A key for their CLI now: agents waiting to sign in don't need to any more.
      for (const a of this.state.agents) if (a.host === 'box' && a.needsSignIn) void this.checkSignIn(a);
      return view;
    });
  }

  // ---------- signing cloud agents in (docs/cloud.md) ----------

  /**
   * A cloud agent's CLI has no login in their Box (a new Box, or one that expired): they're marked as needing a sign-in
   * and take no work, the task they were starting (if any) waits, and the CLI's own sign-in starts in their terminal.
   */
  protected holdForSignIn(a: PersistedAgent, cli: BoxCliId, task: (() => void) | null, expired = false) {
    if (!this.state.agents.includes(a) || a.host !== 'box') return;
    const s = this.signInOf(a, cli);
    const label = cliLabel(cli);
    if (task) {
      a.status = 'preparing';
      s.held = () => {
        if (a.status === 'preparing') task();
        else this.abandoned(a); // stopped meanwhile
      };
      this.appendLog(a, [{ kind: 'system', text: `⏸ Their task waits until ${label} is signed in.` }]);
    }
    if (!a.needsSignIn) {
      a.needsSignIn = true;
      this.appendLog(a, [
        {
          kind: 'error',
          text: `🔑 ${expired ? `${label}'s sign-in in their cloud machine expired.` : `${label} isn't signed in in their cloud machine yet.`} Sign it in in their terminal (at their desk, or 🔑 Sign in): open the link there and finish signing in.`,
        },
      ]);
      this.postMessage('office', `🔑 ${a.name} needs you to sign ${label} in${expired ? ' again' : ''}: walk to their desk or tap 🔑 Sign in on their card, then follow the link in their terminal. Their cloud machine keeps the sign-in.`);
    }
    this.emitAgent(a);
    this.save();
    void this.startSignIn(a);
  }

  /** Their sign-in's state, made (or switched to another CLI, keeping the held task) when needed. */
  protected signInOf(a: PersistedAgent, cli: BoxCliId): SignIn {
    let s = this.signIns.get(a.id);
    if (!s) {
      s = { cli, held: null, run: null, starting: false, poll: null };
      this.signIns.set(a.id, s);
    } else if (s.cli !== cli) {
      s.run?.stop();
      s.run = null;
      s.cli = cli;
    }
    return s;
  }

  /** Their sign-in goes (they left, moved to this computer): its CLI closes and a held task is dropped with it. */
  protected dropSignIn(agentId: string) {
    const s = this.signIns.get(agentId);
    if (!s) return;
    this.signIns.delete(agentId);
    if (s.poll) clearTimeout(s.poll);
    s.run?.stop();
  }

  /** Start the CLI's own sign-in in their terminal, unless it's running already. */
  protected async startSignIn(a: PersistedAgent) {
    const cli = a.cli || this.state.settings.defaultCli;
    const api = this.cloud.boxApi();
    if (!a.needsSignIn || a.host !== 'box' || cli === 'opencode' || !api) return;
    const s = this.signInOf(a, cli);
    if (s.run || s.starting) return;
    s.starting = true;
    try {
      const boxId = await this.boxMachines.ensure(this.machineOf(a), (text) => this.appendLog(a, [{ kind: 'system', text: `☁ ${text}` }]));
      if (!a.needsSignIn || this.signIns.get(a.id) !== s || s.cli !== cli || !this.state.agents.includes(a)) return;
      s.run = this.backend.cloud.signIn({ api, boxId, cli, term: this.terminalFor(a), agentId: a.id }, (code) => void this.signInEnded(a, s, code));
      this.emitAgent(a); // their terminal is there to open now
      this.pollSignIn(a, s);
    } catch (err) {
      this.appendLog(a, [{ kind: 'error', text: `✗ Couldn't start signing in: ${redact(oneLine(err), this.secrets())}` }]);
    } finally {
      s.starting = false;
    }
  }

  /** While the sign-in runs, look now and then whether it's done (often while someone watches their terminal). */
  protected pollSignIn(a: PersistedAgent, s: SignIn) {
    if (s.poll) clearTimeout(s.poll);
    const wait = this.agentRt.get(a.id)?.terminal?.watched ? SIGN_IN_POLL_MS : SIGN_IN_IDLE_POLL_MS;
    s.poll = setTimeout(() => {
      s.poll = null;
      if (this.signIns.get(a.id) !== s || !s.run) return;
      void this.boxMachines
        .signedIn(this.machineOf(a), s.cli)
        .catch(() => null)
        .then((ok) => {
          if (this.signIns.get(a.id) !== s) return;
          if (ok) this.signedIn(a);
          else if (s.run) this.pollSignIn(a, s);
        });
    }, wait);
  }

  /** The sign-in's CLI exited: signed in, or the manager can start it again from their terminal. */
  protected async signInEnded(a: PersistedAgent, s: SignIn, code: number) {
    if (this.signIns.get(a.id) !== s) return;
    s.run = null;
    if (s.poll) clearTimeout(s.poll);
    const ok = await this.boxMachines.signedIn(this.machineOf(a), s.cli).catch(() => null);
    if (this.signIns.get(a.id) !== s || s.run) return;
    if (ok) return this.signedIn(a);
    this.agentRt.get(a.id)?.terminal?.note(`Not signed in yet. 🔑 Sign in starts it again.`);
    this.appendLog(a, [{ kind: 'error', text: `🔑 ${cliLabel(s.cli)} didn't finish signing in${code > 0 ? ` (it exited with code ${code})` : ''}. 🔑 Sign in in their terminal starts it again.` }]);
  }

  /** Their CLI is signed in: the flag goes and the task it held starts (a sign-in still on screen gets a moment to finish). */
  protected signedIn(a: PersistedAgent) {
    const s = this.signIns.get(a.id);
    this.signIns.delete(a.id);
    if (s?.poll) clearTimeout(s.poll);
    const run = s?.run;
    if (run) setTimeout(() => run.stop(), 3000);
    if (!a.needsSignIn) return;
    a.needsSignIn = false;
    this.appendLog(a, [{ kind: 'done', text: `✔ ${cliLabel(s?.cli ?? 'claude')} is signed in in their cloud machine.${s?.held ? ' Back to the task.' : ''}` }]);
    this.emitAgent(a);
    this.save();
    const held = s?.held;
    if (held) setTimeout(held, run ? 3000 : 0);
    else setTimeout(() => this.schedule(), 200);
  }

  /**
   * Is a cloud agent's CLI signed in? Looked at when their Box is set up, after a restart and when keys or their CLI
   * change. `fresh`: their CLI changed, so a sign-in for the old one stops.
   */
  protected async checkSignIn(a: PersistedAgent, fresh = false) {
    const cli = a.cli || this.state.settings.defaultCli;
    if (a.host !== 'box' || a.role === 'ceo' || !this.cloud.boxApi()) return;
    if (fresh) {
      const s = this.signIns.get(a.id);
      s?.run?.stop();
      if (s) s.run = null;
    }
    if (cli === 'opencode') return this.signedIn(a);
    const creds = await this.cloud.credentials(cli).catch(() => null);
    const ok = !creds ? null : creds.ownLogin ? await this.boxMachines.signedIn(this.machineOf(a), cli).catch(() => null) : true;
    if (!this.state.agents.includes(a) || a.host !== 'box') return;
    if (ok === true) this.signedIn(a);
    else if (ok === false) this.holdForSignIn(a, cli, null);
  }

  /** POST /api/agents/:id/sign-in: start a cloud agent's sign-in (over) in their terminal: it ended, went stale or never started. */
  signIn(id: string) {
    const a = this.agent(id);
    if (a.host !== 'box') throw new HttpError(409, `${a.name} works on this computer: their coding agent signs in there.`);
    if (!a.needsSignIn) throw new HttpError(409, `${a.name}'s coding agent is signed in already.`);
    const s = this.signIns.get(a.id);
    if (s?.run) {
      // Start over: a link that went stale (Codex's code lasts 15 minutes) or a sign-in that went wrong.
      if (s.poll) clearTimeout(s.poll);
      s.run.stop();
      s.run = null;
    }
    this.terminalFor(a);
    void this.startSignIn(a);
    return this.agentView(a, false);
  }

  /** The demo's stand-in for a login that expired (POST /api/cloud/demo-expire): every cloud agent's Box is signed out. */
  expireSignIns() {
    const expire = this.backend.cloud.expireSignIns;
    if (!expire) throw new HttpError(404, 'Sign-ins can only be expired in the demo office.');
    expire();
    // Idle ones notice at once, as their next task's check would; working ones when their session fails.
    for (const a of this.state.agents) if (a.host === 'box' && !a.task) void this.checkSignIn(a);
  }

  testCloud() {
    return this.cloud.test();
  }

  deleteCloudOrphans() {
    return this.cloud.deleteOrphans();
  }

  /** Every floor has at least one agent. */
  protected ensureAgent(repo: PersistedRepo) {
    if (this.state.agents.some((a) => a.repoId === repo.id)) return;
    this.hireAgent(repo.id, {});
  }

  /** A name from the pool that no agent or waiting candidate has. */
  protected freeName() {
    const taken = new Set([...this.state.agents.map((a) => a.name), ...this.state.requests.filter((r) => r.status === 'pending').map((r) => r.name)]);
    return NAMES.find((n) => !taken.has(n)) || `Agent ${this.state.agents.length + 1}`;
  }

  /** The coding agent is installed here (or the office hasn't looked yet: then the session says so if it isn't). */
  protected cliReady(cli: AgentCli) {
    return !this.clis.length || this.clis.some((c) => c.id === cli && c.installed);
  }

  updateAgent(id: string, patch: { name?: string; model?: string; effort?: string; cli?: string; host?: string; look?: string; color?: string; hair?: string; style?: unknown }) {
    const a = this.agent(id);
    if (patch.host !== undefined && a.role !== 'ceo' && (patch.host === 'box' || patch.host === 'local')) this.moveAgent(a, patch.host);
    if (patch.cli !== undefined && a.role !== 'ceo') {
      const cli = isCli(patch.cli) ? patch.cli : '';
      if (a.host === 'box' && (cli || this.state.settings.defaultCli) === 'opencode') throw new HttpError(400, `${a.name} works in the cloud, where OpenCode can't run yet: move them to this computer first.`);
      if (cli && a.host !== 'box' && !this.cliReady(cli)) throw new HttpError(400, `${cliLabel(cli)} isn't installed on this computer.`);
      const changed = cli !== a.cli;
      a.cli = cli;
      // Another coding agent in their Box has a login of its own (or needs one).
      if (changed && a.host === 'box') void this.checkSignIn(a, true);
    }
    if (patch.name?.trim() && patch.name.trim() !== a.name) {
      a.name = patch.name.trim().slice(0, 24);
      a.look = lookFor(a.name);
    }
    if (LOOKS.includes(patch.look as AgentLook)) a.look = patch.look as AgentLook;
    if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) a.color = patch.color;
    if (patch.hair && /^#[0-9a-f]{6}$/i.test(patch.hair)) a.hair = patch.hair;
    if (patch.style !== undefined) a.style = cleanStyle(patch.style); // null: back to the seeded look
    if (patch.model !== undefined) a.model = String(patch.model).trim();
    if (patch.effort !== undefined) a.effort = EFFORTS.includes(patch.effort as EffortLevel) ? (patch.effort as EffortLevel) : '';
    this.save();
    this.emitAgent(a);
  }

  fireAgent(id: string, force = false) {
    const a = this.agent(id);
    if (a.role === 'ceo') throw new HttpError(409, `${a.name} runs the company and can't be let go.`);
    if (!force && this.state.agents.filter((x) => x.repoId === a.repoId).length <= 1) {
      throw new HttpError(409, `${a.name} is the only agent on this floor, and every floor keeps at least one.`);
    }
    for (const r of this.state.requests.filter((x) => x.kind === 'let-go' && x.agentId === id && x.status === 'pending')) {
      this.decide(r, { status: 'approved', note: 'They were let go directly.', decidedBy: 'manager' });
    }

    // A desk being set up for them notices and gives up (prepare() checks the status), rather than start a session.
    if (BUSY.includes(a.status)) a.status = 'stopped';
    this.dropSignIn(id);
    this.agentRt.get(id)?.session?.stop();
    this.agentRt.get(id)?.terminal?.releaseIdle?.();
    this.agentRt.get(id)?.terminal?.dispose();
    void removeScreens(id);
    void fs.rm(terminalFile(id), { force: true }).catch(() => undefined);
    for (const q of this.state.qa) {
      if (q.qaAgentId === id && q.status === 'testing') this.setQa(q, { status: 'queued', qaAgentId: null });
      if (q.devAgentId === id) q.devAgentId = null;
      if (q.devAgentId === null && q.status === 'fixing') this.setQa(q, { status: 'failed' });
    }
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    if (repo) {
      const slug = this.agentSlug(a);
      const main = this.backend.mainDir(repo.fullName); // now: a disconnect points the floor elsewhere before this runs
      void this.releaseDesk(a, repo)
        .then(() => (a.machine ? this.removeMachine(a.machine, a.name, a.host ?? 'local') : this.backend.removeDesk(repo.fullName, slug, main)))
        .catch(() => undefined)
        .then(() => this.sweepFloor(repo.id));
    }
    this.state.agents = this.state.agents.filter((x) => x.id !== id);
    applyLedger(this.state.progress, { kind: 'let-go', agentId: id });
    this.agentRt.delete(id);
    this.seenActivity.delete(id);
    this.shownActivity.delete(id);
    this.save();
    this.broadcast({ type: 'agentRemoved', agentId: id });
  }

  stopAgent(id: string) {
    const a = this.agent(id);
    if (this.consulting(a)) {
      // a consult leaves their saved status alone: stopping it ends the session, and the CEO hears they couldn't answer
      this.appendLog(a, [{ kind: 'manager', text: '■ Manager stopped this consult.' }]);
      this.agentRt.get(id)?.session?.stop();
      return;
    }
    if (!BUSY.includes(a.status)) return;
    a.status = 'stopped';
    a.lastError = 'Stopped by manager';
    this.appendLog(a, [{ kind: 'manager', text: '■ Manager stopped this session.' }]);
    const sign = this.signIns.get(id);
    if (sign) sign.held = null; // the task waiting for their sign-in stays stopped
    this.agentRt.get(id)?.session?.stop();
    this.emitAgent(a);
    this.save();
  }

  /** An agent whose CLI kept working through the office's restart: the office follows its session again. */
  protected reattachSession(a: PersistedAgent) {
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    if (!repo) return;
    this.appendLog(a, [{ kind: 'system', text: '↻ The office restarted; their CLI kept working and the office is following it again.' }]);
    this.startAgentSession(a, repo, this.deskOf(a, repo), '', '', a.sessionId ?? undefined, undefined, 'reattach');
  }

  /** The manager pressed Esc in the agent's terminal and the CLI stopped its turn: a Stop that leaves the CLI to them. */
  protected interrupted(a: PersistedAgent) {
    if (!BUSY.includes(a.status)) return;
    a.status = 'stopped';
    a.lastError = 'Interrupted in the terminal';
    this.appendLog(a, [{ kind: 'manager', text: '■ Interrupted in the terminal. Type there to carry on.' }]);
  }

  resetAgent(id: string) {
    const a = this.agent(id);
    if (BUSY.includes(a.status)) throw new HttpError(409, `${a.name} is busy; stop them first`);
    for (const q of this.state.qa) {
      if (q.qaAgentId === id && q.status === 'testing') this.setQa(q, { status: 'queued', qaAgentId: null });
      if (q.devAgentId === id && q.status === 'fixing') this.setQa(q, { status: 'failed' });
    }
    this.agentRt.get(id)?.terminal?.releaseIdle?.();
    this.clearTask(a);
    this.appendLog(a, [{ kind: 'system', text: '↺ Cleared desk. Ready for new work.' }]);
    this.save();
  }

  protected issueTaken(repo: PersistedRepo, n: number) {
    return issueTaken(
      n,
      this.state.agents.filter((a) => a.repoId === repo.id),
      this.repoRt.get(repo.id)?.pulls ?? [],
      Date.now(),
    );
  }

  protected ensureSlot(kind: SessionKind = 'build') {
    this.health.ensure(kind);
    if (this.slotsFull()) {
      throw new HttpError(429, `All ${this.state.settings.sessionLimit} session slots are busy. Raise or clear the session limit in the manager's console, or wait.`);
    }
  }

  /** `waitForDeps`: refuse an issue that still waits for open ones (a sticky carried to a desk; the console may override). */
  async assign(agentId: string, issueNumber: number, note?: string, waitForDeps = false) {
    const a = this.agent(agentId);
    const repo = this.repo(a.repoId);
    if (a.role === 'ceo') throw new HttpError(400, `${a.name} runs the company; give issues to the agents on the floors.`);
    if (BUSY.includes(a.status)) throw new HttpError(409, `${a.name} is busy: ${this.agentDoing(a)}`);
    if (this.consulting(a)) throw new HttpError(409, `${a.name} is answering a consult`);
    this.ensureSlot();
    const issues = this.repoRt.get(repo.id)?.issues ?? [];
    const issue = issues.find((i) => i.number === issueNumber);
    if (!issue) throw new HttpError(404, `Issue #${issueNumber} is not open on ${repo.fullName}`);
    const waits = waitForDeps ? blockers(issue.body, new Set(issues.map((i) => i.number))) : [];
    if (waits.length) throw new HttpError(409, waitsMessage(issueNumber, waits));
    const holder = this.state.agents.find((x) => x.id !== a.id && x.repoId === repo.id && x.issueNumber === issueNumber && BUSY.includes(x.status));
    if (holder) throw new HttpError(409, `${holder.name} is already working on #${issueNumber}`);
    if (this.isHeld(repo.id, issueNumber)) {
      // Assigned by hand: its wait after its PR closed is over.
      this.state.held = this.state.held.filter((h) => !(h.repoId === repo.id && h.issue === issueNumber));
      this.emitRepo(repo);
    }
    void this.runTask(a, repo, issue, note);
    return this.agentView(a, false);
  }

  protected port(a: PersistedAgent) {
    return 5200 + (parseInt(a.id.slice(0, 4), 16) % 700);
  }

  protected linkedRepos(repo: PersistedRepo) {
    return repo.links.map((id) => this.state.repos.find((r) => r.id === id)).filter((r): r is PersistedRepo => !!r);
  }

  /**
   * How an agent's next session runs: the CLI in their terminal (the terminal runtime), or Claude Code through the
   * SDK. A session can only be resumed by the CLI that made it, so a follow-up stays with that CLI.
   */
  protected sessionRuntime(a: PersistedAgent, resume?: string): { terminal?: AgentTerminal; cli?: AgentCli; label?: string; resumeSessionId?: string } {
    // A cloud agent's CLI always runs in a terminal: their Box's, which needs nothing from this computer.
    const inTerminal = a.host === 'box' || (this.state.settings.runtime === 'terminal' && this.backend.terminals);
    let cli: AgentCli = a.role === 'ceo' ? 'claude' : a.cli || this.state.settings.defaultCli;
    if (resume && a.sessionCli && a.sessionCli !== cli) {
      if (inTerminal) cli = a.sessionCli;
      else if (a.sessionCli !== 'claude') resume = undefined;
    }
    if (!inTerminal) return { resumeSessionId: resume };
    const what = a.role === 'ceo' ? a.issueTitle : a.task === 'qa' ? `QA · PR #${a.prNumber}` : a.task === 'fix' ? `fixing PR #${a.prNumber}` : a.issueNumber ? `#${a.issueNumber} ${a.issueTitle ?? ''}` : null;
    return { terminal: this.terminalFor(a), cli, label: `${a.name}${what ? ` · ${what}` : ''}`.slice(0, 80).trim(), resumeSessionId: resume };
  }

  /**
   * What the manager's Tools & skills switches take away from a Claude Code session (the Agent SDK runs Claude Code
   * too), logged so it shows in the agent's terminal. Codex and OpenCode load their own setup: nothing.
   */
  protected sessionToolsFor(a: PersistedAgent, cli: AgentCli | undefined, off: string[] = []): SessionTools | undefined {
    if ((cli ?? 'claude') !== 'claude') return undefined;
    const t = this.state.settings.tools;
    // Each kind of session follows its role's profile (#50): QA's, the builders' and fixers', or the CEO's.
    const profile = a.role === 'ceo' ? 'ceo' : a.task === 'qa' ? 'qa' : 'build';
    const lean = t.lean ? profile : null;
    const tools =
      profile === 'ceo'
        ? sessionTools(this.tooling.items, 'ceo', mergeSwitches(t.everyone, t.ceo), lean)
        : sessionTools(this.tooling.items, 'agent', { ...mergeSwitches(t.everyone, t[profile], a.tools), ...Object.fromEntries(off.map((id) => [id, false])) }, lean);
    if (tools.disallowed.length || tools.disabledPlugins.length || tools.noConnectors) this.appendLog(a, [{ kind: 'system', text: `🧰 Tools & skills off this session: claude … ${toolArgsLine(tools)}` }]);
    return tools;
  }

  // ---------- tools & skills ----------

  /** Scan what a Claude Code session here loads (server/tooling.ts); the floors' checkouts are its projects. */
  async refreshTooling() {
    if (this.tooling.scanning) return this.tooling;
    this.tooling = { ...this.tooling, scanning: true };
    this.broadcast({ type: 'tooling', tooling: this.tooling });
    const dirs = this.state.repos.map((r) => this.backend.mainDir(r.fullName));
    try {
      this.tooling = await this.backend.toolInventory(dirs);
    } catch (err) {
      this.tooling = { ...this.tooling, scanning: false, scannedAt: Date.now(), error: `Could not read your Claude Code setup: ${oneLine(err)}` };
    }
    this.broadcast({ type: 'tooling', tooling: this.tooling });
    return this.tooling;
  }

  /** One Tools & skills switch: scope 'everyone', 'ceo', a role profile ('build', 'qa') or an agent's id; on null follows the scope above. */
  setToolSwitch(scope: string, id: unknown, on: unknown) {
    if (!isToolId(id)) throw new HttpError(400, 'Pick a tool, plugin, skill or MCP server from the list.');
    if (on !== true && on !== false && on !== null) throw new HttpError(400, 'on must be true, false or null.');
    const t = this.state.settings.tools;
    if (scope === 'everyone' || scope === 'ceo' || scope === 'build' || scope === 'qa') {
      this.state.settings.tools = { ...t, [scope]: setSwitch(t[scope], id, on) };
      this.save();
      this.broadcast({ type: 'settings', settings: this.state.settings });
      return this.state.settings.tools;
    }
    const a = this.agent(scope);
    if (a.role === 'ceo') throw new HttpError(400, "The CEO's switches are the 'ceo' scope.");
    a.tools = setSwitch(a.tools ?? {}, id, on);
    this.save();
    this.emitAgent(a);
    return a.tools;
  }

  /** The model to ask for (the Agent SDK runs Claude Code). '' lets another coding agent use its own default. */
  protected modelFor(a: PersistedAgent, cli: AgentCli | undefined) {
    return effectiveModel(a.model, cli ?? 'claude', this.state.settings, DEFAULT_MODEL);
  }

  // ---------- their chat (#120) ----------

  protected chatOf(a: PersistedAgent): ChatLog | null {
    const rt = this.agentRt.get(a.id);
    return rt ? (rt.chat ??= new ChatLog()) : null;
  }

  /** Their session's transcript, into their chat, secrets masked as for agent_log. */
  protected chatEvents(a: PersistedAgent, events: TranscriptEvent[], cwd: string) {
    const secrets = this.secrets();
    this.outbox.chat(a.id, this.chatOf(a)?.apply(events, cwd, (t) => scrub(t, secrets)) ?? []);
  }

  /** A message to them, as a bubble in their chat. */
  protected chatSay(a: PersistedAgent, text: string, who: string) {
    const item = this.chatOf(a)?.add({ t: Date.now(), kind: 'manager', text: scrub(text, this.secrets()), who });
    if (item) this.outbox.chat(a.id, [item]);
  }

  /** POST /api/agents/:id/react: the manager's reaction on an item of their chat; one that asks for something is typed into their running session as a short note. */
  react(id: string, itemId: unknown, reaction: unknown) {
    const a = this.agent(id);
    if (!isAgentReaction(reaction)) throw new HttpError(400, 'Pick a reaction from the bar.');
    const hit = typeof itemId === 'number' ? this.chatOf(a)?.react(itemId, reaction) : null;
    if (!hit) throw new HttpError(404, 'That message is no longer in their chat.');
    this.outbox.chat(a.id, [hit.item]);
    const note = hit.added ? reactionNote(reaction, quoteOf(hit.item)) : null;
    // Only into a running session, read after its current step (shown in their terminal too): a reaction never starts one.
    const session = note ? this.agentRt.get(a.id)?.session : null;
    if (session) {
      this.appendLog(a, [{ kind: 'manager', text: `▶ ${note}` }]);
      session.send(note!);
    }
    return { sent: !!session, note: !!note };
  }
}
