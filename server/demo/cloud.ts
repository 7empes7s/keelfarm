// The demo's cloud agents and accounts (#257, docs/cloud.md): a fake Upstash account, Boxes and sign-ins.
import type { CloudBackend } from '../backend.ts';
import { CloudError, type BoxApi, type BoxInfo } from '../box.ts';
import { demoAccounts, demoUsageApi } from '../demoAccounts.ts';
import { demoSignIn } from '../demoSignIn.ts';
import { registerDemo } from './registry.ts';
import { signOuts } from './world.ts';

/** The repo a cloud agent's desk in its Box is for (/workspace/home/work/<owner>__<repo>). */
export function boxDeskRepo(cwd: string): string | null {
  const m = cwd.match(/\/work\/([\w.-]+)__([\w.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * A fake Upstash account (docs/cloud.md): any key opens it, and its Boxes are created, set up, paused and deleted
 * with a little delay, so a demo office shows cloud agents' Boxes coming up. Their sessions are the demo's fake ones.
 * A new Box's coding agents aren't signed in (`logins`: Box id -> the CLIs signed in there) until the fake sign-in.
 */
function demoBoxes(logins: Map<string, Set<string>>): BoxApi {
  const boxes = new Map<string, BoxInfo>();
  const installed = new Set<string>();
  let seq = 0;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const box = (id: string) => {
    const b = boxes.get(id);
    if (!b) throw new CloudError('That Box is gone.', 'gone');
    return b;
  };
  return {
    list: async () => [...boxes.values()].map((b) => ({ ...b })),
    create: async (o) => {
      await wait(2500);
      const b: BoxInfo = { id: `demo-box-${++seq}`, name: o.name, labels: o.labels, status: 'running' };
      boxes.set(b.id, b);
      return { ...b };
    },
    get: async (id) => (boxes.has(id) ? { ...boxes.get(id)! } : null),
    resume: async (id) => {
      await wait(800);
      box(id).status = 'running';
    },
    pause: async (id) => {
      box(id).status = 'paused';
    },
    remove: async (id) => {
      boxes.delete(id);
      logins.delete(id);
    },
    run: async (id, script) => {
      box(id).status = 'running';
      const cli = /claude'? auth /.test(script) ? 'claude' : 'codex';
      if (script.includes('CUBEFARM_SIGNED_IN')) return { code: 0, output: logins.get(id)?.has(cli) ? 'CUBEFARM_SIGNED_IN' : 'CUBEFARM_SIGNED_OUT' };
      if (/auth logout|' logout/.test(script)) {
        logins.get(id)?.delete(cli);
        return { code: 0, output: '' };
      }
      if (script.includes('CUBEFARM_SETUP_OK')) {
        await wait(3500);
        return { code: 0, output: 'CUBEFARM_SETUP_OK' };
      }
      if (script.includes('git worktree add')) {
        await wait(900);
        return { code: 0, output: '' };
      }
      if (script.includes('DEPS_')) {
        if (installed.has(id)) return { code: 0, output: 'DEPS_SKIPPED' };
        if (!script.includes('npm ci')) return { code: 0, output: 'DEPS_STALE' };
        await wait(1500);
        installed.add(id);
        return { code: 0, output: 'DEPS_INSTALLED' };
      }
      return { code: 0, output: script.includes('leftovers.patch') ? 'NONE' : '' };
    },
    read: async () => null,
    write: async () => undefined,
    files: async () => [],
    session: async () => {
      throw new CloudError("The demo's Boxes have no terminals: its sessions are fake.", 'other');
    },
    browser: async () => true,
  };
}

/**
 * The demo's cloud: one fake account and gh login, nothing to pick up after a restart. No Claude token or keys, so
 * each cloud agent signs in in their terminal (demoSignIn), and expireSignIns signs every Box out again.
 */
function demoCloud(): CloudBackend {
  const logins = new Map<string, Set<string>>();
  const account = demoBoxes(logins);
  return {
    boxes: () => account,
    env: () => ({}),
    ghToken: async () => 'demo-github-token-0000',
    gitIdentity: async (login) => ({ name: login ?? 'Demo Manager', email: 'demo@example.com' }),
    reconnect: async () => [], // fake sessions end with the office
    detach: () => undefined,
    signIn: (o, exited) => demoSignIn(o, logins, exited),
    expireSignIns: (credit) => {
      const ours = new Set(logins.keys());
      if (!credit) logins.clear(); // out of credit: their own logins stay, only the key stopped working
      for (const s of [...signOuts.values()]) if (credit || ours.has(s.boxId)) s.end(credit);
    },
  };
}

registerDemo('cloud', () => ({
  cloud: demoCloud(),
  accounts: demoAccounts((o, exited) => demoSignIn({ ...o, boxId: 'accounts' }, new Map(), exited)),
  usage: demoUsageApi,
}));
