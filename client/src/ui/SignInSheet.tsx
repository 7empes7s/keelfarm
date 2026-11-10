// A login's guided sign-in (#350), over the same terminal as #302's: three steps (open the sign-in page, paste the code
// back, signed in) read from the terminal's screen on the server (shared/signIn.ts signInScreen), so nobody has to read
// the CLI. The terminal stays one tap away under "Show terminal". Codex shows its one-time code instead of a field.
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { codeProblem, maskCode, signInCode } from '../../../shared/signIn';
import { clipboardPaste } from '../../../shared/termKeys';
import type { AccountView, SignInMode } from '../../../shared/types';
import { copyText } from './clipboard';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { LiveTerminal } from './LiveTerminal';
import { Sheet } from './Sheet';
import './signInSheet.css';

/** 0: open the page, 1: paste the code (Claude) or enter it there (Codex), 2: signed in. */
function stepOf(a: AccountView, opened: boolean): number {
  const run = a.signIn;
  if (run && !run.running) return run.ok ? 2 : opened ? 1 : 0;
  return run?.url && (opened || a.cli === 'codex') ? 1 : 0;
}

function Steps({ at, failed, names }: { at: number; failed: boolean; names: string[] }) {
  return (
    <ol className="sig-steps" aria-label="Sign-in steps">
      {names.map((name, i) => {
        const state = i < at || (i === 2 && at === 2) ? 'done' : i === at ? (failed ? 'failed' : 'now') : 'later';
        const icon: IconName = state === 'done' ? 'check' : state === 'failed' ? 'x' : (['external-link', 'clipboard-paste', 'circle-check'] as const)[i];
        return (
          <li key={name} className={`sig-step sig-step-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="sig-step-mark">
              <Icon name={icon} />
            </span>
            <span className="sig-step-name">{name}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Copy({ text, label, onCopy }: { text: string; label: string; onCopy?: () => void }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    onCopy?.();
    void copyText(text).then((ok) => setDone(ok));
  };
  return (
    <button type="button" className="btn" onClick={copy}>
      <Icon name={done ? 'check' : 'copy'} /> {done ? 'Copied' : label}
    </button>
  );
}

/** Step 2 for Claude Code: the code from the page, checked before it goes to the terminal's prompt. */
function CodeForm({ id, waiting, onSend }: { id: string; waiting: boolean; onSend: () => void }) {
  const [raw, setRaw] = useState('');
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const code = signInCode(raw);
  const take = (text: string) => {
    setRaw(text);
    setProblem(null);
  };
  const paste = () => void clipboardPaste(navigator.clipboard).then((r) => ('text' in r ? take(r.text) : setProblem('The browser kept the clipboard to itself: long-press the field and paste there.')));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const why = codeProblem(raw);
    setProblem(why);
    if (why) return;
    setBusy(true);
    onSend();
    api.signInCode(id, raw).then(
      () => setBusy(false),
      () => setBusy(false),
    );
  };
  return (
    <form className="sig-card" onSubmit={submit}>
      <label className="field sig-code">
        <span>Paste the code from the sign-in page</span>
        <span className="sig-code-row">
          <input
            name="sign-in-code"
            value={editing ? raw : maskCode(code)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="The code the page shows"
            aria-invalid={!!problem}
            aria-describedby="sig-code-hint"
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onChange={(e) => take(e.target.value)}
          />
          <button type="button" className="btn" onClick={paste}>
            <Icon name="clipboard-paste" /> Paste
          </button>
        </span>
      </label>
      <p id="sig-code-hint" className="muted small">
        {code ? `${code.length} characters${code.includes('#') ? ', with the # part' : ''}. ` : ''}
        After you approve, the page shows a long code with a # in the middle, and a Copy button.
      </p>
      {problem && (
        <p className="sig-warn small" role="alert">
          <Icon name="triangle-alert" /> {problem}
        </p>
      )}
      <button className="btn btn-good sig-wide" type="submit" disabled={busy || !waiting}>
        {busy ? 'Signing in…' : waiting ? 'Sign in' : 'Waiting for the terminal…'}
      </button>
    </form>
  );
}

/**
 * The login's own sign-in, guided: the link it prints as a button, the code pasted into a real field, how it ended in
 * words with Try again (a fresh login in the same terminal); Claude Code can make a setup token there instead (#302).
 */
export function SignInSheet({ a, close }: { a: AccountView; close: () => void }) {
  const run = a.signIn;
  const token = run?.mode === 'setup-token';
  const codex = a.cli === 'codex';
  const [opened, setOpened] = useState(false);
  const [showTerm, setShowTerm] = useState(false);
  const [tries, setTries] = useState(0); // a fresh field for each sign-in
  const failed = !!run && !run.running && !run.ok;
  const termOn = showTerm || (token && !!run?.ok); // a made token is read off the terminal
  const at = stepOf(a, opened);
  const again = (mode: SignInMode) => {
    setOpened(false);
    setTries((n) => n + 1);
    void api.signInAccount(a.id, mode).catch(() => undefined);
  };
  const names = ['Open the sign-in page', codex ? 'Enter the code there' : 'Paste the code', token ? 'Token made' : 'Signed in'];
  return (
    <Sheet title={`${token ? 'Setup token' : 'Sign in'} · ${a.label}`} onClose={close} className="acc-signin">
      <Steps at={at} failed={failed} names={names} />
      <p className="muted small">
        {token ? 'It makes a token that lasts a year: put it in an environment variable of the office and add it as a Setup token account. The office never saves it.' : "This signs in only this account's own folder, so your other logins stay signed in."}
      </p>
      {run?.running && run.question && (
        <div className="sig-card">
          <p className="sig-lead">{run.question.text || 'The sign-in asks:'}</p>
          {run.question.options.map((o, i) => (
            <button key={o} type="button" className="btn sig-wide sig-option" onClick={() => void api.signInAnswer(a.id, i).catch(() => undefined)}>
              {o}
            </button>
          ))}
        </div>
      )}
      {run?.running && !run.question && !run.url && (
        <div className="sig-card sig-center" role="status">
          <span className="sig-spin" aria-hidden="true" /> Starting sign-in…
        </div>
      )}
      {run?.running && run.url && (
        <div className="sig-card">
          {codex && run.deviceCode && (
            <div className="sig-device">
              <span className="muted small">Your one-time code</span>
              <strong className="sig-device-code">{run.deviceCode}</strong>
              <Copy text={run.deviceCode} label="Copy code" />
            </div>
          )}
          <div className="sig-open">
            <a className="btn btn-good" href={run.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}>
              <Icon name="external-link" /> Open sign-in page
            </a>
            <Copy text={run.url} label="Copy link" onCopy={() => setOpened(true)} />
          </div>
          <p className="muted small">{codex ? 'Sign in to ChatGPT there and enter the code above. This page moves on by itself.' : 'Sign in there and approve: the page then shows a code to copy.'}</p>
        </div>
      )}
      {run?.running && run.url && !codex && <CodeForm key={tries} id={a.id} waiting={!!run.waiting} onSend={() => setOpened(true)} />}
      {run?.running && run.url && codex && (
        <div className="sig-card sig-center" role="status">
          <span className="sig-spin" aria-hidden="true" /> Waiting for you to enter the code…
        </div>
      )}
      {run && !run.running && (
        <div className={`sig-card sig-end ${run.ok ? 'sig-end-ok' : 'sig-end-bad'}`} role="status">
          <Icon name={run.ok ? 'circle-check' : 'circle-x'} className="sig-end-icon" />
          <div className="grow">
            <p className="sig-lead">{run.ok ? (token ? 'Token made' : `Signed in as ${a.label}${a.loginPlan ? ` (${a.loginPlan})` : ''}`) : 'That didn’t work'}</p>
            <p className="small">{run.note}</p>
          </div>
        </div>
      )}
      <button type="button" className="btn btn-ghost sig-term-toggle" aria-expanded={termOn} onClick={() => setShowTerm(!termOn)}>
        <Icon name={termOn ? 'chevron-up' : 'chevron-down'} /> {termOn ? 'Hide terminal' : 'Show terminal'}
      </button>
      {termOn && <LiveTerminal agentId={`account:${a.id}`} cli={a.cli} compact keys signIn />}
      <div className="row wrap">
        {failed && (
          <button className="btn btn-good" onClick={() => again(run.mode)}>
            <Icon name="rotate-ccw" /> Try again
          </button>
        )}
        {a.cli === 'claude' && (
          <button className="btn" onClick={() => again(token ? 'login' : 'setup-token')}>
            <Icon name="key-round" /> {token ? 'Sign in with the browser instead' : 'Sign in with a setup token instead'}
          </button>
        )}
        <button className="btn" onClick={() => void api.testAccount(a.id).catch(() => undefined)}>
          <Icon name="flask-conical" /> Test
        </button>
        <button className={`btn ${run?.ok ? 'btn-good' : ''}`} onClick={close}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
