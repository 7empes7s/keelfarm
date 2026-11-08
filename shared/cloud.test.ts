import { describe, expect, it } from 'vitest';
import { boxCli, cloudSettings, DEFAULT_CLOUD, DEFAULT_HYBRID, hostLabel, MAX_BOX_LIMIT } from './cloud.ts';

describe('cloudSettings', () => {
  it('starts with agents on this computer', () => {
    expect(DEFAULT_CLOUD.machineKind).toBe('local');
    expect(cloudSettings(DEFAULT_CLOUD, undefined)).toEqual(DEFAULT_CLOUD);
  });

  it('takes what is valid and keeps the rest', () => {
    expect(cloudSettings(DEFAULT_CLOUD, { machineKind: 'box', boxSize: 'large', boxLimit: 25.4 })).toEqual({ machineKind: 'box', boxSize: 'large', boxLimit: 25, hybrid: DEFAULT_HYBRID });
    expect(cloudSettings(DEFAULT_CLOUD, { machineKind: 'mars', boxSize: 'huge', boxLimit: -3 })).toEqual(DEFAULT_CLOUD);
    expect(cloudSettings(DEFAULT_CLOUD, { boxLimit: 1e9 }).boxLimit).toBe(MAX_BOX_LIMIT);
  });

  it('offers Hybrid, with its burst settings checked (#260)', () => {
    expect(DEFAULT_HYBRID).toEqual({ localMax: 0, burst: true, burstAfterMin: 5, burstMax: 2, burstIdleMin: 10 });
    expect(cloudSettings(DEFAULT_CLOUD, { machineKind: 'hybrid' }).machineKind).toBe('hybrid');
    const h = cloudSettings(DEFAULT_CLOUD, { hybrid: { localMax: 3, burst: false, burstAfterMin: 0, burstMax: 'x', burstIdleMin: 30 } }).hybrid;
    expect(h).toEqual({ localMax: 3, burst: false, burstAfterMin: 5, burstMax: 2, burstIdleMin: 30 });
    expect(cloudSettings({ ...DEFAULT_CLOUD, hybrid: undefined } as never, {}).hybrid).toEqual(DEFAULT_HYBRID); // a state file from before Hybrid
  });
});

describe('cloud agents', () => {
  it("run Claude Code or Codex, not OpenCode (yet)", () => {
    expect(boxCli('claude')).toBe(true);
    expect(boxCli('codex')).toBe(true);
    expect(boxCli('opencode')).toBe(false);
  });

  it('say where they work', () => {
    expect(hostLabel('box')).toMatch(/Cloud/);
    expect(hostLabel('')).toBe('This computer');
  });
});
