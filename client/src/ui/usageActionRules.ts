// The usage card's actions (#404), pure: what each row and its detail sheet offer for its provider and status, the
// recommended one first (highlighted, as on the Approvals page), what its status chip does, and when a limited source
// is back. UsageActions.tsx draws them with the Settings and console buttons' handlers.
import { BILLING_LINKS } from '../../../shared/accounts';
import type { AccountKind, UsageSource } from '../../../shared/types';
import type { IconName } from './icons';

type UsageActionId = 'sign-in' | 'notify-back' | 'make-default' | 'agents' | 'rest' | 'resume' | 'voice' | 'plan' | 'provider' | 'settings' | 'mission';

export interface UsageAction {
  id: UsageActionId;
  label: string;
  icon: IconName;
  primary?: boolean;
  href?: string; // opens in a new tab
}

/** What the row doesn't say: its account's kind and place, and whether "Notify me when it's back" is on. */
export interface UsageContext {
  kind?: AccountKind;
  enabled?: boolean;
  isDefault?: boolean;
  watching?: boolean;
  /** False when no channel reaches the manager's phone with the office closed (#538): the button says so. */
  reach?: boolean;
}

type Source = Pick<UsageSource, 'id' | 'provider' | 'status' | 'accountId'>;

const ELEVENLABS_PLAN = 'https://elevenlabs.io/app/subscription';
const UPSTASH_CONSOLE = 'https://console.upstash.com/';

/** Where "Open in Settings" goes: the section and the card's element id there. */
export function settingsTarget(s: Pick<UsageSource, 'id' | 'provider' | 'accountId'>): { tab: 'accounts' | 'voice' | 'cloud-agents' | 'providers'; card?: string } {
  if (s.accountId) return { tab: 'accounts', card: `acc-card-${s.accountId}` };
  if (s.provider === 'elevenlabs') return { tab: 'voice' };
  if (s.provider === 'upstash') return { tab: 'cloud-agents' };
  return { tab: 'providers', card: `pv-usage-${s.id}` };
}

/** Every action a source's sheet offers, the recommended one first; the row shows only that one. */
export function usageActions(s: Source, ctx: UsageContext = {}): UsageAction[] {
  const out: UsageAction[] = [];
  const add = (a: UsageAction) => void out.push(a);
  const limited = s.status === 'limited';
  const back: UsageAction = { id: 'notify-back', label: ctx.watching ? "We'll tell you when it's back" : ctx.reach === false ? 'Notify me (not on your phone yet)' : "Notify me when it's back", icon: 'bell' };
  if (s.accountId) {
    const login = ctx.kind === 'subscription-login';
    const signedOut = s.status === 'signed-out';
    if (login) add({ id: 'sign-in', label: signedOut ? 'Sign in' : 'Sign in again', icon: 'key-round', primary: signedOut });
    if (signedOut && !login) add({ id: 'settings', label: ctx.kind === 'api-key' ? 'Add its key in Settings' : 'How to sign it in', icon: 'settings', primary: true });
    if (limited) add({ ...back, primary: true });
    if (ctx.enabled !== false && !ctx.isDefault && !limited && !signedOut) add({ id: 'make-default', label: 'Use for new work', icon: 'star' });
    add({ id: 'agents', label: s.provider === 'codex' ? 'Move agents to or from Codex' : 'Pin or unpin agents', icon: 'users', primary: s.status === 'near' });
    add(ctx.enabled === false ? { id: 'resume', label: 'Resume', icon: 'play' } : { id: 'rest', label: 'Rest this account', icon: 'moon' });
    const billing = ctx.kind && (s.provider === 'claude' || s.provider === 'codex' || s.provider === 'gemini') ? BILLING_LINKS[s.provider][ctx.kind] : undefined;
    if (billing) add({ id: 'plan', label: 'Open billing and usage', icon: 'external-link', href: billing });
  } else if (s.provider === 'elevenlabs') {
    if (limited) add({ ...back, primary: true });
    add({ id: 'voice', label: 'Open Settings → Voice', icon: 'mic', primary: s.status === 'error' || s.status === 'signed-out' });
    add({ id: 'plan', label: 'Manage plan', icon: 'external-link', href: ELEVENLABS_PLAN, primary: s.status === 'near' });
  } else {
    if (limited) add({ ...back, primary: true });
    add({ id: 'provider', label: 'Open its card in Providers', icon: 'plug', primary: s.status === 'error' || s.status === 'signed-out' });
    if (s.provider === 'upstash') add({ id: 'plan', label: 'Open the Upstash console', icon: 'external-link', href: UPSTASH_CONSOLE });
  }
  // Every sheet ends with these two (for the other providers, their card in Providers is their place in Settings).
  if (!out.some((a) => a.id === 'settings') && settingsTarget(s).tab !== 'providers') add({ id: 'settings', label: 'Open in Settings', icon: 'settings' });
  add({ id: 'mission', label: 'Mission control → Usage', icon: 'sliders-horizontal' });
  const first = out.findIndex((a) => a.primary);
  return first > 0 ? [out[first], ...out.slice(0, first), ...out.slice(first + 1)] : out;
}

/** The row's one action: the recommended one, if any. */
export const rowAction = (s: Source, ctx: UsageContext = {}) => usageActions(s, ctx).find((a) => a.primary) ?? null;

/** What tapping the status chip does: Signed out signs in (or opens where it can be), anything else opens the detail. */
export function chipAction(s: Source, ctx: UsageContext = {}): 'sign-in' | 'settings' | 'provider' | 'voice' | 'detail' {
  if (s.status !== 'signed-out') return 'detail';
  const a = rowAction(s, ctx);
  return a && (a.id === 'sign-in' || a.id === 'settings' || a.id === 'provider' || a.id === 'voice') ? a.id : 'detail';
}

/** When a limited source is free again: its account's "limited until", else the soonest reset of a full window. */
export function backAt(s: Pick<UsageSource, 'status' | 'windows'>, until: number | null | undefined, now: number): number | null {
  if (s.status !== 'limited') return null;
  if (until && until > now) return until;
  const resets = s.windows.filter((w) => (w.usedPct ?? 0) >= 100 && w.resetsAt && w.resetsAt > now).map((w) => w.resetsAt!);
  return resets.length ? Math.min(...resets) : null;
}
