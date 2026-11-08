// The demo's Settings → Providers (#362): test calls that never leave the computer (a key with "bad" in it is turned
// away; OpenRouter tells a made-up credit), and a made-up key or server in every category for a fresh demo office.
import type { ProbeRequest, ProbeResult } from '../../shared/providers.ts';
import { registerDemo } from './registry.ts';

async function demoProbe(req: ProbeRequest): Promise<ProbeResult> {
  if (req.kind === 'command') return { status: /^(npx|node|uvx|docker)$/.test(req.command) ? 200 : 404 };
  if (Object.values(req.headers).some((v) => /bad/i.test(v))) return { status: 401 };
  if (req.url.includes('openrouter.ai')) return { status: 200, body: { data: { label: 'demo', usage: 3.4, limit: 10 } } };
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
      { provider: 'hetzner', key: 'demo-hcloud-token-00009c0d', label: 'Hetzner Cloud' },
    ],
    mcp: [
      { name: 'github', command: 'npx -y @modelcontextprotocol/server-github', secrets: { GITHUB_PERSONAL_ACCESS_TOKEN: 'demo-gh-token-0000' } },
      { name: 'docs', url: 'https://mcp.example.com/docs' },
    ],
  }),
}));
