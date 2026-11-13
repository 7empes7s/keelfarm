// The provider-action layer (#602): one module per provider, looked up here; provider_action's arguments checked
// against the op's own schema; a read answered, a write planned (for its card) or applied. The swarm (server/swarm/
// itDesk.ts) decides card or auto-apply and masks every text; nothing here sees a key except through `call`.
import { actionOp, PROVIDER_ACTIONS, type ProviderChange } from '../../shared/providerActions.ts';
import { cloudflareModule } from './cloudflare.ts';
import { elevenlabsModule } from './elevenlabs.ts';
import { entraModule } from './entra.ts';
import { gcloudModule } from './gcloud.ts';
import { githubModule } from './github.ts';
import { inferenceModules } from './inference.ts';
import { upstashModule } from './upstash.ts';
import { ActionError, type ActionCtx, type ActionPlan, type ActionResult, type ProviderModule } from './types.ts';

export const MODULES: Record<string, ProviderModule> = Object.fromEntries([cloudflareModule, githubModule, elevenlabsModule, upstashModule, entraModule, gcloudModule, ...inferenceModules].map((m) => [m.provider, m]));

const opsLine = (provider: string) => (PROVIDER_ACTIONS[provider] ?? []).map((o) => `${o.op}${o.args ? ` ${o.args}` : ''}`).join('; ');

/** provider_action: a read's text, or a write's plan. Throws an ActionError worded for IT or the CEO. */
export async function runAction(ctx: ActionCtx, a: { provider: string; op: string; args?: Record<string, unknown> }): Promise<{ text: string } | { plan: ActionPlan }> {
  const mod = MODULES[a.provider];
  if (!mod) throw new ActionError(`No provider "${a.provider}": pick one of ${Object.keys(MODULES).join(', ')}.`);
  const impl = mod.ops[a.op];
  if (!impl || !actionOp(a.provider, a.op)) throw new ActionError(`${mod.name} has no op "${a.op}". Its ops: ${opsLine(a.provider)}.`);
  const parsed = impl.args.safeParse(a.args ?? {});
  if (!parsed.success) throw new ActionError(`${a.provider} ${a.op} takes ${actionOp(a.provider, a.op)!.args ?? '{}'}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'args'} ${i.message}`).join('; ')}.`);
  return 'read' in impl ? { text: await impl.read(ctx, parsed.data) } : { plan: await impl.plan(ctx, parsed.data) };
}

/** Approve (or auto-approve) on a card: the module writes and reads back. Never throws. */
export function applyAction(ctx: ActionCtx, c: ProviderChange): Promise<ActionResult> {
  const mod = MODULES[c.provider];
  return mod ? mod.apply(ctx, c) : Promise.resolve({ ok: false, text: `No provider "${c.provider}" any more.` });
}

export { ActionError } from './types.ts';
export type { ActionCtx } from './types.ts';
