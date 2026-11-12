// Upstash Box in the provider-action layer (#602): the account's boxes through the Cloud agents key, which stays
// inside the office's BoxApi. Resume is routine; pause stops what runs in it; delete loses its disk, so it always asks.
import { z } from 'zod';
import { ActionError, type ActionCtx, type ProviderModule } from './types.ts';
import type { BoxApi } from '../box.ts';

const NAME = 'Upstash Box';
const id = z.object({ id: z.string().min(1).max(100) });
const VERB = { box_resume: ['resumes', 'running'], box_pause: ['pauses', 'paused'], box_delete: ['deletes', 'deleted'] } as const;

function api(ctx: ActionCtx): BoxApi {
  if (!ctx.boxes) throw new ActionError('No Upstash key: add it in Settings → Cloud agents.');
  return ctx.boxes;
}

const box = (op: keyof typeof VERB) => ({
  args: id,
  plan: async (ctx: ActionCtx, a: Record<string, unknown>) => {
    const b = await api(ctx).get(String(a.id));
    if (!b) throw new ActionError(`No box ${String(a.id)} on the account: list them with boxes.`);
    const [verb, to] = VERB[op];
    const office = b.labels.includes('cubefarm');
    return {
      change: { provider: 'upstash', op, keyId: 'cloud', data: { id: b.id, name: b.name } },
      summary: `${verb} box ${b.name}${office ? " (one of the office's cloud agents')" : ''}`,
      diff: `${b.name}: ${b.status} → ${to}`,
      argv: ['upstash', op, b.id],
      undo: op === 'box_delete' ? 'none: its disk is gone' : op === 'box_pause' ? 'resume it (box_resume)' : 'pause it (box_pause)',
      ...(b.status === to && { already: `${b.name} is ${b.status}: nothing to do.` }),
    };
  },
});

export const upstashModule: ProviderModule = {
  provider: 'upstash',
  name: NAME,
  ops: {
    boxes: {
      args: z.object({}),
      read: async (ctx) => {
        const list = await api(ctx).list();
        return `${list.length} box${list.length === 1 ? '' : 'es'}:\n${list.map((b) => `${b.id} · ${b.name} · ${b.status}${b.labels.includes('cubefarm') ? ' · office' : ''}`).join('\n')}`;
      },
    },
    box_resume: box('box_resume'),
    box_pause: box('box_pause'),
    box_delete: box('box_delete'),
  },
  async apply(ctx, c) {
    try {
      const boxes = api(ctx);
      const target = String(c.data.id);
      if (c.op === 'box_resume') await boxes.resume(target);
      else if (c.op === 'box_pause') await boxes.pause(target);
      else if (c.op === 'box_delete') await boxes.remove(target);
      else return { ok: false, text: `${NAME} has no write ${c.op}.` };
      const back = await boxes.get(target);
      return { ok: c.op === 'box_delete' ? !back || back.status === 'deleted' : !!back, text: `Read back: ${c.data.name} is ${back?.status ?? 'gone'}.` };
    } catch (err) {
      return { ok: false, text: (err as Error).message };
    }
  },
};
