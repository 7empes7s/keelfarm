// The office itself: its version and updates, Claude's usage, health and the server's load, the test lab, mission control and the doctor.
import { applyViewPatch } from '../../../../shared/viewPatch';
import { EMPTY_OPS, newAlarms } from '../../ops';
import { alarm } from '../../ui/sfx';
import type { ApplyHandlers, SnapshotPart } from './types';

export const handlers = {
  officeUpdate: (ev, { set }) => set({ officeUpdate: ev.officeUpdate }),
  usage: (ev, { set }) => set({ usage: ev.usage }),
  health: (ev, { set }) => set({ health: ev.health }),
  serverLoad: (ev, { set }) => set({ serverLoad: ev.serverLoad }),
  testLab: (ev, { set }) => set({ testLab: ev.testLab }),
  itDesk: (ev, { set }) => set({ itDesk: ev.itDesk }),
  // The CEO's, the test lab's and the accounts' changes as the outbox batches them (#491).
  views: (ev, { set, get }) => {
    const s = get();
    set({
      ...(ev.ceo && { ceo: applyViewPatch(s.ceo, ev.ceo) }),
      ...(ev.testLab && { testLab: applyViewPatch(s.testLab, ev.testLab) }),
      ...(ev.accounts && { accounts: applyViewPatch(s.accounts, ev.accounts) }),
    });
  },
  claudeUsage: (ev, { set }) => set({ claudeUsage: ev.readings, claudeUsageCheck: ev.check ?? null, claudeUsageShares: ev.shares ?? [] }),
  ops: (ev, { set, get, cues }) => {
    // A new alarm sounds once (rate-limited); the beacons spin until it's handled.
    if (cues && newAlarms(get().ops.alarms, ev.ops.alarms).length) alarm();
    set({ ops: ev.ops });
  },
  doctor: (ev, { set }) => set({ doctor: ev.doctor }),
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d) => ({
  version: d.version,
  officeCommit: d.officeCommit,
  officeUpdate: d.officeUpdate,
  usage: d.usage,
  health: d.health ?? null,
  serverLoad: d.serverLoad ?? null,
  testLab: d.testLab ?? null,
  itDesk: d.itDesk ?? null,
  claudeUsage: d.claudeUsage ?? [],
  claudeUsageCheck: d.claudeUsageCheck ?? null,
  claudeUsageShares: d.claudeUsageShares ?? [],
  ops: d.ops ?? EMPTY_OPS,
  doctor: d.doctor ?? [],
});
