// The demo's improvement records (#543): six weeks of closed tickets, so Settings → The IT department → Improvements
// shows the trends: lab memory errors that stopped after an approved fix, a port clash that keeps coming back, a new
// preview problem, and two of IT's cards waiting for Approve / Not now.
import { causeKey, type ItImproveState, type ItRecord } from '../shared/itImprove.ts';

const H = 3_600_000;
const D = 24 * H;

/** Fills `s` for a fresh demo office; `floor` is its first floor and `fullName` that floor's repo. */
export function improveSample(s: ItImproveState, floor: { floor: number; fullName: string } | undefined, agents: { id: string; role: string }[], now: number) {
  const ids = agents.filter((a) => a.role !== 'ceo').map((a) => a.id);
  let id = 900;
  const rec = (where: ItRecord['where'], cause: string, daysAgo: number, o: Partial<ItRecord> = {}): ItRecord => {
    const at = now - daysAgo * D;
    return { id: ++id, cause, key: causeKey(where, cause), where, at, closedAt: at + 2 * H, reports: 1, agents: ids.slice(0, 1), minutes: 0, qaRounds: 0, usd: 0, fix: 'Looked at it and told the reporter.', ...o };
  };
  const oom = 'Test lab: oom';
  const port = 'Port taken for my dev server';
  const fixedAt = now - 15 * D;
  const list: ItRecord[] = [
    ...[40, 38, 33, 31, 29, 24, 22, 20, 17].map((d, i) => rec('lab', oom, d, { reports: 3, minutes: 12 + i, qaRounds: 1, usd: 0.8 + i / 10, fix: 'Lab runs ran out of memory; asked the CEO for a code fix.', auto: true, ...(i > 0 && { recurOf: id }) })),
    ...[34, 19, 9, 4, 1].map((d, i) => rec('ports', port, d, { minutes: 25 + i * 5, usd: 0.4, fix: "A leftover dev server held the port; it stopped with that session.", ...(i > 0 && { recurOf: id }) })),
    rec('preview', "Floor 1's preview won't start", 2, { auto: true, fix: "npm install hadn't finished; it started on the next try." }),
    rec('sign-in', 'A session is held on its sign-in screen', 12, { minutes: 8, usd: 0.3, auto: true, fix: 'The account was signed in again.' }),
  ];
  const oomKey = causeKey('lab', oom);
  s.changes = floor ? [{ id: 'i-demo-1', key: oomKey, cause: oom, kind: 'issue', title: 'Test lab: run the suite with 2 workers', at: fixedAt, floor: floor.floor, issue: 41, url: `https://github.com/${floor.fullName}/issues/41` }] : [];
  s.records = list.map((r) => (r.key === oomKey && s.changes.length ? { ...r, change: 'i-demo-1' } : r)).sort((a, b) => b.at - a.at);
  s.cards = floor
    ? [
        { id: 'i-demo-2', key: causeKey('ports', port), cause: port, status: 'recurring', kind: 'issue', title: 'Stop leftover dev servers before a session starts', why: '5 tickets in 5 weeks, 2.6 h of agent time blocked, $2.00 wasted; it came back after every fix.', floor: floor.floor, body: 'What: a dev server left by an earlier session holds the port, so the next session cannot start its own.\nWhere: server/procSweep.ts (the sweep before a session starts).\nAcceptance: a session finds its port free; a test covers a leftover on the port.', at: now - 3 * H, by: 'Iris' },
        { id: 'i-demo-3', key: causeKey('sign-in', 'A session is held on its sign-in screen'), cause: 'A session is held on its sign-in screen', status: 'new', kind: 'office_playbook', title: 'Report a sign-in screen at once', why: '1 ticket, 8 agent-minutes blocked.', line: 'A sign-in screen in your session: it_report it as blocking, never wait on it.', at: now - 3 * H, by: 'Iris' },
      ]
    : [];
  s.reviewedAt = now - 3 * H;
}
