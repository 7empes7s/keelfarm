import { describe, expect, it } from 'vitest';
import { cloudflareTokenUrl, cloudflareVerify, createKeyUrl, githubPermission, githubTokenUrl, missingClassicScopes, permissionSteps, runPermissionSteps, setupGuide, turnedAwayNote } from './keySetup.ts';
import { PROVIDERS, type ProbeRequest, type ProbeResult } from './providers.ts';

const ACCOUNT = '0123456789abcdef0123456789abcdef';

describe('keys made right the first time (#533)', () => {
  it("links Cloudflare's create-token page with the office's permissions, account-owned when the Account ID is known", () => {
    const user = new URL(cloudflareTokenUrl());
    expect(user.pathname).toBe('/profile/api-tokens');
    expect(JSON.parse(user.searchParams.get('permissionGroupKeys')!)).toEqual([
      { key: 'zone', type: 'read' },
      { key: 'dns', type: 'edit' },
      { key: 'argotunnel', type: 'edit' },
      { key: 'workers_scripts', type: 'edit' },
    ]);
    expect([user.searchParams.get('accountId'), user.searchParams.get('zoneId')]).toEqual(['*', 'all']);
    expect(new URL(cloudflareTokenUrl(ACCOUNT)).searchParams.get('to')).toBe(`/${ACCOUNT}/api-tokens`);
  });

  it("links GitHub's fine-grained token page with every permission the agents need", () => {
    const q = new URL(githubTokenUrl('acme')).searchParams;
    expect(Object.fromEntries(['target_name', 'expires_in', 'contents', 'pull_requests', 'issues', 'actions', 'workflows', 'metadata'].map((k) => [k, q.get(k)]))).toEqual({
      target_name: 'acme',
      expires_in: '90',
      contents: 'write',
      pull_requests: 'write',
      issues: 'write',
      actions: 'read',
      workflows: 'write',
      metadata: 'read',
    });
    expect(createKeyUrl('openai')).toBe('https://platform.openai.com/api-keys');
    expect(createKeyUrl('kling')).toBeNull();
  });

  it('gives every catalogue entry a 2-5 step card; Cloudflare asks for an Account ID and names its key kind', () => {
    for (const p of PROVIDERS) {
      const g = setupGuide(p.id);
      expect(g.steps.length).toBeGreaterThanOrEqual(2);
      expect(g.steps.length).toBeLessThanOrEqual(5);
    }
    expect(setupGuide('cloudflare').keyKind).toMatch(/not the Global API Key/);
    expect(setupGuide('cloudflare').accountId?.label).toBe('Account ID');
    expect(setupGuide('google').limits).toMatch(/6 uploads a day/);
  });

  it('verifies an account-owned Cloudflare token on its account', () => {
    expect(cloudflareVerify('t', ACCOUNT).url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/tokens/verify`);
    expect(cloudflareVerify('t').url).toBe('https://api.cloudflare.com/client/v4/user/tokens/verify');
    expect(turnedAwayNote('cloudflare', 401)).toMatch(/not the Global API Key/);
    expect(turnedAwayNote('openai', 401)).toBeNull();
  });
});

/** A fake API: each URL pattern's answer. */
const fake = (answers: [RegExp, ProbeResult][]) => {
  const seen: string[] = [];
  const probe = async (req: ProbeRequest): Promise<ProbeResult> => {
    const url = req.kind === 'command' ? req.command : req.url;
    seen.push(url);
    return answers.find(([re]) => re.test(url))?.[1] ?? { status: 200, body: {} };
  };
  return { probe, seen };
};

describe('401 and 403 turned into the permission missing (#533)', () => {
  it('Cloudflare: a token that reads zones but not DNS, nor the account’s Workers', async () => {
    const { probe, seen } = fake([
      [/\/zones\?/, { status: 200, body: { result: [{ id: 'z1' }] } }],
      [/\/dns_records/, { status: 403, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] } }],
      [/\/workers\/scripts/, { status: 403, body: { errors: [{ code: 10000 }] } }],
    ]);
    expect(await runPermissionSteps('cloudflare', permissionSteps('cloudflare', 'tok'), probe, { accountId: ACCOUNT })).toEqual(['Zone DNS edit', 'Workers Scripts edit']);
    expect(seen).toContain('https://api.cloudflare.com/client/v4/zones/z1/dns_records?per_page=1');
    // no Account ID: the account checks are skipped, not failed
    const none = fake([[/\/zones\?/, { status: 200, body: { result: [] } }]]);
    expect(await runPermissionSteps('cloudflare', permissionSteps('cloudflare', 'tok'), none.probe, {})).toEqual([]);
    expect(none.seen).toHaveLength(1);
  });

  it("GitHub: a fine-grained token's 403 names the permission it lacks; a classic one's scopes", async () => {
    const { probe } = fake([[/\/pulls/, { status: 403, headers: { 'x-accepted-github-permissions': 'pull_requests=read' }, body: { message: 'Resource not accessible by personal access token' } }]]);
    expect(await runPermissionSteps('github', permissionSteps('github', 'github_pat_x'), probe, { repo: 'acme/app' })).toEqual(['Pull requests (read)']);
    const other = fake([[/\/repos\/acme\/app$/, { status: 404 }]]);
    expect(await runPermissionSteps('github', permissionSteps('github', 'github_pat_x'), other.probe, { repo: 'acme/app' })).toEqual(['Repository access to this floor’s repo']);
    expect(githubPermission('issues=write; contents=read')).toBe('Issues (write)');
    expect(missingClassicScopes({ 'x-oauth-scopes': 'repo, read:org' })).toEqual(['workflow scope']);
    expect(missingClassicScopes(undefined)).toEqual([]);
  });
});
