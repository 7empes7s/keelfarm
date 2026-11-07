import { describe, expect, it } from 'vitest';
import type { Decision } from '../shared/decisions.ts';
import type { PhoneMessage, ServerEvent } from '../shared/types.ts';
import { createDemoBackend } from './demo.ts';
import type { OfficeTools } from './ceo.ts';
import { Swarm } from './swarm.ts';

// Open decisions (#114) through the office itself: the chat opens and closes them, the CEO sees and resolves them,
// and they follow the charter proposals they're about.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  officeTools(): OfficeTools;
  postMessage(from: PhoneMessage['from'], text: string): PhoneMessage;
  ceoAsked: boolean;
  broadcast(ev: ServerEvent): void;
  state: { decisions: { list: Decision[] } };
};

async function office() {
  const swarm = new Swarm(createDemoBackend());
  const view = await swarm.connectRepo('demo-co/pixel-todo', { mission: 'A cheerful todo app' });
  const internals = swarm as unknown as Internals;
  internals.ensureCeo([]);
  const sent: ServerEvent[] = [];
  const broadcast = internals.broadcast.bind(swarm);
  internals.broadcast = (ev) => (sent.push(ev), broadcast(ev));
  const open = () => internals.state.decisions.list.filter((d) => d.status === 'open');
  const status = async () => JSON.parse(await internals.officeTools().call('company_status', {})) as { openDecisions: { id: string; question: string; trayOnly?: true }[] };
  return { swarm, id: view.id, internals, open, sent, status };
}

const ASK = 'Shall I file the quieter memory alert fix, or lower the margin?\n```suggestions\nFile the fix\nLower the margin\n```';

describe('open decisions', () => {
  it('a question with suggestions waits until the manager taps an option, and every tab hears of it', async () => {
    const { swarm, internals, open, sent } = await office();
    const m = internals.postMessage('ceo', ASK);
    expect(open()).toMatchObject([{ id: `msg:${m.id}`, question: 'Shall I file the quieter memory alert fix, or lower the margin?', options: ['File the fix', 'Lower the margin'] }]);
    expect(swarm.snapshot().decisions).toHaveLength(1);
    internals.postMessage('manager', 'How is floor 1?'); // about something else: it stays
    expect(open()).toHaveLength(1);
    await swarm.messageCeo('Lower the margin', m.id); // the tray's tap: the same reply as under the message
    expect(open()).toEqual([]);
    expect(sent.filter((e) => e.type === 'decisions').at(-1)).toMatchObject({ decisions: [{ status: 'resolved', outcome: 'Lower the margin' }] });
  });

  it('the CEO sees them in company_status, stops asking one raised twice, and closes one answered in words', async () => {
    const { internals, open, status } = await office();
    const m = internals.postMessage('ceo', ASK);
    expect((await status()).openDecisions).toEqual([expect.objectContaining({ id: `msg:${m.id}` })]);
    internals.postMessage('ceo', ASK);
    expect((await status()).openDecisions[0].trayOnly).toBe(true);
    expect(await internals.officeTools().call('resolve_decision', { id: 'msg:999', outcome: 'x' })).toMatch(/^Refused: No decision/);
    expect(await internals.officeTools().call('resolve_decision', { id: `msg:${m.id}`, outcome: 'quieter fix' })).toMatch(/^Closed/);
    expect(open()).toEqual([]);
    const n = internals.postMessage('ceo', 'Did the GitHub payment go through?\n```suggestions\nYes\nNot yet\n```');
    expect(await internals.officeTools().call('resolve_decision', { id: `msg:${n.id}`, outcome: 'asked again', superseded: true })).toMatch(/^Superseded/);
    expect(internals.state.decisions.list.find((d) => d.id === `msg:${n.id}`)).toMatchObject({ status: 'superseded' });
    expect((await status()).openDecisions).toEqual([]);
  });

  it('Not now and Drop it take it out of the CEO list', async () => {
    const { swarm, internals, status } = await office();
    const m = internals.postMessage('ceo', ASK);
    swarm.decideOpen(`msg:${m.id}`, 'snooze');
    expect((await status()).openDecisions).toEqual([]);
    swarm.decideOpen(`msg:${m.id}`, 'drop');
    expect(() => swarm.decideOpen(`msg:${m.id}`, 'drop')).toThrow(/no longer open/);
    internals.postMessage('ceo', ASK); // asked again: never raised again
    expect((await status()).openDecisions).toEqual([]);
  });

  // #208: answered by doing, in a job the manager's message started
  it("the CEO's file_issue closes the question it answers, marks a vague one probably answered, and the manager settles or reopens them", async () => {
    const { swarm, internals, open } = await office();
    const sure = internals.postMessage('ceo', 'Should I also file the dark mode toggle for floor 1?\n```suggestions\nYes, file it\nNot now\n```');
    const vague = internals.postMessage('ceo', 'C was the dark mode toggle for the console. Want it?\n```suggestions\nYes\nNo\n```');
    internals.postMessage('ceo', 'Floor 1: raise the memory margin?\n```suggestions\nRaise it\nLeave it\n```');
    expect(open()).toHaveLength(3);
    await internals.officeTools().call('file_issue', { floor: 1, title: 'Dark mode toggle for the console', body: 'x' }); // not asked: refused, nothing changes
    expect(open()).toHaveLength(3);
    internals.ceoAsked = true;
    expect(await internals.officeTools().call('file_issue', { floor: 1, title: 'Dark mode toggle for the console', body: 'A toggle.' })).toMatch(/^Filed #(\d+)/);
    const byId = (id: number) => internals.state.decisions.list.find((d) => d.id === `msg:${id}`)!;
    expect(byId(sure.id)).toMatchObject({ status: 'resolved', closedBy: { kind: 'action' } });
    expect(byId(vague.id)).toMatchObject({ status: 'open', probably: { done: expect.stringMatching(/^filed #\d+$/) } });
    expect(open()).toHaveLength(2);
    swarm.decideOpen(`msg:${vague.id}`, 'answered');
    expect(byId(vague.id)).toMatchObject({ status: 'resolved', closedBy: { kind: 'confirmed' } });
    swarm.decideOpen(`msg:${sure.id}`, 'reopen');
    expect(byId(sure.id)).toMatchObject({ status: 'open', closedAt: null });
    expect(() => swarm.decideOpen(`msg:${sure.id}`, 'answered')).toThrow(/not marked/);
  });

  it('a charter proposal is a decision until the manager decides it', async () => {
    const { swarm, id, internals, open } = await office();
    await internals.officeTools().call('propose_charter', { floor: 1, reason: 'Make contrast a standard.', standards: ['Text meets WCAG AA contrast'] });
    expect(open()).toMatchObject([{ kind: 'charter', repoIds: [id] }]);
    swarm.decideCharter(id, false);
    expect(open()).toEqual([]);
  });
});
