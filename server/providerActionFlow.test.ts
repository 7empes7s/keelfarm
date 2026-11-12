import { describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { DEMO_REPO, fakeProviderHttp } from './demo/providerActions.ts';
import { Swarm } from './swarm.ts';
import type { OfficeTools } from './ceo.ts';
import type { ItDeskState } from '../shared/itDesk.ts';
import type { ItAutoLevel } from '../shared/itDept.ts';
import type { PhoneMessage, ServerEvent } from '../shared/types.ts';

// #602 through the office: provider_action reads at once, puts a write on a card (or applies it under auto-approve's
// rules), and the key never reaches a tool's output, a card, the state, a chat or a broadcast.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  itTools(): OfficeTools;
  officeTools(): OfficeTools;
  broadcast(ev: ServerEvent): void;
  state: { itDesk: ItDeskState; it: { messages: PhoneMessage[] }; messages: PhoneMessage[]; settings: { itDept: { autoApprove: ItAutoLevel } } };
};

const SECRET = 'ghp_live_Zq81xWvP0aa7secret';

async function office(level: ItAutoLevel = 'off') {
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
  o.state.settings.itDept.autoApprove = level;
  await swarm.providers.add('github', 'ghp_bad_old_token_0001', 'GitHub (old)');
  await swarm.providers.add('github', SECRET, 'GitHub token');
  const call = (t: OfficeTools, op: string, args: Record<string, unknown> = {}) => t.call('provider_action', { provider: 'github', op, args: { repo: DEMO_REPO, ...args } });
  return { swarm, o, net, sent, it: o.itTools(), call };
}

describe('provider_action through the office', () => {
  it('reads now, puts a write on a diff card, applies it on Approve, never showing the key', async () => {
    const { swarm, o, net, sent, it, call } = await office();
    const outs = [await call(it, 'repo_get')];
    expect(outs[0]).toMatch(new RegExp(`^${DEMO_REPO} \\(private, default branch main, read with "GitHub token"\\)\\nallow_auto_merge: off\\ndelete_branch_on_merge: off`, 'm'));
    outs.push(await call(it, 'repo_settings', { delete_branch_on_merge: true }));
    expect(outs[1]).toMatch(/^On the manager's card with its diff: `github repo_settings demo-co\/storefront delete_branch_on_merge=true`/);
    const [card] = o.state.itDesk.waiting;
    expect(card).toMatchObject({ pa: { provider: 'github', op: 'repo_settings', data: { want: { delete_branch_on_merge: true } } }, risk: 'medium' });
    expect(card.diff).toContain('+ delete_branch_on_merge: on');
    expect(net.calls.some((c) => c.method !== 'GET')).toBe(false);
    expect(await call(it, 'repo_settings', { delete_branch_on_merge: true })).toMatch(/^Refused: .*already waits for the manager's Approve/);

    expect((await swarm.itRunProposals([card.id])).results).toEqual([{ id: card.id, code: 0 }]);
    expect(net.world.repo.delete_branch_on_merge).toBe(true);
    expect(o.state.it.messages.at(-1)!.notice?.details).toMatch(/^Read back: /);
    expect(o.state.messages.at(-1)!.text).toMatch(/Applied `github repo_settings/); // the CEO's chat too
    expect(net.calls.filter((c) => c.method === 'PATCH').map((c) => c.key)).toEqual([SECRET]); // the key went to GitHub only

    const everything = [...outs, ...sent, JSON.stringify(o.state)].join('\n');
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('ghp_bad_old_token_0001');
  });

  it("applies routine writes by themselves under auto-approve, never destructive ones; and it's the CEO's too", async () => {
    const { o, net, it, call } = await office('routine');
    expect(await call(it, 'run_rerun', { run_id: 4242 })).toMatch(/^Done automatically \(auto-approve\): .*Rerun asked for run 4242/s);
    expect(net.world.reruns).toEqual([4242]);
    expect(o.state.itDesk.log[0]).toMatchObject({ auto: true, argv: ['github', 'run_rerun', DEMO_REPO, '4242'], code: 0 });
    expect(await call(it, 'repo_settings', { allow_auto_merge: true })).toMatch(/^On the manager's card with its diff \(auto-approve: a change waits for "everything except dangerous"\)/);
    o.state.settings.itDept.autoApprove = 'all';
    expect(await call(o.officeTools(), 'secret_delete', { name: 'NPM_TOKEN' })).toMatch(/^On the manager's card with its diff \(auto-approve: destructive changes are never automatic\)/);
    expect(net.world.secrets).toContain('NPM_TOKEN');
    expect(o.state.itDesk.waiting.map((p) => p.pa?.op)).toEqual(['repo_settings', 'secret_delete']);
    expect(o.state.itDesk.waiting[1].risk).toBe('high');
  });

  it('keeps the cloudflare tool on the layer, and says what to do when no key can', async () => {
    const { o, call } = await office();
    expect(await o.itTools().call('provider_action', { provider: 'cloudflare', op: 'tunnel_ingress_get' })).toMatch(/^Refused: No Cloudflare key: add an API token in Settings → Providers → Cloudflare/);
    expect(await call(o.itTools(), 'secrets_list', { repo: 'someone/else' })).toMatch(/^Refused: GitHub found nothing at \/repos\/someone\/else/);
  });
});
