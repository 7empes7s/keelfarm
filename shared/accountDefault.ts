// Make default, Switch now and task stickiness (#390, docs/accounts.md), pure: a build or fix task keeps the account its
// first session started on while that one is usable, so a new default only takes new tasks; Switch now moves open
// tasks too, at their next session. Plus the words the chat and Mission control show.
import type { AccountCli, AccountStatus, ProviderAccount, TasksLeft } from './types.ts';

/** The account a task's sessions run on; `move`: Switch now, its next session starts fresh on the rotation's pick. */
interface TaskAccount {
  account: string;
  move?: boolean;
}
export type TaskAccounts = Record<string, TaskAccount>;

/** A build or fix task's key: its floor and issue (else its PR). null for QA (a fresh session each round), the CEO or no task. */
export function taskKey(a: { role: string; repoId: string; task: string | null; issueNumber: number | null; prNumber: number | null }): string | null {
  if (a.role === 'ceo' || (a.task !== 'issue' && a.task !== 'fix')) return null;
  if (a.issueNumber) return `${a.repoId}#${a.issueNumber}`;
  return a.prNumber ? `${a.repoId}!${a.prNumber}` : null;
}

/** Only the records of tasks still open (an agent on it, or its PR in QA). */
export function pruneTaskAccounts(records: TaskAccounts, open: ReadonlySet<string>): TaskAccounts {
  return Object.fromEntries(Object.entries(records).filter(([k]) => open.has(k)));
}

const byPriority = (a: ProviderAccount, b: ProviderAccount) => a.priority - b.priority;

/** The accounts with `id` first among its coding agent's, priorities renumbered 0, 1, 2… */
export function makeDefault(accounts: readonly ProviderAccount[], id: string): ProviderAccount[] {
  const a = accounts.find((x) => x.id === id);
  if (!a) return [...accounts];
  const mine = accounts.filter((x) => x.cli === a.cli && x.id !== id).sort(byPriority);
  const prio = new Map([a, ...mine].map((x, i) => [x.id, i]));
  return accounts.map((x) => (prio.has(x.id) ? { ...x, priority: prio.get(x.id)! } : x));
}

/** A coding agent's default: its first enabled account by priority. */
export const defaultAccount = <T extends ProviderAccount>(accounts: readonly T[], cli: AccountCli): T | null => [...accounts].filter((a) => a.cli === cli && a.enabled && !a.removing).sort(byPriority)[0] ?? null;

/** Switch now: every open task on another account of `id`'s coding agent moves at its next session. */
export function switchNow(records: TaskAccounts, accounts: readonly ProviderAccount[], id: string): TaskAccounts {
  const cli = accounts.find((a) => a.id === id)?.cli;
  const others = new Set(accounts.filter((a) => a.cli === cli && a.id !== id).map((a) => a.id));
  return Object.fromEntries(Object.entries(records).map(([k, r]) => [k, others.has(r.account) ? { ...r, move: true } : r]));
}

/**
 * Tasks running now on another account of `cli` than its default, by account, most first; none while the default
 * itself is out (they're on the fallback, not switching).
 */
export function tasksLeft(running: readonly string[], accounts: readonly (ProviderAccount & { status?: AccountStatus })[], cli: AccountCli): TasksLeft[] {
  const def = defaultAccount(accounts, cli);
  if (!def || (def.status && def.status !== 'ready' && def.status !== 'near')) return [];
  const counts = new Map<string, number>();
  for (const id of running) counts.set(id, (counts.get(id) ?? 0) + 1);
  return accounts
    .filter((a) => a.cli === cli && a.id !== def.id && counts.has(a.id))
    .map((a) => ({ id: a.id, label: a.label, count: counts.get(a.id)! }))
    .sort((x, y) => y.count - x.count);
}

const tasks = (n: number) => `${n} task${n === 1 ? '' : 's'}`;
const agents = (n: number) => `${n} agent${n === 1 ? '' : 's'}`;
const onList = (left: readonly TasksLeft[]) => left.map((l) => l.label).join(' and ');

/** The chat line after Make default: "Ultra is the default now: new tasks start on it; 3 agents finish their current task on Pro first." */
export function defaultText(label: string, left: readonly TasksLeft[], now: boolean): string {
  const n = left.reduce((s, l) => s + l.count, 0);
  const head = `${label} is the default now: new tasks start on it`;
  if (!n) return `${head}.`;
  if (now) return `${head}; ${agents(n)} on ${onList(left)} move to it at their next session.`;
  return `${head}; ${agents(n)} finish${n === 1 ? 'es' : ''} their current task on ${onList(left)} first.`;
}

/** Mission control's line while open tasks finish elsewhere: "switching: 3 tasks left on Pro". */
export const switchingText = (left: readonly TasksLeft[]) => `switching: ${left.map((l) => `${tasks(l.count)} left on ${l.label}`).join(', ')}`;

/** The chat line when a default that was out is back. */
export const backText = (label: string) => `${label} is back: new tasks start on it again.`;

/**
 * The defaults that are back: a coding agent's default that was out at the last look (`wasOut`, its id) and is free
 * now. Returns them and the ids out now, for the next look.
 */
export function defaultsBack(wasOut: ReadonlySet<string>, accounts: readonly (ProviderAccount & { status: AccountStatus })[], clis: readonly AccountCli[]): { back: ProviderAccount[]; out: Set<string> } {
  const back: ProviderAccount[] = [];
  const out = new Set<string>();
  for (const cli of clis) {
    const def = defaultAccount(accounts, cli);
    if (!def || accounts.filter((a) => a.cli === cli && a.enabled && !a.removing).length < 2) continue; // one account: the office's pause says it
    if (def.status === 'limited' || def.status === 'signed-out') out.add(def.id);
    else if (wasOut.has(def.id)) back.push(def);
  }
  return { back, out };
}
