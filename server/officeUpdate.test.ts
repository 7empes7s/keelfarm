import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAIN_TIMEOUT_MS, POSTPONE_MS, drainDecision, lastUpdateMessage, parseLastUpdate, takeLastUpdate, underLauncher, type DrainInput } from './officeUpdate.ts';

const NOW = 1_000_000_000;
const input = (over: Partial<DrainInput> = {}): DrainInput => ({
  now: NOW,
  behind: 3,
  launcher: true,
  autoUpdate: true,
  requested: false,
  postponedUntil: null,
  postponedBehind: 0,
  failed: null,
  failedBehind: null,
  drainingSince: null,
  sent: false,
  running: 2,
  ...over,
});

describe('drainDecision', () => {
  it('does nothing when the office is up to date', () => {
    expect(drainDecision(input({ behind: 0 }))).toEqual({ state: 'none', drainingSince: null, send: false, timedOut: false });
    expect(drainDecision(input({ behind: 0, requested: true })).state).toBe('none');
  });

  it('only reports an update without a launcher, even when asked', () => {
    expect(drainDecision(input({ launcher: false }))).toEqual({ state: 'available', drainingSince: null, send: false, timedOut: false });
    expect(drainDecision(input({ launcher: false, requested: true, running: 0 })).send).toBe(false);
  });

  it('waits for the manager when automatic updates are off', () => {
    expect(drainDecision(input({ autoUpdate: false })).state).toBe('available');
  });

  it('starts draining when an update is ready and automatic updates are on', () => {
    expect(drainDecision(input())).toEqual({ state: 'draining', drainingSince: NOW, send: false, timedOut: false });
  });

  it('starts draining on Update now with automatic updates off', () => {
    expect(drainDecision(input({ autoUpdate: false, requested: true })).state).toBe('draining');
  });

  it('keeps the time draining started', () => {
    expect(drainDecision(input({ drainingSince: NOW - 60_000 })).drainingSince).toBe(NOW - 60_000);
  });

  it('sends the update once nothing is running', () => {
    expect(drainDecision(input({ running: 0 }))).toEqual({ state: 'draining', drainingSince: NOW, send: true, timedOut: false });
    expect(drainDecision(input({ running: 0, drainingSince: NOW - 5 * 60_000 })).send).toBe(true);
  });

  it('sends anyway once the drain times out, and says so', () => {
    expect(drainDecision(input({ drainingSince: NOW - DRAIN_TIMEOUT_MS + 1 })).send).toBe(false);
    expect(drainDecision(input({ drainingSince: NOW - DRAIN_TIMEOUT_MS }))).toEqual({ state: 'draining', drainingSince: NOW - DRAIN_TIMEOUT_MS, send: true, timedOut: true });
  });

  it('is updating once sent, and never sends twice', () => {
    expect(drainDecision(input({ sent: true, running: 0, drainingSince: NOW - 1000 }))).toEqual({ state: 'updating', drainingSince: NOW - 1000, send: false, timedOut: false });
  });

  describe('Later', () => {
    const later = { postponedUntil: NOW + POSTPONE_MS, postponedBehind: 3 };

    it('holds an automatic update back and stops draining', () => {
      expect(drainDecision(input({ ...later, drainingSince: NOW - 60_000 }))).toEqual({ state: 'waiting', drainingSince: null, send: false, timedOut: false });
    });

    it('ends after two hours', () => {
      expect(drainDecision(input({ postponedUntil: NOW, postponedBehind: 3 })).state).toBe('draining');
    });

    it('ends when a newer commit lands', () => {
      expect(drainDecision(input({ ...later, behind: 4 })).state).toBe('draining');
    });

    it('is just "available" when automatic updates are off', () => {
      expect(drainDecision(input({ ...later, autoUpdate: false })).state).toBe('available');
    });

    it('gives way to Update now', () => {
      expect(drainDecision(input({ ...later, requested: true })).state).toBe('draining');
    });
  });

  describe('after a failed update', () => {
    it("doesn't retry by itself for the same commits", () => {
      expect(drainDecision(input({ failed: 'npm ci failed', failedBehind: 3 })).state).toBe('failed');
      expect(drainDecision(input({ failed: 'npm ci failed', failedBehind: null })).state).toBe('failed');
    });

    it('retries for a newer commit, or on Update now', () => {
      expect(drainDecision(input({ failed: 'npm ci failed', failedBehind: 3, behind: 4 })).state).toBe('draining');
      expect(drainDecision(input({ failed: 'npm ci failed', failedBehind: 3, requested: true })).state).toBe('draining');
    });
  });
});

describe('underLauncher', () => {
  const send = () => true;
  it('needs both the IPC channel and SWARM_LAUNCHER=1', () => {
    expect(underLauncher({ send, env: { SWARM_LAUNCHER: '1' } })).toBe(true);
    expect(underLauncher({ send, env: {} })).toBe(false);
    expect(underLauncher({ send: undefined, env: { SWARM_LAUNCHER: '1' } })).toBe(false);
    expect(underLauncher({ send, env: { SWARM_LAUNCHER: 'true' } })).toBe(false);
  });
});

describe('last-update.json', () => {
  const ok = { from: 'abc1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', to: 'def5678bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', ok: true, installed: true, built: true, at: 5 };

  it('words the phone message', () => {
    expect(lastUpdateMessage(ok, 3)).toBe('⬆️ Updated the office from abc1234 to def5678 (3 commits)');
    expect(lastUpdateMessage(ok, 1)).toBe('⬆️ Updated the office from abc1234 to def5678 (1 commit)');
    expect(lastUpdateMessage(ok, null)).toBe('⬆️ Updated the office from abc1234 to def5678');
    expect(lastUpdateMessage({ ...ok, ok: false, error: 'npm ci failed' }, null)).toBe('⚠️ Update failed and was rolled back: npm ci failed');
  });

  it('says which stage of a safe update failed', () => {
    const failed = { ...ok, to: ok.from, target: ok.to, ok: false };
    expect(lastUpdateMessage({ ...failed, stage: 'preflight', error: 'tests failed (npm test failed (exit 1))' }, null)).toBe(
      '⚠️ Update to def5678 refused: tests failed (npm test failed (exit 1)) in the preflight; still on abc1234',
    );
    expect(lastUpdateMessage({ ...failed, stage: 'probation', error: 'the office exited (1) during its probation' }, null)).toBe(
      '⚠️ Update to def5678 rolled back: the office exited (1) during its probation; back on abc1234',
    );
    expect(lastUpdateMessage({ ...failed, stage: 'check', error: 'the office folder has local changes' }, null)).toBe('⚠️ Update refused: the office folder has local changes; still on abc1234');
    expect(lastUpdateMessage({ ...ok, to: ok.from }, null)).toBe('The office is already up to date at abc1234');
  });

  it('ignores anything that is not a result', () => {
    expect(parseLastUpdate('not json')).toBeNull();
    expect(parseLastUpdate('{"to":"x"}')).toBeNull();
    expect(parseLastUpdate(JSON.stringify(ok))).toEqual(ok);
    expect(parseLastUpdate(JSON.stringify({ ...ok, ok: false, stage: 'preflight', target: 'f00' }))).toMatchObject({ stage: 'preflight', target: 'f00' });
    expect(parseLastUpdate(JSON.stringify({ ...ok, stage: 'sometime' }))?.stage).toBeUndefined();
  });

  it('is read once, then deleted', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'office update '));
    try {
      expect(await takeLastUpdate(home)).toBeNull();
      await fs.writeFile(path.join(home, 'last-update.json'), JSON.stringify({ ...ok, ok: false, error: 'build failed' }));
      expect(await takeLastUpdate(home)).toMatchObject({ ok: false, error: 'build failed' });
      expect(await takeLastUpdate(home)).toBeNull();
    } finally {
      await fs.rm(home, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
