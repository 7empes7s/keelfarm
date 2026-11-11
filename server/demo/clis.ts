// The demo's coding-agent CLIs (#493): every one installed but those in SWARM_DEMO_MISSING (default OpenCode), which
// Settings → Providers installs in a few seconds (SWARM_DEMO_INSTALL=fail fails with an npm log), and OpenCode's own
// sign-in as a fake `opencode auth login`: Enter signs it in to Anthropic.
import { CLIS } from '../clis.ts';
import type { BoxSignIn } from '../cliRunner.ts';
import type { AgentTerminal } from '../terminal.ts';
import { registerDemo } from './registry.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function demoOpencodeSignIn(term: AgentTerminal, providers: Set<string>, exited: (code: number) => void): BoxSignIn {
  let over = false;
  const end = (code: number | null) => {
    if (over) return;
    over = true;
    term.bind(null);
    if (code !== null) exited(code);
  };
  term.note('── Signing OpenCode in (demo) ──');
  term.write(['┌  Add credential', '│', '◆  Select provider', '│  ● Anthropic (Claude Max or API key)', '│  ○ OpenAI', '│  ○ Google', '└', '', '\x1b[2m(demo) Press Enter to sign in to Anthropic.\x1b[0m'].join('\r\n'));
  term.bind({
    write: (data) => {
      if (over || !data.includes('\r')) return;
      providers.add('Anthropic');
      term.write('\r\n\x1b[32m◇  Login successful\x1b[0m\r\n');
      end(0);
    },
    resize: () => undefined,
  });
  return { stop: () => end(null) };
}

registerDemo('clis', () => {
  const missing = new Set((process.env.SWARM_DEMO_MISSING ?? 'opencode').split(',').map((s) => s.trim()));
  const providers = new Set<string>();
  return {
    detectClis: async () =>
      CLIS.map((c) => ({
        id: c.id,
        label: c.label,
        installed: !missing.has(c.id),
        version: missing.has(c.id) ? null : 'demo',
        integrated: c.integrated,
        ...(c.id === 'opencode' && !missing.has(c.id) && { providers: [...providers] }),
      })),
    installCli: async (id) => {
      await wait(3000);
      if (process.env.SWARM_DEMO_INSTALL === 'fail') return { ok: false, tail: ['npm error code E404', `npm error 404 Not Found - GET https://registry.npmjs.org/${id} (demo)`, 'npm error A complete log of this run can be found in: /demo/_logs/debug-0.log'] };
      missing.delete(id);
      return { ok: true, tail: [] };
    },
    opencodeSignIn: (term, exited) => demoOpencodeSignIn(term, providers, exited),
  };
});
