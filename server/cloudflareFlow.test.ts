import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME_DIR } from './config.ts';
import { createDemoBackend } from './demo.ts';
import { fakeCloudflare } from './demo/cloudflare.ts';
import { Swarm } from './swarm.ts';
import type { OfficeTools } from './ceo.ts';
import type { ItDeskState } from '../shared/itDesk.ts';
import type { PhoneMessage, ServerEvent } from '../shared/types.ts';

// #586 through the office: the cloudflare action puts a diff card, Approve applies it and reads it back, and the key
// never reaches a tool's output, a card, the state, a chat or a broadcast.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  itTools(): OfficeTools;
  officeTools(): OfficeTools;
  broadcast(ev: ServerEvent): void;
  state: { itDesk: ItDeskState; it: { messages: PhoneMessage[] }; messages: PhoneMessage[] };
};

const SECRET = 'cf-live-token-Zq81xWvP0aa7';

async function office(access = false) {
  const backend = createDemoBackend();
  const cf = fakeCloudflare({ access });
  backend.cloudflareApi = cf.api;
  const swarm = new Swarm(backend);
  const o = swarm as unknown as Internals;
  const sent: string[] = [];
  const broadcast = o.broadcast.bind(o);
  o.broadcast = (ev) => {
    sent.push(JSON.stringify(ev));
    broadcast(ev);
  };
  o.ensureCeo([]);
  await swarm.providers.add('cloudflare', 'cf-bad-old-token-0001', 'Cloudflare');
  await swarm.providers.add('cloudflare', SECRET, 'Cloudflare (LiteLLM litellm.env)');
  return { swarm, o, cf, sent, tools: o.itTools() };
}

describe('the cloudflare office action', () => {
  it('puts a diff card, applies it on Approve and reads it back, never showing the key', async () => {
    const { swarm, o, cf, sent, tools } = await office();
    const outs = [await tools.call('cloudflare', { op: 'token_scopes', hostname: 'clip.techinsiderbytes.com' })];
    expect(outs[0]).toMatch(/"Cloudflare" \(its Providers test fails\):\n {2}✗ token turned away/);
    outs.push(await tools.call('cloudflare', { op: 'tunnel_ingress_add', hostname: 'clip.techinsiderbytes.com', service: 'http://localhost:80' }));
    expect(outs[1]).toMatch(/On the manager's card with its diff/);
    expect(cf.calls.some((c) => c.method !== 'GET')).toBe(false);
    const [card] = o.state.itDesk.waiting;
    expect(card).toMatchObject({ argv: ['cloudflare', 'tunnel_ingress_add', 'clip.techinsiderbytes.com', 'http://localhost:80'], cf: { op: 'tunnel_ingress_add', tunnelName: 'main' } });
    expect(card.diff).toContain('+ clip.techinsiderbytes.com → http://localhost:80');
    // asking again doesn't stack a second card
    expect(await tools.call('cloudflare', { op: 'tunnel_ingress_add', hostname: 'clip.techinsiderbytes.com', service: 'http://localhost:80' })).toMatch(/^Refused: .*already waits for the manager's Approve/);

    expect((await swarm.itRunProposals([card.id])).results).toEqual([{ id: card.id, code: 0 }]);
    expect(cf.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect((cf.world.config.ingress as { hostname?: string }[]).map((r) => r.hostname)).toEqual(['keel.techinsiderbytes.com', 'clip.techinsiderbytes.com', undefined]);
    expect(o.state.it.messages.at(-1)!.notice?.details).toMatch(/^Read back: tunnel main ingress:/);
    expect(o.state.messages.at(-1)!.text).toMatch(/Applied `cloudflare tunnel_ingress_add/); // the CEO's chat too
    outs.push(await tools.call('cloudflare', { op: 'tunnel_ingress_get' }));
    expect(outs[2]).toContain('clip.techinsiderbytes.com → http://localhost:80');

    const everything = [...outs, ...sent, JSON.stringify(o.state)].join('\n');
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('cf-bad-old-token-0001');
  });

  it("is the CEO's too, and says which permission a 1001 lacks", async () => {
    const { swarm, o } = await office();
    swarm.providers.keysFor('cloudflare').forEach((k) => void swarm.providers.remove(k.id));
    await swarm.providers.add('cloudflare', 'cf-notunnel-token-0002', 'Old token');
    const out = await o.officeTools().call('cloudflare', { op: 'tunnel_ingress_add', hostname: 'clip.techinsiderbytes.com', service: 'http://localhost:80' });
    expect(out).toMatch(/^Refused: No Cloudflare key can do this: the key needs Account › Cloudflare Tunnel › Edit \("Old token"\)/);
    expect(o.state.itDesk.waiting).toEqual([]);
  });

  it('ensures a service token on a card, its secret only in the env file (#607)', async () => {
    const { swarm, o, cf, sent, tools } = await office(true);
    const args = { op: 'access_service_token_ensure', hostname: 'keel.techinsiderbytes.com', name: 'clipfarm e2e', env_file: '/etc/clipfarm/clipfarm.env' };
    const outs = [await tools.call('cloudflare', args)];
    const file = path.join(HOME_DIR, 'secrets', 'clipfarm.env'); // the demo keeps it inside its own home
    expect(outs[0]).toContain(`+ its client id and secret stored at ${file} (mode 600)`);
    const [card] = o.state.itDesk.waiting;
    expect(card).toMatchObject({ argv: ['cloudflare', 'access_service_token_ensure', 'keel.techinsiderbytes.com', 'clipfarm e2e'], cf: { op: 'access_service_token_ensure', envFile: file } });
    expect((await swarm.itRunProposals([card.id])).results).toEqual([{ id: card.id, code: 0 }]);
    const [secret] = cf.world.secrets;
    expect(await fs.readFile(file, 'utf8')).toContain(`CF_ACCESS_CLIENT_SECRET=${secret}`);
    expect(o.state.it.messages.at(-1)!.notice?.details).toContain(`its secret is stored at ${file}`);
    outs.push(await tools.call('cloudflare', args));
    expect(outs[1]).toMatch(/already gets through Access .* Nothing to approve\.$/);
    const everything = [...outs, ...sent, JSON.stringify(o.state), JSON.stringify(cf.calls)].join('\n');
    expect(everything).not.toContain(secret);
    await fs.rm(file, { force: true });
  });
});
