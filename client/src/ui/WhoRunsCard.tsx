// Mission control's "Who runs on what" card (#376): every live session under the account it really runs on (the CEO
// and agents; off its pin, it says so), idle agents under the account they're pinned to, and the CEO's threads of the
// last day, each account with its fullest usage. A row opens that agent's window or that thread in the chat.
import { useMemo } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { runModel, runPinNote, runsByAccount, type RunGroup } from '../../../shared/sessionRun';
import { Section } from './DetailsPage';
import { Icon } from './Icon';
import './whoRuns.css';

const STATE: Record<RunGroup['rows'][number]['state'], string> = { live: 'Running', pinned: 'Pinned, idle', thread: 'CEO thread' };

function open(to: RunGroup['rows'][number]['open']) {
  const s = useStore.getState();
  if ('agentId' in to) return s.openOverlay({ kind: 'terminal', agentId: to.agentId });
  const opened = s.chat.current === to.threadId ? Promise.resolve() : api.openConversation(to.threadId);
  void opened.then(
    () => useStore.getState().openOverlay({ kind: 'phone', tab: 'chat' }),
    () => undefined, // api() already toasted the error
  );
}

export function WhoRunsCard() {
  const agents = useStore((s) => s.agents);
  const threads = useStore((s) => s.chat.conversations);
  const accounts = useStore((s) => s.accounts.accounts);
  const groups = useMemo(() => runsByAccount(Object.values(agents), threads, accounts, Date.now()), [agents, threads, accounts]);
  return (
    <Section
      id="ops-card-who-runs"
      className="who-runs"
      title={
        <>
          <Icon name="key-round" /> Who runs on what
        </>
      }
    >
      {groups.length === 0 && <p className="muted small">Nothing is running. Sessions show here under the account they really run on.</p>}
      {groups.map((g) => (
        <div key={g.id} className="who-runs-group">
          <h5 className="who-runs-account">
            <span className="who-runs-label">{g.label}</span>
            {g.pct !== null && <span className={`chip ${g.pct >= 90 ? 'who-runs-hot' : ''}`}>{g.pct}% used</span>}
          </h5>
          <ul className="who-runs-rows">
            {g.rows.map((r) => (
              <li key={r.key}>
                <button type="button" className="ds-row who-runs-row" onClick={() => open(r.open)}>
                  <Icon name={r.state === 'thread' ? 'message-circle' : r.state === 'live' ? 'play' : 'pin'} />
                  <span className="ds-row-main">
                    <span className="ds-row-title">{r.name}</span>
                    <span className="ds-row-meta">
                      {STATE[r.state]}
                      {r.run && ` · ${runModel(r.run)}${r.run.effort ? `, ${r.run.effort} effort` : ''}`}
                      {r.run && runPinNote(r.run) && <span className="run-chip-pin"> · {runPinNote(r.run)}</span>}
                    </span>
                  </span>
                  <Icon name="chevron-right" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}
