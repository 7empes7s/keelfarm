// The demo's desks and machines (#257): checkouts, installs and trims that take a moment and touch no disk, and a
// server with room to spare (the health strip's Simulate low memory says otherwise).
import path from 'node:path';
import { HOME_DIR } from '../config.ts';
import { demoPreviewDesks } from '../demoPreviewDesks.ts';
import { registerDemo } from './registry.ts';
import { fakeSha, mergedSinceSync } from './world.ts';

/** A made-up install and build of 300-900 MB freed, so the idle-desk setting and its phone message can be seen. */
async function fakeTrim(stillIdle: () => boolean) {
  await new Promise((r) => setTimeout(r, 300));
  if (!stillIdle()) return null;
  return { freed: Math.round((300 + Math.random() * 600) * 2 ** 20), removed: ['node_modules', 'dist'], skipped: [] };
}

registerDemo('desks', ({ scale, deskRepo, installedDesks }) => {
  let lowMemory = false; // the health strip's Simulate low memory: too little left for another session (a big company: a big server)
  return {
    resources: { memory: async () => ({ availableMb: lowMemory ? 900 : scale ? 250_000 : 9800, totalMb: scale ? 262_144 : 16_384, swapFreeMb: 0, swapTotalMb: 0, load: 1.4, cpus: 8, at: Date.now() }), usage: async (dirs) => new Map(dirs.map((d) => [d, { rssMb: 1500, pids: [] }])), kill: () => undefined, browser: async () => (lowMemory ? 640 : null), simulate: (low) => void (lowMemory = low) },
    ensureClone: async () => new Promise((r) => setTimeout(r, 400)),
    syncMain: async (fullName, _branch, { touch }) => {
      const behind = mergedSinceSync.get(fullName) ?? 0;
      if (behind === 0) return { status: 'in sync', behind: 0, updatable: false };
      if (!touch) return { status: `update ready (${behind} commit${behind === 1 ? '' : 's'})`, behind, updatable: true };
      mergedSinceSync.set(fullName, 0);
      return { status: `updated to ${fakeSha().slice(0, 7)}`, behind: 0, updatable: false };
    },
    mainDir: (fullName) => `/demo/${fullName}/main`,
    deskDir: (fullName, slug) => `/demo/${fullName}/desks/${slug}`,
    // The fake desks are the ones set up since the demo started: after a restart, every desk is gone.
    deskExists: (dir) => deskRepo.has(dir),
    prepareDesk: async (fullName, _base, slug) => {
      await new Promise((r) => setTimeout(r, 900));
      const dir = `/demo/${fullName}/desks/${slug}`;
      deskRepo.set(dir, fullName);
      return dir;
    },
    // Each agent's machine has a clone of its own, so no other desk ever holds its branch.
    machines: {
      deskDir: (machine, fullName) => path.join(HOME_DIR, 'machines', machine, 'work', fullName),
      prepareDesk: async (machine, fullName) => {
        await new Promise((r) => setTimeout(r, 900));
        const dir = path.join(HOME_DIR, 'machines', machine, 'work', fullName);
        deskRepo.set(dir, fullName);
        return dir;
      },
      env: () => ({}),
      release: async () => [],
      orphans: async () => [],
      trimDesk: (_machine, _fullName, stillIdle) => fakeTrim(stillIdle),
      sweep: async () => 0,
      remove: async () => ({ removed: true, patches: [] }),
      list: async () => [],
      exists: async () => true,
      installDeps: async () => 'none',
    },
    installDeps: async (dir, cb) => {
      if (installedDesks.has(dir)) {
        cb.log(['Dependencies unchanged since the last install; skipping it.']);
        return 'skipped';
      }
      cb.log(['Installing dependencies…', '$ npm ci']);
      cb.installing();
      await new Promise((r) => setTimeout(r, 1500));
      cb.log(['Dependencies installed.']);
      installedDesks.add(dir);
      return 'installed';
    },
    ...demoPreviewDesks(), // removeDesk and previewDesks (#204)
    sweepDesks: async () => ({ desks: 0, folders: 0, branches: 0, patches: [], skipped: [] }),
    trimDesk: (_fullName, _slug, stillIdle) => fakeTrim(stillIdle),
    releaseDesk: async () => undefined,
  };
});
