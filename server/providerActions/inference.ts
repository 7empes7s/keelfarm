// Inference keys in the provider-action layer (#602): OpenAI, OpenRouter, AIHubMix, Cerebras and NVIDIA NIM speak the
// same OpenAI-style API, so one module each from a table: test the key, list its models, check credit where the
// provider has an API for it (OpenRouter's key endpoint); the others say where the balance is.
import { z } from 'zod';
import { expectOk, withKeys, type ProviderModule } from './types.ts';

interface InferenceDef {
  name: string;
  models: string; // the OpenAI-style models list
  test?: string; // when the models list answers without a key (NVIDIA's)
  credit: string | { dashboard: string };
}

const DEFS: Record<string, InferenceDef> = {
  openai: { name: 'OpenAI', models: 'https://api.openai.com/v1/models', credit: { dashboard: 'https://platform.openai.com/settings/organization/billing' } },
  openrouter: { name: 'OpenRouter', models: 'https://openrouter.ai/api/v1/models', test: 'https://openrouter.ai/api/v1/key', credit: 'https://openrouter.ai/api/v1/key' },
  aihubmix: { name: 'AIHubMix', models: 'https://aihubmix.com/v1/models', credit: { dashboard: 'https://aihubmix.com/statistics' } },
  cerebras: { name: 'Cerebras', models: 'https://api.cerebras.ai/v1/models', credit: { dashboard: 'https://cloud.cerebras.ai' } },
  nvidia: { name: 'NVIDIA NIM', models: 'https://integrate.api.nvidia.com/v1/models', test: 'https://api.nvcf.nvidia.com/v2/nvcf/functions', credit: { dashboard: 'https://build.nvidia.com' } },
};

const SHOWN = 40;

function inferenceModule(provider: string, d: InferenceDef): ProviderModule {
  const get = (url: string) => ({ method: 'GET' as const, url, auth: 'bearer' as const });
  return {
    provider,
    name: d.name,
    ops: {
      key_test: {
        args: z.object({}),
        read: (ctx) => withKeys(ctx, d.name, async (call, k) => (await expectOk(call, get(d.test ?? d.models), 'a working key', d.name), `"${k.label}" works.`)),
      },
      models: {
        args: z.object({ match: z.string().min(1).max(60).optional() }),
        read: (ctx, a) =>
          withKeys(ctx, d.name, async (call, k) => {
            const b = await expectOk<{ data?: { id?: unknown }[] }>(call, get(d.models), 'a working key', d.name);
            const all = (b?.data ?? []).map((m) => String(m.id ?? '')).filter(Boolean);
            const m = typeof a.match === 'string' ? a.match.toLowerCase() : '';
            const ids = m ? all.filter((id) => id.toLowerCase().includes(m)) : all;
            return `${ids.length} model${ids.length === 1 ? '' : 's'}${m ? ` matching "${m}"` : ''} on "${k.label}":\n${ids.slice(0, SHOWN).join('\n')}${ids.length > SHOWN ? `\n… ${ids.length - SHOWN} more (narrow with match)` : ''}`;
          }),
      },
      credit: {
        args: z.object({}),
        read: (ctx) =>
          withKeys(ctx, d.name, async (call, k) => {
            if (typeof d.credit !== 'string') return (await expectOk(call, get(d.models), 'a working key', d.name), `"${k.label}" works; ${d.name} has no credit API for a key: the balance is at ${d.credit.dashboard}.`);
            const b = await expectOk<{ data?: { usage?: number; limit?: number | null; limit_remaining?: number | null } }>(call, get(d.credit), 'a working key', d.name);
            const x = b?.data ?? {};
            const left = typeof x.limit_remaining === 'number' ? `$${x.limit_remaining.toFixed(2)} left of $${(x.limit ?? 0).toFixed(2)}` : 'no limit set';
            return `"${k.label}": $${(x.usage ?? 0).toFixed(2)} used, ${left}.`;
          }),
      },
    },
    apply: async (_ctx, c) => ({ ok: false, text: `${d.name} has no write ${c.op}.` }),
  };
}

export const inferenceModules = Object.entries(DEFS).map(([id, d]) => inferenceModule(id, d));
