// The IT desk's runner (#506): one argv through execFile, no shell, no input, no pager, killed at its timeout. The
// office's own CLAUDE_* / ANTHROPIC_* never reach it. Never throws: the exit code (null when it didn't finish) and output.
import { execFile } from 'node:child_process';
import os from 'node:os';

export interface ItExecResult {
  code: number | null;
  out: string;
  err: string;
}

const MAX_BUFFER = 8 * 1024 * 1024;

export function itExec(argv: string[], timeoutMs: number): Promise<ItExecResult> {
  const env: NodeJS.ProcessEnv = { NO_COLOR: '1', PAGER: 'cat', SYSTEMD_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', DEBIAN_FRONTEND: 'noninteractive' };
  for (const [k, v] of Object.entries(process.env)) if (!/^(ANTHROPIC_|CLAUDE)/i.test(k) && !(k in env)) env[k] = v;
  return new Promise((resolve) => {
    const child = execFile(argv[0], argv.slice(1), { cwd: os.homedir(), timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: MAX_BUFFER, windowsHide: true, env }, (err, stdout, stderr) => {
      const out = stdout?.toString() ?? '';
      const errText = stderr?.toString() ?? '';
      if (!err) return resolve({ code: 0, out, err: errText });
      const e = err as { code?: unknown; killed?: boolean; message: string };
      if (typeof e.code === 'number') return resolve({ code: e.code, out, err: errText });
      resolve({ code: null, out, err: `${errText}${errText ? '\n' : ''}${e.killed ? `stopped after ${Math.round(timeoutMs / 1000)} s` : e.message}` });
    });
    child.stdin?.end();
  });
}
