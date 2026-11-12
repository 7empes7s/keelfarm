import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { fakeProviderHttp } from './demo/providerActions.ts';
import { DEMO_ACCESS, demoServiceAccount } from './demo/gcloud.ts';
import { Swarm } from './swarm.ts';
import { HOME_DIR } from './config.ts';
import type { OfficeTools } from './ceo.ts';
import type { ItDeskState } from '../shared/itDesk.ts';
import type { ItAutoLevel } from '../shared/itDept.ts';
import type { PhoneMessage, ServerEvent } from '../shared/types.ts';

// #622 through the office: the service account's JSON file sent to the office saved as the Google Cloud key (the file
// then deleted), YouTube enabled, a key restricted to it made into the key store, installed into clipfarm's Settings
// over its Access service token and its Test read back as Working. A second run changes nothing. Neither the private
// key nor the API key is in any tool output, card, log, chat, broadcast or the state.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  itTools(): OfficeTools;
  broadcast(ev: ServerEvent): void;
  state: { itDesk: ItDeskState; it: { messages: PhoneMessage[] }; settings: { itDept: { autoApprove: ItAutoLevel } } };
};

const ACCESS_FILE = path.join(HOME_DIR, 'secrets', 'cf-access-clipfarm.env');

async function office(sa = demoServiceAccount()) {
  await fs.mkdir(path.dirname(ACCESS_FILE), { recursive: true });
  const [id, secret] = DEMO_ACCESS.split(':');
  await fs.writeFile(ACCESS_FILE, `CF_ACCESS_CLIENT_ID=${id}\nCF_ACCESS_CLIENT_SECRET=${secret}\n`);
  const backend = createDemoBackend();
  const net = fakeProviderHttp();
  backend.providerHttp = net.http;
  const swarm = new Swarm(backend);
  const o = swarm as unknown as Internals;
  const sent: string[] = [];
  const broadcast = o.broadcast.bind(o);
  o.broadcast = (ev) => {
    sent.push(JSON.stringify(ev));
    broadcast(ev);
  };
  o.ensureCeo([]);
  o.state.settings.itDept.autoApprove = 'all';
  const tmp = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-sa-')), 'clipfarm-sa.json');
  await fs.writeFile(tmp, sa);
  const file = await swarm.files.addCopy(tmp, { name: 'clipfarm-sa.json', from: 'manager' });
  const privateBody = (JSON.parse(sa) as { private_key?: string }).private_key?.split('\n')[1] ?? sa;
  const leaks = (outs: string[]) => {
    const all = [...outs, ...sent, JSON.stringify(o.state), JSON.stringify(swarm.snapshot())].join('\n');
    return [privateBody, DEMO_ACCESS.split(':')[1], ...net.google.keys.map((k) => k.keyString)].filter((v) => all.includes(v));
  };
  return { swarm, o, net, file, it: o.itTools(), leaks };
}

describe('Google Cloud end to end', () => {
  it('saves the service account from its file, makes the YouTube key, installs it into clipfarm, and Test says Working; twice changes nothing', async () => {
    const { swarm, net, file, it, leaks } = await office();
    const outs: string[] = [];
    outs.push(await it.call('save_provider_key', { provider: 'gcloud', file: file.id, label: 'Google Cloud (clipfarm)' }));
    expect(outs[0]).toMatch(/^Saved in Settings → Providers as "Google Cloud \(clipfarm\)" \(id \w+, ends …9f3e\)\. Its test: Key works\. Read from the file clipfarm-sa\.json, which is now deleted from the office's files\./);
    expect(swarm.files.get(file.id)).toBeUndefined();

    const steps = async () => [
      await it.call('provider_action', { provider: 'gcloud', op: 'services_enable', args: { services: ['youtube.googleapis.com'] } }),
      await it.call('provider_action', { provider: 'gcloud', op: 'api_key_ensure', args: { name: 'clipfarm watchlist', apis: ['youtube.googleapis.com'] } }),
      await it.call('install_key', { key: 'clipfarm watchlist', target: 'clipfarm app', var_name: 'YOUTUBE_API_KEY' }),
    ];
    const first = await steps();
    outs.push(...first);
    expect(first[0]).toMatch(/^Done automatically \(auto-approve\): `gcloud services_enable youtube.googleapis.com`\nRead back: youtube.googleapis.com is enabled\./);
    expect(first[1]).toMatch(/^Done automatically \(auto-approve\): `gcloud api_key_ensure 'clipfarm watchlist'`\nRead back: API key "clipfarm watchlist" works only with youtube.googleapis.com/);
    expect(first[2]).toMatch(/^Done automatically \(auto-approve\): Set YOUTUBE_API_KEY in clipfarm's Settings → youtube \(ends …\w{4}\)\.\nclipfarm's Test: Working \(YouTube answered\.\)/);
    const yt = swarm.providers.view().connections.find((c) => c.provider === 'youtube')!;
    expect(yt).toMatchObject({ label: 'clipfarm watchlist', usedBy: 'Made by the office (Google Cloud)', installs: [{ file: 'clipfarm app', var: 'YOUTUBE_API_KEY' }] });
    expect(net.clipfarm.values.YOUTUBE_API_KEY).toBe(net.google.keys[0].keyString);

    const writes = net.calls.filter((c) => c.method !== 'GET' && !c.url.endsWith('/test')).length;
    const again = await steps();
    outs.push(...again);
    expect(again[0]).toMatch(/already enabled.*Nothing to approve/);
    expect(again[1]).toMatch(/already works only with youtube.googleapis.com.*Nothing to approve/);
    expect(again[2]).toBe("YOUTUBE_API_KEY (ends …" + yt.keyHint + ") is already set in clipfarm's Settings → youtube. clipfarm's Test: Working (YouTube answered.). Nothing to approve.");
    expect(net.calls.filter((c) => c.method !== 'GET' && !c.url.endsWith('/test')).length).toBe(writes);
    expect(net.google.keys).toHaveLength(1);
    expect(swarm.providers.view().connections.filter((c) => c.provider === 'youtube')).toHaveLength(1);
    expect(leaks(outs)).toEqual([]);
  });

  it('puts the app install on a card, refuses unknown settings, and says where the Access token is missing', async () => {
    const { swarm, o, it, leaks } = await office();
    o.state.settings.itDept.autoApprove = 'off';
    const yt = await swarm.providers.add('youtube', 'AIzaSyDEMOhandmade000000000000000abcd', 'YouTube (clipfarm)');
    const outs = [await it.call('install_key', { key: yt.id, target: 'clipfarm app', var_name: 'YOUTUBE_API_KEY' })];
    expect(outs[0]).toMatch(/^On the manager's card: `install_key YOUTUBE_API_KEY 'clipfarm app'`, YOUTUBE_API_KEY → clipfarm app \(ends …abcd\)/);
    expect((await swarm.itRunProposals([o.state.itDesk.waiting[0].id])).results[0].code).toBe(0);
    expect(o.state.it.messages.at(-1)!.notice?.details).toMatch(/clipfarm's Test: Working/);
    outs.push(await it.call('install_key', { key: yt.id, target: 'clipfarm app', var_name: 'GEMINI_API_KEY' }));
    expect(outs[1]).toMatch(/^Refused: clipfarm's Settings have no GEMINI_API_KEY \(it takes .*YOUTUBE_API_KEY/);
    await fs.rm(ACCESS_FILE);
    const yt2 = await swarm.providers.add('youtube', 'AIzaSyDEMOhandmade000000000000000wxyz', 'YouTube 2');
    o.state.settings.itDept.autoApprove = 'routine';
    outs.push(await it.call('install_key', { key: yt2.id, target: 'clipfarm app', var_name: 'YOUTUBE_API_KEY' }));
    expect(outs[2]).toMatch(/No Access service token for clipfarm at .*cf-access-clipfarm\.env: make one with cloudflare access_service_token_ensure/);
    expect(leaks(outs)).toEqual([]);
    expect(outs.join('\n')).not.toContain('AIzaSyDEMOhandmade');
  });

  it("refuses a file that isn't a service account key, and keeps it", async () => {
    const { swarm, it } = await office('{"type":"authorized_user"}');
    const files = swarm.files.list();
    const out = await it.call('save_provider_key', { provider: 'gcloud', file: files[0].id });
    expect(out).toBe("Refused: That JSON isn't a service account key (its type isn't service_account).");
    expect(swarm.files.get(files[0].id)).toBeDefined();
  });
});
