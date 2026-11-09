// The demo's disk (#340): a 150 GB system disk with room (the health strip's "Simulate low disk" says otherwise), a
// second 100 GB disk under /mnt for working copies, and made-up leftovers for "Free up space": two former agents'
// machines that go, one with unpushed work that stays, and caches outside the office that are left alone.
import path from 'node:path';
import type { CleanItem, DiskReading } from '../../shared/disk.ts';
import type { MachineScan } from '../diskCare.ts';
import { HOME_DIR } from '../config.ts';
import { registerDemo } from './registry.ts';

const GB = 1024;

registerDemo('disk', () => {
  let low = false;
  const gone = new Set<string>();
  const sizes: Record<string, number> = { ghost01: 3.4 * GB, ghost02: 1.9 * GB, ghost03: 2.6 * GB };
  const machine = (name: string, unpushed: boolean): MachineScan => {
    const dir = path.join(HOME_DIR, 'machines', name);
    return { machine: name, path: dir, mb: 0, live: false, worktrees: [{ repo: 'demo/webshop', path: path.join(dir, 'work', 'demo__webshop'), mb: 0, branch: `swarm/issue-${name.length}-${name}`, unpushed }], temps: [] };
  };
  return {
    disk: {
      read: async (dirs) =>
        dirs.map((d): DiskReading => (d.path.startsWith('/mnt/') ? { ...d, totalMb: 100 * GB, freeMb: 92 * GB } : { ...d, totalMb: 150 * GB, freeMb: low ? 3.2 * GB : 63.4 * GB })),
      scan: async () => ['ghost01', 'ghost02', 'ghost03'].filter((m) => !gone.has(m)).map((m) => machine(m, m === 'ghost03')),
      measure: async (paths) => paths.map((p) => sizes[path.basename(p)] ?? 0),
      outside: async (): Promise<CleanItem[]> =>
        [
          { label: 'npm cache', path: '~/.npm/_cacache', mb: 3.5 * GB },
          { label: 'npx downloads', path: '~/.npm/_npx', mb: 1.4 * GB },
          { label: 'Playwright browsers', path: '~/.cache/ms-playwright', mb: 1.6 * GB },
        ].map((f) => ({ ...f, id: `outside:${f.path}`, kind: 'outside', why: "outside the office's folders: left alone" })),
      remove: async (item) => {
        await new Promise((r) => setTimeout(r, 400));
        if (!item.machine) throw new Error(`not the office's to remove: ${item.path}`);
        gone.add(item.machine);
        low = false; // the made-up machines were what filled it
        return sizes[item.machine] ?? 0;
      },
      inspectRoot: async (dir) => ({ path: dir, absolute: path.isAbsolute(dir), dev: dir.startsWith('/mnt/') ? 2 : 1, rootDev: 1, homeDev: 1, freeMb: dir.startsWith('/mnt/') ? 92 * GB : 63 * GB }),
      setWorkRoot: () => undefined,
      move: async () => false, // the demo's machines are made up: nothing to move
      simulate: (on) => void (low = on),
    },
  };
});
