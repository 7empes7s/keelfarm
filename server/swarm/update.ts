// The office's own update: draining, the hand-over to the launcher, the result after a restart.
import { HttpError } from '../httpError.ts';
import { drainDecision, lastUpdateMessage, POSTPONE_MS, type DrainInput, type LastUpdate } from '../officeUpdate.ts';
import type { OfficeUpdateView } from '../../shared/types.ts';
import { BUSY, oneLine } from './model.ts';
import { SwarmScheduling } from './scheduling.ts';

export abstract class SwarmUpdate extends SwarmScheduling {
  // ---------- the office's own update ----------

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
      running: this.running() - this.inBoxes().length, // cloud agents carry on in their Boxes through the restart
    };
  }

  protected officeUpdateView(): OfficeUpdateView {
    const u = this.officeUpdate;
    const input = this.drainInput();
    const d = drainDecision(input);
    const until = u.postponedUntil ? new Date(u.postponedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const detail = d.state === 'failed' ? u.failed : d.state === 'waiting' ? `Postponed until ${until}, or until a newer commit lands.` : null;
    return { state: d.state, behind: input.behind, launcher: input.launcher, drainingSince: u.drainingSince ?? d.drainingSince, running: input.running, detail };
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
    u.behind = behind;
    if (behind === 0) Object.assign(u, { requested: false, failed: null, failedBehind: null });
    this.officeUpdateTick();
  }

  /**
   * Take the office's own update one step (see drainDecision): drain, and once nothing is running, or the drain timed
   * out, hand it to the launcher. True while nothing new may start.
   */
  protected officeUpdateTick(): boolean {
    if (!this.officeHead) return false;
    const u = this.officeUpdate;
    const d = drainDecision(this.drainInput());
    if (d.state === 'draining' && u.drainingSince === null) {
      const running = this.running();
      this.postMessage(
        'office',
        `⬆️ Updating the office (${u.behind} new commit${u.behind === 1 ? '' : 's'}). Nothing new starts, though the CEO still answers you${running ? ` while ${running} running session${running === 1 ? '' : 's'} finish` : ''}; then it installs and restarts.`,
      );
    }
    u.drainingSince = d.drainingSince;
    if (d.send) void this.handOver(d.timedOut);
    this.emitOfficeUpdate();
    return d.state === 'draining' || d.state === 'updating';
  }

  /** Drained: hand the update to the launcher. Sessions still running after the timeout stop the way a restart stops them. */
  protected async handOver(timedOut: boolean) {
    const u = this.officeUpdate;
    const from = this.officeHead!;
    u.sent = true;
    // Cloud agents working in their Boxes carry on through the restart: the restarted office picks them up.
    const busy = this.state.agents.filter((a) => BUSY.includes(a.status) && !this.inBoxes().includes(a));
    if (timedOut) this.postMessage('office', `⏱ ${busy.length} session${busy.length === 1 ? ' was' : 's were'} still running after 20 minutes. Stopped; the work goes back to the queue after the update.`);
    this.emitOfficeUpdate();
    u.handedOver = true;
    await this.writeState().catch((err) => console.warn('could not save the state', err)); // still "working": the restarted office recovers them
    for (const a of busy) this.agentRt.get(a.id)?.session?.stop();
    try {
      const result = await this.backend.office.update(from);
      if (result) await this.afterUpdate(result); // the demo: nothing restarts
    } catch (err) {
      await this.afterUpdate({ from, to: from, ok: false, error: `the launcher didn't take the update: ${oneLine(err)}`, installed: false, built: false, at: Date.now() });
    }
  }

  /** An update that didn't restart the office (the demo, or a failed hand-over): recover like a restart would, then report it. */
  protected async afterUpdate(result: LastUpdate) {
    const u = this.officeUpdate;
    Object.assign(u, { sent: false, handedOver: false, requested: false, drainingSince: null });
    const interrupted = this.state.agents.filter((a) => BUSY.includes(a.status) && !this.inBoxes().includes(a));
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
