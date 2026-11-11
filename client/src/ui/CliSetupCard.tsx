// Settings → Providers & accounts (#493): a coding agent's CLI on this computer. Missing: "Not installed" with Install
// (progress, then the npm log's tail and Try again on a failure) and Check again. OpenCode, which has no accounts: its
// version, the providers it's signed in to and its own sign-in (`opencode auth login`) in a terminal sheet.
import { useState } from 'react';
import { api } from '../api';
import type { CliView } from '../../../shared/types';
import { Icon } from './Icon';
import { LiveTerminal } from './LiveTerminal';
import { Sheet } from './Sheet';
import './signInSheet.css';
import './cliSetup.css';

function CheckAgain() {
  const [busy, setBusy] = useState(false);
  const check = () => {
    setBusy(true);
    void api.checkClis().finally(() => setBusy(false));
  };
  return (
    <button type="button" className="btn" disabled={busy} onClick={check}>
      <Icon name="refresh-cw" /> {busy ? 'Checking…' : 'Check again'}
    </button>
  );
}

/** A CLI missing from this computer, with Install; null when it's here (or not looked for yet). */
export function CliMissingCard({ cli, anyInstalling }: { cli: CliView | undefined; anyInstalling: boolean }) {
  if (!cli || cli.installed) return null;
  const run = cli.install;
  const failed = !!run && !run.running && !run.ok;
  return (
    <div className="acc-card cli-missing" role="group" aria-label={`${cli.label}: not installed`}>
      <div className="ds-card-head">
        <div className="ds-row-main">
          <div className="ds-row-title">Not installed</div>
          <div className="ds-row-meta">Not on this computer yet. Install puts {cli.label} in the office's own folder, at the version the office was tested with.</div>
        </div>
        <span className={`chip acc-chip ${failed ? 'acc-bad' : 'acc-muted'}`}>{run?.running ? 'Installing' : failed ? 'Failed' : 'Missing'}</span>
      </div>
      {run?.running && (
        <p className="acc-flag" role="status">
          <span className="sig-spin" aria-hidden="true" /> {run.note} This takes a minute or two.
        </p>
      )}
      {failed && (
        <div role="alert">
          <p className="acc-flag acc-flag-warn">
            <Icon name="circle-x" /> {run.note}
          </p>
          {run.tail.length > 0 && <pre className="cli-log">{run.tail.join('\n')}</pre>}
        </div>
      )}
      {!run?.running && (
        <div className="row wrap">
          <button type="button" className="btn btn-primary" disabled={anyInstalling} onClick={() => void api.installCli(cli.id).catch(() => undefined)}>
            <Icon name={failed ? 'rotate-ccw' : 'download'} /> {failed ? 'Try again' : 'Install'}
          </button>
          <CheckAgain />
        </div>
      )}
      {anyInstalling && !run?.running && <p className="muted small">Another coding agent is installing: one at a time.</p>}
    </div>
  );
}

/** OpenCode's own sign-in: its picker and prompts in a terminal, how it ended, Try again. */
function OpencodeSignInSheet({ cli, close }: { cli: CliView; close: () => void }) {
  const run = cli.signIn;
  return (
    <Sheet title="Sign in · OpenCode" onClose={close} className="acc-signin">
      <p className="muted small">Pick a provider in the terminal with the arrow keys and Enter, then follow its sign-in or paste its API key. It's saved in OpenCode's own setup on this computer.</p>
      {run && !run.running && (
        <div className={`sig-card sig-end ${run.ok ? 'sig-end-ok' : 'sig-end-bad'}`} role="status">
          <Icon name={run.ok ? 'circle-check' : 'circle-x'} className="sig-end-icon" />
          <div className="grow">
            <p className="sig-lead">{run.ok ? 'Signed in' : 'That didn’t work'}</p>
            <p className="small">{run.ok && cli.providers?.length ? `Signed in to ${cli.providers.join(', ')}.` : run.note}</p>
          </div>
        </div>
      )}
      <LiveTerminal agentId="cli:opencode" cli="opencode" compact keys signIn />
      <div className="row wrap">
        {run && !run.running && (
          <button type="button" className={`btn ${run.ok ? '' : 'btn-good'}`} onClick={() => void api.opencodeSignIn().catch(() => undefined)}>
            <Icon name="rotate-ccw" /> {run.ok ? 'Sign in to another provider' : 'Try again'}
          </button>
        )}
        <button type="button" className={`btn ${run?.ok ? 'btn-good' : ''}`} onClick={close}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

/** OpenCode's card: installed and its version, the providers it's signed in to, Sign in. */
export function OpencodeCard({ cli }: { cli: CliView | undefined }) {
  const [open, setOpen] = useState(false);
  if (!cli?.installed) return null;
  const providers = cli.providers ?? [];
  const signIn = () => void api.opencodeSignIn().then(() => setOpen(true), () => undefined);
  return (
    <div className="acc-card" role="group" aria-label="OpenCode on this computer">
      <div className="ds-card-head">
        <div className="ds-row-main">
          <div className="ds-row-title">OpenCode on this computer</div>
          <div className="ds-row-meta">Installed{cli.version ? ` · ${cli.version}` : ''}</div>
        </div>
        <span className={`chip acc-chip ${providers.length ? 'acc-good' : 'acc-bad'}`}>{providers.length ? 'Ready' : 'Signed out'}</span>
      </div>
      {providers.length > 0 ? (
        <div className="acc-tags" aria-label="Signed in to">
          {providers.map((p) => (
            <span key={p} className="chip">
              {p}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted small">Not signed in to any provider yet.</p>
      )}
      <div className="row wrap">
        <button type="button" className={`btn ${providers.length ? '' : 'btn-primary'}`} onClick={signIn}>
          <Icon name="key-round" /> {providers.length ? 'Sign in to another provider' : 'Sign in'}
        </button>
        <CheckAgain />
      </div>
      {open && <OpencodeSignInSheet cli={cli} close={() => setOpen(false)} />}
    </div>
  );
}
