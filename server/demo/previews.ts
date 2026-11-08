// The demo's previews (#257): placeholder apps on the floors' ports, and the test lab's fake runner.
import http from 'node:http';
import { demoKill, demoPortOwner, demoProc } from '../demoLeftover.ts';
import { demoLabRunner } from '../demoTestLab.ts';
import type { PreviewBackend } from '../previewRunner.ts';
import { registerDemo } from './registry.ts';
import { bareRepos, repos } from './world.ts';

/**
 * The demo's stand-in for a floor's app: a page per path (Home and About link to each other), long enough to scroll.
 * A PR's build says so and shows its change, so main and the PR look different side by side.
 */
function placeholderPage(title: string, hue: number, at: string, pr: { number: number; title: string } | null) {
  const safe = (s: string) => s.replace(/[<>&"]/g, '');
  const rows = Array.from({ length: 24 }, (_, i) => `<li>Todo ${i + 1}: ${['water the plants', 'reply to Sam', 'book the dentist', 'buy coffee', 'fix the bike', 'plan the trip'][i % 6]}</li>`);
  if (pr) rows.splice(2, 0, `<li class="new">✨ New in PR #${pr.number}: ${safe(pr.title)}</li>`);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(title)}</title><link rel="icon" href="data:,">
<style>
  body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; background: hsl(${hue},60%,96%); color: #222; }
  nav { position: sticky; top: 0; display: flex; gap: 18px; align-items: center; padding: 12px 24px; background: hsl(${hue},70%,55%); color: #fff; }
  nav a { color: #fff; font-weight: 600; }
  nav .at { margin-left: auto; font-family: Consolas, monospace; font-size: 14px; opacity: .9; }
  .pr { margin: 18px auto 0; max-width: 560px; padding: 10px 16px; border-radius: 12px; background: #fff3c4; border: 2px dashed hsl(${hue},60%,45%); font-weight: 600; }
  main { margin: 22px auto; max-width: 560px; padding: 28px 36px; background: #fff; border-radius: 18px; box-shadow: 0 8px 30px hsla(${hue},50%,40%,.18); }
  h1 { margin: 0 0 6px; font-size: 26px; color: hsl(${hue},60%,38%); }
  p { margin: 0 0 18px; color: #666; }
  button { font: inherit; font-size: 18px; padding: 10px 26px; border: 0; border-radius: 999px; background: hsl(${hue},70%,55%); color: #fff; cursor: pointer; }
  button:active { transform: scale(.97); }
  #count { display: block; margin-top: 16px; font-size: 15px; color: #444; }
  ol { margin: 22px 0 0; padding-left: 22px; line-height: 2.2; }
  li.new { font-weight: 700; color: hsl(${hue},60%,32%); background: #fff3c4; border-radius: 6px; padding: 0 6px; }
</style></head>
<body>
<nav><a href="/">Home</a><a href="/about">About</a><span class="at">${safe(at)}</span></nav>
${pr ? `<div class="pr">🧪 This is PR #${pr.number}'s build: ${safe(pr.title)}</div>` : ''}
<main>
  <h1>${safe(title)}</h1>
  <p>${at === '/about' ? 'About this app: a placeholder served by the demo office.' : 'A placeholder app served by the demo office.'}</p>
  <button id="btn" type="button">Click me</button>
  <span id="count">Clicked 0 times</span>
  <ol>${rows.join('')}</ol>
</main>
<script>
  let n = 0;
  document.getElementById('btn').addEventListener('click', () => {
    n++;
    document.getElementById('count').textContent = 'Clicked ' + n + (n === 1 ? ' time' : ' times');
  });
</script>
</body></html>`;
}

/** Programs the demo pretends to have, so a bogus preview command fails the way it would for real. */
const DEMO_PROGRAMS = ['npm', 'npx', 'node', 'pnpm', 'yarn', 'bun', 'deno', 'vite', 'next', 'python', 'python3', 'py', 'php', 'ruby', 'go', 'cargo', 'dotnet'];

/**
 * No git, no npm: short fake delays through the real statuses, then a placeholder page on the floor's port.
 * Floors made in the demo have nothing to run until they get a command, and a command whose program isn't in
 * DEMO_PROGRAMS fails, so the viewer's unconfigured and error states can be tried out.
 */
// A PR preview on this floor fails its first start, so the viewer's failed card (and Ask the CEO) can be tried (#129).
const FLAKY_PREVIEWS = 'demo-co/weather-api';
const flakedOnce = new Set<string>();

const demoPreviews: PreviewBackend = {
  hasDefault: async (fullName) => !bareRepos.has(fullName),
  portOwner: demoPortOwner,
  proc: demoProc,
  kill: demoKill,
  start(job, cb) {
    let stopped = false;
    let server: http.Server | null = null;
    const timers: NodeJS.Timeout[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(() => !stopped && fn(), ms));
    const pull = job.pr ? repos.get(job.fullName)?.pulls.find((p) => p.number === job.pr) : undefined;
    const hue = ([...job.fullName].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7) + (job.pr ? 150 : 0)) % 360;
    const sha = (job.pr ? pull?.headRefName ?? String(job.pr) : job.fullName + job.defaultBranch)
      .split('')
      .reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381)
      .toString(16)
      .padStart(7, '0')
      .slice(0, 7);

    cb.status('preparing');
    later(700, () => {
      cb.commit(sha);
      cb.log([`HEAD is now at ${sha} (${job.pr ? `PR #${job.pr}` : job.defaultBranch})`]);
      if (!job.command && bareRepos.has(job.fullName)) {
        stopped = true;
        cb.failed('Nothing to run: this floor has no preview command and no package.json.', true);
        return;
      }
      cb.status('installing');
      cb.log(['$ npm ci', 'added 214 packages in 1s (demo)']);
    });
    later(1600, () => {
      cb.status('starting');
      cb.log([`$ ${job.command ?? 'npm run dev'}`.replaceAll('{port}', String(job.port))]);
      const key = `${job.fullName}#${job.pr}`;
      if (job.pr && job.fullName === FLAKY_PREVIEWS && !flakedOnce.has(key)) {
        flakedOnce.add(key);
        later(400, () => {
          cb.log(["Error: Cannot find module './routes/forecast.js'", '    at Module._resolveFilename (node:internal/modules/cjs/loader:1145:15)']);
          stopped = true;
          cb.failed(`The app exited (code 1) before it listened on port ${job.port}.`);
        });
        return;
      }
      const program = job.command?.trim().split(/\s+/)[0] ?? 'npm';
      if (!DEMO_PROGRAMS.includes(program.toLowerCase())) {
        later(400, () => {
          cb.log([`'${program}' is not recognized as an internal or external command,`, 'operable program or batch file.']);
          stopped = true;
          cb.failed(`The app exited (code 1) before it listened on port ${job.port}.`);
        });
        return;
      }
      server = http.createServer((req, res) => {
        const at = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (at.includes('.')) return void res.writeHead(404).end('Not found');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(placeholderPage(job.title, hue, at, job.pr ? { number: job.pr, title: pull?.title ?? `PR #${job.pr}` } : null));
      });
      server.once('error', (err) => {
        if (stopped) return;
        stopped = true;
        cb.failed(`Could not listen on port ${job.port}: ${err.message}`);
      });
      server.listen(job.port, '127.0.0.1', () => {
        if (stopped) return void server?.close();
        later(500, () => {
          cb.log([`  ➜  Local:   http://localhost:${job.port}/`]);
          cb.status('running');
        });
      });
    });

    return {
      async stop() {
        stopped = true;
        timers.forEach(clearTimeout);
        const s = server;
        server = null;
        if (!s?.listening) return;
        s.closeAllConnections();
        await new Promise<void>((resolve) => s.close(() => resolve()));
      },
    };
  },
};

registerDemo('previews', () => ({ previews: demoPreviews, testLab: demoLabRunner() }));
