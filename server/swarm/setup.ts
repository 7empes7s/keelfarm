// The setup advisor (#366): each floor's use case (guessed from its repo's top files once it's cloned, or the manager's
// pick), its gaps against the recommendation (shared/setup.ts), one notification per gap, Not now, the one-tap fixes,
// the new floor's checklist, and the agents a gap keeps from work. Rules and the table are pure, in shared/.
import { HttpError } from '../httpError.ts';
import { resolveAccount } from '../../shared/accounts.ts';
import { rotationSettings } from '../../shared/accountRotation.ts';
import { modelProvider, providerDef } from '../../shared/providers.ts';
import { blockedAgents, openGaps, setupGaps, setupLine, snooze, toTell, type SetupAgent, type SetupInput } from '../../shared/setup.ts';
import { itemState } from '../../shared/tooling.ts';
import { detectUseCase, isUseCase, missingChecks, qaBriefChecks, SIGNAL_FILES, caseDef } from '../../shared/useCases.ts';
import type { AccountView, FloorSetupView, ProviderCategory, RepoView, SetupFix, SetupGap, UseCase } from '../../shared/types.ts';
import type { FloorSetupRecord, PersistedAgent, PersistedRepo } from './model.ts';
import { SwarmDisk } from './disk.ts';

const REFRESH_MS = 30_000;
const CLI_NAME = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' } as const;
/** An opencode model's provider, by its prefix, for the key it needs. */

const emptyRecord = (): FloorSetupRecord => ({ useCase: null, guessed: true, why: '', snoozed: {}, told: [], review: false });

export abstract class SwarmSetup extends SwarmDisk {
  private floorGaps = new Map<string, SetupGap[]>(); // every gap per floor, snoozed or not
  private gapsSeen = new Map<string, Set<string>>(); // shown at the last refresh: a gap is told once it lasts a refresh
  private setupBlocked = new Set<string>();
  protected reviewNew = false; // set once init starts: floors moved in from then on get the checklist

  protected override repoView(r: PersistedRepo): RepoView {
    const setup = this.floorSetupView(r);
    // a floor not guessed yet with nothing to fix: left out, the client draws it empty (the snapshot's budget, #228)
    return setup.useCase || setup.gaps.length || setup.snoozed ? { ...super.repoView(r), setup } : super.repoView(r);
  }

  private floorSetupView(r: PersistedRepo): FloorSetupView {
    const s = r.setup ?? emptyRecord();
    const all = this.floorGaps.get(r.id) ?? [];
    const gaps = openGaps(all, s.snoozed, Date.now());
    return { useCase: s.useCase, guessed: s.guessed, guessWhy: s.why, gaps, snoozed: all.length - gaps.length, review: s.review };
  }

  /** Started with the usage readings, once from init: a refresh every 30 s (logins and keys change outside the floors). */
  protected override async startUsage() {
    this.reviewNew = true;
    setInterval(() => this.refreshFloorSetup(), REFRESH_MS).unref();
    await super.startUsage();
  }

  /** A fresh demo office: its floors opened without the checklist, the company's use cases, floor 2's signed-out agent. */
  protected override seedDemoDecisions(): undefined {
    super.seedDemoDecisions();
    const demo = this.backend.demoSetup?.();
    if (!demo) return;
    for (const r of this.state.repos) if (r.setup) r.setup.review = false;
    this.state.settings.companyUseCases = demo.company;
    const r = this.state.repos.find((x) => x.floor === demo.signedOut.floor);
    const a = r && this.state.agents.filter((x) => x.repoId === r.id && x.role !== 'ceo').at(-1);
    if (a) Object.assign(a, { cli: 'opencode', model: demo.signedOut.model });
    this.refreshFloorSetup();
  }

  protected override async cloneRepo(id: string) {
    await super.cloneRepo(id);
    const r = this.state.repos.find((x) => x.id === id);
    if (r && this.repoRt.get(id)?.cloneStatus === 'ready' && (r.setup?.guessed ?? true)) await this.guessUseCase(r);
  }

  /** Read the repo's top files and guess; a pick of the manager's is never overwritten. */
  private async guessUseCase(r: PersistedRepo) {
    const files: Record<string, string> = {};
    await Promise.all(SIGNAL_FILES.map(async (f) => {
      const text = await this.backend.readRepoFile(r.fullName, r.defaultBranch, f).catch(() => null);
      if (text !== null) files[f] = text.slice(0, 50_000);
    }));
    const guess = detectUseCase(files);
    const s = r.setup ?? emptyRecord();
    if (!guess || !s.guessed || (s.useCase === guess.useCase && s.why === guess.why)) return;
    r.setup = { ...s, useCase: guess.useCase, why: guess.why };
    this.save();
    this.refreshFloorSetup();
  }

  override connectRepo(...a: Parameters<SwarmDisk['connectRepo']>) {
    return super.connectRepo(...a).then((v) => {
      const r = this.repo(v.id);
      r.setup = { ...(r.setup ?? emptyRecord()), review: this.reviewNew }; // the checklist shows once its use case is known
      return this.repoView(r);
    });
  }

  /** A brief, preview or switch changed: the floor's gaps follow at once, not at the next refresh. */
  override updateRepo(...a: Parameters<SwarmDisk['updateRepo']>) {
    super.updateRepo(...a);
    this.refreshFloorSetup();
    return this.repoView(this.repo(a[0]));
  }

  // ---------- the check ----------

  private signedOut(a: PersistedAgent, accounts: AccountView[]): SetupAgent['signedOut'] {
    if (a.host === 'box' && a.needsSignIn) return { why: 'Their cloud machine waits for a sign-in.', fix: 'terminal' };
    const cli = a.cli || this.state.settings.defaultCli;
    if (cli === 'claude' || cli === 'codex' || cli === 'gemini') {
      // With the rotation on, only when every enabled login of theirs is out (another one runs it, pinned or not, #360).
      const acc = resolveAccount(accounts, a.account, cli);
      const runsOn = rotationSettings(this.state.settings.rotation, undefined).on ? accounts.filter((x) => x.cli === cli && x.enabled && !x.removing) : accounts.filter((x) => x.id === acc?.id);
      const out = runsOn.length > 0 && runsOn.every((x) => x.status === 'signed-out');
      return out ? { why: `Their ${CLI_NAME[cli]} login${runsOn.length > 1 ? 's are' : ` "${runsOn[0].label}" is`} signed out.`, fix: 'accounts' } : null;
    }
    if (cli !== 'opencode') return null;
    const provider = modelProvider(a.model);
    if (!provider) return null;
    const name = providerDef(provider)?.name ?? provider;
    const keys = this.providers.view().connections.filter((c) => c.provider === provider);
    if (!keys.length) return { why: `${a.model} needs a ${name} key, and there is none.`, fix: 'providers' };
    const turned = keys.every((c) => c.test && !c.test.ok);
    return turned ? { why: `Their ${name} key failed its test: ${keys[0].test!.note.replace(/\.$/, '')}.`, fix: 'providers' } : null;
  }

  private floorInput(r: PersistedRepo, accounts: AccountView[], providers: ProviderCategory[]): SetupInput | null {
    const useCase = r.setup?.useCase;
    if (!useCase) return null;
    const t = this.state.settings.tools;
    return {
      useCase,
      qaBrief: r.qaBrief,
      previewCommand: r.preview.command,
      previewAuto: this.previews.view(r).status !== 'unconfigured',
      browserTesting: r.browserTesting,
      testLab: this.state.settings.testLab.enabled,
      agents: this.state.agents
        .filter((a) => a.repoId === r.id && a.role !== 'ceo')
        .map((a) => ({ id: a.id, name: a.name, cli: a.cli || this.state.settings.defaultCli, model: a.model, signedOut: this.signedOut(a, accounts) })),
      providers,
      tools: this.tooling.items.filter((i) => i.kind === 'plugin' || i.kind === 'skill').map((i) => ({ id: i.id, name: i.name, on: itemState(i, 'agent', t.everyone, undefined, t.build, t.lean ? 'build' : null).on })),
      company: this.state.settings.companyUseCases ?? [],
    };
  }

  /** Every floor's gaps again: changed floors go out, new gaps are told once, blocked agents are known. */
  protected refreshFloorSetup() {
    const accounts = this.accounts.view().accounts;
    const providers = new Set<ProviderCategory>(this.providers.view().connections.filter((c) => c.test?.ok !== false).flatMap((c) => providerDef(c.provider)?.category ?? []));
    if (this.voice.keyView().voiceKeySet) providers.add('audio');
    if (this.cloud.view().keySet) providers.add('cloud');
    const now = Date.now();
    let save = false;
    this.setupBlocked = new Set();
    for (const r of this.state.repos) {
      if (!this.repoRt.has(r.id)) continue;
      const input = this.floorInput(r, accounts, [...providers]);
      const all = input ? setupGaps(input) : [];
      for (const id of blockedAgents(all)) this.setupBlocked.add(id);
      const s = r.setup ?? (r.setup = emptyRecord());
      const shown = openGaps(all, s.snoozed, now);
      const before = this.floorGaps.get(r.id) ?? [];
      this.floorGaps.set(r.id, all);
      const seen = this.gapsSeen.get(r.id) ?? new Set();
      this.gapsSeen.set(r.id, new Set(shown.map((g) => g.id)));
      // Told only once a gap outlasts a refresh: a preview still being detected after a restart isn't news.
      const { tell, told } = toTell(shown.filter((g) => seen.has(g.id)), all, s.told);
      if (told.join() !== s.told.join()) {
        s.told = told;
        save = true;
      }
      for (const g of tell) this.notice({ kind: 'setup', title: `Floor ${r.floor}: ${g.title}`, text: g.why, target: { kind: 'floor', repoId: r.id }, actions: ['setup'] }, { event: 'setup', line: `floor ${r.floor} ${g.title}` });
      if (JSON.stringify(before) !== JSON.stringify(all)) this.emitRepo(r);
    }
    if (save) this.save();
  }

  /** Agents a known gap keeps from work (signed out): they take nothing until it's fixed. */
  protected setupBlocks(agentId: string) {
    return this.setupBlocked.has(agentId);
  }

  /** company_status's line for a floor. */
  protected floorSetupLine(r: PersistedRepo) {
    const v = this.floorSetupView(r);
    return setupLine(v.useCase, v.guessed, v.gaps);
  }

  /** Settings → Guides: what the company mainly makes. */
  setCompanyUseCases(list: unknown) {
    if (!Array.isArray(list) || !list.every(isUseCase)) throw new HttpError(400, 'Send a list of use cases, e.g. ["web-app", "api"].');
    this.state.settings.companyUseCases = [...new Set(list)];
    this.save();
    this.broadcast({ type: 'settings', settings: this.state.settings });
    this.refreshFloorSetup();
    return this.state.settings.companyUseCases;
  }

  // ---------- the manager's taps ----------

  /** The manager's pick of a floor's use case: no longer a guess, and the checklist shows for it. */
  setFloorUseCase(id: string, useCase: unknown): RepoView {
    if (!isUseCase(useCase)) throw new HttpError(400, 'Pick a use case from the list.');
    const r = this.repo(id);
    r.setup = { ...(r.setup ?? emptyRecord()), useCase, guessed: false, why: '', review: true };
    this.save();
    this.refreshFloorSetup();
    this.emitRepo(r);
    return this.repoView(r);
  }

  /** One of a gap's fixes, by its action's index (the recommended one is 0). Opening a sheet is the client's. */
  applyFloorSetup(id: string, gapId: unknown, index: unknown = 0): RepoView {
    const r = this.repo(id);
    const gap = (this.floorGaps.get(r.id) ?? []).find((g) => g.id === gapId);
    if (!gap) throw new HttpError(404, 'That setup gap is closed already.');
    const action = gap.actions[Number(index)];
    if (!action || !('fix' in action)) throw new HttpError(400, `"${gap.title}" has no fix the office can apply at ${String(index)}: open its sheet instead.`);
    this.applyFix(r, action.fix);
    this.refreshFloorSetup();
    return this.repoView(r);
  }

  private applyFix(r: PersistedRepo, fix: SetupFix) {
    const def = caseDef(r.setup!.useCase!);
    switch (fix.kind) {
      case 'qaBrief':
        this.updateRepo(r.id, { qaBrief: [r.qaBrief.trim(), qaBriefChecks(def, missingChecks(def, r.qaBrief))].filter(Boolean).join('\n\n') });
        return;
      case 'preview':
        this.updateRepo(r.id, { previewCommand: def.preview ?? '' });
        return;
      case 'browserTesting':
        this.updateRepo(r.id, { browserTesting: true });
        return;
      case 'testLab':
        this.updateSettings({ testLab: { ...this.state.settings.testLab, enabled: true } });
        return;
      case 'skill':
        this.setToolSwitch('build', fix.id, true);
        return;
      case 'cli':
        this.updateAgent(fix.agentId, { cli: fix.cli, model: fix.model });
        return;
      case 'companyUseCase':
        this.setCompanyUseCases([...(this.state.settings.companyUseCases ?? []), def.id]);
    }
  }

  /** Not now: the gap hides for a week, and isn't told again meanwhile. */
  snoozeFloorSetup(id: string, gapId: unknown): RepoView {
    const r = this.repo(id);
    const all = this.floorGaps.get(r.id) ?? [];
    if (typeof gapId !== 'string' || !all.some((g) => g.id === gapId)) throw new HttpError(404, 'That setup gap is closed already.');
    const s = r.setup ?? (r.setup = emptyRecord());
    s.snoozed = snooze(s.snoozed, gapId, all, Date.now());
    this.save();
    this.emitRepo(r);
    return this.repoView(r);
  }

  /** The new floor's checklist closed. */
  closeFloorReview(id: string): RepoView {
    const r = this.repo(id);
    if (r.setup?.review) {
      r.setup.review = false;
      this.save();
      this.emitRepo(r);
    }
    return this.repoView(r);
  }

  /** The CEO's apply_setup: a floor's use case, and/or a gap's recommended fix. */
  protected ceoApplySetup(x: { floor: number; use_case?: UseCase; gap?: string }): string {
    const r = this.state.repos.find((f) => f.floor === x.floor);
    if (!r) throw new Error(`No floor ${x.floor}: check the floors in company_status.`);
    if (x.use_case) this.setFloorUseCase(r.id, x.use_case);
    if (x.gap) {
      const gap = (this.floorGaps.get(r.id) ?? []).find((g) => g.id === x.gap);
      if (!gap) throw new Error(`Floor ${x.floor} has no gap "${x.gap}"; its gaps: ${this.floorSetupLine(r)}.`);
      const i = gap.actions.findIndex((a) => 'fix' in a);
      if (i < 0) throw new Error(`"${gap.title}" needs the manager: ${gap.actions.map((a) => a.label).join(' or ')} in the floor's setup card.`);
      this.applyFloorSetup(r.id, gap.id, i);
    }
    return `Floor ${x.floor}: ${this.floorSetupLine(r)}`;
  }
}
