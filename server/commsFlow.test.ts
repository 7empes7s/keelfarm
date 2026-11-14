import { describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import type { OfficeTools } from './ceo.ts';
import type { CommsState } from '../shared/comms.ts';
import type { MailCred } from './providerActions/types.ts';
import type { ServerEvent } from '../shared/types.ts';

// #668 through the office: mail_send puts a draft on the manager's card instead of sending it, Approve sends it, a
// mailbox's auto-replies send replies at once, refusals come back to the agent, and the mail app's secret never shows.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  officeTools(): OfficeTools;
  broadcast(ev: ServerEvent): void;
  mailStore: { set(c: MailCred): Promise<void> };
  demoSent: { mailbox: string; to: string[]; subject: string }[];
  state: { comms: CommsState; notices: { title: string }[] };
};

const SECRET = 'mail-app-secret-Zq~9917abcdef';

function office() {
  const swarm = new Swarm(createDemoBackend());
  const o = swarm as unknown as Internals;
  const sent: string[] = [];
  const broadcast = o.broadcast.bind(o);
  o.broadcast = (ev) => {
    sent.push(JSON.stringify(ev));
    broadcast(ev);
  };
  o.ensureCeo([]);
  o.state.comms.threads.push({ id: 't1', mailbox: 'support@techinsiderbytes.com', subject: 'Export stuck', with: 'sam@creator.io', unread: true, last: Date.now(), messages: [{ id: 'm1', from: 'sam@creator.io', to: ['support@techinsiderbytes.com'], subject: 'Export stuck', text: 'Help', at: Date.now() }] });
  return { swarm, o, sent, tools: o.officeTools() };
}

describe('Comms in the office (#668)', () => {
  it('holds every send for the manager by default, and sends on Approve', async () => {
    const { swarm, o, tools } = office();
    const draft = await tools.call('mail_draft', { reply_to: 't1', text: 'Looking at it now.' });
    expect(draft).toMatch(/^Draft d1 from support@techinsiderbytes.com to sam@creator.io, "Re: Export stuck"/);
    expect(await tools.call('mail_send', { draft: 'd1' })).toMatch(/^d1 is on the manager's phone for Approve/);
    expect(o.demoSent).toEqual([]);
    expect(o.state.comms.drafts[0].status).toBe('waiting');
    expect(o.state.notices.at(-1)?.title).toBe('An email is waiting for you');
    const d = await swarm.approveDraft('d1', { text: 'Fixed: try the export again.' });
    expect(d).toMatchObject({ status: 'sent', text: 'Fixed: try the export again.' });
    expect(o.demoSent).toEqual([{ mailbox: 'support@techinsiderbytes.com', to: ['sam@creator.io'], subject: 'Re: Export stuck' }]);
    expect(o.state.comms.threads[0].messages.at(-1)).toMatchObject({ out: true, text: 'Fixed: try the export again.' });
  });

  it("sends a reply at once only when the mailbox's auto-replies are on", async () => {
    const { swarm, o, tools } = office();
    swarm.setCommsSettings({ mailboxes: [{ address: 'support@techinsiderbytes.com', autoReplies: true }] });
    await tools.call('mail_draft', { reply_to: 't1', text: 'Got it.' });
    expect(await tools.call('mail_send', { draft: 'd1' })).toMatch(/^Sent d1 to sam@creator.io \(support@techinsiderbytes.com's auto-replies are on\)/);
    await tools.call('mail_draft', { mailbox: 'support@techinsiderbytes.com', to: ['new@example.com'], subject: 'Hi', text: 'News' });
    expect(await tools.call('mail_send', { draft: 'd2' })).toMatch(/on the manager's phone/); // a new email still waits
    expect(o.demoSent).toHaveLength(1);
  });

  it('refuses a mailbox outside the list and a suppressed address, back to the agent', async () => {
    const { swarm, tools } = office();
    expect(await tools.call('mail_draft', { mailbox: 'maro@techinsiderbytes.com', to: ['a@example.com'], subject: 'Hi', text: 'x' })).toMatch(/^Refused: maro@techinsiderbytes.com isn't one of the office's shared mailboxes/);
    swarm.suppressAddress('gone@example.com');
    await tools.call('mail_draft', { mailbox: 'hello@techinsiderbytes.com', to: ['gone@example.com'], subject: 'Hi', text: 'x' });
    expect(await tools.call('mail_send', { draft: 'd1' })).toBe('Refused: gone@example.com asked not to be emailed (suppression list).');
    await expect(swarm.approveDraft('d1', {})).rejects.toThrow(/suppression list/);
  });

  it("never shows the mail app's secret in what goes to the tabs or the CEO", async () => {
    const { o, sent, tools } = office();
    await o.mailStore.set({ tenant: 't', appObjectId: 'o', clientId: 'c', keyId: 'k', secret: SECRET, expiresAt: Date.now() + 1e10, domain: 'techinsiderbytes.com', mailboxes: ['support@techinsiderbytes.com'] });
    const { swarm } = { swarm: o as unknown as Swarm };
    await tools.call('mail_draft', { reply_to: 't1', text: 'x' });
    await tools.call('mail_send', { draft: 'd1' });
    await expect(swarm.approveDraft('d1', {})).rejects.toThrow(/Exchange refused it/); // the fake tenant has no scope for this app
    const outs = [await tools.call('mail_list', {}), await tools.call('company_status', {}), JSON.stringify(swarm.snapshot())];
    expect([...outs, ...sent].join('\n')).not.toContain(SECRET);
  });
});
