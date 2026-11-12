import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Persisted, AgentRuntime, RepoRuntime } from './swarm/model.ts';
import type { NoticeInput } from '../shared/notices.ts';
import type { WorldSnapshot } from '../shared/types.ts';

// What a big office costs the people using it (#595), instead of a fixed byte budget that flapped by OS: offices of
// 2, 5, 10 and 20 floors (6 agents, 50 issues, 30 PRs, 10 QA records and 50 chat messages a floor) are cloned from a
// booted demo office's real records, the same counts every run. Their snapshot must grow linearly, build and apply in
// time linear with the office (compared within the run, so a slow runner doesn't fail them) and under a generous 150 ms
// at 10 floors, and keep every history list within its cap.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-snapscale-'));
process.env.SWARM_HOME = home;
vi.mock('../client/src/ui/sfx', () => ({ alarm: vi.fn(), audioUnlocked: () => false, chirp: vi.fn(), cue: vi.fn() }));
vi.mock('../client/src/world/gongRunner', () => ({ gongForMerge: vi.fn(() => 'solo') }));
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
const { pastChat } = await import('./chatSample.ts');
const { packCareers } = await import('../shared/careers.ts');
const { CHAT_PAGE } = await import('../shared/chatPage.ts');
const { NOTICES_KEEP } = await import('../shared/notices.ts');
const { recordChange } = await import('../shared/managerChanges.ts');
const { pruneProblems, recordProblem, resolveProblems } = await import('../shared/problems.ts');
const { closeTicket, fileTicket, pruneTickets } = await import('../shared/itTickets.ts');
const { normalisedBytes, normalisedJson } = await import('../shared/snapshotSize.ts');
const { useStore } = await import('../client/src/store');

type Office = InstanceType<typeof Swarm>;
type Internals = { state: Persisted; repoRt: Map<string, RepoRuntime>; agentRt: Map<string, AgentRuntime>; notice(input: NoticeInput): void; save(): void };
const inside = (s: Office) => s as unknown as Internals;

const PER_FLOOR = { agents: 6, issues: 50, pulls: 30, qa: 10, chat: 50 };
const ROOTS = [home, os.homedir(), os.tmpdir()];
const DAY = 86_400_000;

let tpl: Internals;
let now: number;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
  const demo = new Swarm(createDemoBackend());
  const init = demo.init();
  await vi.advanceTimersByTimeAsync(5_000);
  await init;
  await vi.advanceTimersByTimeAsync(2 * 60_000); // PRs opened, tested and merged: every kind of record to copy
  now = Date.now();
  vi.useRealTimers(); // its timers were fake: it stays as it is from here
  tpl = inside(demo);
}, 120_000);

afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const nth = <T>(list: readonly T[], i: number): T => copy(list[i % list.length]);

/** An office of `floors` floors made of the demo's own records, the same every run. Not started: only its views are used. */
function office(floors: number): Office {
  const swarm = new Swarm(createDemoBackend());
  const o = inside(swarm);
  o.save = () => undefined;
  const repos = tpl.state.repos, people = tpl.state.agents.filter((a) => a.role !== 'ceo');
  const rt0 = tpl.repoRt.get(repos[0].id)!;
  const issues = [...tpl.repoRt.values()].flatMap((r) => r.issues), pulls = [...tpl.repoRt.values()].flatMap((r) => r.pulls);
  expect(issues.length * pulls.length * people.length * tpl.state.qa.length, 'the demo office had no issues, PRs, agents or QA records to copy').toBeGreaterThan(0);
  Object.assign(o.state, { ...copy(tpl.state), repos: [], qa: [], notices: [], agents: copy(tpl.state.agents.filter((a) => a.role === 'ceo')) });
  for (const a of o.state.agents) o.agentRt.set(a.id, { ...tpl.agentRt.get(a.id)!, log: [] });
  for (let f = 0; f < floors; f++) {
    const id = `scale-co/product-${f + 1}`;
    o.state.repos.push({ ...copy(repos[f % repos.length]), id, fullName: id, floor: f + 1, url: `https://github.com/${id}` });
    o.repoRt.set(id, {
      ...rt0,
      issues: Array.from({ length: PER_FLOOR.issues }, (_, n) => ({ ...nth(issues, n), number: n + 1 })),
      pulls: Array.from({ length: PER_FLOOR.pulls }, (_, n) => ({ ...nth(pulls, n), number: 1000 + n, headRefName: `swarm/issue-${n + 1}-p${f}` })),
    });
    for (let n = 0; n < PER_FLOOR.agents; n++) {
      const a = { ...nth(people, n), id: `p${f}-${n}`, repoId: id, desk: n };
      o.state.agents.push(a);
      o.agentRt.set(a.id, { log: [], session: null, currentTool: null, browserUrl: null, screenshot: null, shots: [], terminal: null });
    }
    for (let n = 0; n < PER_FLOOR.qa; n++) o.state.qa.push({ ...nth(tpl.state.qa, n), repoId: id, prNumber: 1000 + n });
  }
  o.state.messages = pastChat(now, PER_FLOOR.chat * floors);
  return swarm;
}

/** What a tab is sent on connect (core.ts addClient). */
const snapshotOf = (s: Office) => packCareers(s.snapshot());
const bytes = (s: Office) => normalisedBytes(snapshotOf(s), ROOTS);

/** The median and p95 of each of `fns`' timings, run in turns so a busy machine slows them alike; each timing is `reps` calls. */
function timed(fns: (() => void)[], reps = 1, runs = 20) {
  const once = (fn: () => void) => {
    const start = performance.now();
    for (let i = 0; i < reps; i++) fn();
    return (performance.now() - start) / reps;
  };
  for (const fn of fns) for (let i = 0; i < 3; i++) once(fn); // warm-up
  const times = fns.map(() => [] as number[]);
  for (let r = 0; r < runs; r++) fns.forEach((fn, i) => times[i].push(once(fn)));
  return times.map((t) => t.sort((a, b) => a - b)).map((t) => ({ median: t[Math.floor(runs / 2)], p95: t[Math.ceil(runs * 0.95) - 1] }));
}

const ms = (n: number) => `${n.toFixed(2)} ms`;
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

describe("a big office's snapshot", () => {
  let small: Office, mid: Office, big: Office, huge: Office;
  beforeAll(() => {
    [small, mid, big, huge] = [office(2), office(5), office(10), office(20)];
  });

  it('is the office it says: 10 floors, 60 agents, 500 issues, 300 PRs, 100 QA records', () => {
    const s = big.snapshot();
    expect(s.repos).toHaveLength(10);
    expect(s.agents.filter((a) => a.role !== 'ceo')).toHaveLength(60);
    expect(s.repos.flatMap((r) => r.issues)).toHaveLength(500);
    expect(s.repos.flatMap((r) => r.pulls)).toHaveLength(300);
    expect(s.qa).toHaveLength(100);
  });

  it('grows at most linearly with the office', () => {
    const [a, b, c] = [bytes(small), bytes(mid), bytes(big)];
    // What each floor adds, from 2 to 5 floors and from 5 to 10: the same for a linear snapshot (what doesn't grow cancels
    // out), about twice as much for a quadratic one. 1.25 leaves room for longer ids.
    const first = (b - a) / 3, second = (c - b) / 5;
    expect(second / first, `the snapshot grows faster than the office: each floor added ${kb(first)} from 2 to 5 floors but ${kb(second)} from 5 to 10; something in it is sent per pair of entities (e.g. every floor's PRs inside each floor)`).toBeLessThan(1.25);
  });

  // Four times the office (5 floors to 20): at most four times the time when it's linear (less, as some of it doesn't
  // grow), sixteen when it's quadratic. 6 leaves room for a busy machine.
  it('builds fast, and in time linear with the office', () => {
    const [m, b, h] = timed([() => JSON.stringify(snapshotOf(mid)), () => JSON.stringify(snapshotOf(big)), () => JSON.stringify(snapshotOf(huge))]);
    expect(h.median / m.median, `building the snapshot is slower than linear: ${ms(m.median)} at 5 floors, ${ms(h.median)} at 20 (a loop over every entity inside a loop over every entity?)`).toBeLessThan(6);
    expect(b.p95, `building a 10-floor office's snapshot takes ${ms(b.p95)} (p95), past 150 ms`).toBeLessThan(150);
  });

  it("is applied by a tab's store in time linear with the office", () => {
    const apply = (s: Office) => {
      const ev = JSON.parse(JSON.stringify({ type: 'snapshot', data: snapshotOf(s) })) as { type: 'snapshot'; data: WorldSnapshot };
      return () => {
        useStore.setState({ loaded: false });
        useStore.getState().apply(ev);
      };
    };
    const [m, b, h] = timed([apply(mid), apply(big), apply(huge)], 100); // well under a millisecond each: 100 to a timing, so noise doesn't decide
    expect(useStore.getState().repos).toHaveLength(20);
    expect(h.median / m.median, `the store applies a snapshot slower than linearly: ${ms(m.median)} at 5 floors, ${ms(h.median)} at 20`).toBeLessThan(4.5); // less grows here than in the build: about 2.2 when linear
    expect(b.p95, `the store takes ${ms(b.p95)} (p95) to apply a 10-floor office's snapshot, past 150 ms`).toBeLessThan(150);
  });
});

describe("the snapshot's history lists stay within their caps however long the office runs", () => {
  const capped = (what: string, count: number, cap: number) => expect(count, `${what} isn't capped: ${count.toLocaleString('en')} in the snapshot (cap ${cap})`).toBeLessThanOrEqual(cap);

  it('the chat: its latest page', () => {
    const s = office(1);
    inside(s).state.messages = pastChat(now, 5_000);
    capped('chat history', s.snapshot().messages.length, CHAT_PAGE);
  });

  it('notifications', () => {
    const s = office(1);
    for (let i = 0; i < 1_000; i++) inside(s).notice({ kind: 'merge', title: `Notice ${i}`, text: 'Something happened.' });
    capped('the notification centre', s.snapshot().notices.length, NOTICES_KEEP);
  });

  it("the manager's changes", () => {
    const s = office(1);
    const changes = inside(s).state.ceo.changes;
    for (let i = 0; i < 1_000; i++) recordChange(changes, { id: `c${i}`, at: now + i, kind: 'close-issue', repoId: 'scale-co/product-1', floor: 1, issue: i, pr: null, detail: `closed #${i}`, affects: [], told: false, verdict: null }, now + i);
    capped("the manager's changes", s.snapshot().managerChanges?.length ?? 0, 100);
  });

  it('resolved problems', () => {
    const s = office(1);
    const p = inside(s).state.problems;
    for (let i = 0; i < 1_000; i++) {
      recordProblem(p, { kind: 'work', cause: 'qa-3x', title: `Problem ${i}`, floor: 1, repoId: 'scale-co/product-1', pr: i, issue: null, agentId: null, owner: 'ceo', key: `k${i}` }, now + i);
      resolveProblems(p, (x) => x.key === `k${i}`, 'Fixed.', now + i);
      pruneProblems(p, now + i);
    }
    capped('resolved problems', s.snapshot().problems?.length ?? 0, 80);
  });

  it("closed IT tickets, and an outage's reporters", () => {
    const s = office(1);
    const t = inside(s).state.itTickets;
    for (let i = 0; i < 1_000; i++) {
      const at = now + i * DAY; // a day apart: each its own ticket
      const { ticket } = fileTicket(t, { what: `Disk full ${i}`, where: 'disk', evidence: 'df', blocking: false }, { id: 'office', name: 'The office' }, at);
      closeTicket(t, ticket.id, 'Cleaned up.', at);
      pruneTickets(t, at); // as the next report does
    }
    const outage = fileTicket(t, { what: 'GitHub is down', where: 'network', evidence: 'gh: 503', blocking: true }, { id: 'p0-0', name: 'Ada' }, now).ticket;
    for (let i = 0; i < 500; i++) fileTicket(t, { what: 'GitHub is down', where: 'network', evidence: 'gh: 503', blocking: true }, { id: `x${i}`, name: `Agent ${i}` }, now);
    const shown = s.snapshot().itTickets ?? [];
    capped('closed IT tickets', shown.filter((x) => x.status === 'closed').length, 50);
    capped("an IT ticket's reporters", shown.find((x) => x.id === outage.id)?.by.length ?? 0, 10);
  });
});

describe('sizes measured the same on every OS', () => {
  it("counts Windows' CRLF, backslash paths and longer folders as their POSIX forms", () => {
    const posix = { machinesRoot: '/tmp/cubefarm-x/machines', projectsDir: '/home/runner/Projects', log: 'one\ntwo', cmd: 'cd /tmp/cubefarm-x/machines/m1 && npm test' };
    const windows = { machinesRoot: 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\cubefarm-x\\machines', projectsDir: 'C:\\Users\\runneradmin\\Projects', log: 'one\r\ntwo', cmd: 'cd C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\cubefarm-x\\machines\\m1 && npm test' };
    const a = normalisedJson(posix, ['/tmp/cubefarm-x', '/home/runner', '/tmp']);
    const b = normalisedJson(windows, ['C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\cubefarm-x', 'C:\\Users\\runneradmin', 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp']);
    expect(b).toBe(a);
    expect(normalisedBytes(windows, ['C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\cubefarm-x', 'C:\\Users\\runneradmin'])).toBe(normalisedBytes(posix, ['/tmp/cubefarm-x', '/home/runner']));
  });

  it('leaves the rest of a string alone', () => {
    expect(normalisedJson({ t: 'PR #12: 3 files, 40 lines' })).toBe('{"t":"PR #12: 3 files, 40 lines"}');
  });
});
