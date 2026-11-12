// The demo's Settings → Providers (#362): test calls that never leave the computer (a key with "bad" in it is turned
// away, "offline" unreachable; OpenRouter, Runway, Luma and Kling tell a made-up credit, none for "nocredit"; Gemini and
// OpenAI list their video and image models), a made-up key or server in every category for a fresh demo office (a dead
// duplicate Cloudflare key among them, #523), and the keys found on this computer from a made-up archive (#367).
// Company sign-ins (#533): the token exchange answers with made-up tokens, and each account's profile; a Cloudflare
// token with "nodns" in it can't read DNS records, a GitHub token with "nopr" can't read pull requests.
import type { ProbeRequest, ProbeResult } from '../../shared/providers.ts';
import type { RawKey } from '../../shared/keyScan.ts';
import { registerCeoReply, registerDemo } from './registry.ts';

const LITELLM = 'LiteLLM litellm.env';
/** The made-up archive's keys: one live, dead, out of credit or unreachable each, a duplicate, one already saved, one unknown. */
export const DEMO_FOUND_KEYS: RawKey[] = [
  { variable: 'LITELLM_MASTER_KEY', value: 'sk-demo-litellm-master-00000000', source: LITELLM },
  { variable: 'GEMINI_API_KEY', value: 'AIzaSyDEMO-retired-gemini-00007q3k', source: LITELLM },
  { variable: 'GOOGLE_API_KEY', value: 'AIzaSyDEMO-retired-gemini-00007q3k', source: 'NewsBites .env' },
  { variable: 'OPENAI_API_KEY', value: 'sk-demo-openai-0000000000001a2b', source: LITELLM },
  { variable: 'OPENROUTER_API_KEY', value: 'sk-or-v1-demo-retired-nocredit-0000m1x9', source: LITELLM },
  { variable: 'GITHUB_TOKEN', value: 'ghp_demoBadRetiredToken00000t6y4', source: LITELLM },
  { variable: 'GROQ_API_KEY', value: 'gsk_demo_bad_retired_00000g7r2', source: LITELLM },
  { variable: 'CEREBRAS_API_KEY', value: 'csk-demo-retired-0000000c5b8', source: LITELLM },
  { variable: 'CEREBRAS_API_KEY_PAID', value: 'csk-demo-paid-retired-00000p4d1', source: LITELLM },
  { variable: 'CLOUDFLARE_API_TOKEN', value: 'demo-cf-token-retired-0000f2e6', source: 'Control Surface .env' },
  { variable: 'NVIDIA_NIM_API_KEY', value: 'nvapi-demo-retired-offline-0000n8v3', source: LITELLM },
  { variable: 'AIHUBMIX_API_KEY', value: 'sk-demo-aihubmix-retired-0000h3u5', source: 'Mimule config.json' },
  { variable: 'VAST_API_KEY', value: 'demo-vast-retired-key-0000v9w2', source: LITELLM },
];

/** The demo's made-up Entra tenant (#621). */
const DEMO_TENANT = '7e57e57e-0000-4000-8000-00000000c1f0';

async function demoProbe(req: ProbeRequest): Promise<ProbeResult> {
  if (req.kind === 'command') return { status: /^(npx|node|uvx|docker)$/.test(req.command) ? 200 : 404 };
  if (req.kind === 'form') return { status: 200, body: { access_token: `demo-access-${Date.now().toString(36)}`, refresh_token: req.form.refresh_token ?? 'demo-refresh-token', expires_in: 3600 } };
  const auth = Object.values(req.headers).join(' ');
  if (/\/dns_records/.test(req.url) && /nodns/i.test(auth)) return { status: 403, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] } };
  if (req.url.includes('api.cloudflare.com') && req.url.includes('/zones?')) return { status: 200, body: { result: [{ id: 'demo-zone-0001', name: 'example.com' }] } };
  if (/api\.github\.com\/repos\/.+\/pulls/.test(req.url) && /nopr/i.test(auth)) return { status: 403, headers: { 'x-accepted-github-permissions': 'pull_requests=read' }, body: { message: 'Resource not accessible by personal access token' } };
  if (req.url.includes('openidconnect.googleapis.com')) return { status: 200, body: { email: 'manager@example.com' } };
  if (req.url.includes('graph.facebook.com')) return { status: 200, body: { name: 'Demo Studio' } };
  if (req.url.includes('open.tiktokapis.com')) return { status: 200, body: { data: { user: { display_name: 'demo.studio' } } } };
  if (req.url.includes('graph.microsoft.com')) return { status: 200, body: { userPrincipalName: 'manager@example.com' } };
  if (Object.values(req.headers).some((v) => /bad/i.test(v))) return { status: 401 };
  if (Object.values(req.headers).some((v) => /offline/i.test(v))) return { status: 0 };
  if (req.url.includes('openrouter.ai')) return { status: 200, body: { data: { label: 'demo', usage: 3.4, limit: 10, limit_remaining: Object.values(req.headers).some((v) => /nocredit/i.test(v)) ? 0 : 6.6 } } };
  if (req.url.includes('runwayml.com')) return { status: 200, body: { creditBalance: 1250, tier: { maxMonthlyCreditSpend: 10000, models: { gen4_turbo: { maxDailyGenerations: 50 } } }, usage: { models: { gen4_turbo: { dailyGenerations: 12 } } } } };
  if (req.url.includes('lumalabs.ai')) return { status: 200, body: { credit_balance: 2480 } };
  if (req.url.includes('klingai.com')) return { status: 200, body: { code: 0, data: { code: 0, resource_pack_subscribe_infos: [{ resource_pack_name: 'Video pack', total_quantity: 100, remaining_quantity: 64, invalid_time: Date.now() + 20 * 86_400_000, status: 'online' }] } } };
  if (req.url.includes('generativelanguage.googleapis.com')) return { status: 200, body: { models: [{ name: 'models/gemini-3-flash' }, { name: 'models/gemini-omni-1.2-flash' }, { name: 'models/gemini-nano-banana-2.1' }, { name: 'models/gemini-3-pro-image' }] } };
  if (req.url.includes('api.openai.com')) return { status: 200, body: { data: [{ id: 'gpt-5' }, { id: 'gpt-image-2.6-flare' }, { id: 'gpt-image-2.5-sunburst' }] } };
  return { status: 200, body: {} };
}

registerDemo('providers', () => ({
  providerProbe: demoProbe,
  scanForKeys: async () => {
    await new Promise((r) => setTimeout(r, 400)); // long enough to see "Scanning…"
    return DEMO_FOUND_KEYS.map((k) => ({ ...k }));
  },
  demoProviders: () => ({
    keys: [
      { provider: 'openai', key: 'sk-demo-openai-0000000000001a2b', label: 'OpenAI API' },
      { provider: 'openrouter', key: 'sk-or-demo-0000000000003c4d', label: 'OpenRouter' },
      { provider: 'gemini', key: 'AIza-demo-bad-key-00005e6f', label: 'Gemini (old key)' },
      { provider: 'openai-audio', key: 'sk-demo-whisper-000000007a8b', label: 'Whisper & TTS' },
      { provider: 'nano-banana', key: 'AIza-demo-banana-00001f2a', label: 'Nano Banana' },
      { provider: 'openai-images', key: 'sk-demo-images-00003b4c', label: 'OpenAI Images' },
      { provider: 'hetzner', key: 'demo-hcloud-token-00009c0d', label: 'Hetzner Cloud' },
      { provider: 'cloudflare', key: 'demo-cf-token-00004d5e', label: 'Cloudflare' },
      { provider: 'cloudflare', key: 'demo-cf-bad-old-token-00008a1c', label: 'Cloudflare (old)' }, // a dead duplicate (#523)
      { provider: 'github', key: 'ghp_demo-token-00002b7f', label: 'GitHub token' },
      { provider: 'runway', key: 'key_demo-runway-00001e2f', label: 'Runway' },
      { provider: 'gemini-video', key: 'AIza-demo-video-00003a4b', label: 'Google video' },
      { provider: 'luma', key: 'luma-demo-00005c6d', label: 'Luma' },
      { provider: 'kling', key: 'demo-access:demo-secret-7e8f', label: 'Kling' },
      { provider: 'entra', key: 'demo-admin-client-0001:demo-admin-secret-9a0b', label: 'Microsoft Entra', accountId: DEMO_TENANT }, // #621
    ],
    mcp: [
      { name: 'github', command: 'npx -y @modelcontextprotocol/server-github', secrets: { GITHUB_PERSONAL_ACCESS_TOKEN: 'demo-gh-token-0000' } },
      { name: 'docs', url: 'https://mcp.example.com/docs' },
    ],
  }),
}));

registerCeoReply('keys', async ({ text, use }) => (/\bkeys?\b/i.test(text) && /\b(scan|find|found|old|left|retired)\b/i.test(text) ? `Here's what the scan found, tested; you pick what to keep in Settings → Providers.\n\n${await use('scan_keys', {})}` : null));
