import { describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import type { OfficeTools } from './ceo.ts';
import type { ItDeskState } from '../shared/itDesk.ts';
import type { ItDeptSettings, ItState } from '../shared/itDept.ts';
import type { PhoneMessage } from '../shared/types.ts';

// #585 through the office: auto-approve runs a routine it_propose at once, posts it as done automatically with an
// Undo, keeps the units IT installed, and still puts the danger list and step 21 on cards.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  itTools(): OfficeTools;
  state: { itDesk: ItDeskState; it: ItState & { messages: PhoneMessage[] }; settings: { itDept: ItDeptSettings } };
};

function office(level: ItDeptSettings['autoApprove']) {
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
  o.state.settings.itDept.autoApprove = level;
  return { swarm, o, ran, tools: o.itTools() };
}
const propose = (tools: OfficeTools, argv: string[]) => tools.call('it_propose', { argv, why: 'clipfarm runbook', affects: 'clipfarm', undo: 'disable it', risk: 'low' });
const unit = ['install', '-m', '0644', '/opt/clipfarm/deploy/clipfarm.service', '/etc/systemd/system/clipfarm.service'];
const enable = ['systemctl', 'enable', '--now', 'clipfarm.service'];

describe('IT auto-approve in the office', () => {
  it('Off: every change is still a card', async () => {
    const { o, ran, tools } = office('off');
    expect(await propose(tools, unit)).toMatch(/On the manager's card/);
    expect(ran).toEqual([]);
    expect(o.state.itDesk.waiting).toHaveLength(1);
  });

  it('Routine: runs the step at once, logs it as automatic, posts it with an Undo, and the Undo runs', async () => {
    const { swarm, o, ran, tools } = office('routine');
    expect(await propose(tools, enable)).toMatch(/On the manager's card \(auto-approve: .*only units IT installed/); // not IT's unit yet
    expect(await propose(tools, unit)).toMatch(/^Done automatically/);
    expect(o.state.itDesk.units).toEqual(['clipfarm.service']);
    expect(ran).toEqual([unit]);
    o.state.itDesk.waiting = [];
    expect(await propose(tools, enable)).toMatch(/^Done automatically .*step 2 of 20/s);
    const entry = o.state.itDesk.log[0];
    expect(entry).toMatchObject({ kind: 'change', auto: true, argv: enable, code: 0, undo: [['systemctl', 'disable', '--now', 'clipfarm.service']] });
    const card = o.state.it.messages.at(-1)!;
    expect(card.text).toMatch(/Done automatically: `systemctl enable --now clipfarm.service`$/);
    expect(card.itAuto).toEqual({ log: entry.id, undo: true });
    await swarm.itUndo(entry.id);
    expect(ran.at(-1)).toEqual(['systemctl', 'disable', '--now', 'clipfarm.service']);
    expect(o.state.it.messages.find((m) => m.id === card.id)?.itAuto?.undone).toBe(true);
    expect(o.state.it.messages.at(-1)!.text).toMatch(/Undone/);
    await expect(swarm.itUndo(entry.id)).rejects.toThrow(/no Undo/);
  });

  it('Everything except dangerous: the danger list still waits for the manager', async () => {
    const { o, ran, tools } = office('all');
    expect(await propose(tools, ['ufw', 'allow', '8080'])).toMatch(/On the manager's card \(auto-approve: never automatic: it changes the firewall\)/);
    expect(ran).toEqual([]);
    expect(o.state.itDesk.waiting).toHaveLength(1);
  });

  it('asks after 20 automatic steps in one change', async () => {
    const { o, tools } = office('routine');
    o.state.it.job = { kind: 'chat', text: 'install clipfarm', messageIds: [], at: 1 };
    for (let i = 0; i < 20; i++) expect(await propose(tools, ['git', '-C', `/opt/c${i}`, 'fetch'])).toMatch(/^Done automatically/);
    expect(await propose(tools, ['git', '-C', '/opt/c20', 'fetch'])).toMatch(/On the manager's card \(auto-approve: 20 automatic steps/);
    o.state.it.job = { kind: 'chat', text: 'next change', messageIds: [], at: 2 };
    expect(await propose(tools, ['git', '-C', '/opt/c21', 'fetch'])).toMatch(/^Done automatically/);
  });
});
