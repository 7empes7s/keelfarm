// Keeping the agents' built-in Claude current (#569): the npm registry checked daily (and by Check now) against the
// Agent SDK installed with the office, one bump issue on the office's own floor when it's behind, the alarm card after
// a week behind with nothing in flight, and the bump at once when a session fails, or a picked model can't run, for
// want of a newer Claude Code. The office never installs it: the bump lands as a PR and goes live by self-update.
// State in <SWARM_HOME>/agent-sdk.json; rules pure in shared/agentSdk.ts, reads in server/agentSdk.ts.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR } from '../config.ts';
import { bumpIssue, CHECK_EVERY_MS, isBehind, isBumpTitle, loadSdkState, modelLine, needsNewerClaude, sdkAlarm, sdkStep, type SdkUpdateState, type SdkUpdateView } from '../../shared/agentSdk.ts';
import { modelNeedsNewerClaude } from '../../shared/claudeCode.ts';
import { isClaudeModel, modelLabel } from '../../shared/models.ts';
import type { WorldSnapshot } from '../../shared/types.ts';
import type { SessionResult } from '../agentRunner.ts';
import type { PersistedAgent, PersistedRepo } from './model.ts';
import { SwarmLiveLeases } from './liveLeases.ts';

/** Picked models are looked at this often (no network unless one can't run). */
const PICKED_EVERY_MS = 60_000;
/** A model that needs a newer Claude Code asks the registry at most this often (the latest may not run it either). */
const URGENT_EVERY_MS = 3600_000;

export abstract class SwarmAgentSdk extends SwarmLiveLeases {
  private sdk: SdkUpdateState | null = null;
  private sdkChecking = false;
  private sdkRun: Promise<unknown> = Promise.resolve();
  private sdkUrgentAt = new Map<string, number>(); // model -> when it last started a check

  private get sdkFile() {
    return path.join(HOME_DIR, 'agent-sdk.json');
  }

  protected get sdkState(): SdkUpdateState {
    if (!this.sdk) {
      let raw: unknown = null;
      try {
        raw = JSON.parse(fs.readFileSync(this.sdkFile, 'utf8'));
      } catch {
        // first run, or unreadable: start empty
      }
      this.sdk = loadSdkState(raw);
    }
    return this.sdk;
  }

  private saveSdk() {
    try {
      fs.mkdirSync(HOME_DIR, { recursive: true });
      const tmp = `${this.sdkFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.sdkState));
      fs.renameSync(tmp, this.sdkFile);
    } catch (err) {
      console.warn('agent SDK check: could not save its state:', err);
    }
  }

  /** The office's own floor: the one whose checkout the office runs from, where the bump is filed. */
  private ownFloor(): PersistedRepo | undefined {
    return this.state.repos.find((r) => this.backend.office.isOwnFolder(this.backend.mainDir(r.fullName)));
  }

  /** The open bump issue on the office's own floor (the last filed, or any titled like one). */
  private openBump(own: PersistedRepo | undefined) {
    const rt = own && this.repoRt.get(own.id);
    const last = this.sdkState.bump;
    return rt?.issues.find((i) => i.number === last?.issue || isBumpTitle(i.title)) ?? null;
  }

  /** A bump issue or PR is open, or the last bump merged and the office's self-update hasn't installed it yet. */
  private bumpInFlight(own: PersistedRepo | undefined) {
    const rt = own && this.repoRt.get(own.id);
    const prOpen = !!rt?.pulls.some((p) => p.state === 'OPEN' && (isBumpTitle(p.title) || (this.sdkState.bump && p.closesIssues.includes(this.sdkState.bump.issue))));
    return !!this.openBump(own) || prOpen || (!!this.sdkState.bump && this.officeUpdate.behind > 0);
  }

  private sdkInput(own: PersistedRepo | undefined) {
    const stale = this.backend.demo ? this.backend.agentSdk.demoStale : undefined;
    const s = this.sdkState;
    return { installed: this.backend.agentSdk.installed(), latest: s.latest, inFlight: this.bumpInFlight(own), canBump: !!own && stale === undefined, behindSince: s.behindSince ?? stale ?? null, now: Date.now() };
  }

  sdkUpdateView(): SdkUpdateView {
    const own = this.ownFloor();
    const input = this.sdkInput(own);
    const s = this.sdkState;
    const open = this.openBump(own);
    return {
      installed: input.installed,
      latest: s.latest,
      checkedAt: s.checkedAt,
      error: s.error,
      checking: this.sdkChecking,
      behind: isBehind(input.installed, s.latest),
      bump: !own ? null : open ? { issue: open.number, floor: own.floor, merged: false } : s.bump && input.inFlight ? { issue: s.bump.issue, floor: own.floor, merged: true } : null,
      alarm: sdkAlarm(input),
    };
  }

  override snapshot(): WorldSnapshot {
    return { ...super.snapshot(), sdkUpdate: this.sdkUpdateView() };
  }

  private sdkChanged() {
    this.broadcast({ type: 'sdkUpdate', sdkUpdate: this.sdkUpdateView() });
  }

  /** Check now (and the daily check): one at a time; `model`: a model that needs a newer Claude Code started it. */
  checkAgentSdk(model?: string): Promise<SdkUpdateView> {
    const next = this.sdkRun.then(() => this.sdkCheck(model));
    this.sdkRun = next.catch(() => undefined);
    return next;
  }

  private async sdkCheck(model?: string): Promise<SdkUpdateView> {
    this.sdkChecking = true;
    this.sdkChanged();
    try {
      await this.sdkCheckStep(model);
    } finally {
      this.sdkChecking = false;
      this.saveSdk();
      this.sdkChanged();
    }
    return this.sdkUpdateView();
  }

  private async sdkCheckStep(model?: string) {
    const s = this.sdkState;
    let ok = true;
    try {
      s.latest = await this.backend.agentSdk.latest();
      s.error = null;
    } catch (err) {
      ok = false;
      s.error = (err as Error).message?.slice(0, 160) || 'unknown error';
      console.warn(`agent SDK check: ${s.error}; no bump filed`);
    }
    s.checkedAt = Date.now();
    const own = this.ownFloor();
    const input = this.sdkInput(own);
    const step = sdkStep(input);
    if (ok) s.behindSince = step.behindSince;
    if (ok && step.bump && own && s.latest) {
      const why = model ? `${modelLabel(model)} needs a newer one.` : null;
      const { title, body } = bumpIssue(input.installed, s.latest, why);
      try {
        const issue = await this.backend.createIssue(own.fullName, title, body);
        s.bump = { issue, version: s.latest.version, at: Date.now() };
        console.log(`agent SDK check: filed #${issue} on ${own.fullName} (${title})`);
        await this.syncRepo(own.id);
        setTimeout(() => this.schedule(), 200);
      } catch (err) {
        console.warn(`agent SDK check: couldn't file the bump on ${own.fullName}: ${(err as Error).message}`);
      }
    }
    const after = this.sdkInput(own);
    if (model && !s.told.includes(model) && isBehind(after.installed, s.latest) && after.inFlight) {
      s.told = [...s.told, model].slice(-20);
      this.postMessage('office', modelLine(modelLabel(model)));
    }
    // The alarm's chat line, once per stretch behind.
    const alarm = sdkAlarm(after);
    const key = `alarm:${after.behindSince}`;
    if (alarm && !s.told.includes(key)) {
      s.told = [...s.told, key].slice(-20);
      this.postMessage('office', `⚠️ ${alarm}`);
    }
  }

  /** A model the bundled Claude Code can't run: the bump starts now, once per model (told). */
  protected sdkUrgent(model: string) {
    const at = this.sdkUrgentAt.get(model) ?? 0;
    if (!model || this.sdkState.told.includes(model) || Date.now() - at < URGENT_EVERY_MS) return;
    this.sdkUrgentAt.set(model, Date.now());
    void this.checkAgentSdk(model);
  }

  /** The models picked now (the office default, each agent's and the CEO's) on Claude Code. */
  private pickedClaudeModels(): string[] {
    const out = new Set<string>();
    for (const a of this.state.agents) {
      const s = this.agentSetup(a);
      if (s.codingAgent === 'claude' && isClaudeModel(s.model)) out.add(s.model);
    }
    return [...out];
  }

  private sdkTick() {
    const claude = this.backend.agentSdk.installed()?.claudeCode;
    const stuck = this.pickedClaudeModels().find((m) => !this.sdkState.told.includes(m) && modelNeedsNewerClaude(m, claude));
    if (stuck) return this.sdkUrgent(stuck);
    const at = this.sdkState.checkedAt;
    if (!at || Date.now() - at >= CHECK_EVERY_MS) void this.checkAgentSdk();
  }

  protected override async startUsage() {
    await super.startUsage();
    setTimeout(() => this.sdkTick(), this.backend.demo ? 5_000 : 30_000).unref();
    setInterval(() => this.sdkTick(), PICKED_EVERY_MS).unref();
  }

  /** A session that failed for want of a newer Claude Code starts the bump. */
  private sdkAfter(a: PersistedAgent, ran: SessionResult) {
    if (ran.ok || !needsNewerClaude(ran.errors)) return;
    const s = this.agentSetup(a);
    if (s.codingAgent === 'claude') this.sdkUrgent(isClaudeModel(s.model) ? s.model : 'Their model');
  }

  protected override async onFinished(a: PersistedAgent, repo: PersistedRepo, ran: SessionResult) {
    this.sdkAfter(a, ran);
    await super.onFinished(a, repo, ran);
  }

  protected override onCeoFinished(a: PersistedAgent, result: SessionResult) {
    this.sdkAfter(a, result);
    return super.onCeoFinished(a, result);
  }
}
