// The provider-action layer's contract (#602): what a provider's module gets (its keys, the one network call, the Box
// API) and gives (its ops: reads, and writes as a plan then an apply). A module only ever sees `call`, which puts the
// key in the request's header in server/providerActions/http.ts: nothing it returns can carry the key by accident.
import type { z } from 'zod';
import type { BoxApi } from '../box.ts';
import type { CfApi } from '../cloudflare.ts';
import type { CfSecretFile } from '../cfSecretFile.ts';
import type { ProviderChange } from '../../shared/providerActions.ts';

/** How the key goes on a request: a bearer token, ElevenLabs' header, GitHub's bearer with its API headers, or (#621) an Entra "client id:secret" as a client-credentials form. */
type ActionAuth = 'bearer' | 'xi-api-key' | 'github' | 'entra-token';

export interface ActionRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  auth: ActionAuth;
  body?: unknown;
  /** entra-token: the form's other fields (scope, grant_type); http.ts adds the client id and secret. */
  form?: Record<string, string>;
}
export interface ActionResponse {
  status: number; // 0: unreachable
  body?: unknown;
  /** GitHub's x-accepted-github-permissions, lower-cased name: what a 403 lacked. */
  headers?: Record<string, string>;
}
/** backend.providerHttp: one call with the key; never throws. */
export type ProviderHttp = (key: string, req: ActionRequest) => Promise<ActionResponse>;
export type Call = (req: ActionRequest) => Promise<ActionResponse>;

/** One key from Settings → Providers (or Voice), in server memory only. */
export interface ActionKey {
  id: string;
  label: string;
  key: string;
  accountId?: string;
  ok?: boolean; // its last test passed
}

export interface ActionCtx {
  keys: readonly ActionKey[];
  http: ProviderHttp;
  cloudflareApi: CfApi;
  /** The Upstash Box API with the Cloud agents key inside it, or null without one. */
  boxes: BoxApi | null;
  /** The first floor's repo ("owner/name"), GitHub's default. */
  repo?: string;
  /** Where a Cloudflare service token's secret is written (#607): the env file asked for (checked), else the office's own. Throws when refused. */
  secretFile?: (envFile: string | undefined, name: string) => CfSecretFile;
  /** Cloudflare's keys, for the Entra app's callback (its team domain) (#621). */
  cfKeys?: readonly ActionKey[];
  /** The office's own Entra app secret (#621), in secrets.json: written by entra_app_ensure, read by access_idp_ensure. */
  entra?: EntraStore;
}

/** The Entra app the office made for Cloudflare Access, and its client secret (#621). Never in a card, log or tool result. */
export interface EntraCred {
  tenant: string;
  appObjectId: string;
  clientId: string;
  keyId: string;
  secret: string;
  expiresAt: number;
  /** The Cloudflare IdP holding this secret, once access_idp_ensure wrote it: renewal updates it. */
  idp?: { cfKeyId: string; accountId: string; id: string; name: string; keyId: string };
}
export interface EntraStore {
  get(): EntraCred | undefined;
  set(c: EntraCred): Promise<void>;
}

/** A write's plan: the change for its card (no key in it), a one-line summary, its before and after. */
export interface ActionPlan {
  change: ProviderChange;
  summary: string;
  diff: string;
  /** The card's line, e.g. ["github", "repo_settings", "o/r"]. */
  argv: string[];
  undo: string;
  already?: string; // nothing to do, and why
}

export interface ActionResult {
  ok: boolean;
  text: string;
}

type Args = Record<string, unknown>;
type OpImpl = { args: z.ZodType<Args> } & ({ read: (ctx: ActionCtx, a: Args) => Promise<string> } | { plan: (ctx: ActionCtx, a: Args) => Promise<ActionPlan> });

export interface ProviderModule {
  provider: string;
  name: string;
  ops: Record<string, OpImpl>;
  /** Approve (or auto-approve): writes the change and reads it back. Never throws. */
  apply(ctx: ActionCtx, c: ProviderChange): Promise<ActionResult>;
}

/** What went wrong, worded for IT or the CEO; `missing`: the permission a key lacked, so the next key is tried. */
export class ActionError extends Error {
  constructor(
    message: string,
    readonly missing?: string,
  ) {
    super(message);
  }
}

/** The keys to try: the ones whose last test passed first. */
const ordered = (keys: readonly ActionKey[]) => [...keys].sort((a, b) => Number(!!b.ok) - Number(!!a.ok));

/** Runs `fn` with the first key not turned away; when all are, one line on what each lacks and the fix. */
export async function withKeys<T>(ctx: ActionCtx, name: string, fn: (call: Call, key: ActionKey) => Promise<T>): Promise<T> {
  if (!ctx.keys.length) throw new ActionError(`No ${name} key: add one in Settings → Providers.`);
  const lacks: string[] = [];
  for (const k of ordered(ctx.keys)) {
    try {
      return await fn((req) => ctx.http(k.key, req), k);
    } catch (err) {
      if (!(err instanceof ActionError) || !err.missing) throw err;
      lacks.push(`"${k.label}" lacks ${err.missing}`);
    }
  }
  throw new ActionError(`No ${name} key can do this: ${lacks.join('; ')}. Make a new key with that permission in Settings → Providers.`);
}

/** The key a card was planned with, or why it's gone. */
export function keyById(ctx: ActionCtx, name: string, id: string): ActionKey | ActionResult {
  return ctx.keys.find((k) => k.id === id) ?? { ok: false, text: `The ${name} key this card was planned with is gone from Settings → Providers: ask for it again.` };
}

/** A JSON answer's result, or an ActionError: a 401/403 names `perm` so another key is tried. */
export async function expectOk<T>(call: Call, req: ActionRequest, perm: string, name: string): Promise<T> {
  const r = await call(req);
  if (r.status === 0) throw new ActionError(`Couldn't reach ${name}.`);
  if (r.status === 401 || r.status === 403) throw new ActionError(`The key lacks ${perm}.`, perm);
  if (r.status >= 400) {
    const b = (r.body ?? {}) as { message?: unknown; error?: unknown; detail?: unknown };
    const why = [b.message, b.error, b.detail].map((v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? JSON.stringify(v) : '')).find(Boolean) ?? 'no reason given';
    throw new ActionError(`${name} answered ${r.status}: ${why.slice(0, 200)}.`);
  }
  return r.body as T;
}
