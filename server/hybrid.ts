// Hybrid (#260, docs/cloud.md): new agents work on this computer while it has room, else in an Upstash Box; when ready
// work keeps waiting for memory the office adds a cloud agent by itself (burst) and lets it go once it's idle (burst
// back). Pure: the swarm (server/swarm/upkeep.ts) feeds it the numbers.

import { gb } from '../shared/health.ts';
import type { MachineHost } from '../shared/types.ts';
import { runsHere } from './handOut.ts';

/**
 * Why this computer has no room for one more agent (null: it has): a build session's memory plus the headroom
 * (`fit`, null while unmeasured), the session limit, and the manager's "most agents on this computer" (0: none).
 */
export function localRoom(x: { fit: { freeMb: number; needMb: number } | null; slotsFull: boolean; sessionLimit: number; localAgents: number; localMax: number }): string | null {
  if (x.fit && x.fit.freeMb < x.fit.needMb) return `${gb(x.fit.freeMb)} free, ${gb(x.fit.needMb)} needed`;
  if (x.slotsFull) return `all ${x.sessionLimit} session slots are busy`;
  if (x.localMax > 0 && x.localAgents >= x.localMax) return `${x.localAgents} agents here, your most on this computer`;
  return null;
}

/** Where Hybrid puts a new agent: this computer when it has room (`local` null), else a Box (`box` null), else why neither. */
export function hybridPlace(local: string | null, box: string | null): MachineHost | { refusal: string } {
  if (!local) return 'local';
  if (!box) return 'box';
  return { refusal: `No room on this computer (${local}). ${box}` };
}

/** A floor as burst sees it. */
export interface BurstFloor {
  repoId: string;
  team: number; // agents on it now
  max: number; // the most it may have
  waiting: number; // ready tasks held back for memory with a free local agent there (0: none)
  cloudFree: number; // its cloud agents without a task: they take held work first
}

/**
 * The floor to add one cloud agent to now (null: none): once work has waited for memory `afterMs`, while fewer than
 * `burstMax` added ones are still here and the plan has a Box to spare, on a floor under its max whose waiting work
 * no free cloud agent could take instead. One at a time: the next pass sees the new one.
 */
export function burstFloor(x: { now: number; waitingSince: number | null; afterMs: number; floors: BurstFloor[]; bursting: number; burstMax: number; boxRoom: boolean }): BurstFloor | null {
  if (x.waitingSince === null || x.now - x.waitingSince < x.afterMs) return null;
  if (x.bursting >= x.burstMax || !x.boxRoom) return null;
  return x.floors.find((f) => f.waiting > 0 && f.team < f.max && f.cloudFree === 0) ?? null;
}

/**
 * The agents burst added that leave now: never one on a task; an idle one after `idleMs` without work (since it
 * joined or last finished), unless it's still `starting` (its Box being set up, or waiting to be signed in), or at
 * once when this computer has room again (`localRoom`).
 */
export function burstLeavers(x: { now: number; idleMs: number; localRoom: boolean; agents: { id: string; burst?: number; busy: boolean; starting?: boolean; endedAt: number | null }[] }): string[] {
  return x.agents.filter((a) => !!a.burst && !a.busy && (x.localRoom || (!a.starting && x.now - Math.max(a.burst, a.endedAt ?? 0) >= x.idleMs))).map((a) => a.id);
}

/** Free agents with this computer's first (no Box CPU cost), each group in its order: Hybrid's hand-out. */
export const localFirst = <T extends { host?: string }>(free: T[]): T[] => [...free.filter(runsHere), ...free.filter((a) => !runsHere(a))];
