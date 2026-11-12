import { describe, expect, it } from 'vitest';
import { autoReport, checkReport, closeTicket, emptyTickets, fileTicket, loadTickets, pruneTickets, TICKET_DUP_MS, TICKET_IDLE_MS, TICKET_WAKE_MS, ticketsView, waitingOn, wakeFor, type TicketsState } from './itTickets.ts';

const dennis = { id: 'a1', name: 'Dennis' };
const ada = { id: 'a2', name: 'Ada' };
const lost = { what: 'Lab result lost', where: 'lab' as const, evidence: 'lab_run job lab-7 never answered', blocking: true };

describe('it_report validation', () => {
  it('takes what, where, evidence and blocking, trimmed', () => {
    expect(checkReport({ what: '  Port 5644 taken ', where: 'ports', evidence: 'EADDRINUSE', blocking: false })).toEqual({ what: 'Port 5644 taken', where: 'ports', evidence: 'EADDRINUSE', blocking: false });
  });
  it('refuses a report IT could not act on', () => {
    expect(() => checkReport({ what: '', where: 'lab', evidence: 'x', blocking: true })).toThrow(/what/);
    expect(() => checkReport({ what: 'x', where: 'kitchen', evidence: 'x', blocking: true })).toThrow(/where is one of lab, preview/);
    expect(() => checkReport({ what: 'x', where: 'lab', evidence: '  ', blocking: true })).toThrow(/evidence/);
    expect(() => checkReport({ what: 'x', where: 'lab', evidence: 'x', blocking: 'yes' })).toThrow(/blocking/);
  });
  it('caps long text', () => {
    expect(checkReport({ ...lost, what: 'w'.repeat(500), evidence: 'e'.repeat(9000) })).toMatchObject({ what: 'w'.repeat(200), evidence: 'e'.repeat(2000) });
  });
});

describe('filing and de-duplication', () => {
  it('opens a ticket with the reporter waiting when it blocks them', () => {
    const s = emptyTickets();
    const { ticket, joined } = fileTicket(s, lost, dennis, 1000);
    expect(joined).toBe(false);
    expect(ticket).toMatchObject({ id: 1, status: 'open', count: 1, blocking: true, waiting: ['a1'], evidence: ['lab_run job lab-7 never answered'] });
    expect(ticket.by).toEqual([{ id: 'a1', name: 'Dennis', at: 1000 }]);
    expect(waitingOn(s.list, 'a1')).toBe(1);
  });
  it('joins the open ticket for the same what and where within the hour, raising its count', () => {
    const s = emptyTickets();
    fileTicket(s, lost, dennis, 0);
    const again = fileTicket(s, { ...lost, what: 'lab result LOST!', evidence: 'job lab-9', blocking: false }, ada, TICKET_DUP_MS - 1);
    expect(again.joined).toBe(true);
    expect(s.list).toHaveLength(1);
    expect(again.ticket).toMatchObject({ id: 1, count: 2, blocking: true, waiting: ['a1'] });
    expect(again.ticket.by.map((b) => b.name)).toEqual(['Dennis', 'Ada']);
    expect(again.ticket.evidence).toEqual(['lab_run job lab-7 never answered', 'job lab-9']);
  });
  it('opens a new ticket for another place, after an hour, or once the old one closed', () => {
    const s = emptyTickets();
    fileTicket(s, lost, dennis, 0);
    expect(fileTicket(s, { ...lost, where: 'preview' }, dennis, 10).joined).toBe(false);
    expect(fileTicket(s, lost, dennis, TICKET_DUP_MS + 5).joined).toBe(false);
    closeTicket(s, 3, 'fixed', TICKET_DUP_MS + 6);
    expect(fileTicket(s, lost, dennis, TICKET_DUP_MS + 7).ticket.id).toBe(4);
  });
});

describe('the wake rules', () => {
  it('wakes IT for a blocking ticket, at most once per 15 minutes', () => {
    const s = emptyTickets();
    const { ticket } = fileTicket(s, lost, dennis, 0);
    expect(wakeFor(ticket, 0)).toBe(true);
    ticket.wokeAt = 0;
    expect(wakeFor(ticket, TICKET_WAKE_MS - 1)).toBe(false);
    expect(wakeFor(ticket, TICKET_WAKE_MS)).toBe(true);
  });
  it('lets a single non-blocking report sleep, and wakes on a burst of the same one', () => {
    const s = emptyTickets();
    const quiet = { ...lost, blocking: false };
    const { ticket } = fileTicket(s, quiet, dennis, 0);
    expect(wakeFor(ticket, 0)).toBe(false);
    fileTicket(s, quiet, ada, 1);
    expect(wakeFor(ticket, 1)).toBe(false);
    fileTicket(s, quiet, dennis, 2);
    expect(wakeFor(ticket, 2)).toBe(true);
  });
  it('never wakes for a closed ticket', () => {
    const s = emptyTickets();
    const { ticket } = fileTicket(s, lost, dennis, 0);
    closeTicket(s, ticket.id, 'done', 1);
    expect(wakeFor(ticket, 2)).toBe(false);
  });
});

describe('closing', () => {
  it('ends a ticket with what was done, and nobody waits on it', () => {
    const s = emptyTickets();
    fileTicket(s, lost, dennis, 0);
    const t = closeTicket(s, 1, '  Told Dennis to run job lab-7 again. ', 60_000);
    expect(t).toMatchObject({ status: 'closed', resolution: 'Told Dennis to run job lab-7 again.', closedAt: 60_000, waiting: [] });
    expect(waitingOn(s.list, 'a1')).toBeNull();
  });
  it('refuses an unknown or closed ticket, or no resolution', () => {
    const s = emptyTickets();
    fileTicket(s, lost, dennis, 0);
    expect(() => closeTicket(s, 1, ' ', 1)).toThrow(/what was done/);
    expect(() => closeTicket(s, 9, 'x', 1)).toThrow(/No open ticket #9/);
    closeTicket(s, 1, 'x', 1);
    expect(() => closeTicket(s, 1, 'x', 2)).toThrow(/closed already/);
  });
  it('closes tickets idle for a day by itself, and keeps the list short', () => {
    const s: TicketsState = emptyTickets();
    fileTicket(s, lost, dennis, 0);
    for (let i = 0; i < 80; i++) closeTicket(s, fileTicket(s, { ...lost, where: 'other', what: `p${'x'.repeat(i)}` }, ada, 10 + i).ticket.id, 'ok', 20 + i);
    const closed = pruneTickets(s, TICKET_IDLE_MS + 1);
    expect(closed.map((t) => t.id)).toEqual([1]);
    expect(s.list.find((t) => t.id === 1)).toMatchObject({ status: 'closed', resolution: expect.stringMatching(/No answer from IT in a day/) });
    expect(s.list.length).toBeLessThanOrEqual(50);
  });
});

describe('automatic tickets', () => {
  it('turns what the office sees into non-blocking reports', () => {
    expect(autoReport({ kind: 'lab', agent: 'Dennis', job: 'lab-3', problem: 'oom', detail: 'npm test: exit code 137' })).toEqual({ what: 'Test lab: oom', where: 'lab', evidence: 'Dennis · job lab-3 · npm test: exit code 137', blocking: false });
    expect(autoReport({ kind: 'blocked', agent: 'Ada', state: 'sign-in', reason: 'login screen' })).toMatchObject({ what: 'A session is held on its sign-in screen', where: 'sign-in', blocking: false });
    expect(autoReport({ kind: 'blocked', agent: 'Ada', state: 'prompt', reason: 'a trust prompt' })).toMatchObject({ what: 'The watchdog found a stuck agent (prompt)', where: 'other', evidence: 'Ada: a trust prompt' });
    expect(autoReport({ kind: 'stalled', agent: 'Ada', work: 'PR #4', minutes: 25 })).toMatchObject({ what: 'The watchdog put stalled work back in line', where: 'other', evidence: 'Ada · PR #4 · quiet 25 min' });
    expect(autoReport({ kind: 'preview', floor: 2, error: 'EADDRINUSE :6302' })).toMatchObject({ what: "Floor 2's preview won't start", where: 'preview', evidence: 'EADDRINUSE :6302' });
    expect(autoReport({ kind: 'ci', repo: 'acme/app', reason: 'billing' })).toMatchObject({ what: "CI can't run", where: 'ci', evidence: 'acme/app: billing' });
    expect(autoReport({ kind: 'disk', title: 'Disk 95% full', body: '3 GB free' })).toMatchObject({ what: 'The disk is nearly full', where: 'disk', evidence: 'Disk 95% full: 3 GB free' });
  });
  it('joins repeats of the same lab problem into one ticket', () => {
    const s = emptyTickets();
    const office = { id: 'office', name: 'The office' };
    fileTicket(s, autoReport({ kind: 'lab', agent: 'Dennis', job: 'lab-3', problem: 'port', detail: 'x' }), office, 0, true);
    const { ticket } = fileTicket(s, autoReport({ kind: 'lab', agent: 'Ada', job: 'lab-4', problem: 'port', detail: 'y' }), office, 1, true);
    expect(ticket).toMatchObject({ count: 2, auto: true, waiting: [] });
    expect(ticket.by).toHaveLength(1);
  });
});

describe('the saved tickets', () => {
  it('keeps only well-formed ones', () => {
    const s = emptyTickets();
    fileTicket(s, lost, dennis, 0);
    expect(loadTickets(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(loadTickets({ seq: 'x', list: [{ id: 'bad' }, null] })).toEqual(emptyTickets());
    expect(loadTickets(undefined)).toEqual(emptyTickets());
  });
});

describe('the tabs\' copy', () => {
  it('names the first reporters and counts the rest, so a big company\'s outage stays small in every snapshot', () => {
    const s = emptyTickets();
    for (let i = 0; i < 30; i++) fileTicket(s, lost, { id: `a${i}`, name: `Agent ${i}` }, 1000 + i);
    const [t] = ticketsView(s.list);
    expect(t.by.map((b) => b.name)).toEqual(['Agent 0', 'Agent 1', 'Agent 2', 'Agent 3', 'Agent 4']);
    expect(t.byMore).toBe(25);
    expect(s.list[0].by).toHaveLength(30); // IT still tells every reporter
  });
  it('leaves a small ticket as it is', () => {
    const s = emptyTickets();
    fileTicket(s, lost, dennis, 1000);
    expect(ticketsView(s.list)).toEqual(s.list);
  });
});
