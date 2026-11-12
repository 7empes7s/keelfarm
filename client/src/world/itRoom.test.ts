import { describe, expect, it } from 'vitest';
import type { HealthView } from '../../../shared/health';
import type { ItCheck, ItRecommendation, ItWatchView } from '../../../shared/itWatch';
import { LED_COLOURS, itScreenRows, itTicketRows, ledColour, rackLevel } from './itRoom';

const GB = 1024;
const health = (over: Partial<HealthView> = {}): HealthView => ({
  memory: { availableMb: 4 * GB, totalMb: 8 * GB, swapFreeMb: 6 * GB, swapTotalMb: 8 * GB, load: 0.5, cpus: 4, at: 1 },
  running: 2,
  waiting: 0,
  held: null,
  heldWork: null,
  lastStop: null,
  disk: { disks: [{ path: '/', label: 'System disk', freeMb: 40 * GB, totalMb: 150 * GB, level: 'ok' }] as never, level: 'ok', lastClean: null },
  ...over,
});
const check = (id: ItCheck['id'], level: ItCheck['level'], line = ''): ItCheck => ({ id, label: id, level, line, facts: [], at: 1 });
const watch = (checks: ItCheck[], recs: ItRecommendation[] = []): ItWatchView => ({ on: true, checks, recs, running: false });
const rec = (id: string, title: string, at: number, snoozedUntil: number | null = null): ItRecommendation => ({ id, check: 'disk', title, evidence: '', options: [], at, by: 'Iris', snoozedUntil });

describe('the server rack’s LEDs', () => {
  it('are unknown before the office has any reading', () => {
    expect(rackLevel(null, null)).toBe('unknown');
    expect(ledColour(rackLevel(null, null))).toBe(LED_COLOURS.unknown);
  });

  it('are green when the disk is fine and every check is good', () => {
    expect(rackLevel(health(), watch([check('disk', 'good'), check('memory', 'good'), check('units', 'off')]))).toBe('good');
    expect(ledColour('good')).toBe(LED_COLOURS.good);
  });

  it('turn amber for a disk warning, a check warning or work waiting for memory', () => {
    expect(rackLevel(health({ disk: { ...health().disk!, level: 'warn' } }), null)).toBe('warn');
    expect(rackLevel(health(), watch([check('disk', 'good'), check('failed', 'warn')]))).toBe('warn');
    expect(rackLevel(health({ held: 'Waiting for memory' }), null)).toBe('warn');
  });

  it('turn red for a disk on hold or a bad check, whatever else is fine', () => {
    expect(rackLevel(health({ disk: { ...health().disk!, level: 'hold' } }), watch([check('memory', 'good')]))).toBe('bad');
    expect(rackLevel(health(), watch([check('failed', 'warn'), check('units', 'bad')]))).toBe('bad');
  });

  it('follow IT’s checks alone when there is no health reading', () => {
    expect(rackLevel(null, watch([check('load', 'warn')]))).toBe('warn');
  });
});

describe('the wall screen', () => {
  it('shows disk free, memory free, swap used and services from the office’s readings', () => {
    const rows = itScreenRows(health(), watch([check('units', 'good', 'cubefarm, caddy: running')]));
    expect(rows.map((r) => r.label)).toEqual(['Disk free', 'Memory free', 'Swap used', 'Services']);
    expect(rows.map((r) => r.value)).toEqual(['40.0 GB', '4.0 of 8.0 GB', '25%', 'cubefarm, caddy: running']);
    expect(rows.map((r) => r.level)).toEqual(['good', 'good', 'good', 'good']);
  });

  it('takes the fullest disk and the levels of IT’s checks', () => {
    const h = health({ disk: { disks: [{ freeMb: 90 * GB, level: 'ok' }, { freeMb: 3 * GB, level: 'hold' }] as never, level: 'hold', lastClean: null } });
    const rows = itScreenRows(h, watch([check('memory', 'warn')]));
    expect(rows[0]).toMatchObject({ value: '3.0 GB', level: 'bad' });
    expect(rows[1].level).toBe('warn');
  });

  it('says so when there is nothing to show yet', () => {
    const rows = itScreenRows(null, null);
    expect(rows.map((r) => r.value)).toEqual(['—', '—', '—', '—']);
    expect(rows.every((r) => r.level === 'unknown')).toBe(true);
  });
});

describe('the ticket board', () => {
  it('lists IT’s open recommendations, newest first, without snoozed ones', () => {
    const w = watch([], [rec('a', 'Clear old worktrees', 10), rec('b', 'Restart caddy', 30), rec('c', 'Prune Docker', 20, 9_999)]);
    expect(itTicketRows(w, 100)).toEqual(['Restart caddy', 'Clear old worktrees']);
  });

  it('is empty without IT monitoring', () => {
    expect(itTicketRows(null, 100)).toEqual([]);
  });
});
