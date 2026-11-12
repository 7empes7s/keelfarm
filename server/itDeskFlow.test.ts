import { describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import type { OfficeTools } from './ceo.ts';
import type { ItDeskState } from '../shared/itDesk.ts';
import type { PhoneMessage } from '../shared/types.ts';

// #506 through the office: it_run reads at once, it_propose waits for the manager's Run, the never-list holds at Run.
// The tools are the IT department's since #524 (itTools); results land in IT's chat.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  itTools(): OfficeTools;
  state: { itDesk: ItDeskState; it: { messages: PhoneMessage[] } };
};

function office() {
  const backend = createDemoBackend();
  const ran: string[][] = [];
  const exec = backend.itExec;
  backend.itExec = (argv, ms) => {
    ran.push(argv);
    return exec(argv, ms);
  };
  const swarm = new Swarm(backend);
  const o = swarm as unknown as Internals;
  o.ensureCeo([]);
  return { swarm, o, ran, tools: o.itTools() };
}

describe('the IT desk', () => {
  it('runs an allowlisted read at once and logs it', async () => {
    const { o, ran, tools } = office();
    const out = await tools.call('it_run', { command: 'df -h' });
    expect(out).toMatch(/^\$ df -h\nexit 0\nFilesystem/);
    expect(ran).toEqual([['df', '-h']]);
    expect(o.state.itDesk.log[0]).toMatchObject({ kind: 'read', argv: ['df', '-h'], code: 0 });
  });

  it('refuses changes, shells and other programs through it_run, pointing to it_propose', async () => {
    const { ran, tools } = office();
    expect(await tools.call('it_run', { command: 'systemctl restart caddy' })).toMatch(/^Refused: .*it_propose/);
    expect(await tools.call('it_run', { command: 'rm -rf /var/log/old' })).toMatch(/^Refused: .*it_propose/);
    expect(await tools.call('it_run', { command: 'du -sh / | sort -h' })).toMatch(/^Refused: One command, no shell/);
    expect(ran).toEqual([]);
  });

  it("runs a proposal only on the manager's Run, and posts its output", async () => {
    const { swarm, o, ran, tools } = office();
    const out = await tools.call('it_propose', { argv: ['journalctl', '--vacuum-size=500M'], why: 'Old logs', affects: 'frees 3.4 GB', undo: "can't be undone", risk: 'low' });
    expect(out).toMatch(/Nothing has run/);
    expect(ran).toEqual([]);
    const [card] = o.state.itDesk.waiting;
    expect(card).toMatchObject({ argv: ['journalctl', '--vacuum-size=500M'], why: 'Old logs', risk: 'low' });
    await swarm.itRunProposals([card.id]);
    expect(ran).toEqual([['journalctl', '--vacuum-size=500M']]);
    expect(o.state.itDesk.waiting).toEqual([]);
    expect(o.state.itDesk.log[0]).toMatchObject({ kind: 'change', code: 0, argv: ['journalctl', '--vacuum-size=500M'] });
    const posted = o.state.it.messages.at(-1)!;
    expect(posted.text).toMatch(/Ran `journalctl --vacuum-size=500M`/);
    expect(posted.notice?.details).toMatch(/freed 3.4G/);
    await expect(swarm.itRunProposals([card.id])).rejects.toThrow(/run or gone/);
  });

  it('Not now runs nothing', async () => {
    const { swarm, o, ran, tools } = office();
    await tools.call('it_propose', { argv: ['docker', 'image', 'prune', '-af'], why: 'Unused images', affects: 'frees 8.9 GB', undo: 'pulled again', risk: 'medium' });
    swarm.itDismiss([o.state.itDesk.waiting[0].id]);
    expect(o.state.itDesk.waiting).toEqual([]);
    expect(ran).toEqual([]);
  });

  it('refuses never-list commands when proposed, and again at Run', async () => {
    const { swarm, o, ran, tools } = office();
    expect(await tools.call('it_propose', { argv: ['pkill', '-f', 'node'], why: 'x', affects: 'x', undo: 'x', risk: 'high' })).toMatch(/^Refused: Never/);
    expect(o.state.itDesk.waiting).toEqual([]);
    // A card that got past the first check (an older office's) is still refused at Run.
    o.state.itDesk.waiting.push({ id: 'old', argv: ['docker', 'volume', 'prune', '-f'], why: 'x', affects: 'x', undo: 'x', risk: 'high', at: Date.now() });
    await swarm.itRunProposals(['old']);
    expect(ran).toEqual([]);
    expect(o.state.itDesk.log[0]).toMatchObject({ code: null, argv: ['docker', 'volume', 'prune', '-f'] });
    expect(o.state.it.messages.at(-1)!.text).toMatch(/Refused `docker volume prune -f`/);
  });

  it('does nothing while switched off', async () => {
    const { swarm, ran, tools } = office();
    swarm.updateSettings({ itDesk: false });
    expect(await tools.call('it_run', { command: 'df -h' })).toMatch(/^Refused: The IT desk is off/);
    expect(await tools.call('it_propose', { argv: ['apt', 'clean'], why: 'x', affects: 'x', undo: 'x', risk: 'low' })).toMatch(/^Refused: The IT desk is off/);
    expect(ran).toEqual([]);
  });
});
