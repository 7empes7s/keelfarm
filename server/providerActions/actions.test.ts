import { describe, expect, it } from 'vitest';
import { ACTION_PROVIDERS, autoApplies, keyAbilities, PROVIDER_ACTIONS } from '../../shared/providerActions.ts';
import { DEMO_REPO, fakeBoxes, fakeProviderHttp } from '../demo/providerActions.ts';
import { fakeCloudflare } from '../demo/cloudflare.ts';
import { applyAction, MODULES, runAction } from './index.ts';
import type { ActionCtx, ActionKey } from './types.ts';

const SECRET = 'sk-live-Zq81xWvP0aa7-secret';
const DEAD = 'sk-bad-old-0001-secret';

/** Arguments that make every op do its work against the fakes. */
const SAMPLE: Record<string, Record<string, Record<string, unknown>>> = {
  cloudflare: {
    token_scopes: { hostname: 'clip.techinsiderbytes.com' },
    tunnel_ingress_get: {},
    tunnel_ingress_add: { hostname: 'clip.techinsiderbytes.com', service: 'http://localhost:80' },
    dns_cname_ensure: { hostname: 'clip.techinsiderbytes.com' },
    access_app_ensure: { hostname: 'clip.techinsiderbytes.com', emails: ['manager@example.com'] },
  },
  github: {
    key_scopes: {},
    repo_get: {},
    secrets_list: {},
    branch_protection_get: {},
    runs_failed: {},
    run_rerun: { run_id: 4242 },
    repo_settings: { allow_auto_merge: true },
    branch_protection_set: { checks: ['ci'] },
    secret_delete: { name: 'DEPLOY_KEY' },
  },
  upstash: { boxes: {}, box_resume: { id: 'box-old' }, box_pause: { id: 'box-ada' }, box_delete: { id: 'box-old' } },
};
const sample = (provider: string, op: string) => SAMPLE[provider]?.[op] ?? {};

function ctxFor(provider: string, keys: ActionKey[] = [{ id: 'dead', label: 'Old key', key: DEAD, ok: false }, { id: 'live', label: 'Live key', key: SECRET, ok: true }]) {
  const net = fakeProviderHttp();
  const cf = fakeCloudflare();
  const boxes = fakeBoxes();
  const ctx: ActionCtx = { keys, http: net.http, cloudflareApi: cf.api, boxes, repo: DEMO_REPO };
  return { ctx, net, cf, boxes, provider };
}

describe('the provider-action layer', () => {
  it('has a module op for every op in the catalogue, and nothing else', () => {
    expect(Object.keys(MODULES).sort()).toEqual([...ACTION_PROVIDERS].sort());
    for (const p of ACTION_PROVIDERS) expect(Object.keys(MODULES[p].ops).sort(), p).toEqual(PROVIDER_ACTIONS[p].map((o) => o.op).sort());
  });

  it('never puts a key in what any op returns, plans or applies, though the provider got it', async () => {
    for (const provider of ACTION_PROVIDERS) {
      for (const { op, risk } of PROVIDER_ACTIONS[provider]) {
        const { ctx, net, cf } = ctxFor(provider);
        const out = await runAction(ctx, { provider, op, args: sample(provider, op) }).catch((err: Error) => ({ error: err.message }));
        expect('error' in out ? out.error : '', `${provider} ${op}`).toBe('');
        const seen = [JSON.stringify(out)];
        if ('plan' in out) {
          expect(risk, `${provider} ${op}`).not.toBe('read');
          seen.push(JSON.stringify(await applyAction(ctx, out.plan.change)));
        } else expect(risk, `${provider} ${op}`).toBe('read');
        expect(seen.join('\n'), `${provider} ${op}`).not.toContain(SECRET);
        expect(seen.join('\n'), `${provider} ${op}`).not.toContain(DEAD);
        if (provider !== 'upstash') expect(net.calls.some((c) => c.key === SECRET) || cf.calls.length > 0, `${provider} ${op} reached the provider`).toBe(true);
      }
    }
  });

  it('checks the op and its arguments, with the ops listed', async () => {
    const { ctx } = ctxFor('github');
    await expect(runAction(ctx, { provider: 'gitlab', op: 'x' })).rejects.toThrow(/No provider "gitlab": pick one of .*github/);
    await expect(runAction(ctx, { provider: 'github', op: 'merge' })).rejects.toThrow(/GitHub has no op "merge". Its ops: key_scopes \{ repo\? \}; .*secret_delete/);
    await expect(runAction(ctx, { provider: 'github', op: 'run_rerun', args: { run_id: 'x' } })).rejects.toThrow(/github run_rerun takes \{ repo\?, run_id \}: run_id/);
    for (const repo of ['../x', 'owner/..', './x']) await expect(runAction(ctx, { provider: 'github', op: 'repo_get', args: { repo } }), repo).rejects.toThrow(/repo a repo like owner\/name/);
  });
});

describe('GitHub', () => {
  it('plans a merge setting with its diff, applies it and reads it back', async () => {
    const { ctx, net } = ctxFor('github');
    const out = await runAction(ctx, { provider: 'github', op: 'repo_settings', args: { delete_branch_on_merge: true, allow_squash_merge: true } });
    if (!('plan' in out)) throw new Error('a write plans');
    expect(out.plan.diff).toContain('- delete_branch_on_merge: off\n+ delete_branch_on_merge: on');
    expect(out.plan.diff).toContain('  allow_squash_merge: on');
    expect(out.plan.argv).toEqual(['github', 'repo_settings', DEMO_REPO, 'delete_branch_on_merge=true']);
    expect(out.plan.summary).toBe(`turns delete_branch_on_merge on for ${DEMO_REPO}`);
    expect(out.plan.change.keyId).toBe('live'); // the dead key was turned away
    expect(net.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(await applyAction(ctx, out.plan.change)).toMatchObject({ ok: true, text: expect.stringMatching(/^Read back: .*delete_branch_on_merge: on/) });
    const again = await runAction(ctx, { provider: 'github', op: 'repo_settings', args: { delete_branch_on_merge: true } });
    expect('plan' in again && again.plan.already).toMatch(/already has those settings/);
  });

  it('names the permission a key lacks, and what each key can do', async () => {
    const { ctx } = ctxFor('github', [{ id: 'k', label: 'Read-only token', key: 'ghp_noadmin_nosecrets' }]);
    const plan = await runAction(ctx, { provider: 'github', op: 'repo_settings', args: { allow_auto_merge: true } });
    if (!('plan' in plan)) throw new Error('a write plans');
    expect(await applyAction(ctx, plan.plan.change)).toEqual({ ok: false, text: 'The key lacks Administration (write).' });
    await expect(runAction(ctx, { provider: 'github', op: 'secrets_list' })).rejects.toThrow('No GitHub key can do this: "Read-only token" lacks Secrets (read). Make a new key with that permission');
    const scopes = await runAction(ctx, { provider: 'github', op: 'key_scopes' });
    expect('text' in scopes && scopes.text).toMatch(/✓ repo\n {2}✓ Actions runs\n {2}✗ Actions secrets: missing Secrets \(read\)\n {2}✗ settings and branch protection: needs Administration \(write\)/);
  });

  it('reruns a failed run, sets required checks over none, and deletes a secret', async () => {
    const { ctx, net } = ctxFor('github');
    const steps = [
      ['run_rerun', { run_id: 4242 }],
      ['branch_protection_set', { checks: ['ci', 'ci'] }],
      ['secret_delete', { name: 'deploy_key' }],
    ] as const;
    const plans = [];
    for (const [op, args] of steps) {
      const out = await runAction(ctx, { provider: 'github', op, args });
      if (!('plan' in out)) throw new Error('a write plans');
      plans.push(out.plan);
      expect(await applyAction(ctx, out.plan.change), op).toMatchObject({ ok: true });
    }
    expect(plans[1].diff).toBe(`${DEMO_REPO} main required checks (not protected yet):\n+ ci`);
    expect(plans[2].argv).toEqual(['github', 'secret_delete', DEMO_REPO, 'DEPLOY_KEY']);
    expect(net.world).toMatchObject({ reruns: [4242], protection: ['ci'], secrets: ['NPM_TOKEN'] });
  });
});

describe('inference keys, ElevenLabs and Upstash', () => {
  it('lists models, checks credit where there is an API, and says where it is otherwise', async () => {
    const { ctx } = ctxFor('openrouter');
    expect(await runAction(ctx, { provider: 'openrouter', op: 'credit' })).toEqual({ text: '"Live key": $3.40 used, $6.60 left of $10.00.' });
    expect(await runAction(ctx, { provider: 'nvidia', op: 'models', args: { match: 'llama' } })).toEqual({ text: '1 model matching "llama" on "Live key":\nmeta/llama-4-maverick' });
    expect(await runAction(ctx, { provider: 'cerebras', op: 'credit' })).toEqual({ text: '"Live key" works; Cerebras has no credit API for a key: the balance is at https://cloud.cerebras.ai.' });
    await expect(runAction({ ...ctx, keys: [] }, { provider: 'aihubmix', op: 'key_test' })).rejects.toThrow('No AIHubMix key: add one in Settings → Providers.');
  });

  it("reads ElevenLabs' usage and pauses an Upstash box", async () => {
    const { ctx, boxes } = ctxFor('upstash');
    expect(await runAction(ctx, { provider: 'elevenlabs', op: 'usage' })).toEqual({ text: 'starter: 12,480 of 30,000 characters used, resets 2025-12-06.' });
    const out = await runAction(ctx, { provider: 'upstash', op: 'box_pause', args: { id: 'box-ada' } });
    if (!('plan' in out)) throw new Error('a write plans');
    expect(out.plan.summary).toBe("pauses box cubefarm-ada (one of the office's cloud agents')");
    expect(await applyAction(ctx, out.plan.change)).toEqual({ ok: true, text: 'Read back: cubefarm-ada is paused.' });
    expect(boxes.boxes[0].status).toBe('paused');
    await expect(runAction({ ...ctx, boxes: null }, { provider: 'upstash', op: 'boxes' })).rejects.toThrow(/Settings → Cloud agents/);
  });
});

describe('auto-approve and the Providers line', () => {
  it('applies routine writes from routine, changes only at all, destructive never', () => {
    expect([autoApplies('routine', 'off'), autoApplies('routine', 'routine'), autoApplies('change', 'routine'), autoApplies('change', 'all'), autoApplies('destructive', 'all')]).toEqual([false, true, false, true, false]);
  });

  it('says what a key can do, and the one fix when its test found a permission missing', () => {
    expect(keyAbilities('openrouter')).toEqual({ can: ['test the key', 'list models', 'check credit'] });
    const cf = keyAbilities('cloudflare', ['Zone DNS edit'])!;
    expect(cf.can).not.toContain('point DNS at the tunnel');
    expect(cf.fix).toBe('Make a new key with Zone DNS edit, then remove this one.');
    expect(keyAbilities('groq')).toBeNull();
  });
});
