import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// "When Claude warns that usage is high" (#323): Keep full speed records the warning but never paces, a limit still
// pauses, and choosing it while pacing ends pacing with a waiver saved in the office state.
type Internals = { pacingUntil: number; lastWarning: unknown; state: { usageWaiver?: { until: number } | null; messages: { text: string; pacing?: true }[] } };

afterEach(() => {
  vi.useRealTimers();
});

describe('usage warning choice', () => {
  it('"Keep full speed" records the warning without pacing, and a limit still pauses', () => {
    vi.useFakeTimers();
    const swarm = new Swarm(createDemoBackend());
    const x = swarm as unknown as Internals;
    swarm.updateSettings({ usageWarnings: 'full' });
    const u = swarm.simulateUsage('warning');
    expect(x.pacingUntil).toBe(0);
    expect(x.lastWarning).toMatchObject({ limit: 'weekly limit', pct: 91 });
    expect(u).toMatchObject({ state: 'normal', byChoice: true });
    expect(swarm.simulateUsage('limit').state).toBe('paused');
  });

  it('paces as before with "Ask me each time", and choosing "Keep full speed" while pacing ends it and saves the waiver', () => {
    vi.useFakeTimers();
    const swarm = new Swarm(createDemoBackend());
    const x = swarm as unknown as Internals;
    swarm.updateSettings({ usageWarnings: 'ask' });
    expect(swarm.simulateUsage('warning').state).toBe('pacing');
    expect(x.state.messages.at(-1)).toMatchObject({ pacing: true });
    const until = x.pacingUntil;
    swarm.updateSettings({ usageWarnings: 'full' });
    expect(x.pacingUntil).toBe(0);
    expect(x.state.usageWaiver).toEqual({ until, limit: 'seven_day' });
    expect(x.state.messages.at(-1)?.text).toMatch(/^⏩ Full speed from now on/);
  });

  it('rejects an unknown choice as "Pace new work"', () => {
    const swarm = new Swarm(createDemoBackend());
    swarm.updateSettings({ usageWarnings: 'sometimes' as never });
    expect(swarm.snapshot().settings.usageWarnings).toBe('pace');
  });
});
