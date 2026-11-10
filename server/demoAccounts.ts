// The demo's Providers & accounts (#247): made-up accounts (a second Max subscription, an Ultra login whose token
// expired after its week reset, an Anthropic API key, an OpenAI key), a Test that never leaves the computer, and
// sign-ins drawn as the CLIs' own (demoSignIn.ts).
import type { AccountsBackend } from './backend.ts';
import type { AccountsDeps } from './accounts.ts';
import type { UsageApi } from './usageSources.ts';
import { codexReadings } from '../shared/usageSources.ts';
import type { ProviderAccount, UsageReading } from '../shared/types.ts';

const HOUR = 60 * 60_000;

const reading = (type: string, pct: number, inMs: number, now: number): UsageReading => ({ type, pct, resetsAt: now + inMs, at: now });

/** The seeded accounts. Their keys are made up, and the demo keeps them in a secrets file of its own. */
const SEED: ProviderAccount[] = [
  { id: 'claude-keelop', cli: 'claude', kind: 'subscription-login', label: 'Max · keelops', tags: ['max', 'backup'], priority: 1, enabled: true, plan: 'Max' },
  { id: 'claude-ultra', cli: 'claude', kind: 'subscription-login', label: 'Claude Ultra', tags: ['ultra'], priority: 3, enabled: true, plan: 'Ultra' },
  { id: 'claude-apikey', cli: 'claude', kind: 'api-key', label: 'Anthropic API', tags: ['api'], priority: 2, enabled: true, plan: 'API', dailyCostCap: 20 },
  { id: 'codex-apikey', cli: 'codex', kind: 'api-key', label: 'OpenAI API', tags: ['api'], priority: 1, enabled: false, plan: 'API' },
];

export function demoAccounts(signIn: AccountsDeps['signIn']): AccountsBackend {
  const signedIn = new Set<string>(['claude-keelop', 'claude-ultra']); // login folders the demo has "signed in"
  return {
    check: async (a) => {
      await new Promise((r) => setTimeout(r, 300));
      const now = Date.now();
      if (a.kind !== 'subscription-login') return { signedIn: true, readings: [], note: '✓ The demo accepts any key.' };
      if (a.builtIn) return { signedIn: true, readings: a.cli === 'codex' ? codexReadings(codexLimits(now), now) : [], note: '✓ Signed in (demo).' };
      if (!signedIn.has(a.id)) return { signedIn: false, readings: [], note: 'Not signed in yet: tap Sign in.' };
      // #442: Ultra's token expired after its week reset (last week's 100% reads 0%); keelops is signed in with a Pro account.
      if (a.id === 'claude-ultra') return { signedIn: true, refresh: true, plan: 'Max 20x', readings: [{ type: 'seven_day', pct: 100, resetsAt: now - 2 * HOUR, at: now - 30 * HOUR }], note: '✓ Signed in; its token refreshes on its next session.' };
      if (a.id === 'claude-keelop') return { signedIn: true, plan: 'Pro', readings: [reading('five_hour', 42, 3 * HOUR, now), reading('seven_day', 63, 50 * HOUR, now)], note: '✓ Signed in; usage read (demo).' };
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

// ---------- usage for every provider (#361) ----------

const sec = (ms: number) => Math.round(ms / 1000);

/** Codex app-server's account/rateLimits/read, as a Plus login answers it. */
const codexLimits = (now: number) => ({
  rateLimits: { primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: sec(now + 2 * HOUR) }, secondary: { usedPercent: 22, windowDurationMins: 10080, resetsAt: sec(now + 4 * 24 * HOUR) }, planType: 'plus' },
});

/** Made-up ElevenLabs and Anthropic Admin answers, so the demo's usage card has a row for every provider. */
export const demoUsageApi: UsageApi = {
  demoKeys: { elevenlabs: 'demo-elevenlabs', anthropic: 'sk-ant-admin-demo' },
  elevenLabs: async () => ({ tier: 'creator', character_count: 61_200, character_limit: 100_000, next_character_count_reset_unix: sec(Date.now() + 9 * 24 * HOUR), status: 'active' }),
  costs: async (_provider, _key, now) => ({
    data: Array.from({ length: 7 }, (_, i) => ({ starting_at: new Date(now - (6 - i) * 24 * HOUR).toISOString(), results: [{ currency: 'USD', amount: String(180 + i * 45) }] })),
    has_more: false,
  }),
};
