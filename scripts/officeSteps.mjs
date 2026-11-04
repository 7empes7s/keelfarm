// The launcher's decisions, kept pure so Vitest can cover them: its arguments, where last-update.json goes, whether
// an update may run, what a set of changed files needs, what to undo when a step fails, and the safe update's
// verdicts (preflight, probation, the pending marker at start). Used by office.mjs.
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

/** `--dev` (server + Vite, restarts on code changes), `--demo` (passed to the server), `--no-open` (start mode). */
export function parseOfficeArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dev: { type: 'boolean', default: false },
      demo: { type: 'boolean', default: false },
      'no-open': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return { dev: values.dev, demo: values.demo, open: !values['no-open'], help: values.help };
}

/** The office's state folder, resolved like server/config.ts. */
export function swarmHome(env = process.env, home = os.homedir()) {
  return env.SWARM_HOME ?? path.join(home, '.cubefarm');
}

/** Vite's port: SWARM_CLIENT_PORT, else 5317 (the same default as vite.config.ts). */
export function clientPort(env = process.env) {
  return Number(env.SWARM_CLIENT_PORT || 5317);
}

/** The default branch from `git ls-remote --symref origin HEAD` ("ref: refs/heads/main\tHEAD"), or null. */
export function parseSymref(output) {
  return /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(output)?.[1] ?? null;
}

/**
 * Why the office's folder must not be updated, or null when it may. The same rules as a floor's folder (syncMain):
 * only on the default branch, with no local changes and no local commits. Nothing is ever stashed or discarded.
 */
export function refusal({ branch, defaultBranch, dirty, ahead }) {
  if (!branch) return 'the office folder is on a detached HEAD';
  if (branch !== defaultBranch) return `the office folder is on branch ${branch}, not ${defaultBranch}`;
  if (dirty) return 'the office folder has local changes';
  if (ahead > 0) return `the office folder has ${ahead} local commit${ahead === 1 ? '' : 's'} not on origin/${defaultBranch}`;
  return null;
}

const DEPENDENCY_FILES = ['package.json', 'package-lock.json'];

/**
 * What the pulled files need: `npm install` when the root package.json or lockfile changed, and in start mode (the
 * built office) `npm run build` whenever anything changed.
 */
export function stepsFor(changedFiles, { startMode }) {
  const files = changedFiles.map((f) => f.trim().replace(/\\/g, '/')).filter(Boolean);
  return { install: files.some((f) => DEPENDENCY_FILES.includes(f)), build: startMode && files.length > 0 };
}

/**
 * What to undo after a failed step. `moved`: HEAD is no longer the commit the update started from. `installed` /
 * `built`: npm install / npm run build ran for the new commit (even if they failed partway). Going back to the old
 * commit (`git reset --keep`, which never touches local changes) also means reinstalling its dependencies and, if
 * a build ran, rebuilding it.
 */
export function rollbackPlan({ moved, installed, built }) {
  return { reset: moved, install: moved && installed, build: built };
}

/** A line typed into the launcher's terminal that asks for an update: `u`. */
export const isUpdateCommand = (line) => line.trim().toLowerCase() === 'u';

// ---------- the safe update: preflight, probation, the pending marker ----------

/** How long the preflight's demo office gets to answer. */
export const BOOT_TIMEOUT_MS = 90_000;
/** How long the updated office must stay up and answer before the update counts. */
export const PROBATION_MS = 2 * 60_000;

/**
 * The preflight's steps for the target commit, in a throwaway worktree, before the live office is touched: npm ci,
 * the tests, the build, and booting it as a demo. `--dev` runs from source, so it skips the build.
 */
export function preflightSteps({ startMode }) {
  return startMode ? ['install', 'test', 'build', 'boot'] : ['install', 'test', 'boot'];
}

const STEP_NAMES = { prepare: 'checking out the target commit', install: 'npm ci', test: 'tests', build: 'the build', boot: 'the boot check' };

/**
 * Go only when every step passed. Otherwise the first failure (or the first step that never ran), worded for the
 * phone: "tests failed (npm test failed (exit 1))".
 */
export function preflightOutcome(steps, results) {
  const failed = results.find((x) => !x.ok);
  if (failed) return { go: false, error: `${STEP_NAMES[failed.step] ?? failed.step} failed${failed.error ? ` (${failed.error})` : ''}` };
  const missing = steps.find((step) => !results.some((x) => x.step === step));
  if (missing) return { go: false, error: `${STEP_NAMES[missing] ?? missing} never ran` };
  return { go: true, error: null };
}

/** Is this GET /api/state's JSON the office's snapshot? */
export const isOfficeState = (json) => Array.isArray(json?.repos) && Array.isArray(json?.agents);

/**
 * The probation after an update restarted the office: { done, ok, error }. The server exiting fails it at once.
 * At the end of the window it passes when the last GET /api/state answered 200, and fails otherwise: it stopped
 * answering, or never answered at all.
 */
export function probationVerdict({ exited, elapsedMs, lastProbe, everAnswered, windowMs = PROBATION_MS }) {
  if (exited !== null && exited !== undefined) return { done: true, ok: false, error: `the office exited (${exited}) during its probation` };
  if (elapsedMs < windowMs) return { done: false, ok: false, error: null };
  if (lastProbe?.ok) return { done: true, ok: true, error: null };
  const why = lastProbe?.error ? ` (${lastProbe.error})` : '';
  const error = everAnswered ? `the office stopped answering GET /api/state${why}` : `the office never answered GET /api/state within ${Math.round(windowMs / 1000)} s${why}`;
  return { done: true, ok: false, error };
}

/** Parse <SWARM_HOME>/update-pending.json ({ from, to, startedAt, rollingBack? }); null when it isn't one. */
export function parseMarker(raw) {
  try {
    const m = JSON.parse(raw);
    if (typeof m?.from !== 'string' || typeof m?.to !== 'string' || !m.from || !m.to) return null;
    return { from: m.from, to: m.to, startedAt: Number(m.startedAt) || 0, rollingBack: m.rollingBack === true };
  } catch {
    return null;
  }
}

/**
 * What the launcher does at its start about an update that was never confirmed (the marker is cleared once the
 * probation passes): 'rollback' when the folder is still on the new commit, or a rollback was cut short; 'clear'
 * when it's back on the old commit, or someone moved it by hand; 'none' without a marker.
 */
export function pendingAction(marker, head) {
  if (!marker) return 'none';
  if (head === marker.to || (head === marker.from && marker.rollingBack)) return 'rollback';
  return 'clear';
}

/** Where the launcher reaches the office it runs: SWARM_HOST (loopback for the any-address) and SWARM_PORT, else 4317. */
export function officeUrl(env = process.env) {
  const host = (env.SWARM_HOST ?? '').trim().replace(/^\[|\]$/g, '');
  const local = ['', '0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
  return `http://${local.includes(':') ? `[${local}]` : local}:${Number(env.SWARM_PORT || 4317)}`;
}
