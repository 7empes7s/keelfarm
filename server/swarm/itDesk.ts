// The IT desk (#506): the IT department's commands on this machine (#524: the IT lead's, no longer the CEO's). it_run
// runs a read-only command at once; it_propose puts a change on a card in the chats, Mission control and Telegram, run
// only on the manager's Run (several at once with Run all) and checked against the never-list again then; IT then checks
// the result (itRan). With auto-approve on (#585, server/itAuto.ts), a routine change runs at once instead, logged in
// IT's chat as done automatically with an Undo where there is one. Every command is logged here and in the daily log.
// Rules in server/itDesk.ts.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { argvLine, IT_LOG_KEPT, IT_LOG_SHOWN, type ItDeskView, type ItLogEntry, type ItProposal, type ItRisk } from '../../shared/itDesk.ts';
import type { WorldSnapshot } from '../../shared/types.ts';
import { HOME_DIR } from '../config.ts';
import { HttpError } from '../httpError.ts';
import { CHANGE_TIMEOUT_MS, itRedact, LOG_OUT_MAX, neverRefusal, parseCommand, readOnlyPlan, secretPaths, secretValues, shapeOutput } from '../itDesk.ts';
import { AUTO_STEPS_MAX, autoVerdict, type AutoPlan } from '../itAuto.ts';
import type { ItJob } from '../../shared/itDept.ts';
import { OFFICE_DIR } from '../officeUpdate.ts';
import { CfError } from '../cloudflare.ts';
import { envPathRefusal, envSecretFile } from '../cfSecretFile.ts';
import type { CloudflareArgs, InstallKeyArgs, ProviderActionArgs, SaveKeyArgs } from '../ceoItTools.ts';
import { INSTALL_TARGETS, installLine, installRefusal, keyPart, maskPasted, renewDue, savedMark, type KeyInstall } from '../../shared/keyInstall.ts';
import { keyHint } from '../../shared/providers.ts';
import { installKeyFile, restoreKeyFile } from '../keyInstall.ts';
import { renewMinted } from '../keyRenew.ts';
import { CF_OPS } from '../../shared/cloudflare.ts';
import { ActionError, applyAction, MODULES, runAction, type ActionCtx } from '../providerActions/index.ts';
import { renewEntraSecret } from '../providerActions/entra.ts';
import { actionOp, autoApplies, type ActionRisk, type ProviderChange } from '../../shared/providerActions.ts';
import type { CfChange } from '../../shared/cloudflare.ts';
import { SwarmManagerAsks } from './managerAsks.ts';
import { parseRunbook, projectForeign, projectProblem, runbookSummary, runbookVerdict, runRunbook, stepLabel, stepNever, undoRunbook, type RunbookHost } from '../itRunbook.ts';
import { RUNBOOKS_KEPT, runbookView, type ItRunbookJob } from '../../shared/itRunbook.ts';
import { accessToken, appCallRefusal, appCallReply, tokenFilesFor } from '../appCall.ts';

/** it_run's and it_propose's arguments (server/ceoItTools.ts). */
export interface ItRunArgs {
  command: string;
  sort?: 'size';
  lines?: number;
}
/** it_runbook's arguments: the floor whose repo has it, its path there, and the project it installs (its scope). */
export interface ItRunbookArgs {
  floor: number;
  path: string;
  project: string;
}
/** app_call's arguments (#625). */
export interface AppCallArgs {
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH';
  url: string;
  env_file?: string;
  body?: unknown;
  why?: string;
}
export interface ItProposeArgs {
  argv: string[];
  why: string;
  affects: string;
  undo: string;
  risk: ItRisk;
}

const OFF = 'The IT desk is off (Settings → CEO settings → IT desk): tell the manager what you would run instead.';
const DEPT_OFF = 'The IT department is off (Settings → The IT department).';
const WAITING_MAX = 12;
/** The live office's own systemd units: auto-approve never touches them. */
const OFFICE_UNITS = ['cubefarm.service'];
/** A provider write's card risk, and why auto-approve left it on a card (#602). */
const ACTION_RISK: Record<Exclude<ActionRisk, 'read'>, ItRisk> = { routine: 'low', change: 'medium', destructive: 'high' };
const ACTION_HELD: Record<Exclude<ActionRisk, 'read'>, string> = {
  routine: '',
  change: 'a change waits for "everything except dangerous"',
  destructive: 'destructive changes are never automatic',
};

export abstract class SwarmItDesk extends SwarmManagerAsks {
  private itSeq = 0;
  private itRunning = new Set<string>();
  /** Auto steps in the IT job that's running (a change is one job): AUTO_STEPS_MAX at most. */
  private itAuto: { job: ItJob | null; steps: number } = { job: null, steps: 0 };

  protected get itOn() {
    return this.state.settings.itDesk !== false;
  }

  /** The IT lead's name (Settings → The IT department). */
  protected get itName() {
    return this.state.settings.itDept.name;
  }

  /** The live office's own folders and state, which no proposal may touch. */
  protected get itProtected() {
    return [...new Set([OFFICE_DIR, '/root/Projects/keelfarm', '/root/keelfarm', HOME_DIR, path.join(os.homedir(), '.cubefarm')].map((d) => path.posix.normalize(d.replace(/\\/g, '/'))))];
  }

  itDeskView(): ItDeskView {
    const { runbooks, ...d } = this.state.itDesk;
    return { on: this.itOn, waiting: d.waiting, log: d.log.slice(0, IT_LOG_SHOWN), ...(runbooks?.length && { runbooks: runbooks.map(runbookView) }) };
  }

  /** Left out while empty: every tab's snapshot pays for it (scale.test.ts), and the switch is in the settings. */
  override snapshot(): WorldSnapshot {
    const d = this.state.itDesk;
    return d.waiting.length || d.log.length || d.runbooks?.length ? { ...super.snapshot(), itDesk: this.itDeskView() } : super.snapshot();
  }

  private itDeskChanged() {
    this.save();
    this.broadcast({ type: 'itDesk', itDesk: this.itDeskView() });
  }

  private itLog(e: Omit<ItLogEntry, 'id' | 'at'>) {
    const at = Date.now();
    const entry: ItLogEntry = { ...e, id: `${at.toString(36)}-${++this.itSeq}`, at, out: e.out.slice(0, LOG_OUT_MAX) };
    this.state.itDesk.log = [entry, ...this.state.itDesk.log].slice(0, IT_LOG_KEPT);
    const head = `IT desk (${e.auto ? 'done automatically' : e.kind}, by ${e.by}): \`${argvLine(e.argv)}\` → ${e.code === null ? 'did not run' : `exit ${e.code}`}`;
    void this.history.note(`${head}${e.why ? ` · ${e.why}` : ''}${e.out.trim() ? `\n  ${e.out.trim().split('\n').slice(0, 5).join('\n  ')}` : ''}`);
    return entry;
  }

  /** Every IT output's redactor (#625): the stored keys, `extra` (what a command's secret files hold), and key shapes. */
  private itMask = (s: string, extra: readonly string[] = []) => itRedact(s, [...this.secrets(), ...extra]);

  /** The values in the secret files a command names, so its output can't show them (unreadable or huge ones add none). */
  private async fileSecrets(argv: readonly string[]): Promise<string[]> {
    const out: string[] = [];
    for (const p of secretPaths(argv)) {
      const text = await this.backend.itFiles.read(p.replace(/^~(?=\/|$)/, os.homedir())).catch(() => null);
      if (text && text.length <= 256_000) out.push(...secretValues(text));
    }
    return out;
  }

  /** it_run: one read-only command now, its output sorted, limited, masked and capped. */
  protected async itRun(a: ItRunArgs): Promise<string> {
    if (!this.itOn) throw new HttpError(403, OFF);
    if (!this.state.settings.itDept.on) throw new HttpError(403, DEPT_OFF);
    const parsed = parseCommand(String(a.command ?? ''));
    if ('refused' in parsed) throw new HttpError(400, parsed.refused);
    const plan = readOnlyPlan(parsed.argv, { linux: process.platform === 'linux' });
    if ('refused' in plan) throw new HttpError(400, plan.refused);
    const ran = await this.backend.itExec(plan.argv, plan.timeoutMs);
    const extra = await this.fileSecrets(plan.argv);
    const out = shapeOutput({ ...ran, sort: a.sort, lines: a.lines, mask: (t) => this.itMask(t, extra) });
    this.itLog({ kind: 'read', by: this.itName, argv: parsed.argv, code: ran.code, out });
    this.itDeskChanged();
    return `$ ${argvLine(parsed.argv)}\n${ran.code === null ? 'did not finish' : `exit ${ran.code}`}\n${out}`;
  }

  /** it_propose: a change on a card for the manager, nothing running until their Run; or at once when auto-approve allows it. */
  protected async itPropose(a: ItProposeArgs): Promise<string> {
    if (!this.itOn) throw new HttpError(403, OFF);
    if (!this.state.settings.itDept.on) throw new HttpError(403, DEPT_OFF);
    const argv = (Array.isArray(a.argv) ? a.argv : []).map(String);
    const never = neverRefusal(argv, { protectedDirs: this.itProtected });
    if (never) throw new HttpError(403, never);
    if (this.state.itDesk.waiting.some((p) => argvLine(p.argv) === argvLine(argv))) throw new HttpError(409, `\`${argvLine(argv)}\` already waits for the manager's Run.`);
    const level = this.state.settings.itDept.autoApprove;
    let held = '';
    if (level !== 'off') {
      const job = this.state.it.job;
      if (this.itAuto.job !== job) this.itAuto = { job, steps: 0 };
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      const v = autoVerdict(argv, { level, protectedDirs: this.itProtected, itUnits: this.state.itDesk.units ?? [], officeUnits: OFFICE_UNITS, steps: this.itAuto.steps, log: this.state.itDesk.log, exists: (p) => !this.backend.demo && existsSync(p), stamp, linux: process.platform === 'linux' });
      if (v.auto) {
        const done = await this.itAutoRun(argv, v, String(a.why ?? '').trim());
        if (done) return done;
        held = ' (auto-approve held it: its backup step failed)';
      } else held = ` (auto-approve: ${v.why})`;
    }
    const line = this.itQueue({ argv, why: String(a.why ?? ''), affects: String(a.affects ?? ''), undo: String(a.undo ?? ''), risk: a.risk ?? 'medium', by: this.itName });
    return `On the manager's card${held}: \`${line}\`. Nothing has run: it runs only when they tap Run, and you get its output to check.`;
  }

  /** A card for the manager's Run / Approve: in IT's chat, on Telegram and as a notification. Returns its line. */
  private itQueue(c: Omit<ItProposal, 'id' | 'at'>): string {
    if (this.state.itDesk.waiting.length >= WAITING_MAX) throw new HttpError(409, `${WAITING_MAX} changes already wait for the manager: let them decide on those first.`);
    const line = argvLine(c.argv);
    if (this.state.itDesk.waiting.some((p) => argvLine(p.argv) === line)) throw new HttpError(409, `\`${line}\` already waits for the manager's ${c.cf || c.pa || c.ki ? 'Approve' : 'Run'}.`);
    const at = Date.now();
    const p: ItProposal = { ...c, id: `it-${at.toString(36)}-${++this.itSeq}`, why: this.itMask(c.why.trim()), affects: this.itMask(c.affects.trim()), undo: this.itMask(c.undo.trim()), ...(c.diff && { diff: this.itMask(c.diff) }), at };
    this.state.itDesk.waiting.push(p);
    this.itDeskChanged();
    this.itProposed(p); // its card in IT's chat and on Telegram, with Run / Not now
    this.notifier.notify('decisions', `${p.by} asks to ${c.cf ? 'change Cloudflare' : c.pa ? `change ${MODULES[c.pa.provider]?.name ?? c.pa.provider}` : c.ki ? 'install a key' : 'run a command'}`, `${line}\n${p.why}`);
    return line;
  }

  /** An auto-approved step: its backup or HEAD first (for the undo), then the change, logged and posted as done automatically. Null: the step before failed, so it goes on a card. */
  private async itAutoRun(argv: string[], v: AutoPlan, why: string): Promise<string | null> {
    let undo: string[][] | null = null;
    let first = '';
    if (v.before) {
      const b = await this.backend.itExec(v.before, CHANGE_TIMEOUT_MS);
      if (b.code !== 0) return null;
      undo = v.undo(b.out);
      first = `$ ${argvLine(v.before)}\n${b.out.trim()}\n`;
    } else undo = v.undo('');
    this.itAuto.steps++;
    const ran = await this.backend.itExec(v.argv, v.timeoutMs ?? CHANGE_TIMEOUT_MS);
    const extra = await this.fileSecrets(v.argv);
    const out = shapeOutput({ ...ran, out: first + ran.out, mask: (t) => this.itMask(t, extra), max: 8_000 });
    if (ran.code !== 0) undo = null;
    if (ran.code === 0 && v.unit && !this.state.itDesk.units?.includes(v.unit)) this.state.itDesk.units = [...(this.state.itDesk.units ?? []), v.unit];
    const entry = this.itLog({ kind: 'change', auto: true, by: `${this.itName} (auto-approve)`, argv, code: ran.code, out, why: this.itMask(why), ...(undo && { undo }) });
    this.itDeskChanged();
    const line = argvLine(argv);
    const how = ran.code === 0 ? 'Done automatically' : ran.code === null ? "Couldn't finish automatically" : `Exit ${ran.code}, done automatically`;
    this.itAutoPosted(`🤖 ${how}: \`${line}\``, `Auto-approve: ${v.shape}.${why ? ` ${why}` : ''}\n\n${out.trim() || '(no output)'}`, { log: entry.id, undo: !!undo });
    return `Done automatically (auto-approve, step ${this.itAuto.steps} of ${AUTO_STEPS_MAX}): $ ${line}\n${ran.code === null ? 'did not finish' : `exit ${ran.code}`}\n${out}${undo ? '\nThe manager has an Undo on its card.' : ''}`;
  }

  /** POST /api/it/undo: the manager's Undo on an auto step: its undo lines one after another (each through the never-list), stopping at a failure. */
  async itUndo(logId: string) {
    const e = this.state.itDesk.log.find((x) => x.id === logId);
    if (!(e?.undo || e?.restore) || e.undone) throw new HttpError(404, 'That step has no Undo, or was undone already.');
    if (this.itRunning.has(logId)) throw new HttpError(409, 'Undoing it already.');
    this.itRunning.add(logId);
    try {
      const by = `${this.managerLabel()} (Undo)`;
      let ok = true;
      const outs: string[] = [];
      if (e.restore) {
        const r = await this.keyRestore(e.restore);
        this.itLog({ kind: 'change', by, argv: ['restore_key_file', e.argv[2] ?? ''], code: r.ok ? 0 : 1, out: r.text, why: `Undo of ${argvLine(e.argv)}` });
        outs.push(r.text);
        ok = r.ok;
      }
      for (const argv of e.undo ?? []) {
        const never = neverRefusal(argv, { protectedDirs: this.itProtected });
        const ran = never ? { code: null, out: never, err: '' } : await this.backend.itExec(argv, CHANGE_TIMEOUT_MS);
        const extra = await this.fileSecrets(argv);
        const out = shapeOutput({ ...ran, mask: (t) => this.itMask(t, extra), max: 4_000 });
        this.itLog({ kind: 'change', by, argv, code: ran.code, out, why: `Undo of ${argvLine(e.argv)}` });
        outs.push(`$ ${argvLine(argv)}\n${out}`);
        if (ran.code !== 0) {
          ok = false;
          break;
        }
      }
      e.undone = true;
      this.itAutoUndone(logId);
      this.itAutoPosted(`${ok ? '↩️ Undone' : '⚠️ Undo stopped'}: \`${argvLine(e.argv)}\``, outs.join('\n'));
      this.itDeskChanged();
      return { ok };
    } finally {
      this.itRunning.delete(logId);
    }
  }

  // ---------- provider actions (#602; Cloudflare's since #586) ----------

  /** A provider's keys (ElevenLabs' is Voice's), the one network call, and the Box API: the keys stay on the server. */
  private actionCtx(provider: string): ActionCtx {
    const voice = provider === 'elevenlabs' && this.voice.secret() ? [{ id: 'voice', label: 'ElevenLabs (Voice)', key: this.voice.secret(), ok: true }] : [];
    return { keys: [...voice, ...this.providers.keysFor(provider)], http: this.backend.providerHttp, cloudflareApi: this.backend.cloudflareApi, boxes: this.cloud.boxApi(), repo: this.state.repos[0]?.fullName, secretFile: (envFile, name) => envSecretFile(this.cfSecretPath(envFile, name)), saveMinted: async (k) => (await this.providers.add(k.provider, k.value, k.label, '', k.mint.accountId, { expiresAt: k.expiresAt, mint: k.mint, usedBy: 'Made by the office' })).label, cfKeys: this.providers.keysFor('cloudflare'), entra: this.entraStore };
  }

  private entraTried = 0;

  /** With the hourly renewals: the Entra secret renewed 30 days before it ends (#621), tried at most once a day; logged and posted, never shown. */
  private async entraRenewTick(now = Date.now()) {
    if (now - this.entraTried < 86_400_000) return;
    const r = await renewEntraSecret(this.actionCtx('entra'), now);
    if (!r) return;
    this.entraTried = now;
    const out = this.itMask(r.text);
    this.itLog({ kind: 'change', auto: true, by: 'The office (Entra secret renewal)', argv: ['entra', 'secret_renew'], code: r.ok ? 0 : 1, out, why: 'The Cloudflare Access sign-in secret ends within 30 days.' });
    this.itDeskChanged();
    this.postMessage('office', `🔑 ${r.ok ? 'Renewed' : "Couldn't renew"} the Entra sign-in secret`, undefined, { notice: { details: out } });
  }

  /** Where a service token's secret goes (#607): the env file asked for, else one under the office's home (the demo's always is). */
  private cfSecretPath(envFile: string | undefined, name: string) {
    const own = path.join(HOME_DIR, 'secrets', `cf-access-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'token'}.env`);
    if (!envFile) return own;
    if (this.backend.demo) return path.join(HOME_DIR, 'secrets', path.basename(envFile));
    const no = envPathRefusal(envFile, this.itProtected);
    if (no) throw new CfError(no);
    return path.resolve(envFile);
  }

  /** cloudflare (#586): provider_action's Cloudflare ops. */
  protected cloudflareAct(a: CloudflareArgs, by: string): Promise<string> {
    const { op, why, ...args } = a;
    return this.providerAct({ provider: 'cloudflare', op, args, ...(why && { why }) }, by);
  }

  /** provider_action: a read now; a write planned, then applied under auto-approve's rules or put on a card with its diff. */
  protected async providerAct(a: ProviderActionArgs, by: string): Promise<string> {
    if (!this.itOn) throw new HttpError(403, OFF);
    try {
      const out = await runAction(this.actionCtx(a.provider), a);
      if ('text' in out) return this.itMask(out.text);
      const { plan } = out;
      if (plan.already) return `${this.itMask(plan.already)} Nothing to approve.`;
      const risk = actionOp(a.provider, a.op)!.risk as Exclude<ActionRisk, 'read'>;
      const level = this.state.settings.itDept.autoApprove;
      const why = (a.why ?? '').trim();
      if (autoApplies(risk, level)) {
        if (this.itAuto.job !== this.state.it.job) this.itAuto = { job: this.state.it.job, steps: 0 };
        if (this.itAuto.steps < AUTO_STEPS_MAX) return await this.actionAutoApply(plan.change, plan.argv, plan.undo, why, by);
      }
      const held = level === 'off' ? '' : ` (auto-approve: ${autoApplies(risk, level) ? `${AUTO_STEPS_MAX} automatic steps in this change already` : ACTION_HELD[risk]})`;
      const name = MODULES[a.provider].name;
      const change = a.provider === 'cloudflare' && (CF_OPS as readonly string[]).includes(a.op) ? { cf: plan.change.data as unknown as CfChange } : { pa: plan.change };
      const line = this.itQueue({ argv: plan.argv, why: why || `${name}: ${plan.summary}.`, affects: plan.summary, undo: plan.undo, risk: ACTION_RISK[risk], by, diff: plan.diff, ...change });
      return `On the manager's card with its diff${held}: \`${line}\`. Nothing is written until they tap Approve; then it's applied and read back.\n${this.itMask(plan.diff)}`;
    } catch (err) {
      if (err instanceof ActionError || err instanceof CfError) throw new HttpError(400, this.itMask(err.message));
      throw err;
    }
  }

  /** An auto-approved provider write: applied, read back, logged and posted as done automatically (its undo in words). */
  private async actionAutoApply(c: ProviderChange, argv: string[], undo: string, why: string, by: string): Promise<string> {
    this.itAuto.steps++;
    const r = await applyAction(this.actionCtx(c.provider), c);
    const code = r.ok ? 0 : 1;
    const out = shapeOutput({ out: r.text, err: '', mask: this.itMask, max: 8_000 });
    const entry = this.itLog({ kind: 'change', auto: true, by: `${by} (auto-approve)`, argv, code, out, why: this.itMask(why) });
    this.itDeskChanged();
    const line = argvLine(argv);
    this.itAutoPosted(`🤖 ${r.ok ? 'Done automatically' : "Couldn't do automatically"}: \`${line}\``, `Auto-approve: a routine ${MODULES[c.provider].name} change.${why ? ` ${why}` : ''}\n\n${out.trim()}\nTo undo: ${undo}.`, { log: entry.id, undo: false });
    return `${r.ok ? 'Done automatically' : "Couldn't do it automatically"} (auto-approve): \`${line}\`\n${out}\nTo undo: ${this.itMask(undo)}.`;
  }

  /** POST /api/it/run: the manager's Run on these cards, one after another; the never-list is checked again first. */
  async itRunProposals(ids: string[]) {
    if (!this.itOn) throw new HttpError(403, 'The IT desk is off: turn it on in Settings → CEO settings.');
    const picked = ids.map((id) => this.state.itDesk.waiting.find((p) => p.id === id)).filter((p): p is ItProposal => !!p && !this.itRunning.has(p.id));
    if (!picked.length) throw new HttpError(404, 'Those commands have run or gone already.');
    const results: { id: string; code: number | null }[] = [];
    for (const p of picked) {
      this.itRunning.add(p.id);
      try {
        const line = argvLine(p.argv);
        const by = `${this.managerLabel()}, proposed by ${p.by ?? this.ceo().name}`;
        const never = p.ki ? null : neverRefusal(p.argv, { protectedDirs: this.itProtected }); // install_key's is no command: its target was checked against the allow-list, and is again at Approve
        if (never) {
          this.itLog({ kind: 'change', by, argv: p.argv, code: null, out: never, why: p.why });
          this.itRan(p, `🖥️ Refused \`${line}\`: ${never}`, never, null);
          results.push({ id: p.id, code: null });
          continue;
        }
        const ran = p.ki ? await this.keyApply(p.ki.keyId, p.ki) : p.cf || p.pa ? await this.actionApply(p) : await this.backend.itExec(p.argv, CHANGE_TIMEOUT_MS);
        const extra = p.ki || p.cf || p.pa ? [] : await this.fileSecrets(p.argv);
        const out = shapeOutput({ ...ran, mask: (t) => this.itMask(t, extra), max: 8_000 });
        this.itLog({ kind: 'change', by, argv: p.argv, code: ran.code, out, why: p.why });
        const how = ran.code === 0 ? (p.cf || p.pa || p.ki ? 'Applied' : 'Ran') : ran.code === null ? "Couldn't finish" : `Exit ${ran.code} for`;
        this.itRan(p, `🖥️ ${how} \`${line}\` for ${p.by ?? this.ceo().name}`, out, { code: ran.code });
        if (p.cf || p.pa || p.ki) this.postMessage('office', `${p.cf ? '☁️' : '🔑'} ${ran.code === 0 ? 'Applied' : "Couldn't apply"} \`${line}\``, undefined, { notice: { details: out } }); // the CEO's chat too
        results.push({ id: p.id, code: ran.code });
      } finally {
        this.itRunning.delete(p.id);
        this.state.itDesk.waiting = this.state.itDesk.waiting.filter((x) => x.id !== p.id);
        this.itDeskChanged();
      }
    }
    return { results };
  }

  /** Approve on a provider's card: written and read back, as a command's result (code 0 when the read-back matches). */
  private async actionApply(p: ItProposal) {
    const c: ProviderChange = p.pa ?? { provider: 'cloudflare', op: p.cf!.op, keyId: p.cf!.keyId, data: { ...p.cf! } };
    const r = await applyAction(this.actionCtx(c.provider), c);
    return { code: r.ok ? 0 : 1, out: r.text, err: '' };
  }

  /** POST /api/it/dismiss: Not now on these cards; nothing runs, and the CEO's log says so. */
  itDismiss(ids: string[]) {
    const gone = this.state.itDesk.waiting.filter((p) => ids.includes(p.id) && !this.itRunning.has(p.id));
    if (!gone.length) throw new HttpError(404, 'Those commands have run or gone already.');
    this.state.itDesk.waiting = this.state.itDesk.waiting.filter((p) => !gone.includes(p));
    for (const p of gone) this.itLog({ kind: 'change', by: `${this.managerLabel()} (Not now)`, argv: p.argv, code: null, out: 'Not run: the manager said Not now.', why: p.why });
    this.itDeskChanged();
    return { ok: true };
  }

  // ---------- app_call (#625) ----------

  /** The Access token file for a host: the one asked for, else the one in the office's secrets folder naming the host. */
  private async appTokenFile(host: string, envFile?: string): Promise<string> {
    const dir = path.join(HOME_DIR, 'secrets');
    if (envFile) {
      const no = envPathRefusal(envFile, []);
      if (no) throw new HttpError(400, no);
      return this.backend.demo ? path.join(dir, path.basename(envFile)) : path.resolve(envFile);
    }
    const all = await readdir(dir).catch(() => [] as string[]);
    const hits = tokenFilesFor(host, all);
    if (hits.length === 1) return path.join(dir, hits[0]);
    throw new HttpError(400, hits.length ? `Several token files fit ${host} (${hits.join(', ')}): give env_file.` : `No Access token file for ${host} in ${dir}: give env_file, or make one with cloudflare access_service_token_ensure.`);
  }

  /** app_call: one HTTPS call to an allow-listed live app with its Access service token (headers only), the answer masked. */
  protected async appCall(a: AppCallArgs): Promise<string> {
    if (!this.itOn) throw new HttpError(403, OFF);
    if (!this.state.settings.itDept.on) throw new HttpError(403, DEPT_OFF);
    const method = String(a.method ?? 'GET').toUpperCase() as AppCallArgs['method'];
    const url = String(a.url ?? '').trim();
    const no = appCallRefusal(url, method);
    if (no) throw new HttpError(400, no);
    const file = await this.appTokenFile(new URL(url).hostname, a.env_file);
    const text = await readFile(file, 'utf8').catch(() => '');
    const token = accessToken(text);
    if (!token) throw new HttpError(400, `${file} has no CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET: make the token with cloudflare access_service_token_ensure.`);
    const res = await this.backend.providerHttp(token, { method, url, auth: 'cf-access', ...(a.body !== undefined && { body: a.body }) });
    const out = this.itMask(appCallReply(res.status, res.body), [...secretValues(text), ...token.split(':')]);
    const why = this.itMask(String(a.why ?? '').trim());
    this.itLog({ kind: method === 'GET' || method === 'HEAD' ? 'read' : 'change', by: this.itName, argv: ['app_call', method, url], code: res.status === 0 ? null : res.status < 400 ? 0 : res.status, out, ...(why && { why }) });
    this.itDeskChanged();
    return `$ app_call ${method} ${url}\n${out}`;
  }

  // ---------- keys end to end (#609) ----------

  /** Where a target's file is written: the demo's go into its own home. */
  private installPath(file: string) {
    const t = INSTALL_TARGETS.find((x) => x.file === file);
    return this.backend.demo ? path.join(HOME_DIR, 'demo-services', `${(t?.name ?? 'service').toLowerCase()}.env`) : file;
  }

  /** A Providers key by its id, its name, or its provider when that has one key. */
  private findKey(ref: string) {
    const all = this.providers.view().connections;
    const r = ref.trim().toLowerCase();
    const by = [(c: (typeof all)[number]) => c.id === ref.trim(), (c: (typeof all)[number]) => c.label.toLowerCase() === r, (c: (typeof all)[number]) => c.provider === r];
    for (const match of by) {
      const hits = all.filter(match);
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) throw new HttpError(400, `Several keys match "${ref}": give its id (${hits.map((c) => `${c.label}: ${c.id}`).join(', ')}).`);
    }
    throw new HttpError(404, `No key "${ref}" in Settings → Providers. Its keys: ${all.map((c) => `${c.label} (${c.provider}, ${c.id})`).join(', ') || 'none yet'}.`);
  }

  /** install_key: a card for the manager's Approve, or written at once when IT auto-approve allows a routine step. */
  protected async installKey(a: InstallKeyArgs, by: string): Promise<string> {
    if (!this.itOn) throw new HttpError(403, OFF);
    const c = this.findKey(String(a.key ?? ''));
    const file = String(a.target ?? '').trim();
    const varName = String(a.var_name ?? '').trim();
    const no = installRefusal(file, varName);
    if (no) throw new HttpError(403, no);
    const value = this.providers.keyValue(c.id);
    const part = value === undefined ? null : keyPart(value, a.part);
    if (part === null) throw new HttpError(400, value === undefined ? `${c.label} has no key saved: save it again.` : `${c.label} isn't an "id:secret" pair: leave part out.`);
    const t = INSTALL_TARGETS.find((x) => x.file === file)!;
    const ki: KeyInstall = { file, var: varName, ...(t.unit && { unit: t.unit }), ...(a.part && { part: a.part }) };
    const line = installLine(varName, file, keyHint(part));
    const why = (a.why ?? '').trim();
    const level = this.state.settings.itDept.autoApprove;
    if (autoApplies('routine', level)) {
      if (this.itAuto.job !== this.state.it.job) this.itAuto = { job: this.state.it.job, steps: 0 };
      if (this.itAuto.steps < AUTO_STEPS_MAX) return this.keyAutoInstall(c.id, ki, line, why, by);
    }
    const queued = this.itQueue({ argv: ['install_key', varName, file], why: why || `Install ${c.label} into ${t.name}.`, affects: `${line}${t.unit ? `, then restart ${t.unit}` : ''}`, undo: 'the file before is kept next to it as a backup', risk: 'low', by, ki: { keyId: c.id, ...ki } });
    return `On the manager's card${level === 'off' ? '' : ` (auto-approve: ${AUTO_STEPS_MAX} automatic steps in this change already)`}: \`${queued}\`, ${line}. Nothing is written until they tap Approve; then the file is written (mode 600, its old copy kept)${t.unit ? ` and ${t.unit} restarted` : ''}.`;
  }

  /** Writes a key's value into a target, notes it on the key, restarts the unit. Code 0 when it all went; never throws. */
  private async keyApply(keyId: string, ki: KeyInstall, value = this.providers.keyValue(keyId)) {
    const fail = (out: string) => ({ code: 1, out, err: '', wrote: null as null | { file: string; backup: string | null } });
    const part = value === undefined ? null : keyPart(value, ki.part);
    if (part === null) return fail('The key is gone from Settings → Providers, or is no longer an "id:secret" pair.');
    if (installRefusal(ki.file, ki.var)) return fail(installRefusal(ki.file, ki.var)!);
    const file = this.installPath(ki.file);
    let backup: string | null;
    try {
      ({ backup } = await installKeyFile(file, ki.var, part, new Date().toISOString().replace(/\D/g, '').slice(0, 14)));
    } catch (err) {
      return fail(`Couldn't write ${ki.file}: ${this.itMask((err as Error).message)}`);
    }
    await this.providers.noteInstall(keyId, { file: ki.file, var: ki.var, ...(ki.unit && { unit: ki.unit }), ...(ki.part && { part: ki.part }) }).catch(() => undefined);
    const lines = [`Installed ${installLine(ki.var, ki.file, keyHint(part))} (mode 600${backup ? `; the file before is at ${backup}` : ''}).`];
    let code = 0;
    if (ki.unit) {
      const r = await this.backend.itExec(['systemctl', 'restart', ki.unit], CHANGE_TIMEOUT_MS);
      code = r.code === 0 ? 0 : 1;
      lines.push(r.code === 0 ? `Restarted ${ki.unit}.` : `Restarting ${ki.unit} failed (${r.code === null ? 'timed out' : `exit ${r.code}`}): ${this.itMask((r.err || r.out).trim()).slice(0, 300)}`);
    }
    return { code, out: lines.join('\n'), err: '', wrote: { file, backup } };
  }

  /** An auto-approved install: written, logged and posted as done automatically, with an Undo that puts the file back. */
  private async keyAutoInstall(keyId: string, ki: KeyInstall, line: string, why: string, by: string): Promise<string> {
    this.itAuto.steps++;
    const r = await this.keyApply(keyId, ki);
    const out = this.itMask(r.out);
    const entry = this.itLog({ kind: 'change', auto: true, by: `${by} (auto-approve)`, argv: ['install_key', ki.var, ki.file], code: r.code, out, why: this.itMask(why), ...(r.wrote && { restore: { ...r.wrote, ...(ki.unit && { unit: ki.unit }) } }) });
    this.itDeskChanged();
    const how = r.code === 0 ? 'Done automatically' : "Couldn't do automatically";
    this.itAutoPosted(`🤖 ${how}: \`${line}\``, `Auto-approve: installing a key is routine, and its Undo puts the file back.${why ? ` ${why}` : ''}\n\n${out}`, { log: entry.id, undo: !!r.wrote });
    return `${how} (auto-approve): ${out}${r.wrote ? '\nThe manager has an Undo on its card.' : ''}`;
  }

  /** An auto install's Undo: the file from its backup, and its unit restarted. */
  private async keyRestore(r: NonNullable<ItLogEntry['restore']>): Promise<{ ok: boolean; text: string }> {
    try {
      await restoreKeyFile(r.file, r.backup);
    } catch (err) {
      return { ok: false, text: `Couldn't put the file back: ${this.itMask((err as Error).message)}` };
    }
    if (!r.unit) return { ok: true, text: 'Put the file back as it was.' };
    const x = await this.backend.itExec(['systemctl', 'restart', r.unit], CHANGE_TIMEOUT_MS);
    return { ok: x.code === 0, text: `Put the file back as it was; ${x.code === 0 ? `restarted ${r.unit}` : `restarting ${r.unit} failed`}.` };
  }

  /** save_provider_key: the pasted key saved in Providers, and masked wherever the chat kept it. */
  protected async saveProviderKey(a: SaveKeyArgs): Promise<string> {
    const value = String(a.value ?? '').trim();
    const c = await this.providers.add(String(a.provider ?? ''), value, a.label ?? '', '', '', a.uses ? { usedBy: a.uses } : {});
    const n = this.maskPastedKey(value, c.label);
    const test = c.test ? ` Its test: ${c.test.note}.` : '';
    return this.itMask(`Saved in Settings → Providers as "${c.label}" (id ${c.id}, ends …${c.keyHint}).${test} ${n ? `The chat shows "${savedMark(c.label)}" where it was pasted (${n} message${n === 1 ? '' : 's'}).` : "It wasn't in the chat, so nothing there was masked."} Put it where it's used with install_key.`);
  }

  /** The value out of the CEO's and IT's stored chats and queued jobs. Returns the messages changed. */
  private maskPastedKey(value: string, label: string): number {
    const mask = (t: string) => maskPasted(t, value, label);
    let n = 0;
    for (const m of this.state.messages) {
      const text = mask(m.text);
      const versions = m.versions?.map((v) => ({ ...v, text: mask(v.text) ?? v.text }));
      if (text === null && !m.versions?.some((v, i) => v.text !== versions![i].text)) continue;
      if (text !== null) m.text = text;
      if (versions) m.versions = versions;
      n++;
      this.broadcast({ type: 'ceoChat', message: m });
    }
    for (const j of this.state.ceo.queue) if (typeof j.text === 'string') j.text = mask(j.text) ?? j.text;
    for (const rt of this.agentRt.values()) for (const l of rt.log) l.text = mask(l.text) ?? l.text; // the sessions' log lines (the CEO's and IT's echo the message and the call)
    for (const a of this.state.agents) for (const l of a.logTail ?? []) l.text = mask(l.text) ?? l.text;
    n += this.itMaskPasted(mask);
    if (n) this.save();
    return n;
  }

  /** Renewals once an hour, the first a minute after start (#609). */
  protected override async startUsage() {
    setInterval(() => void this.renewKeys().then(() => this.entraRenewTick()), 3_600_000).unref();
    setTimeout(() => void this.renewKeys(), 60_000).unref();
    await super.startUsage();
  }

  private renewTried = new Map<string, number>();

  /** Every key the office made that's within RENEW_DAYS of expiring: renewed, installed again, the old one revoked; a failure retried a day later. */
  protected async renewKeys(now = Date.now()) {
    for (const c of this.providers.view().connections) {
      if (!c.mint || !renewDue(c.expiresAt, now) || now - (this.renewTried.get(c.id) ?? 0) < 86_400_000) continue;
      this.renewTried.set(c.id, now);
      const r = await renewMinted(c, {
        cloudflareApi: this.backend.cloudflareApi,
        parentKey: (id) => this.providers.keyValue(id),
        renewed: (id, value, at, tokenId) => this.providers.renewed(id, value, at, tokenId),
        install: async (ki, value) => {
          const x = await this.keyApply(c.id, ki, value);
          return { ok: x.code === 0, text: x.out };
        },
      }, now);
      if (r.ok) this.renewTried.delete(c.id);
      const out = this.itMask(r.text);
      this.itLog({ kind: 'change', auto: true, by: `${this.itName} (renewal)`, argv: ['renew_key', c.label], code: r.ok ? 0 : 1, out });
      this.itDeskChanged();
      this.itAutoPosted(`🔑 ${r.ok ? 'Renewed' : "Couldn't renew"} "${c.label}"`, out);
      if (!r.ok) this.notifier.notify('decisions', `Couldn't renew "${c.label}"`, out.split('\n').at(-1) ?? out);
    }
  }

  // ---------- runbook jobs (#611) ----------

  /** it_runbook: a floor's runbook as one job. Inside the auto-approve policy it starts now; else one card with Approve / Not now. */
  protected async itRunbook(a: ItRunbookArgs): Promise<string> {
    if (!this.itOn) throw new HttpError(403, OFF);
    if (!this.state.settings.itDept.on) throw new HttpError(403, DEPT_OFF);
    const repo = this.state.repos.find((r) => r.floor === a.floor);
    if (!repo) throw new HttpError(404, `There's no floor ${a.floor}: give the floor whose repo has the runbook.`);
    const project = String(a.project ?? '').trim().toLowerCase();
    const bad = projectProblem(project);
    if (bad) throw new HttpError(400, bad);
    const jobs = (this.state.itDesk.runbooks ??= []);
    const busy = jobs.find((j) => j.state === 'running' || (j.state === 'waiting' && j.project === project));
    if (busy) throw new HttpError(409, `"${busy.title}" is ${busy.state === 'running' ? 'running: wait for its result' : "already on the manager's card"}.`);
    const rel = String(a.path ?? '').replace(/^\/+/, '');
    const md = await this.backend.readRepoFile(repo.fullName, repo.defaultBranch, rel).catch((e: Error) => Promise.reject(new HttpError(404, `${rel}: ${e.message}`)));
    const parsed = parseRunbook(md);
    if ('refused' in parsed) throw new HttpError(400, `${rel}: ${parsed.refused}`);
    const scope = { project, repoName: repo.fullName.split('/')[1].toLowerCase(), repoUrls: [repo.url, `https://github.com/${repo.fullName}`] };
    for (const [i, step] of parsed.steps.entries()) {
      const never = stepNever(step, scope, this.itProtected);
      if (never) throw new HttpError(403, `Step ${i + 1} (${stepLabel(step)}): ${never}`);
      const missing = step.kind === 'env' && step.vars.find((v) => 'provider' in v.value && !this.providers.keysFor(v.value.provider).length);
      if (missing && 'provider' in missing.value) throw new HttpError(400, `Step ${i + 1}: ${missing.name} needs a ${missing.value.provider} key, and Settings → Providers has none. Ask the manager to add it there.`);
    }
    const exists = (p: string) => !this.backend.demo && existsSync(p);
    const itUnits = this.state.itDesk.units ?? [];
    const policy = runbookVerdict(parsed.steps, { ...scope, level: this.state.settings.itDept.autoApprove, protectedDirs: this.itProtected, itUnits, officeUnits: OFFICE_UNITS, exists, linux: process.platform === 'linux' });
    const foreign = policy.auto && projectForeign(project, { exists, itUnits, ranBefore: jobs.some((j) => j.project === project && (j.state === 'done' || j.state === 'failed')) });
    const verdict = foreign ? { auto: false as const, why: foreign } : policy;
    const at = Date.now();
    const job: ItRunbookJob = {
      id: `rb-${at.toString(36)}-${++this.itSeq}`,
      title: parsed.title || `Run ${rel}`,
      project,
      source: `floor ${repo.floor}: ${rel}`,
      by: this.itName,
      at,
      summary: runbookSummary(parsed.steps, scope),
      auto: verdict.auto,
      ...(!verdict.auto && { held: verdict.why }),
      state: 'waiting',
      steps: parsed.steps.map((s) => ({ label: stepLabel(s), state: 'waiting', ...(s.kind === 'run' && s.check && { check: true as const }) })),
      undoable: false,
      plan: parsed.steps,
      changes: [],
    };
    this.state.itDesk.runbooks = [job, ...jobs].slice(0, RUNBOOKS_KEPT);
    this.itDeskChanged();
    const head = `${job.title}: ${job.summary}.`;
    if (!verdict.auto) {
      this.itRunbookPosted(job, `📋 ${head} One Approve runs it all.`, `Needs your Approve: ${verdict.why}.`);
      this.notifier.notify('decisions', `${this.itName} asks to run "${job.title}"`, `${job.summary}\n${verdict.why}`);
      return `On the manager's card as one job (auto-approve: ${verdict.why}). Nothing has run: one Approve runs all ${job.steps.length} steps, and the result comes to you.`;
    }
    this.itRunbookPosted(job, `📋 ${head} Running it without a tap (auto-approve).`, job.steps.map((s, i) => `${i + 1}. ${s.label}`).join('\n'));
    void this.runbookGo(job);
    return `Started "${job.title}" (${job.id}): ${job.summary}, inside auto-approve, so no tap. Progress is on its card; the result (and the health check) comes to you, the CEO and the manager when it ends.`;
  }

  /** POST /api/it/runbook/:id: the manager's Approve (starts it; the result comes as a card) or Not now on a runbook's card. */
  itRunbookDecide(id: string, run: boolean) {
    const job = this.state.itDesk.runbooks?.find((j) => j.id === id);
    if (!job || job.state !== 'waiting') throw new HttpError(404, 'That runbook has run or gone already.');
    const other = run && this.state.itDesk.runbooks?.find((j) => j.state === 'running');
    if (other) throw new HttpError(409, `"${other.title}" is running: Approve this one once it ends.`);
    if (!run) {
      job.state = 'dismissed';
      this.itLog({ kind: 'change', by: `${this.managerLabel()} (Not now)`, argv: ['runbook', job.title], code: null, out: 'Not run: the manager said Not now.' });
      this.itDeskChanged();
      return { ok: true };
    }
    void this.runbookGo(job, this.managerLabel()); // it's running from here on, so a second tap finds nothing to approve
    return { ok: true };
  }

  /** The job's steps on this machine, each logged, progress to the tabs; the result to IT's chat, the CEO's and Telegram. */
  private async runbookGo(job: ItRunbookJob, approvedBy?: string) {
    const host: RunbookHost = { ...this.backend.itFiles, exec: (argv, ms, cwd) => this.backend.itExec(argv, ms, cwd) };
    const by = approvedBy ? `${approvedBy}, proposed by ${job.by}` : `${job.by} (auto-approve)`;
    const run = runRunbook(job, host, {
      mask: this.itMask,
      key: (p) => this.providers.keysFor(p)[0]?.key ?? null,
      changed: (v, i) => {
        if (v.state !== 'running') this.itLog({ kind: 'change', ...(!approvedBy && { auto: true as const }), by, argv: ['runbook', job.title, `step ${i + 1}`], code: v.code ?? null, out: `${v.label}\n${v.out ?? ''}`.trim(), why: job.source });
        this.itDeskChanged();
      },
    });
    await run.catch((err: Error) => {
      job.state = 'failed';
      job.ended = Date.now();
      job.undoable = job.changes.length > 0;
      this.itLog({ kind: 'change', by, argv: ['runbook', job.title], code: null, out: this.itMask(err.message) });
    });
    this.itDeskChanged();
    const failed = job.steps.findIndex((s) => s.state === 'failed');
    const check = job.check ? (job.check.ok ? 'health check green' : 'health check failed') : 'no health check';
    const text = job.state === 'done' ? `✅ ${job.title}: all ${job.steps.length} steps done, ${check}.` : `⚠️ ${job.title} stopped at step ${failed + 1} of ${job.steps.length}${job.check && !job.check.ok ? ' (the health check)' : ''}.`;
    const details = failed >= 0 ? `${job.steps[failed].label}\n${job.steps[failed].out ?? ''}`.trim() : (job.check?.out ?? '');
    this.itRunbookPosted(job, `${text}${job.undoable ? ' Undo puts it all back.' : ''}`, details || '(no output)');
    this.postMessage('office', `🖥️ IT: ${text}`, undefined, { notice: { details: details || '(no output)' } });
    if (job.state !== 'done') this.notifier.notify('decisions', text, details.slice(0, 300));
  }

  /** POST /api/it/runbook/:id/undo: the whole job undone, newest change first. */
  async itRunbookUndo(id: string) {
    const job = this.state.itDesk.runbooks?.find((j) => j.id === id);
    if (!job?.undoable || job.state === 'undone' || job.state === 'running') throw new HttpError(404, 'That runbook has no Undo, or was undone already.');
    if (this.itRunning.has(id)) throw new HttpError(409, 'Undoing it already.');
    this.itRunning.add(id);
    try {
      const host: RunbookHost = { ...this.backend.itFiles, exec: (argv, ms, cwd) => this.backend.itExec(argv, ms, cwd) };
      const r = await undoRunbook(job, host, this.itMask);
      job.state = 'undone';
      job.undoable = false;
      this.itLog({ kind: 'change', by: `${this.managerLabel()} (Undo)`, argv: ['runbook', job.title, 'undo'], code: r.ok ? 0 : 1, out: r.out });
      this.itDeskChanged();
      this.itRunbookPosted(job, `${r.ok ? '↩️ Undone' : '⚠️ Undo stopped'}: ${job.title}`, r.out);
      return { ok: r.ok };
    } finally {
      this.itRunning.delete(id);
    }
  }
}
