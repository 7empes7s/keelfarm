// The office keeps its disk healthy (#340, shared/disk.ts, server/diskCare.ts): the disks it writes to on the health
// strip (a hold on new builds, QA and previews when one is nearly full), the cleanup of its own leftovers every hour and
// from Mission control's "Free up space" (with a preview first), and agents' working copies on a second disk.
import os from 'node:os';
import { cleanLine, DEFAULT_DISK, diskSettings, pickCleanup, workRootProblem, type CleanItem, type CleanPlan, type CleanResult, type DiskSettings, type MachineFacts } from '../../shared/disk.ts';
import { HOME_DIR } from '../config.ts';
import { HttpError } from '../httpError.ts';
import { machineName } from '../machines.ts';
import { oneLine } from './model.ts';
import { SwarmServerLoad } from './serverLoad.ts';

/** How often the office looks whether a cleanup is due and idle machines should move disks. */
const DISK_TICK_MS = 10 * 60_000;

export abstract class SwarmDisk extends SwarmServerLoad {
  private lastClean: CleanResult | null = null;
  private lastAutoAt = Date.now();
  private cleaning = false;

  protected get disk(): DiskSettings {
    return diskSettings(DEFAULT_DISK, this.state.settings.disk);
  }

  /** Started with the usage readings, once from init. */
  protected override async startUsage() {
    this.backend.disk.setWorkRoot(this.disk.workRoot);
    this.health.useDisk({ read: () => this.backend.disk.read(this.diskDirs()), settings: () => this.disk, alert: (title, body) => this.notifier.notify('disk', title, body), lastClean: () => this.lastClean });
    setInterval(() => void this.diskTick(), DISK_TICK_MS).unref();
    await super.startUsage();
  }

  private diskDirs() {
    return [{ label: 'Office data', path: HOME_DIR }, { label: 'Temp files', path: os.tmpdir() }, ...(this.disk.workRoot ? [{ label: 'Working copies', path: this.disk.workRoot }] : [])];
  }

  private async diskTick() {
    const every = this.disk.cleanEveryHours;
    if (every > 0 && Date.now() - this.lastAutoAt >= every * 3_600_000) {
      this.lastAutoAt = Date.now();
      await this.cleanDisk(true).catch((err) => console.warn('disk cleanup failed:', oneLine(err)));
    }
    await this.moveIdleMachines();
  }

  /** Whose a machine is: null when its agent is on no team any more. */
  private machineOwner(machine: string): MachineFacts['agent'] {
    const a = this.state.agents.find((x) => x.role !== 'ceo' && (x.host ?? 'local') === 'local' && (x.machine ?? machineName(x.id)) === machine);
    return a ? { name: a.name, repo: this.state.repos.find((r) => r.id === a.repoId)?.fullName ?? null, busy: this.deskBusy(a) } : null;
  }

  /** Branches that must stay: every agent's current one, and open PRs QA tests or a developer fixes. */
  private heldBranches(): Set<string> {
    const held = new Set(this.state.agents.flatMap((a) => (a.branch ? [a.branch] : [])));
    for (const r of this.state.repos) for (const p of this.repoRt.get(r.id)?.pulls ?? []) if (p.state === 'OPEN' && this.state.qa.some((q) => q.repoId === r.id && q.prNumber === p.number)) held.add(p.headRefName);
    return held;
  }

  /** "Free up space"'s preview: what goes (measured), what stays and why, and what's outside the office's folders. */
  async diskPlan(withOutside = true): Promise<CleanPlan> {
    const machines = (await this.backend.disk.scan()).map((m) => ({ ...m, agent: this.machineOwner(m.machine) }));
    const { go, kept } = pickCleanup(machines, this.heldBranches(), this.disk.keepDays);
    const measure = async (items: CleanItem[]) => {
      const sizes = await this.backend.disk.measure(items.map((i) => i.path));
      return items.map((i, n) => ({ ...i, mb: Math.round(sizes[n]) }));
    };
    return { go: await measure(go), kept: await measure(kept), outside: withOutside ? await this.backend.disk.outside() : [], at: Date.now() };
  }

  /** Remove what the plan picks now (picked again, so nothing that got busy since goes), log it and refresh the strip. */
  async cleanDisk(auto = false): Promise<CleanResult> {
    if (this.cleaning) throw new HttpError(409, 'A cleanup is running already.');
    this.cleaning = true;
    try {
      const plan = await this.diskPlan(false);
      const result: CleanResult = { at: Date.now(), freedMb: 0, removed: 0, kept: plan.kept.length, failed: [], auto };
      const done: CleanItem[] = [];
      for (const item of plan.go) {
        try {
          result.freedMb += await this.backend.disk.remove(item);
          result.removed++;
          done.push(item);
        } catch (err) {
          result.failed.push(`${item.label}: ${oneLine(err)}`);
        }
      }
      result.freedMb = Math.round(result.freedMb);
      this.lastClean = result;
      if (result.removed || result.failed.length || !auto) {
        const line = cleanLine(result, done);
        console.log(line);
        this.postMessage('office', line);
        void this.history.note(line);
      }
      await this.health.refresh();
      return result;
    } finally {
      this.cleaning = false;
    }
  }

  /** Settings → Agents' disk fields; a new place for working copies must be a mounted disk other than the office's, with room. */
  async setDiskSettings(patch: unknown): Promise<DiskSettings> {
    const next = diskSettings(this.disk, patch);
    if (next.workRoot !== this.disk.workRoot) {
      const problem = workRootProblem(await this.backend.disk.inspectRoot(next.workRoot), next);
      if (problem) throw new HttpError(400, problem);
      this.backend.disk.setWorkRoot(next.workRoot);
      setTimeout(() => void this.moveIdleMachines(), 1000);
    }
    this.state.settings.disk = next;
    this.save();
    this.broadcast({ type: 'settings', settings: this.state.settings });
    await this.health.refresh();
    return next;
  }

  /** Idle agents' machines move to where working copies go now; a task waits for a move under way (machines.ts). */
  private async moveIdleMachines() {
    for (const a of this.state.agents.filter((x) => x.role !== 'ceo' && (x.host ?? 'local') === 'local')) {
      const machine = a.machine ?? machineName(a.id);
      const ok = await this.backend.disk.move(machine, () => !this.deskBusy(a)).catch((err) => (console.warn(`could not move ${a.name}'s machine:`, oneLine(err)), false));
      if (ok) console.log(`disk: moved ${a.name}'s machine to ${this.disk.workRoot || 'the office folder'}`);
    }
  }

  /** The demo's "Simulate low disk", and its way back. */
  async simulateDisk(low: boolean) {
    if (!this.backend.disk.simulate) throw new HttpError(404, 'Only the demo office can pretend the disk is full.');
    this.backend.disk.simulate(low);
    await this.health.refresh();
    return this.health.view();
  }
}
