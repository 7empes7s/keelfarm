// One sign-in per company (#533) and keys made right the first time: the guided setup card (steps, limits, what Test
// calls), "Sign in with Google / Meta / TikTok / Microsoft" with every scope listed in plain words before the consent
// screen, and a key's create-token link pre-filled with its permissions (Cloudflare, GitHub). Rules and words are
// pure, in shared/oauth.ts and shared/keySetup.ts; the tokens and keys stay on the server.
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { oauthDef, callbackPath } from '../../../shared/oauth';
import { clientWords, setupGuide, type SetupGuide } from '../../../shared/keySetup';
import { CAPABILITIES } from '../../../shared/capabilities';
import type { ProviderDef } from '../../../shared/providers';
import { Icon } from './Icon';
import { SecretInput } from './SecretInput';

const capWords = (caps: string[]) => caps.map((c) => CAPABILITIES.find((x) => x.id === c)?.label ?? c).join(', ');

/** A provider's guided setup: its key kind in one line, 2-5 steps, its limits and what Test calls. */
export function SetupSteps({ guide }: { guide: SetupGuide }) {
  return (
    <div className="pv-guide">
      {guide.keyKind && <p className="small">{guide.keyKind}</p>}
      <ol className="pv-steps small">
        {guide.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {guide.limits && (
        <p className="muted small">
          <b>Limits:</b> {guide.limits}
        </p>
      )}
      <p className="muted small">
        <b>Test:</b> {guide.test}
      </p>
    </div>
  );
}

/** "Sign in with Google": the scopes first, the client set up once, then the consent screen in a new tab. */
export function SignInForm({ def, onDone }: { def: ProviderDef; onDone: () => void }) {
  const o = oauthDef(def.id)!;
  const ready = useStore((s) => (s.providers.clients ?? []).includes(def.id));
  const signedIn = useStore((s) => s.providers.connections.find((c) => c.provider === def.id));
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [idWord, secretWord] = clientWords(def.id);
  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setNote('');
    setBusy(true);
    // opened now, while the tap still counts, so no popup blocker stops it; pointed at the consent screen after
    const tab = window.open('', '_blank');
    try {
      if (!ready) await api.setOAuthClient(def.id, clientId, secret);
      const { url } = await api.startOAuth(def.id);
      if (tab) tab.location.href = url;
      else location.assign(url);
      onDone();
    } catch (err) {
      tab?.close();
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="acc-form" autoComplete="off" onSubmit={(e) => void signIn(e)}>
      <p className="muted small">{def.blurb}.</p>
      <div className="pv-scopes" aria-label={`What ${o.name} is asked for`} role="group">
        <span className="small">
          <b>{o.name} is asked for, in one consent:</b>
        </span>
        <ul className="small">
          {o.scopes.map((s) => (
            <li key={s.scope}>
              {s.plain}
              {s.unlocks.length > 0 && <span className="muted"> · {capWords(s.unlocks)}</span>}
            </li>
          ))}
        </ul>
      </div>
      {!ready && (
        <>
          <SetupSteps guide={setupGuide(def.id)} />
          <p className="muted small">
            Redirect address: <code>{location.origin + callbackPath}</code> ·{' '}
            <a href={o.consoleUrl} target="_blank" rel="noopener noreferrer">
              Open {o.name}'s console
            </a>
          </p>
          <label className="field">
            <span>{idWord}</span>
            <input value={clientId} spellCheck={false} autoCapitalize="off" onChange={(e) => setClientId(e.target.value)} />
          </label>
          <label className="field">
            <span>{secretWord}</span>
            <SecretInput name={`oauth-${def.id}`} value={secret} onChange={(e) => setSecret(e.target.value)} />
          </label>
        </>
      )}
      {ready && setupGuide(def.id).limits && (
        <p className="muted small">
          <b>Limits:</b> {setupGuide(def.id).limits}
        </p>
      )}
      {signedIn && <p className="muted small">Signed in already: signing in again renews it and keeps one connection.</p>}
      <button className="btn btn-primary" disabled={busy || (!ready && (!clientId.trim() || !secret.trim()))}>
        <Icon name="id-card" /> Sign in with {o.name}
      </button>
      <p className="muted small">Tokens stay on the office's server and are refreshed there; this page never sees them.</p>
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
    </form>
  );
}
