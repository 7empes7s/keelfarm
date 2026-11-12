// Keys made right the first time (#533), pure: each provider's guided setup card (2-5 steps, the kind of key in one
// line, free and paid limits, what Test calls), the create-token links pre-filled with the exact permissions the
// office needs (Cloudflare's permission group keys, GitHub's fine-grained token parameters), and the permission
// checks a test runs after the key works, each 401/403 turned into the permission it lacks ("Missing: Zone DNS edit").
import { providerDef, type ProbeRequest, type ProbeResult } from './providers.ts';

export interface SetupGuide {
  /** The kind of key, in one line. */
  keyKind?: string;
  steps: string[];
  limits?: string;
  /** What its Test calls: always free and read-only. */
  test: string;
  /** Asks for an Account ID beside the key. */
  accountId?: { label: string; hint: string };
}

// ---------- pre-filled create-token links ----------

/** The Cloudflare permissions the office uses (dashboard permission group keys). */
const CLOUDFLARE_PERMISSIONS: { key: string; type: 'read' | 'edit'; plain: string }[] = [
  { key: 'zone', type: 'read', plain: 'Zone read' },
  { key: 'dns', type: 'edit', plain: 'Zone DNS edit' },
  { key: 'argotunnel', type: 'edit', plain: 'Cloudflare Tunnel edit' },
  { key: 'workers_scripts', type: 'edit', plain: 'Workers Scripts edit' },
];

/** Cloudflare's create-token page with the office's permissions ticked: an account-owned token when the Account ID is known. */
export function cloudflareTokenUrl(accountId = ''): string {
  const keys = JSON.stringify(CLOUDFLARE_PERMISSIONS.map(({ key, type }) => ({ key, type })));
  const id = accountId.trim();
  return /^[0-9a-f]{32}$/i.test(id)
    ? `https://dash.cloudflare.com/?to=/${id}/api-tokens&${new URLSearchParams({ permissionGroupKeys: keys, name: 'cubefarm' })}`
    : `https://dash.cloudflare.com/profile/api-tokens?${new URLSearchParams({ permissionGroupKeys: keys, accountId: '*', zoneId: 'all', name: 'cubefarm' })}`;
}

/** The GitHub repository permissions the office's agents need (fine-grained token parameters). */
const GITHUB_PERMISSIONS: { key: string; level: 'read' | 'write'; plain: string }[] = [
  { key: 'contents', level: 'write', plain: 'Contents (write)' },
  { key: 'pull_requests', level: 'write', plain: 'Pull requests (write)' },
  { key: 'issues', level: 'write', plain: 'Issues (write)' },
  { key: 'actions', level: 'read', plain: 'Actions (read)' },
  { key: 'workflows', level: 'write', plain: 'Workflows (write)' },
  { key: 'metadata', level: 'read', plain: 'Metadata (read)' },
];

/** GitHub's new fine-grained token page, pre-filled: name, 90 days, the owner, every permission above. */
export function githubTokenUrl(owner = ''): string {
  const q = new URLSearchParams({ name: 'cubefarm', description: 'cubefarm office agents', expires_in: '90', ...(owner ? { target_name: owner } : {}) });
  for (const p of GITHUB_PERMISSIONS) q.set(p.key, p.level);
  return `https://github.com/settings/personal-access-tokens/new?${q}`;
}

/** The provider's create-key page, pre-filled where it can be. */
export function createKeyUrl(provider: string, o: { accountId?: string; owner?: string } = {}): string | null {
  if (provider === 'cloudflare') return cloudflareTokenUrl(o.accountId);
  if (provider === 'github') return githubTokenUrl(o.owner);
  return CREATE_URLS[provider] ?? null;
}

const CREATE_URLS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  'openai-audio': 'https://platform.openai.com/api-keys',
  'openai-images': 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
  'nano-banana': 'https://aistudio.google.com/apikey',
  'gemini-video': 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/settings/keys',
  groq: 'https://console.groq.com/keys',
  cerebras: 'https://cloud.cerebras.ai',
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
  runway: 'https://dev.runwayml.com',
  luma: 'https://lumalabs.ai/api/keys',
  hetzner: 'https://console.hetzner.cloud',
};

// ---------- guided setup cards ----------

const GUIDES: Record<string, SetupGuide> = {
  cloudflare: {
    keyKind: 'An API token from My Profile → API Tokens, not the Global API Key.',
    steps: [
      'Open the pre-filled token page: Zone read, DNS edit, Tunnel edit and Workers Scripts edit are already ticked.',
      'Pick your account and zones under Account and Zone Resources, then Continue to summary → Create Token.',
      'Copy the token (Cloudflare shows it once) and paste it here.',
      'Paste your Account ID (any domain → Overview, right column) so Test can check the account permissions.',
    ],
    limits: 'API tokens are free; 1,200 API calls per 5 minutes.',
    test: 'Verifies the token, then reads zones, DNS records, tunnels and Workers (nothing is changed).',
    accountId: { label: 'Account ID', hint: '32 characters, from any domain’s Overview page' },
  },
  github: {
    keyKind: 'A fine-grained personal access token (github_pat_…), limited to the repos the office works on.',
    steps: [
      'Open the pre-filled token page: name, 90 days and every permission the agents need are set.',
      'Under Repository access, pick the repos the office works on, then Generate token.',
      'Copy the token and paste it here.',
    ],
    limits: 'Free; 5,000 API calls an hour. The token stops working after 90 days: make a new one here.',
    test: 'Reads your user, then the first floor’s repo, pull requests, issues and Actions runs.',
  },
  anthropic: { steps: ['Open the Anthropic Console → API keys → Create key.', 'Paste it here.'], limits: 'Pay as you go; set a monthly limit under Billing.', test: 'Lists your models (free).' },
  openai: {
    steps: ['Open OpenAI → API keys → Create new secret key (All permissions, or Restricted with Model capabilities on).', 'Paste it here: the same key covers text, images, voice and transcription.'],
    limits: 'Pay as you go; new accounts start on a low usage tier.',
    test: 'Lists your models (free).',
  },
  gemini: {
    steps: ['Open Google AI Studio → Get API key → Create API key.', 'Paste it here: the same key covers Gemini, Nano Banana and Veo.'],
    limits: 'Free tier with daily limits; Veo and image models need billing on the Cloud project.',
    test: 'Lists your models (free).',
  },
  elevenlabs: {
    steps: ['Open ElevenLabs → Developers → API keys → Create key.', 'Turn on Text to Speech, Voices and Sound Effects for it.', 'Paste it here.'],
    limits: 'Free: about 10,000 characters a month; Starter about 30,000. Image & Video is a beta on paid plans.',
    test: 'Lists your voices (free).',
  },
  runway: { steps: ['Open the Runway developer portal → API keys → Create.', 'Add credits under Billing.', 'Paste it here.'], limits: 'Credits only; each tier caps generations a day.', test: 'Reads your organisation and credit balance (free).' },
  openrouter: { steps: ['Open OpenRouter → Keys → Create key (give it a credit limit).', 'Paste it here.'], limits: 'Credits; free models are rate-limited.', test: 'Reads the key’s credit (free).' },
  google: {
    steps: [
      'In Google Cloud Console → APIs & Services, turn on YouTube Data API v3, YouTube Analytics API, Drive API and Generative Language API.',
      'Credentials → Create credentials → OAuth client ID → Web application; add the redirect address shown below.',
      'Paste its Client ID and Client secret here, then Sign in with Google.',
    ],
    limits: 'YouTube: about 6 uploads a day on the default quota, and uploads stay private until Google audits the app.',
    test: 'Refreshes the sign-in and reads your Google account (free).',
  },
  meta: {
    steps: [
      'Your Instagram must be a Business or Creator account linked to a Facebook Page.',
      'At Meta for Developers, create a Business app and add Facebook Login; add the redirect address shown below.',
      'Paste its App ID and App secret here, then Sign in with Meta.',
    ],
    limits: 'Up to 100 API posts a day; tokens last 60 days and are renewed here before they run out.',
    test: 'Renews the sign-in and reads your account name (free).',
  },
  tiktok: {
    steps: ['At TikTok for Developers, create an app with Login Kit and Content Posting API; add the redirect address shown below.', 'Paste its Client key and Client secret here, then Sign in with TikTok.'],
    limits: 'Posts stay private (only you can see them) until TikTok audits the app.',
    test: 'Refreshes the sign-in and reads your TikTok name (free).',
  },
  microsoft: {
    steps: ['In Microsoft Entra → App registrations → New registration (any account type), Web redirect: the address shown below.', 'Certificates & secrets → New client secret; paste the Application ID and the secret here, then Sign in with Microsoft.'],
    limits: 'Free.',
    test: 'Refreshes the sign-in and reads your profile (free).',
  },
};

/** A provider's setup card: its own, or the plain three steps. */
export function setupGuide(provider: string): SetupGuide {
  const own = GUIDES[provider];
  if (own) return own;
  const name = providerDef(provider)?.name ?? provider;
  return { steps: [`Open ${name}'s console and create an API key.`, 'Paste it here.', 'Save and test.'], test: 'One free read-only call.' };
}

/** A company sign-in's client id is called… */
export const clientWords = (company: string) => (company === 'meta' ? ['App ID', 'App secret'] : company === 'tiktok' ? ['Client key', 'Client secret'] : company === 'microsoft' ? ['Application (client) ID', 'Client secret'] : ['Client ID', 'Client secret']);

// ---------- permission checks ----------

export interface CheckContext {
  accountId?: string; // Cloudflare
  zoneId?: string; // Cloudflare: learned from the zones check
  repo?: string; // GitHub: "owner/name", the first floor's
}

export interface PermissionStep {
  /** The permission it proves, in the manager's words. */
  perm: string;
  request: (ctx: CheckContext) => ProbeRequest | null; // null: skipped (no zone, no repo)
  /** What it learns for the next steps. */
  learn?: (r: ProbeResult, ctx: CheckContext) => void;
}

const CF = 'https://api.cloudflare.com/client/v4';
const GH = 'https://api.github.com';

/** The checks after a working test, in order. None for a provider whose key needs no permissions. */
export function permissionSteps(provider: string, key: string): PermissionStep[] {
  if (provider === 'cloudflare') {
    const get = (url: string): ProbeRequest => ({ kind: 'http', url, headers: { Authorization: `Bearer ${key}` } });
    return [
      {
        perm: 'Zone read',
        request: () => get(`${CF}/zones?per_page=1`),
        learn: (r, ctx) => {
          const z = (r.body as { result?: { id?: unknown }[] } | undefined)?.result?.[0]?.id;
          if (typeof z === 'string') ctx.zoneId = z;
        },
      },
      { perm: 'Zone DNS edit', request: (ctx) => (ctx.zoneId ? get(`${CF}/zones/${ctx.zoneId}/dns_records?per_page=1`) : null) },
      { perm: 'Cloudflare Tunnel edit', request: (ctx) => (ctx.accountId ? get(`${CF}/accounts/${ctx.accountId}/cfd_tunnel?per_page=1&is_deleted=false`) : null) },
      { perm: 'Workers Scripts edit', request: (ctx) => (ctx.accountId ? get(`${CF}/accounts/${ctx.accountId}/workers/scripts`) : null) },
    ];
  }
  if (provider === 'github') {
    const get = (url: string): ProbeRequest => ({ kind: 'http', url, headers: { Authorization: `Bearer ${key}`, Accept: 'application/vnd.github+json', 'User-Agent': 'cubefarm' } });
    return [
      { perm: 'Metadata (read)', request: (ctx) => (ctx.repo ? get(`${GH}/repos/${ctx.repo}`) : null) },
      { perm: 'Pull requests (read)', request: (ctx) => (ctx.repo ? get(`${GH}/repos/${ctx.repo}/pulls?per_page=1`) : null) },
      { perm: 'Issues (read)', request: (ctx) => (ctx.repo ? get(`${GH}/repos/${ctx.repo}/issues?per_page=1`) : null) },
      { perm: 'Actions (read)', request: (ctx) => (ctx.repo ? get(`${GH}/repos/${ctx.repo}/actions/runs?per_page=1`) : null) },
    ];
  }
  return [];
}

/** GitHub's own words for what a 403 lacked ("pull_requests=read" → "Pull requests (read)"). */
export function githubPermission(header: string | undefined): string | null {
  const first = header?.split(/[;,]/)[0]?.trim();
  const [name, level] = first?.split('=') ?? [];
  if (!name || !level) return null;
  const words = name.replace(/_/g, ' ');
  return `${words[0].toUpperCase()}${words.slice(1)} (${level})`;
}

/** The classic-token scopes the office needs that a /user answer's x-oauth-scopes doesn't list. */
export function missingClassicScopes(headers: Record<string, string> | undefined): string[] {
  const raw = headers?.['x-oauth-scopes'];
  if (raw === undefined) return []; // a fine-grained token: checked repo by repo
  const have = raw.split(',').map((s) => s.trim());
  return ['repo', 'workflow'].filter((s) => !have.includes(s)).map((s) => `${s} scope`);
}

/** What a step's answer says it lacks: null when it passed, or wasn't a permission problem. */
function stepMissing(provider: string, step: PermissionStep, r: ProbeResult): string | null {
  if (r.status >= 200 && r.status < 300) return null;
  if (provider === 'github' && (r.status === 403 || r.status === 404)) return githubPermission(r.headers?.['x-accepted-github-permissions']) ?? (r.status === 404 && step.perm === 'Metadata (read)' ? 'Repository access to this floor’s repo' : step.perm);
  return r.status === 401 || r.status === 403 ? step.perm : null;
}

/** Runs the steps one by one: every permission found missing. */
export async function runPermissionSteps(provider: string, steps: readonly PermissionStep[], probe: (req: ProbeRequest) => Promise<ProbeResult>, ctx: CheckContext): Promise<string[]> {
  const missing: string[] = [];
  for (const step of steps) {
    const req = step.request(ctx);
    if (!req) continue;
    const r = await probe(req);
    step.learn?.(r, ctx);
    const m = stepMissing(provider, step, r);
    if (m && !missing.includes(m)) missing.push(m);
  }
  return missing;
}

/** The main test's note when the provider turned the key away, said for its kind of key instead of "401". */
export function turnedAwayNote(provider: string, status: number): string | null {
  if (status !== 400 && status !== 401 && status !== 403) return null;
  if (provider === 'cloudflare') return `Turned away (${status}): use an API token from My Profile → API Tokens, not the Global API Key`;
  if (provider === 'github') return `Turned away (${status}): the token is expired or revoked; make a new one from the pre-filled link`;
  return null;
}

/** A test's note with what's missing: "Missing: Zone DNS edit, Workers Scripts edit". */
export const missingNote = (missing: readonly string[]) => `Missing: ${missing.join(', ')}`;

/** Cloudflare's verify call: an account-owned token's when the Account ID is known (#533), else a user token's. */
export function cloudflareVerify(key: string, accountId = ''): Extract<ProbeRequest, { kind: 'http' }> {
  const id = accountId.trim();
  return { kind: 'http', url: id ? `${CF}/accounts/${id}/tokens/verify` : `${CF}/user/tokens/verify`, headers: { Authorization: `Bearer ${key}` } };
}
