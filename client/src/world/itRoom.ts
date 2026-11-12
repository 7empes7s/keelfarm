// The lobby's IT office (#535), pure: the server rack's LED colour from the machine's health (the health strip's memory
// and disk, and IT monitoring's checks, #525), the wall screen's rows and the ticket board's open recommendations.
// ItOffice.tsx draws them.

import { gb, type HealthView } from '../../../shared/health';
import type { DiskLevel } from '../../../shared/disk';
import { openRecs, type ItCheck, type ItCheckId, type ItWatchView } from '../../../shared/itWatch';

export type RackLevel = 'good' | 'warn' | 'bad' | 'unknown';

export const LED_COLOURS: Record<RackLevel, string> = { good: '#38d97a', warn: '#ffb703', bad: '#ff4d4d', unknown: '#8d99ae' };

const RANK: Record<RackLevel, number> = { unknown: 0, good: 1, warn: 2, bad: 3 };
const worst = (levels: RackLevel[]): RackLevel => levels.reduce<RackLevel>((a, b) => (RANK[b] > RANK[a] ? b : a), 'unknown');
const fromDisk = (l: DiskLevel): RackLevel => (l === 'hold' ? 'bad' : l === 'warn' ? 'warn' : 'good');
const fromCheck = (c: ItCheck | undefined): RackLevel => (!c || c.level === 'off' ? 'unknown' : c.level);
const checkOf = (w: ItWatchView | null, id: ItCheckId) => w?.checks.find((c) => c.id === id);

/** The rack's state: the worst of the disk, work waiting for memory and IT's checks; unknown before any reading. */
export function rackLevel(health: HealthView | null, watch: ItWatchView | null): RackLevel {
  const levels: RackLevel[] = (watch?.checks ?? []).map(fromCheck);
  if (health) {
    levels.push(health.disk ? fromDisk(health.disk.level) : 'unknown', health.held ? 'warn' : health.memory ? 'good' : 'unknown');
  }
  return worst(levels);
}

export const ledColour = (level: RackLevel) => LED_COLOURS[level];

export interface ScreenRow {
  label: string;
  value: string;
  level: RackLevel;
}

const NONE = '—';

/** The wall screen: disk free (the fullest disk), memory free, swap used and the services, each with its level. */
export function itScreenRows(health: HealthView | null, watch: ItWatchView | null): ScreenRow[] {
  const m = health?.memory ?? null;
  const disks = health?.disk?.disks ?? [];
  const low = disks.length ? disks.reduce((a, b) => (b.freeMb < a.freeMb ? b : a)) : null;
  const memory = checkOf(watch, 'memory');
  const memLevel = memory && memory.level !== 'off' ? fromCheck(memory) : m ? 'good' : 'unknown';
  const units = checkOf(watch, 'units');
  return [
    { label: 'Disk free', value: low ? gb(low.freeMb) : NONE, level: low ? fromDisk(low.level) : fromCheck(checkOf(watch, 'disk')) },
    { label: 'Memory free', value: m ? `${(Math.max(0, m.availableMb) / 1024).toFixed(1)} of ${gb(m.totalMb)}` : NONE, level: memLevel },
    { label: 'Swap used', value: m ? (m.swapTotalMb > 0 ? `${Math.round(((m.swapTotalMb - m.swapFreeMb) / m.swapTotalMb) * 100)}%` : 'none') : NONE, level: memLevel },
    { label: 'Services', value: units?.line || NONE, level: fromCheck(units) },
  ];
}

/** The ticket board: IT's open recommendations' titles, newest first (none before IT monitoring has any). */
export const itTicketRows = (watch: ItWatchView | null, now: number): string[] => (watch ? openRecs(watch.recs, now).map((r) => r.title) : []);
