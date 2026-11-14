// The provider-action layer (#602): what IT and the CEO can do with each key on the Providers page, through one
// provider_action tool. The office makes every call on the server with the key; the key never reaches a prompt, a card,
// a log or the state. Each op is a read (answers at once) or a write, which is planned first (its summary or diff for
// the manager's card) and applied under IT auto-approve's levels (#585): routine writes apply by themselves from
// "routine", ordinary changes only at "all", destructive ones always ask. The modules are in server/providerActions/.
import type { ItAutoLevel } from './itDept';
import { GCLOUD_SERVICES } from './gcloud.ts';

export type ActionRisk = 'read' | 'routine' | 'change' | 'destructive';

export interface ActionOp {
  op: string;
  risk: ActionRisk;
  /** What it does, in a few words (the Providers card's "The office can" line and the tool's description). */
  does: string;
  /** Its arguments, for the tool's error when they're wrong. */
  args?: string;
  /** The permission it needs, in the words a key's test reports as missing (shared/keySetup.ts). */
  needs?: string;
}

const KEY_TEST: ActionOp = { op: 'key_test', risk: 'read', does: 'test the key' };
const MODELS: ActionOp = { op: 'models', risk: 'read', does: 'list models', args: '{ match? }' };
const CREDIT: ActionOp = { op: 'credit', risk: 'read', does: 'check credit' };
const INFERENCE = [KEY_TEST, MODELS, CREDIT];

/** Every provider's ops. Adding a provider: its ops here, a module in server/providerActions/ and its fake. */
export const PROVIDER_ACTIONS: Record<string, ActionOp[]> = {
  cloudflare: [
    { op: 'token_scopes', risk: 'read', does: "check each key's permissions", args: '{ hostname?, tunnel? }' },
    { op: 'tunnel_ingress_get', risk: 'read', does: "read the tunnel's hostnames", args: '{ tunnel? }', needs: 'Cloudflare Tunnel edit' },
    { op: 'tunnel_ingress_add', risk: 'change', does: 'publish a hostname on the tunnel', args: '{ hostname, service, tunnel? }', needs: 'Cloudflare Tunnel edit' },
    { op: 'dns_cname_ensure', risk: 'change', does: 'point DNS at the tunnel', args: '{ hostname, tunnel? }', needs: 'Zone DNS edit' },
    { op: 'access_app_ensure', risk: 'change', does: 'put a hostname behind Access', args: '{ hostname, emails, bypass?, idps?, auto_redirect? }' },
    { op: 'access_idp_ensure', risk: 'change', does: 'add the Microsoft Entra sign-in to Access', args: '{ name? }', needs: 'Access identity providers write' },
    // it can rotate a secret a service runs on, so it always asks
    { op: 'access_service_token_ensure', risk: 'destructive', does: 'make an Access service token', args: '{ hostname, name, duration?, env_file? }' },
    // #609: a narrow API token, saved as the office's own key and renewed before it expires
    { op: 'token_create', risk: 'change', does: 'make narrow API tokens and renew them', args: '{ name, permissions: ["DNS Write", …] as the dashboard names them, days? }' },
    // #668: SPF, DKIM and DMARC for the shared mailboxes' domain
    { op: 'mail_dns_check', risk: 'read', does: "check the mail domain's SPF, DKIM and DMARC", args: '{ domain? }', needs: 'Zone DNS edit' },
    { op: 'mail_dns_ensure', risk: 'change', does: "fix the mail domain's SPF, DKIM and DMARC", args: '{ domain? }', needs: 'Zone DNS edit' },
  ],
  github: [
    { op: 'key_scopes', risk: 'read', does: 'check its repo permissions', args: '{ repo? }' },
    { op: 'repo_get', risk: 'read', does: "read a repo's settings", args: '{ repo? }', needs: 'Metadata (read)' },
    { op: 'secrets_list', risk: 'read', does: "list Actions secrets' names", args: '{ repo? }', needs: 'Secrets (read)' },
    { op: 'branch_protection_get', risk: 'read', does: 'read branch protection', args: '{ repo?, branch? }', needs: 'Administration (read)' },
    { op: 'runs_failed', risk: 'read', does: 'list failed Actions runs', args: '{ repo? }', needs: 'Actions (read)' },
    { op: 'run_rerun', risk: 'routine', does: "rerun a run's failed jobs", args: '{ repo?, run_id }', needs: 'Actions (write)' },
    { op: 'repo_settings', risk: 'change', does: 'change merge settings', args: '{ repo?, allow_auto_merge?, delete_branch_on_merge?, allow_squash_merge?, allow_merge_commit?, allow_rebase_merge? }', needs: 'Administration (write)' },
    { op: 'branch_protection_set', risk: 'destructive', does: 'set required checks', args: '{ repo?, branch?, checks: string[] }', needs: 'Administration (write)' },
    { op: 'secret_delete', risk: 'destructive', does: 'delete an Actions secret', args: '{ repo?, name }', needs: 'Secrets (write)' },
  ],
  openai: INFERENCE,
  openrouter: INFERENCE,
  aihubmix: INFERENCE,
  cerebras: INFERENCE,
  nvidia: INFERENCE,
  elevenlabs: [KEY_TEST, { op: 'voices', risk: 'read', does: 'list voices' }, { op: 'usage', risk: 'read', does: 'read character usage' }],
  entra: [
    KEY_TEST,
    { op: 'entra_app_ensure', risk: 'change', does: 'register the Cloudflare Access sign-in app', args: '{ name? }' },
    // #668: it grants mail access and makes mailboxes, so it always asks
    { op: 'mail_app_ensure', risk: 'destructive', does: 'set up mail for the shared mailboxes only', args: '{ mailboxes: ["hello", "sales", "support"], domain?, name? }' },
  ],
  // #622: the office's service account; enabling an allow-listed API is routine, a key is a change
  gcloud: [
    { op: 'key_test', risk: 'read', does: 'test the service account' },
    { op: 'services_enable', risk: 'routine', does: 'enable Google APIs', args: `{ services: [${GCLOUD_SERVICES.map((s) => `"${s}"`).join(', ')}] }`, needs: 'Service Usage Admin' },
    { op: 'api_key_ensure', risk: 'change', does: 'make API keys restricted to an API', args: '{ name, apis: ["youtube.googleapis.com"] }', needs: 'API Keys Admin' },
    { op: 'api_key_delete', risk: 'destructive', does: 'delete an API key', args: '{ name }', needs: 'API Keys Admin' },
  ],
  upstash: [
    { op: 'boxes', risk: 'read', does: 'list boxes' },
    { op: 'box_resume', risk: 'routine', does: 'resume a box', args: '{ id }' },
    { op: 'box_pause', risk: 'change', does: 'pause a box', args: '{ id }' },
    { op: 'box_delete', risk: 'destructive', does: 'delete a box', args: '{ id }' },
  ],
};

export const ACTION_PROVIDERS = Object.keys(PROVIDER_ACTIONS);

export const actionOp = (provider: string, op: string) => PROVIDER_ACTIONS[provider]?.find((o) => o.op === op);

/** A planned write waiting on its card: the key named by its Providers connection id, never its value. */
export interface ProviderChange {
  provider: string;
  op: string;
  keyId: string;
  data: Record<string, unknown>;
}

/** Whether a write applies by itself at this auto-approve level (#585); destructive ones never do. */
export function autoApplies(risk: ActionRisk, level: ItAutoLevel): boolean {
  if (risk === 'read') return true;
  if (risk === 'destructive' || level === 'off') return false;
  return risk === 'routine' || level === 'all';
}

/** A key's line on the Providers page: what the office can do with it, and the one fix when its test found permissions missing. */
export function keyAbilities(provider: string, missing: readonly string[] = []): { can: string[]; fix?: string } | null {
  const ops = PROVIDER_ACTIONS[provider];
  if (!ops) return null;
  const can = [...new Set(ops.filter((o) => !o.needs || !missing.includes(o.needs)).map((o) => o.does))];
  return { can, ...(missing.length && { fix: `Make a new key with ${missing.join(', ')}, then remove this one.` }) };
}
