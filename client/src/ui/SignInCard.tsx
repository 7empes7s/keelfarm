import { useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { billingUrl, signInSteps, troubleLine } from '../../../shared/keyTrouble';
import type { ChatSignIn } from '../../../shared/types';
import { Icon } from './Icon';
import './signIn.css';

// Cloud agents whose API key ran out of credit or was turned away (#258): the steps to sign them in with the
// manager's own account, as an iOS-style numbered list, shared by the chat card and the agent's terminal.

/** The three steps, numbered in circles; `here`: in their terminal, so the first says the link is below. */
export function SignInSteps({ name, cli, here = false }: { name: string; cli: ChatSignIn['cli']; here?: boolean }) {
  return (
    <ol className="sign-in-steps">
      {signInSteps(name, cli, here).map((s, i) => (
        <li key={i}>
          <span className="sign-in-step-n" aria-hidden>
            {i + 1}
          </span>
          <span className="grow">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** The terminal's link for signing in, to the clipboard (for opening it on another device). */
export async function copySignInLink(id: string) {
  const { url } = await api.signInLink(id);
  const toast = useStore.getState().pushToast;
  if (!url) return toast('info', 'No link yet: open their terminal and it shows one.');
  await navigator.clipboard?.writeText(url).then(
    () => toast('success', 'Sign-in link copied.'),
    () => toast('error', "Couldn't copy: open their terminal and tap the link there."),
  );
}

/** The chat card for one burst: what happened, the steps, a row per agent with its buttons, and Add credit instead. */
export function SignInCard({ card }: { card: ChatSignIn }) {
  const agents = useStore((s) => s.agents);
  const [busy, setBusy] = useState<string | null>(null);
  const one = card.agents.length === 1;
  const open = (id: string) => useStore.getState().openOverlay({ kind: 'terminal', agentId: id, view: 'terminal' });
  const check = (id: string, name: string) => {
    setBusy(id);
    void api
      .signInCheck(id)
      .then(() => useStore.getState().pushToast('success', `${name} is signed in and carries on.`))
      .catch(() => undefined)
      .finally(() => setBusy(null));
  };
  return (
    <div className="notice-card sign-in-card" role="note">
      <p className="notice-card-title">
        <b>{one ? troubleLine(card.agents[0].name, card.why) : `${card.agents.length} cloud agents need signing in: the API key ${card.why === 'out-of-credit' ? 'ran out of credit' : 'was turned away'}.`}</b>
      </p>
      <SignInSteps name={one ? card.agents[0].name : 'the agent'} cli={card.cli} />
      <ul className="sign-in-rows">
        {card.agents.map(({ id, name }) => {
          const a = agents[id];
          const waiting = !!a?.needsSignIn;
          return (
            <li key={id} className="sign-in-row">
              <div className="row">
                <b className="grow">{a?.name ?? name}</b>
                <span className={`action-chip ${waiting ? '' : 'action-chip-good'}`}>{!a ? 'gone' : waiting ? 'waiting' : 'carrying on'}</span>
              </div>
              {waiting && (
                <div className="sign-in-actions">
                  <button type="button" className="btn btn-small" onClick={() => open(id)}>
                    <Icon name="terminal" /> Open terminal
                  </button>
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => void copySignInLink(id)}>
                    <Icon name="copy" /> Copy link
                  </button>
                  <button type="button" className="btn btn-small btn-ghost" disabled={busy === id} onClick={() => check(id, name)}>
                    <Icon name="circle-check" /> I've signed in
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="notice-card-links">
        <a href={billingUrl(card.cli)} target="_blank" rel="noreferrer">
          <Icon name="credit-card" /> Add credit instead <Icon name="external-link" />
        </a>
      </div>
    </div>
  );
}
