import { describe, expect, it } from 'vitest';
import { canPostpone, canUpdateNow, drainDeadline, DRAIN_TIMEOUT_MS, officeUpdateChip, officeUpdateText, restartExpected, newVersion, loadsNow, heldText, RESUME_AFTER_MS } from './officeUpdate';
import type { OfficeUpdateView } from '../../shared/types';

const u = (over: Partial<OfficeUpdateView>): OfficeUpdateView => ({ state: 'none', behind: 0, launcher: true, drainingSince: null, running: 0, updateAt: null, holds: false, detail: null, ...over });

describe('officeUpdateText', () => {
  it('says each state in plain words', () => {
    expect(officeUpdateText(u({}))).toBe('Up to date');
    expect(officeUpdateText(u({ state: 'available', behind: 3 }))).toBe('3 updates ready');
    expect(officeUpdateText(u({ state: 'available', behind: 1 }))).toBe('1 update ready');
    expect(officeUpdateText(u({ state: 'draining', behind: 3, running: 2 }))).toBe('Waiting for 2 sessions to finish');
    expect(officeUpdateText(u({ state: 'waiting', behind: 3, running: 1 }))).toBe('Waiting for 1 session to finish');
    expect(officeUpdateText(u({ state: 'draining', behind: 3 }))).toBe('Updating shortly…');
    expect(officeUpdateText(u({ state: 'updating', behind: 3, holds: true }))).toBe('Updating…');
    expect(officeUpdateText(u({ state: 'updating', behind: 3 }))).toBe('Checking the update; agents keep working, then the office restarts for a few seconds');
    expect(officeUpdateText(u({ state: 'settling', behind: 3, updateAt: 1_000_000 + 90_000 }), 1_000_000)).toBe('Updating in 2 min, 3 commits; agents keep working');
    expect(officeUpdateText(u({ state: 'failed', detail: 'npm ci failed' }))).toBe('Last update failed: npm ci failed');
  });
});

describe('officeUpdateChip', () => {
  it('only shows while an update is on its way', () => {
    expect(officeUpdateChip(undefined)).toBeNull();
    expect(officeUpdateChip(u({}))).toBeNull();
    expect(officeUpdateChip(u({ state: 'available', behind: 2 }))).toBeNull();
    expect(officeUpdateChip(u({ state: 'failed', detail: 'x' }))).toBeNull();
    expect(officeUpdateChip(u({ state: 'draining', running: 2 }))).toBe('⟳ Updating the office after 2 sessions finish');
    expect(officeUpdateChip(u({ state: 'waiting', running: 1 }))).toBe('⟳ Updating the office after 1 session finishes');
    expect(officeUpdateChip(u({ state: 'updating' }))).toBe('⟳ Updating the office…');
    expect(officeUpdateChip(u({ state: 'settling', behind: 1, updateAt: 1_000_000 + 10_000 }), 1_000_000)).toBe('⟳ Updating in 1 min, 1 commit');
  });
});

describe('buttons', () => {
  it('need a launcher', () => {
    expect(canUpdateNow(u({ state: 'available', behind: 2, launcher: false }))).toBe(false);
    expect(canPostpone(u({ state: 'available', behind: 2, launcher: false }))).toBe(false);
    expect(canUpdateNow(u({ state: 'available', behind: 2 }))).toBe(true);
    expect(canPostpone(u({ state: 'available', behind: 2 }))).toBe(true);
  });
  it('match what the server accepts', () => {
    expect(canUpdateNow(u({}))).toBe(false);
    expect(canUpdateNow(u({ state: 'draining', behind: 2 }))).toBe(false);
    expect(canUpdateNow(u({ state: 'updating', behind: 2 }))).toBe(false);
    expect(canPostpone(u({ state: 'draining', behind: 2 }))).toBe(true);
    expect(canPostpone(u({ state: 'updating', behind: 2 }))).toBe(false);
    expect(canUpdateNow(u({ state: 'settling', behind: 2 }))).toBe(true);
    expect(canPostpone(u({ state: 'settling', behind: 2 }))).toBe(true);
  });
});

it('drainDeadline is 20 minutes after draining started', () => {
  expect(drainDeadline(u({ state: 'draining', drainingSince: 1000 }))).toBe(1000 + DRAIN_TIMEOUT_MS);
  expect(drainDeadline(u({ state: 'waiting', drainingSince: 1000 }))).toBeNull();
});

it('restartExpected only while draining or updating', () => {
  expect(restartExpected(undefined)).toBe(false);
  expect(restartExpected(u({ state: 'available' }))).toBe(false);
  expect(restartExpected(u({ state: 'draining' }))).toBe(true);
  expect(restartExpected(u({ state: 'updating' }))).toBe(true);
});

describe('newVersion (#216)', () => {
  it('is ready when the office comes back on another commit than the page loaded with', () => {
    expect(newVersion('abc1234', 'def5678')).toBe(true);
  });
  it('never on the first snapshot, the same commit, or a server without commits', () => {
    expect(newVersion(undefined, 'def5678')).toBe(false);
    expect(newVersion('abc1234', 'abc1234')).toBe(false);
    expect(newVersion(null, 'def5678')).toBe(false);
    expect(newVersion('abc1234', null)).toBe(false);
  });
});

describe('loadsNow: the safe moment (#216)', () => {
  it('loads a ready version on a navigation or a tap, and on coming back after 30 s in the background', () => {
    expect(loadsNow(true, 'navigate', [])).toBe(true);
    expect(loadsNow(true, 'tap', [])).toBe(true);
    expect(loadsNow(true, 'resume', [], RESUME_AFTER_MS)).toBe(true);
    expect(loadsNow(true, 'resume', [], RESUME_AFTER_MS - 1)).toBe(false);
    expect(loadsNow(false, 'tap', [])).toBe(false);
  });
  it('never while a draft, an upload, a send or a sheet is active, not even on a tap', () => {
    for (const hold of ['draft', 'upload', 'send', 'sheet'] as const) {
      for (const moment of ['navigate', 'tap', 'resume'] as const) expect(loadsNow(true, moment, [hold], RESUME_AFTER_MS)).toBe(false);
    }
  });
  it('says why it waits', () => {
    expect(heldText(['draft', 'send'])).toBe("Updating when it's safe: a message is still sending. Your work is kept.");
    expect(heldText(['sheet'])).toBe("Updating when it's safe: a sheet is open. Your work is kept.");
  });
});
