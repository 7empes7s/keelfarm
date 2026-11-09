// A cloud agent's API key that stopped working (#258, docs/cloud.md): out of credit, a spend limit or turned away. The
// office reads it from the session's output, takes that agent off the key and onto their CLI's own login, and walks
// the manager through signing them in. Pure: the server decides with it, the chat card and terminal show its steps.

import type { KeyTrouble } from './types.ts';

const OUT_OF_CREDIT = [
  /credit balance is too low/i, // Anthropic: "Your credit balance is too low to access the Anthropic API"
  /billing_error|\b402\b[^\n]*(?:payment|billing)/i,
  /reached your (?:specified )?API usage limits?/i, // an Anthropic org's spend limit
  /\bspend(?:ing)? limit\b/i,
  /insufficient_quota|exceeded your current quota/i, // OpenAI / Codex
];

const INVALID = [/invalid x-api-key/i, /authentication_error/i, /invalid api key/i, /incorrect api key provided/i, /invalid_api_key/i, /api key[^\n]*(?:revoked|disabled)/i];

/** What a failed session's output says about its API key, if anything. Out of credit wins over a turned-away key. */
export function keyTrouble(text: string): KeyTrouble | null {
  if (OUT_OF_CREDIT.some((r) => r.test(text))) return 'out-of-credit';
  if (INVALID.some((r) => r.test(text))) return 'invalid';
  return null;
}

/**
 * A cloud agent's own-login switch at the start of a task: off the key while it has trouble, back on it once the
 * manager saved a new key or pressed "Use the key again" (the trouble is gone).
 */
export function ownLoginStep(current: KeyTrouble | undefined, trouble: KeyTrouble | null): { ownLogin: KeyTrouble | undefined; note: 'off' | 'back' | null } {
  if (trouble) return { ownLogin: trouble, note: current ? null : 'off' };
  return { ownLogin: undefined, note: current ? 'back' : null };
}

/** The key's provider, in the manager's words. */
export const keyOwner = (cli: 'claude' | 'codex') => (cli === 'codex' ? 'OpenAI' : 'Anthropic');

/** Where the manager tops the key up instead. */
export const billingUrl = (cli: 'claude' | 'codex') => (cli === 'codex' ? 'https://platform.openai.com/settings/organization/billing' : 'https://console.anthropic.com/settings/billing');

/** What happened to one agent, in one line: "Ken's cloud machine ran out of API credit." */
export function troubleLine(name: string, why: KeyTrouble): string {
  return why === 'out-of-credit' ? `${name}'s cloud machine ran out of API credit.` : `${name}'s cloud machine had its API key turned away.`;
}

/** The three steps to sign one in with the manager's own account, as the card, the notification and (`here`) their terminal say them. */
export function signInSteps(name: string, cli: 'claude' | 'codex', here = false): string[] {
  const first = here ? `This is ${name}'s terminal: the sign-in link is below.` : `Tap Open ${name}'s terminal.`;
  return cli === 'codex'
    ? [first, 'It shows a link and a one-time code: tap the link and sign in to ChatGPT.', `Enter the code there. ${name} carries on by themselves.`]
    : [first, 'It shows a sign-in link: tap it and approve in Claude.', `Copy the code Claude shows, paste it into the terminal and press Enter. ${name} carries on by themselves.`];
}

/** The chat message (and notification) for one burst of cloud agents switched to their own login. */
export function signInMessage(names: string[], cli: 'claude' | 'codex', why: KeyTrouble): string {
  const account = cli === 'codex' ? 'your ChatGPT account' : 'your Claude account';
  if (names.length === 1) {
    const steps = signInSteps(names[0], cli).map((s, i) => `${i + 1}) ${s}`).join(' ');
    return `☁️ ${troubleLine(names[0], why)} Sign ${names[0]} in with ${account} to carry on: ${steps}`;
  }
  const what = why === 'out-of-credit' ? 'the API key ran out of credit' : 'the API key was turned away';
  return `☁️ ${names.length} cloud agents need signing in: ${what}. Sign each in with ${account}: open their terminal, tap the link, then paste the code back. They carry on by themselves.`;
}

/**
 * Agents switched to their own login within `windowMs` of the first are told about together: one chat card and one
 * notification per burst, not per agent. `flush` gets them in the order they came, each agent once.
 */
export class SignInBurst<T extends { id: string }> {
  private items: T[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private windowMs: number,
    private flush: (items: T[]) => void,
  ) {}

  add(item: T) {
    if (this.items.some((x) => x.id === item.id)) return;
    this.items.push(item);
    this.timer ??= setTimeout(() => {
      const items = this.items;
      this.items = [];
      this.timer = null;
      this.flush(items);
    }, this.windowMs);
  }
}

/** The latest sign-in link in a terminal's text (wrapped lines already joined), or null. */
export function signInLink(text: string): string | null {
  return text.match(/https:\/\/[^\s"'<>]+/g)?.at(-1) ?? null;
}
