import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { checklistTools } from './ceoChecklistTools.ts';
import { runTool } from './ceo.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import type { CeoJob, OfficeTools } from './ceo.ts';
import type { ChecklistsState } from '../shared/checklists.ts';
import type { PhoneMessage, ServerEvent } from '../shared/types.ts';

// #612 through the office: the CEO's checklist_create posts its card, the manager's ticks wake the CEO in one job per
// 30 s, the finish is announced once, and a secret field's value reaches Providers only.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  officeTools(): OfficeTools;
  broadcast(ev: ServerEvent): void;
  state: { checklists: ChecklistsState; messages: PhoneMessage[]; ceo: { queue: CeoJob[]; job: CeoJob | null } };
};

const SECRET = 'sk-demo-checklist-secret-Qx81ab12';

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
  return { swarm, o, sent, tools: o.officeTools() };
}

const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Step ${i + 1}` }));

afterEach(() => void vi.useRealTimers());

describe('checklists in the office', () => {
  it('wakes the CEO once for 5 ticks within 30 s, and announces the finish once', async () => {
    vi.useFakeTimers();
    const { swarm, o, tools } = office();
    expect(await tools.call('checklist_create', { title: 'Postiz channels', steps: steps(5) })).toMatch(/^Created c1 “Postiz channels” v1 with 5 steps/);
    expect(o.state.messages.at(-1)).toMatchObject({ from: 'office', checklist: { id: 'c1' } });
    const chats = () => [...o.state.ceo.queue, o.state.ceo.job].filter((j): j is CeoJob => !!j).filter((j) => j.kind === 'chat' && j.text?.includes('worked on their checklists'));
    for (const s of ['s1', 's2', 's3', 's4', 's5']) {
      swarm.checklistStep('c1', s, { action: 'tick' });
      vi.advanceTimersByTime(4_000);
    }
    expect(chats()).toHaveLength(0);
    expect(o.state.messages.filter((m) => m.text.startsWith('✅ Checklist done'))).toHaveLength(1);
    vi.advanceTimersByTime(30_000);
    expect(chats()).toHaveLength(1);
    expect(chats()[0].text!.match(/^- s\d/gm)).toHaveLength(6); // five ticks and the finish
    swarm.checklistStep('c1', 's5', { action: 'untick' });
    swarm.checklistStep('c1', 's5', { action: 'tick' });
    expect(o.state.messages.filter((m) => m.text.startsWith('✅ Checklist done'))).toHaveLength(1);
    expect(await tools.call('checklist_read', { id: 'c1', since: 7 })).toMatch(/^c1 “Postiz channels” v8 · 5 of 5 done · finished · 1 changed since v7\ns5 \[x\] Step 5$/);
  });

  it('saves a secret field to Providers only: never in the checklist, the chat, the state or a broadcast', async () => {
    const { swarm, o, sent, tools } = office();
    await tools.call('checklist_create', { title: 'OpenAI key', steps: [{ title: 'Paste the key', secret: { label: 'API key', provider: 'openai' } }] });
    const c = await swarm.checklistSecret('c1', 's1', SECRET);
    expect(c.steps[0].secret?.saved).toMatchObject({ hint: 'ab12' });
    expect(swarm.providers.keysFor('openai').map((k) => k.key)).toEqual([SECRET]);
    const everything = [...sent, JSON.stringify(o.state), JSON.stringify(swarm.snapshot()), await tools.call('checklist_read', { id: 'c1' })].join('\n');
    expect(everything).not.toContain(SECRET);
    expect(everything).toContain('ends …ab12');
  });

  it("checks the tools' inputs with zod", () => {
    const defs = checklistTools({ checklistCreate: () => '', checklistUpdate: () => '', checklistRead: () => '' }, runTool);
    const ok = (name: string, args: unknown) => z.object(defs.find((d) => d.name === name)!.inputSchema).safeParse(args).success;
    const secretStep = (provider: string) => ({ title: 'YouTube', steps: [{ title: 'Paste the key', copy: [{ label: 'Redirect URI', value: 'https://x.example/cb' }], secret: { label: 'API key', provider } }] });
    expect(ok('checklist_create', secretStep('openai'))).toBe(true);
    expect(ok('checklist_create', secretStep('claude'))).toBe(false); // not a key on the Providers page
    expect(ok('checklist_create', { title: 'Empty', steps: [] })).toBe(false);
    expect(ok('checklist_update', { id: 'c1', edit: [{ id: 's2', title: 'New title' }], add: [{ step: { title: 'More' }, after: 's1' }] })).toBe(true);
    expect(ok('checklist_read', { id: 'c1', since: -1 })).toBe(false);
  });

  it('gives actionable errors', async () => {
    const { swarm, tools } = office();
    expect(await tools.call('checklist_create', { title: 'x', floor: 99, steps: steps(1) })).toMatch(/No floor 99: leave floor out/);
    expect(await tools.call('checklist_update', { id: 'c9', remove: ['s1'] })).toMatch(/No checklist c9: checklist_read without an id lists the open ones/);
    expect(() => swarm.checklistStep('c9', 's1', { action: 'tick' })).toThrow(/No checklist c9/);
  });
});
