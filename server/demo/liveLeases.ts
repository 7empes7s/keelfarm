// The demo's live leases (#398): each desk's made-up diff (src/App.tsx, which every demo PR changes, plus one file
// picked by the desk), and a main that moves every ten minutes onto src/App.tsx and one more, so floor 1 shows real-diff
// leases, a "merge main now" nudge and a shared-file one.
import { registerDemo } from './registry.ts';

const FILES = ['src/cart.tsx', 'src/checkout.tsx', 'src/api.ts', 'README.md'];
const MOVE_MS = 10 * 60_000;
const pick = (s: string) => FILES[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % FILES.length];

registerDemo('liveLeases', () => ({
  worktreeChanges: async (dir) => ({ files: ['src/App.tsx', pick(dir)], base: 'demo-main-0' }),
  mainHead: async () => `demo-main-${Math.floor(Date.now() / MOVE_MS)}`,
  mainFilesSince: async (_fullName, from, to) => (from === to ? [] : ['src/App.tsx', pick(to)]),
}));
