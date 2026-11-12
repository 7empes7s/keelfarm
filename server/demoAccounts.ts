// The demo's Providers & accounts (#247): made-up accounts (a second Max subscription, an Ultra login whose token
// expired after its week reset, a Claude Pro login signed out, an Anthropic API key, an OpenAI key, a ChatGPT Pro login never signed in, a Google AI Plus login), a Test that never leaves the computer, and
// sign-ins drawn as the CLIs' own (demoSignIn.ts).
import fs from 'node:fs';
import path from 'node:path';
import type { AccountsBackend } from './backend.ts';
import { HOME_DIR } from './config.ts';
import type { AccountsDeps } from './accounts.ts';
import type { UsageApi } from './usageSources.ts';
import { codexReadings } from '../shared/usageSources.ts';
import type { CostRecord } from '../shared/costs.ts';
import { startOfDay } from './metrics.ts';
import type { ProviderAccount, UsageReading } from '../shared/types.ts';

const HOUR = 60 * 60_000;

const reading = (type: string, pct: number, inMs: number, now: number): UsageReading => ({ type, pct, resetsAt: now + inMs, at: now });

/** The seeded accounts. Their keys are made up, and the demo keeps them in a secrets file of its own. */
const SEED: ProviderAccount[] = [
  { id: 'claude-keelop', cli: 'claude', kind: 'subscription-login', label: 'Max · keelops', tags: ['max', 'backup'], priority: 1, enabled: true, plan: 'Max' },
  { id: 'claude-ultra', cli: 'claude', kind: 'subscription-login', label: 'Claude Ultra', tags: ['ultra'], priority: 3, enabled: true, plan: 'Ultra' },
  { id: 'claude-apikey', cli: 'claude', kind: 'api-key', label: 'Anthropic API', tags: ['api'], priority: 2, enabled: true, plan: 'API', dailyCostCap: 20 },
  { id: 'codex-apikey', cli: 'codex', kind: 'api-key', label: 'OpenAI API', tags: ['api'], priority: 1, enabled: false, plan: 'API' },
  { id: 'codex-pro', cli: 'codex', kind: 'subscription-login', label: 'ChatGPT Pro', tags: ['pro'], priority: 2, enabled: true, plan: 'Pro' }, // never signed in: the usage card's Sign in (#404)
  { id: 'claude-pro', cli: 'claude', kind: 'subscription-login', label: 'Claude Pro', tags: ['pro'], priority: 4, enabled: true, plan: 'Pro' }, // its sign-in expired (#579): signed out, with a card and a pinned agent
  { id: 'gemini-plus', cli: 'gemini', kind: 'subscription-login', label: 'Google AI Plus', tags: ['gemini'], priority: 0, enabled: true, plan: 'Plus' }, // the demo's Gemini CLI agent runs on it (#365)
];

/**
 * The demo ledger's sessions on the seeded accounts (#409): a pinned agent's on their account, a Codex or Gemini CLI
 * agent's on that login, and a share of the rest on the other Claude accounts (the API key's never today, under its
 * daily cap), so every account's usage sheet has a window to split. Pure: no draws.
 */
export function demoAccountSpend(records: CostRecord[], agents: readonly { id: string; cli?: string; account?: string }[], now: number): CostRecord[] {
  const today = startOfDay(now);
  const of = new Map(agents.map((a) => [a.id, a]));
  let n = 0;
  return records.map((r) => {
    if (r.type !== 'session') return r;
    const a = of.get(r.agentId);
    if (a?.account) return { ...r, account: a.account };
    if (a?.cli === 'codex') return { ...r, account: 'codex-login', model: 'gpt-6.1-sol' };
    if (a?.cli === 'gemini') return { ...r, account: 'gemini-plus', model: 'gemini-3-pro' };
    const slot = n++ % 6;
    const account = slot === 1 ? 'claude-keelop' : slot === 3 ? 'claude-ultra' : slot === 5 && r.at < today ? 'claude-apikey' : undefined;
    return account ? { ...r, account } : r;
  });
}

/** The made-up owner of the built-in login and keelops' (#460). */
const DEMO_OWNER = 'demo-owner';

/** Login folders the demo has "signed in": a session on any other login account opens on its sign-in (demo/sessions.ts). */
export const demoSignedIn = new Set<string>();

export function demoAccounts(signIn: AccountsDeps['signIn']): AccountsBackend {
  const signedIn = demoSignedIn;
  signedIn.clear();
  for (const id of ['claude-keelop', 'claude-ultra', 'gemini-plus']) signedIn.add(id);
  return {
    check: async (a) => {
      await new Promise((r) => setTimeout(r, 300));
      const now = Date.now();
      if (a.kind !== 'subscription-login') return { signedIn: true, readings: [], note: '✓ The demo accepts any key.' };
      if (a.builtIn) return { signedIn: true, readings: a.cli === 'codex' ? codexReadings(codexLimits(now), now) : [], note: '✓ Signed in (demo).' };
      if (!signedIn.has(a.id)) return { signedIn: false, readings: [], note: 'Not signed in yet: tap Sign in.' };
      // #442: Ultra's token expired after its week reset (last week's 100% reads 0%); keelops is signed in with a Pro
      // account, the same one as the built-in login (#460: a mismatch and a same-subscription pair).
      if (a.id === 'claude-ultra') return { signedIn: true, refresh: true, plan: 'Max 20x', readings: [{ type: 'seven_day', pct: 100, resetsAt: now - 2 * HOUR, at: now - 30 * HOUR }], note: '✓ Signed in; its token refreshes on its next session.' };
      if (a.id === 'claude-keelop') return { signedIn: true, plan: 'Pro', who: DEMO_OWNER, readings: [reading('five_hour', 18, 3 * HOUR, now), reading('seven_day', 63, 50 * HOUR, now)], note: '✓ Signed in; usage read (demo).' };
      return { signedIn: true, readings: a.cli === 'claude' ? [reading('five_hour', 42, 3 * HOUR, now), reading('seven_day', 63, 50 * HOUR, now)] : [], note: '✓ Signed in; usage read (demo).' };
    },
    login: async (a) => (a.cli === 'claude' ? { plan: 'Pro', who: DEMO_OWNER, file: { state: 'in', changedAt: 0 } } : { plan: null, who: null }),
    signIn: (o, exited) => {
      const id = /accounts[\\/]([^\\/]+)[\\/]/.exec(Object.values(o.env)[0] ?? '')?.[1];
      return signIn(o, (code) => {
        if (code === 0 && id && o.mode !== 'setup-token') signedIn.add(id);
        exited(code);
      });
    },
    shareFrom: demoClaudeHome,
    seed: () => ({ accounts: SEED.map((a) => ({ ...a, tags: [...a.tags] })), keys: { 'claude-apikey': 'sk-ant-demo-0000000000000000demo', 'codex-apikey': 'sk-demo-00000000000000000000demo' } }),
  };
}

/** The demo's "built-in login folder" (#377): a memory file, settings and a CLAUDE.md the seeded logins share. */
function demoClaudeHome(): string {
  const dir = path.join(HOME_DIR, 'demo-claude');
  const memory = path.join(dir, 'projects', 'demo-ceo', 'memory');
  fs.mkdirSync(memory, { recursive: true });
  const seed = (file: string, text: string) => fs.existsSync(file) || fs.writeFileSync(file, text);
  seed(path.join(memory, 'MEMORY.md'), '- [Manager prefers short replies](short-replies.md)\n');
  seed(path.join(memory, 'short-replies.md'), '---\nname: short-replies\ndescription: The manager reads on a phone\n---\nKeep replies short.\n');
  seed(path.join(dir, 'CLAUDE.md'), '# Demo user instructions\n');
  seed(path.join(dir, 'settings.json'), '{}\n');
  return dir;
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
