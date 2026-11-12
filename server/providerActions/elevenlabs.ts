// ElevenLabs in the provider-action layer (#602), with the Voice settings' key: test it, list voices, read the
// month's character usage. All reads.
import { z } from 'zod';
import { expectOk, withKeys, type ProviderModule } from './types.ts';

const API = 'https://api.elevenlabs.io/v1';
const NAME = 'ElevenLabs';
const get = (path: string) => ({ method: 'GET' as const, url: `${API}${path}`, auth: 'xi-api-key' as const });

export const elevenlabsModule: ProviderModule = {
  provider: 'elevenlabs',
  name: NAME,
  ops: {
    key_test: { args: z.object({}), read: (ctx) => withKeys(ctx, NAME, async (call, k) => (await expectOk(call, get('/user'), 'User read', NAME), `"${k.label}" works.`)) },
    voices: {
      args: z.object({}),
      read: (ctx) =>
        withKeys(ctx, NAME, async (call) => {
          const b = await expectOk<{ voices?: { voice_id: string; name?: string; category?: string }[] }>(call, get('/voices'), 'Voices read', NAME);
          const v = b?.voices ?? [];
          return `${v.length} voices:\n${v.slice(0, 40).map((x) => `${x.name ?? '?'} (${x.category ?? 'voice'}) · ${x.voice_id}`).join('\n')}`;
        }),
    },
    usage: {
      args: z.object({}),
      read: (ctx) =>
        withKeys(ctx, NAME, async (call) => {
          const s = await expectOk<{ tier?: string; character_count?: number; character_limit?: number; next_character_count_reset_unix?: number }>(call, get('/user/subscription'), 'User read', NAME);
          const resets = s?.next_character_count_reset_unix ? `, resets ${new Date(s.next_character_count_reset_unix * 1000).toISOString().slice(0, 10)}` : '';
          return `${s?.tier ?? 'plan'}: ${(s?.character_count ?? 0).toLocaleString('en-US')} of ${(s?.character_limit ?? 0).toLocaleString('en-US')} characters used${resets}.`;
        }),
    },
  },
  apply: async (_ctx, c) => ({ ok: false, text: `${NAME} has no write ${c.op}.` }),
};
