// The demo's Settings → Providers (#362): test calls that never leave the computer (a key with "bad" in it is turned
// away; OpenRouter, Runway, Luma and Kling tell a made-up credit, Gemini and OpenAI list their video and image models), and a made-up key or server in every category for a fresh demo office.
import type { ProbeRequest, ProbeResult } from '../../shared/providers.ts';
import { registerDemo } from './registry.ts';

async function demoProbe(req: ProbeRequest): Promise<ProbeResult> {
  if (req.kind === 'command') return { status: /^(npx|node|uvx|docker)$/.test(req.command) ? 200 : 404 };
  if (Object.values(req.headers).some((v) => /bad/i.test(v))) return { status: 401 };
  if (req.url.includes('openrouter.ai')) return { status: 200, body: { data: { label: 'demo', usage: 3.4, limit: 10 } } };
  if (req.url.includes('runwayml.com')) return { status: 200, body: { creditBalance: 1250, tier: { maxMonthlyCreditSpend: 10000, models: { gen4_turbo: { maxDailyGenerations: 50 } } }, usage: { models: { gen4_turbo: { dailyGenerations: 12 } } } } };
  if (req.url.includes('lumalabs.ai')) return { status: 200, body: { credit_balance: 2480 } };
  if (req.url.includes('klingai.com')) return { status: 200, body: { code: 0, data: { code: 0, resource_pack_subscribe_infos: [{ resource_pack_name: 'Video pack', total_quantity: 100, remaining_quantity: 64, invalid_time: Date.now() + 20 * 86_400_000, status: 'online' }] } } };
  if (req.url.includes('generativelanguage.googleapis.com')) return { status: 200, body: { models: [{ name: 'models/gemini-3-flash' }, { name: 'models/gemini-omni-1.2-flash' }, { name: 'models/gemini-nano-banana-2.1' }, { name: 'models/gemini-3-pro-image' }] } };
  if (req.url.includes('api.openai.com')) return { status: 200, body: { data: [{ id: 'gpt-5' }, { id: 'gpt-image-2.6-flare' }, { id: 'gpt-image-2.5-sunburst' }] } };
  return { status: 200, body: {} };
}

registerDemo('providers', () => ({
  providerProbe: demoProbe,
  demoProviders: () => ({
    keys: [
      { provider: 'openai', key: 'sk-demo-openai-0000000000001a2b', label: 'OpenAI API' },
      { provider: 'openrouter', key: 'sk-or-demo-0000000000003c4d', label: 'OpenRouter' },
      { provider: 'gemini', key: 'AIza-demo-bad-key-00005e6f', label: 'Gemini (old key)' },
      { provider: 'openai-audio', key: 'sk-demo-whisper-000000007a8b', label: 'Whisper & TTS' },
      { provider: 'nano-banana', key: 'AIza-demo-banana-00001f2a', label: 'Nano Banana' },
      { provider: 'openai-images', key: 'sk-demo-images-00003b4c', label: 'OpenAI Images' },
      { provider: 'hetzner', key: 'demo-hcloud-token-00009c0d', label: 'Hetzner Cloud' },
      { provider: 'runway', key: 'key_demo-runway-00001e2f', label: 'Runway' },
      { provider: 'gemini-video', key: 'AIza-demo-video-00003a4b', label: 'Google video' },
      { provider: 'luma', key: 'luma-demo-00005c6d', label: 'Luma' },
      { provider: 'kling', key: 'demo-access:demo-secret-7e8f', label: 'Kling' },
    ],
    mcp: [
      { name: 'github', command: 'npx -y @modelcontextprotocol/server-github', secrets: { GITHUB_PERSONAL_ACCESS_TOKEN: 'demo-gh-token-0000' } },
      { name: 'docs', url: 'https://mcp.example.com/docs' },
    ],
  }),
}));
