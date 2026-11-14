// Settings → Providers (#362), pure: the catalogue of providers the office knows, each one's cheap read-only test
// call, every connection as one card (Claude and Codex accounts, the ElevenLabs and Upstash keys from their own stores,
// keys added here, MCP servers), the CEO's one line, and the MCP servers a session gets. Adding a provider = one entry
// in PROVIDERS, plus a usage reader in testUsage when it has a usage API.
import { cardPlan } from './accounts.ts';
import { secretMismatch } from './secretFormats.ts';
import { USE_CASES } from './useCases.ts';
import { INSTALL_TARGETS, RENEW_NOTE } from './keyInstall.ts';
import { parseServiceAccount } from './gcloud.ts';
import type { AccountView, AgentCli, CloudView, CliView, KeyCheck, McpServerConfig, ProviderAuth, ProviderCategory, ProvidersView, ProviderTest, ProviderUse, UsageProvider, UsageSource, UsageWindow } from './types.ts';

/** Where a provider's key or login lives: its old store (whose settings stay where they were) or the Providers page. */
type ProviderHome = 'accounts' | 'voice' | 'cloud' | 'providers' | 'own-setup';

export interface ProviderDef {
  id: string;
  name: string;
  category: ProviderCategory;
  auth: ProviderAuth;
  home: ProviderHome;
  /** The environment variable the provider's own tools read the key from. */
  keyEnv?: string;
  placeholder?: string;
  docsUrl: string;
  /** Its row on the usage card (#361). */
  usage?: UsageProvider;
  /** Its usage row's note when its test tells no usage. */
  usageNote?: string;
  /** Another catalogue entry whose saved key it can reuse: an empty key field takes that one's key. */
  sharesKeyWith?: string;
  /** A Lucide icon name (client/src/ui/icons.ts has it). */
  icon?: string;
  blurb: string;
  /** A line on its add form, after the blurb. */
  note?: string;
}

export const CATEGORIES: { id: ProviderCategory; label: string }[] = [
  { id: 'coding', label: 'Coding agents' },
  { id: 'text', label: 'Text' },
  { id: 'audio', label: 'Audio' },
  { id: 'video', label: 'Video' },
  { id: 'image', label: 'Image' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'signin', label: 'Company sign-ins' },
  { id: 'mcp', label: 'MCP servers' },
];

export const PROVIDERS: ProviderDef[] = [
  { id: 'claude', name: 'Claude Code', category: 'coding', auth: 'login', home: 'accounts', docsUrl: 'https://docs.claude.com/en/docs/claude-code', usage: 'claude', blurb: 'Claude subscription logins, Anthropic API keys and setup tokens for agents' },
  { id: 'codex', name: 'Codex', category: 'coding', auth: 'login', home: 'accounts', docsUrl: 'https://developers.openai.com/codex', usage: 'codex', blurb: 'ChatGPT plan logins and OpenAI API keys for agents' },
  { id: 'opencode', name: 'OpenCode', category: 'coding', auth: 'none', home: 'own-setup', docsUrl: 'https://opencode.ai/docs', blurb: 'Runs with its own setup (opencode auth login)' },
  { id: 'gemini-cli', name: 'Gemini CLI', category: 'coding', auth: 'login', home: 'accounts', docsUrl: 'https://geminicli.com/docs', blurb: 'Google AI plan logins (Plus or Pro), for QA second opinions, docs, research and small fixes' },
  { id: 'anthropic', name: 'Anthropic API', category: 'text', auth: 'api-key', home: 'providers', keyEnv: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-…', docsUrl: 'https://docs.claude.com/en/api/overview', usage: 'anthropic', blurb: 'Claude models over the API' },
  { id: 'openai', name: 'OpenAI API', category: 'text', auth: 'api-key', home: 'providers', keyEnv: 'OPENAI_API_KEY', placeholder: 'sk-…', docsUrl: 'https://platform.openai.com/docs/api-reference', usage: 'openai', blurb: 'GPT models over the API' },
  { id: 'gemini', name: 'Google Gemini API', category: 'text', auth: 'api-key', home: 'providers', keyEnv: 'GEMINI_API_KEY', placeholder: 'AIza…', docsUrl: 'https://ai.google.dev/gemini-api/docs', usage: 'gemini', blurb: 'Gemini models over the API' },
  { id: 'openrouter', name: 'OpenRouter', category: 'text', auth: 'api-key', home: 'providers', keyEnv: 'OPENROUTER_API_KEY', placeholder: 'sk-or-…', docsUrl: 'https://openrouter.ai/docs', usage: 'openrouter', blurb: 'Many models behind one key, with its credit' },
  { id: 'groq', name: 'Groq', category: 'text', auth: 'api-key', home: 'providers', keyEnv: 'GROQ_API_KEY', placeholder: 'gsk_…', docsUrl: 'https://console.groq.com/docs', blurb: 'Fast open models over the API' },
  { id: 'cerebras', name: 'Cerebras', category: 'text', auth: 'api-key', home: 'providers', keyEnv: 'CEREBRAS_API_KEY', placeholder: 'csk-…', docsUrl: 'https://inference-docs.cerebras.ai', blurb: 'Fast open models over the API' },
  { id: 'nvidia', name: 'NVIDIA NIM', category: 'text', auth: 'api-key', home: 'providers', keyEnv: 'NVIDIA_API_KEY', placeholder: 'nvapi-…', docsUrl: 'https://docs.api.nvidia.com', blurb: "Models on NVIDIA's API catalogue" },
  { id: 'aihubmix', name: 'AIHubMix', category: 'text', auth: 'api-key', home: 'providers', keyEnv: 'AIHUBMIX_API_KEY', placeholder: 'sk-…', docsUrl: 'https://docs.aihubmix.com', blurb: 'Many models behind one OpenAI-style key' },
  { id: 'elevenlabs', name: 'ElevenLabs', category: 'audio', auth: 'api-key', home: 'voice', keyEnv: 'ELEVENLABS_API_KEY', placeholder: 'sk_…', docsUrl: 'https://elevenlabs.io/docs', usage: 'elevenlabs', blurb: 'Voices for agents and messages read aloud' },
  { id: 'openai-audio', name: 'OpenAI TTS & Whisper', category: 'audio', auth: 'api-key', home: 'providers', keyEnv: 'OPENAI_API_KEY', placeholder: 'sk-…', docsUrl: 'https://platform.openai.com/docs/guides/text-to-speech', usage: 'openai', blurb: 'Speech and transcription over the OpenAI API' },
  { id: 'nano-banana', name: 'Nano Banana (Gemini image)', category: 'image', auth: 'api-key', home: 'providers', keyEnv: 'GEMINI_API_KEY', placeholder: 'AIza…', docsUrl: 'https://ai.google.dev/gemini-api/docs/image-generation', usage: 'gemini', usageNote: 'No balance API: the office ledger counts its spend', sharesKeyWith: 'gemini', icon: 'banana', blurb: 'Gemini image generation and editing over the Gemini API key', note: "Google AI Plus's Nano Banana and Veo work only in the Gemini app and Flow, not through the API: it takes a Gemini API key." },
  { id: 'openai-images', name: 'OpenAI Images', category: 'image', auth: 'api-key', home: 'providers', keyEnv: 'OPENAI_API_KEY', placeholder: 'sk-…', docsUrl: 'https://platform.openai.com/docs/guides/image-generation', usage: 'openai', usageNote: 'No balance API: the office ledger counts its spend', sharesKeyWith: 'openai', icon: 'image', blurb: 'GPT Image generation and editing over the OpenAI API key' },
  { id: 'runway', name: 'Runway', category: 'video', auth: 'api-key', home: 'providers', keyEnv: 'RUNWAYML_API_SECRET', placeholder: 'key_…', docsUrl: 'https://docs.dev.runwayml.com/guides/setup/', usage: 'runway', blurb: 'Gen-4 video with its credit balance' },
  { id: 'gemini-video', name: 'Google video (Gemini API)', category: 'video', auth: 'api-key', home: 'providers', keyEnv: 'GEMINI_API_KEY', placeholder: 'AIza…', docsUrl: 'https://ai.google.dev/gemini-api/docs/video', usage: 'gemini', usageNote: 'No balance API: the office ledger counts its spend', sharesKeyWith: 'gemini', blurb: 'Gemini Omni video over the Gemini API key' },
  { id: 'luma', name: 'Luma Dream Machine', category: 'video', auth: 'api-key', home: 'providers', keyEnv: 'LUMAAI_API_KEY', placeholder: 'luma-…', docsUrl: 'https://docs.lumalabs.ai/docs/api', usage: 'luma', usageNote: 'No balance in its answer: the office ledger counts its spend', blurb: 'Ray video on credits shared with the Luma app' },
  { id: 'kling', name: 'Kling', category: 'video', auth: 'api-key', home: 'providers', keyEnv: 'KLING_ACCESS_KEY', placeholder: 'access key:secret key', docsUrl: 'https://app.klingai.com/global/dev/document-api', usage: 'kling', usageNote: 'No resource pack on the account', blurb: 'Kling video on resource packs' },
  // No OpenAI Sora: its API was removed on 2026-09-24 with no successor. Don't add it back.
  { id: 'upstash', name: 'Upstash Box', category: 'cloud', auth: 'api-key', home: 'cloud', docsUrl: 'https://upstash.com/docs/box', usage: 'upstash', blurb: 'Cloud machines for cloud agents' },
  { id: 'cloudflare', name: 'Cloudflare', category: 'cloud', auth: 'api-key', home: 'providers', keyEnv: 'CLOUDFLARE_API_TOKEN', placeholder: 'API token', docsUrl: 'https://developers.cloudflare.com/fundamentals/api/', blurb: 'DNS, tunnels and Workers' },
  // #622: a service account's JSON key file, saved by the office from the file sent to it (save_provider_key's file)
  { id: 'gcloud', name: 'Google Cloud', category: 'cloud', auth: 'api-key', home: 'providers', placeholder: "the service account's JSON", docsUrl: 'https://cloud.google.com/iam/docs/service-account-overview', blurb: 'A service account the office enables APIs and makes restricted API keys with', note: 'Send the JSON key file to the office in chat: it saves it here and deletes the file.' },
  { id: 'github', name: 'GitHub token', category: 'cloud', auth: 'api-key', home: 'providers', keyEnv: 'GITHUB_TOKEN', placeholder: 'ghp_… or github_pat_…', docsUrl: 'https://docs.github.com/en/rest', blurb: 'A personal access token for the GitHub API' },
  { id: 'entra', name: 'Microsoft Entra', category: 'cloud', auth: 'api-key', home: 'providers', placeholder: 'client id:client secret', docsUrl: 'https://developers.cloudflare.com/cloudflare-one/identity/idp-integration/entra-id/', icon: 'id-card', blurb: 'Entra ID sign-in for Cloudflare Access, set up by the office', note: 'Only the tenant you enter here is used.' },
  // #609: keys services on this machine use; IT installs them into the services' env files (install_key)
  { id: 'twitch', name: 'Twitch', category: 'cloud', auth: 'api-key', home: 'providers', keyEnv: 'TWITCH_CLIENT_ID', placeholder: 'client ID:client secret', docsUrl: 'https://dev.twitch.tv/docs/authentication/register-app/', blurb: "A Twitch app's client ID and secret, for streams and clips", note: 'Paste the client ID, a colon, then the client secret.' },
  { id: 'youtube', name: 'YouTube Data API', category: 'cloud', auth: 'api-key', home: 'providers', keyEnv: 'YOUTUBE_API_KEY', placeholder: 'AIza…', docsUrl: 'https://developers.google.com/youtube/v3/getting-started', blurb: 'An API key for reading YouTube videos, channels and search' },
  { id: 'postiz', name: 'Postiz', category: 'cloud', auth: 'api-key', home: 'providers', keyEnv: 'POSTIZ_API_KEY', placeholder: 'API key', docsUrl: 'https://docs.postiz.com/public-api', blurb: "Scheduling posts through Postiz's public API" },
  { id: 'other-key', name: 'Other key', category: 'cloud', auth: 'api-key', home: 'providers', placeholder: 'the key', docsUrl: '', blurb: 'Any other key: its name, its value and what uses it' },
  { id: 'hetzner', name: 'Hetzner Cloud', category: 'cloud', auth: 'api-key', home: 'providers', keyEnv: 'HCLOUD_TOKEN', placeholder: 'API token', docsUrl: 'https://docs.hetzner.cloud', usage: 'hetzner', blurb: 'Servers on Hetzner Cloud' },
  // One sign-in per company (#533): every scope the office needs in one consent (shared/oauth.ts).
  { id: 'google', name: 'Google', category: 'signin', auth: 'oauth', home: 'providers', docsUrl: 'https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps', icon: 'id-card', blurb: 'Gemini, Imagen, Veo, YouTube upload and analytics, Drive read: one sign-in' },
  { id: 'meta', name: 'Meta', category: 'signin', auth: 'oauth', home: 'providers', docsUrl: 'https://developers.facebook.com/docs/instagram-platform/content-publishing', icon: 'id-card', blurb: 'Instagram publishing and insights: one sign-in' },
  { id: 'tiktok', name: 'TikTok', category: 'signin', auth: 'oauth', home: 'providers', docsUrl: 'https://developers.tiktok.com/doc/content-posting-api-get-started', icon: 'id-card', blurb: 'TikTok uploads and posts: one sign-in' },
  { id: 'microsoft', name: 'Microsoft', category: 'signin', auth: 'oauth', home: 'providers', docsUrl: 'https://learn.microsoft.com/en-us/graph/auth-v2-user', icon: 'id-card', blurb: 'OneDrive files read: one sign-in' },
];

export const providerDef = (id: string) => PROVIDERS.find((p) => p.id === id);

// ---------- what a key is for (#523) ----------

export const USES: { id: ProviderUse; label: string; blurb: string }[] = [
  { id: 'inference', label: 'AI inference', blurb: 'Text, image, video and voice models' },
  { id: 'operations', label: 'Operations', blurb: 'DNS, tunnels, hosting, GitHub, storage, notifications' },
  { id: 'both', label: 'Both', blurb: 'Models and operations' },
];

export const isProviderUse = (v: unknown): v is ProviderUse => USES.some((u) => u.id === v);

/** A key's default: cloud keys and MCP servers run things, a company sign-in does both, every other category is a model. */
export const defaultUse = (category: ProviderCategory): ProviderUse => (category === 'cloud' || category === 'mcp' ? 'operations' : category === 'signin' ? 'both' : 'inference');

/** Whether a card shows under the Used for filter: "Both" shows under either. */
export const usedForMatches = (use: ProviderUse | undefined, filter: ProviderUse | 'all') => filter === 'all' || use === filter || (use === 'both' && filter !== 'both');

/** A connection's last test as live, dead or no credit; tests saved before #523 have only ok. */
const testCheck = (t: ProviderTest | null): KeyCheck => (!t ? 'unknown' : (t.result ?? (t.ok ? 'live' : 'dead')));

/** The provider an OpenCode model id runs on ("openrouter/…", "google/gemini-…"), or undefined. */
const MODEL_PROVIDER: [RegExp, string][] = [
  [/^(google\/|gemini)/i, 'gemini'],
  [/^openai\//i, 'openai'],
  [/^anthropic\//i, 'anthropic'],
  [/^openrouter\//i, 'openrouter'],
];
export const modelProvider = (model: string) => MODEL_PROVIDER.find(([re]) => re.test(model))?.[1];

// ---------- test calls ----------

/**
 * The live image models each image entry's test looks for (docs, 2026-11). Left out: Imagen (shut down), dall-e-2/3 and
 * gpt-image-1 (shut down), gpt-image-1-mini, gpt-image-1.5 and chatgpt-image-latest (removed 2026-12-01).
 */
export const IMAGE_MODELS: Record<string, string[]> = {
  'nano-banana': ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image'],
  'openai-images': ['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2'],
};

/**
 * One cheap read-only call: an HTTP GET with the key in a header, or a command looked up on the PATH; or a sign-in's
 * token exchange (#533), the one POST, to the company's token URL only.
 */
export type ProbeRequest = { kind: 'http'; url: string; headers: Record<string, string> } | { kind: 'command'; command: string } | { kind: 'form'; url: string; form: Record<string, string> };
export interface ProbeResult {
  status: number; // HTTP status; 0 unreachable; 200 a command found
  body?: unknown;
  /** The answer's permission headers (GitHub's x-oauth-scopes and x-accepted-github-permissions), lower-cased. */
  headers?: Record<string, string>;
}

const RUNWAY_VERSION = '2024-11-06';
const DAY = 24 * 60 * 60_000;

/**
 * The test call for a key the Providers page saves, or null when its home tests it (accounts, voice, cloud). Every one
 * is a GET that reads. Kling's `key` is its API key or the JWT signed from its access key and secret (server/providers.ts).
 */
export function testRequest(provider: string, key: string, now = Date.now()): ProbeRequest | null {
  const bearer = { Authorization: `Bearer ${key}` };
  switch (provider) {
    case 'anthropic':
      return { kind: 'http', url: 'https://api.anthropic.com/v1/models?limit=1', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } };
    case 'openai':
    case 'openai-audio':
    case 'openai-images':
      return { kind: 'http', url: 'https://api.openai.com/v1/models', headers: bearer };
    case 'gemini':
      return { kind: 'http', url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', headers: { 'x-goog-api-key': key } };
    case 'gemini-video':
    case 'nano-banana':
      return { kind: 'http', url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', headers: { 'x-goog-api-key': key } };
    case 'runway':
      return { kind: 'http', url: 'https://api.dev.runwayml.com/v1/organization', headers: { ...bearer, 'X-Runway-Version': RUNWAY_VERSION } };
    case 'luma':
      return { kind: 'http', url: 'https://api.lumalabs.ai/dream-machine/v1/credits', headers: bearer };
    case 'kling':
      return { kind: 'http', url: `https://api-singapore.klingai.com/account/costs?start_time=${now - 30 * DAY}&end_time=${now}`, headers: bearer };
    case 'openrouter':
      return { kind: 'http', url: 'https://openrouter.ai/api/v1/key', headers: bearer };
    case 'hetzner':
      return { kind: 'http', url: 'https://api.hetzner.cloud/v1/servers?per_page=1', headers: bearer };
    case 'groq':
      return { kind: 'http', url: 'https://api.groq.com/openai/v1/models', headers: bearer };
    case 'cerebras':
      return { kind: 'http', url: 'https://api.cerebras.ai/v1/models', headers: bearer };
    case 'nvidia': // its /v1/models answers without a key: the functions list doesn't
      return { kind: 'http', url: 'https://api.nvcf.nvidia.com/v2/nvcf/functions', headers: bearer };
    case 'aihubmix':
      return { kind: 'http', url: 'https://aihubmix.com/v1/models', headers: bearer };
    case 'cloudflare':
      return { kind: 'http', url: 'https://api.cloudflare.com/client/v4/user/tokens/verify', headers: bearer };
    case 'twitch': {
      // an app access token for the pair: the one POST, to Twitch's token URL
      const i = key.indexOf(':');
      return { kind: 'form', url: 'https://id.twitch.tv/oauth2/token', form: { client_id: key.slice(0, Math.max(0, i)), client_secret: key.slice(i + 1), grant_type: 'client_credentials' } };
    }
    case 'youtube':
      return { kind: 'http', url: 'https://www.googleapis.com/youtube/v3/i18nRegions?part=snippet&hl=en', headers: { 'x-goog-api-key': key } };
    case 'github':
      return { kind: 'http', url: 'https://api.github.com/user', headers: { ...bearer, Accept: 'application/vnd.github+json', 'User-Agent': 'cubefarm' } };
    // a company sign-in's `key` is its access token, refreshed on the server first
    case 'google':
      return { kind: 'http', url: 'https://openidconnect.googleapis.com/v1/userinfo', headers: bearer };
    case 'meta':
      return { kind: 'http', url: 'https://graph.facebook.com/v21.0/me?fields=name', headers: bearer };
    case 'tiktok':
      return { kind: 'http', url: 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', headers: bearer };
    case 'microsoft':
      return { kind: 'http', url: 'https://graph.microsoft.com/v1.0/me', headers: bearer };
    default:
      return null;
  }
}

/** What a test's answer says, in one plain line. */
export function testNote(r: ProbeResult): { ok: boolean; note: string } {
  if (r.status >= 200 && r.status < 300) return { ok: true, note: 'Key works' };
  if (r.status === 401 || r.status === 403) return { ok: false, note: `Turned away (${r.status}): check the key` };
  if (r.status === 0) return { ok: false, note: "Couldn't reach the provider" };
  return { ok: false, note: `The provider answered ${r.status}` };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const pct = (used: number, limit: number) => Math.min(100, Math.max(0, Math.round((used / limit) * 100)));

/**
 * Usage from a test call's answer, where the provider tells: OpenRouter's credit, Runway's credit balance and each
 * model's generations today, Luma's credit balance (cents), Kling's live resource packs.
 */
export function testUsage(provider: string, body: unknown, now = Date.now()): UsageWindow[] {
  const b = obj(body);
  switch (provider) {
    case 'openrouter': {
      const d = obj(b.data);
      const used = num(d.usage);
      const limit = num(d.limit);
      if (!Number.isFinite(used)) return [];
      return [{ name: 'Credit', usedPct: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null, used, ...(limit > 0 ? { limit } : {}), unit: '$', resetsAt: null }];
    }
    case 'runway': {
      const balance = num(b.creditBalance);
      if (!Number.isFinite(balance)) return [];
      const caps = obj(obj(b.tier).models);
      const days = Object.entries(obj(obj(b.usage).models)).flatMap(([model, u]): UsageWindow[] => {
        const used = num(obj(u).dailyGenerations);
        const limit = num(obj(caps[model]).maxDailyGenerations);
        return used > 0 && limit > 0 ? [{ name: `${model} today`, usedPct: pct(used, limit), used, limit, unit: 'videos', resetsAt: null }] : [];
      });
      return [{ name: 'Balance', usedPct: null, used: balance, unit: 'credits', resetsAt: null }, ...days];
    }
    case 'luma': {
      const cents = num(b.credit_balance);
      return Number.isFinite(cents) ? [{ name: 'Balance', usedPct: null, used: Math.round(cents) / 100, unit: '$', resetsAt: null }] : [];
    }
    case 'kling': {
      const packs = obj(b.data).resource_pack_subscribe_infos;
      return (Array.isArray(packs) ? packs : []).flatMap((raw): UsageWindow[] => {
        const p = obj(raw);
        const total = num(p.total_quantity);
        const left = num(p.remaining_quantity);
        const ends = num(p.invalid_time);
        if (!(total > 0) || !Number.isFinite(left) || (ends > 0 && ends <= now)) return [];
        return [{ name: typeof p.resource_pack_name === 'string' && p.resource_pack_name ? p.resource_pack_name : 'Resource pack', usedPct: pct(total - left, total), used: Math.round((total - left) * 100) / 100, limit: total, unit: 'units', resetsAt: ends > 0 ? ends : null }];
      });
    }
    default:
      return [];
  }
}

/** Video models a Gemini models.list answer names: models.list only lists live ones, so retired Veo previews drop out. */
export function geminiVideoModels(body: unknown): string[] {
  const models = obj(body).models;
  return (Array.isArray(models) ? models : []).map((m) => String(obj(m).name ?? '').replace(/^models\//, '')).filter((n) => /veo|omni/i.test(n));
}

/** The catalogue's image models a models list names (Gemini's `models: [{ name: 'models/…' }]`, OpenAI's `data: [{ id }]`). */
export function imageModels(provider: string, body: unknown): string[] {
  const b = obj(body);
  const list = Array.isArray(b.models) ? b.models : Array.isArray(b.data) ? b.data : [];
  const ids = new Set(list.map((m) => String(obj(m).name ?? obj(m).id ?? '').replace(/^models\//, '')));
  return (IMAGE_MODELS[provider] ?? []).filter((id) => ids.has(id));
}

/** The plan a test's answer tells: Runway's monthly credit cap, Gemini's live video models, the key's image models. */
export function testPlan(provider: string, body: unknown): string | undefined {
  if (IMAGE_MODELS[provider]) {
    const models = imageModels(provider, body);
    return models.length ? models.slice(0, 3).join(', ') + (models.length > 3 ? ` +${models.length - 3}` : '') : 'No image models on this key';
  }
  if (provider === 'runway') {
    const cap = num(obj(obj(body).tier).maxMonthlyCreditSpend);
    return Number.isFinite(cap) ? `Up to ${cap.toLocaleString('en-US')} credits a month` : undefined;
  }
  if (provider === 'gemini-video') {
    const models = geminiVideoModels(body);
    return models.length ? models.slice(0, 3).join(', ') : 'No video models on this key';
  }
  // a sign-in's account
  const b = obj(body);
  const who = provider === 'google' ? b.email : provider === 'meta' ? b.name : provider === 'tiktok' ? obj(obj(b.data).user).display_name : provider === 'microsoft' ? (b.userPrincipalName ?? b.mail) : undefined;
  return typeof who === 'string' && who ? who : undefined;
}

/** Why a pasted key can't be saved for `provider`, or null. */
export function keyProblem(provider: string, raw: string): string | null {
  const key = raw.trim();
  const def = providerDef(provider);
  if (!def || def.home !== 'providers') return 'Pick a provider from the list.';
  if (def.auth === 'oauth') return `${def.name} connects with Sign in with ${def.name}, not a key.`;
  if (!key) return 'Paste the key first.';
  if (provider === 'twitch' && !/^[^:]+:[^:]+$/.test(key)) return 'Paste the client ID, a colon, then the client secret.';
  if (provider === 'kling' && key.split(':').length > 2) return 'Paste the access key, a colon, then the secret key (or one API key).';
  if (provider === 'gcloud') {
    const sa = parseServiceAccount(key);
    return typeof sa === 'string' ? sa : null;
  }
  if (key.length > 400 || /\s/.test(key)) return "That doesn't look like a key.";
  if (provider === 'anthropic') return secretMismatch('anthropic', key);
  if (provider === 'openai' || provider === 'openai-audio' || provider === 'openai-images') return key.startsWith('sk-ant-') || key.startsWith('sk-or-') ? 'This looks like another provider’s key, not an OpenAI one.' : secretMismatch('openai', key);
  if (provider === 'openrouter' && !key.startsWith('sk-or-')) return 'OpenRouter keys start with sk-or-.';
  return null;
}

/** A key's last 4 characters; a service account's JSON (#622): its private key id's. */
export function keyHint(key: string): string {
  const sa = key.startsWith('{') ? parseServiceAccount(key) : null;
  if (sa && typeof sa !== 'string') return sa.privateKeyId.slice(-4);
  return key ? key.slice(-4) : '';
}

// ---------- cards ----------

export type CardStatus = 'ready' | 'near' | 'limited' | 'signed-out' | 'error' | 'untested' | 'paused' | 'off';

/** One connection on the Providers page, wherever it's stored. */
export interface ProviderCard {
  key: string; // 'account:<id>', 'voice', 'cloud', 'connection:<id>', 'mcp:<id>', 'cli:opencode'
  provider: string;
  name: string;
  label: string;
  category: ProviderCategory;
  status: CardStatus;
  note: string;
  plan: string;
  keyHint: string;
  uses: string[]; // "What uses it": agents' names, Voice, Cloud agents…
  usageId?: string; // its row on the usage card
  warning?: string; // a Claude login signed in with another plan than its name says (#442)
  check: KeyCheck; // live, dead, no credit or not tested, for the Status filter (#523)
  usedFor?: ProviderUse; // none for MCP servers
  tags?: string[];
  source?: string; // where an imported key came from
  testedAt?: number;
  scopes?: string[]; // a company sign-in's granted scopes (#533)
  missing?: string[]; // permissions its last test found missing (#533)
  accountId?: string; // a key's Account ID / Tenant ID (#677), not a secret
  expiresAt?: number; // a key's expiry (#609), drawn with shared/keyInstall.ts' expiryLine
  renews?: boolean; // the office made it and renews it (#609)
  renewNote?: string; // what the provider's API lets the office do about its keys (#609)
  /** Where it's changed: its old settings section, or here. */
  settings: 'accounts' | 'voice' | 'cloud-agents' | 'tools' | null;
}

export interface CardInput {
  accounts: readonly AccountView[];
  voiceKeySet: boolean;
  voiceKeyHint: string;
  cloud: CloudView;
  providers: ProvidersView;
  clis: readonly CliView[];
  /** An agent's name by id (the CEO's too). */
  agentName: (id: string) => string;
  /** Agents running in a cloud machine. */
  cloudAgents: number;
  /** Floors and their use cases, and agents on OpenCode, for a key's "Used by" (#523). */
  floors?: readonly { name: string; useCase: string | null }[];
  agents?: readonly { name: string; cli: AgentCli | ''; model: string }[];
}

const ACCOUNT_STATUS: Record<AccountView['status'], CardStatus> = { ready: 'ready', near: 'near', limited: 'limited', 'signed-out': 'signed-out', paused: 'paused' };
const CHECK_STATUS: Partial<Record<KeyCheck, CardStatus>> = { live: 'ready', dead: 'error', 'no-credit': 'limited' };
const STATUS_CHECK: Record<CardStatus, KeyCheck> = { ready: 'live', near: 'live', limited: 'no-credit', 'signed-out': 'dead', error: 'dead', untested: 'unknown', paused: 'unknown', off: 'unknown' };

/** What uses a saved key today: floors whose work needs its kind of model, agents whose OpenCode model runs on it. */
export function connectionUsers(provider: string, i: Pick<CardInput, 'floors' | 'agents'>): string[] {
  const def = providerDef(provider);
  if (!def) return [];
  const floors = (i.floors ?? []).filter((f) => USE_CASES.find((u) => u.id === f.useCase)?.providers.includes(def.category)).map((f) => `${f.name} floor`);
  const agents = (i.agents ?? []).filter((a) => a.cli === 'opencode' && modelProvider(a.model) === provider).map((a) => `${a.name} (OpenCode)`);
  return [...floors, ...agents];
}

/** Every connection as a card, by the catalogue's order. Nothing in it is a secret. */
export function providerCards(i: CardInput): ProviderCard[] {
  const out: ProviderCard[] = [];
  for (const a of i.accounts) {
    if (a.removing) continue;
    const provider = a.cli === 'gemini' ? 'gemini-cli' : a.cli; // 'gemini' is the Gemini API's card
    const def = providerDef(provider)!;
    out.push({
      key: `account:${a.id}`,
      provider,
      name: def.name,
      label: a.label,
      category: 'coding',
      status: ACCOUNT_STATUS[a.status],
      note: a.kind === 'api-key' ? 'API key' : a.kind === 'setup-token' ? 'Setup token' : 'Subscription login',
      plan: [cardPlan(a), a.sameAs && `same subscription as ${a.sameAs}`, a.tokenRefresh && 'token refreshes on its next session'].filter(Boolean).join(' · '),
      keyHint: a.keyHint,
      uses: a.agents.length ? a.agents.map(i.agentName) : a.enabled ? ['Agents on the rotation'] : [],
      usageId: a.id,
      settings: 'accounts',
      check: STATUS_CHECK[ACCOUNT_STATUS[a.status]],
      usedFor: 'inference',
      tags: a.tags,
      ...(a.planWarning ? { warning: a.planWarning } : {}),
    });
  }
  if (i.clis.some((c) => c.id === 'opencode' && c.installed)) {
    out.push({ key: 'cli:opencode', provider: 'opencode', name: 'OpenCode', label: 'OpenCode', category: 'coding', status: 'ready', note: 'Its own setup on this computer', plan: '', keyHint: '', uses: [], settings: null, check: 'live', usedFor: 'inference' });
  }
  if (i.voiceKeySet) {
    out.push({ key: 'voice', provider: 'elevenlabs', name: 'ElevenLabs', label: 'ElevenLabs', category: 'audio', status: 'ready', note: 'API key', plan: '', keyHint: i.voiceKeyHint, uses: ['Voice'], usageId: 'elevenlabs', settings: 'voice', check: 'live', usedFor: 'inference', renewNote: RENEW_NOTE.elevenlabs });
  }
  if (i.cloud.keySet) {
    out.push({
      key: 'cloud',
      provider: 'upstash',
      name: 'Upstash Box',
      label: 'Upstash Box',
      category: 'cloud',
      status: i.cloud.keyError ? 'error' : 'ready',
      note: i.cloud.keyError ?? 'API key',
      plan: '',
      keyHint: i.cloud.keyHint,
      uses: i.cloudAgents ? [`Cloud agents (${i.cloudAgents})`] : ['Cloud agents'],
      usageId: 'upstash',
      settings: 'cloud-agents',
      check: i.cloud.keyError ? 'dead' : 'live',
      usedFor: 'operations',
      renewNote: RENEW_NOTE.upstash,
    });
  }
  // a provider's keys side by side, so duplicates read together
  const byCatalogue = (p: string) => PROVIDERS.findIndex((x) => x.id === p);
  for (const c of [...i.providers.connections].sort((a, b) => byCatalogue(a.provider) - byCatalogue(b.provider))) {
    const def = providerDef(c.provider);
    if (!def) continue;
    out.push({
      key: `connection:${c.id}`,
      provider: c.provider,
      name: def.name,
      label: c.label,
      category: def.category,
      status: c.test?.missing?.length && c.test.ok ? 'near' : (CHECK_STATUS[testCheck(c.test)] ?? (!c.test ? 'untested' : c.test.ok ? 'ready' : 'error')),
      note: c.test?.note ?? 'Not tested yet',
      plan: c.test?.plan ?? 'API',
      keyHint: c.keyHint,
      uses: [...connectionUsers(c.provider, i), ...(c.usedBy ? [c.usedBy] : []), ...(c.installs ?? []).map((x) => `${INSTALL_TARGETS.find((t) => t.file === x.file)?.name ?? x.file} (${x.var})`)],
      usageId: `provider:${c.id}`,
      settings: null,
      check: testCheck(c.test),
      usedFor: c.usedFor,
      tags: c.tags,
      ...(c.source ? { source: c.source } : {}),
      ...(c.test ? { testedAt: c.test.at } : {}),
      ...(c.scopes ? { scopes: c.scopes } : {}),
      ...(c.accountId ? { accountId: c.accountId } : {}),
      ...(c.test?.missing?.length ? { missing: c.test.missing } : {}),
      ...(c.expiresAt && def.category !== 'signin' ? { expiresAt: c.expiresAt } : {}),
      ...(c.mint ? { renews: true } : RENEW_NOTE[c.provider] ? { renewNote: RENEW_NOTE[c.provider] } : {}),
    });
  }
  for (const m of i.providers.mcp) {
    out.push({
      key: `mcp:${m.id}`,
      provider: 'mcp',
      name: m.name,
      label: m.name,
      category: 'mcp',
      status: !m.on ? 'off' : !m.test ? 'untested' : m.test.ok ? 'ready' : 'error',
      note: m.url ?? [m.command, ...(m.args ?? [])].join(' '),
      plan: '',
      keyHint: '',
      uses: m.agents.length ? m.agents.map(i.agentName) : ['Every agent'],
      settings: null,
      check: !m.on ? 'unknown' : testCheck(m.test),
    });
  }
  const order = (c: ProviderCard) => CATEGORIES.findIndex((x) => x.id === c.category);
  return out.sort((a, b) => order(a) - order(b));
}

/** The CEO's one line: "Providers: Claude Code (Max), ElevenLabs, OpenAI API (failed test) · MCP: github". */
export function providersLine(cards: readonly ProviderCard[]): string {
  const word = (c: ProviderCard) => {
    const bad = c.status === 'error' ? ' (failed test)' : c.status === 'signed-out' ? ' (signed out)' : c.status === 'limited' ? ' (limited)' : c.status === 'paused' ? ' (paused)' : '';
    return `${c.label === c.name ? c.name : `${c.name} "${c.label}"`}${bad}`;
  };
  const conns = cards.filter((c) => c.category !== 'mcp');
  const mcp = cards.filter((c) => c.category === 'mcp' && c.status !== 'off');
  return `Providers: ${conns.length ? conns.map(word).join(', ') : 'none'}${mcp.length ? ` · MCP: ${mcp.map((c) => c.name).join(', ')}` : ''}`;
}

/** A Providers-page key's row on the usage card (#361): its credit where the provider tells, else its last test. */
export function connectionSource(c: Omit<ProvidersView['connections'][number], 'tags' | 'usedFor'>): UsageSource | null {
  const def = providerDef(c.provider);
  if (!def?.usage) return null;
  const windows = c.test?.windows ?? [];
  const worst = Math.max(0, ...windows.map((w) => w.usedPct ?? 0));
  return {
    id: `provider:${c.id}`,
    provider: def.usage,
    category: def.category,
    label: c.label,
    plan: c.test?.plan ?? 'API',
    windows,
    status: !c.test ? 'ready' : !c.test.ok ? 'error' : worst >= 100 ? 'limited' : worst >= 80 ? 'near' : 'ready',
    checkedAt: c.test?.at ?? null,
    note: !c.test ? 'Not tested yet' : !c.test.ok ? c.test.note : windows.length ? 'From the key’s test call' : (def.usageNote ?? 'Key works; this provider has no usage API for a plain key'),
  };
}

// ---------- MCP servers ----------

/** Names the office's own servers use: an added one can't take them. */
const RESERVED = ['office', 'playwright'];
const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const ENV = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

export interface McpInput {
  name: string;
  command?: string;
  url?: string;
  envKeys?: string[];
  agents?: string[];
}

/** Why an MCP server can't be added as given, or null. */
export function mcpProblem(m: McpInput, taken: readonly string[]): string | null {
  const name = m.name.trim();
  if (!NAME.test(name)) return 'Name it with letters, digits, - or _ (up to 40).';
  if (RESERVED.includes(name.toLowerCase())) return `"${name}" is the office's own server: pick another name.`;
  if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) return `There's already a server called ${name}.`;
  const command = m.command?.trim() ?? '';
  const url = m.url?.trim() ?? '';
  if (!command === !url) return 'Give it a command or a URL (one of them).';
  if (url && !/^https?:\/\/[^\s]+$/.test(url)) return 'The URL should start with https:// (or http://).';
  if (command.length > 500) return 'That command is too long.';
  if ((m.envKeys ?? []).some((k) => !ENV.test(k))) return 'Secret names are letters, digits and _ (like GITHUB_TOKEN).';
  return null;
}

/** "npx -y @modelcontextprotocol/server-github" → command and arguments (quotes keep spaces together). */
export function splitCommand(raw: string): { command: string; args: string[] } {
  const parts = [...raw.trim().matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  return { command: parts[0] ?? '', args: parts.slice(1) };
}

/**
 * The MCP servers an agent's session gets, for the session's own mcp.json (never ~/.claude): the ones switched on for
 * every agent or for them, each with its saved secrets as environment variables (a command) or headers (a URL).
 */
export function sessionMcpServers(mcp: readonly McpServerConfig[], agentId: string, secret: (serverId: string, name: string) => string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const m of mcp) {
    if (!m.on || (m.agents.length && !m.agents.includes(agentId)) || RESERVED.includes(m.name.toLowerCase())) continue;
    const vals = Object.fromEntries(m.envKeys.map((k) => [k, secret(m.id, k)]).filter(([, v]) => v));
    out[m.name] = m.url ? { type: 'http', url: m.url, ...(Object.keys(vals).length ? { headers: vals } : {}) } : { command: m.command, args: m.args ?? [], ...(Object.keys(vals).length ? { env: vals } : {}) };
  }
  return out;
}

/** An MCP server's test: a URL answers at all, a command is on the PATH. */
export function mcpTestRequest(m: Pick<McpServerConfig, 'url' | 'command'>): ProbeRequest {
  return m.url ? { kind: 'http', url: m.url, headers: {} } : { kind: 'command', command: m.command ?? '' };
}

export function mcpTestNote(m: Pick<McpServerConfig, 'url'>, r: ProbeResult): { ok: boolean; note: string } {
  if (!m.url) return r.status === 200 ? { ok: true, note: 'Command found' } : { ok: false, note: 'Command not found on this computer' };
  // An MCP endpoint often turns a plain GET away (405, 406, 401 without its token): it's there all the same.
  return r.status === 0 ? { ok: false, note: "Couldn't reach it" } : r.status >= 500 ? { ok: false, note: `It answered ${r.status}` } : { ok: true, note: 'It answers' };
}
