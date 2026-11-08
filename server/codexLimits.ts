// Codex's rate limits (#361): `codex app-server`'s account/rateLimits/read in a login's CODEX_HOME, the same numbers
// Codex's own /status shows. No model tokens. The login's files are only read by Codex itself; the office never sees them.
import { spawn } from 'node:child_process';
import { commandFor } from './clis.ts';
import { killTree } from './deps.ts';

const TIMEOUT_MS = 15_000;

/** The lines the office writes to app-server's stdin: initialize, initialized, then the read. */
const APP_SERVER_LINES = [
  { id: 1, method: 'initialize', params: { clientInfo: { name: 'cubefarm', version: '1.0.0' } } },
  { method: 'initialized' },
  { id: 2, method: 'account/rateLimits/read' },
].map((m) => JSON.stringify(m));

/** The read's answer in app-server's stdout so far: its `result`, `{ error }` if it failed, undefined while it hasn't come. */
export function rateLimitsAnswer(out: string): unknown {
  for (const line of out.split('\n')) {
    let m: { id?: unknown; result?: unknown; error?: unknown };
    try {
      m = JSON.parse(line) as typeof m;
    } catch {
      continue;
    }
    if (m.id === 2) return m.error ? { error: true } : m.result;
  }
  return undefined;
}

/** account/rateLimits/read in `codexHome`; null when Codex isn't installed, answers nothing or fails. Never throws. */
export function readCodexLimits(codexHome: string): Promise<unknown> {
  const cmd = commandFor('codex');
  if (!cmd) return Promise.resolve(null);
  // Only what Codex needs to start: never the office's ANTHROPIC_* / CLAUDE_* (as every CLI the office runs).
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC_|CLAUDE)/i.test(k)));
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const child = spawn(cmd.file, [...cmd.args, 'app-server'], { env: { ...env, CODEX_HOME: codexHome }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, detached: process.platform !== 'win32' });
    const finish = (v: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void killTree(child);
      resolve(v && typeof v === 'object' && !('error' in v) ? v : null);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    child.once('error', () => finish(null));
    child.once('exit', () => finish(rateLimitsAnswer(out) ?? null));
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
      const answer = rateLimitsAnswer(out);
      if (answer !== undefined) finish(answer);
    });
    child.stdin.on('error', () => undefined);
    child.stdin.write(`${APP_SERVER_LINES.join('\n')}\n`);
  });
}
