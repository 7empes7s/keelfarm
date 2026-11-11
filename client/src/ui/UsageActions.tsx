// The usage card's actions (#404): each row's recommended action and its sheet's full list (rules in usageActionRules.ts),
// run with the same calls as Settings → Providers & accounts and the console: sign in, use for new work, rest, pin or
// move agents, "Notify me when it's back", and links to Settings, Mission control and the provider's own page.
import { useState } from 'react';
import { api } from '../api';
import { useStore, type Agent, type ManagerTab } from '../store';
import { CEO_ID, type AccountView, type UsageSource } from '../../../shared/types';
import { AgentChip } from './DetailsPage';
import { workerCli } from './floorRows';
import { Icon } from './Icon';
import { useBackLayer } from './Panel';
import { Sheet } from './Sheet';
import { settingsTarget, type UsageAction, type UsageContext } from './usageActionRules';

/** A row's account (if it's one) and what the rules need to know about it. */
export function useUsageContext(s: UsageSource): UsageContext & { account?: AccountView } {
  const accounts = useStore((st) => st.accounts.accounts);
  const account = s.accountId ? accounts.find((a) => a.id === s.accountId) : undefined;
  if (!account) return { watching: !!s.watchBack };
  // The default is the first account of its coding agent that's on (as Settings marks it).
  const isDefault = accounts.find((a) => a.cli === account.cli && a.enabled && !a.removing)?.id === account.id;
  return { account, kind: account.kind, enabled: account.enabled, isDefault, watching: !!s.watchBack };
}

/** Settings or Mission control at a card; the sheet goes first, so it doesn't sit over them. */
const openConsole = (host: UsageHost, tab: ManagerTab, card?: string) => {
  host.closeDetail();
  useStore.getState().openOverlay({ kind: 'manager', tab, card });
};
const toast = (text: string) => useStore.getState().pushToast('info', text);

/** What the list holds open for an action: the sign-in sheet, or who's on it. */
export interface UsageHost {
  signIn: (accountId: string) => void;
  agents: (sourceId: string) => void;
  closeDetail: () => void;
}

/** Runs one action on a source. */
export function runUsageAction(a: UsageAction, s: UsageSource, host: UsageHost) {
  const id = s.accountId ?? '';
  switch (a.id) {
    case 'sign-in':
      return host.signIn(id);
    case 'notify-back':
      return void api.notifyUsageBack(s.id, !s.watchBack).then((r) => toast(r.watching ? `You'll get a notification when ${s.label} is back.` : `No notification for ${s.label}.`), () => undefined);
    case 'make-default':
      return void api.makeDefaultAccount(id, false).then((r) => toast(r.note || `New work starts on ${s.label}.`), () => undefined);
    case 'agents':
      return host.agents(s.id);
    case 'rest':
      return void api.updateAccount(id, { enabled: false }).then(() => {
        host.closeDetail();
        toast(`${s.label} is resting: new work skips it. Resume it in Settings → Providers & accounts.`);
      }, () => undefined);
    case 'resume':
      return void api.updateAccount(id, { enabled: true }).catch(() => undefined);
    case 'plan':
      return void window.open(a.href, '_blank', 'noopener');
    case 'voice':
      return openConsole(host, 'voice');
    case 'provider':
      return openConsole(host, 'providers', `pv-usage-${s.id}`);
    case 'settings': {
      const t = settingsTarget(s);
      return openConsole(host, t.tab, t.card);
    }
    case 'mission':
      return openConsole(host, 'ops', 'sources');
  }
}

/** One action as a button: the recommended one highlighted, as on the Approvals page. */
export function UsageActionButton({ a, s, host }: { a: UsageAction; s: UsageSource; host: UsageHost }) {
  const cls = `ds-btn us-action ${a.primary ? 'btn-good' : ''}`;
  if (a.href)
    return (
      <a className={cls} href={a.href} target="_blank" rel="noopener noreferrer">
        <Icon name={a.icon} /> {a.label}
      </a>
    );
  return (
    <button type="button" className={cls} aria-pressed={a.id === 'notify-back' ? !!s.watchBack : undefined} onClick={() => runUsageAction(a, s, host)}>
      <Icon name={a.icon} /> {a.label}
    </button>
  );
}

/** "On it": each agent opens their window (`onOpen` closes the sheet over it). */
export function OnIt({ ids, onOpen }: { ids: string[]; onOpen: () => void }) {
  const agents = useStore((st) => st.agents);
  if (!ids.length) return <p className="small">No agent is pinned to it: the rotation uses it in its turn.</p>;
  return (
    <span className="us-agents" onClick={onOpen}>
      {ids.map((id) => (agents[id] ? <AgentChip key={id} agent={agents[id]} role={id === CEO_ID ? 'CEO' : ''} /> : <span key={id} className="small">{id}</span>))}
    </span>
  );
}

/** Pin or unpin agents on an account; a Codex account also moves agents to or from Codex. */
export function AgentsSheet({ s, onClose, onAgent }: { s: UsageSource; onClose: () => void; onAgent: () => void }) {
  useBackLayer(onClose);
  const agents = useStore((st) => st.agents);
  const settings = useStore((st) => st.settings);
  const [busy, setBusy] = useState<string | null>(null);
  const id = s.accountId ?? '';
  const codex = s.provider === 'codex' && settings.runtime === 'terminal';
  const save = (a: Agent, patch: Parameters<typeof api.updateAgent>[1]) => {
    setBusy(a.id);
    void api
      .updateAgent(a.id, patch)
      .catch(() => undefined)
      .finally(() => setBusy(null));
  };
  const rows = Object.values(agents)
    .filter((a) => a.host !== 'box')
    .map((a) => ({ a, cli: workerCli(a, settings), on: !!s.agents?.includes(a.id) }))
    .filter((r) => r.cli === s.provider || (codex && r.a.role !== 'ceo'));
  return (
    <Sheet title={`Agents on ${s.label}`} onClose={onClose} className="us-sheet">
      <p className="muted small">Pinned agents always run on this account; the others use the rotation.{codex ? ' Moving someone to Codex starts their next task in Codex.' : ''}</p>
      <div className="us-detail">
        {rows.map(({ a, cli, on }) => (
          <div key={a.id} className="us-agent-row">
            <span onClick={onAgent}>
              <AgentChip agent={a} role={a.id === CEO_ID ? 'CEO' : ''} />
            </span>
            <span className="us-agent-actions">
              {cli === s.provider ? (
                <button type="button" className="ds-btn" disabled={busy === a.id} onClick={() => save(a, { account: on ? '' : id })}>
                  {on ? 'Unpin' : 'Pin here'}
                </button>
              ) : (
                <button type="button" className="ds-btn" disabled={busy === a.id} onClick={() => save(a, { cli: 'codex', account: id })}>
                  Move to Codex
                </button>
              )}
              {codex && cli === 'codex' && (
                <button type="button" className="ds-btn" disabled={busy === a.id} onClick={() => save(a, { cli: settings.defaultCli === 'codex' ? 'claude' : '', account: '' })}>
                  Off Codex
                </button>
              )}
            </span>
          </div>
        ))}
        {!rows.length && <p className="muted small">Nobody on this computer runs {s.provider === 'codex' ? 'Codex' : 'this coding agent'}.</p>}
      </div>
    </Sheet>
  );
}
