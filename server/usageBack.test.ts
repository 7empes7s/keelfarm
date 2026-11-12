import fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoticeView, UsageSource } from '../shared/types.ts';
import { STATE_FILE } from './config.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// "Notify me when it's back" (#404, #538) end to end on the server: armed on a limited row, kept in the state file
// through a restart (the office restarts after every merge), and once the row is back exactly one notice, sent as
// something the manager asked for (every phone channel, whatever the toggles say), and the watch ends.
const row = (status: UsageSource['status']): UsageSource => ({ id: 'claude-pro', provider: 'claude', category: 'coding', label: 'Claude Pro', plan: 'Pro', windows: [], status, checkedAt: 1 });

interface Insides {
  usageBoard: { sources(): UsageSource[] };
  state: { notices: NoticeView[]; usageWatch: string[] };
  checkUsageBack(): UsageSource[];
  writeState(): Promise<void>;
}

/** A demo office whose usage card reads `reading()` (a fake usage reading), and the notifier's sends it asked for. */
function office(reading: () => UsageSource['status']) {
  const swarm = new Swarm(createDemoBackend());
  const o = swarm as unknown as Insides;
  vi.spyOn(o.usageBoard, 'sources').mockImplementation(() => [row(reading())]);
  const asked = vi.spyOn(swarm.notifier, 'asked').mockResolvedValue([null]);
  return { swarm, o, asked };
}

afterEach(() => vi.restoreAllMocks());

describe("Notify me when it's back", () => {
  it('arms on a limited row, survives a restart, and sends exactly one notice when the limit resets', async () => {
    let status: UsageSource['status'] = 'limited';
    const a = office(() => status);
    expect(a.swarm.watchUsageBack('claude-pro', true)).toEqual({ watching: true });
    expect(a.swarm.snapshot().accounts?.sources?.find((s) => s.id === 'claude-pro')?.watchBack).toBe(true);
    await a.o.writeState();
    expect(JSON.parse(await fs.readFile(STATE_FILE, 'utf8')).usageWatch).toEqual(['claude-pro']);

    // A restart: the new office loads the watch back from the state file.
    const b = office(() => status);
    await b.swarm.init();
    expect(b.o.state.usageWatch).toEqual(['claude-pro']);
    b.o.checkUsageBack();
    expect(b.asked).not.toHaveBeenCalled(); // still limited

    status = 'error'; // a failed read isn't "back"
    b.o.checkUsageBack();
    expect(b.asked).not.toHaveBeenCalled();

    status = 'ready';
    b.o.checkUsageBack();
    b.o.checkUsageBack();
    expect(b.asked).toHaveBeenCalledTimes(1);
    expect(b.asked).toHaveBeenCalledWith('usage', 'Claude Pro is back', 'Its limit has reset: agents can work on it again.', expect.any(String));
    expect(b.o.state.notices.filter((n) => n.title === 'Claude Pro is back').map((n) => n.kind)).toEqual(['usage']); // in the bell's list too
    expect(b.o.state.usageWatch).toEqual([]);
  }, 60_000);

  it('disarms, and refuses a row that is not limited', () => {
    const a = office(() => 'limited');
    a.swarm.watchUsageBack('claude-pro', true);
    expect(a.swarm.watchUsageBack('claude-pro', false)).toEqual({ watching: false });
    expect(a.o.state.usageWatch).toEqual([]);
    const ready = office(() => 'ready');
    expect(() => ready.swarm.watchUsageBack('claude-pro', true)).toThrow("Claude Pro isn't limited");
  });
});
