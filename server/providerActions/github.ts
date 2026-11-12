// GitHub in the provider-action layer (#602), with the GitHub token from Settings → Providers: a repo's settings, its
// Actions secrets' names (never values), branch protection, failed runs and their rerun, merge settings and required
// checks. The repo defaults to the first floor's. A 403 names the permission GitHub says it lacked.
import { z } from 'zod';
import { githubPermission } from '../../shared/keySetup.ts';
import { ActionError, expectOk, keyById, withKeys, type ActionCtx, type ActionRequest, type Call, type ProviderModule } from './types.ts';

const API = 'https://api.github.com';
const NAME = 'GitHub';
const REPO = /^(?!\.\.?\/)[\w.-]+\/(?!\.\.?$)[\w.-]+$/; // owner/name, never . or .. (they'd walk the API's path)
const repoArg = z.string().regex(REPO, 'a repo like owner/name').optional();
const branchArg = z.string().min(1).max(100).regex(/^[\w./-]+$/).optional();
/** The merge settings repo_settings may change: booleans, each one reversible. */
const SETTINGS = ['allow_auto_merge', 'delete_branch_on_merge', 'allow_squash_merge', 'allow_merge_commit', 'allow_rebase_merge'] as const;

const get = (url: string): ActionRequest => ({ method: 'GET', url: `${API}${url}`, auth: 'github' });

function repoOf(ctx: ActionCtx, a: Record<string, unknown>): string {
  const repo = typeof a.repo === 'string' && a.repo ? a.repo : ctx.repo;
  if (!repo) throw new ActionError('Say which repo (repo: "owner/name"): no floor is connected yet.');
  return repo;
}

/** A call's JSON, a 403/404 turned into the permission GitHub names (so the next key is tried). */
async function gh<T>(call: Call, req: ActionRequest, perm: string): Promise<T> {
  const r = await call(req);
  if ((r.status === 403 || r.status === 404) && r.headers?.['x-accepted-github-permissions']) {
    const need = githubPermission(r.headers['x-accepted-github-permissions']) ?? perm;
    throw new ActionError(`The key lacks ${need}.`, need);
  }
  if (r.status === 404) throw new ActionError(`GitHub found nothing at ${req.url.slice(API.length)}: check the repo, or the key's repository access.`);
  return expectOk<T>(async () => r, req, perm, NAME);
}

type Repo = Record<(typeof SETTINGS)[number], boolean | undefined> & { full_name: string; default_branch: string; private: boolean; permissions?: Record<string, boolean> };
const repoGet = (call: Call, repo: string) => gh<Repo>(call, get(`/repos/${repo}`), 'Metadata (read)');

type Protection = { required_status_checks?: { contexts?: string[]; strict?: boolean } | null };
async function protectionOf(call: Call, repo: string, branch: string): Promise<string[] | null> {
  const r = await call(get(`/repos/${repo}/branches/${encodeURIComponent(branch)}/protection`));
  if (r.status === 404 && !r.headers?.['x-accepted-github-permissions']) return null; // not protected
  const p = await gh<Protection>(async () => r, get(''), 'Administration (read)');
  return p.required_status_checks?.contexts ?? [];
}

const onOff = (v: boolean | undefined) => (v ? 'on' : 'off');

export const githubModule: ProviderModule = {
  provider: 'github',
  name: NAME,
  ops: {
    key_scopes: {
      args: z.object({ repo: repoArg }),
      read: async (ctx, a) => {
        const repo = repoOf(ctx, a);
        if (!ctx.keys.length) throw new ActionError('No GitHub key: add a token in Settings → Providers → GitHub token.');
        const out: string[] = [];
        for (const k of ctx.keys) {
          const call: Call = (req) => ctx.http(k.key, req);
          const lines: string[] = [];
          for (const [what, url, perm] of [
            ['repo', `/repos/${repo}`, 'Metadata (read)'],
            ['Actions runs', `/repos/${repo}/actions/runs?per_page=1`, 'Actions (read)'],
            ['Actions secrets', `/repos/${repo}/actions/secrets?per_page=1`, 'Secrets (read)'],
          ] as const) {
            const ok = await gh(call, get(url), perm).then(() => null, (err: Error) => (err instanceof ActionError && err.missing ? `missing ${err.missing}` : err.message));
            lines.push(ok ? `  ✗ ${what}: ${ok}` : `  ✓ ${what}`);
          }
          const r = await repoGet(call, repo).catch(() => null);
          if (r?.permissions) lines.push(`  ${r.permissions.admin ? '✓' : '✗'} settings and branch protection${r.permissions.admin ? '' : ': needs Administration (write)'}`);
          out.push(`"${k.label}" on ${repo}:\n${lines.join('\n')}`);
        }
        return `${out.join('\n')}\nA write turned away names the permission it lacked.`;
      },
    },
    repo_get: {
      args: z.object({ repo: repoArg }),
      read: (ctx, a) =>
        withKeys(ctx, NAME, async (call, k) => {
          const r = await repoGet(call, repoOf(ctx, a));
          return `${r.full_name} (${r.private ? 'private' : 'public'}, default branch ${r.default_branch}, read with "${k.label}")\n${SETTINGS.map((s) => `${s}: ${onOff(r[s])}`).join('\n')}`;
        }),
    },
    secrets_list: {
      args: z.object({ repo: repoArg }),
      read: (ctx, a) =>
        withKeys(ctx, NAME, async (call) => {
          const repo = repoOf(ctx, a);
          const r = await gh<{ secrets?: { name: string; updated_at?: string }[] }>(call, get(`/repos/${repo}/actions/secrets?per_page=100`), 'Secrets (read)');
          const list = r.secrets ?? [];
          return `${repo}'s Actions secrets (names only):\n${list.map((s) => `${s.name}${s.updated_at ? ` · updated ${s.updated_at.slice(0, 10)}` : ''}`).join('\n') || '(none)'}`;
        }),
    },
    branch_protection_get: {
      args: z.object({ repo: repoArg, branch: branchArg }),
      read: (ctx, a) =>
        withKeys(ctx, NAME, async (call) => {
          const repo = repoOf(ctx, a);
          const branch = (a.branch as string | undefined) ?? (await repoGet(call, repo)).default_branch;
          const checks = await protectionOf(call, repo, branch);
          return checks === null ? `${repo} ${branch} isn't protected.` : `${repo} ${branch} is protected; required checks: ${checks.join(', ') || 'none'}.`;
        }),
    },
    runs_failed: {
      args: z.object({ repo: repoArg }),
      read: (ctx, a) =>
        withKeys(ctx, NAME, async (call) => {
          const repo = repoOf(ctx, a);
          const r = await gh<{ workflow_runs?: { id: number; name?: string; head_branch?: string; created_at?: string }[] }>(call, get(`/repos/${repo}/actions/runs?status=failure&per_page=10`), 'Actions (read)');
          const runs = r.workflow_runs ?? [];
          return `${repo}'s latest failed runs:\n${runs.map((x) => `${x.id} · ${x.name ?? 'run'} on ${x.head_branch ?? '?'} · ${x.created_at?.slice(0, 16) ?? ''}`).join('\n') || '(none)'}`;
        }),
    },
    run_rerun: {
      args: z.object({ repo: repoArg, run_id: z.number().int().positive() }),
      plan: (ctx, a) =>
        withKeys(ctx, NAME, async (call, k) => {
          const repo = repoOf(ctx, a);
          const run = await gh<{ id: number; name?: string; conclusion?: string | null }>(call, get(`/repos/${repo}/actions/runs/${a.run_id}`), 'Actions (read)');
          return {
            change: { provider: 'github', op: 'run_rerun', keyId: k.id, data: { repo, run_id: run.id } },
            summary: `reruns the failed jobs of ${run.name ?? 'run'} ${run.id} on ${repo}`,
            diff: `${repo} run ${run.id} (${run.name ?? 'run'}): ${run.conclusion ?? 'running'} → rerun failed jobs`,
            argv: ['github', 'run_rerun', repo, String(run.id)],
            undo: 'nothing to undo: a rerun only adds an attempt',
            ...(run.conclusion !== 'failure' && { already: `Run ${run.id} didn't fail (${run.conclusion ?? 'still running'}): nothing to rerun.` }),
          };
        }),
    },
    repo_settings: {
      args: z.object({ repo: repoArg, ...Object.fromEntries(SETTINGS.map((s) => [s, z.boolean().optional()])) }),
      plan: (ctx, a) =>
        withKeys(ctx, NAME, async (call, k) => {
          const repo = repoOf(ctx, a);
          const want = Object.fromEntries(SETTINGS.filter((s) => typeof a[s] === 'boolean').map((s) => [s, a[s] as boolean]));
          if (!Object.keys(want).length) throw new ActionError(`Give at least one of ${SETTINGS.join(', ')} (true or false).`);
          const r = await repoGet(call, repo);
          const diff = SETTINGS.map((s) => (s in want && want[s] !== !!r[s] ? `- ${s}: ${onOff(r[s])}\n+ ${s}: ${onOff(want[s])}` : `  ${s}: ${onOff(r[s])}`)).join('\n');
          const changed = Object.keys(want).filter((s) => want[s] !== !!r[s as (typeof SETTINGS)[number]]);
          const before = Object.fromEntries(changed.map((s) => [s, !!r[s as (typeof SETTINGS)[number]]]));
          return {
            change: { provider: 'github', op: 'repo_settings', keyId: k.id, data: { repo, want, before } },
            summary: `turns ${changed.map((s) => `${s} ${onOff(want[s])}`).join(', ') || 'nothing'} for ${repo}`,
            diff: `${repo} settings:\n${diff}`,
            argv: ['github', 'repo_settings', repo, ...changed.map((s) => `${s}=${want[s]}`)],
            undo: `set ${changed.map((s) => `${s}=${before[s]}`).join(', ')} again (provider_action github repo_settings)`,
            ...(!changed.length && { already: `${repo} already has those settings.` }),
          };
        }),
    },
    branch_protection_set: {
      args: z.object({ repo: repoArg, branch: branchArg, checks: z.array(z.string().min(1).max(100)).max(20) }),
      plan: (ctx, a) =>
        withKeys(ctx, NAME, async (call, k) => {
          const repo = repoOf(ctx, a);
          const branch = (a.branch as string | undefined) ?? (await repoGet(call, repo)).default_branch;
          const before = await protectionOf(call, repo, branch);
          const checks = [...new Set(a.checks as string[])];
          const had = new Set(before ?? []);
          const lines = [...(before ?? []).filter((c) => !checks.includes(c)).map((c) => `- ${c}`), ...checks.map((c) => `${had.has(c) ? ' ' : '+'} ${c}`)];
          const same = before !== null && before.length === checks.length && checks.every((c) => had.has(c));
          return {
            change: { provider: 'github', op: 'branch_protection_set', keyId: k.id, data: { repo, branch, checks } },
            summary: `sets ${branch}'s required checks on ${repo} to ${checks.join(', ') || 'none'}, replacing its protection`,
            diff: `${repo} ${branch} required checks${before === null ? ' (not protected yet)' : ''}:\n${lines.join('\n') || '(none)'}`,
            argv: ['github', 'branch_protection_set', repo, branch, ...checks],
            undo: before === null ? `remove ${branch}'s protection in the repo's Settings → Branches` : `set the checks back to ${before.join(', ') || 'none'}`,
            ...(same && { already: `${branch} already requires exactly those checks.` }),
          };
        }),
    },
    secret_delete: {
      args: z.object({ repo: repoArg, name: z.string().regex(/^[A-Z_][A-Z0-9_]{0,99}$/i) }),
      plan: (ctx, a) =>
        withKeys(ctx, NAME, async (call, k) => {
          const repo = repoOf(ctx, a);
          const name = String(a.name).toUpperCase();
          const r = await gh<{ secrets?: { name: string }[] }>(call, get(`/repos/${repo}/actions/secrets?per_page=100`), 'Secrets (read)');
          const there = (r.secrets ?? []).some((s) => s.name === name);
          return {
            change: { provider: 'github', op: 'secret_delete', keyId: k.id, data: { repo, name } },
            summary: `deletes the Actions secret ${name} from ${repo}`,
            diff: `${repo} Actions secrets:\n- ${name}`,
            argv: ['github', 'secret_delete', repo, name],
            undo: "none: the value is gone; it has to be set again by whoever has it",
            ...(!there && { already: `${repo} has no secret ${name}.` }),
          };
        }),
    },
  },
  async apply(ctx, c) {
    const k = keyById(ctx, NAME, c.keyId);
    if (!('key' in k)) return k;
    const call: Call = (req) => ctx.http(k.key, req);
    const d = c.data as { repo: string; run_id?: number; want?: Record<string, boolean>; branch?: string; checks?: string[]; name?: string };
    try {
      if (c.op === 'run_rerun') {
        await gh(call, { method: 'POST', url: `${API}/repos/${d.repo}/actions/runs/${d.run_id}/rerun-failed-jobs`, auth: 'github' }, 'Actions (write)');
        return { ok: true, text: `Rerun asked for run ${d.run_id} on ${d.repo}.` };
      }
      if (c.op === 'repo_settings') {
        await gh(call, { method: 'PATCH', url: `${API}/repos/${d.repo}`, auth: 'github', body: d.want }, 'Administration (write)');
        const r = await repoGet(call, d.repo);
        const ok = Object.entries(d.want ?? {}).every(([s, v]) => !!r[s as (typeof SETTINGS)[number]] === v);
        return { ok, text: `${ok ? 'Read back' : "Read back, but it doesn't match"}: ${SETTINGS.map((s) => `${s}: ${onOff(r[s])}`).join(', ')}` };
      }
      if (c.op === 'branch_protection_set') {
        const body = { required_status_checks: { strict: false, contexts: d.checks }, enforce_admins: false, required_pull_request_reviews: null, restrictions: null };
        await gh(call, { method: 'PUT', url: `${API}/repos/${d.repo}/branches/${encodeURIComponent(d.branch!)}/protection`, auth: 'github', body }, 'Administration (write)');
        const back = await protectionOf(call, d.repo, d.branch!);
        const ok = !!back && back.length === d.checks!.length && d.checks!.every((x) => back.includes(x));
        return { ok, text: `${ok ? 'Read back' : "Read back, but it doesn't match"}: ${d.branch} requires ${back?.join(', ') || 'nothing'}` };
      }
      if (c.op === 'secret_delete') {
        const r = await call({ method: 'DELETE', url: `${API}/repos/${d.repo}/actions/secrets/${d.name}`, auth: 'github' });
        if (r.status !== 204 && r.status !== 404) await gh(async () => r, get(''), 'Secrets (write)');
        return { ok: true, text: `Deleted ${d.name} from ${d.repo}.` };
      }
      return { ok: false, text: `GitHub has no write ${c.op}.` };
    } catch (err) {
      return { ok: false, text: (err as Error).message };
    }
  },
};
