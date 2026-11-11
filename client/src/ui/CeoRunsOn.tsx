// What the CEO runs on, picked by hand (#418): the CEO card's coding agent picker with what each one can't do, the
// live session's chip, an inline Sign in when its accounts are signed out, and the chat pill with Undo. Rules in
// shared/ceoRunsOn.ts; automatic fallback (Settings → Providers & accounts → rotation) stays a separate switch.
import { useId, useState } from 'react';
import { api } from '../api';
import { useStore, type Agent } from '../store';
import { CEO_CLI_NOTES, CEO_CLIS, type CeoRunsOn } from '../../../shared/ceoRunsOn';
import { modelAfterCliChange } from '../../../shared/models';
import { CLI_NAMES } from '../../../shared/sessionRun';
import { CEO_ID, type AgentCli } from '../../../shared/types';
import { workerCli } from './floorRows';
import { Icon } from './Icon';
import { RunChip } from './RunChip';
import { SignInSheet } from './SignInSheet';

/** The CEO's coding agent: takes effect at its next job; a model the new one doesn't have goes back to its default. */
export function CeoCliField({ ceo }: { ceo: Agent }) {
  const id = useId();
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const models = useStore((s) => s.models);
  const terminal = settings.runtime === 'terminal';
  const cli = workerCli(ceo, settings);
  const installed = (c: AgentCli) => !clis.length || clis.some((x) => x.id === c && x.installed);
  const change = (next: AgentCli) => {
    const model = modelAfterCliChange(ceo.model, next, models);
    void api.updateAgent(ceo.id, model === ceo.model ? { cli: next } : { cli: next, model }).catch(() => undefined); // api() already toasted the error
  };
  return (
    <label className="field" htmlFor={id}>
      <span>Coding agent</span>
      <select id={id} value={cli} disabled={!terminal} title="The coding agent the CEO runs on" onChange={(e) => change(e.target.value as AgentCli)}>
        {CEO_CLIS.map((c) => (
          <option key={c} value={c} disabled={!installed(c)}>
            {clis.find((x) => x.id === c)?.label ?? CLI_NAMES[c]}
            {installed(c) ? '' : ' (not installed)'}
          </option>
        ))}
      </select>
      <span className="muted small">{terminal ? CEO_CLI_NOTES[cli] : 'Another coding agent needs Real terminals (Settings → Agents): the Agent SDK is Claude Code.'}</span>
      <CeoSignIn ceo={ceo} cli={cli} />
      {ceo.run && (
        <span className="muted small">
          Now: <RunChip run={ceo.run} />
        </span>
      )}
    </label>
  );
}

/** Sign in, inline, when every account the CEO's next job could start on is signed out: never a dead choice. */
function CeoSignIn({ ceo, cli }: { ceo: Agent; cli: AgentCli }) {
  const accounts = useStore((s) => s.accounts.accounts);
  const [open, setOpen] = useState<string | null>(null);
  const b = (ceo.account ?? '').toLowerCase();
  const mine = accounts.filter((a) => a.cli === cli && !a.removing && (b ? a.id === b || a.tags.includes(b) : a.enabled));
  if (!mine.length || !mine.every((a) => a.status === 'signed-out')) return null;
  const login = mine.find((a) => a.kind === 'subscription-login' && !a.builtIn);
  const sheet = accounts.find((a) => a.id === open);
  return (
    <span className="row wrap">
      {login ? (
        <button type="button" className="btn btn-small" onClick={() => {
            setOpen(login.id);
            void api.signInAccount(login.id).catch(() => undefined);
          }}>
          <Icon name="key-round" /> Sign in · {login.label}
        </button>
      ) : (
        <span className="muted small">{`${mine[0].label} is signed out: run "${cli}" in a terminal on this computer and sign in.`}</span>
      )}
      {sheet && <SignInSheet a={sheet} close={() => setOpen(null)} />}
    </span>
  );
}

/** The chat pill when the manager moved the CEO: its line and Undo, which puts back what it ran on. */
export function CeoRunsPill({ text, back }: { text: string; back: CeoRunsOn }) {
  const [busy, setBusy] = useState(false);
  const cli = useStore((s) => s.agents[CEO_ID]?.cli);
  const done = (cli || 'claude') === back.cli;
  return (
    <div className="notice-card" role="note">
      <p className="notice-card-title">{text}</p>
      <div className="notice-card-links">
        <button type="button" className="btn" disabled={busy || done} onClick={() => {
            setBusy(true);
            void api.updateAgent(CEO_ID, back).catch(() => undefined).finally(() => setBusy(false)); // api() already toasted the error
          }}>
          <Icon name="undo-2" /> {done ? 'Undone' : 'Undo'}
        </button>
      </div>
    </div>
  );
}
