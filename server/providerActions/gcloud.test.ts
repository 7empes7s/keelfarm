import { describe, expect, it } from 'vitest';
import { fakeProviderHttp, DEMO_REPO, fakeBoxes } from '../demo/providerActions.ts';
import { fakeCloudflare } from '../demo/cloudflare.ts';
import { DEMO_GCP, demoServiceAccount } from '../demo/gcloud.ts';
import { applyAction, runAction } from './index.ts';
import type { ActionCtx, ActionKey } from './types.ts';

// #622: Google Cloud through the office's service account: enable an allow-listed API, make an API key restricted to
// it (idempotent by name, its key string straight into the office's key store), delete one. Neither the private key
// nor the API key is in anything an op returns, plans or applies.
function office(sa = demoServiceAccount()) {
  const net = fakeProviderHttp();
  const saved: { provider: string; label: string; value: string }[] = [];
  const keys: ActionKey[] = [{ id: 'sa', label: 'Google Cloud (clipfarm)', key: sa, ok: true }];
  const ctx: ActionCtx = {
    keys,
    http: net.http,
    cloudflareApi: fakeCloudflare().api,
    boxes: fakeBoxes(),
    repo: DEMO_REPO,
    saveKey: async (k) => {
      const old = saved.find((s) => s.provider === k.provider && s.label === k.label);
      if (old) old.value = k.value;
      else saved.push({ ...k });
      return k.label;
    },
    savedKey: (provider, label) => saved.some((s) => s.provider === provider && s.label === label),
  };
  const run = async (op: string, args: Record<string, unknown> = {}) => {
    const out = await runAction(ctx, { provider: 'gcloud', op, args });
    if (!('plan' in out)) return { text: out.text };
    const applied = out.plan.already ? null : await applyAction(ctx, out.plan.change);
    return { plan: out.plan, applied };
  };
  const privateBody = (JSON.parse(sa) as { private_key: string }).private_key.split('\n')[1];
  const leaks = (outs: unknown[]) => {
    const all = JSON.stringify(outs);
    return [privateBody, ...net.google.keys.map((k) => k.keyString), ...saved.map((s) => s.value)].filter((v) => all.includes(v));
  };
  return { ctx, net, saved, run, leaks };
}

const ENSURE = { name: 'clipfarm watchlist', apis: ['youtube.googleapis.com'] };

describe('Google Cloud provider actions', () => {
  it('tests the service account by reading its project', async () => {
    const { run, net, leaks } = office();
    const out = await run('key_test');
    expect(out.text).toBe(`"Google Cloud (clipfarm)" works: project clipfarm (${DEMO_GCP.project}) as ${DEMO_GCP.email}.`);
    expect(net.calls[0]).toMatchObject({ auth: 'google-sa', url: `https://cloudresourcemanager.googleapis.com/v1/projects/${DEMO_GCP.project}` });
    expect(leaks([out])).toEqual([]);
  });

  it('enables YouTube, makes a key restricted to it into the key store, and a second run changes nothing', async () => {
    const { run, net, saved, leaks } = office();
    const outs: unknown[] = [];
    const enable = await run('services_enable', { services: ['youtube.googleapis.com'] });
    outs.push(enable);
    expect(enable.plan!.diff).toBe(`${DEMO_GCP.project}:\n+ youtube.googleapis.com enabled`);
    expect(enable.applied).toEqual({ ok: true, text: 'Read back: youtube.googleapis.com is enabled.' });
    expect(net.google.enabled.has('youtube.googleapis.com')).toBe(true);

    const key = await run('api_key_ensure', ENSURE);
    outs.push(key);
    expect(key.plan!.diff).toBe('+ API key "clipfarm watchlist"\n+   only youtube.googleapis.com\n+ saved in Settings → Providers as "clipfarm watchlist" (youtube); the key is never shown');
    expect(key.applied).toEqual({ ok: true, text: 'Read back: API key "clipfarm watchlist" works only with youtube.googleapis.com; saved in Settings → Providers as "clipfarm watchlist". Put it into the app with install_key.' });
    expect(net.google.keys).toHaveLength(1);
    expect(net.google.keys[0].restrictions).toEqual({ apiTargets: [{ service: 'youtube.googleapis.com' }] });
    expect(saved).toEqual([{ provider: 'youtube', label: 'clipfarm watchlist', value: net.google.keys[0].keyString, usedBy: 'Made by the office (Google Cloud)' }]);

    const writes = net.calls.filter((c) => c.method !== 'GET').length;
    const again = [await run('services_enable', { services: ['youtube.googleapis.com'] }), await run('api_key_ensure', ENSURE)];
    outs.push(...again);
    expect(again.map((o) => o.plan!.already)).toEqual(['youtube.googleapis.com is already enabled on clipfarm-demo.', 'API key "clipfarm watchlist" already works only with youtube.googleapis.com and is saved in Settings → Providers.']);
    expect(net.calls.filter((c) => c.method !== 'GET').length).toBe(writes);
    expect(net.google.keys).toHaveLength(1);
    expect(leaks(outs)).toEqual([]);
  });

  it('refuses APIs off the allow-list, and a key for an API not enabled yet', async () => {
    const { run } = office();
    await expect(run('services_enable', { services: ['compute.googleapis.com'] })).rejects.toThrow(/services\.0/);
    await expect(run('api_key_ensure', ENSURE)).rejects.toThrow('youtube.googleapis.com isn\'t enabled on clipfarm-demo: enable it first with services_enable.');
  });

  it('says plainly what a service account without the permission lacks', async () => {
    const { run, net } = office(demoServiceAccount('viewer@clipfarm-demo.iam.gserviceaccount.com'));
    const out = await run('services_enable', { services: ['youtube.googleapis.com'] });
    expect(out.applied).toEqual({ ok: false, text: 'The service account lacks Service Usage Admin (roles/serviceusage.serviceUsageAdmin) on the project.' });
    net.google.enabled.add('youtube.googleapis.com');
    const key = await run('api_key_ensure', ENSURE);
    expect(key.applied).toEqual({ ok: false, text: 'The service account lacks API Keys Admin (roles/serviceusage.apiKeysAdmin) on the project.' });
  });

  it("deletes a key Google wouldn't restrict, and saves nothing", async () => {
    const { run, net, saved } = office(demoServiceAccount('norestrict@clipfarm-demo.iam.gserviceaccount.com'));
    net.google.enabled.add('youtube.googleapis.com');
    const key = await run('api_key_ensure', ENSURE);
    expect(key.applied).toEqual({ ok: false, text: "Google didn't keep the key's restriction to youtube.googleapis.com, so it was deleted and nothing was saved. Ask again." });
    expect(net.google.keys).toEqual([]);
    expect(saved).toEqual([]);
  });

  it('restricts an existing key by its name, and deletes one', async () => {
    const { run, net } = office();
    net.google.enabled.add('youtube.googleapis.com');
    net.google.enabled.add('aiplatform.googleapis.com');
    await run('api_key_ensure', ENSURE);
    const wider = await run('api_key_ensure', { name: 'clipfarm watchlist', apis: ['youtube.googleapis.com', 'aiplatform.googleapis.com'] });
    expect(wider.plan!.diff).toContain('~ API key "clipfarm watchlist"\n-   only youtube.googleapis.com\n+   only youtube.googleapis.com, aiplatform.googleapis.com');
    expect(wider.applied!.ok).toBe(true);
    expect(net.google.keys).toHaveLength(1);
    const del = await run('api_key_delete', { name: 'clipfarm watchlist' });
    expect(del.plan!.diff).toBe('- API key "clipfarm watchlist" (only youtube.googleapis.com, aiplatform.googleapis.com)');
    expect(del.applied).toEqual({ ok: true, text: 'Read back: API key "clipfarm watchlist" is gone.' });
    await expect(run('api_key_delete', { name: 'clipfarm watchlist' })).rejects.toThrow('No API key "clipfarm watchlist" on clipfarm-demo.');
  });
});
