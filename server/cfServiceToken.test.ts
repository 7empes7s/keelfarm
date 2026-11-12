import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyWrite, planWrite, type CfKey } from './cloudflare.ts';
import { envClientId, envPathRefusal, envSecretFile, envWithToken } from './cfSecretFile.ts';
import { fakeCloudflare } from './demo/cloudflare.ts';

// #607: access_service_token_ensure against a faked Cloudflare: the token by name, its Service Auth policy beside the
// app's email policy, the secret only in the env file, and nothing half-applied when a permission is missing.
const HOST = 'keel.techinsiderbytes.com';
const good: CfKey = { id: 'k1', label: 'Cloudflare', key: 'cf-good-token-1', ok: true };
const EMAIL_POLICY = { id: 'pol-email', name: 'Allowed emails', decision: 'allow', include: [{ email: { email: 'manager@example.com' } }] };

let dir = '';
let file = '';
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-token-'));
  file = path.join(dir, 'clipfarm.env');
  await fs.writeFile(file, 'PORT=8080\n# keep me\n');
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const ensure = (keys: CfKey[], cf: ReturnType<typeof fakeCloudflare>) => planWrite(keys, cf.api, { op: 'access_service_token_ensure', hostname: HOST, name: 'clipfarm e2e', duration: '8760h', secretFile: envSecretFile(file) });

describe('access_service_token_ensure', () => {
  it('creates the token, adds its Service Auth policy beside the email one, stores the secret, then changes nothing', async () => {
    const cf = fakeCloudflare({ access: true });
    const plan = await ensure([good], cf);
    expect(cf.calls.every((c) => c.method === 'GET')).toBe(true); // planning writes nothing
    expect(plan.already).toBeUndefined();
    expect(plan.diff.split('\n')).toEqual([`Access app ${HOST}:`, '+ service token clipfarm e2e (8760h)', `+ its client id and secret stored at ${file} (mode 600)`, '  policy Allowed emails: allow', '+ policy Service token clipfarm e2e: non_identity (Service Auth)']);

    const r = await applyWrite([good], cf.api, plan.change, envSecretFile(file));
    expect(r).toEqual({ ok: true, text: `Read back: service token "clipfarm e2e" gets through Access on ${HOST} (Service Auth); its secret is stored at ${file}.` });
    const [token] = cf.world.tokens;
    expect(token).toMatchObject({ name: 'clipfarm e2e', duration: '8760h' });
    expect(cf.world.policies['app-keel'][0]).toEqual(EMAIL_POLICY); // untouched
    expect(cf.world.policies['app-keel'].slice(1)).toEqual([{ id: expect.any(String), name: 'Service token clipfarm e2e', decision: 'non_identity', include: [{ service_token: { token_id: token.id } }] }]);
    const [secret] = cf.world.secrets;
    expect(await fs.readFile(file, 'utf8')).toBe(`PORT=8080\n# keep me\nCF_ACCESS_CLIENT_ID=${token.client_id}\nCF_ACCESS_CLIENT_SECRET=${secret}\n`);
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);

    // a second run: nothing to approve, and an Approve on the old card writes nothing
    const posts = cf.calls.filter((c) => c.method !== 'GET').length;
    const again = await ensure([good], cf);
    expect(again.already).toBe(`Service token "clipfarm e2e" already gets through Access on ${HOST}, its secret stored at ${file}.`);
    const r2 = await applyWrite([good], cf.api, plan.change, envSecretFile(file));
    expect(r2).toEqual({ ok: true, text: `Service token "clipfarm e2e" already got through Access on ${HOST}: nothing written.` });
    expect(cf.calls.filter((c) => c.method !== 'GET')).toHaveLength(posts);
    expect(cf.world.tokens).toHaveLength(1);

    // the secret is in no returned text, no card and no request the office sent
    const outputs = [plan.diff, plan.summary, JSON.stringify(plan.change), r.text, again.diff, again.already, r2.text, JSON.stringify(cf.calls)].join('\n');
    expect(secret).toMatch(/^cf-access-secret-/);
    expect(outputs).not.toContain(secret);
  });

  it('rotates the secret of a token that exists but is stored nowhere', async () => {
    const cf = fakeCloudflare({ access: true });
    cf.world.tokens.push({ id: 'tok-old', name: 'clipfarm e2e', client_id: 'old.access' });
    const plan = await ensure([good], cf);
    expect(plan.diff).toContain('~ service token clipfarm e2e: rotate its secret (the old secret stops working)');
    expect(await applyWrite([good], cf.api, plan.change, envSecretFile(file))).toMatchObject({ ok: true });
    expect(envClientId(await fs.readFile(file, 'utf8'))).toBe('old.access');
    expect(cf.calls.some((c) => c.method === 'POST' && c.path.endsWith('/service_tokens/tok-old/rotate'))).toBe(true);
    expect(cf.world.tokens).toHaveLength(1);
  });

  it('says what the key needs, with nothing half-applied', async () => {
    const cf = fakeCloudflare({ access: true });
    await expect(ensure([{ ...good, key: 'cf-notoken-1' }], cf)).rejects.toThrow('the key needs Account › Access: Service Tokens › Edit ("Cloudflare")');
    expect(cf.calls.every((c) => c.method === 'GET')).toBe(true);

    // a key that can read but not add the policy: the new token is deleted and the env file put back
    const noPolicy: CfKey = { ...good, key: 'cf-nopolicy-1' };
    const plan = await ensure([noPolicy], cf);
    const r = await applyWrite([noPolicy], cf.api, plan.change, envSecretFile(file));
    expect(r).toEqual({ ok: false, text: 'The key needs Account › Access: Apps and Policies › Edit. Nothing was kept: what was written is undone.' });
    expect(cf.world.tokens).toEqual([]);
    expect(cf.world.policies['app-keel']).toEqual([EMAIL_POLICY]);
    expect(await fs.readFile(file, 'utf8')).toBe('PORT=8080\n# keep me\n');
    expect(r.text).not.toContain(cf.world.secrets[0]);
  });

  it('needs an Access app on the hostname', async () => {
    await expect(ensure([good], fakeCloudflare())).rejects.toThrow(`No Access app on ${HOST}: put it behind Access first (access_app_ensure).`);
  });
});

describe('the secret env file', () => {
  it('replaces the two lines where they are, keeping every other line', () => {
    expect(envWithToken('A=1\nexport CF_ACCESS_CLIENT_ID=old\nCF_ACCESS_CLIENT_SECRET="x"\nB=2\n', 'new', 's')).toBe('A=1\nCF_ACCESS_CLIENT_ID=new\nCF_ACCESS_CLIENT_SECRET=s\nB=2\n');
    expect(envWithToken('', 'id', 's')).toBe('CF_ACCESS_CLIENT_ID=id\nCF_ACCESS_CLIENT_SECRET=s\n');
    expect(envClientId('export CF_ACCESS_CLIENT_ID="abc.access"\n')).toBe('abc.access');
    expect(envClientId('PORT=1\n')).toBeUndefined();
  });

  it('refuses a relative path, a non-env file and the office folders', () => {
    const office = path.resolve('/srv/office');
    expect(envPathRefusal('clipfarm.env', [])).toMatch(/isn't an absolute path/);
    expect(envPathRefusal(path.resolve('/etc/passwd'), [])).toMatch(/isn't an env file/);
    expect(envPathRefusal(path.join(office, '.env'), [path.posix.normalize(office.replace(/\\/g, '/'))])).toMatch(/keeps out of reach/);
    expect(envPathRefusal(path.resolve('/etc/clipfarm/clipfarm.env'), [path.posix.normalize(office.replace(/\\/g, '/'))])).toBeNull();
  });
});
