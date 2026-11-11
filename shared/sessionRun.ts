// Which account, coding agent and model a session really runs on (#376): the account it started on, which since
// rotation (#357) may not be its pin, said apart from the pin, and the chip agent cards, the CEO's threads and the
// "Who runs on what" card draw. Pure.
import { modelLabel } from './models.ts';
import type { AccountStatus, AgentCli, EffortLevel, ProviderAccount, SessionRun } from './types.ts';

const ROTATION = 'rotation';
export const CLI_NAMES: Record<AgentCli, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', gemini: 'Gemini CLI' };
const WHY: Partial<Record<AccountStatus, string>> = { limited: 'limited', 'signed-out': 'signed out', paused: 'paused', near: 'near its limit' };

type Account = Pick<ProviderAccount, 'id' | 'label' | 'tags'> & { status?: AccountStatus };

/**
 * A session that started on account `id` (null: on none of the registry's, `instead` says what), for an agent pinned to
 * `pin` (an account id or tag; absent or 'rotation': the rotation). When it isn't on its pin, it says the pin and why.
 */
export function sessionRun(pin: string | undefined, id: string | null, accounts: readonly Account[], s: { cli: AgentCli; model: string; effort: EffortLevel | ''; at: number; instead?: string }): SessionRun {
  const on = id ? accounts.find((a) => a.id === id) : undefined;
  const run: SessionRun = { account: id ?? '', label: on?.label ?? (id || s.instead || `${CLI_NAMES[s.cli]}'s own login`), cli: s.cli, model: s.model, effort: s.effort, at: s.at };
  const p = (pin ?? '').trim().toLowerCase();
  if (!p || p === ROTATION || p === id || on?.tags.includes(p)) return run;
  const pinned = accounts.find((a) => a.id === p);
  const why = pinned?.status && WHY[pinned.status];
  return { ...run, pinned: pinned?.label ?? p, ...(why && { why }) };
}

/** "Opus 5.5": the model, or the coding agent's name for its default. */
export const runModel = (r: SessionRun) => (r.model ? modelLabel(r.model) : CLI_NAMES[r.cli]);

/** "Max · keelops · Opus 5.5": the account and the model. */
export const runLabel = (r: SessionRun) => `${r.label} · ${runModel(r)}`;

/** "pinned: Claude Ultra, limited" when the session isn't on its pin, else ''. */
export const runPinNote = (r: SessionRun) => (r.pinned ? `pinned: ${r.pinned}${r.why ? `, ${r.why}` : ''}` : '');

/** The chip's whole line, for its title and screen readers. */
export const runText = (r: SessionRun) => [runLabel(r), r.effort && `${r.effort} effort`, runPinNote(r) && `(${runPinNote(r)})`].filter(Boolean).join(' ');

/** The same chip: account, coding agent, model, effort and pin (not when it started). */
export const sameRun = (a: SessionRun, b: SessionRun) => runText(a) === runText(b) && a.account === b.account && a.cli === b.cli;

// ---------- "Who runs on what" (#376) ----------

const THREAD_DAY_MS = 24 * 60 * 60_000;

/** One row of the card: an agent's live session or pin, or a CEO thread's last session. */
interface RunRow {
  key: string;
  name: string;
  open: { agentId: string } | { threadId: string };
  state: 'live' | 'pinned' | 'thread'; // pinned: idle, on its pin's account
  run: SessionRun | null;
}

/** An account's rows, with its fullest usage reading (null: none read). */
export interface RunGroup {
  id: string;
  label: string;
  pct: number | null;
  rows: RunRow[];
}

type Agent = { id: string; name: string; account?: string; run?: SessionRun | null };
type Thread = { id: string; title: string; run?: SessionRun };
type Usage = { pct: number; resetsAt: number | null };

/**
 * The card's groups: every live session under the account it really runs on (off its pin, it says so), idle agents
 * and the CEO under the account they're pinned to, and the CEO's threads of the last day under the account their
 * session ran on. Accounts in the registry's order, then what runs on none; empty ones left out.
 */
export function runsByAccount(agents: readonly Agent[], threads: readonly Thread[], accounts: readonly (Account & { usage?: readonly Usage[] })[], now: number): RunGroup[] {
  const groups = new Map<string, RunGroup>();
  const add = (id: string, label: string, row: RunRow) => {
    const acc = accounts.find((a) => a.id === id);
    const pcts = (acc?.usage ?? []).filter((r) => !r.resetsAt || r.resetsAt > now).map((r) => r.pct);
    const g = groups.get(id) ?? { id, label: acc?.label ?? label, pct: pcts.length ? Math.max(...pcts) : null, rows: [] };
    g.rows.push(row);
    groups.set(id, g);
  };
  for (const a of agents) {
    if (a.run) add(a.run.account || `other:${a.run.label}`, a.run.label, { key: `agent:${a.id}`, name: a.name, open: { agentId: a.id }, state: 'live', run: a.run });
    else {
      const pin = accounts.find((x) => x.id === a.account) ?? accounts.find((x) => !!a.account && x.tags.includes(a.account));
      if (pin) add(pin.id, pin.label, { key: `agent:${a.id}`, name: a.name, open: { agentId: a.id }, state: 'pinned', run: null });
    }
  }
  for (const t of threads) if (t.run && now - t.run.at < THREAD_DAY_MS) add(t.run.account || `other:${t.run.label}`, t.run.label, { key: `thread:${t.id}`, name: t.title, open: { threadId: t.id }, state: 'thread', run: t.run });
  const order = (id: string) => {
    const i = accounts.findIndex((a) => a.id === id);
    return i < 0 ? accounts.length : i;
  };
  return [...groups.values()].sort((a, b) => order(a.id) - order(b.id));
}
