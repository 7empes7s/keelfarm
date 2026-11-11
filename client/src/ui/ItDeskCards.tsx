// The IT desk's cards (#506): the commands the CEO proposed, each with what it's for, what it frees, how to undo it and
// its risk, and Run / Not now; Run all for several. Shown in the CEO chat and on Mission control. Also Settings → CEO
// settings' IT desk: on/off, the read-only list and the commands run.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { CEO_ID } from '../../../shared/types';
import { argvLine, IT_READ_ONLY, type ItProposal, type ItRisk } from '../../../shared/itDesk';
import { Icon } from './Icon';
import './itDesk.css';

const NONE: never[] = []; // one empty list: a fresh [] per read would re-render without end (the snapshot leaves itDesk out while empty)
const RISK: Record<ItRisk, string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };

function ProposalCard({ p, busy, act }: { p: ItProposal; busy: boolean; act: (ids: string[], run: boolean) => void }) {
  return (
    <div className="it-card" role="group" aria-label={`Command to run: ${argvLine(p.argv)}`}>
      <div className="it-card-head">
        <code className="it-cmd">{argvLine(p.argv)}</code>
        <span className={`it-risk it-risk-${p.risk}`}>{RISK[p.risk]}</span>
      </div>
      <p className="it-why">{p.why}</p>
      <dl className="it-facts small">
        <dt>Frees or changes</dt>
        <dd>{p.affects}</dd>
        <dt>Undo</dt>
        <dd>{p.undo}</dd>
      </dl>
      <div className="it-actions">
        <button type="button" className="btn btn-good" disabled={busy} onClick={() => act([p.id], true)}>
          <Icon name="play" /> Run
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act([p.id], false)}>
          Not now
        </button>
      </div>
    </div>
  );
}

/**
 * The CEO's proposed commands waiting for the manager; nothing while there are none. `inChat`: above the message box,
 * shrinking and scrolling inside itself so the message box and the other trays stay on screen; its header folds it to
 * one row, as it does while the manager types (`typing`).
 */
export function ItDeskCards({ inChat = false, typing = false }: { inChat?: boolean; typing?: boolean }) {
  const waiting = useStore((s) => s.itDesk?.waiting ?? NONE);
  const ceo = useStore((s) => s.agents[CEO_ID]?.name ?? 'The CEO');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (typing) setOpen(false);
  }, [typing]);
  if (!waiting.length) return null;
  const shown = !inChat || open;
  const act = (ids: string[], run: boolean) => {
    setBusy(true);
    void (run ? api.itRun(ids) : api.itDismiss(ids)).catch(() => undefined).finally(() => setBusy(false)); // api() already toasted the error
  };
  return (
    <section className={`it-desk${inChat ? ' it-desk-chat' : ''}`} aria-label="IT desk: commands waiting for you">
      <div className="it-desk-head">
        <Icon name="terminal" />
        <b className="grow">
          {ceo} asks to run {waiting.length === 1 ? 'a command' : `${waiting.length} commands`}
        </b>
        {shown && waiting.length > 1 && (
          <button type="button" className="btn btn-good" disabled={busy} onClick={() => act(waiting.map((p) => p.id), true)}>
            Run all {waiting.length}
          </button>
        )}
        {inChat && (
          <button type="button" className="decision-collapse" aria-expanded={open} aria-label={open ? 'Hide the commands' : 'Show the commands'} onClick={() => setOpen(!open)}>
            <Icon name={open ? 'chevron-down' : 'chevron-up'} />
          </button>
        )}
      </div>
      {shown && waiting.map((p) => <ProposalCard key={p.id} p={p} busy={busy} act={act} />)}
    </section>
  );
}

/** Settings → CEO settings: the IT desk's switch, what it reads without asking, and the commands run. */
export function ItDeskSettings() {
  const on = useStore((s) => s.settings.itDesk !== false);
  const log = useStore((s) => s.itDesk?.log ?? NONE);
  return (
    <div className="card">
      <h3>
        <Icon name="terminal" /> IT desk
      </h3>
      <label className="toggle block">
        <input type="checkbox" checked={on} onChange={(e) => void api.updateSettings({ itDesk: e.target.checked })} />
        <span>
          <b>The CEO runs commands on this machine</b>: read-only ones at once (below); a change only when you tap Run on its card. Killing by name, rebooting, keel-postgres's data,
          /etc/keel and the live office's folders are never run.
        </span>
      </label>
      <details className="it-allow">
        <summary>What it reads without asking</summary>
        <ul className="small">
          {IT_READ_ONLY.map((r) => (
            <li key={r.program}>
              <code>{r.program}</code> <span className="muted">{r.what}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">One command each, no shell: no pipes, redirects or ;. Output is capped at 20 KB with secrets masked; credential files are never read.</p>
      </details>
      <h4 className="it-log-h">Commands run</h4>
      {log.length ? (
        <ul className="it-log">
          {log.map((e) => (
            <li key={e.id} className="it-log-row">
              <span className="it-log-top">
                <code className="grow it-cmd">{argvLine(e.argv)}</code>
                <span className={`it-exit ${e.code === 0 ? '' : 'it-exit-bad'}`}>{e.code === null ? 'not run' : `exit ${e.code}`}</span>
              </span>
              <span className="muted small">
                {e.kind === 'read' ? 'Read' : 'Change'} by {e.by}, {new Date(e.at).toLocaleString()}
              </span>
              {e.out.trim() && (
                <details className="it-log-out">
                  <summary>Output</summary>
                  <pre>{e.out}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">None yet. Ask the CEO, e.g. "check the machine and tell me where to gain space".</p>
      )}
    </div>
  );
}
