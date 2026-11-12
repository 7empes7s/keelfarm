// The demo's IT tickets (#542): a fresh demo office's list, so Settings → The IT department shows open and closed ones,
// repeats and a time to fix. Live ones come from the demo's agents (demo/itDesk.ts withItReport).
import { autoReport, closeTicket, fileTicket, type TicketsState } from '../shared/itTickets.ts';

const MIN = 60_000;

/** Only a fresh demo office of the usual size gets the sample: the big company (--floors) would carry it in every
 *  snapshot, over server/scale.test.ts' budget. */
export function wantsTicketSample(demo: boolean, floors: number, tickets: number) {
  return demo && floors <= 3 && tickets === 0;
}

/** Files the sample into `s`, beside any ticket the demo's own troubles filed already (its CI outage). */
export function ticketSample(s: TicketsState, agents: { id: string; name: string; role: string }[], now: number) {
  const [a, b] = agents.filter((x) => x.role !== 'ceo');
  if (!a) return;
  const office = { id: 'office', name: 'The office' };
  const port = fileTicket(s, { what: 'Port taken for my dev server', where: 'ports', evidence: 'Error: listen EADDRINUSE: address already in use :::5644', blocking: true }, a, now - 190 * MIN).ticket;
  closeTicket(s, port.id, `A leftover dev server from ${a.name}'s last session held the port; it stopped with that session. Told ${a.name} to start theirs again.`, now - 184 * MIN);
  const oom = autoReport({ kind: 'lab', agent: (b ?? a).name, job: 'mf2k1', problem: 'oom', detail: 'npm test: exit code 137' });
  for (const [i, at] of [125, 98, 71].entries()) fileTicket(s, { ...oom, evidence: `${oom.evidence} (${i + 1})` }, office, now - at * MIN, true);
  closeTicket(s, s.list.find((t) => t.what === oom.what)!.id, 'Three lab runs ran out of memory: asked the CEO for a code fix (the lab runs the suite with 2 workers).', now - 60 * MIN);
  fileTicket(s, autoReport({ kind: 'preview', floor: 1, error: "sh: 1: vite: not found (npm install hadn't finished)" }), office, now - 12 * MIN, true);
  s.list.sort((x, y) => y.id - x.id);
}
