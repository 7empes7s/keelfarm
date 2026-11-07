// The office's parent process, for a checkout of this repo (`npm run dev`, `npm run demo`, `npm start`).
//
//   --dev    the server from source (tsx) plus Vite, restarting the server when server/ or shared/ code changes
//   (none)   the built office: bin/cubefarm.js (checks, then dist-server/ serving dist/), no Vite, no watching
//   --demo   passed to the server
//
// It also updates the office. When the server has drained and sends `office:update` (or you type `u` + Enter here),
// it first tries origin's default branch in a throwaway worktree while the office keeps running (npm ci, tests,
// build, a demo boot it probes), and refuses the update if any of it fails. Then it stops everything, fast-forwards
// this folder, runs npm install if the dependencies changed and, in start mode, npm run build, starts the office
// again and watches it for a probation. A failed step or probation rolls back to the old commit, and so does the
// next start when the launcher died before the probation passed (<SWARM_HOME>/update-pending.json). The result goes
// to <SWARM_HOME>/last-update.json for the server to report. `npx cubefarm` has no launcher: installed from npm, the
// office only reports that an update is ready.
import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {
  BOOT_TIMEOUT_MS,
  PREFLIGHT_TEST,
  PROBATION_MS,
  TEST_RETRY_WAIT_MS,
  clientPort,
  failedTests,
  isOfficeState,
  isUpdateCommand,
  officeUrl,
  parseMarker,
  parseOfficeArgs,
  parseSymref,
  pendingAction,
  preflightOutcome,
  preflightSteps,
  probationVerdict,
  refusal,
  rollbackPlan,
  stepsFor,
  swarmHome,
  testRetryArgs,
  testsFailedError,
} from './officeSteps.mjs';

const HELP = `
  node scripts/office.mjs [--dev] [--demo] [--no-open]

    --dev       run the server from source with Vite on SWARM_CLIENT_PORT (default 5317), restarting it on code changes
    --demo      fake GitHub and fake agents
    --no-open   start mode: don't open the browser

  Type u + Enter to update the office now (only on the default branch with no local changes).
`;

const root = path.resolve(import.meta.dirname, '..');
const WIN = process.platform === 'win32';
// How long the server gets to stop its previews and exit before its process tree is killed.
const STOP_TIMEOUT_MS = 20_000;
// --no-save: installs what the pulled package.json and lockfile say without rewriting the lockfile (another npm
// version would reformat it), which would leave local changes and refuse every later update.
const INSTALL = ['install', '--no-audit', '--no-fund', '--no-save'];
// npm steps that take longer are stopped and count as failed.
const NPM_TIMEOUT_MS = 15 * 60_000;
// How often the probation asks the office for its state.
const PROBE_EVERY_MS = 5_000;
// Ports the preflight's demo office must never take: the live office's and its Vite's.
const LIVE_PORTS = [4317, 5317];

let opts;
try {
  opts = parseOfficeArgs(process.argv.slice(2));
} catch (err) {
  console.error(`${err.message}\n${HELP}`);
  process.exit(1);
}
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
const startMode = !opts.dev;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[39m` : s);
const [magenta, red, green] = [paint(35), paint(31), paint(32)];
const log = (msg) => console.log(`${magenta('[office]')} ${msg}`);
const warn = (msg) => console.log(red(`[office] ${msg}`));
const oneLine = (err) => (err instanceof Error ? err.message : String(err)).split(/\r?\n/)[0].slice(0, 300);
const short = (sha) => sha.slice(0, 7);

// ---------- child processes ----------

/** Kill a process and everything it started. */
function killTree(proc) {
  if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return;
  if (WIN) {
    spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined);
    return;
  }
  killGroup(proc.pid) || proc.kill('SIGKILL');
}

/** SIGKILL a child's process group (each child leads its own, see spawnChild). False when it's already gone. */
function killGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

/** The server and, with --dev, Vite. Each is { name, proc, exited, stopped }. */
const children = { server: null, client: null };
let firstStart = true;

function spawnChild(name, args, { ipc = false, env = process.env } = {}) {
  const proc = spawn(process.execPath, args, {
    cwd: root,
    env,
    // stdin stays with the launcher, which reads `u` from it.
    stdio: ipc ? ['ignore', 'inherit', 'inherit', 'ipc'] : ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
    // Elsewhere each child leads its own process group, so the whole tree can be killed at once (Windows: taskkill /T).
    detached: !WIN,
  });
  const child = { name, proc, stopped: null, exited: new Promise((resolve) => proc.once('exit', (code, signal) => resolve(signal ?? code))) };
  proc.on('error', (err) => warn(`${name}: ${err.message}`));
  proc.once('exit', (code, signal) => onExit(child, signal ?? code));
  children[name] = child;
  return child;
}

function startServer() {
  const demo = opts.demo ? ['--demo'] : [];
  const args = opts.dev
    ? ['--import', 'tsx', path.join('server', 'index.ts'), ...demo]
    : [path.join('bin', 'cubefarm.js'), ...demo, ...(opts.open && firstStart ? [] : ['--no-open'])];
  const child = spawnChild('server', args, { ipc: true, env: { ...process.env, SWARM_LAUNCHER: '1' } });
  child.proc.on('message', (msg) => {
    if (msg?.type === 'office:update') void update(`the office asked, from ${short(String(msg.from ?? ''))}`, child);
  });
}

function startClient() {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) {
    warn('Vite is missing: run npm install');
    return void shutdown(1);
  }
  // vite.config.ts reads SWARM_CLIENT_PORT (strictPort) and proxies to SWARM_PORT.
  spawnChild('client', [vite]);
}

function startChildren() {
  startServer();
  if (opts.dev) {
    startClient();
    log(`Open http://localhost:${clientPort()}  ·  type u + Enter to update the office`);
  } else {
    log('Type u + Enter to update the office');
  }
  firstStart = false;
}

function onExit(child, how) {
  if (children[child.name] === child) children[child.name] = null;
  if (child.stopped || shuttingDown) return;
  if (child.name === 'server' && onProbation) return; // the probation sees it and rolls back
  if (child.name === 'server' && opts.dev) {
    warn(`Server exited (${how}); waiting for a file change to restart`);
    return;
  }
  // The built office, or Vite: nothing to wait for.
  warn(`${child.name === 'server' ? 'The office' : 'Vite'} exited (${how})`);
  void shutdown(how === 0 ? 0 : 1);
}

/**
 * Stop a child. 'update' and 'restart' ask the server over IPC (the contract with the server) and say it's coming
 * back, so agents' CLIs carry on in its terminal keeper; 'stop' says it's quitting and also sends SIGTERM where
 * signals exist; 'kill' kills its tree right away. Whatever is still running after 20 s is killed.
 */
function stopChild(child, how) {
  if (!child) return Promise.resolve();
  child.stopped ??= (async () => {
    const { proc } = child;
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    if (how === 'kill') killTree(proc);
    else {
      const asked = proc.connected;
      if (asked) proc.send({ type: 'office:shutdown', restart: how !== 'stop' }, () => undefined);
      if (!WIN && (how === 'stop' || !asked)) proc.kill('SIGTERM');
      else if (!asked) killTree(proc);
    }
    const timer = setTimeout(() => {
      warn(`${child.name} didn't stop within ${STOP_TIMEOUT_MS / 1000} s; killing it`);
      killTree(proc);
    }, STOP_TIMEOUT_MS);
    await child.exited;
    clearTimeout(timer);
    if (!WIN) killGroup(proc.pid); // anything it left running
  })();
  return child.stopped;
}

const stopChildren = (how) => Promise.all([stopChild(children.server, how), stopChild(children.client, 'kill')]);

// ---------- commands ----------

function git(args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd: root, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`git ${args[0]} failed: ${(String(stderr).trim() || err.message).split(/\r?\n/)[0]}`));
        else resolve(String(stdout).trim());
      },
    );
  });
}

/**
 * npm with its output shown here, in this folder or `cwd`. On Windows npm is a .cmd, so it goes through cmd.exe
 * (fixed arguments only). Stopped, process tree and all, after NPM_TIMEOUT_MS. A failure's error carries the end of
 * stderr as `output` (Vitest's summary of failed tests is there).
 */
function npm(args, { cwd = root, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    log(`npm ${args.join(' ')}${cwd === root ? '' : `  (in ${cwd})`}`);
    const [cmd, cmdArgs] = WIN ? ['cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`]] : ['npm', args];
    const proc = spawn(cmd, cmdArgs, { cwd, env, stdio: ['ignore', 'inherit', 'pipe'], windowsHide: true, detached: !WIN });
    if (cwd !== root) trackPreflight(proc);
    let last = '';
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(proc);
    }, NPM_TIMEOUT_MS);
    proc.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      output = (output + chunk).slice(-256 * 1024);
      const lines = String(chunk).split(/\r?\n/).filter((l) => l.trim());
      if (lines.length) last = lines[lines.length - 1].trim();
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`npm ${args[0]} failed: ${err.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const why = timedOut ? `timed out after ${NPM_TIMEOUT_MS / 60_000} min` : `exit ${code}`;
      reject(Object.assign(new Error(`npm ${args.join(' ')} failed (${why})${last ? `: ${last}` : ''}`), { output }));
    });
  });
}

async function defaultBranch() {
  const local = await git(['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']).catch(() => '');
  if (local.startsWith('origin/')) return local.slice('origin/'.length);
  const remote = parseSymref(await git(['ls-remote', '--symref', 'origin', 'HEAD'], 60_000).catch(() => ''));
  if (remote) return remote;
  throw new Error("can't tell origin's default branch");
}

// ---------- updating ----------

let updating = null; // the running update
let askedAgain = null; // the server that asked for an update while one was running: it's waiting for one
let onProbation = false; // the restarted office is being watched: its exit fails the probation instead of quitting

function update(trigger, asker = null) {
  if (shuttingDown) return Promise.resolve();
  if (updating) {
    log('Already updating');
    if (asker) askedAgain = asker;
    return updating;
  }
  updating = runUpdate(trigger, !!asker).finally(() => {
    updating = null;
    const again = askedAgain;
    askedAgain = null;
    // The office that asked is still the one running (it asked during the probation, say): it waits for an update.
    if (again && again === children.server && !shuttingDown) void update('the office asked again', again);
  });
  return updating;
}

/**
 * Check, then try the target commit in a throwaway worktree while the office keeps running. Only if that all passes
 * does the office stop and switch (switchTo).
 */
async function runUpdate(trigger, asked) {
  log(`Updating the office (${trigger}): checking first, the office keeps running`);
  const result = { from: '', to: '', target: '', ok: true, installed: false, built: false };
  let stage = 'check';
  try {
    result.from = await git(['rev-parse', 'HEAD']);
    await git(['fetch', 'origin', '--prune'], 180_000);
    const branch = await defaultBranch();
    const target = `origin/${branch}`;
    const refused = refusal({
      branch: await git(['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => ''),
      defaultBranch: branch,
      dirty: (await git(['status', '--porcelain', '--untracked-files=no'])) !== '',
      ahead: Number(await git(['rev-list', '--count', `${target}..HEAD`])),
    });
    if (refused) throw new Error(refused);
    result.target = await git(['rev-parse', target]);
    if (result.target === result.from) {
      log('Already up to date');
      return keep(result, asked);
    }
    stage = 'preflight';
    log(`Preflight: trying ${short(result.target)} in a throwaway worktree before switching to it`);
    await preflight(result.target);
    if (shuttingDown) return;
  } catch (err) {
    if (shuttingDown) return; // the preflight was stopped with the launcher: nothing to report
    Object.assign(result, { ok: false, stage, error: oneLine(err) });
    warn(`Update ${stage === 'check' ? 'refused' : `to ${short(result.target)} refused in the preflight`}: ${result.error}. Still on ${short(result.from || '?')}`);
    return keep(result, asked);
  }
  await switchTo(result);
}

/** The update stopped before the live office was touched: it keeps running, and hears the result if it's waiting. */
function keep(result, asked) {
  result.to = result.from;
  if (!result.ok || asked) writeJson(lastUpdateFile(), { ...result, at: Date.now() });
  const server = children.server?.proc;
  if (server?.connected) server.send({ type: 'office:update-result' }, () => undefined);
  else if (!children.server && !shuttingDown) startServer(); // --dev, its server had exited: start it as an update would
}

/**
 * Stop the office, fast-forward this folder to the commit that passed the preflight, install and build in place,
 * start it again and watch it for its probation. update-pending.json stays until the probation passes, so a launcher
 * that dies on the way rolls back at its next start.
 */
async function switchTo(result) {
  writeJson(markerFile(), { from: result.from, to: result.target, startedAt: Date.now() });
  log(green(`Preflight passed: stopping the office to switch to ${short(result.target)}`));
  await stopChildren('update');
  const ran = { installed: false, built: false }; // started, even if it then failed
  let steps = { install: false, build: false };
  try {
    await git(['merge', '--ff-only', result.target]);
    const changed = (await git(['diff', '--name-only', result.from, 'HEAD'])).split(/\r?\n/).filter(Boolean);
    log(`Fast-forwarded to ${short(result.target)} (${changed.length} file${changed.length === 1 ? '' : 's'} changed)`);
    steps = stepsFor(changed, { startMode });
    if (steps.install) {
      ran.installed = true;
      await npm(INSTALL);
      result.installed = true;
    }
    if (steps.build) {
      ran.built = true;
      await npm(['run', 'build']);
      result.built = true;
    }
  } catch (err) {
    Object.assign(result, { ok: false, stage: 'switch', error: oneLine(err) });
    warn(`Update failed: ${result.error}`);
    await rollBack(result, ran);
    clearMarker();
    return restart(result);
  }

  onProbation = true;
  await restart(result);
  const verdict = await watchProbation();
  if (!verdict) return; // shutting down: the marker stays, and the next start rolls back
  if (verdict.ok) {
    clearMarker();
    return log(green(`Probation passed: the office runs ${short(result.target)}`));
  }
  Object.assign(result, { ok: false, stage: 'probation', error: verdict.error, installed: false, built: false });
  warn(`Probation failed: ${verdict.error}. Rolling back to ${short(result.from)}`);
  await stopChildren('update');
  writeJson(markerFile(), { from: result.from, to: result.target, startedAt: Date.now(), rollingBack: true });
  await rollBack(result, { installed: steps.install, built: steps.build });
  clearMarker();
  await restart(result);
}

/** Write the result for the server to report, and start the office. */
async function restart(result) {
  result.to = await git(['rev-parse', 'HEAD']).catch(() => result.from);
  writeJson(lastUpdateFile(), { ...result, at: Date.now() });
  if (opts.dev) rescan();
  if (shuttingDown) return;
  log(result.ok && result.from !== result.to ? `Updated: ${short(result.from)} → ${short(result.to)}. Starting the office` : 'Starting the office again');
  startChildren();
}

/**
 * Back to the commit the update started from, with its dependencies and build. Local changes are never touched.
 * `resumed`: a rollback that was cut short, redone in full.
 */
async function rollBack(result, ran, resumed = false) {
  const head = await git(['rev-parse', 'HEAD']).catch(() => result.from);
  const plan = rollbackPlan({ moved: head !== result.from || resumed, ...ran });
  try {
    if (plan.reset) {
      log(`Rolling back to ${short(result.from)}`);
      await git(['reset', '--keep', result.from]);
    }
    if (plan.install) {
      await npm(INSTALL);
      result.installed = true;
    }
    if (plan.build) {
      await npm(['run', 'build']);
      result.built = true;
    }
  } catch (err) {
    result.error += `; the rollback failed too: ${oneLine(err)}`;
    warn(`Rollback failed: ${oneLine(err)}`);
  }
}

// ---------- the preflight ----------

/**
 * Try `sha` in <SWARM_HOME>/update-staging, a throwaway worktree, with its own temporary SWARM_HOME: npm ci, the
 * tests, the build (start mode), then boot it as a demo office on a free port and probe it. Throws the first failure.
 */
async function preflight(sha) {
  const dir = path.join(swarmHome(), 'update-staging');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-preflight-'));
  const env = { ...process.env, SWARM_HOME: home, SWARM_PORT: '0' };
  delete env.SWARM_LAUNCHER;
  const steps = preflightSteps({ startMode });
  const work = {
    prepare: async () => {
      await removeStaging(dir);
      await git(['worktree', 'add', '--detach', dir, sha]);
    },
    install: () => npm(['ci', '--no-audit', '--no-fund'], { cwd: dir, env }),
    test: () => preflightTests(dir, env),
    build: () => npm(['run', 'build'], { cwd: dir, env }),
    boot: () => bootProbe(dir, env),
  };
  const results = [];
  try {
    for (const step of ['prepare', ...steps]) {
      try {
        await work[step]();
        results.push({ step, ok: true });
      } catch (err) {
        results.push({ step, ok: false, error: oneLine(err) });
        break;
      }
    }
  } finally {
    await removeStaging(dir);
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  }
  const outcome = preflightOutcome(steps, results);
  if (!outcome.go) throw new Error(outcome.error);
}

/** The suite as PREFLIGHT_TEST runs it; failed tests get one more try after TEST_RETRY_WAIT_MS, then name the refusal. */
async function preflightTests(dir, env) {
  try {
    return await npm(PREFLIGHT_TEST, { cwd: dir, env });
  } catch (err) {
    const failed = failedTests(err.output ?? '');
    log(`Tests failed${failed.length ? ` (${failed.length})` : ''}: trying ${failed.length ? 'their files' : 'them'} again in ${TEST_RETRY_WAIT_MS / 1000} s`);
    await sleep(TEST_RETRY_WAIT_MS);
    if (shuttingDown) throw err;
    try {
      await npm(testRetryArgs(failed), { cwd: dir, env });
      log(green('They passed on the retry'));
    } catch (again) {
      const still = failedTests(again.output ?? '');
      throw new Error(testsFailedError(still.length ? still : failed, oneLine(again)));
    }
  }
}

async function removeStaging(dir) {
  await git(['worktree', 'remove', '--force', dir]).catch(() => undefined);
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch((err) => warn(`Couldn't remove ${dir}: ${oneLine(err)}`));
  await git(['worktree', 'prune']).catch(() => undefined);
}

/** Boot the staged office as a demo and wait for it to answer every probe (bootError), within BOOT_TIMEOUT_MS. */
async function bootProbe(dir, env) {
  const port = await freePort();
  const args = startMode ? [path.join('bin', 'cubefarm.js'), '--demo', '--no-open'] : ['--import', 'tsx', path.join('server', 'index.ts'), '--demo'];
  log(`Booting it as a demo office on port ${port}`);
  const proc = spawn(process.execPath, args, {
    cwd: dir,
    env: { ...env, SWARM_PORT: String(port), SWARM_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: !WIN,
  });
  trackPreflight(proc);
  let last = '';
  let lastError = '';
  const show = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter((l) => l.trim())) {
      console.log(`${magenta('[preflight]')} ${line}`);
      last = line.trim();
      if (/\b\w*Error\b/.test(line)) lastError = line.trim();
    }
  };
  proc.stdout.on('data', show);
  proc.stderr.on('data', show);
  let exited = null;
  const gone = new Promise((resolve) => {
    proc.once('exit', (code, signal) => resolve((exited = signal ?? code)));
    proc.once('error', (err) => resolve((exited = err.message)));
  });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let error = 'no answer';
  try {
    while (Date.now() < deadline) {
      await Promise.race([sleep(1000), gone]);
      if (exited !== null) throw new Error(`the demo office exited (${exited})${lastError || last ? `: ${lastError || last}` : ''}`);
      error = await bootError(url, dir);
      if (!error) return log(green('The demo office answered: /api/state, / and /ws'));
    }
    throw new Error(`the demo office didn't answer within ${BOOT_TIMEOUT_MS / 1000} s: ${error}`);
  } finally {
    killTree(proc);
    await Promise.race([gone, sleep(10_000)]);
    if (!WIN) killGroup(proc.pid);
  }
}

/** Why the office at `url` isn't working yet, or null: GET /api/state, then (start mode) GET / and the /ws snapshot. */
async function bootError(url, dir) {
  const state = await stateError(url);
  if (state) return `GET /api/state: ${state}`;
  if (startMode) {
    try {
      const res = await fetch(`${url}/`, { signal: AbortSignal.timeout(5000) });
      const body = await res.text();
      const built = fs.readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8');
      if (res.status !== 200 || body.trim() !== built.trim()) return `GET / didn't serve the built index.html (HTTP ${res.status})`;
    } catch (err) {
      return `GET /: ${fetchError(err)}`;
    }
  }
  return wsError(url);
}

/** Why GET /api/state didn't answer 200 with the office's state, or null. */
async function stateError(url) {
  try {
    const res = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(5000) });
    if (res.status !== 200) return `HTTP ${res.status}`;
    return isOfficeState(await res.json()) ? null : "not the office's state";
  } catch (err) {
    return fetchError(err);
  }
}

const fetchError = (err) => err?.cause?.code ?? oneLine(err);

/** Why /ws didn't send a snapshot within 10 s, or null. */
function wsError(url) {
  return new Promise((resolve) => {
    let ws = null;
    const done = (error) => {
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // already closed
      }
      resolve(error);
    };
    const timer = setTimeout(() => done('/ws sent no snapshot within 10 s'), 10_000);
    try {
      ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`);
    } catch (err) {
      return done(`/ws: ${oneLine(err)}`);
    }
    ws.addEventListener('message', (ev) => {
      try {
        if (JSON.parse(String(ev.data))?.type === 'snapshot') done(null);
      } catch {
        // not JSON: wait for the snapshot
      }
    });
    ws.addEventListener('error', () => done('/ws: the websocket failed'));
    ws.addEventListener('close', () => done('/ws closed before sending a snapshot'));
  });
}

/** A free port on loopback, never the live office's or its Vite's. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(LIVE_PORTS.includes(port) ? freePort() : port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const preflightProcs = new Set(); // what the preflight runs: stopping the launcher kills it rather than waiting
function trackPreflight(proc) {
  preflightProcs.add(proc);
  proc.once('exit', () => preflightProcs.delete(proc));
}

// ---------- the probation ----------

/**
 * Watch the restarted office for PROBATION_MS: it must stay up, and GET /api/state must answer 200 (probationVerdict).
 * Null when the launcher is shutting down meanwhile.
 */
async function watchProbation() {
  const child = children.server;
  try {
    if (!child) return { done: true, ok: false, error: 'the office did not start' };
    const url = officeUrl();
    log(`Probation: watching the office for ${PROBATION_MS / 1000} s (${url}/api/state)`);
    const startedAt = Date.now();
    let exited = null;
    void child.exited.then((how) => (exited = how ?? 'gone'));
    let lastProbe = null;
    let everAnswered = false;
    for (;;) {
      if (shuttingDown) return null;
      const verdict = probationVerdict({ exited, elapsedMs: Date.now() - startedAt, lastProbe, everAnswered });
      if (verdict.done) return verdict;
      await Promise.race([sleep(PROBE_EVERY_MS), child.exited]);
      if (exited !== null || shuttingDown) continue;
      const error = await stateError(url);
      lastProbe = { ok: !error, error };
      everAnswered ||= !error;
    }
  } finally {
    onProbation = false;
  }
}

// ---------- the pending marker ----------

const lastUpdateFile = () => path.join(swarmHome(), 'last-update.json');
const markerFile = () => path.join(swarmHome(), 'update-pending.json');

function readMarker() {
  try {
    return parseMarker(fs.readFileSync(markerFile(), 'utf8'));
  } catch {
    return null;
  }
}

function clearMarker() {
  try {
    fs.rmSync(markerFile(), { force: true, maxRetries: 3 });
  } catch (err) {
    warn(`Couldn't remove ${markerFile()}: ${oneLine(err)}`);
  }
}

/**
 * At start, before the office: an update whose probation never passed (the launcher died during it, or systemd
 * restarted it) is rolled back, so a broken commit can't crash-loop the office.
 */
async function recoverPending() {
  const marker = readMarker();
  const head = await git(['rev-parse', 'HEAD']).catch(() => '');
  const action = pendingAction(marker, head);
  if (action === 'none') return;
  if (action === 'clear') {
    log(`Clearing the unconfirmed update to ${short(marker.to)}: this folder is on ${short(head || '?')}`);
    return clearMarker();
  }
  warn(`The update to ${short(marker.to)} was never confirmed (the launcher stopped during its probation): rolling back to ${short(marker.from)}`);
  writeJson(markerFile(), { ...marker, rollingBack: true });
  const result = { from: marker.from, to: '', target: marker.to, ok: false, stage: 'probation', error: 'the launcher stopped before its probation passed', installed: false, built: false };
  const changed = (await git(['diff', '--name-only', marker.from, marker.to]).catch(() => '')).split(/\r?\n/).filter(Boolean);
  const steps = stepsFor(changed, { startMode });
  await rollBack(result, { installed: steps.install, built: steps.build }, marker.rollingBack);
  clearMarker();
  result.to = await git(['rev-parse', 'HEAD']).catch(() => marker.from);
  writeJson(lastUpdateFile(), { ...result, at: Date.now() });
}

/** Write JSON through a temp file and a rename. last-update.json is what the server reports on its next start. */
function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    warn(`Couldn't write ${file}: ${oneLine(err)}`);
  }
}

// ---------- restarting on code changes (--dev) ----------

// This replaces `node --watch`, which on Windows restarts on any change notification, including last-access updates:
// merely reading a server file (the CEO reviewing this repo, git status, grep) restarted the office mid-work and
// interrupted every agent. Here a file only counts as changed when its modification time or size does.
const WATCHED = ['server', 'shared'];
const CODE = /\.(ts|tsx|js|mjs|json)$/;
const stamps = new Map(); // file → "mtime:size", or "gone"
const stamp = (file) => {
  try {
    const s = fs.statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return 'gone';
  }
};
/** Take every file's current stamp, e.g. after an update, whose changes the restart already covers. */
function rescan() {
  stamps.clear();
  for (const dir of WATCHED) {
    for (const name of fs.readdirSync(path.join(root, dir), { recursive: true })) {
      const file = path.join(root, dir, String(name));
      if (CODE.test(file)) stamps.set(file, stamp(file));
    }
  }
}

function watch() {
  rescan();
  let timer = null;
  for (const dir of WATCHED) {
    fs.watch(path.join(root, dir), { recursive: true }, (_event, name) => {
      if (!name || !CODE.test(name) || updating || shuttingDown) return; // paused while updating: rescan() follows
      const file = path.join(root, dir, name);
      const now = stamp(file);
      if (stamps.get(file) === now) return; // read, not written: only its access time moved
      stamps.set(file, now);
      clearTimeout(timer);
      timer = setTimeout(() => void restartServer(file), 250); // an editor's save or a git checkout touches several files at once
    });
  }
}

async function restartServer(file) {
  log(green(`Restarting: ${path.relative(root, file)} changed`));
  await stopChild(children.server, 'restart');
  if (!children.server && !updating && !shuttingDown) startServer();
}

// ---------- stopping ----------

let shuttingDown = false;

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Stopping the office');
  for (const proc of preflightProcs) killTree(proc); // the live folder doesn't need it to finish
  await stopChildren('stop');
  if (updating) {
    log('Letting the update finish so this folder stays consistent (press Ctrl+C again to quit now)');
    await updating;
  }
  process.exit(code);
}

for (const sig of WIN ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => (shuttingDown ? process.exit(1) : void shutdown(0)));
}
// Last resort (a second Ctrl+C, a crash): no child outlives the launcher.
process.on('exit', () => {
  for (const child of Object.values(children)) {
    const { proc } = child ?? {};
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) continue;
    if (WIN) spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else killGroup(proc.pid);
  }
});

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (isUpdateCommand(line)) void update('you typed u');
});

// A Ctrl+C meanwhile waits for it, like for an update.
updating = recoverPending().finally(() => {
  updating = null;
});
await updating;
if (opts.dev) watch();
if (!shuttingDown) startChildren();
