import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// Telegram in a demo office (docs/pocket.md): the fake manager links their chat, writes to the CEO from Telegram,
// gets the CEO's reply there, and decides a team change with the message's buttons.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  postMessage(from: 'ceo', text: string): void;
};

const TOKEN = '123456789:AAEdemoSECRETtokenSECRETtoken42424242';
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
};

afterEach(() => vi.restoreAllMocks());

async function office() {
  const logs: string[] = [];
  for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
  const swarm = new Swarm(createDemoBackend());
  await swarm.telegram.remove(); // a clean start: tests share the demo's files
  await swarm.connectRepo('demo-co/pixel-todo');
  (swarm as unknown as Internals).ensureCeo([]);
  return { swarm, logs, sent: () => logs.filter((l) => l.startsWith('✈️ demo Telegram would send')) };
}

describe('Telegram in the office', () => {
  it('refuses send_telegram until the chat is linked, then chats with the CEO both ways', async () => {
    const { swarm, logs, sent } = await office();
    const tools = (swarm as unknown as { officeTools(): { call(n: string, a: unknown): Promise<string> } }).officeTools();
    expect(await tools.call('send_telegram', { text: 'The plan' })).toMatch(/^Refused: Telegram isn't set up/);

    await swarm.telegram.setToken(TOKEN);
    swarm.telegramDemo({ kind: 'start' });
    await until(() => swarm.snapshot().notifyChannels.telegram.linked);
    expect(sent().at(-1)).toContain('Linked to your cubefarm office');

    // A message from Telegram reaches the CEO chat, marked as such; the CEO's reply goes back there.
    swarm.telegramDemo({ kind: 'message', text: 'How is floor 1?' });
    await until(() => swarm.snapshot().messages.some((m) => m.text === 'How is floor 1?'));
    expect(swarm.snapshot().messages.find((m) => m.text === 'How is floor 1?')).toMatchObject({ from: 'manager', telegram: 'in' });
    (swarm as unknown as Internals).postMessage('ceo', 'All green on floor 1.');
    expect(swarm.snapshot().messages.at(-1)).toMatchObject({ from: 'ceo', telegram: 'out' });
    await until(() => sent().some((l) => l.includes('All green on floor 1.')));

    // From the phone again: the CEO answers on the phone only, unless the whole chat is mirrored.
    await swarm.messageCeo('And floor 2?');
    (swarm as unknown as Internals).postMessage('ceo', 'There is no floor 2.');
    expect(swarm.snapshot().messages.at(-1)?.telegram).toBeUndefined();
    swarm.updateSettings({ notify: { ...swarm.snapshot().settings.notify, telegramMirror: true } });
    (swarm as unknown as Internals).postMessage('ceo', 'Mirrored.');
    expect(swarm.snapshot().messages.at(-1)?.telegram).toBe('out');

    // The CEO corrects its mirrored message (#125): struck through on the phone, edited in place on Telegram.
    await until(() => sent().some((l) => l.includes('Mirrored.')));
    expect(await tools.call('edit_message', { text: 'Mirrored, edited.', reason: 'typo' })).toMatch(/^Edited #\d+/);
    expect(swarm.snapshot().messages.at(-1)).toMatchObject({ text: 'Mirrored, edited.', versions: [{ text: 'Mirrored.', reason: 'typo' }], edited: expect.any(Number) });
    await until(() => logs.some((l) => /^✈️ demo Telegram would edit message \d+: .*Mirrored, edited\./.test(l)));
    expect(await tools.call('edit_message', { id: 99_999, text: 'x' })).toMatch(/^Refused: #99999 isn't one of your messages here\. Your latest: #\d+/);

    expect(await tools.call('send_telegram', { text: 'The plan: ship it.' })).toBe("Sent to the manager's Telegram.");
    await until(() => sent().some((l) => l.includes('The plan: ship it.')));
    expect(JSON.stringify(swarm.snapshot())).not.toContain('SECRET');
    expect(logs.join('\n')).not.toContain('SECRET');
    await swarm.telegram.stop();
  });

  it("approves a team change from its message's button, through the lobby's own path", async () => {
    const { swarm, sent } = await office();
    await swarm.telegram.setToken(TOKEN);
    swarm.telegramDemo({ kind: 'start' });
    await until(() => swarm.snapshot().notifyChannels.telegram.linked);
    swarm.demoPropose('hire');
    const req = swarm.snapshot().requests.find((r) => r.status === 'pending')!;
    await until(() => sent().some((l) => l.includes(`[✅ Hire ${req.name}] [✋ Decline]`)));
    swarm.telegramDemo({ kind: 'approve' });
    await until(() => swarm.snapshot().requests.find((r) => r.id === req.id)?.status === 'approved');
    expect(swarm.snapshot().agents.some((a) => a.id === req.id)).toBe(true);
    await swarm.telegram.stop();
  });
});
