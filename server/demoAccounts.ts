// The demo's Providers & accounts (#247): made-up accounts (a second Max subscription, an Anthropic API key, an OpenAI
// key), a Test that never leaves the computer, and sign-ins drawn as the CLIs' own (demoSignIn.ts).
import type { AccountsBackend } from './backend.ts';
import type { AccountsDeps } from './accounts.ts';
import type { ProviderAccount, UsageReading } from '../shared/types.ts';

const HOUR = 60 * 60_000;

const reading = (type: string, pct: number, inMs: number, now: number): UsageReading => ({ type, pct, resetsAt: now + inMs, at: now });

/** The seeded accounts. Their keys are made up, and the demo keeps them in a secrets file of its own. */
const SEED: ProviderAccount[] = [
  { id: 'claude-keelop', cli: 'claude', kind: 'subscription-login', label: 'Max · keelops', tags: ['max', 'backup'], priority: 1, enabled: true, plan: 'Max' },
  { id: 'claude-apikey', cli: 'claude', kind: 'api-key', label: 'Anthropic API', tags: ['api'], priority: 2, enabled: true, plan: 'API', dailyCostCap: 20 },
  { id: 'codex-apikey', cli: 'codex', kind: 'api-key', label: 'OpenAI API', tags: ['api'], priority: 1, enabled: false, plan: 'API' },
];

export function demoAccounts(signIn: AccountsDeps['signIn']): AccountsBackend {
  const signedIn = new Set<string>(['claude-keelop']); // login folders the demo has "signed in"
  return {
    check: async (a) => {
      await new Promise((r) => setTimeout(r, 300));
      const now = Date.now();
      if (a.kind !== 'subscription-login') return { signedIn: true, readings: [], note: '✓ The demo accepts any key.' };
      if (a.builtIn) return { signedIn: true, readings: [], note: '✓ Signed in (demo).' };
      if (!signedIn.has(a.id)) return { signedIn: false, readings: [], note: 'Not signed in yet: tap Sign in.' };
      return { signedIn: true, readings: a.cli === 'claude' ? [reading('five_hour', 42, 3 * HOUR, now), reading('seven_day', 63, 50 * HOUR, now)] : [], note: '✓ Signed in; usage read (demo).' };
    },
    signIn: (o, exited) => {
      const id = /accounts[\\/]([^\\/]+)[\\/]/.exec(Object.values(o.env)[0] ?? '')?.[1];
      return signIn(o, (code) => {
        if (code === 0 && id && o.mode !== 'setup-token') signedIn.add(id);
        exited(code);
      });
    },
    seed: () => ({ accounts: SEED.map((a) => ({ ...a, tags: [...a.tags] })), keys: { 'claude-apikey': 'sk-ant-demo-0000000000000000demo', 'codex-apikey': 'sk-demo-00000000000000000000demo' } }),
  };
}
