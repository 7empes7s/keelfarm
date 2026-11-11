// Settings → Providers & accounts (#247, docs/accounts.md): a card per coding agent with what it signs in with, its
// accounts (status chip, usage or cost bars, who's pinned to it) and their actions, plus the page's numbers. Keys are
// pasted here and never come back: only their last 4 characters. iOS Settings → Passwords & Accounts is the model.
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { BILLING_LINKS, kindSentence, limitedBy } from '../../../shared/accounts';
import { switchingText } from '../../../shared/accountDefault';
import { clock, isReset, readingsNote, usageBars } from '../../../shared/usage';
import type { AccountCli, AccountKind, AccountView } from '../../../shared/types';
import { Menu } from './Menu';
import { Sheet } from './Sheet';
import { ProgressBar } from './ProgressBar';
import { SignInSheet } from './SignInSheet';
import { confirmDialog } from './Confirm';
import { workerCli } from './floorRows';
import './accounts.css';
import { Icon } from './Icon';
import { SecretInput } from './SecretInput';
import { LimitTimeline, RotationCard } from './RotationSettings';

const DOCS = 'https://github.com/7empes7s/keelfarm/blob/main/docs/accounts.md';

const CLI_INFO: { id: AccountCli | 'opencode'; name: string; signs: string }[] = [
  { id: 'claude', name: 'Claude Code', signs: 'a Claude subscription login (Pro or Max), an Anthropic API key, or a setup token' },
  { id: 'codex', name: 'Codex', signs: 'a ChatGPT plan login or an OpenAI API key' },
  { id: 'gemini', name: 'Gemini CLI', signs: 'a Google AI plan login (Plus or Pro), for QA second opinions, docs, research and small fixes' },
  { id: 'opencode', name: 'OpenCode', signs: 'its own setup (opencode auth login): the office runs it as it is' },
];
const CLI_NAME: Record<AccountCli, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' };

const KIND_NAME: Record<AccountKind, string> = { 'subscription-login': 'Subscription login', 'api-key': 'API key', 'setup-token': 'Setup token' };

function statusChip(a: AccountView, now: number): { text: string; tone: string } {
  if (a.removing) return { text: 'Removing after its sessions', tone: 'muted' };
  switch (a.status) {
    case 'ready':
      return { text: 'Ready', tone: 'good' };
    case 'near':
      return { text: 'Near limit', tone: 'warn' };
    case 'limited': {
      const by = limitedBy(a.usage, a.until, now);
      return { text: `${a.until ? `Limited until ${clock(a.until, now)}` : 'Limited'}${by ? ` (${by})` : ''}`, tone: 'bad' };
    }
    case 'signed-out':
      return { text: a.kind === 'api-key' ? 'No key' : 'Signed out', tone: 'bad' };
    default:
      return { text: 'Paused', tone: 'muted' };
  }
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Re-render every `ms`, so "Limited until" and "resets" keep up with the clock. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** The page's numbers: accounts by status, sessions and cost today, limit hits this week. */
function Stats({ list }: { list: AccountView[] }) {
  const count = (s: AccountView['status']) => list.filter((a) => a.status === s).length;
  const tiles: [string, string][] = [
    ['Ready', String(count('ready') + count('near'))],
    ['Limited', String(count('limited'))],
    ['Signed out', String(count('signed-out'))],
    ['Paused', String(count('paused'))],
    ['Sessions today', String(list.reduce((n, a) => n + a.todaySessions, 0))],
    ['Cost today', usd(list.reduce((n, a) => n + a.todayUsd, 0))],
    ['Limit hits, 7 days', String(list.reduce((n, a) => n + a.limitHits7d, 0))],
  ];
  return (
    <div className="acc-stats" role="list" aria-label="Accounts at a glance">
      {tiles.map(([label, value]) => (
        <div key={label} className="acc-stat" role="listitem">
          <b>{value}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function AccountCard({ a, first, last, isDefault, left, edit, signIn }: { a: AccountView; first: boolean; last: boolean; isDefault: boolean; left: number; edit: () => void; signIn: () => void }) {
  const agents = useStore((s) => s.agents);
  const demo = useStore((s) => s.demo);
  const now = useNow(30_000);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const chip = statusChip(a, now);
  const asOf = a.usage.length ? (readingsNote(a.usage, now) ?? (a.usage.some((r) => isReset(r, now)) ? 'Reset, waiting for a new reading' : null)) : null;
  const names = a.agents.map((id) => agents[id]?.name ?? id);
  const billing = BILLING_LINKS[a.cli][a.kind];
  const test = async () => {
    setBusy(true);
    setNote('');
    try {
      setNote((await api.testAccount(a.id)).note);
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  };
  const repair = async () => {
    setBusy(true);
    setNote('');
    try {
      setNote((await api.repairShare(a.id)).note);
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Remove ${a.label}?`,
      body: a.running ? `${a.running} session${a.running > 1 ? 's' : ''} still run on it: it's paused now and goes once they finish.` : a.kind === 'subscription-login' ? 'Its sign-in on this computer is deleted too.' : 'Its saved key is deleted from the office.',
      icon: 'trash-2',
      confirm: 'Remove',
      tone: 'danger',
    });
    if (ok) await api.removeAccount(a.id).catch(() => undefined);
  };
  // Switch now (#390): open tasks on the other accounts move to this one at their next session, in a fresh session.
  const switchNow = async () => {
    const ok = await confirmDialog({
      title: `Switch everyone to ${a.label} now?`,
      body: "Open tasks on the other accounts move to it at their next session: a fresh session in the same worktree, without its conversation. Make default lets them finish where they are instead.",
      icon: 'shuffle',
      confirm: 'Switch now',
      tone: 'warn',
    });
    if (ok) await api.makeDefaultAccount(a.id, true).catch(() => undefined);
  };
  return (
    <div className={`acc-card ${a.enabled ? '' : 'acc-paused'}`}>
      <div className="ds-card-head">
        <div className="ds-row-main">
          <div className="ds-row-title">{a.label}</div>
          <div className="ds-row-meta">
            {KIND_NAME[a.kind]}
            {a.plan ? ` · ${a.plan}` : ''}
            {a.loginPlan ? ` · login is ${a.loginPlan}` : ''}
            {a.keyHint ? ` · ••••${a.keyHint}` : ''}
            {a.builtIn ? ' · already here' : ''}
            {isDefault ? ' · default' : ''}
          </div>
        </div>
        <span className={`chip acc-chip acc-${chip.tone}`}>{chip.text}</span>
        <Menu
          label={`More for ${a.label}`}
          items={[
            a.kind === 'subscription-login' && { label: 'Sign in again', onSelect: signIn },
            { label: 'Test', onSelect: () => void test() },
            !a.removing && { label: a.enabled ? 'Pause in the rotation' : 'Resume in the rotation', onSelect: () => void api.updateAccount(a.id, { enabled: !a.enabled }).catch(() => undefined) },
            a.enabled && !a.removing && !isDefault && { label: 'Make default', hint: 'New tasks start on it; open ones finish first', onSelect: () => void api.makeDefaultAccount(a.id, false).catch(() => undefined) },
            a.enabled && !a.removing && (!isDefault || left > 0) && { label: 'Switch now', hint: 'Open tasks move to it at their next session', onSelect: () => void switchNow() },
            !first && { label: 'Move up', onSelect: () => void api.moveAccount(a.id, -1).catch(() => undefined) },
            !last && { label: 'Move down', onSelect: () => void api.moveAccount(a.id, 1).catch(() => undefined) },
            { label: a.kind === 'api-key' ? 'Rename, tags, daily cap' : 'Rename and tags', onSelect: edit },
            demo && !a.removing && { label: 'Simulate a limit', hint: 'Demo: its sessions switch to the next account', onSelect: () => void api.simulateAccountLimit(a.id).catch(() => undefined) },
            !!billing && { label: 'Open billing and usage', onSelect: () => void window.open(billing, '_blank', 'noopener') },
            !a.builtIn && !a.removing && { label: 'Remove', danger: true, hint: 'Running sessions finish first', onSelect: () => void remove() },
          ]}
        />
      </div>
      {a.tags.length > 0 && (
        <div className="acc-tags">
          {a.tags.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
      )}
      {a.planWarning && (
        <div className="acc-flag acc-flag-warn" role="status">
          <Icon name="triangle-alert" /> {a.planWarning}
        </div>
      )}
      {a.tokenRefresh && (
        <div className="acc-flag" role="status">
          <Icon name="refresh-cw" /> Token expired: it refreshes on its next session
        </div>
      )}
      {a.shareMissing && (
        <div className={`acc-flag ${a.shareMissing.length ? 'acc-flag-warn' : ''}`} role="status">
          <Icon name={a.shareMissing.length ? 'triangle-alert' : 'link'} /> {a.shareMissing.length ? `Doesn't share ${a.shareMissing.join(', ')} with this computer's login` : "Shares memory, skills and settings with this computer's login"}
        </div>
      )}
      {a.shareMissing && a.shareMissing.length > 0 && (
        <button className="btn acc-action" onClick={() => void repair()}>
          <Icon name="wrench" /> Repair
        </button>
      )}
      {usageBars(a.usage, now).map((b) => (
        <ProgressBar key={b.type} label={b.name} value={`${b.pct}%${b.resets ? `, ${b.resets}` : ''}`} pct={b.pct / 100} tone={b.tone} aria={`${a.label}: ${b.name} ${b.pct}%`} />
      ))}
      {asOf && <div className="ds-row-meta">{asOf}</div>}
      {a.dailyCostCap ? (
        <ProgressBar label="Today" value={`${usd(a.todayUsd)} of ${usd(a.dailyCostCap)}`} pct={Math.min(1, a.todayUsd / a.dailyCostCap)} tone={a.todayUsd >= a.dailyCostCap ? 'bad' : a.todayUsd >= a.dailyCostCap * 0.75 ? 'warn' : 'good'} aria={`${a.label}: ${usd(a.todayUsd)} of a ${usd(a.dailyCostCap)} daily cap`} />
      ) : null}
      <LimitTimeline a={a} now={now} />
      <div className="ds-row-meta">
        {a.todaySessions} session{a.todaySessions === 1 ? '' : 's'} today · {usd(a.todayUsd)}
        {a.running ? ` · ${a.running} running` : ''}
        {a.limitHits7d ? ` · ${a.limitHits7d} limit hit${a.limitHits7d === 1 ? '' : 's'} this week` : ''}
        {' · '}
        {names.length ? `Pinned: ${names.join(', ')}` : 'Nobody pinned'}
      </div>
      {a.status === 'signed-out' && a.kind === 'subscription-login' && (
        <button className="btn btn-primary acc-action" onClick={signIn}>
          <Icon name="key-round" /> Sign in
        </button>
      )}
      {a.status === 'signed-out' && a.kind === 'setup-token' && <p className="muted small">Set {a.tokenEnv} in the office's environment (claude setup-token prints it) and restart the office.</p>}
      {(note || busy) && (
        <span className="small muted" role="status">
          {busy ? 'Working…' : note}
        </span>
      )}
    </div>
  );
}

/** Rename, tags, plan and (API keys) a daily cost cap, or a new key. */
function EditSheet({ a, close }: { a: AccountView; close: () => void }) {
  const [label, setLabel] = useState(a.label);
  const [tags, setTags] = useState(a.tags.join(', '));
  const [plan, setPlan] = useState(a.plan ?? '');
  const [cap, setCap] = useState(a.dailyCostCap ? String(a.dailyCostCap) : '');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (key.trim()) await api.setAccountKey(a.id, key);
      await api.updateAccount(a.id, { label, tags, plan, ...(a.kind === 'api-key' ? { dailyCostCap: cap ? Number(cap) : null } : {}) });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Sheet title={`Edit ${a.label}`} onClose={close}>
      <form className="acc-form" autoComplete="off" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span>Name</span>
          <input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field">
          <span>Tags</span>
          <input value={tags} placeholder="max, backup" onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="field">
          <span>Plan</span>
          <input value={plan} placeholder="Max, Pro, API…" maxLength={20} onChange={(e) => setPlan(e.target.value)} />
        </label>
        {a.kind === 'api-key' && (
          <>
            <label className="field">
              <span>Daily cost cap (USD)</span>
              <input type="number" min={0} step="1" inputMode="decimal" value={cap} placeholder="No cap" onChange={(e) => setCap(e.target.value)} />
            </label>
            <label className="field">
              <span>New key (tested before it's saved)</span>
              <SecretInput name={`account-${a.id}-key`} value={key} placeholder={`••••${a.keyHint}`} onChange={(e) => setKey(e.target.value)} />
            </label>
          </>
        )}
        <p className="muted small">Pin an agent or the CEO to a tag, and any account with it can run them.</p>
        {error && (
          <div className="term-error small" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary" type="submit">
          Save
        </button>
      </form>
    </Sheet>
  );
}

/** Add a login (signed in next), an API key (tested first) or a setup token (read from the environment). */
function AddSheet({ cli, close, signIn }: { cli: AccountCli; close: () => void; signIn: (id: string) => void }) {
  const demo = useStore((s) => s.demo);
  const [kind, setKind] = useState<AccountKind>('subscription-login');
  const [label, setLabel] = useState('');
  const [tags, setTags] = useState('');
  const [key, setKey] = useState('');
  const [tokenEnv, setTokenEnv] = useState('CUBEFARM_CLAUDE_TOKEN_2');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const kinds: AccountKind[] = cli === 'claude' ? ['subscription-login', 'api-key', 'setup-token'] : cli === 'gemini' ? ['subscription-login'] : ['subscription-login', 'api-key'];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api.addAccount({ cli, kind, label, tags, ...(kind === 'api-key' ? { key } : {}), ...(kind === 'setup-token' ? { tokenEnv } : {}) });
      close();
      if (kind === 'subscription-login') signIn(r.id);
      else useStore.getState().pushToast('info', r.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={`Add a ${CLI_NAME[cli]} account`} onClose={close}>
      <form className="acc-form" autoComplete="off" onSubmit={(e) => void submit(e)}>
        <div role="radiogroup" aria-label="Kind of account" className="acc-kinds">
          {kinds.map((k) => (
            <label key={k} className={`acc-kind ${kind === k ? 'on' : ''}`}>
              <input type="radio" name="acc-kind" checked={kind === k} onChange={() => setKind(k)} />
              <span>
                <b>{KIND_NAME[k]}</b>
                <span className="muted small">{kindSentence(cli, k)}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="field">
          <span>Name</span>
          <input value={label} maxLength={40} placeholder={kind === 'api-key' ? 'Work API key' : cli === 'gemini' ? 'Google AI Plus' : 'Max · second seat'} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field">
          <span>Tags</span>
          <input value={tags} placeholder="max, backup" onChange={(e) => setTags(e.target.value)} />
        </label>
        {kind === 'api-key' && (
          <label className="field">
            <span>{cli === 'claude' ? 'Anthropic' : 'OpenAI'} API key</span>
            <SecretInput name="new-account-key" required value={key} placeholder={demo ? (cli === 'claude' ? 'sk-ant-anything works in the demo' : 'sk-anything works in the demo') : cli === 'claude' ? 'sk-ant-…' : 'sk-…'} onChange={(e) => setKey(e.target.value)} />
          </label>
        )}
        {kind === 'setup-token' && (
          <label className="field">
            <span>Environment variable that holds it</span>
            <input value={tokenEnv} onChange={(e) => setTokenEnv(e.target.value)} />
          </label>
        )}
        <p className="muted small">
          {kind === 'subscription-login'
            ? 'Next, its sign-in opens in a terminal here, in a folder of its own: your other logins stay as they are.'
            : kind === 'api-key'
              ? 'The office makes one free request to check it, then keeps it on this computer only.'
              : 'Run claude setup-token, put the token in that variable and restart the office: Anthropic’s terms keep the office from storing it.'}
        </p>
        {error && (
          <div className="term-error small" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Checking…' : kind === 'subscription-login' ? 'Add and sign in' : 'Add'}
        </button>
      </form>
    </Sheet>
  );
}

export function ProvidersSettings() {
  const list = useStore((s) => s.accounts.accounts);
  const switchingNow = useStore((s) => s.accounts.switching);
  const agents = Object.values(useStore((s) => s.agents));
  const settings = useStore((s) => s.settings);
  const [adding, setAdding] = useState<AccountCli | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [signing, setSigning] = useState<string | null>(null);
  const signIn = (id: string) => {
    void api.signInAccount(id).then(() => setSigning(id), () => undefined);
  };
  const onRotation = agents.filter((x) => x.host !== 'box' && !x.account).length;
  const find = (id: string | null) => list.find((a) => a.id === id);
  const nextId = useStore((s) => s.accounts.next?.claude ?? null);
  const nextOn = find(nextId);
  const switching = (cli: string) => switchingNow?.find((x) => x.cli === cli);
  const def = (cli: string) => list.find((a) => a.cli === cli && a.enabled && !a.removing)?.id;
  return (
    <div className="card acc-page">
      <h3>
        <Icon name="key-round" /> Providers & accounts
      </h3>
      <p className="muted small">
        Every login and API key the coding agents on this computer run on. Agents and the CEO use the rotation (the first ready account, top first) unless you pin them to an account or a tag in their
        setup; when one is out, they move to the next. {onRotation} on the rotation now.{nextOn && ` The next Claude session starts on ${nextOn.label}.`} Every other provider (text, audio, cloud, MCP servers) is in <a href="#settings/providers">Providers</a>.
      </p>
      <Stats list={list} />
      <RotationCard />
      {CLI_INFO.map((c) => {
        const mine = list.filter((a) => a.cli === c.id);
        const users = agents.filter((x) => x.host !== 'box' && workerCli(x, settings) === c.id).length;
        return (
          <section key={c.id} className="acc-cli" aria-label={c.name}>
            <div className="row wrap">
              <h4 className="grow">{c.name}</h4>
              {c.id !== 'opencode' && (
                <button className="btn btn-small" onClick={() => setAdding(c.id as AccountCli)}>
                  ＋ Add account
                </button>
              )}
            </div>
            <p className="muted small">
              Signs in with {c.signs}.{users ? ` ${users} of the team run${users === 1 ? 's' : ''} it.` : ''}
            </p>
            {switching(c.id) && (
              <p className="acc-flag" role="status">
                <Icon name="shuffle" /> {switchingText(switching(c.id)!.left)}
              </p>
            )}
            {mine.map((a, i) => (
              <AccountCard key={a.id} a={a} first={i === 0} last={i === mine.length - 1} isDefault={a.id === def(c.id)} left={switching(c.id)?.left.reduce((n, l) => n + l.count, 0) ?? 0} edit={() => setEditing(a.id)} signIn={() => signIn(a.id)} />
            ))}
          </section>
        );
      })}
      <details className="small acc-kinds-help">
        <summary>What each kind costs, and what it touches</summary>
        <ul>
          <li>
            <b>Subscription login</b>: {kindSentence('claude', 'subscription-login')} A second subscription signs in in its own folder, so it never signs your first one out.
          </li>
          <li>
            <b>API key</b>: {kindSentence('claude', 'api-key')}
          </li>
          <li>
            <b>Setup token</b>: {kindSentence('claude', 'setup-token')}
          </li>
        </ul>
      </details>
      <p className="muted small">
        Cloud agents sign in separately, in their Boxes: <a href="#settings/cloud-agents">Settings → Cloud agents</a>. Keys there never reach agents on this computer. More: <a href={DOCS}>docs/accounts.md</a>.
      </p>
      {adding && <AddSheet cli={adding} close={() => setAdding(null)} signIn={signIn} />}
      {find(editing) && <EditSheet a={find(editing)!} close={() => setEditing(null)} />}
      {find(signing) && <SignInSheet a={find(signing)!} close={() => setSigning(null)} />}
    </div>
  );
}
