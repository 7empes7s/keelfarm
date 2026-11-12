// The IT desk (#506): the IT department's commands on this machine (#524: the IT lead's, no longer the CEO's). it_run
// runs a read-only command at once; it_propose puts a change on a card in the chats, Mission control and Telegram, run
// only on the manager's Run (several at once with Run all) and checked against the never-list again then; IT then checks
// the result (itRan). Every command is logged here and in the daily log. Rules in server/itDesk.ts.
import os from 'node:os';
import path from 'node:path';
import { argvLine, IT_LOG_KEPT, IT_LOG_SHOWN, type ItDeskView, type ItLogEntry, type ItProposal, type ItRisk } from '../../shared/itDesk.ts';
import { redact as scrub } from '../../shared/journal.ts';
import type { WorldSnapshot } from '../../shared/types.ts';
import { HOME_DIR } from '../config.ts';
import { HttpError } from '../httpError.ts';
import { CHANGE_TIMEOUT_MS, LOG_OUT_MAX, neverRefusal, parseCommand, readOnlyPlan, shapeOutput } from '../itDesk.ts';
import { OFFICE_DIR } from '../officeUpdate.ts';
import { applyWrite, CfError, ingressGet, planWrite, tokenScopes } from '../cloudflare.ts';
import type { CloudflareArgs } from '../ceoItTools.ts';
import { SwarmManagerAsks } from './managerAsks.ts';

/** it_run's and it_propose's arguments (server/ceoItTools.ts). */
export interface ItRunArgs {
  command: string;
  sort?: 'size';
  lines?: number;
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

export abstract class SwarmItDesk extends SwarmManagerAsks {
  private itSeq = 0;
  private itRunning = new Set<string>();

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
    return { on: this.itOn, waiting: this.state.itDesk.waiting, log: this.state.itDesk.log.slice(0, IT_LOG_SHOWN) };
  }

  /** Left out while empty: every tab's snapshot pays for it (scale.test.ts), and the switch is in the settings. */
  override snapshot(): WorldSnapshot {
    const d = this.state.itDesk;
    return d.waiting.length || d.log.length ? { ...super.snapshot(), itDesk: this.itDeskView() } : super.snapshot();
  }

  private itDeskChanged() {
    this.save();
    this.broadcast({ type: 'itDesk', itDesk: this.itDeskView() });
  }

  private itLog(e: Omit<ItLogEntry, 'id' | 'at'>) {
    const at = Date.now();
    const entry: ItLogEntry = { ...e, id: `${at.toString(36)}-${++this.itSeq}`, at, out: e.out.slice(0, LOG_OUT_MAX) };
    this.state.itDesk.log = [entry, ...this.state.itDesk.log].slice(0, IT_LOG_KEPT);
    const head = `IT desk (${e.kind}, by ${e.by}): \`${argvLine(e.argv)}\` → ${e.code === null ? 'did not run' : `exit ${e.code}`}`;
    void this.history.note(`${head}${e.why ? ` · ${e.why}` : ''}${e.out.trim() ? `\n  ${e.out.trim().split('\n').slice(0, 5).join('\n  ')}` : ''}`);
    return entry;
  }

  private itMask = (s: string) => scrub(s, this.secrets());

  /** it_run: one read-only command now, its output sorted, limited, masked and capped. */
  protected async itRun(a: ItRunArgs): Promise<string> {
    if (!this.itOn) throw new HttpError(403, OFF);
    if (!this.state.settings.itDept.on) throw new HttpError(403, DEPT_OFF);
    const parsed = parseCommand(String(a.command ?? ''));
    if ('refused' in parsed) throw new HttpError(400, parsed.refused);
    const plan = readOnlyPlan(parsed.argv, { linux: process.platform === 'linux' });
    if ('refused' in plan) throw new HttpError(400, plan.refused);
    const ran = await this.backend.itExec(plan.argv, plan.timeoutMs);
    const out = shapeOutput({ ...ran, sort: a.sort, lines: a.lines, mask: this.itMask });
    this.itLog({ kind: 'read', by: this.itName, argv: parsed.argv, code: ran.code, out });
    this.itDeskChanged();
    return `$ ${argvLine(parsed.argv)}\n${ran.code === null ? 'did not finish' : `exit ${ran.code}`}\n${out}`;
  }

  /** it_propose: a change on a card for the manager; nothing runs until their Run. */
  protected itPropose(a: ItProposeArgs): string {
    if (!this.itOn) throw new HttpError(403, OFF);
    if (!this.state.settings.itDept.on) throw new HttpError(403, DEPT_OFF);
    const argv = (Array.isArray(a.argv) ? a.argv : []).map(String);
    const never = neverRefusal(argv, { protectedDirs: this.itProtected });
    if (never) throw new HttpError(403, never);
    const line = this.itQueue({ argv, why: String(a.why ?? ''), affects: String(a.affects ?? ''), undo: String(a.undo ?? ''), risk: a.risk ?? 'medium', by: this.itName });
    return `On the manager's card: \`${line}\`. Nothing has run: it runs only when they tap Run, and you get its output to check.`;
  }

  /** A card for the manager's Run / Approve: in IT's chat, on Telegram and as a notification. Returns its line. */
  private itQueue(c: Omit<ItProposal, 'id' | 'at'>): string {
    if (this.state.itDesk.waiting.length >= WAITING_MAX) throw new HttpError(409, `${WAITING_MAX} changes already wait for the manager: let them decide on those first.`);
    const line = argvLine(c.argv);
    if (this.state.itDesk.waiting.some((p) => argvLine(p.argv) === line)) throw new HttpError(409, `\`${line}\` already waits for the manager's ${c.cf ? 'Approve' : 'Run'}.`);
    const at = Date.now();
    const p: ItProposal = { ...c, id: `it-${at.toString(36)}-${++this.itSeq}`, why: this.itMask(c.why.trim()), affects: this.itMask(c.affects.trim()), undo: this.itMask(c.undo.trim()), ...(c.diff && { diff: this.itMask(c.diff) }), at };
    this.state.itDesk.waiting.push(p);
    this.itDeskChanged();
    this.itProposed(p); // its card in IT's chat and on Telegram, with Run / Not now
    this.notifier.notify('decisions', `${p.by} asks to ${c.cf ? 'change Cloudflare' : 'run a command'}`, `${line}\n${p.why}`);
    return line;
  }

  // ---------- the Cloudflare action (#586) ----------

  private cfKeys = () => this.providers.keysFor('cloudflare');

  /** cloudflare: a read now, or a write on a diff card for the manager's Approve. The key stays on the server. */
  protected async cloudflareAct(a: CloudflareArgs, by: string): Promise<string> {
    if (!this.itOn) throw new HttpError(403, OFF);
    const api = this.backend.cloudflareApi;
    try {
      if (a.op === 'token_scopes') return this.itMask(await tokenScopes(this.cfKeys(), api, a));
      if (a.op === 'tunnel_ingress_get') return this.itMask(await ingressGet(this.cfKeys(), api, a.tunnel));
      if (!a.hostname) throw new CfError('Give the hostname, e.g. clip.example.com.');
      const plan = await planWrite(this.cfKeys(), api, { ...a, op: a.op, hostname: a.hostname });
      if (plan.already) return `${plan.already} Nothing to approve.`;
      const c = plan.change;
      const argv = ['cloudflare', c.op, c.hostname, ...(c.op === 'tunnel_ingress_add' ? [c.service] : [])];
      const undo = c.op === 'tunnel_ingress_add' ? 'remove the rule in Zero Trust → Networks → Tunnels' : c.op === 'dns_cname_ensure' ? 'delete the record in DNS' : 'delete the app in Zero Trust → Access → Applications';
      const line = this.itQueue({ argv, why: a.why ?? `Cloudflare: ${plan.summary}.`, affects: plan.summary, undo, risk: c.op === 'access_app_ensure' ? 'medium' : 'low', by, cf: c, diff: plan.diff });
      return `On the manager's card with its diff: \`${line}\`. Nothing is written until they tap Approve; then it's applied and read back.\n${this.itMask(plan.diff)}`;
    } catch (err) {
      if (err instanceof CfError) throw new HttpError(400, this.itMask(err.message));
      throw err;
    }
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
        const never = neverRefusal(p.argv, { protectedDirs: this.itProtected });
        if (never) {
          this.itLog({ kind: 'change', by, argv: p.argv, code: null, out: never, why: p.why });
          this.itRan(p, `🖥️ Refused \`${line}\`: ${never}`, never, null);
          results.push({ id: p.id, code: null });
          continue;
        }
        const ran = p.cf ? await this.cfApply(p) : await this.backend.itExec(p.argv, CHANGE_TIMEOUT_MS);
        const out = shapeOutput({ ...ran, mask: this.itMask, max: 8_000 });
        this.itLog({ kind: 'change', by, argv: p.argv, code: ran.code, out, why: p.why });
        const how = ran.code === 0 ? (p.cf ? 'Applied' : 'Ran') : ran.code === null ? "Couldn't finish" : `Exit ${ran.code} for`;
        this.itRan(p, `🖥️ ${how} \`${line}\` for ${p.by ?? this.ceo().name}`, out, { code: ran.code });
        if (p.cf) this.postMessage('office', `☁️ ${ran.code === 0 ? 'Applied' : "Couldn't apply"} \`${line}\``, undefined, { notice: { details: out } }); // the CEO's chat too
        results.push({ id: p.id, code: ran.code });
      } finally {
        this.itRunning.delete(p.id);
        this.state.itDesk.waiting = this.state.itDesk.waiting.filter((x) => x.id !== p.id);
        this.itDeskChanged();
      }
    }
    return { results };
  }

  /** Approve on a Cloudflare card: written and read back, as a command's result (code 0 when the read-back matches). */
  private async cfApply(p: ItProposal) {
    const r = await applyWrite(this.cfKeys(), this.backend.cloudflareApi, p.cf!);
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
}
