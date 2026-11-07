import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAIN_TIMEOUT_MS, POSTPONE_MS, SETTLE_MAX_MS, drainDecision, settleAt, settleMinutes, lastUpdateNotice, parseLastUpdate, takeLastUpdate, underLauncher, type DrainInput } from './officeUpdate.ts';

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
  pendingSince: null,
  lastCommitAt: null,
  settleMs: 3 * 60_000,
  keeper: false,
  ...over,
});
const idle = { drainingSince: null, send: false, timedOut: false, holds: false, updateAt: null };

describe('drainDecision', () => {
  it('does nothing when the office is up to date', () => {
    expect(drainDecision(input({ behind: 0 }))).toEqual({ ...idle, state: 'none' });
    expect(drainDecision(input({ behind: 0, requested: true })).state).toBe('none');
  });

  it('only reports an update without a launcher, even when asked', () => {
    expect(drainDecision(input({ launcher: false }))).toEqual({ ...idle, state: 'available' });
    expect(drainDecision(input({ launcher: false, requested: true, running: 0 })).send).toBe(false);
  });

  it('waits for the manager when automatic updates are off', () => {
    expect(drainDecision(input({ autoUpdate: false })).state).toBe('available');
  });

  it('starts draining when an update is ready and automatic updates are on', () => {
    expect(drainDecision(input())).toEqual({ state: 'draining', drainingSince: NOW, send: false, timedOut: false, holds: true, updateAt: null });
  });

  it('starts draining on Update now with automatic updates off', () => {
    expect(drainDecision(input({ autoUpdate: false, requested: true })).state).toBe('draining');
  });

  it('keeps the time draining started', () => {
    expect(drainDecision(input({ drainingSince: NOW - 60_000 })).drainingSince).toBe(NOW - 60_000);
  });

  it('sends the update once nothing is running', () => {
    expect(drainDecision(input({ running: 0 }))).toEqual({ state: 'draining', drainingSince: NOW, send: true, timedOut: false, holds: true, updateAt: null });
    expect(drainDecision(input({ running: 0, drainingSince: NOW - 5 * 60_000 })).send).toBe(true);
  });

  it('sends anyway once the drain times out, and says so', () => {
    expect(drainDecision(input({ drainingSince: NOW - DRAIN_TIMEOUT_MS + 1 })).send).toBe(false);
    expect(drainDecision(input({ drainingSince: NOW - DRAIN_TIMEOUT_MS }))).toEqual({ state: 'draining', drainingSince: NOW - DRAIN_TIMEOUT_MS, send: true, timedOut: true, holds: true, updateAt: null });
  });

  it('is updating once sent, and never sends twice', () => {
    expect(drainDecision(input({ sent: true, running: 0, drainingSince: NOW - 1000 }))).toEqual({ state: 'updating', drainingSince: NOW - 1000, send: false, timedOut: false, holds: true, updateAt: null });
  });

  describe('Later', () => {
    const later = { postponedUntil: NOW + POSTPONE_MS, postponedBehind: 3 };

    it('holds an automatic update back and stops draining', () => {
      expect(drainDecision(input({ ...later, drainingSince: NOW - 60_000 }))).toEqual({ ...idle, state: 'waiting' });
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

  // #74: CLIs in the terminal keeper carry on through the restart, so only the sessions a restart would stop drain.
  describe('with the terminal keeper', () => {
    it('hands over at once when every running session is kept, and work goes on during the preflight', () => {
      // running counts only the sessions the keeper can't hold (the caller leaves kept and Box sessions out)
      const d = drainDecision(input({ keeper: true, running: 0 }));
      expect(d).toMatchObject({ state: 'draining', send: true, timedOut: false });
      expect(drainDecision(input({ keeper: true, running: 0, sent: true, drainingSince: NOW })).holds).toBe(false);
    });

    it('still drains sessions the keeper cannot hold, with the 20-minute timeout', () => {
      expect(drainDecision(input({ keeper: true, running: 1 }))).toMatchObject({ state: 'draining', send: false, holds: true });
      expect(drainDecision(input({ keeper: true, running: 1, drainingSince: NOW - DRAIN_TIMEOUT_MS }))).toMatchObject({ send: true, timedOut: true });
    });

    it('holds new work through the preflight when new sessions would not outlive the restart', () => {
      expect(drainDecision(input({ keeper: false, sent: true, drainingSince: NOW })).holds).toBe(true);
    });
  });

  describe('settling a run of merges into one update', () => {
    const MIN = 60_000;
    it('waits for the settle window after the latest commit, without holding work back', () => {
      expect(drainDecision(input({ pendingSince: NOW - MIN, lastCommitAt: NOW - MIN }))).toEqual({ ...idle, state: 'settling', updateAt: NOW + 2 * MIN });
      expect(drainDecision(input({ pendingSince: NOW - 3 * MIN, lastCommitAt: NOW - 3 * MIN })).state).toBe('draining');
    });

    it('goes ahead at most 15 minutes after the first commit', () => {
      expect(drainDecision(input({ pendingSince: NOW - SETTLE_MAX_MS, lastCommitAt: NOW - 1000 })).state).toBe('draining');
    });

    it('skips the wait on Update now, and never goes back to settling once draining', () => {
      expect(drainDecision(input({ pendingSince: NOW, lastCommitAt: NOW, requested: true })).state).toBe('draining');
      expect(drainDecision(input({ pendingSince: NOW - 4 * MIN, lastCommitAt: NOW, drainingSince: NOW - MIN })).state).toBe('draining');
    });

    it('turns several commits in a row into exactly one hand-over', () => {
      const commits = [0, 1, 2, 2.5].map((m) => m * MIN); // four merges, each within 3 minutes of the one before
      let s = input({ now: 0, behind: 0, keeper: true, running: 0 });
      let sends = 0;
      for (let t = 0; t <= 30 * MIN; t += 10_000) {
        const landed = commits.filter((c) => c <= t).length;
        if (landed > s.behind) s = { ...s, behind: landed, pendingSince: s.pendingSince ?? t, lastCommitAt: t };
        const d = drainDecision({ ...s, now: t });
        if (d.send) {
          sends++;
          expect(t).toBeGreaterThanOrEqual(2.5 * MIN + 3 * MIN);
        }
        s = { ...s, drainingSince: d.drainingSince, sent: s.sent || d.send };
      }
      expect(sends).toBe(1);
    });

    it('settleAt and settleMinutes', () => {
      expect(settleAt(null, null, 3 * MIN)).toBeNull();
      expect(settleAt(0, 10 * MIN, 3 * MIN)).toBe(13 * MIN);
      expect(settleAt(0, 14 * MIN, 3 * MIN)).toBe(SETTLE_MAX_MS);
      expect(settleAt(0, 0, 30 * MIN)).toBe(30 * MIN); // a longer window than the cap is the manager's choice
      expect(settleMinutes(undefined)).toBe(3);
      expect(settleMinutes(0)).toBe(0);
      expect(settleMinutes('7')).toBe(7);
      expect(settleMinutes(500)).toBe(60);
      expect(settleMinutes('x')).toBe(3);
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

  const msg = (u: Parameters<typeof lastUpdateNotice>[0], commits: number | null) => lastUpdateNotice(u, commits).text;

  it('words the phone message', () => {
    expect(msg(ok, 3)).toBe('⬆️ Updated the office from abc1234 to def5678 (3 commits)');
    expect(msg(ok, 1)).toBe('⬆️ Updated the office from abc1234 to def5678 (1 commit)');
    expect(msg(ok, null)).toBe('⬆️ Updated the office from abc1234 to def5678');
    expect(msg({ ...ok, ok: false, error: 'npm ci failed' }, null)).toBe('⚠️ Update failed and was rolled back: npm ci failed.');
  });

  it('says which stage of a safe update failed', () => {
    const failed = { ...ok, to: ok.from, target: ok.to, ok: false };
    expect(msg({ ...failed, stage: 'preflight', error: 'tests failed (npm test failed (exit 1))' }, null)).toBe('⚠️ Update to def5678 held back: the tests failed in the preflight. Still running abc1234.');
    expect(msg({ ...failed, stage: 'probation', error: 'the office exited (1) during its probation' }, null)).toBe('⚠️ Update to def5678 rolled back: the office exited (1) during its probation. Back on abc1234.');
    expect(msg({ ...failed, stage: 'check', error: 'the office folder has local changes' }, null)).toBe('⚠️ Update held back: the office folder has local changes. Still running abc1234.');
    expect(msg({ ...ok, to: ok.from }, null)).toBe('The office is already up to date at abc1234');
  });

  it("shows a refused preflight as a card: the cleaned output as Details, links to both commits (#138)", () => {
    const error = `tests failed (npm test failed (exit 1): \x1b[2m${'─'.repeat(300)}[1/1]\x1b[22m\x1b[39m)`;
    const r = lastUpdateNotice({ ...ok, to: ok.from, target: ok.to, ok: false, stage: 'preflight', error }, null, 'acme/office');
    expect(r.text).toBe('⚠️ Update to def5678 held back: the tests failed in the preflight. Still running abc1234.');
    expect(r.notice.details).toBe('npm test failed (exit 1): —[1/1]');
    expect(r.notice.links).toEqual([
      { label: 'Commit def5678', url: `https://github.com/acme/office/commit/${ok.to}` },
      { label: 'Running abc1234', url: `https://github.com/acme/office/commit/${ok.from}` },
    ]);
    expect(lastUpdateNotice(ok, 2, 'acme/office').notice).toEqual({ links: [{ label: 'Changes', url: `https://github.com/acme/office/compare/${ok.from}...${ok.to}` }] });
    expect(lastUpdateNotice(ok, 2).notice).toEqual({});
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
