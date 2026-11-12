// IT tickets (#542): office problems reported to the IT department. Agents and the CEO report with it_report; the
// office files its own (lab errors, stuck agents and sign-in screens, stalled work, previews that won't start, CI
// outages, a full disk) through autoTicket. No model call per report: IT is woken only for a blocking ticket or a
// burst, at most once per ticket per 15 minutes, and answers with it_ticket (tell the reporters, ask the CEO for a code
// fix, close with what was done). An agent blocked on a ticket shows "Waiting on IT #N". Rules in shared/itTickets.ts.
import { autoReport, checkReport, closeTicket, fileTicket, loadTickets, pruneTickets, ticketBrief, waitingOn, wakeFor, type ItTicket, type OfficeTrouble } from '../../shared/itTickets.ts';
import type { AgentView, WorldSnapshot } from '../../shared/types.ts';
import type { ItTicketArgs } from '../ceoItTools.ts';
import { ticketSample } from '../itTicketSample.ts';
import type { PersistedAgent, PersistedRepo } from './model.ts';
import { SwarmItDept } from './itDept.ts';

const OFFICE = { id: 'office', name: 'The office' };

export abstract class SwarmItTickets extends SwarmItDept {
  /** Agents who ever waited on a ticket: their view always carries itWait then, as a patch can't drop a field. */
  private waitedOnIt = new Set<string>();
  /** Floor → its preview's error already ticketed, so each new failure is filed once. */
  private previewFailed = new Map<string, string>();

  /** The saved tickets, from the state file (shared/itTickets.ts loadTickets). */
  protected loadTickets(raw: unknown) {
    return loadTickets(raw);
  }

  /** A fresh demo office gets a few sample tickets once its team is hired (init hires it after the usage readings start). */
  protected override async startUsage() {
    if (this.backend.demo) {
      setTimeout(() => {
        if (this.state.itTickets.list.length) return;
        this.state.itTickets = ticketSample(this.state.agents, Date.now());
        this.ticketsChanged();
      }, 3000).unref();
    }
    await super.startUsage();
  }

  protected override agentView(a: PersistedAgent, withLog: boolean): AgentView {
    const v = super.agentView(a, withLog);
    const wait = waitingOn(this.state.itTickets.list, a.id);
    if (wait !== null) this.waitedOnIt.add(a.id);
    return this.waitedOnIt.has(a.id) ? { ...v, itWait: wait } : v;
  }

  /** A floor changed: a preview that didn't start or crashed is the office's ticket (previews.ts sets its error). */
  protected override emitRepo(r: PersistedRepo) {
    super.emitRepo(r);
    const v = this.previews.view(r);
    const error = v.status === 'error' ? (v.error ?? 'no reason given') : null;
    if (error && this.previewFailed.get(r.id) !== error) this.autoTicket({ kind: 'preview', floor: r.floor, error: error.slice(0, 500) });
    if (error) this.previewFailed.set(r.id, error);
    else this.previewFailed.delete(r.id);
  }

  /** Left out while there are none: every tab's snapshot pays for it (scale.test.ts). */
  override snapshot(): WorldSnapshot {
    const list = this.state.itTickets.list;
    return list.length ? { ...super.snapshot(), itTickets: list } : super.snapshot();
  }

  /** The tickets changed: saved, every tab hears, and the cards of the agents waiting (or no longer waiting) update. */
  private ticketsChanged(agentIds: string[] = []) {
    this.save();
    this.broadcast({ type: 'itTickets', tickets: this.state.itTickets.list });
    for (const id of new Set(agentIds)) {
      const a = this.state.agents.find((x) => x.id === id);
      if (a) this.emitAgent(a);
    }
  }

  /** A ticket was filed or joined: IT wakes when wakeFor says so, with the ticket's brief. */
  private ticketFiled(t: ItTicket, now: number, closed: ItTicket[]) {
    if (this.state.settings.itDept.on && wakeFor(t, now)) {
      t.wokeAt = now;
      this.postIt('office', `🎫 Ticket #${t.id} (${t.where}${t.blocking ? ', blocking' : ''}, ${t.count}×, from ${t.by.map((b) => b.name).join(', ')}): ${t.what}`, { notice: { details: t.evidence.join('\n') } });
      this.enqueueIt({ kind: 'ticket', id: t.id, text: ticketBrief(t), at: now });
    }
    this.ticketsChanged([...t.waiting, ...closed.flatMap((c) => c.by.map((b) => b.id))]);
  }

  /** it_report: a ticket number at once, and what to do meanwhile. `who`: the agent, or the CEO. */
  protected itReport(raw: unknown, who: { id: string; name: string }): string {
    const r = checkReport(raw);
    const now = Date.now();
    const s = this.state.settings.itDept;
    const closed = pruneTickets(this.state.itTickets, now);
    const { ticket, joined } = fileTicket(this.state.itTickets, r, who, now);
    if (!s.on) ticket.waiting = ticket.waiting.filter((id) => id !== who.id); // nobody waits on a department that's off
    this.ticketFiled(ticket, now, closed);
    const head = joined ? `Joined open ticket #${ticket.id} (${ticket.count} reports).` : `Opened ticket #${ticket.id}.`;
    if (!s.on) return `${head} The IT department is off, so nobody looks at it: work around it if you can, and say so in your PR.`;
    if (r.blocking) return `${head} ${s.name} (IT) looks now and messages you what to do. Carry on with anything that doesn't need it meanwhile; don't retry it in a loop.`;
    return `${head} Noted: carry on. ${s.name} (IT) looks if it repeats; report it as blocking if it stops you.`;
  }

  /** What the office saw by itself (shared/itTickets.ts autoReport): a non-blocking ticket, or a repeat of one. */
  protected autoTicket(e: OfficeTrouble) {
    const now = Date.now();
    const closed = pruneTickets(this.state.itTickets, now);
    this.ticketFiled(fileTicket(this.state.itTickets, autoReport(e), OFFICE, now, true).ticket, now, closed);
  }

  /** it_ticket: IT tells the reporters, asks the CEO for a code fix and/or closes the ticket. */
  protected async itTicket(a: ItTicketArgs): Promise<string> {
    const t = this.state.itTickets.list.find((x) => x.id === a.id);
    if (!t) throw new Error(`No ticket #${a.id}: it_health lists the open ones.`);
    if (t.status === 'closed') throw new Error(`Ticket #${a.id} is closed already: ${t.resolution ?? ''}`.trim());
    const tell = a.tell?.trim(), close = a.close?.trim(), fix = a.code_fix?.trim();
    if (!tell && !close && !fix) throw new Error('Give tell, close or code_fix.');
    const name = this.itName;
    const done: string[] = [];
    // A close without tell still reaches the agents waiting on it, so they know to carry on.
    const words = tell ?? (close ? `Ticket #${t.id} is closed: ${close}` : '');
    if (words) {
      for (const b of t.by) {
        if (b.id === 'office') continue;
        if (b.id === 'ceo') {
          this.ceoTold.push(`${name} (IT) on your ticket #${t.id}: ${words}`);
          done.push(`told ${b.name}`);
          continue;
        }
        if (!this.state.agents.some((x) => x.id === b.id)) continue;
        try {
          await this.message(b.id, `IT ticket #${t.id}: ${words}`, false, `${name} (IT)`);
          done.push(`told ${b.name}`);
        } catch (err) {
          done.push(`couldn't reach ${b.name} (${(err as Error).message})`);
        }
      }
    }
    if (fix) {
      this.ceoTold.push(`${name} (IT) asks for a code fix (ticket #${t.id}, ${t.what}): ${fix}`);
      done.push('asked the CEO for a code fix');
    }
    const waiting = [...t.waiting];
    if (close) {
      closeTicket(this.state.itTickets, t.id, close, Date.now());
      this.postIt('office', `✅ Ticket #${t.id} closed: ${close}`);
      done.push('closed it');
    }
    this.ticketsChanged(waiting);
    return `Ticket #${t.id}: ${done.join(', ') || 'nothing to do'}.`;
  }
}
