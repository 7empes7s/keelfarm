// The office's own update: settling, draining, the hand-over to the launcher, the result after a restart.
import { HttpError } from '../httpError.ts';
import { drainDecision, lastUpdateMessage, POSTPONE_MS, settleMinutes, type DrainInput, type LastUpdate } from '../officeUpdate.ts';
import type { OfficeUpdateView } from '../../shared/types.ts';
import { BUSY, oneLine, type PersistedAgent } from './model.ts';
import { SwarmScheduling } from './scheduling.ts';

export abstract class SwarmUpdate extends SwarmScheduling {
  // ---------- the office's own update ----------

  /**
   * Busy agents an office restart would stop: not cloud agents in their Boxes, nor CLIs in the terminal keeper, which
   * the restarted office picks up again. The CEO's session is resumed instead, as its office tools live in this process.
   */
  protected unkept(): PersistedAgent[] {
    const boxes = this.inBoxes();
    return this.state.agents.filter((a) => BUSY.includes(a.status) && !boxes.includes(a) && !(a.role !== 'ceo' && a.status === 'working' && this.agentRt.get(a.id)?.session?.kept));
  }

  protected drainInput(): DrainInput {
    const u = this.officeUpdate;
    return {
      now: Date.now(),
      behind: this.officeHead ? u.behind : 0,
      launcher: this.backend.office.launcher,
      autoUpdate: this.state.settings.autoUpdate !== false,
      requested: u.requested,
      postponedUntil: u.postponedUntil,
      postponedBehind: u.postponedBehind,
      failed: u.failed,
      failedBehind: u.failedBehind,
      drainingSince: u.drainingSince,
      sent: u.sent,
      running: this.unkept().length,
      pendingSince: u.pendingSince,
      lastCommitAt: u.lastCommitAt,
      settleMs: settleMinutes(this.state.settings.updateSettleMin) * 60_000,
      keeper: this.state.settings.runtime === 'terminal' && this.backend.keeping(),
    };
  }

  protected officeUpdateView(): OfficeUpdateView {
    const u = this.officeUpdate;
    const input = this.drainInput();
    const d = drainDecision(input);
    const until = u.postponedUntil ? new Date(u.postponedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const detail = d.state === 'failed' ? u.failed : d.state === 'waiting' ? `Postponed until ${until}, or until a newer commit lands.` : null;
    return { state: d.state, behind: input.behind, launcher: input.launcher, drainingSince: u.drainingSince ?? d.drainingSince, running: input.running, updateAt: d.updateAt, holds: d.holds || (d.send && !input.keeper), detail };
  }

  protected emitOfficeUpdate() {
    if (!this.officeHead) return;
    const view = this.officeUpdateView();
    const key = JSON.stringify(view);
    if (key === this.lastOfficeView) return;
    this.lastOfficeView = key;
    this.broadcast({ type: 'officeUpdate', officeUpdate: view });
  }

  /** The own-folder check found the office this many commits behind GitHub. */
  protected setOfficeBehind(behind: number) {
    const u = this.officeUpdate;
    if (u.failed && u.failedBehind === null) u.failedBehind = behind; // only a newer commit retries a failed update by itself
    const now = Date.now();
    if (behind > 0) u.pendingSince ??= now;
    if (behind > u.behind) u.lastCommitAt = now; // a newer commit: the update waits for the run of merges to settle
    u.behind = behind;
    if (behind === 0) Object.assign(u, { requested: false, failed: null, failedBehind: null, pendingSince: null, lastCommitAt: null });
    this.officeUpdateTick();
  }

  /**
   * Take the office's own update one step (see drainDecision): settle, drain what a restart would stop, and hand it to
   * the launcher. True while nothing new may start.
   */
  protected officeUpdateTick(): boolean {
    if (!this.officeHead) return false;
    const u = this.officeUpdate;
    const input = this.drainInput();
    const d = drainDecision(input);
    if (d.state === 'draining' && u.drainingSince === null) {
      const commits = `${u.behind} new commit${u.behind === 1 ? '' : 's'}`;
      const n = input.running;
      this.postMessage(
        'office',
        d.send && input.keeper
          ? `⬆️ Updating the office (${commits}). Agents keep working; the office restarts for a few seconds once the update passes its checks.`
          : `⬆️ Updating the office (${commits}). Nothing new starts, though the CEO still answers you${n ? ` while ${n} running session${n === 1 ? '' : 's'} finish` : ''}; then it installs and restarts.`,
      );
    }
    u.drainingSince = d.drainingSince;
    u.holding = d.holds || (d.send && !input.keeper);
    if (d.send) void this.handOver(d.timedOut);
    this.emitOfficeUpdate();
    return u.holding;
  }

  /**
   * Drained: hand the update to the launcher, which runs the preflight while work goes on, then restarts the office.
   * Sessions a restart would stop that still run after the timeout are stopped now; CLIs in the terminal keeper and in
   * Boxes carry on, and the restarted office picks them up.
   */
  protected async handOver(timedOut: boolean) {
    const u = this.officeUpdate;
    const from = this.officeHead!;
    u.sent = true;
    const busy = timedOut ? this.unkept() : [];
    if (busy.length) this.postMessage('office', `⏱ ${busy.length} session${busy.length === 1 ? ' was' : 's were'} still running after 20 minutes. Stopped; the work goes back to the queue after the update.`);
    this.emitOfficeUpdate();
    for (const a of busy) u.cutOff.add(a.id);
    await this.writeState().catch((err) => console.warn('could not save the state', err)); // still "working": the restarted office recovers them
    for (const a of busy) this.agentRt.get(a.id)?.session?.stop();
    try {
      const result = await this.backend.office.update(from);
      if (result) await this.afterUpdate(result); // the demo, or a refused preflight: nothing restarts
    } catch (err) {
      await this.afterUpdate({ from, to: from, ok: false, error: `the launcher didn't take the update: ${oneLine(err)}`, installed: false, built: false, at: Date.now() });
    }
  }

  /**
   * An update that didn't restart the office (the demo, a refused preflight, a failed hand-over): the sessions the
   * hand-over stopped are recovered like after a restart; the rest never stopped.
   */
  protected async afterUpdate(result: LastUpdate) {
    const u = this.officeUpdate;
    const interrupted = this.state.agents.filter((a) => u.cutOff.has(a.id) && BUSY.includes(a.status));
    Object.assign(u, { sent: false, holding: false, requested: false, drainingSince: null, pendingSince: null, lastCommitAt: null, cutOff: new Set<string>() });
    const preparing = new Set(interrupted.filter((a) => a.status === 'preparing'));
    for (const a of interrupted) {
      Object.assign(a, { status: 'stopped', lastError: 'The office updated itself while this agent was working.' });
      const rt = this.agentRt.get(a.id);
      if (rt) Object.assign(rt, { session: null, currentTool: null });
    }
    this.ensureCeo(interrupted);
    this.recover(interrupted, preparing);
    interrupted.forEach((a) => this.emitAgent(a));
    await this.reportUpdate(result);
    if (!result.ok) u.failedBehind = u.behind;
    const own = this.state.repos.find((r) => this.backend.office.isOwnFolder(this.backend.mainDir(r.fullName)));
    if (own) await this.syncFolder(own);
    this.emitCeo();
    this.save();
    setTimeout(() => this.schedule(), 300);
  }

  /** One phone message about the last update (the launcher's last-update.json, or the demo's fake). */
  protected async reportUpdate(result: LastUpdate) {
    const commits = result.ok && result.to ? await this.backend.office.commitsBetween(result.from, result.to) : null;
    this.postMessage('office', lastUpdateMessage(result, commits));
    Object.assign(this.officeUpdate, { failed: result.ok ? null : result.error || 'unknown error', failedBehind: null });
  }

  /** The manager's Update now (drain now, even with automatic updates off) or Later (not for 2 hours, or until a newer commit). */
  updateOffice(action: unknown): OfficeUpdateView {
    if (action !== 'now' && action !== 'later') throw new HttpError(400, 'action must be "now" or "later"');
    const u = this.officeUpdate;
    if (!this.officeHead || !this.backend.office.launcher) throw new HttpError(409, 'The office can only update itself when its launcher started it (npm run dev or npm start).');
    if (u.sent) throw new HttpError(409, 'The update is already under way.');
    if (u.behind <= 0) throw new HttpError(409, 'The office is up to date: there is nothing to update.');
    if (action === 'now') Object.assign(u, { requested: true, postponedUntil: null });
    else Object.assign(u, { requested: false, postponedUntil: Date.now() + POSTPONE_MS, postponedBehind: u.behind });
    this.officeUpdateTick();
    setTimeout(() => this.schedule(), 200);
    return this.officeUpdateView();
  }
}
