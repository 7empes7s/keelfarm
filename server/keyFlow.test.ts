import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { DEMO_CF, fakeCloudflare } from './demo/cloudflare.ts';
import { Swarm } from './swarm.ts';
import { HOME_DIR } from './config.ts';
import type { OfficeTools } from './ceo.ts';
import type { ItDeskState } from '../shared/itDesk.ts';
import type { ItAutoLevel } from '../shared/itDept.ts';
import type { PhoneMessage, ServerEvent } from '../shared/types.ts';

// #609 through the office: install_key writes a Providers key into an allow-listed service env file on Approve (or
// under auto-approve, with an Undo), save_provider_key takes a key pasted in chat out of the stored chat, and a narrow
// Cloudflare token the office made is renewed before it expires, installed where the old one was, the old one revoked.
// The value is in no tool output, card, log, chat, broadcast or the state.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  itTools(): OfficeTools;
  officeTools(): OfficeTools;
  broadcast(ev: ServerEvent): void;
  renewKeys(now?: number): Promise<void>;
  agentRt: Map<string, { log: { id: number; t: number; kind: string; text: string }[] }>;
  state: { itDesk: ItDeskState; it: { messages: PhoneMessage[] }; messages: PhoneMessage[]; settings: { itDept: { autoApprove: ItAutoLevel } } };
};

const OPENAI = 'sk-proj-liveValue0000000000ab12';
const CLIPFARM = path.join(HOME_DIR, 'demo-services', 'clipfarm.env');
const DAY = 86_400_000;

async function office(level: ItAutoLevel = 'off') {
  await fs.rm(path.join(HOME_DIR, 'demo-services'), { recursive: true, force: true });
  await fs.mkdir(path.dirname(CLIPFARM), { recursive: true });
  await fs.writeFile(CLIPFARM, 'PORT=8080\nWHISPER_MODEL=small\n');
  const backend = createDemoBackend();
  const cf = fakeCloudflare();
  backend.cloudflareApi = cf.api;
  const ran: string[][] = [];
  const exec = backend.itExec;
  backend.itExec = (argv, ms) => (ran.push(argv), exec(argv, ms));
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
  const key = await swarm.providers.add('openai', OPENAI, 'OpenAI (clipfarm)');
  const everything = (outs: string[]) => [...outs, ...sent, JSON.stringify(o.state), JSON.stringify(swarm.snapshot())].join('\n');
  return { swarm, o, cf, ran, key, it: o.itTools(), ceo: o.officeTools(), everything };
}

describe('install_key through the office', () => {
  it('puts a card with only the last 4 characters, writes the file on Approve and restarts the unit', async () => {
    const { swarm, o, ran, key, it, ceo, everything } = await office();
    const outs = [await ceo.call('install_key', { key: 'OpenAI (clipfarm)', target: '/etc/clipfarm/clipfarm.env', var_name: 'OPENAI_API_KEY' })];
    expect(outs[0]).toMatch(/^On the manager's card: `install_key OPENAI_API_KEY \/etc\/clipfarm\/clipfarm.env`, OPENAI_API_KEY → \/etc\/clipfarm\/clipfarm.env \(ends …ab12\)/);
    const [card] = o.state.itDesk.waiting;
    expect(card).toMatchObject({ ki: { keyId: key.id, file: '/etc/clipfarm/clipfarm.env', var: 'OPENAI_API_KEY', unit: 'clipfarm.service' }, risk: 'low', affects: 'OPENAI_API_KEY → /etc/clipfarm/clipfarm.env (ends …ab12), then restart clipfarm.service' });
    expect(await fs.readFile(CLIPFARM, 'utf8')).not.toContain(OPENAI); // nothing before Approve

    expect((await swarm.itRunProposals([card.id])).results).toEqual([{ id: card.id, code: 0 }]);
    expect(await fs.readFile(CLIPFARM, 'utf8')).toBe(`PORT=8080\nWHISPER_MODEL=small\nOPENAI_API_KEY=${OPENAI}\n`);
    expect(ran).toContainEqual(['systemctl', 'restart', 'clipfarm.service']);
    expect(swarm.providers.view().connections.find((c) => c.id === key.id)!.installs).toEqual([{ file: '/etc/clipfarm/clipfarm.env', var: 'OPENAI_API_KEY', unit: 'clipfarm.service' }]);
    expect(o.state.it.messages.at(-1)!.notice?.details).toMatch(/^Installed OPENAI_API_KEY → \/etc\/clipfarm\/clipfarm.env \(ends …ab12\) \(mode 600; the file before is at .*\.bak\.env\)\.\nRestarted clipfarm.service\./);

    outs.push(await it.call('install_key', { key: 'openai', target: '/etc/keel/keel.env', var_name: 'OPENAI_API_KEY' }));
    expect(outs[1]).toMatch(/^Refused: \/etc\/keel\/keel.env isn't on the list of service env files/);
    outs.push(await it.call('it_propose', { argv: ['cp', '/tmp/x', '/etc/clipfarm/clipfarm.env'], why: 'w', affects: 'a', undo: 'u', risk: 'low' }));
    expect(outs[2]).toMatch(/^On the manager's card/); // other writes to a credential file wait for a Run (#625)
    expect(everything(outs)).not.toContain(OPENAI);
  });

  it('installs at once under auto-approve, and its Undo puts the file back', async () => {
    const { swarm, o, it, everything } = await office('routine');
    const out = await it.call('install_key', { key: 'openai', target: '/etc/clipfarm/clipfarm.env', var_name: 'OPENAI_API_KEY' });
    expect(out).toMatch(/^Done automatically \(auto-approve\): Installed OPENAI_API_KEY/);
    expect(await fs.readFile(CLIPFARM, 'utf8')).toContain(`OPENAI_API_KEY=${OPENAI}`);
    const entry = o.state.itDesk.log[0];
    expect(entry).toMatchObject({ auto: true, argv: ['install_key', 'OPENAI_API_KEY', '/etc/clipfarm/clipfarm.env'], code: 0 });
    expect(o.state.it.messages.at(-1)!.itAuto).toMatchObject({ log: entry.id, undo: true });
    expect(await swarm.itUndo(entry.id)).toEqual({ ok: true });
    expect(await fs.readFile(CLIPFARM, 'utf8')).toBe('PORT=8080\nWHISPER_MODEL=small\n');
    expect(everything([out])).not.toContain(OPENAI);
  });
});

describe('save_provider_key', () => {
  it('saves a pasted Twitch pair and masks it in the stored chat', async () => {
    const { swarm, o, ceo, everything } = await office();
    const pair = 'twitchclientid000001:twitchsecretvalue00009';
    o.state.messages.push({ id: 99_000, from: 'manager', text: `Here are the Twitch keys: ${pair}`, at: Date.now() });
    o.state.messages.push({ id: 99_001, from: 'manager', text: 'and the secret again twitchsecretvalue00009', at: Date.now() });
    o.agentRt.get('ceo')!.log.push({ id: 1, t: Date.now(), kind: 'text', text: `▶ Manager: Here are the Twitch keys: ${pair}` });
    const out = await ceo.call('save_provider_key', { provider: 'twitch', value: pair, label: 'Twitch', uses: 'clipfarm' });
    expect(out).toMatch(/^Saved in Settings → Providers as "Twitch" \(id \w+, ends …0009\)\..* \(2 messages\)/);
    const c = swarm.providers.view().connections.find((x) => x.provider === 'twitch')!;
    expect(swarm.providers.keyValue(c.id)).toBe(pair);
    expect(c.usedBy).toBe('clipfarm');
    const texts = o.state.messages.filter((x) => x.from === 'manager').map((x) => x.text);
    expect(texts).toContain('Here are the Twitch keys: •••• (saved to Providers as Twitch)');
    expect(texts).toContain('and the secret again •••• (saved to Providers as Twitch)');
    expect(o.agentRt.get('ceo')!.log.at(-1)!.text).toBe('▶ Manager: Here are the Twitch keys: •••• (saved to Providers as Twitch)');

    const install = await ceo.call('install_key', { key: 'Twitch', target: '/etc/clipfarm/clipfarm.env', var_name: 'TWITCH_CLIENT_SECRET', part: 'secret' });
    expect(install).toMatch(/TWITCH_CLIENT_SECRET → \/etc\/clipfarm\/clipfarm.env \(ends …0009\)/);
    expect(everything([out, install])).not.toContain('twitchsecretvalue00009');
    expect(everything([out, install])).not.toContain('twitchclientid000001');
  });
});

describe('a narrow Cloudflare token the office made', () => {
  it('is made least-scope on Approve, renewed before it expires, installed again, and the old one revoked', async () => {
    const { swarm, o, cf, it, everything } = await office('routine');
    await swarm.providers.add('cloudflare', 'demo-cf-token-parent-0001', 'Cloudflare', '', DEMO_CF.account);
    const outs = [await it.call('provider_action', { provider: 'cloudflare', op: 'token_create', args: { name: 'clipfarm DNS', permissions: ['dns write', 'Zone Read'], days: 30 } })];
    expect(outs[0]).toMatch(/^On the manager's card with its diff \(auto-approve: a change waits for "everything except dangerous"\): `cloudflare token_create 'clipfarm DNS'`/);
    const [card] = o.state.itDesk.waiting;
    expect(card.pa).toMatchObject({ provider: 'cloudflare', op: 'token_create' });
    expect(card.diff).toContain('+   DNS Write\n+   Zone Read\n+ expires in 30 days');
    expect((await swarm.itRunProposals([card.id])).results).toEqual([{ id: card.id, code: 0 }]);
    expect(cf.world.apiTokens).toHaveLength(1);
    const first = cf.world.apiTokens[0];
    expect(first.policies).toEqual([{ effect: 'allow', resources: { [`com.cloudflare.api.account.${DEMO_CF.account}`]: { 'com.cloudflare.api.account.zone.*': '*' } }, permission_groups: [{ id: 'g-dns-edit' }, { id: 'g-zone-read' }] }]);
    const made = swarm.providers.view().connections.find((c) => c.mint)!;
    expect(made).toMatchObject({ provider: 'cloudflare', label: 'clipfarm DNS', mint: { tokenId: first.id, days: 30 } });
    expect(swarm.providers.keyValue(made.id)).toBe(first.value);

    outs.push(await it.call('install_key', { key: made.id, target: '/etc/clipfarm/clipfarm.env', var_name: 'CLOUDFLARE_API_TOKEN' }));
    expect(await fs.readFile(CLIPFARM, 'utf8')).toContain(`CLOUDFLARE_API_TOKEN=${first.value}`);

    await o.renewKeys(Date.now() + 10 * DAY); // 20 days left: not yet
    expect(cf.world.apiTokens.map((t) => t.id)).toEqual([first.id]);
    await o.renewKeys(Date.now() + 24 * DAY); // 6 days left
    expect(cf.world.apiTokens).toHaveLength(1);
    const second = cf.world.apiTokens[0];
    expect(second.id).not.toBe(first.id); // the old one revoked
    expect(second.policies).toEqual(first.policies);
    expect(swarm.providers.keyValue(made.id)).toBe(second.value);
    expect(await fs.readFile(CLIPFARM, 'utf8')).toBe(`PORT=8080\nWHISPER_MODEL=small\nCLOUDFLARE_API_TOKEN=${second.value}\n`);
    expect(o.state.it.messages.at(-1)!.text).toBe('🔑 Renewed "clipfarm DNS"');
    expect(o.state.it.messages.at(-1)!.notice?.details).toMatch(/Made a new "clipfarm DNS" token .*\nInstalled CLOUDFLARE_API_TOKEN .*\nRestarted clipfarm.service.\nRevoked the old token./s);
    for (const v of [first.value, second.value, 'demo-cf-token-parent-0001']) expect(everything(outs)).not.toContain(v);
  });

  it("keeps the old token when the new one can't be installed", async () => {
    const { swarm, o, cf, it } = await office();
    await swarm.providers.add('cloudflare', 'demo-cf-token-parent-0001', 'Cloudflare', '', DEMO_CF.account);
    await it.call('provider_action', { provider: 'cloudflare', op: 'token_create', args: { name: 't', permissions: ['DNS Write'], days: 5 } });
    await swarm.itRunProposals([o.state.itDesk.waiting[0].id]);
    const made = swarm.providers.view().connections.find((c) => c.mint)!;
    await swarm.providers.noteInstall(made.id, { file: '/etc/somewhere/else.env', var: 'CF' }); // off the allow-list
    await o.renewKeys();
    expect(cf.world.apiTokens).toHaveLength(2);
    expect(o.state.it.messages.at(-1)!.text).toBe('🔑 Couldn\'t renew "t"');
  });
});
