// The office's own update in the demo (#257): faked, so merges on floor 1 make an update ready and nothing restarts.
import { HOME_DIR } from '../config.ts';
import { takeLastUpdate, underLauncher, type LastUpdate, type OfficeHost } from '../officeUpdate.ts';
import { registerDemo } from './registry.ts';
import { fakeSha, mergedSinceSync } from './world.ts';

/**
 * Floor 1's folder plays the office's own folder, so merges there make an update ready. There is a launcher when
 * the real one started the demo, or with SWARM_DEMO_LAUNCHER=1; either way the update is faked: a short pause, then
 * the result message, and nothing restarts.
 */
const OFFICE_REPO = 'demo-co/pixel-todo';
const DEMO_HEAD = `0ff1ce5${'0'.repeat(33)}`;
const lastFakeUpdate = { to: '', commits: 0 };
const demoOffice: OfficeHost = {
  launcher: underLauncher() || process.env.SWARM_DEMO_LAUNCHER === '1',
  head: async () => DEMO_HEAD,
  isOwnFolder: (dir) => dir === `/demo/${OFFICE_REPO}/main`,
  // Only its own fake updates have a count; one the real launcher did (u) gets no count rather than a wrong one.
  commitsBetween: async (_from, to) => (to === lastFakeUpdate.to ? lastFakeUpdate.commits : null),
  takeLastUpdate: () => takeLastUpdate(HOME_DIR),
  async update(from) {
    await new Promise((r) => setTimeout(r, 4000));
    lastFakeUpdate.commits = mergedSinceSync.get(OFFICE_REPO) ?? 0;
    mergedSinceSync.set(OFFICE_REPO, 0);
    lastFakeUpdate.to = fakeSha();
    return { from, to: lastFakeUpdate.to, ok: true, installed: true, built: true, at: Date.now() };
  },
  fakeCommit: () => void mergedSinceSync.set(OFFICE_REPO, (mergedSinceSync.get(OFFICE_REPO) ?? 0) + 1),
};

/** A fresh demo office's chat: an update the preflight held back, with vitest's colour codes and rules in its output (#138). */
function demoHeldUpdate(): LastUpdate {
  const target = fakeSha();
  const output = `\x1b[31mFAIL\x1b[39m server/swarm.test.ts > schedules work \x1b[2m${'─'.repeat(120)}[1/1]\x1b[22m\x1b[39m`;
  return { from: DEMO_HEAD, to: DEMO_HEAD, target, ok: false, stage: 'preflight', error: `tests failed (npm test failed (exit 1): ${output})`, installed: false, built: false, at: Date.now() };
}

registerDemo('office', () => ({ office: demoOffice, demoHeldUpdate }));
